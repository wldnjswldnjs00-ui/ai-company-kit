import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { createTask, getTask, logEvent, type Task } from "../db";
import type { InlineButton } from "../telegram";
import { remember } from "./memory";

// What happens after a result the CEO likes:
//   👍 좋아요   — remembered as the standard to aim for (strong memory).
//   ▶️ 다음 단계 — also remembered, and the same department turns the
//                 report's 다음 행동 제안 into the actual deliverable.
// Anything needing money, account actions or public posting still comes
// back as [결재 필요]; nothing leaves the company without the CEO.

export type Followup = "good" | "next" | "apply";

export function followupButtons(taskId: string): InlineButton[][] {
  return [
    [
      { text: "👍 좋아요", callback_data: `hq:good:${taskId}` },
      { text: "▶️ 다음 단계로", callback_data: `hq:next:${taskId}` },
    ],
    [{ text: "🛠 실제로 적용하기", callback_data: `hq:apply:${taskId}` }],
  ];
}

export const NEXT_TITLE_PREFIX = "다음 단계: ";
export const APPLY_TITLE_PREFIX = "적용: ";

// 🛠 실제로 적용하기: 기획팀 (or the same department when there is none)
// turns an approved result into what it takes to put it into practice: a
// 개발 요청서 for website/app changes, otherwise a step-by-step checklist.
export function applyInstruction(task: Pick<Task, "title" | "summary" | "result_md">, deptName: string): string {
  return `CEO 가 ${deptName} 의 '${task.title}' 결과물을 실제로 적용하라고 했다.
이 결과물을 실제로 쓰이게 만드는 데 필요한 것을 완성해라.
- 웹사이트·앱·시스템을 바꿔야 하면 "## 개발 요청서" 를 쓴다. CEO 가 개발자(또는 AI 코딩 도구)에게 그대로 붙여 넣는다. 들어갈 문구는 결과물의 표현을 그대로 옮겨 요청서 안에 전부 적는다. 받는 사람은 이 보고서를 보지 못한다.
- 사람이 할 일이면(게시, 매장 운영, 연락 등) CEO 나 직원이 그대로 따라 할 수 있는 순서대로의 체크리스트를 만든다. 필요한 문구·자료는 완성해서 넣는다.
- 한 번에 한 가지 일만 담는다. 나머지는 "## 다음 행동 제안" 에 순서대로 적는다.

[결과물 요약]
${task.summary ?? ""}

[결과물]
${(task.result_md ?? "").slice(0, 6000)}`;
}

export function nextStepInstruction(task: Pick<Task, "title" | "summary" | "result_md">): string {
  return `CEO 가 '${task.title}' 결과물을 마음에 들어 했고, 다음 단계로 진행하라고 했다.
이전 보고서의 "다음 행동 제안" 중 CEO 결재 없이 우리 부서가 할 수 있는 것을 실제로 완성해서 가져와라.
- 계획이 아니라 바로 쓸 수 있는 결과물로 만든다: 완성 원고, 규정 문서, 체크리스트, 표, 안내 문구, 개발 요청서 등.
- 돈을 쓰거나, 계정을 건드리거나, 외부에 게시하는 일은 하지 않는다. 그 대신 CEO 가 바로 실행할 수 있게 준비물과 순서를 정리하고 [결재 필요]로 표시한다.
- 이전 보고서와 같은 내용을 반복하지 않는다.

[이전 보고서 요약]
${task.summary ?? ""}

[이전 보고서]
${(task.result_md ?? "").slice(0, 6000)}`;
}

async function alreadyDone(client: SupabaseClient, taskId: string, kind: Followup): Promise<boolean> {
  const { count } = await client.from("task_events").select("id", { count: "exact", head: true }).eq("task_id", taskId).eq("kind", `ceo_${kind}`);
  return (count ?? 0) > 0;
}

export async function followUp(
  env: Env,
  client: SupabaseClient,
  taskId: string,
  kind: Followup
): Promise<{ kind: "not_found" } | { kind: "already" } | { kind: "praised" } | { kind: "next"; taskId: string }> {
  const task = await getTask(client, taskId);
  if (!task?.result_md) return { kind: "not_found" };
  if (await alreadyDone(client, taskId, kind)) return { kind: "already" };
  await logEvent(client, taskId, `ceo_${kind}`, kind === "good" ? "CEO 👍 좋아요" : kind === "next" ? "CEO ▶️ 다음 단계로" : "CEO 🛠 실제로 적용하기");

  // "좋아요" once per report, even if several buttons are pressed.
  const others = (["good", "next", "apply"] as Followup[]).filter((k) => k !== kind);
  if (!(await Promise.all(others.map((k) => alreadyDone(client, taskId, k)))).some(Boolean)) {
    await remember(env, client, [
      {
        department: task.department,
        kind: "feedback",
        content: `CEO 가 만족한 결과물: '${task.title}' — ${task.summary ?? ""} 이 방향과 완성도를 기준으로 삼는다.`,
        weight: 3,
        source_task: task.id,
      },
    ]);
  }
  if (kind === "good") return { kind: "praised" };

  if (kind === "apply") {
    const { data: depts } = await client.from("departments").select("id,name");
    const list = (depts ?? []) as { id: string; name: string }[];
    const dept = list.find((d) => d.id === task.department);
    const apply = await createTask(client, {
      department: list.some((d) => d.id === "product") ? "product" : task.department,
      title: `${APPLY_TITLE_PREFIX}${task.title.replace(APPLY_TITLE_PREFIX, "")}`.slice(0, 60),
      instruction: applyInstruction(task, dept?.name ?? task.department),
      source: "ceo_telegram",
    });
    return { kind: "next", taskId: apply.id };
  }

  const next = await createTask(client, {
    department: task.department,
    title: `${NEXT_TITLE_PREFIX}${task.title.replace(NEXT_TITLE_PREFIX, "")}`.slice(0, 60),
    instruction: nextStepInstruction(task),
    source: "ceo_telegram",
  });
  return { kind: "next", taskId: next.id };
}
