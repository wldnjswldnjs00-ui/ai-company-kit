import { describe, it, expect } from "vitest";
import { previousMonth, formatMonthlyFacts, monthlyInstruction } from "../src/company/monthly";

describe("previousMonth", () => {
  it("uses the KST calendar, not UTC", () => {
    // 2026-09-30 16:00 UTC = 2026-10-01 01:00 KST → the report is about September.
    const r = previousMonth(new Date("2026-09-30T16:00:00Z"));
    expect(r.label).toBe("2026-09");
    expect(r.firstDay).toBe("2026-09-01");
    expect(r.lastDay).toBe("2026-09-30");
    expect(r.startUtc.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(r.endUtc.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  it("wraps across the year", () => {
    const r = previousMonth(new Date("2027-01-01T03:00:00Z"));
    expect(r.label).toBe("2026-12");
    expect(r.lastDay).toBe("2026-12-31");
  });
});

describe("formatMonthlyFacts", () => {
  const depts = [
    { id: "ops", name: "운영본부" },
    { id: "marketing", name: "마케팅팀" },
  ];

  it("counts tasks and decisions by code and quotes the CEO status note", () => {
    const text = formatMonthlyFacts(
      {
        label: "2026-09",
        tasks: [
          { department: "ops", status: "done" },
          { department: "ops", status: "failed" },
          { department: "marketing", status: "done" },
        ],
        proposals: [
          { department: "marketing", title: "카드뉴스", status: "approved" },
          { department: "ops", title: "야간 점검", status: "rejected" },
        ],
        lessons: 7,
        note: "9월 매출 1,850만 원",
      },
      depts
    );
    expect(text).toContain("운영본부: 완료 1 · 실패 1 · 전체 2");
    expect(text).toContain("승인 1 · 거절 1");
    expect(text).toContain("승인: [마케팅팀] 카드뉴스");
    expect(text).toContain("기억(교훈·결정) 7개");
    expect(text).toContain("9월 매출 1,850만 원");
  });

  it("says so plainly when there is nothing to count", () => {
    const text = formatMonthlyFacts({ label: "2026-09", tasks: [], proposals: [], lessons: 0, note: "" }, depts);
    expect(text).toContain("업무 없음");
    expect(text).toContain("적힌 현황 없음");
    expect(monthlyInstruction(text)).toContain("숫자는 위에 적힌 것만");
  });
});
