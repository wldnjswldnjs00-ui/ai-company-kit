import { describe, it, expect } from "vitest";
import { parsePlaybooks, isPlaybook, playbookTitle, drillInstruction, PLAYBOOK_PREFIX } from "../src/company/playbooks";
import { drillsFor } from "../src/company/routines";
import { formatMemory } from "../src/company/memory";

const REPORT = `## 결론
대비 매뉴얼 2개를 만들었다.
## 대응 매뉴얼
### 상황: 사진 없는 환불 요청
- 징후: 고객이 "물건이 이상하다"며 사진 없이 환불을 요청
- 즉시 할 일: 1. 증빙 기한 안내 2. 담당자에게 알림 3. 기한 후 판정
- CEO 결재가 필요한 것: 없음
### 상황: 거래처 연락 두절
- 징후: 주문 후 거래처가 7일 넘게 답이 없음
- 즉시 할 일: 1. 대금 지급 보류 2. 고객 안내
### 짧음
- x
## 배운 점
- 없음`;

describe("parsePlaybooks", () => {
  it("splits the 대응 매뉴얼 section into one manual per 상황", () => {
    const out = parsePlaybooks(REPORT);
    expect(out.map((p) => p.title)).toEqual(["사진 없는 환불 요청", "거래처 연락 두절"]);
    expect(out[0].content.startsWith(`${PLAYBOOK_PREFIX}상황: 사진 없는 환불 요청\n`)).toBe(true);
    expect(out[0].content).toContain("증빙 기한 안내");
    expect(out[0].content).not.toContain("거래처 연락 두절"); // stops at the next 상황
    expect(out[1].content).not.toContain("배운 점"); // stops at the next ## section
  });

  it("finds nothing in an ordinary report", () => {
    expect(parsePlaybooks("## 결론\n그냥 보고서\n## 배운 점\n- 없음")).toEqual([]);
  });

  it("recognises a stored manual and its title", () => {
    const content = parsePlaybooks(REPORT)[0].content;
    expect(isPlaybook(content)).toBe(true);
    expect(isPlaybook("평범한 교훈")).toBe(false);
    expect(playbookTitle(content)).toBe("사진 없는 환불 요청");
  });

  it("labels manuals in the prompt so departments follow them first", () => {
    const content = parsePlaybooks(REPORT)[0].content;
    const text = formatMemory([{ id: "1", department: "ops", kind: "fact", content, weight: 2, source_task: null, active: true, created_at: "", updated_at: "" }]);
    expect(text).toContain("준비해 둔 대응 매뉴얼");
    expect(text).not.toContain(PLAYBOOK_PREFIX);
  });
});

describe("대비 훈련", () => {
  it("drills every picked department daily, each at its own hour", () => {
    const depts = ["cos", "ops", "cs", "finance", "marketing", "future", "qa", "audit"].map((id) => ({ id, name: id }));
    const drills = drillsFor(depts);
    expect(drills.map((r) => r.department)).toEqual(["ops", "cs", "finance", "marketing", "audit"]); // not 비서실, 순찰, 미래전략
    expect(drills.every((r) => !r.days)).toBe(true);
    expect(new Set(drills.map((r) => r.hourKst)).size).toBe(drills.length);
    expect(new Set(drills.map((r) => r.title)).size).toBe(drills.length);
  });

  it("tells the department what it already has, so it doesn't repeat itself", () => {
    const text = drillInstruction({ id: "ops", name: "운영팀" }, ["사진 없는 환불 요청"]);
    expect(text).toContain("- 사진 없는 환불 요청");
    expect(text).toContain("## 대응 매뉴얼");
    expect(text).toContain("### 상황:");
  });
});
