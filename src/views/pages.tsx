import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { Department, Task, TaskEvent, Proposal } from "../db";
import type { Knowledge, CompanyProfile } from "../company/memory";
import { currentCompany } from "../company/charter";
import { jobFor } from "../company/departments";
import type { ScoreRow } from "../company/scoreboard";
import { isPlaybook, playbookTitle } from "../company/playbooks";

const CSS = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e4e2dc;--accent:#5b4bdb;--ok:#1f8a4c;--warn:#b7791f;--bad:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d21;--ink:#ececef;--muted:#9a9aa3;--line:#2c2c33;--accent:#8f82ff;--ok:#4cc083;--warn:#e0a84a;--bad:#ef6b5b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
a{color:inherit}header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;z-index:1}
header b{font-size:17px}.brand{display:flex;align-items:center;gap:8px;text-decoration:none}.brand img{height:18px;width:auto;display:block}header nav{margin-left:auto;display:flex;gap:12px;font-size:14px;flex-wrap:wrap;justify-content:flex-end}
main{max-width:980px;margin:0 auto;padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.card h3{margin:0 0 4px;font-size:16px}.muted{color:var(--muted);font-size:13px}
.stats{display:flex;gap:10px;margin-top:10px;font-size:13px}.stats span{background:var(--bg);border-radius:8px;padding:2px 8px}
.pill{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;border:1px solid var(--line)}
.s-pending{color:var(--warn);border-color:var(--warn)}.s-approved{color:var(--ok);border-color:var(--ok)}.s-rejected{color:var(--bad);border-color:var(--bad)}.s-held{color:var(--muted)}.s-queued{color:var(--muted)}.s-working{color:var(--warn);border-color:var(--warn)}.s-done{color:var(--ok);border-color:var(--ok)}.s-failed{color:var(--bad);border-color:var(--bad)}.s-cancelled{color:var(--muted)}
ul.tasks{list-style:none;margin:0;padding:0}ul.tasks li{padding:10px 0;border-bottom:1px solid var(--line)}ul.tasks li:last-child{border:0}
ul.tasks a{text-decoration:none;font-weight:600}
form.order textarea,form textarea{width:100%;min-height:90px;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--bg);color:var(--ink);font:inherit}
select,input[type=password]{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--bg);color:var(--ink);font:inherit}
button{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.report{overflow-wrap:anywhere}.report h2{font-size:17px;margin:18px 0 6px}.report h3{font-size:15px}
.report pre{white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:8px}
.report table{border-collapse:collapse;display:block;overflow-x:auto}.report td,.report th{border:1px solid var(--line);padding:4px 8px}
h1{font-size:22px;margin:4px 0 12px}h2{font-size:17px;margin:22px 0 10px}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:4px}.bar>i{display:block;height:100%;background:var(--accent)}
table.score{width:100%;border-collapse:collapse;font-size:14px}table.score th,table.score td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}table.score th:first-child,table.score td:first-child{text-align:left}
.scroll{overflow-x:auto}
.timeline{font-size:13px}.timeline div{padding:4px 0;border-left:2px solid var(--line);padding-left:10px}
`;

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  working: "작업 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소",
  pending: "결재 대기",
  approved: "승인",
  rejected: "거절",
  held: "보류",
};
const KIND_LABEL: Record<string, string> = { lesson: "교훈", fact: "사실", decision: "CEO 결정", feedback: "CEO 피드백" };

export function kstTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export const Layout: FC<PropsWithChildren<{ title: string; authed?: boolean }>> = ({ title, authed = true, children }) => (
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · {currentCompany().name} AI 본사</title>
      <meta name="apple-mobile-web-app-title" content={`${currentCompany().name} 본사`} />
      <meta name="theme-color" content="#000000" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="icon" type="image/png" href="/apple-touch-icon.png" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <style>{raw(CSS)}</style>
    </head>
    <body>
      <header>
        <a href="/" class="brand" aria-label="본사 홈">
          <b>🏢 {currentCompany().name} AI 본사</b>
        </a>
        {authed && (
          <nav>
            <a href="/">조직도</a>
            <a href="/proposals">제안함</a>
            <a href="/scoreboard">성과</a>
            <a href="/tasks">업무</a>
            <a href="/knowledge">기억</a>
            <a href="/knowledge?playbooks=1">매뉴얼</a>
            <a href="/vision">비전</a>
            <a href="/setup">설치</a>
            <form method="post" action="/logout" style="display:inline">
              <button class="ghost" style="padding:2px 10px">로그아웃</button>
            </form>
          </nav>
        )}
      </header>
      <main>{children}</main>
    </body>
  </html>
);

const StatusPill: FC<{ status: string }> = ({ status }) => <span class={`pill s-${status}`}>{STATUS_LABEL[status] ?? status}</span>;

export const TaskList: FC<{ tasks: Task[]; departments: Department[]; showDept?: boolean }> = ({ tasks, departments, showDept = true }) =>
  tasks.length === 0 ? (
    <p class="muted">아직 없습니다.</p>
  ) : (
    <ul class="tasks">
      {tasks.map((t) => {
        const d = departments.find((x) => x.id === t.department);
        return (
          <li>
            <StatusPill status={t.status} /> {showDept && d ? `${d.emoji} ${d.name} · ` : ""}
            <a href={`/t/${t.id}`}>{t.title}</a>
            <div class="muted">
              {kstTime(t.finished_at ?? t.started_at ?? t.created_at)}
              {t.summary ? ` — ${t.summary.slice(0, 120)}` : ""}
            </div>
          </li>
        );
      })}
    </ul>
  );

export const OrderForm: FC<{ departments: Department[]; preset?: string }> = ({ departments, preset }) => (
  <form class="order card" method="post" action="/orders">
    <h3>📝 업무 지시</h3>
    <textarea name="instruction" required placeholder="예: 다음 달 매출 올릴 방법 3가지 찾아줘" />
    <div class="row">
      <select name="department">
        <option value="cos" selected={!preset}>🧭 비서실에 맡기기 (알맞은 부서로 자동 배분)</option>
        {departments
          .filter((d) => d.id !== "cos")
          .map((d) => (
            <option value={d.id} selected={preset === d.id}>
              {d.emoji} {d.name}에 직접 지시
            </option>
          ))}
      </select>
      <button>지시하기</button>
    </div>
  </form>
);

export type DeptStats = { queued: number; working: number; doneToday: number; latest?: Task };

export const HomePage: FC<{
  departments: Department[];
  stats: Record<string, DeptStats>;
  recent: Task[];
  usage: number;
  limit: number;
  paused: boolean;
  pendingProposals: number;
  memoryCount: number;
}> = (p) => (
  <Layout title="조직도">
    {p.paused && <p class="card" style="color:var(--bad)">⛔ AGENTS_ENABLED=false — 모든 부서가 정지 중입니다.</p>}
    {p.pendingProposals > 0 && (
      <a class="card" href="/proposals" style="display:block;margin-bottom:12px;text-decoration:none;border-color:var(--warn)">
        🚀 <b>결재 대기 제안 {p.pendingProposals}건</b> — 부서들이 스스로 찾은 개선안이 기다리고 있습니다 →
      </a>
    )}
    <OrderForm departments={p.departments} />
    <h2>조직도</h2>
    <p class="muted">
      오늘 두뇌 사용 {p.usage} / {p.limit}회 (무료 한도) · 🧠 회사의 기억 {p.memoryCount}개
    </p>
    <div class="grid">
      {p.departments.map((d) => {
        const s = p.stats[d.id] ?? { queued: 0, working: 0, doneToday: 0 };
        const state = s.working ? "작업 중" : s.queued ? "대기 업무 있음" : "대기";
        return (
          <a class="card" href={`/d/${d.id}`} style="text-decoration:none">
            <h3>
              {d.emoji} {d.name}
            </h3>
            <div class="muted">{d.mission}</div>
            <div class="stats">
              <span>{state}</span>
              <span>진행 {s.working + s.queued}</span>
              <span>오늘 완료 {s.doneToday}</span>
            </div>
            {s.latest && <div class="muted" style="margin-top:8px">최근: {s.latest.title}</div>}
          </a>
        );
      })}
    </div>
    <h2>최근 업무</h2>
    <div class="card">
      <TaskList tasks={p.recent} departments={p.departments} />
    </div>
  </Layout>
);

export const DepartmentPage: FC<{
  dept: Department;
  departments: Department[];
  open: Task[];
  history: Task[];
  memories: Knowledge[];
}> = ({ dept, departments, open, history, memories }) => (
  <Layout title={dept.name}>
    <h1>
      {dept.emoji} {dept.name}
    </h1>
    <p>{dept.mission}</p>
    <form class="card" method="post" action={`/d/${dept.id}/goals`}>
      <h3>🎯 부서 목표 (CEO 지정)</h3>
      <p class="muted">여기 적은 목표는 이 부서의 모든 업무에 반영됩니다.</p>
      <textarea name="goals">{dept.goals}</textarea>
      <details style="margin-top:10px">
        <summary>✏️ 부서 사명과 직무 고치기</summary>
        <p class="muted">직무는 이 부서가 일하는 방식입니다. 우리 회사에 맞게 고치면 결과가 더 좋아집니다. 비우면 기본 직무로 돌아갑니다.</p>
        <label>사명</label>
        <textarea name="mission" style="min-height:60px">{dept.mission}</textarea>
        <label>직무</label>
        <textarea name="job" style="min-height:200px">{dept.job ?? jobFor(dept.id) ?? ""}</textarea>
      </details>
      <div class="row">
        <button>저장</button>
      </div>
    </form>
    <h2>진행 중 · 대기</h2>
    <div class="card">
      <TaskList tasks={open} departments={departments} showDept={false} />
    </div>
    <h2>🧠 이 부서의 기억 (중요한 순)</h2>
    <div class="card">
      <KnowledgeList items={memories} />
      <p class="muted">
        <a href={`/knowledge?dept=${dept.id}`}>전체 보기</a>
      </p>
    </div>
    <h2>지난 업무 (최근 30건)</h2>
    <div class="card">
      <TaskList tasks={history} departments={departments} showDept={false} />
    </div>
    <h2>이 부서에 지시</h2>
    <OrderForm departments={departments} preset={dept.id} />
  </Layout>
);

export const TaskPage: FC<{ task: Task; dept?: Department; departments: Department[]; events: TaskEvent[]; children: Task[]; parent: Task | null; reportHtml: string | null }> = (p) => (
  <Layout title={p.task.title}>
    <p class="muted">
      <a href={`/d/${p.task.department}`}>
        {p.dept?.emoji} {p.dept?.name}
      </a>
      {p.parent && (
        <>
          {" · 상위 업무: "}
          <a href={`/t/${p.parent.id}`}>{p.parent.title}</a>
        </>
      )}
    </p>
    <h1>{p.task.title}</h1>
    <div class="row">
      <StatusPill status={p.task.status} />
      <span class="muted">생성 {kstTime(p.task.created_at)}</span>
      {p.task.finished_at && <span class="muted">· 완료 {kstTime(p.task.finished_at)}</span>}
      {p.task.status === "queued" && (
        <form method="post" action={`/t/${p.task.id}/cancel`}>
          <button class="ghost">취소</button>
        </form>
      )}
      {p.task.status === "failed" && (
        <form method="post" action={`/t/${p.task.id}/retry`}>
          <button class="ghost">다시 시도</button>
        </form>
      )}
      {p.task.result_md && (
        <a class="pill" href={`/t/${p.task.id}/report.md`}>
          📄 보고서 파일 받기
        </a>
      )}
      {p.task.result_md && (
        <a class="pill" href={`/t/${p.task.id}/print`}>
          🖨 인쇄/PDF
        </a>
      )}
      {p.task.status === "done" && p.task.result_md && (
        <>
          <form method="post" action={`/t/${p.task.id}/good`}>
            <button class="ghost">👍 좋아요</button>
          </form>
          <form method="post" action={`/t/${p.task.id}/next`}>
            <button>▶️ 다음 단계로</button>
          </form>
          <form method="post" action={`/t/${p.task.id}/apply`}>
            <button class="ghost">🛠 실제로 적용하기</button>
          </form>
        </>
      )}
    </div>
    {p.task.summary && (
      <div class="card" style="margin-top:12px">
        <b>요약</b> {p.task.summary}
      </div>
    )}
    {p.task.error && p.task.status !== "done" && (
      <div class="card" style="margin-top:12px;color:var(--bad)">오류: {p.task.error}</div>
    )}
    {p.children.length > 0 && (
      <>
        <h2>부서별 하위 업무</h2>
        <div class="card">
          <TaskList tasks={p.children} departments={p.departments} />
        </div>
      </>
    )}
    {p.reportHtml && (
      <>
        <h2>보고서</h2>
        <div class="card report">{raw(p.reportHtml)}</div>
      </>
    )}
    {p.task.status === "done" && p.task.result_md && (
      <form class="card" method="post" action={`/t/${p.task.id}/feedback`} style="margin-top:12px">
        <h3>💬 피드백 남기기</h3>
        <p class="muted">여기 쓴 말은 이 부서의 최우선 기억이 되어, 앞으로 모든 업무에 반영됩니다.</p>
        <textarea name="feedback" required placeholder="예: 숫자 근거 없이 추측한 부분이 많다. 다음부터 데이터가 없으면 없다고 먼저 말해." />
        <div class="row">
          <button>기억시키기</button>
        </div>
      </form>
    )}
    <h2>지시 내용</h2>
    <div class="card report">
      <pre>{p.task.instruction}</pre>
    </div>
    <h2>진행 기록</h2>
    <div class="timeline">
      {p.events.map((e) => (
        <div>
          <span class="muted">{kstTime(e.at)}</span> {e.message}
        </div>
      ))}
    </div>
  </Layout>
);

export const AllTasksPage: FC<{ tasks: Task[]; departments: Department[] }> = ({ tasks, departments }) => (
  <Layout title="전체 업무">
    <h1>전체 업무 (최근 100건)</h1>
    <div class="card">
      <TaskList tasks={tasks} departments={departments} />
    </div>
  </Layout>
);

export const LoginPage: FC<{ error?: string }> = ({ error }) => (
  <Layout title="로그인" authed={false}>
    <form class="card" method="post" action="/login" style="max-width:360px;margin:40px auto">
      <h3>CEO 로그인</h3>
      {error && <p style="color:var(--bad)">{error}</p>}
      <input type="password" name="password" placeholder="비밀번호" required style="width:100%" autofocus />
      <div class="row">
        <button>들어가기</button>
      </div>
    </form>
  </Layout>
);

export const KnowledgeList: FC<{ items: Knowledge[]; departments?: Department[]; manage?: boolean }> = ({ items, departments, manage }) =>
  items.length === 0 ? (
    <p class="muted">아직 쌓인 기억이 없습니다. 업무가 끝날 때마다 늘어납니다.</p>
  ) : (
    <ul class="tasks">
      {items.map((k) => {
        const d = departments?.find((x) => x.id === k.department);
        return (
          <li>
            {isPlaybook(k.content) ? <span class="pill" style="border-color:var(--accent);color:var(--accent)">📘 대응 매뉴얼</span> : <span class="pill">{KIND_LABEL[k.kind] ?? k.kind}</span>}{" "}
            {k.weight > 1 && <span class="pill">×{k.weight}</span>}{" "}
            {departments && <span class="muted">{d ? `${d.emoji} ${d.name}` : "🏢 전사"} · </span>}
            {isPlaybook(k.content) ? (
              <details style="display:inline">
                <summary style="display:inline;cursor:pointer;font-weight:600">{playbookTitle(k.content)}</summary>
                <div style="white-space:pre-wrap;margin-top:6px">{k.content.split("\n").slice(1).join("\n")}</div>
              </details>
            ) : (
              k.content
            )}
            <div class="muted">
              {kstTime(k.updated_at)}
              {k.source_task && (
                <>
                  {" · "}
                  <a href={`/t/${k.source_task}`}>출처 업무</a>
                </>
              )}
            </div>
            {manage && (
              <form method="post" action={`/knowledge/${k.id}/forget`} style="margin-top:4px">
                <button class="ghost" style="padding:2px 10px;font-size:12px">잊게 하기</button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );

export const KnowledgePage: FC<{ items: Knowledge[]; departments: Department[]; dept?: string; playbooks?: boolean }> = ({ items, departments, dept, playbooks }) => (
  <Layout title="회사의 기억">
    <h1>🧠 회사의 기억</h1>
    <p class="muted">부서가 일하며 배운 점, 사장님의 피드백과 결정입니다. 모든 업무에서 관련 있는 기억을 찾아 참고합니다. 틀린 기억은 "잊게 하기"로 지우세요.</p>
    <div class="row">
      <a class="pill" href="/knowledge/export.md">📥 전체 기억 파일로 받기</a>
      <form method="post" action="/knowledge/backup">
        <button class="ghost" style="padding:2px 10px">📨 지금 텔레그램으로 백업</button>
      </form>
      <span class="muted">매주 일요일 20시에 자동으로 텔레그램 백업이 옵니다.</span>
    </div>
    <form class="row" method="get" action="/knowledge">
      <select name="dept">
        <option value="">전체</option>
        {departments.map((d) => (
          <option value={d.id} selected={dept === d.id}>
            {d.emoji} {d.name}
          </option>
        ))}
      </select>
      <label class="muted">
        <input type="checkbox" name="playbooks" value="1" checked={playbooks} /> 📘 대응 매뉴얼만
      </label>
      <button class="ghost">보기</button>
    </form>
    {playbooks && (
      <p class="card muted">
        📘 대응 매뉴얼은 "이런 일이 생기면 이렇게 한다"를 미리 적어 둔 것입니다. 부서마다 일주일에 한 번(14시) 대비 훈련을 하며 늘어나고, 비슷한 상황이 실제로 생기면 부서가 먼저 꺼내 봅니다. 제목을 누르면 내용이 펼쳐집니다.
      </p>
    )}
    {playbooks && (
      <form method="post" action="/knowledge/drill" class="row">
        <button>🏋️ 지금 전 부서 대비 훈련 시작</button>
        <span class="muted">7개 부서가 매뉴얼을 2~3개씩 만듭니다. 무료 두뇌 한도에 따라 몇 시간에 걸쳐 끝날 수 있습니다.</span>
      </form>
    )}
    <form class="card" method="post" action="/knowledge" style="margin-top:12px">
      <h3>✍️ 직접 가르치기</h3>
      <textarea name="content" required placeholder="예: 우리는 할인 경쟁을 하지 않는다. 가격 인하 제안은 하지 않는다." />
      <div class="row">
        <select name="department">
          <option value="">🏢 전사 공통</option>
          {departments.map((d) => (
            <option value={d.id} selected={dept === d.id}>
              {d.emoji} {d.name}
            </option>
          ))}
        </select>
        <button>기억시키기</button>
      </div>
    </form>
    <h2>기억 목록 (최근 150개, 중요한 순)</h2>
    <div class="card">
      <KnowledgeList items={items} departments={departments} manage />
    </div>
  </Layout>
);

export const VisionPage: FC<{ profile: CompanyProfile | null; statusNote: string }> = ({ profile, statusNote }) => (
  <Layout title="비전">
    <h1>🎯 회사 비전과 현황</h1>
    <p class="muted">모든 부서가 모든 업무와 자율 제안에서 이 내용을 기준으로 삼습니다.</p>
    <form class="card" method="post" action="/vision">
      <h3>📊 지금 회사 현황 (숫자)</h3>
      <p class="muted">부서들은 여기 적힌 숫자만 사실로 씁니다. 매주 한 번 고쳐 주면 보고서가 훨씬 정확해집니다.</p>
      <textarea name="statusNote" style="min-height:120px" placeholder="예) 9월 매출 1,850만 원 (8월 1,620만) / 온라인 주문 312건 / 재구매율 34% / 인스타 팔로워 2,100 / 이번 달 고민: 평일 오후 손님이 적음">
        {statusNote}
      </textarea>
      <h3 style="margin-top:14px">비전</h3>
      <textarea name="vision" required style="min-height:100px">{profile?.vision ?? ""}</textarea>
      <h3 style="margin-top:14px">전략 (우선순위, 하지 않을 것 등)</h3>
      <textarea name="strategy" style="min-height:140px">{profile?.strategy ?? ""}</textarea>
      <div class="row">
        <button>저장</button>
        {profile && <span class="muted">마지막 수정 {kstTime(profile.updated_at)}</span>}
      </div>
    </form>
  </Layout>
);

export const ProposalsPage: FC<{ proposals: Proposal[]; departments: Department[] }> = ({ proposals, departments }) => (
  <Layout title="제안함">
    <h1>🚀 자율 제안함</h1>
    <p class="muted">부서들이 스스로 찾은 문제와 개선안입니다. 승인하면 그 부서의 업무가 되고, 거절하면 같은 제안을 다시 하지 않습니다.</p>
    {proposals.length === 0 && <p class="card muted">아직 제안이 없습니다. 매일 10시에 각 부서가 자율 점검을 합니다.</p>}
    {proposals.map((p) => {
      const d = departments.find((x) => x.id === p.department);
      const open = p.status === "pending" || p.status === "held";
      return (
        <div class="card" style="margin-bottom:12px">
          <div class="row" style="margin-top:0">
            <StatusPill status={p.status} />
            <span class="muted">
              {d?.emoji} {d?.name} · {kstTime(p.created_at)}
            </span>
          </div>
          <h3 style="margin-top:8px">{p.title}</h3>
          <p>
            <b>문제</b> {p.problem}
          </p>
          <p>
            <b>제안</b> {p.proposal}
          </p>
          {p.impact && (
            <p>
              <b>기대 효과</b> {p.impact}
            </p>
          )}
          {p.effort && <p class="muted">규모: {p.effort}</p>}
          {p.ceo_note && <p class="muted">CEO 메모: {p.ceo_note}</p>}
          {p.action && <p class="muted">⚙️ 승인 시 실행: {p.action.type === "hide_product" ? `상품 비노출 (${p.action.productTitle ?? p.action.productId})` : p.action.type}</p>}
          {p.action_result && <p>결과: {p.action_result}</p>}
          {p.task_id && (
            <p>
              <a href={`/t/${p.task_id}`}>→ 전환된 업무 보기</a>
            </p>
          )}
          {open && (
            <form method="post" action={`/proposals/${p.id}`}>
              <textarea name="note" placeholder="메모 (선택) — 이유를 남기면 부서가 기억합니다" style="min-height:50px" />
              <div class="row">
                <button name="decision" value="approve">✅ 승인</button>
                {p.status === "pending" && (
                  <button class="ghost" name="decision" value="hold">
                    ⏸ 보류
                  </button>
                )}
                <button class="ghost" name="decision" value="reject">
                  ❌ 거절
                </button>
              </div>
            </form>
          )}
        </div>
      );
    })}
  </Layout>
);

const PROVIDER_LABEL: Record<string, string> = { gemini: "Gemini", workers_ai: "Workers AI", embed: "기억 검색", whisper: "음성 인식" };

export const ScoreboardPage: FC<{ rows: ScoreRow[]; days: number; usage: { provider: string; calls: number }[] }> = ({ rows, days, usage }) => {
  const maxDone = Math.max(1, ...rows.map((r) => r.done));
  return (
    <Layout title="성과">
      <h1>📊 부서별 성과 점수판</h1>
      <div class="row">
        {[7, 30, 90].map((d) => (
          <a class="pill" href={`/scoreboard?days=${d}`} style={d === days ? "border-color:var(--accent);color:var(--accent)" : ""}>
            최근 {d}일
          </a>
        ))}
      </div>
      <p class="muted">기록된 업무·제안·기억을 그대로 센 숫자입니다. AI 가 매긴 점수가 아닙니다.</p>
      <div class="card scroll">
        <table class="score">
          <tr>
            <th>부서</th>
            <th>완료</th>
            <th>실패</th>
            <th>평균 처리</th>
            <th>제안</th>
            <th>승인율</th>
            <th>배운 점</th>
            <th>강화</th>
            <th>피드백</th>
          </tr>
          {rows.map((r) => (
            <tr>
              <td>
                <a href={`/d/${r.department.id}`}>
                  {r.department.emoji} {r.department.name}
                </a>
                <div class="bar">
                  <i style={`width:${Math.round((r.done / maxDone) * 100)}%`} />
                </div>
              </td>
              <td>{r.done}</td>
              <td style={r.failed ? "color:var(--bad)" : ""}>{r.failed}</td>
              <td>{r.avgMinutes === null ? "-" : `${r.avgMinutes}분`}</td>
              <td>
                {r.proposals}
                {r.pending ? <span class="muted"> (대기 {r.pending})</span> : ""}
              </td>
              <td>{r.approvalRate === null ? "-" : `${r.approvalRate}%`}</td>
              <td>{r.learned}</td>
              <td>{r.reinforced}</td>
              <td>{r.feedback}</td>
            </tr>
          ))}
        </table>
      </div>
      <p class="muted">강화: 같은 교훈을 다시 배워 기억이 더 단단해진 횟수 · 피드백: 사장님이 남긴 피드백 수</p>

      <h2>🧠 최근 배운 점</h2>
      <div class="grid">
        {rows
          .filter((r) => r.recentLessons.length)
          .map((r) => (
            <div class="card">
              <h3>
                {r.department.emoji} {r.department.name}
              </h3>
              <ul style="margin:6px 0 0;padding-left:18px">
                {r.recentLessons.map((l) => (
                  <li>{l}</li>
                ))}
              </ul>
            </div>
          ))}
        {rows.every((r) => !r.recentLessons.length) && <p class="muted">이 기간에 새로 배운 점이 아직 없습니다.</p>}
      </div>

      <h2>⚙️ 두뇌 사용량 (최근 {days}일)</h2>
      <div class="card">
        {usage.length === 0 ? (
          <p class="muted">사용 기록이 없습니다.</p>
        ) : (
          usage.map((u) => (
            <div>
              {PROVIDER_LABEL[u.provider] ?? u.provider}: <b>{u.calls}</b>회
            </div>
          ))
        )}
      </div>
    </Layout>
  );
};

// A standalone, light-only page for the browser's "인쇄 → PDF로 저장".
const PRINT_CSS = `
body{margin:0;background:#fff;color:#111;font:14px/1.65 "Apple SD Gothic Neo","Noto Sans KR",-apple-system,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 24px}
.meta{color:#555;font-size:12px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:18px}
h1{font-size:24px;margin:0 0 6px}.summary{background:#f3f3f3;border-radius:8px;padding:10px 14px;margin:0 0 18px}
.report h2{font-size:17px;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}.report h3{font-size:15px}
.report table{border-collapse:collapse;width:100%}.report td,.report th{border:1px solid #bbb;padding:4px 8px;text-align:left}
.report pre{white-space:pre-wrap;background:#f6f6f6;padding:8px;border-radius:6px}
.tools{position:sticky;top:0;background:#fff;padding:10px 0;display:flex;gap:10px}
.tools button{background:#111;color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer}.tools a{align-self:center;color:#555}
footer{margin-top:28px;color:#777;font-size:11px;border-top:1px solid #ddd;padding-top:8px}
@media print{.tools{display:none}main{padding:0}@page{margin:16mm}}
`;

export const PrintPage: FC<{ task: Task; dept?: Department; reportHtml: string }> = ({ task, dept, reportHtml }) => (
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="color-scheme" content="light" />
      <title>{task.title}</title>
      <style>{raw(PRINT_CSS)}</style>
    </head>
    <body>
      <main>
        <div class="tools">
          <button onclick="window.print()">🖨 인쇄 / PDF로 저장</button>
          <a href={`/t/${task.id}`}>← 돌아가기</a>
        </div>
        <div class="meta">
          {currentCompany().name} AI 본사 · {dept ? `${dept.emoji} ${dept.name}` : task.department} · {kstTime(task.finished_at ?? task.created_at)}
        </div>
        <h1>{task.title}</h1>
        {task.summary && <p class="summary">{task.summary}</p>}
        <div class="report">{raw(reportHtml)}</div>
        <footer>AI 부서가 작성한 문서입니다. 숫자는 회사 기록에서 코드가 센 값과 CEO 가 적은 현황이며, 판단은 CEO 가 합니다.</footer>
      </main>
    </body>
  </html>
);
