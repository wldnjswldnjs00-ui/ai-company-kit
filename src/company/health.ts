import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { listDepartments } from "../db";
import { sendCeo, escapeHtml } from "../telegram";

// Two self-checks that don't need any LLM:
//   1. heartbeat — tells Supabase "still alive" every tick, so its own
//      pg_cron watchdog (migration 0003) can alert when the HQ stops; and
//      reports recovery after an alert.
//   2. 감사실 본사 점검 — hourly look at the HQ's own work: failures,
//      stalled queue, stale proposals, brain budget.

export async function heartbeat(env: Env, client: SupabaseClient, now: Date = new Date()): Promise<string> {
  const { data: recovered, error } = await client.rpc("beat");
  if (error) return `심장 기록 불가(0003 SQL 미설치?): ${error.message}`;
  if (recovered) await sendCeo(env, "✅ <b>본사 심장 박동 복구</b>\n다시 정상적으로 일하고 있습니다.");

  // Keep the watchdog's copy of the bot token current (hourly is plenty).
  if (now.getUTCMinutes() < 5 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CEO_CHAT_ID) {
    const { error: vaultError } = await client.rpc("set_watchdog_telegram", { p_token: env.TELEGRAM_BOT_TOKEN, p_chat: env.TELEGRAM_CEO_CHAT_ID });
    if (vaultError) console.error("watchdog token sync failed", vaultError.message);
  }
  return recovered ? "심장 복구 알림" : "심장 정상";
}

export type HealthFindings = {
  failed: { department: string; title: string; error: string | null }[];
  stalled: number;
  staleProposals: number;
  usage: { provider: string; calls: number; limit: number }[];
};

export function formatHealthReport(f: HealthFindings, departmentName: (id: string) => string): string | null {
  const lines: string[] = [];
  if (f.failed.length) {
    lines.push(`⚠️ 실패한 업무 ${f.failed.length}건`);
    f.failed.slice(0, 5).forEach((t) => lines.push(`  • [${departmentName(t.department)}] ${t.title} — ${(t.error ?? "").slice(0, 120)}`));
  }
  if (f.stalled) lines.push(`⏳ 2시간 넘게 기다리는 업무 ${f.stalled}건 (두뇌 한도 또는 과부하일 수 있음)`);
  if (f.staleProposals) lines.push(`📝 3일 넘게 결재를 기다리는 제안 ${f.staleProposals}건`);
  for (const u of f.usage) {
    if (u.limit && u.calls >= u.limit * 0.8) lines.push(`🔋 ${u.provider} 오늘 사용 ${u.calls}/${u.limit}회 (80% 이상)`);
  }
  return lines.length ? ["🔍 <b>감사실 본사 점검</b>", "", ...lines.map(escapeHtml)].join("\n") : null;
}

export async function hqAudit(env: Env, client: SupabaseClient, now: Date = new Date()): Promise<string> {
  const { data: claimed, error } = await client.rpc("claim_hq_audit");
  if (error) return `점검 불가(0003 SQL 미설치?): ${error.message}`;
  if (!claimed) return "이번 시간 점검 완료됨";

  const hourAgo = new Date(now.getTime() - 3600e3).toISOString();
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600e3).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600e3).toISOString();
  const today = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

  const [failed, stalled, stale, usage, departments] = await Promise.all([
    client.from("tasks").select("department,title,error").eq("status", "failed").gte("finished_at", hourAgo).limit(10),
    client.from("tasks").select("id", { count: "exact", head: true }).eq("status", "queued").lt("created_at", twoHoursAgo),
    client.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").lt("created_at", threeDaysAgo),
    client.from("brain_usage").select("provider,calls").eq("day", today),
    listDepartments(client),
  ]);

  const limits: Record<string, number> = {
    gemini: Number(env.BRAIN_DAILY_LIMIT) || 200,
    workers_ai: Number(env.WORKERS_AI_DAILY_LIMIT) || 80,
    embed: Number(env.EMBED_DAILY_LIMIT) || 400,
    whisper: 60,
    claude: Number(env.CLAUDE_DAILY_LIMIT) || 50,
  };
  const failedRows = (failed.data ?? []) as { department: string; title: string; error: string | null }[];
  const report = formatHealthReport(
    {
      failed: failedRows,
      stalled: stalled.count ?? 0,
      staleProposals: stale.count ?? 0,
      usage: ((usage.data ?? []) as { provider: string; calls: number }[]).map((u) => ({ ...u, limit: limits[u.provider] ?? 0 })),
    },
    (id) => departments.find((d) => d.id === id)?.name ?? id
  );
  if (report) await sendCeo(env, report);
  return report ? "점검 결과 보고" : "이상 없음";
}
