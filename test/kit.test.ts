import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { derivedSecrets, hydrate } from "../src/settings";
import { companyCharter, systemPromptFor, setCompany, DEFAULT_COMPANY } from "../src/company/charter";
import { CATALOG, installDepartments, searchesWeb, seedsFor } from "../src/company/departments";
import { laterReminders } from "../src/company/reminders";
import { planVisits, findRawKeys, hasHardProblems, type PageCheck } from "../src/company/patrol";
import { geminiGenerate, formatSources, NO_SEARCH_NOTICE } from "../src/brain/gemini";
import type { Env } from "../src/env";

afterEach(() => {
  vi.unstubAllGlobals();
  setCompany(DEFAULT_COMPANY);
});

const baseEnv = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x", GEMINI_MODEL: "m", BRAIN_DAILY_LIMIT: "200", DASHBOARD_PASSWORD: "pw", TELEGRAM_BOT_TOKEN: "1:abc" } as Env;

function settingsClient(rows: { key: string; value: string }[] | null) {
  return { from: () => ({ select: async () => (rows ? { data: rows, error: null } : { data: null, error: { message: "relation does not exist" } }) }) } as unknown as SupabaseClient;
}

describe("the buyer types five values; the rest is derived or saved", () => {
  it("derives stable session and webhook secrets Telegram accepts", async () => {
    const a = await derivedSecrets(baseEnv);
    const b = await derivedSecrets(baseEnv);
    expect(a).toEqual(b);
    expect(a.webhook).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect((await derivedSecrets({ ...baseEnv, DASHBOARD_PASSWORD: "other" })).session).not.toBe(a.session); // new password logs everyone out
  });

  it("fills the CEO chat, dashboard address and website from the setup screen", async () => {
    const { env } = await hydrate(baseEnv, settingsClient([
      { key: "ceoChatId", value: "42" },
      { key: "publicBaseUrl", value: "https://hq.example.workers.dev/" },
      { key: "websiteUrl", value: "https://shop.example.com" },
      { key: "company", value: JSON.stringify({ name: "봄날베이커리", business: "수제 빵집" }) },
    ]));
    expect(env.TELEGRAM_CEO_CHAT_ID).toBe("42");
    expect(env.PUBLIC_BASE_URL).toBe("https://hq.example.workers.dev");
    expect(env.WEBSITE_URL).toBe("https://shop.example.com");
    expect(env.SESSION_SECRET).toBeTruthy();
    expect(companyCharter()).toContain("봄날베이커리");
  });

  it("still works before setup.sql is run, and lets hand-set values win", async () => {
    const { env, settings } = await hydrate({ ...baseEnv, TELEGRAM_CEO_CHAT_ID: "7" }, settingsClient(null));
    expect(settings).toBeNull();
    expect(env.TELEGRAM_CEO_CHAT_ID).toBe("7");
  });
});

describe("company-generic charter and departments", () => {
  it("builds the charter from what the buyer wrote", () => {
    setCompany({ name: "봄날베이커리", business: "동네 수제 빵집", stage: "문 연 지 1년", rules: "할인 경쟁은 하지 않는다" }, "9월 매출 1,850만 원");
    const c = companyCharter();
    expect(c).toContain("동네 수제 빵집");
    expect(c).toContain("할인 경쟁은 하지 않는다");
    expect(c).toContain("9월 매출 1,850만 원");
  });

  it("uses the department's own job when the buyer rewrote it", () => {
    expect(systemPromptFor({ id: "marketing", name: "마케팅팀", mission: "m", goals: "", job: "[직무: 우리식 마케팅]" })).toContain("[직무: 우리식 마케팅]");
    expect(systemPromptFor({ id: "marketing", name: "마케팅팀", mission: "m", goals: "" })).toContain("콘텐츠 원칙");
  });

  it("offers a catalog with 비서실 always installed and never overwrites edits", async () => {
    expect(CATALOG[0].id).toBe("cos");
    expect(new Set(CATALOG.map((d) => d.id)).size).toBe(CATALOG.length);
    expect(searchesWeb("legal")).toBe(true);
    expect(seedsFor("cs").length).toBeGreaterThan(0);
    const upsert = vi.fn(async () => ({ error: null }));
    await installDepartments({ from: () => ({ upsert }) } as unknown as SupabaseClient, ["marketing"]);
    const [rows, opts] = upsert.mock.calls[0] as unknown as [{ id: string }[], unknown];
    expect(rows.map((r) => r.id)).toEqual(["cos", "marketing"]);
    expect(opts).toEqual({ onConflict: "id", ignoreDuplicates: true });
  });

  it("reminds about the paid brain only when the free one keeps running out", () => {
    expect(laterReminders({ quotaDays7: 1, paidBrainOn: false })).toEqual([]);
    expect(laterReminders({ quotaDays7: 3, paidBrainOn: false }).map((i) => i.key)).toEqual(["paid-brain"]);
    expect(laterReminders({ quotaDays7: 5, paidBrainOn: true })).toEqual([]);
  });
});

describe("website patrol", () => {
  it("visits one page per section of the site, never leaving it", () => {
    const visits = planVisits("https://shop.example.com", [
      "https://shop.example.com/menu",
      "https://shop.example.com/menu/bread",
      "/about",
      "https://shop.example.com/about#team",
      "https://other.example/x",
      "https://shop.example.com/photo.jpg",
      "https://shop.example.com/",
    ]);
    expect(visits.map((v) => v.url)).toEqual(["https://shop.example.com/menu", "https://shop.example.com/about"]);
  });

  it("spots leftover template keys and hard problems", () => {
    expect(findRawKeys("장바구니 cart.addItem 담기 shop.example.com")).toEqual(["cart.addItem"]);
    const ok: PageCheck = { step: "첫 화면", url: "u", status: 200, loadMs: 1000, title: "t", consoleErrors: [], failedRequests: [], brokenImages: 0, rawKeys: [], text: "" };
    expect(hasHardProblems([ok])).toBe(false);
    expect(hasHardProblems([{ ...ok, status: 500 }])).toBe(true);
  });
});

describe("법무팀·미래전략팀 search before answering", () => {
  it("asks Gemini to search and appends the sources", async () => {
    const fetchMock = vi.fn(async (_u: unknown, _i?: RequestInit) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "답" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://law.go.kr/a", title: "법" } }] } }] }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const text = await geminiGenerate({ apiKey: "k", model: "m", system: "s", prompt: "p", search: true });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).tools).toEqual([{ google_search: {} }]);
    expect(text).toContain("## 검색 출처");
    expect(formatSources([])).toBe("");
    expect(NO_SEARCH_NOTICE).toContain("확인이 필요");
  });
});
