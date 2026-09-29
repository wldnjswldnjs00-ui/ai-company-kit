import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

// Card-news background images with Cloudflare Workers AI (Flux schnell,
// free allocation). Image models draw Korean text badly, so prompts ask for
// no lettering: the copy is laid over the image by whoever designs the card.
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const DAILY_LIMIT = 15;

type AiRunner = { run(model: string, input: unknown): Promise<{ image?: string }> };

export function withNoText(prompt: string): string {
  return /no text/i.test(prompt) ? prompt : `${prompt.replace(/[.\s]+$/, "")}. No text, no letters, no words, no logos.`;
}

export async function generateImage(env: Env, client: SupabaseClient, prompt: string): Promise<Uint8Array | null> {
  if (!env.AI) return null;
  const { data: allowed } = await client.rpc("use_brain_call", { p_provider: "image", p_limit: DAILY_LIMIT });
  if (!allowed) return null;
  try {
    const { image } = await (env.AI as AiRunner).run(IMAGE_MODEL, { prompt: withNoText(prompt).slice(0, 2000), steps: 6 });
    if (!image) return null;
    const binary = atob(image);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (err) {
    console.error("image generation failed", err);
    return null;
  }
}
