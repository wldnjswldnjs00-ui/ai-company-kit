import { describe, it, expect } from "vitest";
import { computeScores } from "../src/company/scoreboard";
import type { Department } from "../src/db";

const dept = (id: string): Department => ({ id, name: id, emoji: "", mission: "", goals: "", sort: 0, updated_at: "" });
const since = new Date("2026-09-22T00:00:00Z");
const t = (over: Record<string, unknown>) => ({ department: "ops", status: "done", kind: "work", started_at: "2026-09-25T10:00:00Z", finished_at: "2026-09-25T10:04:00Z", created_at: "2026-09-25T09:59:00Z", ...over });

describe("computeScores", () => {
  const [ops] = computeScores(
    [dept("ops")],
    [
      t({}),
      t({ started_at: "2026-09-26T10:00:00Z", finished_at: "2026-09-26T10:02:00Z" }),
      t({ status: "failed" }),
      t({ kind: "initiative" }), // 자율 점검 itself is not counted as work
      t({ finished_at: "2026-09-01T00:00:00Z" }), // outside the window
    ],
    [
      { department: "ops", status: "approved", created_at: "2026-09-25T00:00:00Z" },
      { department: "ops", status: "rejected", created_at: "2026-09-25T00:00:00Z" },
      { department: "ops", status: "approved", created_at: "2026-09-25T00:00:00Z" },
      { department: "ops", status: "pending", created_at: "2026-09-25T00:00:00Z" },
    ],
    [
      { department: "ops", kind: "lesson", content: "새 교훈", weight: 1, created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z" },
      { department: "ops", kind: "lesson", content: "오래된 교훈 재확인", weight: 3, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-09-24T00:00:00Z" },
      { department: "ops", kind: "feedback", content: "피드백", weight: 5, created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z" },
    ],
    since
  );

  it("counts work, failures and average time within the window only", () => {
    expect(ops.done).toBe(2);
    expect(ops.failed).toBe(1);
    expect(ops.avgMinutes).toBe(3);
  });

  it("computes the approval rate from decided proposals", () => {
    expect(ops.proposals).toBe(4);
    expect(ops.pending).toBe(1);
    expect(ops.approvalRate).toBe(67);
  });

  it("separates new lessons from reinforced old ones and counts feedback", () => {
    expect(ops.learned).toBe(1);
    expect(ops.reinforced).toBe(1);
    expect(ops.feedback).toBe(1);
    expect(ops.recentLessons).toEqual(["새 교훈"]);
  });
});
