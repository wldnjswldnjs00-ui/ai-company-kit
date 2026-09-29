import { describe, it, expect } from "vitest";
import { followupButtons, nextStepInstruction, applyInstruction } from "../src/company/followup";

describe("after a result the CEO likes", () => {
  it("offers 좋아요 and 다음 단계 buttons that fit Telegram's 64-byte limit", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const buttons = followupButtons(id).flat();
    expect(buttons.map((b) => b.callback_data)).toEqual([`hq:good:${id}`, `hq:next:${id}`, `hq:apply:${id}`]);
    expect(buttons.every((b) => new TextEncoder().encode(b.callback_data).length <= 64)).toBe(true);
  });

  it("asks the same department for the finished deliverable, never for outside actions", () => {
    const text = nextStepInstruction({ title: "판매자 모집 계획", summary: "3단계로 모집", result_md: "## 다음 행동 제안\n- 모집 글 작성" });
    expect(text).toContain("판매자 모집 계획");
    expect(text).toContain("- 모집 글 작성");
    expect(text).toContain("[결재 필요]");
    expect(text).toContain("외부에 게시하는 일은 하지 않는다");
  });

  it("turns any department's result into a self-contained request or checklist", () => {
    const text = applyInstruction({ title: "출시용 FAQ", summary: "10문항", result_md: "Q. 환불은? A. 7일 안에" }, "고객지원팀");
    expect(text).toContain("고객지원팀");
    expect(text).toContain("## 개발 요청서");
    expect(text).toContain("Q. 환불은? A. 7일 안에");
    expect(text).toContain("받는 사람은 이 보고서를 보지 못한다");
    expect(text).toContain("체크리스트"); // non-software work becomes steps a person can follow
  });
});
