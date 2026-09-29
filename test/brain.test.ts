import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { think, resetBrainMemory, lastModelUsed, BrainBusyError, BrainQuotaError } from "../src/brain";
import { rankFlashModels } from "../src/brain/gemini";
import type { Env } from "../src/env";

const env = { GEMINI_API_KEY: "k", GEMINI_MODEL: "primary", GEMINI_FALLBACK_MODEL: "lite", BRAIN_DAILY_LIMIT: "10" } as Env;

function clientWithBudget(allowed: boolean[]) {
  const rpc = vi.fn(async () => ({ data: allowed.shift() ?? false, error: null }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function geminiReply(status: number, text = "ok") {
  return new Response(
    JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { code: status, message: "busy" } }),
    { status }
  );
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => resetBrainMemory());

describe("think", () => {
  it("falls back to the lite model when the primary is overloaded", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(geminiReply(503)).mockResolvedValueOnce(geminiReply(200, "답"));
    vi.stubGlobal("fetch", fetchMock);
    const { client, rpc } = clientWithBudget([true, true]);

    await expect(think(env, client, { system: "s", prompt: "p" })).resolves.toBe("답");
    expect(fetchMock.mock.calls[0][0]).toContain("/primary:generateContent");
    expect(fetchMock.mock.calls[1][0]).toContain("/lite:generateContent");
    expect(rpc).toHaveBeenCalledTimes(2); // each attempt is counted against the free budget
  });

  it("reports BrainBusyError when every model it tries is overloaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("pageSize=1000") ? new Response(JSON.stringify({ models: [] })) : geminiReply(503))));
    const { client } = clientWithBudget([true, true, true]);
    await expect(think(env, client, { system: "s", prompt: "p" })).rejects.toBeInstanceOf(BrainBusyError);
  });

  it("never calls Google once the daily budget is spent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { client } = clientWithBudget([false]);
    await expect(think(env, client, { system: "s", prompt: "p" })).rejects.toBeInstanceOf(BrainQuotaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("masks personal data in the prompt it sends", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiReply(200));
    vi.stubGlobal("fetch", fetchMock);
    const { client } = clientWithBudget([true]);
    await think(env, client, { system: "s", prompt: "연락처 buyer@example.com" });
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).not.toContain("buyer@example.com");
    expect(body).toContain("[이메일]");
  });

  it("asks Google for available Flash models when the configured names are gone", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("pageSize=1000")) {
        return new Response(
          JSON.stringify({
            models: [
              { name: "models/gemini-9.0-flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/gemini-9.0-flash-image", supportedGenerationMethods: ["generateContent"] },
              { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] },
            ],
          })
        );
      }
      if (url.includes("/gemini-9.0-flash:")) return geminiReply(200, "새 모델 답");
      return new Response(JSON.stringify({ error: { code: 404, message: "models/x is not found" } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { client } = clientWithBudget([true, true, true]);

    await expect(think(env, client, { system: "s", prompt: "p" })).resolves.toBe("새 모델 답");
    expect(lastModelUsed()).toBe("gemini-9.0-flash");
  });

  it("remembers the model that worked and tries it first next time", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(geminiReply(503)).mockImplementation(async () => geminiReply(200, "답"));
    vi.stubGlobal("fetch", fetchMock);
    await think(env, clientWithBudget([true, true]).client, { system: "s", prompt: "p" });
    await think(env, clientWithBudget([true]).client, { system: "s", prompt: "p" });
    expect(fetchMock.mock.calls[2][0]).toContain("/lite:generateContent");
  });
});

describe("think — Workers AI fallback", () => {
  it("uses Cloudflare Workers AI when every Gemini model is busy", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("pageSize=1000") ? new Response(JSON.stringify({ models: [] })) : geminiReply(503))));
    const run = vi.fn(async () => ({ response: "요약: 대체 두뇌 답" }));
    const { client, rpc } = clientWithBudget([true, true, true]);

    const text = await think({ ...env, AI: { run }, WORKERS_AI_MODEL: "@cf/test/model" }, client, { system: "s", prompt: "연락처 a@b.co" });
    expect(text).toBe("요약: 대체 두뇌 답");
    expect(lastModelUsed()).toBe("workers-ai:@cf/test/model");
    expect(JSON.stringify(run.mock.calls[0])).not.toContain("a@b.co"); // still masked
    expect(rpc).toHaveBeenLastCalledWith("use_brain_call", { p_provider: "workers_ai", p_limit: 80 });
  });

  it("stays on Gemini when Gemini answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply(200, "제미나이 답")));
    const run = vi.fn();
    await think({ ...env, AI: { run }, WORKERS_AI_MODEL: "@cf/test/model" }, clientWithBudget([true]).client, { system: "s", prompt: "p" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("rankFlashModels", () => {
  it("keeps text Flash models only, stable before preview, full before lite, newest first", () => {
    expect(
      rankFlashModels([
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.1-flash",
        "gemini-4.0-flash-preview",
        "gemini-3.8-flash-image",
        "gemini-3.8-flash-live",
        "gemini-3.1-pro",
      ])
    ).toEqual(["gemini-3.8-flash", "gemini-3.1-flash", "gemini-3.5-flash-lite", "gemini-4.0-flash-preview"]);
  });
});

import { retryAfterMs } from "../src/brain/gemini";
import { initiativeRotation } from "../src/company/routines";

describe("rate limits", () => {
  it("reads Google's retry hint from the message or RetryInfo", () => {
    expect(retryAfterMs({ error: { message: "Quota exceeded... Please retry in 12.989969034s." } })).toBe(12990);
    expect(retryAfterMs({ error: { details: [{ retryDelay: "40s" }] } })).toBe(40000);
    expect(retryAfterMs({})).toBe(60000);
  });

  it("skips a model whose free quota is used up and remembers it", async () => {
    const quota = () =>
      new Response(JSON.stringify({ error: { code: 429, message: "limit: 20, model: primary. Please retry in 3600s." } }), { status: 429 });
    const fetchMock = vi.fn(async (url: string) => (url.includes("/primary:") ? quota() : geminiReply(200, "라이트 답")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(think(env, clientWithBudget([true, true]).client, { system: "s", prompt: "p" })).resolves.toBe("라이트 답");
    // Next call goes straight to the model that still has quota.
    await think(env, clientWithBudget([true]).client, { system: "s", prompt: "p" });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/primary:"))).toHaveLength(1);
  });

  it("waits for the next heartbeat (busy, not failed) when every model is out of quota", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("pageSize=1000")
          ? new Response(JSON.stringify({ models: [] }))
          : new Response(JSON.stringify({ error: { code: 429, message: "Please retry in 30s" } }), { status: 429 })
      )
    );
    await expect(think(env, clientWithBudget([true, true, true]).client, { system: "s", prompt: "p" })).rejects.toBeInstanceOf(BrainBusyError);
  });
});

describe("initiativeRotation", () => {
  it("gives every department a turn over a few days, three a day", () => {
    const depts = ["a", "b", "c", "d", "e", "f", "g"];
    const seen = new Set([0, 1, 2].flatMap((day) => initiativeRotation(depts, day)));
    expect(initiativeRotation(depts, 0)).toHaveLength(3);
    expect(seen.size).toBe(7);
  });
});

describe("think — paid brain switch", () => {
  const paid = { ...env, BRAIN_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk-test", CLAUDE_DAILY_LIMIT: "5" } as Env;
  const claudeReply = (text: string, stop_reason = "end_turn") =>
    new Response(
      JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason, stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const isClaude = (url: unknown) => String(url).includes("api.anthropic.com");

  it("stays free unless switched on", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => geminiReply(200, "무료 답"));
    vi.stubGlobal("fetch", fetchMock);
    await think({ ...env, ANTHROPIC_API_KEY: "sk-test" } as Env, clientWithBudget([true]).client, { system: "s", prompt: "p" });
    expect(fetchMock.mock.calls.some(([url]) => isClaude(url))).toBe(false);
  });

  it("uses Claude first when switched on, with masked input and server-side fallbacks", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => claudeReply("유료 답"));
    vi.stubGlobal("fetch", fetchMock);
    const { client, rpc } = clientWithBudget([true]);
    await expect(think(paid, client, { system: "s", prompt: "연락처 buyer@example.com" })).resolves.toBe("유료 답");
    expect(lastModelUsed()).toBe("claude:claude-opus-5-5");
    expect(rpc).toHaveBeenCalledWith("use_brain_call", { p_provider: "claude", p_limit: 5 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.fallbacks).toBe("default");
    expect(JSON.stringify(body)).not.toContain("buyer@example.com");
  });

  it("falls back to the free brain on a Claude error, refusal or spent budget", async () => {
    for (const claude of [() => new Response("{}", { status: 500 }), () => claudeReply("", "refusal")]) {
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => (isClaude(url) ? claude() : geminiReply(200, "무료 답"))));
      await expect(think(paid, clientWithBudget([true, true]).client, { system: "s", prompt: "p" })).resolves.toBe("무료 답");
    }
    const fetchMock = vi.fn(async (_url: unknown) => geminiReply(200, "무료 답"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(think(paid, clientWithBudget([false, true]).client, { system: "s", prompt: "p" })).resolves.toBe("무료 답");
    expect(fetchMock.mock.calls.some(([url]) => isClaude(url))).toBe(false);
  });
});
