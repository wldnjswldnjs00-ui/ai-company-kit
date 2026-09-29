import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { must, listDepartments, type Proposal } from "../db";
import { getProfile, type Knowledge } from "./memory";
import { sendCeoDocument } from "../telegram";

// The company's memory as one human-readable Markdown file: vision, every
// active memory grouped by department (strongest first) and the CEO's
// recent decisions. Supabase's free plan has no backups, so this file —
// sent to Telegram every week and downloadable from the dashboard — is the
// copy that survives anything happening to the database, and it can be
// re-imported by hand into any future system.
export async function buildMemoryExport(client: SupabaseClient, now: Date = new Date()): Promise<string> {
  const [profile, departments, knowledge, proposals] = await Promise.all([
    getProfile(client),
    listDepartments(client),
    client.from("knowledge").select("department,kind,content,weight,created_at,updated_at").eq("active", true).order("weight", { ascending: false }).order("updated_at", { ascending: false }).limit(2000),
    client.from("proposals").select("department,title,status,ceo_note,decided_at").neq("status", "pending").order("decided_at", { ascending: false }).limit(200),
  ]);
  const items = must<Pick<Knowledge, "department" | "kind" | "content" | "weight" | "created_at" | "updated_at">[]>(knowledge);
  const decided = must<Pick<Proposal, "department" | "title" | "status" | "ceo_note" | "decided_at">[]>(proposals);
  const kindLabel: Record<string, string> = { lesson: "교훈", fact: "사실", decision: "CEO 결정", feedback: "CEO 피드백" };
  const date = now.toISOString().slice(0, 10);

  const sections: string[] = [
    `# 회사의 기억 — ${date}`,
    `기억 ${items.length}개 · 결정된 제안 ${decided.length}건`,
    "## 비전",
    profile?.vision ?? "(없음)",
    "## 전략",
    profile?.strategy || "(없음)",
  ];

  const groups: [string, string | null][] = [["🏢 전사 공통", null], ...departments.map((d) => [`${d.emoji} ${d.name}`, d.id] as [string, string])];
  for (const [label, id] of groups) {
    const mine = items.filter((k) => k.department === id);
    if (mine.length === 0) continue;
    sections.push(`## ${label} (${mine.length})`);
    sections.push(mine.map((k) => `- [${kindLabel[k.kind] ?? k.kind}${k.weight > 1 ? ` ×${k.weight}` : ""}] ${k.content}`).join("\n"));
  }

  if (decided.length) {
    sections.push("## CEO 가 결정한 제안");
    sections.push(
      decided
        .map((p) => `- ${(p.decided_at ?? "").slice(0, 10)} [${p.department}] ${p.title} → ${p.status}${p.ceo_note ? ` (메모: ${p.ceo_note})` : ""}`)
        .join("\n")
    );
  }
  return sections.join("\n\n") + "\n";
}

export async function sendMemoryBackup(env: Env, client: SupabaseClient, now: Date = new Date()): Promise<void> {
  const md = await buildMemoryExport(client, now);
  await sendCeoDocument(
    env,
    `회사의기억_${now.toISOString().slice(0, 10)}.md`,
    md,
    "🧠 <b>주간 기억 백업</b>\n회사의 기억 전체입니다. 이 파일만 있으면 어떤 AI·어떤 시스템으로 옮겨도 기억을 되살릴 수 있습니다."
  );
}
