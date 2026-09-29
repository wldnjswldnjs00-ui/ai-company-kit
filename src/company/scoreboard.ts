import type { SupabaseClient } from "@supabase/supabase-js";
import { must, listDepartments, type Department } from "../db";

// 부서별 성과 점수판: pure arithmetic over what the company already records
// (tasks, proposals, memories) — no LLM involved, so nothing here can be
// made up.

export type ScoreRow = {
  department: Department;
  done: number;
  failed: number;
  avgMinutes: number | null;
  proposals: number;
  approved: number;
  rejected: number;
  pending: number;
  approvalRate: number | null;
  learned: number;
  reinforced: number;
  feedback: number;
  recentLessons: string[];
};

type TaskLite = { department: string; status: string; kind: string; started_at: string | null; finished_at: string | null; created_at: string };
type ProposalLite = { department: string; status: string; created_at: string };
type KnowledgeLite = { department: string | null; kind: string; content: string; weight: number; created_at: string; updated_at: string };

export function computeScores(
  departments: Department[],
  tasks: TaskLite[],
  proposals: ProposalLite[],
  knowledge: KnowledgeLite[],
  since: Date
): ScoreRow[] {
  const inWindow = (iso: string | null) => !!iso && new Date(iso) >= since;
  return departments.map((department) => {
    const id = department.id;
    const mine = tasks.filter((t) => t.department === id && t.kind === "work");
    const done = mine.filter((t) => t.status === "done" && inWindow(t.finished_at));
    const failed = mine.filter((t) => t.status === "failed" && inWindow(t.finished_at)).length;
    const durations = done
      .filter((t) => t.started_at && t.finished_at)
      .map((t) => (new Date(t.finished_at as string).getTime() - new Date(t.started_at as string).getTime()) / 60000)
      .filter((m) => m >= 0);

    const props = proposals.filter((p) => p.department === id && inWindow(p.created_at));
    const approved = props.filter((p) => p.status === "approved").length;
    const rejected = props.filter((p) => p.status === "rejected").length;
    const decided = approved + rejected;

    const mem = knowledge.filter((k) => k.department === id);
    const learnedNow = mem.filter((k) => (k.kind === "lesson" || k.kind === "fact") && inWindow(k.created_at));
    const reinforced = mem.filter((k) => k.weight > 1 && inWindow(k.updated_at) && !inWindow(k.created_at)).length;

    return {
      department,
      done: done.length,
      failed,
      avgMinutes: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
      proposals: props.length,
      approved,
      rejected,
      pending: props.filter((p) => p.status === "pending" || p.status === "held").length,
      approvalRate: decided ? Math.round((approved / decided) * 100) : null,
      learned: learnedNow.length,
      reinforced,
      feedback: mem.filter((k) => k.kind === "feedback" && inWindow(k.created_at)).length,
      recentLessons: learnedNow
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 3)
        .map((k) => k.content),
    };
  });
}

export async function loadScores(client: SupabaseClient, days: number): Promise<{ rows: ScoreRow[]; since: Date; usage: { provider: string; calls: number }[] }> {
  const since = new Date(Date.now() - days * 24 * 3600e3);
  const iso = since.toISOString();
  const [departments, tasks, proposals, knowledge, usage] = await Promise.all([
    listDepartments(client),
    client.from("tasks").select("department,status,kind,started_at,finished_at,created_at").gte("created_at", iso).limit(5000),
    client.from("proposals").select("department,status,created_at").gte("created_at", iso).limit(2000),
    client.from("knowledge").select("department,kind,content,weight,created_at,updated_at").eq("active", true).gte("updated_at", iso).limit(5000),
    client.from("brain_usage").select("provider,calls").gte("day", iso.slice(0, 10)),
  ]);
  const byProvider = new Map<string, number>();
  for (const u of must<{ provider: string; calls: number }[]>(usage)) byProvider.set(u.provider, (byProvider.get(u.provider) ?? 0) + u.calls);
  return {
    rows: computeScores(departments, must<TaskLite[]>(tasks), must<ProposalLite[]>(proposals), must<KnowledgeLite[]>(knowledge), since),
    since,
    usage: [...byProvider].map(([provider, calls]) => ({ provider, calls })),
  };
}
