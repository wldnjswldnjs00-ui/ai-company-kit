import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

export type Department = {
  id: string;
  name: string;
  emoji: string;
  mission: string;
  goals: string;
  job?: string | null;
  sort: number;
  updated_at: string;
};

export type TaskStatus = "queued" | "working" | "done" | "failed" | "cancelled";
export type TaskSource = "ceo_web" | "ceo_telegram" | "agent" | "schedule";

export type Task = {
  id: string;
  department: string;
  title: string;
  instruction: string;
  status: TaskStatus;
  source: TaskSource;
  kind: "work" | "initiative";
  parent_id: string | null;
  summary: string | null;
  result_md: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type Proposal = {
  id: string;
  department: string;
  title: string;
  problem: string;
  proposal: string;
  impact: string;
  effort: string;
  status: "pending" | "approved" | "rejected" | "held";
  telegram_message_id: number | null;
  task_id: string | null;
  ceo_note: string | null;
  action?: { type: "hide_product"; productId: string; productTitle?: string } | null;
  action_result?: string | null;
  created_at: string;
  decided_at: string | null;
};

export type TaskEvent = { id: number; task_id: string; at: string; kind: string; message: string };

// Server-side only: the secret key bypasses RLS, which is exactly why it
// never leaves the Worker (no browser code in this project talks to Supabase).
// Values pasted into the Cloudflare dashboard easily pick up stray spaces,
// quotes, a trailing slash or even the "NAME=" prefix — tolerate all of that
// rather than fail with an opaque "Invalid supabaseUrl".
export function cleanSetting(value: string | undefined, name?: string): string {
  let v = (value ?? "").trim();
  if (name && v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  v = v.replace(/^["']+|["']+$/g, "").trim();
  return v;
}

export function supabaseUrl(value: string | undefined): string {
  let v = cleanSetting(value, "SUPABASE_URL").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  if (v && !/^https?:\/\//.test(v)) v = `https://${v}`;
  // https only — except a local Supabase during development.
  if (!/^https:\/\/[^/\s]+$/.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v)) {
    throw new Error("SUPABASE_URL 값이 올바르지 않습니다. Supabase → Project Settings → Data API 의 Project URL(https://xxxx.supabase.co)을 넣어 주세요.");
  }
  return v;
}

const DB_TIMEOUT_MS = 10_000;

export function db(env: Env): SupabaseClient {
  return createClient(supabaseUrl(env.SUPABASE_URL), cleanSetting(env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    // A wrong address or a paused project must fail fast, not hang a page.
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_TIMEOUT_MS) }) },
  });
}

// Throws on a Supabase error so callers never silently continue on a
// failed write — the Worker's own error handling logs and reports it.
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function logEvent(client: SupabaseClient, taskId: string, kind: string, message: string) {
  must(await client.from("task_events").insert({ task_id: taskId, kind, message: message.slice(0, 2000) }));
}

export async function listDepartments(client: SupabaseClient): Promise<Department[]> {
  return must(await client.from("departments").select("*").order("sort"));
}

export async function getDepartment(client: SupabaseClient, id: string): Promise<Department | null> {
  return must(await client.from("departments").select("*").eq("id", id).maybeSingle());
}

export async function createTask(
  client: SupabaseClient,
  input: { department: string; title: string; instruction: string; source: TaskSource; parent_id?: string | null; kind?: Task["kind"] }
): Promise<Task> {
  const task = must<Task>(await client.from("tasks").insert(input).select().single());
  await logEvent(client, task.id, "created", `업무 생성 (${input.source})`);
  return task;
}

export async function getTask(client: SupabaseClient, id: string): Promise<Task | null> {
  return must(await client.from("tasks").select("*").eq("id", id).maybeSingle());
}
