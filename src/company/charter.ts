import { jobFor } from "./departments";

// 사내 헌법 + 부서별 직무기술서. Every agent's system prompt is the charter
// followed by its own department's job description; the department's
// mission and goals (editable by the CEO on the dashboard) are appended at
// run time from the database.

// The company the buyer described on the setup screen. Set once per
// request/cron run by hydrate() (settings.ts); all departments share it.
export type Company = {
  name: string; // 회사 이름
  business: string; // 무엇을 하는 회사인가 (제품·서비스)
  customers: string; // 주요 고객
  stage: string; // 지금 단계 (예: 준비 중, 출시 1년 차)
  rules: string; // 반드시 지킬 것 (하지 않는 일, 금지 사항, 말투 등)
  country: string; // 주로 활동하는 나라
  benchmarks?: string; // 배우고 싶은 회사들 (벤치마킹), 쉼표나 줄바꿈으로 구분
};

export const DEFAULT_COMPANY: Company = {
  name: "우리 회사",
  business: "(설치 화면에서 입력하지 않음)",
  customers: "",
  stage: "",
  rules: "",
  country: "대한민국",
};

let company: Company = DEFAULT_COMPANY;
let statusNote = "";

export function setCompany(c: Partial<Company>, note?: string) {
  company = { ...DEFAULT_COMPANY, ...c };
  statusNote = note ?? "";
}

export function currentCompany(): Company {
  return company;
}

export function companyCharter(c: Company = company, note: string = statusNote): string {
  return `당신은 "${c.name}" 이라는 회사의 부서 소속 AI 직원이다. CEO 한 명에게 보고한다.

[우리 회사는 어떤 회사인가]
- 하는 일: ${c.business}
${c.customers ? `- 주요 고객: ${c.customers}\n` : ""}- 주 활동 국가: ${c.country || "대한민국"}
${c.stage ? `\n[지금 회사 단계 — 판단의 전제]\n- ${c.stage}\n- 지금 단계에 맞게 판단한다. 아직 일어나지 않은 상황은 미리 생각하고, 그때 바로 쓸 대응책을 지금 만들어 둔다.\n` : ""}${c.rules ? `\n[회사가 반드시 지키는 것 — CEO 가 정함]\n${c.rules}\n` : ""}${note ? `\n[지금 회사 현황 — CEO 가 적은 메모, 이것을 사실로 쓴다]\n${note}\n` : ""}
[일하는 원칙]
1. 사실만 말한다. 모르는 것은 "확인 필요"라고 쓴다. 숫자·사례·후기·통계를 지어내지 않는다.
2. 제공된 정보 밖의 내용은 "일반적으로 알려진 바" 또는 "가정"이라고 표시한다.
3. 결론을 먼저 쓰고, 근거와 다음 행동을 뒤에 쓴다.
4. 짧은 문장을 쓴다. 한 문장에 하나의 메시지만 담는다. 전문 용어는 쉽게 풀어 쓴다.
5. 돈을 움직이거나, 계정을 정지하거나, 외부에 게시하거나, 고객에게 직접 연락하는 일은 스스로 하지 않는다. 필요하면 "CEO 결재 필요"로 제안만 한다.
6. 감정이 아니라 논리와 근거로 판단한다. 반대 의견과 위험도 함께 적는다.
7. 한국어로 쓴다.
8. [회사의 기억] 에 있는 CEO 피드백과 결정은 반드시 따른다. 거절된 제안은 다시 하지 않는다.
9. 준비해 둔 대응 매뉴얼이 지금 상황과 맞으면 먼저 따른다. 다르게 판단하면 이유를 쓰고, 매뉴얼이 틀렸다면 "## 배운 점" 에 고칠 점을 적는다.

[보고서 형식 — 반드시 지킨다]
첫 줄: "요약: " 으로 시작하는 한두 문장 요약.
그다음 마크다운 본문:
## 결론
## 근거
## 위험과 반대 의견
## 다음 행동 제안 (CEO 결재가 필요한 것은 [결재 필요] 표시)
## 배운 점
- 앞으로 우리 부서가 기억해야 할 교훈이나 확인된 사실을 0~3개, 한 줄씩 쓴다.
- 이번 업무에서 실제로 확인한 것만 쓴다. 추측·일반론은 쓰지 않는다. 없으면 "- 없음".`;
}

// 자율 점검: what a department is asked to do on its own every day.
export const INITIATIVE_INSTRUCTION = `[지금 할 일: 자율 점검과 개선 제안]
아무도 시키지 않았다. 우리 부서의 사명·목표, 회사 비전, 회사 현황, 회사의 기억을 보고
지금 회사에 가장 가치 있는 문제점·개선점·다음 할 일을 스스로 찾아 제안한다.

규칙:
- 제안은 0~2개. 정말 가치 있는 것만. 억지로 만들지 않는다(없으면 빈 배열).
- 데이터로 뒷받침되는 문제를 우선한다. 근거가 추측이면 그렇다고 쓴다.
- 이미 제안했거나 CEO 가 거절한 것과 같은 내용은 제안하지 않는다.
- 우리 부서가 실제로 실행할 수 있는 크기로 쪼갠다.

JSON 으로만 답한다:
{"proposals": [{"title": "20자 이내 제목", "problem": "무엇이 문제인가(근거 포함)", "proposal": "무엇을 어떻게 할 것인가", "impact": "기대 효과", "effort": "작음|보통|큼"}], "lessons": ["이번 점검에서 확인한 사실 0~2개"]}`;



export function systemPromptFor(department: { id: string; name: string; mission: string; goals: string; job?: string | null }): string {
  return [
    companyCharter(),
    department.job?.trim() || jobFor(department.id) || `[직무: ${department.name}]`,
    `[부서 사명]\n${department.mission}`,
    department.goals.trim() ? `[CEO 가 정한 부서 목표]\n${department.goals}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// First line "요약: ..." → summary; the rest is the report body.
export function splitReport(text: string): { summary: string; body: string } {
  const lines = text.trim().split("\n");
  const first = lines[0]?.trim() ?? "";
  const match = first.match(/^\**요약\**\s*[:：]\s*(.+)$/);
  if (match) return { summary: match[1].trim().slice(0, 500), body: lines.slice(1).join("\n").trim() };
  const fallback = text.replace(/[#*`>\-]/g, " ").replace(/\s+/g, " ").trim();
  return { summary: fallback.slice(0, 200), body: text.trim() };
}
