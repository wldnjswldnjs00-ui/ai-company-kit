import type { SupabaseClient } from "@supabase/supabase-js";
import { createTask, listDepartments, type Department } from "../db";

// 월간 경영 보고서: on the 1st of each month (KST, from 09:00) 비서실 files one
// report on the month that just ended. The numbers are counted here, by
// code, so the report can't invent them; the brain only writes the story.
// The report is an ordinary task, so it has a printable page (/t/:id/print).

export const MONTHLY_TITLE_PREFIX = "월간 경영 보고서";
export const MONTHLY_HOUR_KST = 9;
const KST_OFFSET_MS = 9 * 3600e3;

export type MonthRange = { label: string; startUtc: Date; endUtc: Date; firstDay: string; lastDay: string };

// The KST calendar month before `now`.
export function previousMonth(now: Date): MonthRange {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // this month, 0-based
  const startUtc = new Date(Date.UTC(y, m - 1, 1) - KST_OFFSET_MS);
  const endUtc = new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return {
    label: first.toISOString().slice(0, 7),
    startUtc,
    endUtc,
    firstDay: first.toISOString().slice(0, 10),
    lastDay: last.toISOString().slice(0, 10),
  };
}

export type MonthlyFacts = {
  label: string;
  tasks: { department: string; status: string }[];
  proposals: { department: string; title: string; status: string }[];
  lessons: number;
  note: string; // CEO 가 적은 회사 현황
};

// Plain text the brain receives as facts. Pure, so it's testable.
export function formatMonthlyFacts(f: MonthlyFacts, departments: Pick<Department, "id" | "name">[]): string {
  const lines = [`[${f.label} 월간 사실 — 코드가 센 숫자, 그대로 인용할 것]`, "", "■ 부서별 업무"];
  for (const d of departments) {
    const mine = f.tasks.filter((t) => t.department === d.id);
    if (!mine.length) continue;
    const done = mine.filter((t) => t.status === "done").length;
    const failed = mine.filter((t) => t.status === "failed").length;
    lines.push(`- ${d.name}: 완료 ${done} · 실패 ${failed} · 전체 ${mine.length}`);
  }
  if (!f.tasks.length) lines.push("- 업무 없음");

  const byStatus = (s: string) => f.proposals.filter((p) => p.status === s);
  lines.push("", `■ 제안 결재: 승인 ${byStatus("approved").length} · 거절 ${byStatus("rejected").length} · 보류 ${byStatus("held").length} · 대기 ${byStatus("pending").length}`);
  const name = (id: string) => departments.find((d) => d.id === id)?.name ?? id;
  for (const p of byStatus("approved").slice(0, 10)) lines.push(`- 승인: [${name(p.department)}] ${p.title}`);
  for (const p of byStatus("rejected").slice(0, 5)) lines.push(`- 거절: [${name(p.department)}] ${p.title}`);

  lines.push("", `■ 새로 쌓인 기억(교훈·결정) ${f.lessons}개`);

  lines.push("", "■ 회사 현황 (CEO 메모)", f.note.trim() ? f.note.trim() : "- 적힌 현황 없음 (비전 화면의 '지금 회사 현황' 에 숫자를 적으면 보고서에 들어갑니다)");
  return lines.join("\n");
}

export function monthlyInstruction(facts: string): string {
  return `${facts}

위 사실만으로 지난달 월간 경영 보고서를 써라. CEO 가 인쇄해서 보관할 문서다.
구성: ## 한 줄 결론 / ## 숫자로 본 한 달 (표) / ## 부서별 성과 / ## CEO 결정과 그 결과 / ## 잘된 점·아쉬운 점 / ## 다음 달 우선순위 3가지 / ## 배운 점
숫자는 위에 적힌 것만 쓴다. 현황 숫자가 없으면 지어내지 말고 "현황 숫자 없음"이라고 적는다. 추측은 추측이라고 밝힌다.`;
}

export async function loadMonthlyFacts(client: SupabaseClient, range: MonthRange): Promise<MonthlyFacts> {
  const start = range.startUtc.toISOString();
  const end = range.endUtc.toISOString();
  const [tasks, proposals, lessons, note] = await Promise.all([
    client.from("tasks").select("department,status").gte("created_at", start).lt("created_at", end).neq("status", "cancelled"),
    client.from("proposals").select("department,title,status").gte("created_at", start).lt("created_at", end),
    client.from("knowledge").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end),
    client.from("settings").select("value").eq("key", "statusNote").maybeSingle(),
  ]);
  return {
    label: range.label,
    tasks: (tasks.data ?? []) as MonthlyFacts["tasks"],
    proposals: (proposals.data ?? []) as MonthlyFacts["proposals"],
    lessons: lessons.count ?? 0,
    note: ((note.data as { value: string } | null)?.value) ?? "",
  };
}

// Called from runRoutines on every tick; files at most one report per month.
export async function fileMonthlyReport(client: SupabaseClient, now: Date = new Date()): Promise<string[]> {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  if (kst.getUTCDate() !== 1 || kst.getUTCHours() < MONTHLY_HOUR_KST) return [];
  const range = previousMonth(now);
  const title = `${MONTHLY_TITLE_PREFIX} (${range.label})`;
  const { count } = await client.from("tasks").select("id", { count: "exact", head: true }).eq("source", "schedule").eq("title", title);
  if (count) return [];

  const [facts, departments] = await Promise.all([loadMonthlyFacts(client, range), listDepartments(client)]);
  await createTask(client, { department: "cos", title, instruction: monthlyInstruction(formatMonthlyFacts(facts, departments)), source: "schedule" });
  return [title];
}
