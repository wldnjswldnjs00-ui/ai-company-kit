import { describe, it, expect } from "vitest";
import { maskPersonalData } from "../src/brain/mask";
import { parseJsonLoose } from "../src/brain";
import { splitReport, systemPromptFor } from "../src/company/charter";
import { parseCeoMessage, titleFrom } from "../src/company/orders";
import { renderMarkdown } from "../src/markdown";
import { issueSession, verifySession, secretEquals } from "../src/auth";
import { kstNow } from "../src/company/routines";
import type { Department } from "../src/db";

const dept = (id: string, name: string): Department => ({ id, name, emoji: "", mission: "m", goals: "", sort: 0, updated_at: "" });
const DEPTS = [dept("cos", "비서실"), dept("ops", "운영팀"), dept("finance", "재무팀"), dept("marketing", "마케팅팀")];

describe("maskPersonalData", () => {
  it("masks emails, phone numbers and bank accounts before they reach the LLM, but keeps dates", () => {
    const out = maskPersonalData(`연락처 customer@example.com, 010-1234-5678, 입금 계좌 110-123-456789, 주문일 2026-09-30`);
    expect(out).not.toContain("customer@example.com");
    expect(out).not.toContain("010-1234-5678");
    expect(out).not.toContain("110-123-456789");
    expect(out).toContain("[이메일]");
    expect(out).toContain("[전화번호]");
    expect(out).toContain("[계좌번호]");
    expect(out).toContain("2026-09-30");
  });

  it("leaves ordinary numbers and dates alone", () => {
    expect(maskPersonalData("주문 12건, 거래액 340만 원, 2026-09-28")).toBe("주문 12건, 거래액 340만 원, 2026-09-28");
  });
});

describe("parseJsonLoose", () => {
  it("accepts JSON wrapped in a code fence", () => {
    expect(parseJsonLoose<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe("splitReport", () => {
  it("takes the summary from the first line", () => {
    expect(splitReport("요약: 신규 고객 모집은 3단계로 한다.\n## 결론\n본문")).toEqual({ summary: "신규 고객 모집은 3단계로 한다.", body: "## 결론\n본문" });
  });

  it("tolerates bold markers around the label", () => {
    expect(splitReport("**요약**: 끝\n본문").summary).toBe("끝");
  });

  it("falls back to the start of the text when the format is ignored", () => {
    const r = splitReport("## 결론\n그냥 본문만 있음");
    expect(r.body).toBe("## 결론\n그냥 본문만 있음");
    expect(r.summary).toContain("그냥 본문만 있음");
  });
});

describe("systemPromptFor", () => {
  it("includes the charter, the job description and the CEO's goals", () => {
    const p = systemPromptFor({ id: "marketing", name: "마케팅팀", mission: "가치로 알린다", goals: "- 신규 고객 100명" });
    expect(p).toContain("사실만 말한다");
    expect(p).toContain("콘텐츠 원칙");
    expect(p).toContain("- 신규 고객 100명");
  });
});

describe("parseCeoMessage", () => {
  it("sends plain text to 비서실", () => {
    expect(parseCeoMessage("신규 고객 모집 계획 세워줘", DEPTS)).toEqual({ kind: "order", department: "cos", instruction: "신규 고객 모집 계획 세워줘" });
  });

  it("routes /지시 to the named department, with short names", () => {
    expect(parseCeoMessage("/지시 마케팅 카드뉴스 만들어줘", DEPTS)).toEqual({ kind: "order", department: "marketing", instruction: "카드뉴스 만들어줘" });
    expect(parseCeoMessage("/지시 재무 수수료 분석", DEPTS)).toMatchObject({ department: "finance" });
    expect(parseCeoMessage("/지시 운영 분쟁 정리", DEPTS)).toMatchObject({ department: "ops" });
  });

  it("reports an unknown department instead of guessing", () => {
    expect(parseCeoMessage("/지시 홍보부 뭔가 해줘", DEPTS)).toEqual({ kind: "unknown_department", name: "홍보부" });
  });

  it("knows the patrol and status commands", () => {
    expect(parseCeoMessage("/순찰", DEPTS)).toEqual({ kind: "patrol" });
    expect(parseCeoMessage("/status", DEPTS)).toEqual({ kind: "help" }); // no shop commands in the kit
  });

  it("shows help for unknown commands and bare /지시", () => {
    expect(parseCeoMessage("/뭐지", DEPTS)).toEqual({ kind: "help" });
    expect(parseCeoMessage("/지시 마케팅", DEPTS)).toEqual({ kind: "help" });
  });
});

describe("titleFrom", () => {
  it("uses the first line, capped", () => {
    expect(titleFrom("첫 줄\n둘째 줄")).toBe("첫 줄");
    expect(titleFrom("가".repeat(50))).toBe(`${"가".repeat(40)}…`);
  });
});

describe("renderMarkdown", () => {
  it("never lets raw HTML or script links from an LLM report through", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("still renders normal markdown", () => {
    expect(renderMarkdown("## 결론\n- 하나")).toContain("<h2");
    expect(renderMarkdown("[a](https://example.com)")).toContain('href="https://example.com"');
  });
});

describe("session", () => {
  it("accepts its own token and rejects tampered or expired ones", async () => {
    const now = Date.UTC(2026, 8, 28);
    const token = await issueSession("s3cret", now);
    expect(await verifySession("s3cret", token, now)).toBe(true);
    expect(await verifySession("other", token, now)).toBe(false);
    expect(await verifySession("s3cret", token.replace(/.$/, (ch) => (ch === "0" ? "1" : "0")), now)).toBe(false);
    expect(await verifySession("s3cret", token, now + 31 * 24 * 3600e3)).toBe(false);
  });

  it("secretEquals never matches an unset secret", async () => {
    expect(await secretEquals("", "")).toBe(false);
    expect(await secretEquals("a", undefined)).toBe(false);
    expect(await secretEquals("a", "a")).toBe(true);
  });
});

describe("kstNow", () => {
  it("computes the KST day and hour", () => {
    // 2026-09-28 23:30 UTC = 2026-09-29 08:30 KST (Tuesday)
    const r = kstNow(new Date("2026-09-28T23:30:00Z"));
    expect(r.hour).toBe(8);
    expect(r.day).toBe(2);
    expect(r.dateStartUtc.toISOString()).toBe("2026-09-28T15:00:00.000Z");
  });
});

import { supabaseUrl, cleanSetting } from "../src/db";

describe("supabaseUrl", () => {
  it("cleans the usual copy-paste accidents", () => {
    expect(supabaseUrl("  https://abc.supabase.co/ \n")).toBe("https://abc.supabase.co");
    expect(supabaseUrl('"https://abc.supabase.co"')).toBe("https://abc.supabase.co");
    expect(supabaseUrl("SUPABASE_URL=https://abc.supabase.co")).toBe("https://abc.supabase.co");
    expect(supabaseUrl("https://abc.supabase.co/rest/v1")).toBe("https://abc.supabase.co");
    expect(supabaseUrl("abc.supabase.co")).toBe("https://abc.supabase.co");
  });

  it("explains what to paste when the value is something else entirely", () => {
    expect(() => supabaseUrl("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres")).toThrow(/Project URL/);
    expect(() => supabaseUrl("")).toThrow(/Project URL/);
  });

  it("cleanSetting strips quotes and a NAME= prefix", () => {
    expect(cleanSetting(" 'sb_secret_x' ", "SUPABASE_SECRET_KEY")).toBe("sb_secret_x");
    expect(cleanSetting("SUPABASE_SECRET_KEY=sb_secret_x", "SUPABASE_SECRET_KEY")).toBe("sb_secret_x");
  });
});

import { cleanEnv, type Env } from "../src/env";

describe("cleanEnv", () => {
  it("trims every string setting", () => {
    const env = cleanEnv({ TELEGRAM_CEO_CHAT_ID: " 12345\n", TELEGRAM_BOT_TOKEN: '"1:abc"', GEMINI_MODEL: "gemini-flash-latest" } as unknown as Env);
    expect(env.TELEGRAM_CEO_CHAT_ID).toBe("12345");
    expect(env.TELEGRAM_BOT_TOKEN).toBe("1:abc");
    expect(env.GEMINI_MODEL).toBe("gemini-flash-latest");
  });
});

describe("commands", () => {
  it("parses /check and /연결", () => {
    expect(parseCeoMessage("/check", DEPTS)).toEqual({ kind: "check" });
    expect(parseCeoMessage("/연결", DEPTS)).toEqual({ kind: "check" });
  });
});

import { parseActionItems } from "../src/company/worker";

describe("meetings", () => {
  it("opens a meeting from /회의 or a spoken '회의 …'", () => {
    expect(parseCeoMessage("/회의 신규 고객 모집 전략", DEPTS)).toEqual({ kind: "meeting", topic: "신규 고객 모집 전략" });
    expect(parseCeoMessage("회의 다음 달 목표", DEPTS)).toEqual({ kind: "meeting", topic: "다음 달 목표" });
    expect(parseCeoMessage("/회의", DEPTS)).toEqual({ kind: "meeting", topic: "(안건 자율)" }); // departments raise the agenda
    // A sentence that merely starts with 회의 as a noun stays an order.
    expect(parseCeoMessage("회의록 정리해줘", DEPTS)).toMatchObject({ kind: "order" });
  });

  it("turns 실행 항목 lines into proposals for known departments only", () => {
    const body = `## 실행 항목
- [marketing] 신규 고객 모집 카드뉴스 | 5장짜리 카드뉴스 초안 | 고객 문의 증가
- [ops] 금지품목 점검 | 신규 상품 금지품목 재검사 | 사고 예방
- [unknown] 무시될 항목 | 내용 | 효과
## 배운 점
- 없음`;
    const items = parseActionItems(body, ["marketing", "ops"]);
    expect(items.map((i) => i.department)).toEqual(["marketing", "ops"]);
    expect(items[0].draft).toMatchObject({ title: "신규 고객 모집 카드뉴스", proposal: "5장짜리 카드뉴스 초안", impact: "고객 문의 증가" });
  });
});

describe("maskPersonalData — Korean numbers", () => {
  it("never leaves the tail of an account number, and still tells phones apart", () => {
    const out = maskPersonalData("계좌 1002-123-456789, 우리 123456-01-123456, 매장 02-123-4567, 휴대폰 010-9876-5432, 날짜 2026-09-30");
    expect(out).toBe("계좌 [계좌번호], 우리 [계좌번호], 매장 [전화번호], 휴대폰 [전화번호], 날짜 2026-09-30");
  });
});
