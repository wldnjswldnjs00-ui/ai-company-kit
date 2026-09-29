import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { db, must, logEvent, listDepartments, createTask, type Task, type Department } from "../db";
import { think, parseJsonLoose, lastModelUsed, BrainQuotaError, BrainBusyError } from "../brain";
import { systemPromptFor, splitReport, INITIATIVE_INSTRUCTION } from "./charter";
import { getProfile, formatProfile, recall, formatMemory, remember, extractLessons, extractSection, DEV_REQUEST_HEADING } from "./memory";
import { fileProposals, MAX_PENDING_PROPOSALS, type ProposalDraft } from "./proposals";
import { MEETING_PREFIX } from "./orders";
import { sendCeo, sendCeoDocument, sendCeoPhoto, escapeHtml, taskLink } from "../telegram";
import { generateImage } from "../images";
import { crossReview, applyReview, needsReview } from "./review";
import { MONTHLY_TITLE_PREFIX } from "./monthly";
import { savePlaybooks, DRILL_TITLE_PREFIX } from "./playbooks";
import { followupButtons } from "./followup";
import { patrol, formatChecks, hasHardProblems, patrolInstruction, PATROL_TITLE_PREFIX } from "./patrol";
import { parseMeetingInstruction, opinionInstruction, parseOpinion, rebuttalTargets, rebuttalInstruction, formatOpinions, chairInstruction, type Opinion, type Rebuttal } from "./meeting";
import { searchesWeb } from "./departments";
import { LEGAL_WATCH_TITLE, NO_CHANGE_MARK } from "./routines";

// 개발 요청서: sent as its own message so the CEO can copy it straight into
// the company's developer (or an AI coding tool). Long ones go as a file.
async function sendDevRequest(env: Env, task: Pick<Task, "id" | "title">, request: string) {
  const header = `🛠 <b>개발 요청서</b> · ${escapeHtml(task.title)}\n아래 내용을 개발자(또는 AI 코딩 도구)에게 그대로 붙여 넣으세요.`;
  const text = `[AI 본사 개발 요청]\n${request}`;
  if (text.length <= 3500) {
    await sendCeo(env, `${header}\n\n<pre>${escapeHtml(text)}</pre>`);
  } else {
    await sendCeoDocument(env, `개발요청서_${task.title}.md`.replace(/[\\/:*?"<>|\s]+/g, "_"), text, header);
  }
}

const MAX_TASKS_PER_RUN = 3;
const MAX_ASSIGNMENTS = 4;

type Assignment = { department: string; title: string; instruction: string };
type TriagePlan = { interpretation?: string; assignments?: Assignment[] };

// One pass of the company's work loop — called every 5 minutes by the cron
// trigger and right after a new order arrives. Takes up to a few queued
// cards, oldest first, and works them one at a time.
export async function processQueue(env: Env): Promise<string[]> {
  if (env.AGENTS_ENABLED === "false") return ["AGENTS_ENABLED=false — 정지 중"];
  const client = db(env);
  const log: string[] = [];

  const { data: requeued } = await client.rpc("requeue_stuck_tasks");
  if (requeued) log.push(`멈춘 업무 ${requeued}건 재시도`);

  const departments = await listDepartments(client);
  // Live numbers come from the CEO's 현황 메모 (in the charter), not a feed.
  const snapshot = null;

  for (let i = 0; i < MAX_TASKS_PER_RUN; i++) {
    const claimed = must<Task[]>(await client.rpc("claim_next_task"));
    const task = claimed[0];
    if (!task) break;

    try {
      if (task.department === "cos" && task.instruction.startsWith(MEETING_PREFIX)) {
        if (await meeting(env, client, task, departments, snapshot)) {
          // Spread the meeting's brain calls over heartbeats.
          log.push(`회의 진행 중: ${task.title}`);
          break;
        }
      } else if (task.kind === "initiative") {
        await initiative(env, client, task, departments, snapshot);
      } else if (task.department === "cos" && !task.parent_id && task.source !== "schedule") {
        await triage(env, client, task, departments);
      } else {
        await work(env, client, task, departments, snapshot);
      }
      log.push(`완료: ${task.title}`);
    } catch (err) {
      const stop = await handleFailure(env, client, task, err);
      log.push(`실패: ${task.title} — ${err instanceof Error ? err.message : String(err)}`);
      if (stop) break;
    }
  }
  return log;
}

function departmentById(departments: Department[], id: string): Department {
  const dept = departments.find((d) => d.id === id);
  if (!dept) throw new Error(`알 수 없는 부서: ${id}`);
  return dept;
}

// 비서실: splits a CEO order into department assignments (or does it itself
// when no split is needed). Children are ordinary cards; the parent is
// closed as "배분 완료" and gets its 종합 보고 once every child has finished.
async function triage(env: Env, client: SupabaseClient, task: Task, departments: Department[]) {
  const cos = departmentById(departments, "cos");
  const roster = departments
    .filter((d) => d.id !== "cos")
    .map((d) => `- ${d.id} (${d.name}): ${d.mission}`)
    .join("\n");

  const raw = await think(env, client, {
    system: `${systemPromptFor(cos)}

[지금 할 일: 업무 배분]
CEO 지시를 읽고 어느 부서가 무엇을 할지 JSON 으로만 답한다. 설명 문장은 쓰지 않는다.
형식: {"interpretation": "지시를 어떻게 이해했는지 한 문장", "assignments": [{"department": "부서 id", "title": "20자 이내 업무명", "instruction": "그 부서가 바로 일할 수 있게 구체적으로 쓴 지시"}]}
- 꼭 필요한 부서만 고른다(최대 ${MAX_ASSIGNMENTS}개).
- 한 부서면 충분하면 하나만 고른다.
- 부서가 필요 없는 단순한 질문이면 assignments 를 빈 배열로 둔다.`,
    prompt: `[부서 목록]\n${roster}\n\n[CEO 지시]\n${task.instruction}`,
    json: true,
    temperature: 0.2,
  });

  let plan: TriagePlan;
  try {
    plan = parseJsonLoose<TriagePlan>(raw);
  } catch {
    throw new Error("비서실 배분 결과를 해석하지 못했습니다");
  }

  const valid = (plan.assignments ?? [])
    .filter((a) => a && departments.some((d) => d.id === a.department && d.id !== "cos") && a.instruction?.trim())
    .slice(0, MAX_ASSIGNMENTS);

  if (valid.length === 0) {
    await logEvent(client, task.id, "triage", "배분 없이 비서실이 직접 처리");
    await work(env, client, task, departments, null);
    return;
  }

  for (const a of valid) {
    await createTask(client, {
      department: a.department,
      title: (a.title || a.instruction).slice(0, 60),
      instruction: `[CEO 원래 지시]\n${task.instruction}\n\n[비서실 배분 지시]\n${a.instruction}`,
      source: "agent",
      parent_id: task.id,
    });
  }

  const names = valid.map((a) => departmentById(departments, a.department).name).join(", ");
  must(
    await client
      .from("tasks")
      .update({
        status: "done",
        summary: `${names}에 배분함. 부서 결과가 모이면 종합 보고.${plan.interpretation ? ` (해석: ${plan.interpretation})` : ""}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", task.id)
  );
  await logEvent(client, task.id, "triage", `${names}에 배분`);
  await sendCeo(env, `🧭 <b>비서실</b> · 지시 접수\n<b>${escapeHtml(task.title)}</b>\n→ ${escapeHtml(names)}에 배분했습니다.`);
}

async function recentMemory(client: SupabaseClient, department: string, excludeId: string): Promise<string> {
  const rows = must<Pick<Task, "id" | "title" | "summary" | "finished_at">[]>(
    await client
      .from("tasks")
      .select("id,title,summary,finished_at")
      .eq("department", department)
      .eq("status", "done")
      .neq("id", excludeId)
      .order("finished_at", { ascending: false })
      .limit(5)
  );
  return rows.map((r) => `- ${r.title}: ${r.summary ?? ""}`).join("\n");
}

// Everything a department knows before it starts: the company vision, the
// relevant slice of the company's memory and its own
// recent work.
async function buildContext(env: Env, client: SupabaseClient, dept: Department, task: Task, _snapshot: unknown | null): Promise<string> {
  const [profile, memories, recent] = await Promise.all([
    getProfile(client),
    recall(env, client, dept.id, `${task.title}\n${task.instruction}`).catch((err) => {
      console.error("recall failed", err);
      return [];
    }),
    recentMemory(client, dept.id, task.id),
  ]);
  return [formatProfile(profile), formatMemory(memories), recent ? `[우리 부서가 최근 끝낸 업무]\n${recent}` : ""].filter(Boolean).join("\n\n");
}

// Learning must never cost the work itself: a failure here is logged only.
async function learn(env: Env, client: SupabaseClient, dept: Department, taskId: string, lessons: string[]) {
  try {
    const stored = await remember(env, client, lessons.map((content) => ({ department: dept.id, kind: "lesson" as const, content, source_task: taskId })));
    if (lessons.length) await logEvent(client, taskId, "learned", `배운 점 ${lessons.length}개 기록 (새 기억 ${stored}개, 나머지는 기존 기억 강화)`);
  } catch (err) {
    console.error("learn failed", err);
  }
}

async function work(env: Env, client: SupabaseClient, task: Task, departments: Department[], snapshot: unknown | null) {
  const dept = departmentById(departments, task.department);
  const context = await buildContext(env, client, dept, task, snapshot);
  let prompt = `${context}\n\n[지금 할 업무: ${task.title}]\n${task.instruction}`;
  let system = systemPromptFor(dept);
  let images: { mimeType: string; data: string }[] = [];
  let patrolClean = false;

  await logEvent(client, task.id, "working", `${dept.name} 작업 시작`);

  // 웹사이트 순찰: walk the website in a real browser first, then judge what was seen.
  if (dept.id === "qa" && task.title.startsWith(PATROL_TITLE_PREFIX)) {
    const checks = await patrol(env);
    await logEvent(client, task.id, "patrol", `${checks.length}개 화면 순찰 (${checks.map((c) => c.step).join(" → ")})`);
    prompt += `\n\n[순찰 기록 — 화면 캡처는 같은 순서로 첨부]\n${formatChecks(checks)}`;
    system += `\n\n${patrolInstruction()}`;
    images = checks.flatMap((c) => (c.screenshot ? [{ mimeType: "image/jpeg", data: c.screenshot }] : []));
    patrolClean = !hasHardProblems(checks);
  }

  const text = await think(env, client, { system, prompt, search: searchesWeb(dept.id), images });
  let { summary, body } = splitReport(text);
  await logEvent(client, task.id, "model", `사용 모델: ${lastModelUsed() ?? "알 수 없음"}`);

  if (needsReview(task)) {
    const review = await crossReview(env, client, departmentById(departments, "audit"), task.title, body, snapshot);
    ({ summary, body } = applyReview(summary, body, review));
    await logEvent(client, task.id, "review", review.status === "issues" ? `감사실 지적 ${review.issues.length}건` : review.status === "pass" ? "감사실 검토 통과" : "감사실 검토 생략");
  }

  must(
    await client
      .from("tasks")
      .update({ status: "done", summary, result_md: body, error: null, finished_at: new Date().toISOString() })
      .eq("id", task.id)
  );
  await logEvent(client, task.id, "done", summary);
  await learn(env, client, dept, task.id, extractLessons(body));
  try {
    const saved = await savePlaybooks(env, client, dept.id, body, task.id);
    if (saved) await logEvent(client, task.id, "learned", `대응 매뉴얼 ${saved}개 저장`);
  } catch (err) {
    console.error("playbooks failed", err);
  }

  if (task.parent_id) {
    await maybeConsolidate(env, client, task.parent_id, departments);
  } else if (patrolClean && task.source === "schedule" && summary.includes("이상 없음")) {
    // A clean scheduled patrol: no message (one the CEO asked for always reports).
  } else if (task.title === LEGAL_WATCH_TITLE && summary.includes(NO_CHANGE_MARK)) {
    // Nothing new in the law this morning: no message.
  } else if (task.title.startsWith(DRILL_TITLE_PREFIX)) {
    // Daily drills would be seven files a day; they're summed up in the
    // evening report and kept on the 매뉴얼 page instead.
  } else {
    await reportToCeo(env, dept, task, summary, body);
  }

  const imagePrompts = (extractSection(body, /^#{1,3}\s*이미지\s*프롬프트/) ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l.length >= 10)
    .slice(0, 3);
  for (const [i, prompt] of imagePrompts.entries()) {
    const image = await generateImage(env, client, prompt);
    if (!image) break;
    await sendCeoPhoto(env, image, `🎨 <b>카드 배경 ${i + 1}/${imagePrompts.length}</b> · ${escapeHtml(task.title)}\n글자 없는 배경입니다. 원고의 문구를 얹어 쓰세요.`);
  }
  if (imagePrompts.length) await logEvent(client, task.id, "images", `카드 배경 이미지 ${imagePrompts.length}장 요청`);

  const devRequest = extractSection(body, DEV_REQUEST_HEADING);
  if (devRequest) {
    await sendDevRequest(env, task, devRequest);
    await logEvent(client, task.id, "dev_request", "개발 요청서를 CEO 에게 보냄");
  }
}

type InitiativeResult = { proposals?: ProposalDraft[]; lessons?: string[] };

// 자율 점검: nobody asked — the department looks at everything it knows and
// files at most two proposals for the CEO to approve.
async function initiative(env: Env, client: SupabaseClient, task: Task, departments: Department[], snapshot: unknown | null) {
  const dept = departmentById(departments, task.department);

  const { count: pending } = await client.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending");
  if ((pending ?? 0) >= MAX_PENDING_PROPOSALS) {
    must(await client.from("tasks").update({ status: "done", summary: `결재 대기 제안이 ${pending}건이라 오늘은 새 제안을 쉬었습니다.`, finished_at: new Date().toISOString() }).eq("id", task.id));
    return;
  }

  const [context, openProposals] = await Promise.all([
    buildContext(env, client, dept, task, snapshot),
    client.from("proposals").select("title,status").eq("department", dept.id).order("created_at", { ascending: false }).limit(15),
  ]);
  const already = (openProposals.data ?? []).map((p: { title: string; status: string }) => `- ${p.title} (${p.status})`).join("\n");

  await logEvent(client, task.id, "working", `${dept.name} 자율 점검 시작`);
  const raw = await think(env, client, {
    system: `${systemPromptFor(dept)}\n\n${INITIATIVE_INSTRUCTION}`,
    prompt: `${context}${already ? `\n\n[우리 부서가 이미 낸 제안 — 반복 금지]\n${already}` : ""}`,
    json: true,
    temperature: 0.5,
  });

  let result: InitiativeResult;
  try {
    result = parseJsonLoose<InitiativeResult>(raw);
  } catch {
    throw new Error("자율 점검 결과를 해석하지 못했습니다");
  }

  const { filed, skipped } = await fileProposals(env, client, dept, result.proposals ?? []);
  const summary = filed ? `제안 ${filed}건을 결재로 올렸습니다.` : "지금은 올릴 만한 제안이 없다고 판단했습니다.";
  must(
    await client
      .from("tasks")
      .update({
        status: "done",
        summary,
        result_md: skipped.length ? `중복이라 올리지 않은 제안:\n${skipped.map((s) => `- ${s}`).join("\n")}` : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", task.id)
  );
  await logEvent(client, task.id, "done", summary);
  await learn(env, client, dept, task.id, (result.lessons ?? []).filter((l) => typeof l === "string" && l.trim().length >= 8).slice(0, 2));
}

async function reportToCeo(env: Env, dept: Department, task: Pick<Task, "id" | "title">, summary: string, body: string) {
  const link = taskLink(env, task.id);
  const print = link && task.title.startsWith(MONTHLY_TITLE_PREFIX) ? `\n🖨 인쇄/PDF: ${link}/print` : "";
  const caption = `${dept.emoji} <b>${escapeHtml(dept.name)}</b> · 업무 완료\n<b>${escapeHtml(task.title)}</b>\n${escapeHtml(summary)}${link ? `\n${link}` : ""}${print}`;
  await sendCeoDocument(env, `${dept.name}_${task.title}.md`.replace(/[\\/:*?"<>|\s]+/g, "_"), `# ${task.title}\n\n요약: ${summary}\n\n${body}`, caption, followupButtons(task.id));
}

// Runs when a child card finishes. The guarded update on result_md makes
// sure only one caller ever writes the 종합 보고, even if two children
// finish in overlapping runs.
async function maybeConsolidate(env: Env, client: SupabaseClient, parentId: string, departments: Department[]) {
  const children = must<Task[]>(await client.from("tasks").select("*").eq("parent_id", parentId));
  if (children.some((c) => c.status === "queued" || c.status === "working")) return;

  const claimed = must<Task[]>(
    await client.from("tasks").update({ result_md: "(종합 보고 작성 중)" }).eq("id", parentId).is("result_md", null).select()
  );
  const parent = claimed[0];
  if (!parent) return;

  const sections = children
    .map((c) => {
      const dept = departments.find((d) => d.id === c.department);
      const head = `### ${dept?.emoji ?? ""} ${dept?.name ?? c.department} — ${c.title}`;
      return c.status === "done" ? `${head}\n요약: ${c.summary}\n\n${c.result_md ?? ""}` : `${head}\n(실패: ${c.error ?? "원인 불명"})`;
    })
    .join("\n\n---\n\n");

  let summary: string;
  let body: string;
  const only = children.length === 1 && children[0].status === "done" ? children[0] : null;
  if (only) {
    // One department did all the work: its report *is* the answer — no
    // point spending a free-tier call to "consolidate" a single report.
    summary = only.summary ?? "";
    body = only.result_md ?? "";
  } else {
    try {
      const cos = departmentById(departments, "cos");
      const text = await think(env, client, {
        system: `${systemPromptFor(cos)}\n\n[지금 할 일: 종합 보고]\n여러 부서의 결과를 CEO 가 1분 안에 읽을 수 있게 종합한다. 부서 간 의견이 다른 지점과 CEO 가 결정할 것을 분명히 한다.`,
        prompt: `[CEO 원래 지시]\n${parent.instruction}\n\n[부서별 결과]\n${sections.slice(0, 60000)}`,
      });
      ({ summary, body } = splitReport(text));
      body = `${body}\n\n---\n\n## 부서별 원문\n\n${sections}`;
    } catch (err) {
      // Quota or model failure must not lose the departments' work: fall back
      // to a plain concatenation and say so.
      summary = `부서 결과 ${children.length}건 취합 (AI 종합 실패: ${err instanceof Error ? err.message : String(err)})`;
      body = sections;
    }
  }

  if (!only) {
    const review = await crossReview(env, client, departmentById(departments, "audit"), parent.title, body, null);
    ({ summary, body } = applyReview(summary, body, review));
  }
  must(await client.from("tasks").update({ summary, result_md: body }).eq("id", parentId));
  await logEvent(client, parentId, "consolidated", summary);
  await reportToCeo(env, departmentById(departments, "cos"), parent, summary, body);
}

// Returns true when the whole loop should stop (quota exhausted).
async function handleFailure(env: Env, client: SupabaseClient, task: Task, err: unknown): Promise<boolean> {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof BrainQuotaError) {
    // Not the task's fault: put it back without burning an attempt, and
    // tell the CEO once per day rather than every 5 minutes.
    must(await client.from("tasks").update({ status: "queued", attempts: Math.max(0, task.attempts - 1) }).eq("id", task.id));
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await client.from("task_events").select("id", { count: "exact", head: true }).eq("kind", "quota").gte("at", since);
    await logEvent(client, task.id, "quota", message);
    if (!count) await sendCeo(env, `⏸ <b>두뇌 무료 한도 도달</b>\n${escapeHtml(message)}\n남은 업무는 한도가 풀리면 자동으로 이어서 합니다.`);
    return true;
  }

  if (err instanceof BrainBusyError) {
    // Google overloaded: don't burn one of the task's 3 attempts, and stop
    // this run so the retry happens at the next 5-minute heartbeat instead
    // of three times in the same second. Give up after about 2 hours.
    const { count } = await client.from("task_events").select("id", { count: "exact", head: true }).eq("task_id", task.id).eq("kind", "busy");
    if ((count ?? 0) < 24) {
      must(await client.from("tasks").update({ status: "queued", attempts: Math.max(0, task.attempts - 1) }).eq("id", task.id));
      await logEvent(client, task.id, "busy", `${message} — 5분 뒤 자동 재시도`);
      if (!count) await sendCeo(env, `⏳ <b>잠시 대기</b> · ${escapeHtml(task.title)}
Google AI 가 일시적으로 붐빕니다. 5분마다 자동으로 다시 시도합니다.`);
      return true;
    }
  }

  const final = task.attempts >= 3 || err instanceof BrainBusyError;
  must(
    await client
      .from("tasks")
      .update({ status: final ? "failed" : "queued", error: message.slice(0, 2000), ...(final ? { finished_at: new Date().toISOString() } : {}) })
      .eq("id", task.id)
  );
  await logEvent(client, task.id, final ? "failed" : "retry", message);
  if (final) {
    await sendCeo(env, `⚠️ <b>업무 실패</b> · ${escapeHtml(task.title)}\n${escapeHtml(message.slice(0, 500))}`);
    if (task.parent_id) await maybeConsolidate(env, client, task.parent_id, await listDepartments(client));
    return false;
  }
  // Requeued as the oldest card: stop this run so the retry happens at the
  // next heartbeat instead of being reclaimed within the same second.
  return true;
}

// "- [marketing] 제목 | 무엇을 할지 | 기대 효과" lines under "## 실행 항목".
export function parseActionItems(body: string, departmentIds: string[]): { department: string; draft: ProposalDraft }[] {
  const section = extractSection(body, /^#{1,3}\s*실행\s*항목/) ?? "";
  return section
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s*\[([a-z]+)\]\s*([^|]+)\|([^|]+)(?:\|(.+))?$/))
    .filter((m): m is RegExpMatchArray => !!m && departmentIds.includes(m[1]))
    .slice(0, 5)
    .map((m) => ({
      department: m[1],
      draft: { title: m[2].trim().slice(0, 60), problem: "", proposal: m[3].trim(), impact: (m[4] ?? "").trim(), effort: "" },
    }));
}

// 전 부서 회의: one call gathers every department's view (from its own
// mission, goals and memories) into minutes; the action items come back as
// proposals, so each one reaches the CEO as a 결재 with buttons.
// Brain calls one meeting may make per claim; the rest continue on the
// next heartbeat (the task goes back to the queue with its progress kept).
const MEETING_CALLS_PER_STEP = 3;

async function meetingEvents<T>(client: SupabaseClient, taskId: string, kind: string): Promise<T[]> {
  const rows = must<{ message: string }[]>(await client.from("task_events").select("message").eq("task_id", taskId).eq("kind", kind).order("at"));
  return rows.flatMap((r) => {
    try {
      return [JSON.parse(r.message) as T];
    } catch {
      return [];
    }
  });
}

// Returns true when the meeting paused to continue on the next heartbeat.
async function meeting(env: Env, client: SupabaseClient, task: Task, departments: Department[], snapshot: unknown | null): Promise<boolean> {
  const cos = departmentById(departments, "cos");
  const { topic, background } = parseMeetingInstruction(task.instruction, MEETING_PREFIX);
  const attendees = departments.filter((d) => d.id !== "cos");
  const subject = { ...task, title: topic ?? task.title, instruction: [topic ?? "이번 주 회사가 가장 먼저 풀어야 할 문제", background].filter(Boolean).join("\n\n") };

  const opinions = await meetingEvents<Opinion>(client, task.id, "meet_op");
  if (!opinions.length) await logEvent(client, task.id, "working", `회의 소집: ${topic ?? "안건 자율 — 부서들이 안건을 올립니다"}`);
  let calls = 0;

  // 1라운드: 부서마다 따로 의견.
  for (const d of attendees.filter((a) => !opinions.some((o) => o.dept === a.id))) {
    if (calls >= MEETING_CALLS_PER_STEP) return pauseMeeting(client, task);
    const context = await buildContext(env, client, d, subject, snapshot);
    const raw = await think(env, client, { system: `${systemPromptFor(d)}\n\n${opinionInstruction(topic)}`, prompt: `${context}${background ? `\n\n[회의 배경]\n${background}` : ""}`, json: true });
    calls++;
    const opinion = parseOpinion(d.id, raw, parseJsonLoose);
    opinions.push(opinion);
    await logEvent(client, task.id, "meet_op", JSON.stringify(opinion));
  }

  // 2라운드: 요청·반대를 받은 부서만 답한다.
  let plan = (await meetingEvents<{ targets: string[] }>(client, task.id, "meet_plan"))[0];
  if (!plan) {
    plan = { targets: rebuttalTargets(opinions, attendees.map((d) => d.id)) };
    await logEvent(client, task.id, "meet_plan", JSON.stringify(plan));
  }
  const rebuttals = await meetingEvents<Rebuttal>(client, task.id, "meet_re");
  for (const id of plan.targets.filter((t) => !rebuttals.some((r) => r.dept === t))) {
    if (calls >= MEETING_CALLS_PER_STEP) return pauseMeeting(client, task);
    const d = departmentById(departments, id);
    const raw = await think(env, client, { system: `${systemPromptFor(d)}\n\n${rebuttalInstruction(id, opinions, departments)}`, prompt: formatProfile(await getProfile(client)), json: true });
    calls++;
    let response = raw;
    try {
      response = String((parseJsonLoose<{ response?: string }>(raw).response ?? raw));
    } catch {
      // keep the raw text
    }
    const rebuttal = { dept: id, response: response.slice(0, 1500) };
    rebuttals.push(rebuttal);
    await logEvent(client, task.id, "meet_re", JSON.stringify(rebuttal));
  }

  // 3라운드: 비서실이 정리.
  if (calls >= MEETING_CALLS_PER_STEP) return pauseMeeting(client, task);
  const name = (id: string) => departments.find((d) => d.id === id)?.name ?? id;
  const text = await think(env, client, {
    system: `${systemPromptFor(cos)}\n\n${chairInstruction(topic, { opinions: opinions.length, rebuttals: rebuttals.length })}`,
    prompt: [
      formatProfile(await getProfile(client)),
      background ? `[회의 배경]\n${background}` : "",
      `[1라운드 — 부서별 의견]\n${formatOpinions(opinions, departments)}`,
      rebuttals.length ? `[2라운드 — 반론과 조정]\n${rebuttals.map((r) => `### ${name(r.dept)}\n${r.response}`).join("\n\n")}` : "[2라운드]\n서로 요청하거나 반대한 부서가 없었다.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const { summary, body } = splitReport(text);
  await logEvent(client, task.id, "model", `사용 모델: ${lastModelUsed() ?? "알 수 없음"}`);

  must(await client.from("tasks").update({ status: "done", summary, result_md: body, error: null, finished_at: new Date().toISOString() }).eq("id", task.id));
  await logEvent(client, task.id, "done", summary);
  await reportToCeo(env, cos, task, summary, body);

  // Action items → 결재, one department at a time.
  const items = parseActionItems(body, attendees.map((d) => d.id));
  let filed = 0;
  for (const { department, draft } of items) {
    const dept = departmentById(departments, department);
    const result = await fileProposals(env, client, dept, [{ ...draft, problem: `회의 '${topic ?? task.title}'에서 나온 실행 항목입니다.` }]);
    filed += result.filed;
  }
  if (filed) await logEvent(client, task.id, "proposals", `실행 항목 ${filed}건을 결재로 올림`);
  await learn(env, client, cos, task.id, extractLessons(body));
  return false;
}

// Back to the queue with its progress kept; a paused meeting isn't a failed attempt.
async function pauseMeeting(client: SupabaseClient, task: Task): Promise<boolean> {
  must(await client.from("tasks").update({ status: "queued", attempts: 0 }).eq("id", task.id));
  await logEvent(client, task.id, "meeting_step", "회의 진행 중 — 다음 순서는 5분 뒤 이어서");
  return true;
}
