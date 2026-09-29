import Anthropic from "@anthropic-ai/sdk";
import { BrainBusyError, formatSources, NO_SEARCH_NOTICE } from "./gemini";

// 유료 두뇌(Claude). Dormant: only used when BRAIN_PROVIDER=claude and
// ANTHROPIC_API_KEY is set. Any failure here is thrown as BrainBusyError so
// think() quietly carries on with the free brains.

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

export async function claudeGenerate(apiKey: string, model: string, system: string, prompt: string, search = false, images: { mimeType: string; data: string }[] = []): Promise<string> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      // A safety decline is retried server-side on a suitable model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mimeType as "image/jpeg", data: i.data } })),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
      // Server-side web search, for work that must reflect the latest facts.
      ...(search ? { tools: [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 5 }] } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new BrainBusyError("Claude API 키가 올바르지 않습니다 (ANTHROPIC_API_KEY)");
    if (err instanceof Anthropic.RateLimitError) throw new BrainBusyError("Claude 사용량 한도에 걸림");
    if (err instanceof Anthropic.APIError) throw new BrainBusyError(`Claude API 오류 ${err.status}: ${err.message}`);
    throw new BrainBusyError(`Claude 연결 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (response.stop_reason === "refusal") {
    throw new BrainBusyError(`Claude 가 답변을 거절함 (${response.stop_details?.category ?? "사유 없음"})`);
  }
  const textBlocks = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  const text = textBlocks.map((b) => b.text).join("");
  if (!text.trim()) throw new BrainBusyError("Claude 가 빈 응답을 반환함");
  if (!search) return text;
  const cited = textBlocks.flatMap((b) => b.citations ?? []).flatMap((c) => (c.type === "web_search_result_location" ? [{ uri: c.url, title: c.title ?? undefined }] : []));
  const sources = formatSources(cited);
  return sources ? `${text}\n\n${sources}` : `${text}${NO_SEARCH_NOTICE}`;
}
