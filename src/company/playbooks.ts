import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import type { Department } from "../db";
import { embed, toPgVector } from "../brain/embed";
import { remember, extractSection, type Knowledge } from "./memory";
import { seedsFor } from "./departments";

// 대응 매뉴얼: "if situation A happens, do this". Departments write them ahead
// of time (대비 훈련, weekly), they're kept in the company's memory, and when
// a real situation looks like one, the matching manual is put in front of
// the department first — so the answer was thought through calmly, before
// anything was on fire.
//
// Stored as knowledge (kind "fact") with a fixed prefix, so no schema change
// is needed and forgetting/backup work as for any other memory.

export const PLAYBOOK_PREFIX = "[대응 매뉴얼] ";
export const DRILL_TITLE_PREFIX = "대비 훈련";
export const PLAYBOOK_HEADING = /^#{1,3}\s*대응\s*매뉴얼/;
const MAX_PLAYBOOK_CHARS = 1000;

export function isPlaybook(content: string): boolean {
  return content.startsWith(PLAYBOOK_PREFIX);
}

export function playbookTitle(content: string): string {
  return content.slice(PLAYBOOK_PREFIX.length).split("\n")[0].replace(/^상황\s*[:：]\s*/, "").trim();
}

// "## 대응 매뉴얼" → one entry per "### 상황: …" block.
export function parsePlaybooks(reportBody: string): { title: string; content: string }[] {
  const section = extractSection(reportBody, PLAYBOOK_HEADING);
  if (!section) return [];
  const out: { title: string; content: string }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (current.title && text.length >= 30) {
      out.push({ title: current.title, content: `${PLAYBOOK_PREFIX}상황: ${current.title}\n${text}`.slice(0, MAX_PLAYBOOK_CHARS) });
    }
  };
  for (const line of section.split("\n")) {
    const m = line.trim().match(/^#{3,4}\s*(?:상황\s*\d*\s*[:：.]?)?\s*(.+)$/);
    if (m) {
      flush();
      current = { title: m[1].replace(/^상황\s*[:：]\s*/, "").trim().slice(0, 80), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return out.slice(0, 5);
}

export async function savePlaybooks(env: Env, client: SupabaseClient, department: string, reportBody: string, taskId: string): Promise<number> {
  const playbooks = parsePlaybooks(reportBody);
  if (!playbooks.length) return 0;
  // Weight 2: a prepared answer should outrank a stray one-off lesson.
  await remember(env, client, playbooks.map((p) => ({ department, kind: "fact" as const, content: p.content, weight: 2, source_task: taskId })));
  return playbooks.length;
}

export async function listPlaybookTitles(client: SupabaseClient, department: string): Promise<string[]> {
  const { data } = await client
    .from("knowledge")
    .select("content")
    .eq("active", true)
    .eq("department", department)
    .like("content", `${PLAYBOOK_PREFIX}%`)
    .order("updated_at", { ascending: false })
    .limit(60);
  return ((data ?? []) as { content: string }[]).map((r) => playbookTitle(r.content));
}

// The manuals closest to a real situation, for prompts outside the normal
// task flow (e.g. dispute drafts). Normal tasks get them through recall().
export async function findPlaybooks(env: Env, client: SupabaseClient, department: string, situation: string, limit = 2): Promise<string[]> {
  const vector = (await embed(env, client, [situation]).catch(() => null))?.[0];
  if (!vector) return [];
  const { data } = await client.rpc("match_knowledge", { p_embedding: toPgVector(vector), p_department: department, p_limit: 8 });
  return ((data ?? []) as (Knowledge & { similarity: number })[])
    .filter((k) => isPlaybook(k.content) && k.similarity >= 0.45)
    .slice(0, limit)
    .map((k) => k.content);
}

export function formatPlaybooks(items: string[]): string {
  return items.length ? `[준비해 둔 대응 매뉴얼 — 비슷한 상황이면 먼저 따르고, 다르게 판단하면 이유를 밝힌다]\n${items.join("\n\n")}` : "";
}

export function drillInstruction(dept: Pick<Department, "id" | "name">, existingTitles: string[]): string {
  const seeds = seedsFor(dept.id);
  return `대비 훈련. 아직 일어나지 않았지만 ${dept.name} 에게 일어날 수 있는 상황을 미리 생각하고, 그때 바로 쓸 대응 매뉴얼을 만든다.
매일 하는 훈련이다. 아직 일이 적어도 상관없다. 오히려 지금 준비해 두어야 실제 상황에서 바로 움직인다.

[이미 만든 매뉴얼 — 다시 만들지 않는다]
${existingTitles.length ? existingTitles.map((t) => `- ${t}`).join("\n") : "- 아직 없음"}

[생각해 볼 상황 예시 — 이 밖의 상황도 좋다]
${seeds.length ? seeds.map((s) => `- ${s}`).join("\n") : "- (예시 없음 — 우리 부서 일에서 스스로 찾는다)"}

아직 매뉴얼이 없는 상황 중 가장 일어날 법하거나 피해가 큰 것 2~3개를 골라라.
예시가 이미 다 준비됐으면 더 넓힌다: 드물지만 치명적인 상황, 여러 부서가 함께 움직여야 하는 상황, 이미 만든 매뉴얼로는 막히는 변형 상황.
보고서에 "## 대응 매뉴얼" 섹션을 두고, 상황마다 아래 형식으로 짧게 쓴다(상황 하나당 900자 이내).
### 상황: (한 줄 제목)
- 징후: 이 상황이 시작됐다는 신호
- 즉시 할 일: 1, 2, 3 순서로
- 판단 기준: 무엇을 보고 어떻게 결정하는지
- CEO 결재가 필요한 것: 돈·계정 정지·외부 발표 등
- 사용자에게 보낼 안내 문구: (필요하면 한두 문장)
추측으로 숫자를 만들지 않는다. 우리 회사에 아직 없는 것이 필요하면 그렇다고 적는다.`;
}
