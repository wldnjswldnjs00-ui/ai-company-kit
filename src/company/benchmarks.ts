import type { Department } from "../db";

// 벤치마킹: every night each department studies one company that already
// does well what we want to do — the companies the CEO listed on the setup
// screen, or, if none, leading companies in our industry that the
// department picks itself. It searches the web, cites sources and keeps
// what we can borrow as "## 배운 점" (saved to the company's memory like
// any other lesson). Reports aren't sent one by one; the evening report
// lists them.

export const BENCHMARK_TITLE_PREFIX = "벤치마킹";
const FIRST_HOUR = 0;
const LAST_HOUR = 7;

// What each department looks for.
export const BENCHMARK_ANGLES: Record<string, string> = {
  cos: "초기 몇 년의 전략 선택, 무엇에 집중하고 무엇을 포기했는지, 의사결정 원칙",
  ops: "일이 매끄럽게 돌아가게 만든 운영 방식, 품질 관리, 사고를 줄인 장치",
  cs: "고객 응대 구조, 환불·불만 처리 방식, 불만을 신뢰로 바꾼 사례",
  marketing: "처음 고객을 모은 방법, 브랜드 메시지, 입소문이 난 이유",
  sales: "첫 거래처를 만든 방법, 가격 제안 방식, 재구매·재계약을 이끈 장치",
  finance: "가격과 수익 구조, 비용 관리, 돈이 도는 흐름",
  data: "공개된 핵심 지표와 성장 수치, 무엇을 재고 어떻게 실험했는지",
  product: "상품·서비스를 고르고 개선한 방식, 고객이 가장 좋아한 기능",
  legal: "지켜야 했던 법과 규제, 약관, 분쟁·제재 사례",
  future: "최근 1~2년 새로 내놓은 기능·서비스, 그중 반응이 좋았던 것",
  qa: "고객이 처음 방문해서 구매·문의까지 가는 과정의 편의성, 헷갈리지 않게 만든 장치",
  people: "적은 인원으로 일하는 방식, 채용과 교육, 조직 문화",
  audit: "실패·논란·제재 사례, 신뢰를 잃은 사건과 그 뒤에 바꾼 것",
};

export const benchmarkTitle = (deptName: string) => `${BENCHMARK_TITLE_PREFIX} · ${deptName}`;

export function isBenchmark(title: string): boolean {
  return title.startsWith(BENCHMARK_TITLE_PREFIX);
}

// "쿠팡, 아마존\n스타벅스" → ["쿠팡", "아마존", "스타벅스"]
export function parseBenchmarkList(text: string | undefined): string[] {
  return [...new Set((text ?? "").split(/[,\n、·]+/).map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 30);
}

// Departments study different companies on the same day, and each one goes
// through the whole list over the days. null = let the department choose.
export function benchmarkCompany(list: string[], departmentIndex: number, dayIndex: number): string | null {
  if (!list.length) return null;
  const n = list.length;
  return list[(((dayIndex + departmentIndex) % n) + n) % n];
}

// One department an hour through the night, wrapping when there are more
// departments than hours.
export function benchmarkHour(departmentIndex: number): number {
  return FIRST_HOUR + (departmentIndex % (LAST_HOUR - FIRST_HOUR + 1));
}

export function benchmarkInstruction(dept: Pick<Department, "id" | "name">, company: string | null): string {
  const angle = BENCHMARK_ANGLES[dept.id] ?? "우리 부서 일과 관련된 운영 방식";
  const target = company
    ? `오늘 공부할 회사: ${company}`
    : `오늘 공부할 회사는 직접 고른다. 우리 회사 업종에서 가장 잘하는 회사(대기업이나 앞서가는 회사) 중 하나를 고르고, [회사의 기억] 에 이미 있는 회사는 피한다.`;
  return `오늘의 벤치마킹. 이미 잘하고 있는 회사에서 배운다.
${target}
${dept.name} 의 눈으로 본다. 볼 것: ${angle}.

- 반드시 최신 자료를 검색하고, 사실마다 출처를 붙인다. 출처를 못 찾은 내용은 "확인 필요"로 쓴다. 숫자를 지어내지 않는다.
- 이미 [회사의 기억] 에 있는 배운 점은 다시 쓰지 않는다. 같은 회사라도 새로운 면을 본다.
- 그 회사와 우리 회사의 차이(규모, 돈, 사람, 단계)를 생각해서, 그대로 따라 할 것과 바꿔서 쓸 것과 따라 하면 안 되는 것을 나눈다.

보고서 형식:
요약: (어느 회사에서 무엇을 배웠는지 한두 문장)
## 무엇을 했나
(사실 2~4개, 출처 포함)
## 왜 통했나
(사람의 심리나 구조로 설명)
## 우리 회사에 적용한다면
(작게 시작하는 방법, 필요한 것, 예상 효과)
## 따라 하면 안 되는 것
## 배운 점
- (회사 이름) 한 문장짜리 배운 점 1~3개`;
}
