// What the buyer types into Cloudflare is kept to five values:
//   SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN,
//   DASHBOARD_PASSWORD.
// Everything else is either derived from those (session and webhook
// secrets) or saved by the setup screen in the database (CEO chat, the
// dashboard address, the company profile) — see settings.ts.
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;

  // 두뇌 (무료 LLM)
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  GEMINI_FALLBACK_MODEL?: string;
  BRAIN_DAILY_LIMIT: string;
  // 두 번째 무료 두뇌: Cloudflare Workers AI (Gemini 가 붐빌 때만)
  AI?: unknown;
  // Cloudflare Browser Rendering (웹사이트 순찰), free plan: 10 browser-minutes a day.
  BROWSER?: unknown;
  WORKERS_AI_MODEL?: string;
  WORKERS_AI_DAILY_LIMIT?: string;
  // 유료 두뇌 전환 스위치: "free"(기본) | "claude". claude 여도 키가 없거나 실패하면 무료 두뇌를 쓴다.
  BRAIN_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  CLAUDE_DAILY_LIMIT?: string;
  EMBED_DAILY_LIMIT?: string;

  // 대시보드 로그인 (CEO 한 명)
  DASHBOARD_PASSWORD?: string;
  // Derived by hydrate() — never typed by the buyer.
  SESSION_SECRET?: string;

  TELEGRAM_BOT_TOKEN?: string;
  // Filled by hydrate() from the setup screen (or set by hand to override).
  TELEGRAM_CEO_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  // The company's website, for 웹사이트 순찰 (optional).
  WEBSITE_URL?: string;

  // Set by hydrate() when the database answered; pages skip DB work otherwise.
  DB_OK?: string;

  // 킬 스위치: "false" 면 모든 부서가 멈춘다.
  AGENTS_ENABLED?: string;
};

// Every setting passes through here once per request/cron run, so a value
// pasted with stray spaces, quotes or a "NAME=" prefix still works.
export function cleanEnv(env: Env): Env {
  const out: Record<string, unknown> = { ...env };
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    let v = value.trim();
    if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
    out[name] = v.replace(/^["']+|["']+$/g, "").trim();
  }
  return out as Env;
}
