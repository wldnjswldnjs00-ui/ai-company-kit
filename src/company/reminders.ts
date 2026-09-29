import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { sendCeo } from "../telegram";

// 미뤄 둔 일: decisions the CEO postponed until something happens. The HQ
// watches for those moments itself (rule-based, no brain) and brings each
// up once per window — so nothing depends on anyone remembering.

export type LaterFacts = { quotaDays7: number; paidBrainOn: boolean };
export type LaterItem = { key: string; message: string; repeatDays: number };

export function laterReminders(f: LaterFacts): LaterItem[] {
  const items: LaterItem[] = [];
  if (!f.paidBrainOn && f.quotaDays7 >= 3) {
    items.push({
      key: "paid-brain",
      repeatDays: 14,
      message: `🧠 <b>무료 두뇌가 자주 모자랍니다</b>\n최근 7일 중 ${f.quotaDays7}일 한도에 걸렸습니다.\n일이 밀리고 있다면 유료 두뇌 스위치를 켤지 검토할 때입니다(설명서 "유료 두뇌 전환").`,
    });
  }
  return items;
}

// Once a day; each reminder at most once per its repeat window.
export async function remindLater(env: Env, client: SupabaseClient, now: Date = new Date()): Promise<string> {
  const { data: due, error } = await client.rpc("claim_slot", { p_name: "later-check", p_minutes: 20 * 60 });
  if (error) return `미뤄 둔 일 점검 불가: ${error.message}`;
  if (!due) return "오늘 점검함";

  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600e3).toISOString();
  const { data: quota } = await client.from("task_events").select("at").eq("kind", "quota").gte("at", weekAgo).limit(200);
  const quotaDays7 = new Set(((quota ?? []) as { at: string }[]).map((e) => new Date(new Date(e.at).getTime() + 9 * 3600e3).toISOString().slice(0, 10))).size;

  const sent: string[] = [];
  for (const item of laterReminders({ quotaDays7, paidBrainOn: env.BRAIN_PROVIDER === "claude" })) {
    const { data: fresh } = await client.rpc("claim_slot", { p_name: `later-${item.key}`, p_minutes: item.repeatDays * 24 * 60 });
    if (!fresh) continue;
    await sendCeo(env, `🔔 <b>미뤄 둔 일 알림</b>\n\n${item.message}`);
    sent.push(item.key);
  }
  return sent.length ? `알림: ${sent.join(", ")}` : "알릴 것 없음";
}
