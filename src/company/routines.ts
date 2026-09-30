import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { must, createTask, listDepartments, type Task, type Proposal, type Department } from "../db";
import { sendCeo, escapeHtml } from "../telegram";
import { sendMemoryBackup } from "./backup";
import { fileMonthlyReport } from "./monthly";
import { MEETING_PREFIX } from "./orders";
import { AUTO_AGENDA } from "./meeting";
import { PATROL_TITLE_PREFIX } from "./patrol";
import { drillInstruction, listPlaybookTitles, playbookTitle, DRILL_TITLE_PREFIX, PLAYBOOK_PREFIX } from "./playbooks";
import { BENCHMARK_TITLE_PREFIX, benchmarkCompany, benchmarkHour, benchmarkInstruction, benchmarkTitle, parseBenchmarkList } from "./benchmarks";
import { currentCompany } from "./charter";
export { DRILL_TITLE_PREFIX };

// 정기 업무: the company's own calendar. Each routine files an ordinary task
// card at its time (so it shows on the dashboard and goes through the same
// queue, budget and reporting as a CEO order) — except the evening report,
// which is pure counting and needs no LLM at all.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstNow(now: Date): { day: number; hour: number; dateStartUtc: Date } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dateStartUtc = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS);
  return { day: kst.getUTCDay(), hour: kst.getUTCHours(), dateStartUtc };
}

type Routine = {
  key: string;
  department: string;
  title: string;
  // 0 = Sunday … 6 = Saturday (KST); omitted = every day.
  days?: number[];
  hourKst: number;
  instruction: (client: SupabaseClient, since: Date, env: Env) => Promise<string | null>;
};

// 대비 훈련: every department rehearses every day, one department per hour
// from 11시 (in the order they appear on the org chart), writing 대응 매뉴얼
// for situations that haven't happened yet. Each department has its own
// title, because runRoutines files a title at most once per day.
export const drillTitle = (name: string) => `${DRILL_TITLE_PREFIX} · ${name}`;
const DRILL_FIRST_HOUR = 11;
const DRILL_LAST_HOUR = 20;

export function drillsFor(departments: Pick<Department, "id" | "name">[]): Routine[] {
  return departments
    .filter((d) => d.id !== "cos" && d.id !== "qa" && d.id !== "future")
    .map((d, i) => ({
      key: `drill-${d.id}`,
      department: d.id,
      title: drillTitle(d.name),
      hourKst: DRILL_FIRST_HOUR + (i % (DRILL_LAST_HOUR - DRILL_FIRST_HOUR + 1)),
      instruction: async (client: SupabaseClient) => drillInstruction(d, await listPlaybookTitles(client, d.id)),
    }));
}

// 벤치마킹: every department, overnight (see benchmarks.ts).
export function benchmarksFor(departments: Pick<Department, "id" | "name">[]): Routine[] {
  return departments.map((d, i) => ({
    key: `benchmark-${d.id}`,
    department: d.id,
    title: benchmarkTitle(d.name),
    hourKst: benchmarkHour(i),
    instruction: async (_client: SupabaseClient, since: Date) =>
      benchmarkInstruction(d, benchmarkCompany(parseBenchmarkList(currentCompany().benchmarks), i, Math.floor(since.getTime() / (24 * 3600e3)))),
  }));
}

// 법무팀 daily watch. Quiet when nothing changed (see worker).
export const LEGAL_WATCH_TITLE = "법령·규제 변화 점검";
export const NO_CHANGE_MARK = "새 변경 없음";
export const PATROL_TITLE = `${PATROL_TITLE_PREFIX} · 방문자`;

// Each routine belongs to a department and is skipped when the company
// didn't pick that department on the setup screen.
export const ROUTINES: Routine[] = [
  // 웹사이트순찰팀: a real browser walks the company's website every morning.
  { key: "qa-patrol", department: "qa", title: PATROL_TITLE, hourKst: 8, instruction: async (_c, _s, env) => (env.WEBSITE_URL ? "처음 온 고객의 눈으로 우리 웹사이트를 순찰한다." : null) },
  {
    key: "future-scout",
    department: "future",
    title: "기회 탐색",
    hourKst: 19,
    instruction: async () =>
      `오늘의 기회 탐색. 최신 자료를 검색해서 우리 회사에 고객을 더 끌어올 수 있는 새 기능·기술·아이디어 2개를 찾아라.
볼 곳: 우리 업계 소식, 경쟁사가 최근 시도한 것, 우리 고객이 쓰는 새 서비스와 기술.
아이디어마다 누구의 어떤 문제를 푸는지, 기대 효과, 만드는 난이도, 작게 시험하는 방법을 쓴다. 가장 좋은 하나는 "## 다음 행동 제안" 에 [결재 필요]로 올린다.`,
  },
  {
    key: "legal-watch",
    department: "legal",
    title: LEGAL_WATCH_TITLE,
    hourKst: 9,
    instruction: async () =>
      `최근 1주일 사이 우리 회사에 영향을 줄 수 있는 법령·규제·정책 변화를 검색해서 점검하라.
대상: 우리 업종과 활동 국가에 해당하는 법(개인정보, 전자상거래, 광고, 세금, 근로, 업종별 인허가 등).
- 변화마다: 무엇이 바뀌었나, 시행일, 우리 회사에 미치는 영향, 위험도(높음·중간·낮음), 할 일, 출처.
- 이미 [회사의 기억] 에 있는 변화는 다시 보고하지 않는다.
- 새로 보고할 변화가 없으면 첫 줄을 정확히 "요약: ${NO_CHANGE_MARK}" 으로 쓰고 짧게 끝낸다.`,
  },
  {
    key: "data-weekly",
    department: "data",
    title: "주간 핵심 지표 보고",
    days: [1],
    hourKst: 9,
    instruction: async () =>
      "CEO 가 적은 [지금 회사 현황] 과 지난주 업무 기록으로 핵심 지표와 변화를 정리하고, 이번 주에 할 일 3가지를 제안하라. 숫자가 부족하면 어떤 숫자를 기록하면 좋은지 목록을 제안하라.",
  },
  {
    key: "finance-weekly",
    department: "finance",
    title: "주간 돈 흐름 점검",
    days: [1],
    hourKst: 11,
    instruction: async () =>
      "CEO 가 적은 [지금 회사 현황] 을 바탕으로 이번 주 돈의 흐름(매출·비용·남는 돈)과 새는 곳, 아낄 곳을 점검하라. 숫자가 없으면 계산하지 말고, 매주 받아야 할 숫자 목록을 제안하라.",
  },
  {
    key: "marketing-weekly",
    department: "marketing",
    title: "이번 주 콘텐츠 제안",
    days: [3],
    hourKst: 10,
    instruction: async () =>
      "우리 고객에게 도움이 되고 신뢰를 쌓는 이번 주 콘텐츠 아이디어 3개를 제안하라. 가장 좋은 하나는 게시할 수 있는 완성 원고까지 작성하라. 외부 게시는 CEO 결재 후에만 한다.",
  },
  {
    key: "cs-weekly-faq",
    department: "cs",
    title: "주간 FAQ 정리",
    days: [4],
    hourKst: 10,
    instruction: async () =>
      "고객이 자주 물을 만한 질문과 답변을 정리하고, 이미 만든 FAQ 에서 고칠 점을 찾아라. 회사의 기억에 있는 실제 문의와 CEO 피드백을 우선한다. 약속할 수 없는 것은 답변에 넣지 않는다.",
  },
  {
    key: "audit-daily",
    department: "audit",
    title: "오늘 결과물 감사",
    hourKst: 22,
    instruction: async (client, since) => {
      const done = must<Pick<Task, "department" | "title" | "summary" | "result_md">[]>(
        await client
          .from("tasks")
          .select("department,title,summary,result_md")
          .eq("status", "done")
          .neq("department", "audit")
          .gte("finished_at", since.toISOString())
          .not("result_md", "is", null)
          .limit(8)
      );
      if (done.length === 0) return null; // nothing to audit — skip the LLM call entirely
      const body = done
        .map((t) => `### [${t.department}] ${t.title}\n요약: ${t.summary}\n${(t.result_md ?? "").slice(0, 4000)}`)
        .join("\n\n---\n\n");
      return `오늘 다른 부서가 낸 결과물을 감사하라. 지어낸 숫자·근거 없는 주장·과장·회사 규칙·결재 원칙 위반을 찾고, 문장별로 이유와 고친 문장을 제시하라.\n\n${body}`;
    },
  },
  {
    key: "cos-weekly-strategy",
    department: "cos",
    title: "주간 전략 회의",
    days: [5],
    hourKst: 17,
    instruction: async (client, since) => {
      const weekAgo = new Date(since.getTime() - 6 * 24 * 3600e3).toISOString();
      const [done, decided] = await Promise.all([
        client.from("tasks").select("department,title,summary").eq("status", "done").eq("kind", "work").gte("finished_at", weekAgo).limit(40),
        client.from("proposals").select("department,title,status,ceo_note").gte("created_at", weekAgo).limit(40),
      ]);
      const doneLines = ((done.data ?? []) as Pick<Task, "department" | "title" | "summary">[]).map((t) => `- [${t.department}] ${t.title}: ${t.summary ?? ""}`);
      const proposalLines = ((decided.data ?? []) as Pick<Proposal, "department" | "title" | "status" | "ceo_note">[]).map(
        (p) => `- [${p.department}] ${p.title} → ${p.status}${p.ceo_note ? ` (CEO: ${p.ceo_note})` : ""}`
      );
      // A real all-department meeting (see meeting.ts). No topic: each
      // department raises the issue it thinks matters most this week.
      return `${MEETING_PREFIX} ${AUTO_AGENDA}
이번 주 전사 성과와 CEO 결정을 회사 비전에 비춰 돌아보고, 다음 주 우선순위를 정하는 주간 전략 회의다.

[이번 주 완료 업무]
${doneLines.join("\n") || "- 없음"}

[이번 주 자율 제안과 CEO 결정]
${proposalLines.join("\n") || "- 없음"}`;
    },
  },
];

// 자율 점검 (매일 10시 KST): every department except 비서실 looks at the
// company on its own and may file proposals. One task per department, so
// they spread over the next few heartbeats instead of one long run.
const INITIATIVE_HOUR_KST = 10;
export const INITIATIVES_PER_DAY = 3;

export function initiativeRotation<T>(departments: T[], dayIndex: number): T[] {
  if (departments.length <= INITIATIVES_PER_DAY) return departments;
  const start = (dayIndex * INITIATIVES_PER_DAY) % departments.length;
  return Array.from({ length: INITIATIVES_PER_DAY }, (_, i) => departments[(start + i) % departments.length]);
}
const INITIATIVE_TITLE = "자율 점검";

async function runInitiatives(client: SupabaseClient, dateStartUtc: Date): Promise<string[]> {
  const { count } = await client
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("kind", "initiative")
    .gte("created_at", dateStartUtc.toISOString());
  if (count) return [];

  // Free-tier quotas are small, so departments take turns: a few per day,
  // each department every two or three days.
  const all = (await listDepartments(client)).filter((d) => d.id !== "cos");
  const dayIndex = Math.floor(dateStartUtc.getTime() / (24 * 3600e3));
  const departments = initiativeRotation(all, dayIndex);
  for (const d of departments) {
    await createTask(client, {
      department: d.id,
      title: INITIATIVE_TITLE,
      instruction: "아무도 시키지 않았다. 우리 부서 관점에서 회사의 문제점·개선점·다음 할 일을 스스로 찾아 제안한다.",
      source: "schedule",
      kind: "initiative",
    });
  }
  return [`자율 점검 ${departments.length}개 부서 등록`];
}

// Called on every cron tick. A routine runs at most once per KST day: the
// "already filed today" check is the tasks table itself, so a missed tick
// just files it on the next one within the same hour or later that day.
export async function runRoutines(env: Env, client: SupabaseClient, now: Date = new Date()): Promise<string[]> {
  const { day, hour, dateStartUtc } = kstNow(now);
  const log: string[] = [];
  const departments = await listDepartments(client);
  const installed = new Set(departments.map((d) => d.id));

  for (const r of [...drillsFor(departments), ...benchmarksFor(departments), ...ROUTINES]) {
    if (!installed.has(r.department)) continue;
    if (r.days && !r.days.includes(day)) continue;
    if (hour < r.hourKst) continue;

    const { count } = await client
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("source", "schedule")
      .eq("title", r.title)
      .gte("created_at", dateStartUtc.toISOString());
    if (count) continue;

    const instruction = await r.instruction(client, dateStartUtc, env);
    if (!instruction) {
      // File a no-op marker so the check above doesn't re-evaluate all day.
      must(
        await client.from("tasks").insert({
          department: r.department,
          title: r.title,
          instruction: "(대상 없음 — 건너뜀)",
          source: "schedule",
          status: "cancelled",
        })
      );
      continue;
    }
    await createTask(client, { department: r.department, title: r.title, instruction, source: "schedule" });
    log.push(`정기 업무 등록: ${r.title}`);
  }

  if (hour >= INITIATIVE_HOUR_KST) log.push(...(await runInitiatives(client, dateStartUtc)));
  if (hour >= 21) log.push(...(await eveningReport(env, client, dateStartUtc)));
  if (day === 0 && hour >= 20) log.push(...(await weeklyBackup(env, client, dateStartUtc)));
  log.push(...(await fileMonthlyReport(client, now)));
  return log;
}

// 비서실 일일 업무 보고 (21시 KST) — counting only, costs no LLM call.
async function eveningReport(env: Env, client: SupabaseClient, since: Date): Promise<string[]> {
  const marker = "비서실 일일 업무 보고";
  const { count } = await client
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("source", "schedule")
    .eq("title", marker)
    .gte("created_at", since.toISOString());
  if (count) return [];
  // Record first, send second: a crash between the two loses one report,
  // but can never resend it every 5 minutes.
  must(
    await client.from("tasks").insert({
      department: "cos",
      title: marker,
      instruction: "(규칙 기반 보고 — 두뇌 사용 없음)",
      source: "schedule",
      status: "cancelled",
    })
  );

  const departments = await listDepartments(client);
  const tasks = must<Pick<Task, "department" | "title" | "status" | "summary">[]>(
    await client
      .from("tasks")
      .select("department,title,status,summary")
      .or(`created_at.gte.${since.toISOString()},finished_at.gte.${since.toISOString()}`)
      .neq("status", "cancelled")
      .neq("source", "schedule")
  );

  const lines = departments.map((d) => {
    const mine = tasks.filter((t) => t.department === d.id);
    const done = mine.filter((t) => t.status === "done").length;
    const open = mine.filter((t) => t.status === "queued" || t.status === "working").length;
    const failed = mine.filter((t) => t.status === "failed").length;
    return `${d.emoji} ${d.name} — 완료 ${done} · 진행 ${open}${failed ? ` · 실패 ${failed}` : ""}`;
  });
  const [{ count: pendingProposals }, { count: learnedToday }, { data: manualsToday }, { data: benchmarksToday }] = await Promise.all([
    client.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    client.from("knowledge").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
    client.from("knowledge").select("department,content").like("content", `${PLAYBOOK_PREFIX}%`).gte("created_at", since.toISOString()).limit(30),
    client
      .from("tasks")
      .select("department,summary")
      .eq("status", "done")
      .like("title", `${BENCHMARK_TITLE_PREFIX}%`)
      .gte("finished_at", since.toISOString())
      .limit(20),
  ]);
  const studied = (benchmarksToday ?? []) as { department: string; summary: string | null }[];
  const benchmarkLines = studied.map((t) => {
    const d = departments.find((x) => x.id === t.department);
    return `  • ${d ? d.name : t.department} — ${(t.summary ?? "").replace(/^요약:\s*/, "").slice(0, 90)}`;
  });
  const manuals = (manualsToday ?? []) as { department: string | null; content: string }[];
  const manualLines = manuals.slice(0, 10).map((m) => {
    const d = departments.find((x) => x.id === m.department);
    return `  • ${d ? d.name : "전사"} — ${playbookTitle(m.content)}`;
  });
  const { data: usage } = await client
    .from("brain_usage")
    .select("calls")
    .eq("day", new Date(since.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10))
    .maybeSingle();

  await sendCeo(
    env,
    [
      `🧭 <b>${marker}</b>`,
      "",
      ...lines.map(escapeHtml),
      "",
      `🧠 오늘 새로 쌓인 기억 ${learnedToday ?? 0}개`,
      `📘 오늘 새 대응 매뉴얼 ${manuals.length}개${manuals.length ? ` — ${env.PUBLIC_BASE_URL ?? ""}/knowledge?playbooks=1` : ""}`,
      ...manualLines.map(escapeHtml),
      `🔍 오늘 벤치마킹 ${studied.length}건${studied.length ? ` — ${env.PUBLIC_BASE_URL ?? ""}/tasks` : ""}`,
      ...benchmarkLines.map(escapeHtml),
      `🚀 결재 대기 제안 ${pendingProposals ?? 0}건${pendingProposals ? ` — ${env.PUBLIC_BASE_URL ?? ""}/proposals` : ""}`,
      `두뇌 사용 ${usage?.calls ?? 0} / ${env.BRAIN_DAILY_LIMIT}회`,
    ].join("\n")
  );
  return [marker];
}

// 기억 백업 (일요일 20시 KST): the whole memory as a file in Telegram.
async function weeklyBackup(env: Env, client: SupabaseClient, since: Date): Promise<string[]> {
  const marker = "주간 기억 백업";
  const { count } = await client
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("source", "schedule")
    .eq("title", marker)
    .gte("created_at", since.toISOString());
  if (count) return [];
  must(
    await client.from("tasks").insert({ department: "cos", title: marker, instruction: "(규칙 기반 — 두뇌 사용 없음)", source: "schedule", status: "cancelled" })
  );
  await sendMemoryBackup(env, client);
  return [marker];
}
