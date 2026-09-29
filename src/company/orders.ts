import type { Department } from "../db";
import { AUTO_AGENDA } from "./meeting";


export type CeoMessage =
  | { kind: "help" }
  | { kind: "tasks" }
  | { kind: "check" }
  | { kind: "meeting"; topic: string }
  | { kind: "patrol" }
  | { kind: "order"; department: string; instruction: string }
  | { kind: "unknown_department"; name: string };

export function titleFrom(instruction: string): string {
  const firstLine = instruction.trim().split("\n")[0].trim();
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine || "제목 없음";
}

function findDepartment(departments: Department[], name: string): Department | undefined {
  const n = name.trim().toLowerCase();
  const bare = name.trim().replace(/(팀|실|본부)$/, "");
  // Exact id or name first, then a prefix ("재무" → 재무정산팀, "운영" → 운영본부).
  return (
    departments.find((d) => d.id === n || d.name === name.trim()) ??
    (bare.length >= 2 ? departments.find((d) => d.name.startsWith(bare)) : undefined)
  );
}

// "/지시 마케팅 카드뉴스 만들어줘" → that department directly.
// Any plain message → 비서실, which decides who does it.
export function parseCeoMessage(text: string, departments: Department[]): CeoMessage {
  const trimmed = text.trim();
  const command = trimmed.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (command === "/start" || command === "/help" || command === "/도움말") return { kind: "help" };
  if (command === "/tasks" || command === "/업무") return { kind: "tasks" };
  if (command === "/check" || command === "/연결") return { kind: "check" };
  if (command === "/순찰" || command === "/patrol") return { kind: "patrol" };
  if (command === "/회의" || command === "/meeting") {
    const topic = trimmed.slice(trimmed.split(/\s+/)[0].length).trim();
    // No topic: the departments raise the agenda themselves.
    return { kind: "meeting", topic: topic || AUTO_AGENDA };
  }
  // Spoken "회의 …" (voice notes have no slash) opens a meeting too.
  if (/^회의\s*[:：]?\s+\S/.test(trimmed)) return { kind: "meeting", topic: trimmed.replace(/^회의\s*[:：]?\s*/, "") };

  if (command === "/지시" || command === "/order") {
    const rest = trimmed.slice(trimmed.split(/\s+/)[0].length).trim();
    const [name, ...words] = rest.split(/\s+/);
    if (!name || words.length === 0) return { kind: "help" };
    const dept = findDepartment(departments, name);
    if (!dept) return { kind: "unknown_department", name };
    return { kind: "order", department: dept.id, instruction: words.join(" ") };
  }

  if (trimmed.startsWith("/")) return { kind: "help" };
  return { kind: "order", department: "cos", instruction: trimmed };
}

export const TELEGRAM_HELP = `🏢 <b>AI 본사 사용법</b>

<b>그냥 말하기</b> → 비서실이 받아 알맞은 부서에 배분합니다.
예) 다음 달 매출 올릴 방법 3가지 찾아줘

<b>/지시 부서 내용</b> → 그 부서에 바로 지시
예) /지시 마케팅 이번 주 인스타 글 3개 써줘

<b>/회의 주제</b> → 전 부서 회의, 회의록과 실행 항목(결재) 보고
<b>/회의</b> 만 보내면 → 부서들이 안건을 직접 올려서 회의
<b>/순찰</b> → 웹사이트순찰팀이 지금 바로 웹사이트를 직접 열어 보고 보고

/업무 — 지금 진행 중인 업무
/check — 연결 점검 · 대시보드 주소

🎙 <b>음성 메시지</b>도 됩니다. 말로 지시하거나 "회의 ○○"라고 말하세요.`

// Meetings are 비서실 cards whose instruction starts with this marker, so
// no schema change is needed for a new task kind.
export const MEETING_PREFIX = "[회의]";
