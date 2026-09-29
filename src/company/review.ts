import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import type { Department } from "../db";
import { think, parseJsonLoose } from "../brain";
import { systemPromptFor } from "./charter";

// 교차 검토: before an important report reaches the CEO, 감사실 checks it
// for invented numbers, unsupported claims, exaggeration and rule breaches.
// Findings are appended — the author's report is never silently rewritten —
// and a failed review (quota, busy brain) never blocks the report.

export type ReviewResult = { status: "pass" } | { status: "issues"; issues: string[] } | { status: "skipped"; reason: string };

const INSTRUCTION = `[지금 할 일: 교차 검토]
다른 부서의 보고서를 CEO 에게 올리기 전에 검토한다. 제공된 회사 현황에 없는 숫자를 사실처럼 쓴 것, 근거 없는 단정, 과장, 결재 원칙 위반(돈·게시·계정 조치를 스스로 하겠다는 것), 회사 규칙 위반만 찾는다.
사소한 표현 문제나 취향은 지적하지 않는다. 문제가 없으면 없다고 한다.
JSON 으로만 답한다: {"verdict": "pass" 또는 "issues", "issues": ["문제 문장 → 왜 문제인지 → 고친 문장", ...최대 5개]}`;

export async function crossReview(env: Env, client: SupabaseClient, audit: Department, title: string, body: string, snapshot: unknown | null): Promise<ReviewResult> {
  try {
    const raw = await think(env, client, {
      system: `${systemPromptFor(audit)}\n\n${INSTRUCTION}`,
      prompt: `${snapshot ? `[회사 현황 — 사실 확인 기준]\n${JSON.stringify(snapshot)}\n\n` : ""}[검토할 보고서: ${title}]\n${body.slice(0, 20000)}`,
      json: true,
      temperature: 0.1,
    });
    const parsed = parseJsonLoose<{ verdict?: string; issues?: unknown[] }>(raw);
    const issues = (parsed.issues ?? []).filter((i): i is string => typeof i === "string" && i.trim().length > 0).slice(0, 5);
    return parsed.verdict === "issues" && issues.length ? { status: "issues", issues } : { status: "pass" };
  } catch (err) {
    return { status: "skipped", reason: err instanceof Error ? err.message : String(err) };
  }
}

export function applyReview(summary: string, body: string, review: ReviewResult): { summary: string; body: string } {
  if (review.status === "pass") return { summary, body: `${body}\n\n---\n✅ 감사실 교차 검토 통과` };
  if (review.status === "skipped") return { summary, body: `${body}\n\n---\n⏭ 감사실 교차 검토 생략 (${review.reason.slice(0, 120)})` };
  return {
    summary: `⚠️ 감사 지적 ${review.issues.length}건 · ${summary}`,
    body: `${body}\n\n---\n## 🔍 감사실 교차 검토\n${review.issues.map((i) => `- ${i}`).join("\n")}`,
  };
}

// Which reports are worth a second model call: what the CEO asked for
// directly, and work on proposals the CEO approved. Routine reports and
// department sub-tasks (their consolidated parent is reviewed) are not.
export function needsReview(task: { source: string; parent_id: string | null; department: string }): boolean {
  if (task.parent_id || task.department === "audit") return false;
  return task.source === "ceo_web" || task.source === "ceo_telegram" || task.source === "agent";
}
