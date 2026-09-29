import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

// Voice messages → text with Cloudflare Workers AI Whisper (free, no key).
// Telegram voice notes are OGG/Opus; the turbo model decodes them from
// base64. If it refuses, the original Whisper model (raw bytes) is tried.
const MAX_VOICE_SECONDS = 300;
const MAX_VOICE_BYTES = 10 * 1024 * 1024;

type AiRunner = { run(model: string, input: unknown): Promise<{ text?: string }> };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export async function transcribeVoice(env: Env, client: SupabaseClient, fileId: string, durationSec: number): Promise<string> {
  if (!env.AI) throw new Error("음성 인식(Workers AI)을 쓸 수 없습니다");
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN 이 없습니다");
  if (durationSec > MAX_VOICE_SECONDS) throw new Error(`음성은 ${MAX_VOICE_SECONDS / 60}분까지만 받습니다`);

  const { data: allowed } = await client.rpc("use_brain_call", { p_provider: "whisper", p_limit: 60 });
  if (!allowed) throw new Error("오늘 음성 인식 한도(60회)를 다 썼습니다. 글로 보내 주세요.");

  const fileRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileBody = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string; file_size?: number } };
  const path = fileBody.result?.file_path;
  if (!fileBody.ok || !path) throw new Error("텔레그램에서 음성 파일을 받지 못했습니다");
  if ((fileBody.result?.file_size ?? 0) > MAX_VOICE_BYTES) throw new Error("음성 파일이 너무 큽니다");

  const audio = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`)).arrayBuffer());
  const ai = env.AI as AiRunner;
  let text = "";
  try {
    text = (await ai.run("@cf/openai/whisper-large-v3-turbo", { audio: toBase64(audio), language: "ko", vad_filter: true })).text ?? "";
  } catch (err) {
    console.error("whisper turbo failed, trying whisper", err);
    text = (await ai.run("@cf/openai/whisper", { audio: [...audio] })).text ?? "";
  }
  text = text.trim();
  if (!text) throw new Error("음성에서 말을 알아듣지 못했습니다");
  return text;
}
