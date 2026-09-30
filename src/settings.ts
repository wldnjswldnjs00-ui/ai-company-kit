import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import { setCompany, type Company } from "./company/charter";
import { setBrand, parseBrand, BRAND_ROW_PREFIX } from "./brand";

// Values the setup screen saves, so the buyer never edits Cloudflare for
// them. One small table (settings: key → value), read once per request.

export type Settings = {
  company?: Company;
  ceoChatId?: string;
  publicBaseUrl?: string;
  websiteUrl?: string;
  telegramCode?: string; // one-time code the CEO sends to the bot to pair
  setupDone?: string;
  statusNote?: string; // "지금 회사 현황" the CEO writes; shown to every department
  brand?: string; // which logo images exist, and when they changed (see brand.ts)
  sideTheme?: string; // "black" | "white" side menu
};

export async function loadSettings(client: SupabaseClient): Promise<Settings | null> {
  // Logo images live in the same table but are read only when served.
  const { data, error } = await client.from("settings").select("key,value").not("key", "like", `${BRAND_ROW_PREFIX}%`);
  if (error) return null; // not installed yet (setup.sql not run)
  const out: Record<string, unknown> = {};
  for (const { key, value } of data as { key: string; value: string }[]) {
    try {
      out[key] = key === "company" ? JSON.parse(value) : value;
    } catch {
      // ignore a damaged row
    }
  }
  return out as Settings;
}

export async function saveSetting(client: SupabaseClient, key: keyof Settings, value: string | Company): Promise<void> {
  const { error } = await client
    .from("settings")
    .upsert({ key, value: typeof value === "string" ? value : JSON.stringify(value), updated_at: new Date().toISOString() });
  if (error) throw new Error(`설정 저장 실패(setup.sql 을 실행했나요?): ${error.message}`);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Secrets the buyer would otherwise have to invent and copy between places.
// Derived from values they already set, so there is nothing to store.
export async function derivedSecrets(env: Env): Promise<{ session?: string; webhook?: string }> {
  return {
    session: env.DASHBOARD_PASSWORD && env.SUPABASE_SECRET_KEY ? await sha256Hex(`session|${env.DASHBOARD_PASSWORD}|${env.SUPABASE_SECRET_KEY}`) : undefined,
    // Telegram allows A-Z a-z 0-9 _ - up to 256 characters.
    webhook: env.TELEGRAM_BOT_TOKEN ? (await sha256Hex(`telegram|${env.TELEGRAM_BOT_TOKEN}`)).slice(0, 48) : undefined,
  };
}

// Fills in derived secrets and saved settings. Values set by hand in
// Cloudflare win, so an advanced buyer can still override anything.
export async function hydrate(env: Env, client: SupabaseClient | null): Promise<{ env: Env; settings: Settings | null }> {
  const secrets = await derivedSecrets(env);
  let settings: Settings | null = null;
  try {
    settings = client ? await loadSettings(client) : null;
  } catch {
    settings = null;
  }
  if (settings?.company) setCompany(settings.company, settings.statusNote);
  setBrand(parseBrand(settings?.brand, settings?.sideTheme));
  return {
    settings,
    env: {
      ...env,
      SESSION_SECRET: env.SESSION_SECRET || secrets.session,
      TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET || secrets.webhook,
      TELEGRAM_CEO_CHAT_ID: env.TELEGRAM_CEO_CHAT_ID || settings?.ceoChatId,
      PUBLIC_BASE_URL: (env.PUBLIC_BASE_URL || settings?.publicBaseUrl || "").replace(/\/+$/, "") || undefined,
      WEBSITE_URL: env.WEBSITE_URL || settings?.websiteUrl,
      DB_OK: settings ? "1" : undefined,
    },
  };
}
