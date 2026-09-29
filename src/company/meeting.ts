import type { Department } from "../db";

// 전 부서 회의 — a real one: every department thinks separately (its own
// memory, goals and manuals), the departments others asked something of
// answer back, and 비서실 chairs and writes the minutes. Each step is a
// separate brain call, spread over several heartbeats; progress is kept in
// task_events, so a busy brain only pauses the meeting.

export const AUTO_AGENDA = "(안건 자율)";
export const MAX_REBUTTALS = 4;

export type Opinion = { dept: string; agenda?: string; position: string; asks: { to: string; request: string }[]; risk?: string };
export type Rebuttal = { dept: string; response: string };

// "[회의] 주제\n\n배경…" → topic (first line) and background (the rest).
export function parseMeetingInstruction(instruction: string, prefix: string): { topic: string | null; background: string } {
  const rest = instruction.slice(prefix.length).trim();
  const [first, ...more] = rest.split("\n");
  const topic = first.trim();
  return { topic: topic && topic !== AUTO_AGENDA ? topic : null, background: more.join("\n").trim() };
}

export function opinionInstruction(topic: string | null): string {
  return `[지금 할 일: 전 부서 회의 — 우리 부서 의견 내기]
다른 부서도 각자 따로 의견을 낸다. 우리 부서의 사명, 목표, 기억, 대응 매뉴얼에 근거해서 우리 부서 입장만 말한다.
${topic ? `안건: ${topic}` : "CEO 가 안건을 정하지 않았다. 우리 부서가 보기에 이번 주 회사가 가장 먼저 풀어야 할 문제 하나를 안건으로 낸다."}
- 듣기 좋은 말보다 솔직한 의견을 쓴다. 다른 부서와 부딪힐 수 있는 점도 숨기지 않는다.
- 다른 부서에 요청하거나 반대할 것이 있으면 asks 에 적는다(부서 id 는 영문 그대로).
- 데이터가 없는 주장은 "확인 필요"라고 쓴다.
JSON 으로만 답한다:
{"agenda": "${topic ? "(비워 둔다)" : "우리 부서가 내는 안건 한 줄"}", "position": "우리 부서 입장 3~5문장, 근거 포함", "asks": [{"to": "부서id", "request": "요청이나 반대 한두 문장"}], "risk": "가장 걱정되는 위험 한 문장"}`;
}

export function parseOpinion(dept: string, raw: string, parse: (s: string) => unknown): Opinion {
  try {
    const o = parse(raw) as Partial<Opinion> & { asks?: unknown };
    const asks = Array.isArray(o.asks)
      ? (o.asks as { to?: unknown; request?: unknown }[])
          .filter((a) => typeof a?.to === "string" && typeof a?.request === "string" && a.to !== dept)
          .map((a) => ({ to: String(a.to), request: String(a.request).slice(0, 200) }))
          .slice(0, 3)
      : [];
    return {
      dept,
      agenda: typeof o.agenda === "string" && o.agenda.trim() && !o.agenda.startsWith("(") ? o.agenda.slice(0, 150) : undefined,
      position: typeof o.position === "string" && o.position.trim() ? o.position.slice(0, 700) : raw.slice(0, 700),
      asks,
      risk: typeof o.risk === "string" ? o.risk.slice(0, 200) : undefined,
    };
  } catch {
    return { dept, position: raw.slice(0, 700), asks: [] };
  }
}

// Opinions are stored as task_events (message capped at 2000 characters),
// hence the caps above.

// Who answers back: departments others addressed, most-asked first.
export function rebuttalTargets(opinions: Opinion[], validIds: string[]): string[] {
  const count = new Map<string, number>();
  for (const o of opinions) for (const a of o.asks) if (validIds.includes(a.to) && a.to !== o.dept) count.set(a.to, (count.get(a.to) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_REBUTTALS)
    .map(([id]) => id);
}

export function formatOpinions(opinions: Opinion[], departments: Pick<Department, "id" | "name">[]): string {
  const name = (id: string) => departments.find((d) => d.id === id)?.name ?? id;
  return opinions
    .map((o) =>
      [
        `### ${name(o.dept)} (${o.dept})`,
        o.agenda ? `안건 제안: ${o.agenda}` : "",
        `입장: ${o.position}`,
        o.risk ? `위험: ${o.risk}` : "",
        ...o.asks.map((a) => `→ ${name(a.to)}에게: ${a.request}`),
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

export function rebuttalInstruction(dept: string, opinions: Opinion[], departments: Pick<Department, "id" | "name">[]): string {
  const name = (id: string) => departments.find((d) => d.id === id)?.name ?? id;
  const toMe = opinions.flatMap((o) => o.asks.filter((a) => a.to === dept).map((a) => `- ${name(o.dept)}: ${a.request}`));
  return `[지금 할 일: 전 부서 회의 — 반론과 조정]
다른 부서들이 우리 부서에 요청하거나 반대했다. 각각 수용·조정·반대 중 하나로 답하고 이유를 쓴다. 고집하지 말고, 회사에 더 나은 쪽을 고른다.

[우리 부서에 온 요청]
${toMe.join("\n")}

[모든 부서의 의견]
${formatOpinions(opinions, departments)}

JSON 으로만 답한다: {"response": "요청마다 수용/조정/반대와 이유, 전체 3~6문장"}`;
}

export function chairInstruction(topic: string | null, rounds: { opinions: number; rebuttals: number }): string {
  return `[지금 할 일: 전 부서 회의 — 사회자로서 회의록 작성]
${rounds.opinions}개 부서가 각자 따로 의견을 냈고, ${rounds.rebuttals}개 부서가 반론·조정을 했다. 이것을 바탕으로 결론을 낸다.
${topic ? `안건: ${topic}` : "CEO 가 안건을 정하지 않았다. 부서들이 낸 안건 중 회사에 가장 중요한 것 1~2개를 골라 안건으로 삼고, 왜 골랐는지 쓴다."}
본문 첫 줄에 "${rounds.opinions}개 부서가 각자 의견을 내고 ${rounds.rebuttals}개 부서가 반론한 뒤 비서실이 정리한 회의록입니다." 라고 쓴다.
의견이 갈린 점은 숨기지 말고 드러낸다. 데이터가 없는 주장은 "확인 필요"로 표시한다.

형식(반드시 지킨다):
요약: (한두 문장)
## 안건
## 부서별 의견
(부서마다 1~3문장)
## 반론과 조정
## 합의된 점
## 의견이 갈린 점과 CEO 결정 필요 사항
## 실행 항목
- [부서id] 제목 | 무엇을 할지 | 기대 효과
(최대 5개. 부서id 는 영문 id 를 그대로 쓴다)
## 배운 점`;
}
