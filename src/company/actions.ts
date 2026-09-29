import type { Env } from "../env";
import type { ProposalAction } from "./proposals";

// Things an approved proposal can *do* by itself, instead of becoming a task.
// Empty by default: every company's systems are different. To add one, give
// it a narrow, reversible call to a route built for exactly that purpose —
// never money, account suspension or deletion.
export async function runAction(_env: Env, action: ProposalAction): Promise<string> {
  switch (action.type) {
    default:
      return "등록되지 않은 조치라 실행하지 않음";
  }
}
