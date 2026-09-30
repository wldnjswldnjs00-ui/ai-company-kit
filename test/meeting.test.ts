import { describe, it, expect } from "vitest";
import { parseMeetingInstruction, parseOpinion, rebuttalTargets, rebuttalInstruction, chairInstruction, opinionInstruction, AUTO_AGENDA, type Opinion } from "../src/company/meeting";
import { parseJsonLoose } from "../src/brain";

const DEPTS = [
  { id: "legal", name: "법무팀" },
  { id: "marketing", name: "마케팅팀" },
  { id: "ops", name: "운영팀" },
];

describe("real all-department meeting", () => {
  it("reads the topic, or notices there isn't one", () => {
    expect(parseMeetingInstruction("[회의] 신규 고객 모집", "[회의]")).toEqual({ topic: "신규 고객 모집", background: "" });
    expect(parseMeetingInstruction(`[회의] ${AUTO_AGENDA}\n이번 주 완료 업무`, "[회의]")).toEqual({ topic: null, background: "이번 주 완료 업무" });
  });

  it("asks each department for its own agenda when the CEO gave none", () => {
    expect(opinionInstruction(null)).toContain("안건으로 낸다");
    expect(opinionInstruction("신규 고객 모집")).toContain("안건: 신규 고객 모집");
  });

  it("keeps a department's opinion, dropping asks to itself", () => {
    const o = parseOpinion(
      "marketing",
      '{"agenda":"출시 알림","position":"빨리 알리자","asks":[{"to":"legal","request":"문구 검토"},{"to":"marketing","request":"자기 자신"}],"risk":"과장"}',
      parseJsonLoose
    );
    expect(o).toEqual({ dept: "marketing", agenda: "출시 알림", position: "빨리 알리자", asks: [{ to: "legal", request: "문구 검토" }], risk: "과장" });
    expect(parseOpinion("ops", "JSON 아님", parseJsonLoose)).toEqual({ dept: "ops", position: "JSON 아님", asks: [] });
    // Stored in task_events (2000-char cap): a huge answer still fits as JSON.
    expect(JSON.stringify(parseOpinion("ops", JSON.stringify({ position: "가".repeat(5000), asks: Array(9).fill({ to: "legal", request: "나".repeat(900) }) }), parseJsonLoose)).length).toBeLessThan(2000);
  });

  it("lets the most-challenged departments answer back, at most four", () => {
    const ops: Opinion[] = [
      { dept: "marketing", position: "", asks: [{ to: "legal", request: "a" }, { to: "ops", request: "b" }] },
      { dept: "ops", position: "", asks: [{ to: "legal", request: "c" }, { to: "ghost", request: "x" }] },
      { dept: "legal", position: "", asks: [] },
    ];
    expect(rebuttalTargets(ops, ["legal", "marketing", "ops"])).toEqual(["legal", "ops"]);
    expect(rebuttalInstruction("legal", ops, DEPTS)).toContain("- 마케팅팀: a");
  });

  it("has the chair say how the meeting was actually held", () => {
    expect(chairInstruction(null, { opinions: 8, rebuttals: 3 })).toContain("8개 부서가 각자 의견을 내고 3개 부서가 반론한 뒤");
    expect(chairInstruction(null, { opinions: 8, rebuttals: 3 })).toContain("부서들이 낸 안건 중");
  });
});
