import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { must, createTask, logEvent, type Department, type Proposal } from "../db";
import { embed, toPgVector } from "../brain/embed";
import { remember } from "./memory";
import { sendCeoWithButtons, editCeoMessage, escapeHtml } from "../telegram";
import { runAction } from "./actions";

// 자율 제안 → 결재. A department's own idea becomes a Proposal; the CEO
// approves, holds or rejects it (Telegram button or dashboard). Approval
// turns it into an ordinary task for that department; every decision is
// remembered, so a rejected idea is not proposed again.

// An approved proposal can carry a concrete action the HQ then performs
// itself (see ACTIONS in ./actions.ts); without one, approval becomes a task.
export type ProposalAction = { type: string; [key: string]: unknown };
export type ProposalDraft = { title: string; problem: string; proposal: string; impact?: string; effort?: string; action?: ProposalAction };
export type Decision = "approve" | "hold" | "reject";

// An idea this close to one already proposed (any status) is a repeat.
const REPEAT_SIMILARITY = 0.85;
// Don't pile up more undecided ideas than the CEO can realistically read.
export const MAX_PENDING_PROPOSALS = 12;

const STATUS_FOR: Record<Decision, Proposal["status"]> = { approve: "approved", hold: "held", reject: "rejected" };
const DECISION_LABEL: Record<Decision, string> = { approve: "✅ 승인 — 업무로 전환", hold: "⏸ 보류", reject: "❌ 거절" };

function proposalHtml(dept: Pick<Department, "emoji" | "name">, p: Pick<Proposal, "title" | "problem" | "proposal" | "impact" | "effort">): string {
  return [
    `🚀 <b>자율 제안</b> · ${dept.emoji} ${escapeHtml(dept.name)}`,
    "",
    `<b>${escapeHtml(p.title)}</b>`,
    `<b>문제</b> ${escapeHtml(p.problem)}`,
    `<b>제안</b> ${escapeHtml(p.proposal)}`,
    p.impact ? `<b>기대 효과</b> ${escapeHtml(p.impact)}` : "",
    p.effort ? `<b>규모</b> ${escapeHtml(p.effort)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function fileProposals(env: Env, client: SupabaseClient, dept: Department, drafts: ProposalDraft[]): Promise<{ filed: number; skipped: string[] }> {
  const valid = drafts.filter((d) => d?.title?.trim() && d.problem?.trim() && d.proposal?.trim()).slice(0, 2);
  const vectors = await embed(env, client, valid.map((d) => `${d.title}\n${d.problem}\n${d.proposal}`));
  let filed = 0;
  const skipped: string[] = [];

  for (let i = 0; i < valid.length; i++) {
    const d = valid[i];
    const vector = vectors?.[i];
    // Proposals tied to a specific object (e.g. one listing) read alike by
    // design; their own records already stop repeats, so the meaning-based
    // duplicate check would only drop legitimate ones.
    if (vector && !d.action) {
      const { data } = await client.rpc("similar_proposals", { p_embedding: toPgVector(vector), p_limit: 1 });
      const near = (data as { title: string; status: string; similarity: number }[] | null)?.[0];
      if (near && near.similarity >= REPEAT_SIMILARITY) {
        skipped.push(`${d.title} (이미 있는 제안 '${near.title}', ${near.status})`);
        continue;
      }
    }

    const proposal = must<Proposal>(
      await client
        .from("proposals")
        .insert({
          department: dept.id,
          title: d.title.slice(0, 80),
          problem: d.problem.slice(0, 1500),
          proposal: d.proposal.slice(0, 1500),
          impact: (d.impact ?? "").slice(0, 600),
          effort: (d.effort ?? "").slice(0, 40),
          embedding: vector ? toPgVector(vector) : null,
          ...(d.action ? { action: d.action } : {}),
        })
        .select()
        .single()
    );
    const messageId = await sendCeoWithButtons(env, proposalHtml(dept, proposal), [
      [
        { text: "✅ 승인", callback_data: `hq:approve:${proposal.id}` },
        { text: "⏸ 보류", callback_data: `hq:hold:${proposal.id}` },
        { text: "❌ 거절", callback_data: `hq:reject:${proposal.id}` },
      ],
    ]);
    if (messageId !== null) must(await client.from("proposals").update({ telegram_message_id: messageId }).eq("id", proposal.id));
    filed++;
  }
  return { filed, skipped };
}

export type DecideOutcome = { kind: "done"; taskId?: string } | { kind: "already"; status: string } | { kind: "not_found" };

export async function decideProposal(env: Env, client: SupabaseClient, id: string, decision: Decision, note?: string): Promise<DecideOutcome> {
  // Guarded: only an undecided (or held) proposal can be decided, so a
  // double-tapped button or a dashboard + Telegram race acts once.
  const updated = must<Proposal[]>(
    await client
      .from("proposals")
      .update({ status: STATUS_FOR[decision], decided_at: new Date().toISOString(), ceo_note: note?.trim() || null })
      .eq("id", id)
      .in("status", decision === "hold" ? ["pending"] : ["pending", "held"])
      .select()
  );
  const p = updated[0];
  if (!p) {
    const existing = must<Pick<Proposal, "status">[]>(await client.from("proposals").select("status").eq("id", id));
    return existing[0] ? { kind: "already", status: existing[0].status } : { kind: "not_found" };
  }

  const dept = must<Department>(await client.from("departments").select("*").eq("id", p.department).single());
  let taskId: string | undefined;

  let actionResult: string | undefined;
  if (decision === "approve" && p.action) {
    // A concrete, pre-registered action: run it now instead of making a task.
    actionResult = await runAction(env, p.action);
    must(await client.from("proposals").update({ action_result: actionResult }).eq("id", p.id));
  } else if (decision === "approve") {
    const task = await createTask(client, {
      department: p.department,
      title: p.title,
      instruction: `[CEO 가 승인한 우리 부서의 제안 — 이제 실행한다]\n제목: ${p.title}\n문제: ${p.problem}\n제안: ${p.proposal}\n기대 효과: ${p.impact}${note ? `\nCEO 메모: ${note}` : ""}\n\n실행 계획과 바로 쓸 수 있는 결과물(문서·원고·체크리스트 등)을 만든다. 외부 게시·돈·계정 조치가 필요한 부분은 [결재 필요]로 표시한다.`,
      source: "agent",
    });
    taskId = task.id;
    await logEvent(client, task.id, "approved", "CEO 가 자율 제안을 승인함");
    must(await client.from("proposals").update({ task_id: task.id }).eq("id", p.id));
  }

  if (decision !== "hold") {
    // The decision is already recorded; failing to also remember it must
    // not undo or block it.
    await remember(env, client, [
      {
        department: p.department,
        kind: "decision",
        content:
          decision === "approve"
            ? `CEO 가 '${p.title}' 제안을 승인했다${note ? ` (메모: ${note})` : ""}. 이런 방향의 제안은 환영받는다.`
            : `CEO 가 '${p.title}' 제안을 거절했다${note ? ` (이유: ${note})` : ""}. 같은 제안을 다시 하지 않는다.`,
        weight: decision === "reject" ? 2 : 1,
      },
    ]).catch((err) => console.error("remember decision failed", err));
  }

  if (p.telegram_message_id) {
    const label = actionResult ? `✅ 승인 — ${actionResult}` : DECISION_LABEL[decision];
    await editCeoMessage(env, p.telegram_message_id, `${proposalHtml(dept, p)}\n\n<b>${escapeHtml(label)}</b>${note ? `\n메모: ${escapeHtml(note)}` : ""}`);
  }
  return { kind: "done", taskId };
}
