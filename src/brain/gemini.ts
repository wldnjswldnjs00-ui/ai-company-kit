// Google Gemini REST API (free tier). Only one function talks to Google, so
// swapping the brain for Claude later is a change to src/brain/index.ts only.
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class BrainQuotaError extends Error {}
// Google's side is temporarily overloaded or erroring (5xx). Not the task's
// fault and not our quota — the task simply waits for the next heartbeat.
export class BrainBusyError extends Error {}
// The model id doesn't exist or isn't offered to this key (404/400 on the
// model name) — Google renames and retires models often, so try another.
export class BrainModelMissingError extends Error {}
// This one model's free quota is used up (429). Other models have their own
// quotas, so the caller moves on; retryAfterMs says when this one is usable.
export class BrainRateLimitError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
  }
}

// Google says "Please retry in 12.98s" in the message and/or a RetryInfo
// detail with retryDelay "13s". Without either, assume a minute.
export function retryAfterMs(body: { error?: { message?: string; details?: { retryDelay?: string }[] } }): number {
  const fromDetail = body.error?.details?.find((d) => d.retryDelay)?.retryDelay?.match(/([\d.]+)s/)?.[1];
  const fromMessage = body.error?.message?.match(/retry in ([\d.]+)\s*s/i)?.[1];
  const seconds = Number(fromDetail ?? fromMessage);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 60_000;
}

export type GeminiRequest = {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  // Look things up on Google first (grounding) — for work that must reflect
  // the latest facts, like laws. The sources are appended to the answer.
  search?: boolean;
  // Screenshots etc. for the model to look at (base64).
  images?: { mimeType: string; data: string }[];
};

type GroundingChunk = { web?: { uri?: string; title?: string } };
type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string; groundingMetadata?: { groundingChunks?: GroundingChunk[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { code: number; message: string; status?: string; details?: { retryDelay?: string }[] };
};

export async function geminiGenerate(req: GeminiRequest): Promise<string> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(req.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": req.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [...(req.images ?? []).map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.data } })), { text: req.prompt }] }],
      ...(req.search && !req.json ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (res.status === 429) {
    throw new BrainRateLimitError(`${req.model} 무료 한도 소진: ${(body.error?.message ?? "429").split("\n")[0].slice(0, 200)}`, retryAfterMs(body));
  }
  if (res.status >= 500) throw new BrainBusyError(`Gemini 일시 과부하 ${res.status}: ${body.error?.message ?? ""}`);
  if (res.status === 404 || (res.status === 400 && /model/i.test(body.error?.message ?? ""))) {
    throw new BrainModelMissingError(`모델 ${req.model} 사용 불가: ${body.error?.message ?? res.status}`);
  }
  // A model without search support: answer without it, and say so.
  if (req.search && res.status === 400 && /(search|tool|grounding)/i.test(body.error?.message ?? "")) {
    return `${await geminiGenerate({ ...req, search: false })}${NO_SEARCH_NOTICE}`;
  }
  if (!res.ok) throw new Error(`Gemini 오류 ${res.status}: ${body.error?.message ?? "알 수 없음"}`);
  if (body.promptFeedback?.blockReason) throw new Error(`Gemini 가 요청을 거절함: ${body.promptFeedback.blockReason}`);

  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) throw new Error(`Gemini 가 빈 응답을 반환함 (${body.candidates?.[0]?.finishReason ?? "원인 불명"})`);
  if (!req.search) return text;
  const sources = formatSources((body.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c) => c.web ?? {}));
  return sources ? `${text}\n\n${sources}` : `${text}${NO_SEARCH_RESULT_NOTICE}`;
}

export const NO_SEARCH_NOTICE = "\n\n> ⚠️ 이번 답변은 최신 검색 없이 작성됐습니다. 법령·제도가 바뀌었을 수 있으니 확인이 필요합니다.";
const NO_SEARCH_RESULT_NOTICE = "\n\n> ⚠️ 검색은 했지만 인용할 출처를 받지 못했습니다. 최신 여부 확인이 필요합니다.";

// "## 검색 출처" list, deduplicated by title/URL, at most 8 lines.
export function formatSources(items: { uri?: string; title?: string }[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { uri, title } of items) {
    if (!uri || seen.has(title ?? uri)) continue;
    seen.add(title ?? uri);
    lines.push(`- [${(title ?? uri).replace(/[\[\]]/g, "")}](${uri})`);
    if (lines.length >= 8) break;
  }
  return lines.length ? `## 검색 출처 (${new Date().toISOString().slice(0, 10)} 기준)\n${lines.join("\n")}` : "";
}

// Asks Google which models this API key can actually use right now, so the
// company never depends on a hard-coded model name that Google has retired.
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}?pageSize=1000`, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  return (body.models ?? [])
    .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => (m.name as string).replace(/^models\//, ""));
}

const EXCLUDED = /(image|tts|live|audio|embed|native|vision|robotics|computer|learnlm|gemma)/i;

function version(name: string): number {
  const m = name.match(/gemini-(\d+)(?:\.(\d+))?/);
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
}

// Text-capable Flash models, best first: stable Flash, stable Flash-Lite,
// then preview/experimental ones; newest version first within each group.
export function rankFlashModels(names: string[]): string[] {
  const group = (n: string) => (/(preview|exp)/i.test(n) ? 2 : 0) + (/lite/i.test(n) ? 1 : 0);
  return names
    .filter((n) => /flash/i.test(n) && !EXCLUDED.test(n))
    .sort((a, b) => group(a) - group(b) || version(b) - version(a) || a.localeCompare(b));
}
