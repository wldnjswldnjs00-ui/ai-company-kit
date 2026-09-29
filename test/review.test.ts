import { describe, it, expect } from "vitest";
import { applyReview, needsReview } from "../src/company/review";

describe("cross review", () => {
  it("appends findings without rewriting the report", () => {
    const r = applyReview("요약", "본문", { status: "issues", issues: ["'주문 500건' → 데이터에 없음 → '주문 데이터 확인 필요'"] });
    expect(r.summary).toBe("⚠️ 감사 지적 1건 · 요약");
    expect(r.body.startsWith("본문")).toBe(true);
    expect(r.body).toContain("## 🔍 감사실 교차 검토");
  });

  it("never blocks a report when the review couldn't run", () => {
    const r = applyReview("요약", "본문", { status: "skipped", reason: "두뇌 한도" });
    expect(r.summary).toBe("요약");
    expect(r.body).toContain("교차 검토 생략");
  });

  it("reviews CEO orders and approved-proposal work, not routines, sub-tasks or audit itself", () => {
    expect(needsReview({ source: "ceo_telegram", parent_id: null, department: "marketing" })).toBe(true);
    expect(needsReview({ source: "agent", parent_id: null, department: "ops" })).toBe(true);
    expect(needsReview({ source: "schedule", parent_id: null, department: "data" })).toBe(false);
    expect(needsReview({ source: "agent", parent_id: "p", department: "ops" })).toBe(false);
    expect(needsReview({ source: "ceo_web", parent_id: null, department: "audit" })).toBe(false);
  });
});
