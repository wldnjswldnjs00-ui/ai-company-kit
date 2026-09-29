import { describe, it, expect } from "vitest";
import { formatHealthReport } from "../src/company/health";

const name = (id: string) => ({ ops: "운영본부" })[id] ?? id;

describe("formatHealthReport", () => {
  it("stays silent when everything is fine", () => {
    expect(formatHealthReport({ failed: [], stalled: 0, staleProposals: 0, usage: [{ provider: "gemini", calls: 10, limit: 200 }] }, name)).toBeNull();
  });

  it("reports failures, a stalled queue, stale proposals and a budget near its limit", () => {
    const text = formatHealthReport(
      {
        failed: [{ department: "ops", title: "분쟁 정리", error: "Gemini 오류" }],
        stalled: 2,
        staleProposals: 1,
        usage: [{ provider: "gemini", calls: 170, limit: 200 }],
      },
      name
    )!;
    expect(text).toContain("[운영본부] 분쟁 정리");
    expect(text).toContain("2시간 넘게 기다리는 업무 2건");
    expect(text).toContain("3일 넘게 결재를 기다리는 제안 1건");
    expect(text).toContain("gemini 오늘 사용 170/200회");
  });
});
