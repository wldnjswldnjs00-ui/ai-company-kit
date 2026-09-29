import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { geminiGenerate, listGeminiModels, rankFlashModels, BrainQuotaError, BrainBusyError, BrainModelMissingError, BrainRateLimitError, NO_SEARCH_NOTICE } from "./gemini";
import { maskPersonalData } from "./mask";
import { workersAiGenerate } from "./workersAi";
import { claudeGenerate, DEFAULT_CLAUDE_MODEL } from "./claude";

export { BrainQuotaError, BrainBusyError };

export type ThinkInput = { system: string; prompt: string; json?: boolean; temperature?: number; search?: boolean; images?: { mimeType: string; data: string }[] };

// The one door every department goes through to use an LLM:
//   1. personal data is masked,
//   2. the daily free-tier budget is reserved atomically in the DB,
//   3. only then is the provider called.
// When the budget is spent this throws BrainQuotaError and the task is put
// back in the queue for tomorrow — it never falls through to a paid API.
type Provider = "gemini" | "workers_ai" | "claude";
const PROVIDER_LABEL: Record<Provider, string> = { gemini: "Gemini", workers_ai: "Workers AI", claude: "Claude" };

export function dailyLimit(env: Env, provider: Provider): number {
  if (provider === "gemini") return Number(env.BRAIN_DAILY_LIMIT) || 200;
  if (provider === "workers_ai") return Number(env.WORKERS_AI_DAILY_LIMIT) || 80;
  return Number(env.CLAUDE_DAILY_LIMIT) || 50;
}

async function reserveCall(env: Env, client: SupabaseClient, provider: Provider = "gemini") {
  const limit = dailyLimit(env, provider);
  const { data: allowed, error } = await client.rpc("use_brain_call", { p_provider: provider, p_limit: limit });
  if (error) throw new Error(`두뇌 사용량 확인 실패: ${error.message}`);
  if (!allowed) throw new BrainQuotaError(`오늘 ${PROVIDER_LABEL[provider]} 사용 한도(${limit}회)를 모두 썼습니다`);
}

// The paid-brain switch. Off unless BRAIN_PROVIDER=claude and a key is set.
export function paidBrainEnabled(env: Env): boolean {
  return env.BRAIN_PROVIDER === "claude" && !!env.ANTHROPIC_API_KEY;
}

export function brainDescription(env: Env): string {
  if (paidBrainEnabled(env)) return `유료 Claude (${env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL}, 하루 ${dailyLimit(env, "claude")}회) → 실패 시 무료 두뇌`;
  if (env.BRAIN_PROVIDER === "claude") return "무료 (BRAIN_PROVIDER=claude 이지만 ANTHROPIC_API_KEY 가 없음)";
  return "무료 (Gemini → Workers AI)";
}

export async function think(env: Env, client: SupabaseClient, input: ThinkInput): Promise<string> {
  const prompt = maskPersonalData(input.prompt);

  // Paid brain first when switched on; its daily cap or any failure falls
  // through to the free brains below, so switching never stops the company.
  if (paidBrainEnabled(env)) {
    const model = env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
    try {
      await reserveCall(env, client, "claude");
      const text = await claudeGenerate(env.ANTHROPIC_API_KEY!, model, input.system, prompt, input.search, input.images);
      lastUsedLabel = `claude:${model}`;
      return text;
    } catch (err) {
      if (!(err instanceof BrainBusyError || err instanceof BrainQuotaError)) throw err;
      console.warn("유료 두뇌 건너뜀:", (err as Error).message);
    }
  }

  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 가 설정되지 않았습니다");
  const request = {
    apiKey: env.GEMINI_API_KEY,
    system: input.system,
    prompt,
    json: input.json,
    temperature: input.temperature,
    search: input.search,
    images: input.images,
  };

  // Try models in order until one answers: the last model that worked, the
  // configured ones, then whatever Flash models Google lists for this key.
  // Busy (5xx), missing (404) and quota-exhausted (429) models are skipped;
  // an exhausted model is remembered until Google says it's usable again,
  // so later calls don't waste a request on it.
  const tried = new Set<string>();
  let lastError: Error | undefined;
  let discovered = false;
  let candidates = orderedCandidates(env);
  const usable = (m: string) => !tried.has(m) && (exhaustedUntil.get(m) ?? 0) <= Date.now();

  while (tried.size < MAX_MODEL_ATTEMPTS) {
    let model = candidates.find(usable);
    if (!model && !discovered) {
      discovered = true;
      candidates = [...candidates, ...(await discoveredModels(env.GEMINI_API_KEY))];
      model = candidates.find(usable);
    }
    if (!model) break;
    tried.add(model);

    await reserveCall(env, client);
    try {
      const text = await geminiGenerate({ ...request, model });
      lastWorkingModel = model;
      lastUsedLabel = model;
      return text;
    } catch (err) {
      if (err instanceof BrainRateLimitError) exhaustedUntil.set(model, Date.now() + err.retryAfterMs);
      else if (!(err instanceof BrainBusyError || err instanceof BrainModelMissingError)) throw err;
      lastError = err as Error;
      if (model === lastWorkingModel) lastWorkingModel = undefined;
    }
  }
  // Every Gemini model busy, gone or out of quota: hand the same (already
  // masked) request to Cloudflare's own free models before giving up.
  if (env.AI && env.WORKERS_AI_MODEL) {
    try {
      await reserveCall(env, client, "workers_ai");
      const text = await workersAiGenerate(env.AI, env.WORKERS_AI_MODEL, request.system, request.prompt);
      lastUsedLabel = `workers-ai:${env.WORKERS_AI_MODEL}`;
      const notices = [input.search ? NO_SEARCH_NOTICE : "", input.images?.length ? NO_IMAGE_NOTICE : ""].join("");
      return `${text}${notices}`;
    } catch (err) {
      if (!(err instanceof BrainBusyError || err instanceof BrainQuotaError)) throw err;
      lastError = err;
    }
  }
  if (lastError instanceof BrainModelMissingError) {
    throw new Error(`사용할 수 있는 Gemini 모델을 찾지 못했습니다 (${[...tried].join(", ")}). ${lastError.message}`);
  }
  // Out of free quota everywhere: wait for the next heartbeat (a model's
  // per-minute quota refills quickly; a per-day one is skipped until it does).
  if (lastError instanceof BrainRateLimitError) throw new BrainBusyError(`무료 한도 대기 중 — ${lastError.message}`);
  throw lastError ?? new BrainBusyError("Gemini 응답 없음");
}

const NO_IMAGE_NOTICE = "\n\n> ⚠️ 대체 두뇌가 답해서 화면 캡처는 보지 못했습니다. 글자와 오류 기록만으로 판단했습니다.";

const MAX_MODEL_ATTEMPTS = 4;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

// Per-isolate memory: Workers reuse isolates across requests, so this saves
// a model-list call and a failed first attempt most of the time. Losing it
// (new isolate) only costs one extra try.
let lastWorkingModel: string | undefined;
let lastUsedLabel: string | undefined;
let discoveryCache: { at: number; models: string[] } | undefined;
const exhaustedUntil = new Map<string, number>();

function orderedCandidates(env: Env): string[] {
  return [lastWorkingModel, env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(
    (m, i, all): m is string => !!m && all.indexOf(m) === i
  );
}

async function discoveredModels(apiKey: string): Promise<string[]> {
  if (!discoveryCache || Date.now() - discoveryCache.at > DISCOVERY_TTL_MS) {
    discoveryCache = { at: Date.now(), models: rankFlashModels(await listGeminiModels(apiKey)) };
  }
  return discoveryCache.models;
}

export function lastModelUsed(): string | undefined {
  return lastUsedLabel;
}

// Test hook: isolates are long-lived in tests too.
export function resetBrainMemory() {
  lastWorkingModel = undefined;
  lastUsedLabel = undefined;
  discoveryCache = undefined;
  exhaustedUntil.clear();
}

// LLMs sometimes wrap JSON in ```json fences even when asked not to.
export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as T;
}
