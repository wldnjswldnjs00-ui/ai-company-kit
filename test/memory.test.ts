import { describe, it, expect } from "vitest";
import { extractLessons, formatMemory, formatProfile, type Knowledge } from "../src/company/memory";
import { companyCharter, INITIATIVE_INSTRUCTION } from "../src/company/charter";
const COMPANY_CHARTER = companyCharter();
import { parseJsonLoose } from "../src/brain";

const k = (over: Partial<Knowledge>): Knowledge => ({
  id: "1",
  department: "ops",
  kind: "lesson",
  content: "c",
  weight: 1,
  source_task: null,
  active: true,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("extractLessons", () => {
  const report = `## 결론
- 결론 문장
## 배운 점
- 판매자 모집은 첫 등록 과정이 짧을수록 전환이 높았다
- 없음
* 분쟁의 60%는 배송 지연에서 시작된다는 데이터가 있었다
## 기타
- 이건 배운 점이 아니다`;

  it("takes only bullet lines from the 배운 점 section", () => {
    expect(extractLessons(report)).toEqual([
      "판매자 모집은 첫 등록 과정이 짧을수록 전환이 높았다",
      "분쟁의 60%는 배송 지연에서 시작된다는 데이터가 있었다",
    ]);
  });

  it("returns nothing when the section is missing or says 없음", () => {
    expect(extractLessons("## 결론\n- a")).toEqual([]);
    expect(extractLessons("## 배운 점\n- 없음")).toEqual([]);
  });

  it("keeps at most three lessons per task", () => {
    const many = "## 배운 점\n" + Array.from({ length: 6 }, (_, i) => `- 확인된 사실 번호 ${i} 입니다`).join("\n");
    expect(extractLessons(many)).toHaveLength(3);
  });
});

describe("formatMemory / formatProfile", () => {
  it("labels CEO feedback and shows reinforcement", () => {
    const text = formatMemory([k({ kind: "feedback", content: "추측 금지", weight: 5 }), k({ content: "교훈 하나" })]);
    expect(text).toContain("(CEO 피드백 ×5) 추측 금지");
    expect(text).toContain("(교훈) 교훈 하나");
  });

  it("is empty when there is nothing to remember", () => {
    expect(formatMemory([])).toBe("");
    expect(formatProfile(null)).toBe("");
  });
});

describe("charter", () => {
  it("asks every report for lessons and to obey CEO decisions", () => {
    expect(COMPANY_CHARTER).toContain("## 배운 점");
    expect(COMPANY_CHARTER).toContain("거절된 제안은 다시 하지 않는다");
  });

  it("initiative output format is valid JSON as documented", () => {
    const example = INITIATIVE_INSTRUCTION.slice(INITIATIVE_INSTRUCTION.indexOf("{"));
    expect(() => parseJsonLoose(example)).not.toThrow();
  });
});

import { extractSection, DEV_REQUEST_HEADING } from "../src/company/memory";

describe("extractSection (개발 요청서)", () => {
  const report = `## 결론
결제 실패율이 높다.
## 개발 요청서
1) 결제 승인 API 에 재시도 추가
2) 근거: 실패 12건 중 9건이 타임아웃
### 완료 기준
- 테스트 통과
## 배운 점
- 없음`;

  it("takes everything from the heading to the next top-level section", () => {
    const section = extractSection(report, DEV_REQUEST_HEADING);
    expect(section).toContain("재시도 추가");
    expect(section).toContain("### 완료 기준"); // sub-headings stay inside
    expect(section).not.toContain("배운 점");
  });

  it("returns null when there is no request", () => {
    expect(extractSection("## 결론\n코드 변경 불필요", DEV_REQUEST_HEADING)).toBeNull();
  });
});
