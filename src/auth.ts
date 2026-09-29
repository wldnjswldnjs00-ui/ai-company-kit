import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "./env";

// Single-user login for the CEO: a password (DASHBOARD_PASSWORD) exchanged
// for an HMAC-signed, expiring cookie. No user table, no third-party auth.

export const SESSION_COOKIE = "hq_session";
export const SESSION_TTL_S = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Constant-time: both sides are hashed to equal length and compared in full.
export async function secretEquals(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function issueSession(secret: string, nowMs: number = Date.now()): Promise<string> {
  const exp = String(Math.floor(nowMs / 1000) + SESSION_TTL_S);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function verifySession(secret: string | undefined, token: string | undefined, nowMs: number = Date.now()): Promise<boolean> {
  if (!secret || !token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) * 1000 < nowMs) return false;
  return secretEquals(sig, await hmac(secret, exp));
}

export async function requireCeo(c: Context<{ Bindings: Env }>, next: Next) {
  if (await verifySession(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE))) return next();
  return c.redirect("/login");
}
