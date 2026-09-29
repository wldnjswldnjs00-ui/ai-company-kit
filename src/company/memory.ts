import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { must } from "../db";
import { embed, toPgVector } from "../brain/embed";

// 회사의 기억. The model's weights never change; what grows is this
// organisational memory — lessons each department writes after its own work,
// CEO feedback and decisions — and the relevant slice of it is put in front
// of every future task. Switching to a stronger model later keeps all of it.

export type KnowledgeKind = "lesson" | "fact" | "decision" | "feedback";

export type Knowledge = {
  id: string;
  department: string | null;
  kind: KnowledgeKind;
  content: string;
  weight: number;
  source_task: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CompanyProfile = { vision: string; strategy: string; updated_at: string };

// Two memories this close in meaning are the same lesson learned again:
// reinforce the old one instead of storing a duplicate.
const DUPLICATE_SIMILARITY = 0.9;
const MAX_LESSONS_PER_TASK = 3;

export async function getProfile(client: SupabaseClient): Promise<CompanyProfile | null> {
  return must(await client.from("company_profile").select("vision,strategy,updated_at").eq("id", 1).maybeSingle());
}

export function formatProfile(profile: CompanyProfile | null): string {
  if (!profile) return "";
  return `[회사 비전 — CEO 가 정함]\n${profile.vision}${profile.strategy.trim() ? `\n\n[회사 전략]\n${profile.strategy}` : ""}`;
}

// The "## 배운 점" section every report ends with (see COMPANY_CHARTER):
// bullet lines only, placeholders like "없음" ignored.
export function extractLessons(reportBody: string): string[] {
  const lines = reportBody.split("\n");
  const start = lines.findIndex((l) => /^#{1,3}\s*배운\s*점/.test(l.trim()));
  if (start === -1) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s/.test(line.trim())) break;
    section.push(line);
  }
  return section
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 8 && !/^(없음|해당\s*없음|none|n\/a)\.?$/i.test(line))
    .slice(0, MAX_LESSONS_PER_TASK);
}

export async function remember(
  env: Env,
  client: SupabaseClient,
  entries: { department: string | null; kind: KnowledgeKind; content: string; weight?: number; source_task?: string | null }[]
): Promise<number> {
  if (entries.length === 0) return 0;
  const vectors = await embed(env, client, entries.map((e) => e.content));
  let stored = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const vector = vectors?.[i];

    if (vector) {
      const { data: near } = await client.rpc("match_knowledge", { p_embedding: toPgVector(vector), p_department: e.department, p_limit: 1 });
      const hit = (near as { id: string; department: string | null; weight: number; similarity: number }[] | null)?.[0];
      if (hit && hit.similarity >= DUPLICATE_SIMILARITY && hit.department === e.department) {
        must(
          await client
            .from("knowledge")
            .update({ weight: hit.weight + (e.weight ?? 1), updated_at: new Date().toISOString() })
            .eq("id", hit.id)
        );
        continue;
      }
    }

    must(
      await client.from("knowledge").insert({
        department: e.department,
        kind: e.kind,
        content: e.content.slice(0, 1000),
        weight: e.weight ?? 1,
        source_task: e.source_task ?? null,
        embedding: vector ? toPgVector(vector) : null,
      })
    );
    stored++;
  }
  return stored;
}

// What a department should keep in mind for this task: CEO feedback and
// decisions always, then the memories closest in meaning to the task (or,
// without embeddings, the most reinforced and recent ones).
export async function recall(env: Env, client: SupabaseClient, department: string, query: string, limit = 8): Promise<Knowledge[]> {
  const pinned = must<Knowledge[]>(
    await client
      .from("knowledge")
      .select("id,department,kind,content,weight,source_task,active,created_at,updated_at")
      .eq("active", true)
      .in("kind", ["feedback", "decision"])
      .or(`department.eq.${department},department.is.null`)
      .order("weight", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(4)
  );

  let related: Knowledge[] = [];
  const vector = (await embed(env, client, [query]))?.[0];
  if (vector) {
    const { data } = await client.rpc("match_knowledge", { p_embedding: toPgVector(vector), p_department: department, p_limit: limit });
    related = ((data ?? []) as (Knowledge & { similarity: number })[]).filter((k) => k.similarity >= 0.35);
  } else {
    related = must<Knowledge[]>(
      await client
        .from("knowledge")
        .select("id,department,kind,content,weight,source_task,active,created_at,updated_at")
        .eq("active", true)
        .or(`department.eq.${department},department.is.null`)
        .order("weight", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit)
    );
  }

  const seen = new Set<string>();
  return [...pinned, ...related].filter((k) => !seen.has(k.id) && seen.add(k.id)).slice(0, limit + 4);
}

const KIND_LABEL: Record<KnowledgeKind, string> = { lesson: "교훈", fact: "사실", decision: "CEO 결정", feedback: "CEO 피드백" };

export function formatMemory(items: Knowledge[]): string {
  if (items.length === 0) return "";
  return `[회사의 기억 — 이전 업무에서 배운 것과 CEO 의 결정. 반드시 반영한다]\n${items
    .map((k) =>
      k.content.startsWith("[대응 매뉴얼] ")
        ? `- (준비해 둔 대응 매뉴얼 — 비슷한 상황이면 먼저 따른다) ${k.content.slice("[대응 매뉴얼] ".length)}`
        : `- (${KIND_LABEL[k.kind]}${k.weight > 1 ? ` ×${k.weight}` : ""}) ${k.content}`
    )
    .join("\n")}`;
}

// The "## 개발 요청서" section an engineering report carries (see the eng
// job description): everything from that heading up to the next "## ".
export function extractSection(reportBody: string, heading: RegExp): string | null {
  const lines = reportBody.split("\n");
  const start = lines.findIndex((l) => heading.test(l.trim()));
  if (start === -1) return null;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line.trim())) break;
    out.push(line);
  }
  const text = out.join("\n").trim();
  return text.length >= 20 ? text : null;
}

export const DEV_REQUEST_HEADING = /^#{1,3}\s*개발\s*요청서/;
