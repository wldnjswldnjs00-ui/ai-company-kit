import type { Env } from "./env";

// The company's Telegram bot: reports and 결재 buttons go to the CEO's chat
// (paired on the setup screen); its webhook points to this Worker.

const API = "https://api.telegram.org";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function configured(env: Env) {
  return env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CEO_CHAT_ID
    ? { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CEO_CHAT_ID }
    : null;
}

export async function sendCeo(env: Env, html: string): Promise<void> {
  const cfg = configured(env);
  if (!cfg) return;
  await fetch(`${API}/bot${cfg.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Telegram caps a message at 4096 characters.
    body: JSON.stringify({ chat_id: cfg.chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch((err) => console.error("telegram sendMessage failed", err));
}

// Sends a report as a downloadable file — the "결과물" the CEO keeps.
export async function sendCeoDocument(env: Env, filename: string, content: string, captionHtml: string, buttons?: InlineButton[][]): Promise<void> {
  const cfg = configured(env);
  if (!cfg) return;
  const form = new FormData();
  form.append("chat_id", cfg.chatId);
  form.append("caption", captionHtml.slice(0, 1000));
  form.append("parse_mode", "HTML");
  if (buttons) form.append("reply_markup", JSON.stringify({ inline_keyboard: buttons }));
  form.append("document", new Blob([content], { type: "text/markdown" }), filename);
  await fetch(`${API}/bot${cfg.token}/sendDocument`, { method: "POST", body: form }).catch((err) =>
    console.error("telegram sendDocument failed", err)
  );
}

export function isCeoChat(env: Env, chatId: number | string | undefined): boolean {
  return !!env.TELEGRAM_CEO_CHAT_ID && chatId !== undefined && String(chatId) === env.TELEGRAM_CEO_CHAT_ID;
}

export function taskLink(env: Env, taskId: string): string {
  return env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}/t/${taskId}` : "";
}

export type InlineButton = { text: string; callback_data: string };

// A 결재 message: returns its message id so the buttons can be replaced by
// the decision once it's made (a stale 승인 button must not stay pressable).
export async function sendCeoWithButtons(env: Env, html: string, buttons: InlineButton[][]): Promise<number | null> {
  const cfg = configured(env);
  if (!cfg) return null;
  try {
    const res = await fetch(`${API}/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text: html.slice(0, 4000),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons },
      }),
    });
    const body = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    return body.ok ? body.result?.message_id ?? null : null;
  } catch (err) {
    console.error("telegram sendMessage failed", err);
    return null;
  }
}

export async function editCeoMessage(env: Env, messageId: number, html: string): Promise<void> {
  const cfg = configured(env);
  if (!cfg) return;
  await fetch(`${API}/bot${cfg.token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.chatId, message_id: messageId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch((err) => console.error("telegram editMessageText failed", err));
}

export async function answerCallback(env: Env, callbackId: string, text: string): Promise<void> {
  const cfg = configured(env);
  if (!cfg) return;
  await fetch(`${API}/bot${cfg.token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  }).catch((err) => console.error("telegram answerCallbackQuery failed", err));
}

export type WebhookInfo = { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number };

// Registers this Worker as the bot's webhook using the token and secret
// already stored in Cloudflare — so the CEO never has to hand-build the
// setWebhook URL, and the secret Telegram sends always matches ours.
export async function registerWebhook(env: Env): Promise<{ ok: boolean; message: string }> {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, message: "Cloudflare 에 TELEGRAM_BOT_TOKEN 이 없습니다." };
  if (!env.TELEGRAM_WEBHOOK_SECRET) return { ok: false, message: "Cloudflare 에 TELEGRAM_WEBHOOK_SECRET 이 없습니다." };
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    return { ok: false, message: "TELEGRAM_WEBHOOK_SECRET 에는 영문·숫자·_·- 만 쓸 수 있습니다. 특수문자나 한글을 빼고 다시 넣어 주세요." };
  }
  if (!env.PUBLIC_BASE_URL) return { ok: false, message: "Cloudflare 에 PUBLIC_BASE_URL 이 없습니다." };
  try {
    const res = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/telegram`, secret_token: env.TELEGRAM_WEBHOOK_SECRET }),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (res.status === 404 || res.status === 401) return { ok: false, message: "봇 토큰이 틀렸습니다. Cloudflare 의 TELEGRAM_BOT_TOKEN 을 BotFather 가 준 토큰 전체(숫자:영문)로 다시 넣어 주세요." };
    return { ok: body.ok, message: body.description ?? (body.ok ? "연결됨" : "실패") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function webhookInfo(env: Env): Promise<WebhookInfo | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const res = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    const body = (await res.json()) as { ok: boolean; result?: WebhookInfo };
    return body.ok ? body.result ?? null : null;
  } catch {
    return null;
  }
}

export async function sendCeoPhoto(env: Env, image: Uint8Array, captionHtml: string): Promise<void> {
  const cfg = configured(env);
  if (!cfg) return;
  const form = new FormData();
  form.append("chat_id", cfg.chatId);
  form.append("caption", captionHtml.slice(0, 1000));
  form.append("parse_mode", "HTML");
  form.append("photo", new Blob([image], { type: "image/jpeg" }), "card.jpg");
  await fetch(`${API}/bot${cfg.token}/sendPhoto`, { method: "POST", body: form }).catch((err) => console.error("telegram sendPhoto failed", err));
}
