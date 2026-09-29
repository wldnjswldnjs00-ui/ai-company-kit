import { BrainBusyError } from "./gemini";

// Cloudflare Workers AI — the second free brain, used only when every Gemini
// model is busy. It runs inside Cloudflare (no key, no signup) and is covered
// by the Workers Free plan's daily allocation; on the free plan an exhausted
// allocation makes calls fail rather than bill anything.
type AiRunner = { run(model: string, input: unknown): Promise<unknown> };

export async function workersAiGenerate(ai: unknown, model: string, system: string, prompt: string): Promise<string> {
  let result: unknown;
  try {
    result = await (ai as AiRunner).run(model, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: 4096,
      temperature: 0.4,
    });
  } catch (err) {
    throw new BrainBusyError(`Workers AI 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Models differ: most return { response }, OpenAI-style ones return choices.
  const r = result as { response?: unknown; choices?: { message?: { content?: string } }[] };
  const text =
    typeof r.response === "string" ? r.response : r.response !== undefined ? JSON.stringify(r.response) : r.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new BrainBusyError("Workers AI 가 빈 응답을 반환함");
  return text;
}
