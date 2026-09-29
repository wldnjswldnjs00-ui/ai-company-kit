import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import { sendCeo, escapeHtml } from "./telegram";

// 대시보드 로그인 지킴이: there is one account, so any failure is either the
// CEO mistyping or someone guessing. Guessing is slowed per IP and, in case
// it comes from many IPs, for the whole site. Every success is announced in
// Telegram, so a login the CEO didn't make is noticed at once.

export const WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_IP = 5;
export const MAX_FAILURES_TOTAL = 30;

export type Verdict = "allow" | "blocked_ip" | "blocked_all";

export function loginVerdict(ipFailures: number, totalFailures: number): Verdict {
  if (ipFailures >= MAX_FAILURES_PER_IP) return "blocked_ip";
  if (totalFailures >= MAX_FAILURES_TOTAL) return "blocked_all";
  return "allow";
}

export type Visitor = { ip: string; country: string; device: string };

export function visitorFrom(headers: Headers): Visitor {
  const ua = headers.get("user-agent") ?? "";
  const device =
    [/iPhone|iPad/, /Android/, /Windows/, /Macintosh/, /Linux/].map((re) => ua.match(re)?.[0]).find(Boolean) ?? "알 수 없는 기기";
  const browser = [/Edg\//, /Whale\//, /SamsungBrowser\//, /Chrome\//, /Firefox\//, /Safari\//].map((re) => ua.match(re)?.[0]).find(Boolean);
  return {
    ip: headers.get("cf-connecting-ip") ?? "unknown",
    country: headers.get("cf-ipcountry") ?? "?",
    device: browser ? `${device} · ${browser.replace("/", "").replace("Edg", "Edge")}` : device,
  };
}

// Returns the verdict before checking the password. If the table isn't
// installed yet (0004 SQL), it allows the login rather than lock the CEO out.
export async function checkLogin(client: SupabaseClient, ip: string, now: Date = new Date()): Promise<Verdict> {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60e3).toISOString();
  const [mine, all] = await Promise.all([
    client.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("ok", false).gte("at", since),
    client.from("login_attempts").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", since),
  ]);
  if (mine.error || all.error) return "allow";
  return loginVerdict(mine.count ?? 0, all.count ?? 0);
}

export async function recordLogin(env: Env, client: SupabaseClient, visitor: Visitor, ok: boolean, now: Date = new Date()): Promise<void> {
  const { error } = await client.from("login_attempts").insert({ ip: visitor.ip, ok });
  const where = `IP ${escapeHtml(visitor.ip)} (${escapeHtml(visitor.country)}) · ${escapeHtml(visitor.device)}`;
  if (ok) {
    await sendCeo(env, `🔐 <b>대시보드 로그인</b>\n${where}\n본인이 아니면 Cloudflare 에서 DASHBOARD_PASSWORD 를 바꾸세요(바꾸면 모든 로그인이 풀립니다).`);
  } else if (!error) {
    // Alert once, on the failure that triggers the block.
    const since = new Date(now.getTime() - WINDOW_MINUTES * 60e3).toISOString();
    const { count } = await client.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", visitor.ip).eq("ok", false).gte("at", since);
    if (count === MAX_FAILURES_PER_IP) {
      await sendCeo(env, `🚫 <b>로그인 ${MAX_FAILURES_PER_IP}번 실패 — ${WINDOW_MINUTES}분 차단</b>\n${where}\n본인이 아니라면 누군가 비밀번호를 추측하고 있습니다.`);
    }
  }
  // Housekeeping: keep 30 days.
  await client.from("login_attempts").delete().lt("at", new Date(now.getTime() - 30 * 24 * 3600e3).toISOString());
}
