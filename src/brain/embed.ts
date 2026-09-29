import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { maskPersonalData } from "./mask";

// Turns text into a meaning vector (1024 numbers) with Cloudflare Workers
// AI's free multilingual model, so the company's memory can be searched by
// meaning ("판매자 모집" finds "셀러 유치"), not just by exact words.
//
// Memory must never block work: without the AI binding, over budget or on
// any error this returns null and callers fall back to recency ordering.
export const EMBED_MODEL = "@cf/baai/bge-m3";
export const EMBED_DIMENSIONS = 1024;

type AiRunner = { run(model: string, input: unknown): Promise<{ data?: number[][] }> };

export async function embed(env: Env, client: SupabaseClient, texts: string[]): Promise<number[][] | null> {
  if (!env.AI || texts.length === 0) return null;
  const limit = Number(env.EMBED_DAILY_LIMIT) || 400;
  const { data: allowed } = await client.rpc("use_brain_call", { p_provider: "embed", p_limit: limit });
  if (!allowed) return null;
  try {
    const res = await (env.AI as AiRunner).run(EMBED_MODEL, { text: texts.map((t) => maskPersonalData(t).slice(0, 4000)) });
    const vectors = res.data ?? [];
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBED_DIMENSIONS)) return null;
    return vectors;
  } catch (err) {
    console.error("embed failed", err);
    return null;
  }
}

// pgvector accepts its text form: "[0.1,0.2,...]".
export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
