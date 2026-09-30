import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { Department, Task, TaskEvent, Proposal } from "../db";
import type { Knowledge, CompanyProfile } from "../company/memory";
import { currentCompany } from "../company/charter";
import { currentBrand, brandUrl } from "../brand";
import { KIT_VERSION } from "../version";
import { Icon, DeptIcon } from "./icons";
import { MemoryGraph, graphData, MEMGRAPH_CSS } from "./memgraph";
import { jobFor } from "../company/departments";
import type { ScoreRow } from "../company/scoreboard";
import { isPlaybook, playbookTitle } from "../company/playbooks";

const CSS = `
:root{--bg:#f3f3f1;--card:#fff;--ink:#17171a;--muted:#6f6f76;--line:#ebebe8;--accent:#f0611a;--accent-soft:#fdeee5;--btn:#17171a;--btn-ink:#fff;--side:#161618;--side-ink:#d9d9de;--side-on:#2a2a2e;--ok:#1f8a4c;--warn:#c47a12;--bad:#d13b2b;--shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.04)}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e10;--card:#19191c;--ink:#ececef;--muted:#9a9aa3;--line:#27272b;--accent:#ff7a38;--accent-soft:#3a2216;--btn:#ececef;--btn-ink:#111;--side:#08080a;--side-ink:#c9c9d0;--side-on:#1f1f23;--ok:#4cc083;--warn:#e0a84a;--bad:#ef6b5b;--shadow:none}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
.shell{display:flex;min-height:100vh}
.side{width:232px;flex:none;background:var(--side);color:var(--side-ink);padding:22px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:9px;text-decoration:none;color:#fff;padding:2px 10px 26px}
.side nav{display:flex;flex-direction:column;gap:4px}
.side nav a{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:12px;text-decoration:none;font-size:14.5px;color:var(--side-ink);border:1px solid transparent}
.side nav a:hover{background:var(--side-on)}.side nav a.on{background:var(--side-on);border-color:#3a3a40;color:#fff}
.side svg{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.side .bottom{margin-top:auto}.side .bottom button{display:flex;align-items:center;gap:12px;width:100%;background:transparent;color:var(--side-ink);padding:9px 12px;font-weight:500;border-radius:12px}.side .bottom button:hover{background:var(--side-on)}
main{flex:1;min-width:0;max-width:1180px;padding:28px 32px 60px}
header.top{display:none}
@media (max-width:860px){
  .shell{display:block}.side{display:none}
  header.top{display:block;position:sticky;top:0;z-index:2;background:var(--side);color:#fff;padding:12px 16px 0}
  header.top .brand{padding:0 0 10px}
  header.top nav{display:flex;align-items:center;gap:4px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none}header.top nav::-webkit-scrollbar{display:none}
  header.top nav a{flex:none;padding:6px 12px;border-radius:999px;text-decoration:none;font-size:14px;color:var(--side-ink)}header.top nav a.on{background:#fff;color:#111}
  main{padding:18px 16px 48px}
}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;box-shadow:var(--shadow)}
.card h3{margin:0 0 6px;font-size:16px;font-weight:650}.muted{color:var(--muted);font-size:13px}
a.card{transition:border-color .15s}a.card:hover{border-color:#d4d4cf}
.kpis{margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;padding:0;overflow:hidden}
.kpis>*{display:block;padding:16px 20px;border-right:1px solid var(--line)}.kpis>*:last-child{border:0}
.kpis .n{font-size:32px;font-weight:650;letter-spacing:-.02em;line-height:1.2;margin-top:4px}.kpis .n small{font-size:14px;color:var(--muted);font-weight:500}
.kpis a{text-decoration:none}.kpis .hot .n{color:var(--accent)}
.stats{display:flex;gap:8px;margin-top:12px;font-size:12.5px;flex-wrap:wrap}.stats span{background:var(--bg);border-radius:999px;padding:3px 10px}
.pill{display:inline-block;font-size:12px;border-radius:999px;padding:2px 9px;border:1px solid var(--line);font-weight:500}
.s-pending{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}.s-approved{color:var(--ok);border-color:var(--ok)}.s-rejected{color:var(--bad);border-color:var(--bad)}.s-held{color:var(--muted)}.s-queued{color:var(--muted)}.s-working{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}.s-done{color:var(--ok);border-color:var(--ok)}.s-failed{color:var(--bad);border-color:var(--bad)}.s-cancelled{color:var(--muted)}
ul.tasks{list-style:none;margin:0;padding:0}ul.tasks li{padding:12px 0;border-bottom:1px solid var(--line)}ul.tasks li:last-child{border:0}
ul.tasks a{text-decoration:none;font-weight:600}ul.tasks a:hover{color:var(--accent)}
form.order textarea,form textarea{width:100%;min-height:90px;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--bg);color:var(--ink);font:inherit}
select{max-width:100%}
select,input[type=password],input[type=text],input:not([type]){border:1px solid var(--line);border-radius:999px;padding:8px 14px;background:var(--bg);color:var(--ink);font:inherit}
textarea:focus,select:focus,input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{background:var(--btn);color:var(--btn-ink);border:0;border-radius:999px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.report{overflow-wrap:anywhere}.report h2{font-size:17px;margin:20px 0 6px}.report h3{font-size:15px}
.report pre{white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:10px}
.report table{border-collapse:collapse;display:block;overflow-x:auto}.report td,.report th{border:1px solid var(--line);padding:5px 9px}
h1{font-size:26px;font-weight:700;letter-spacing:-.02em;margin:0 0 16px}h2{font-size:18px;font-weight:650;margin:28px 0 12px}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:4px}.bar>i{display:block;height:100%;background:var(--accent)}
table.score{width:100%;border-collapse:collapse;font-size:14px}table.score th{color:var(--muted);font-weight:500;font-size:13px}table.score th,table.score td{padding:10px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}table.score th:first-child,table.score td:first-child{text-align:left}
.scroll{overflow-x:auto}
.timeline{font-size:13px}.timeline div{padding:4px 0;border-left:2px solid var(--line);padding-left:10px}
.notice{display:block;text-decoration:none;border-color:var(--accent);background:var(--accent-soft);margin-bottom:14px}

.ic{width:1.05em;height:1.05em;flex:none;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;vertical-align:-0.16em}
.h-ic{display:inline-flex;align-items:center;gap:8px}h1.h-ic,h3.h-ic{display:flex}
.dept-ic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:var(--bg);border:1px solid var(--line);color:var(--ink);flex:none}
.dept-ic .ic{width:16px;height:16px;vertical-align:0}
h1 .dept-ic{width:38px;height:38px;border-radius:11px}h1 .dept-ic .ic{width:20px;height:20px}
.dept-inline{display:inline-flex;align-items:center;gap:6px}.dept-inline .dept-ic{width:22px;height:22px;border-radius:7px}.dept-inline .dept-ic .ic{width:13px;height:13px}
a.pill .ic,button .ic{margin-right:2px}
.mark{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;vertical-align:-4px;flex:none}
.mark .ic{width:12px;height:12px;stroke-width:2.6;vertical-align:0}
.mark-ok{background:#e7f5ec;color:var(--ok)}.mark-bad{background:#fdecea;color:var(--bad)}.mark-skip{background:var(--bg);color:var(--muted)}
@media (prefers-color-scheme:dark){.mark-ok{background:#16301f}.mark-bad{background:#3a1a17}}
.stepno{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--btn);color:var(--btn-ink);font-size:14px;font-weight:700;flex:none}
.stepno .ic{width:14px;height:14px;stroke-width:2.6;vertical-align:0}.stepno-done{background:var(--ok);color:#fff}
.swatch{display:inline-block;width:14px;height:14px;border-radius:4px;border:1px solid var(--line);vertical-align:-2px}
.brand-wrap{position:relative}
.brand-edit{position:absolute;right:4px;top:0;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;color:var(--side-ink);opacity:0;transition:opacity .15s,background .15s}
.brand-wrap:hover .brand-edit,.brand-edit:focus-visible{opacity:.75}.brand-edit:hover{opacity:1;background:var(--side-on)}
.brand-edit .ic{width:15px;height:15px;vertical-align:0}
@media (hover:none){.brand-edit{display:none}}
.brand .text{font-size:16px;font-weight:700;color:#fff;letter-spacing:-.01em}
.brand img{display:block;max-height:28px;max-width:170px;width:auto;height:auto;border-radius:8px}
body:not(.side-white) .brand img.logo-l{background:#fff;padding:4px 8px}
@media (prefers-color-scheme:dark){.brand img.logo-l{background:#fff;padding:4px 8px}}
.side .ver{font-size:11.5px;opacity:.55;padding:10px 12px 0}
body.side-white .side{border-right:1px solid var(--line)}
@media (prefers-color-scheme:light){
  body.side-white{--side:#fff;--side-ink:#3a3a40;--side-on:#f2f2ef}
  body.side-white .side nav a.on{border-color:#e2e2dd;color:#111}
  body.side-white .brand,body.side-white .brand .text{color:#111}
  body.side-white header.top nav a.on{background:#111;color:#fff}
  body.side-white header.top{border-bottom:1px solid var(--line)}
  body.side-white .brand img.logo-d{background:#111;padding:4px 8px}
}
${MEMGRAPH_CSS}`;

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

const NAV: [string, string, string][] = [
  ["/", "조직도", "home"],
  ["/proposals", "제안함", "inbox"],
  ["/scoreboard", "성과", "chart"],
  ["/tasks", "업무", "list"],
  ["/knowledge", "기억", "memory"],
  ["/knowledge?playbooks=1", "매뉴얼", "book"],
  ["/vision", "비전", "target"],
  ["/setup", "설정", "sliders"],
];

// Marks the menu item for the current page (department and report pages
// belong to 조직도 and 업무).
const ACTIVE_NAV = `(function(){var p=location.pathname,q=location.search,h=p.indexOf('/d/')===0?'/':p.indexOf('/t/')===0?'/tasks':p+(p==='/knowledge'&&q.indexOf('playbooks=1')>=0?'?playbooks=1':'');document.querySelectorAll('[data-nav]').forEach(function(a){if(a.getAttribute('href')===h)a.classList.add('on')})})()`;

// The company's logo, or its name when no logo was uploaded. A logo made
// for light backgrounds gets a white chip wherever the menu is dark, and
// the other way round (see .logo-l / .logo-d in CSS).
const BrandMark: FC = () => {
  const b = currentBrand();
  const light = brandUrl("logoLight", b);
  const dark = brandUrl("logoDark", b);
  const name = currentCompany().name;
  if (!light && !dark) return <span class="text">{name}</span>;
  if (b.theme === "black") return dark ? <img src={dark} alt={name} class="logo-d" /> : <img src={light} alt={name} class="logo-l" />;
  if (light && dark)
    return (
      <picture>
        <source srcset={dark} media="(prefers-color-scheme: dark)" />
        <img src={light} alt={name} />
      </picture>
    );
  return light ? <img src={light} alt={name} class="logo-l" /> : <img src={dark} alt={name} class="logo-d" />;
};

const Brand: FC = () => (
  <a href="/" class="brand" aria-label="본사 홈">
    <BrandMark />
  </a>
);

export const Layout: FC<PropsWithChildren<{ title: string; authed?: boolean }>> = ({ title, authed = true, children }) => (
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>
        {title} · {currentCompany().name} 본사
      </title>
      <meta name="apple-mobile-web-app-title" content={`${currentCompany().name} 본사`} />
      <meta name="theme-color" content={currentBrand().theme === "white" ? "#ffffff" : "#161618"} />
      <link rel="apple-touch-icon" href={brandUrl("icon") ?? "/apple-touch-icon.png"} />
      <link rel="icon" href={brandUrl("icon") ?? "/apple-touch-icon.png"} />
      <link rel="manifest" href="/manifest.webmanifest" />
      <style>{raw(CSS)}</style>
    </head>
    <body class={currentBrand().theme === "white" ? "side-white" : ""}>
      <div class="shell">
        <aside class="side">
          <div class="brand-wrap">
            <Brand />
            {authed && (
              <a href="/setup#brand" class="brand-edit" title="로고 바꾸기" aria-label="로고 바꾸기">
                <Icon name="pencil" />
              </a>
            )}
          </div>
          {authed && (
            <>
              <nav>
                {NAV.map(([href, label, icon]) => (
                  <a href={href} data-nav>
                    <Icon name={icon} />
                    {label}
                  </a>
                ))}
              </nav>
              <form method="post" action="/logout" class="bottom">
                <button>
                  <Icon name="logout" />
                  로그아웃
                </button>
                <div class="ver">AI 본사 {KIT_VERSION}</div>
              </form>
            </>
          )}
        </aside>
        <header class="top">
          <Brand />
          {authed && (
            <nav>
              {NAV.map(([href, label]) => (
                <a href={href} data-nav>
                  {label}
                </a>
              ))}
              <form method="post" action="/logout" style="flex:none">
                <button class="ghost" style="color:var(--side-ink);border-color:var(--line);padding:5px 12px">로그아웃</button>
              </form>
            </nav>
          )}
        </header>
        <main>{children}</main>
      </div>
      {authed && <script>{raw(ACTIVE_NAV)}</script>}
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
            <StatusPill status={t.status} /> {showDept && d ? <span class="dept-inline"><DeptIcon id={d.id} />{d.name} · </span> : ""}
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
    <h3 class="h-ic"><Icon name="pencil" /> 업무 지시</h3>
    <textarea name="instruction" required placeholder="예: 다음 달 매출 올릴 방법 3가지 찾아줘" />
    <div class="row">
      <select name="department">
        <option value="cos" selected={!preset}>비서실에 맡기기 (알맞은 부서로 자동 배분)</option>
        {departments
          .filter((d) => d.id !== "cos")
          .map((d) => (
            <option value={d.id} selected={preset === d.id}>
              {d.name}에 직접 지시
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
    {p.paused && <p class="card h-ic" style="color:var(--bad)"><Icon name="alert" /> AGENTS_ENABLED=false — 모든 부서가 정지 중입니다.</p>}
    <h1>오늘의 본사</h1>
    {p.pendingProposals > 0 && (
      <a class="card notice" href="/proposals">
        <b>결재 대기 제안 {p.pendingProposals}건</b> — 부서들이 스스로 찾은 개선안이 기다리고 있습니다 →
      </a>
    )}
    <div class="card kpis">
      <div>
        <div class="muted">오늘 완료</div>
        <div class="n">{Object.values(p.stats).reduce((n, s) => n + s.doneToday, 0)}</div>
      </div>
      <div>
        <div class="muted">진행 중</div>
        <div class="n">{Object.values(p.stats).reduce((n, s) => n + s.working + s.queued, 0)}</div>
      </div>
      <a href="/proposals" class={p.pendingProposals ? "hot" : ""}>
        <div class="muted">결재 대기</div>
        <div class="n">{p.pendingProposals}</div>
      </a>
      <a href="/knowledge">
        <div class="muted">회사의 기억</div>
        <div class="n">{p.memoryCount}</div>
      </a>
      <div>
        <div class="muted">두뇌 사용 (무료 한도)</div>
        <div class="n">
          {p.usage}
          <small> / {p.limit}</small>
        </div>
      </div>
    </div>
    <OrderForm departments={p.departments} />
    <h2>조직도</h2>
    <div class="grid">
      {p.departments.map((d) => {
        const s = p.stats[d.id] ?? { queued: 0, working: 0, doneToday: 0 };
        const state = s.working ? "작업 중" : s.queued ? "대기 업무 있음" : "대기";
        return (
          <a class="card" href={`/d/${d.id}`} style="text-decoration:none">
            <h3 class="h-ic">
              <DeptIcon id={d.id} /> {d.name}
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
    <h1 class="h-ic">
      <DeptIcon id={dept.id} /> {dept.name}
    </h1>
    <p>{dept.mission}</p>
    <form class="card" method="post" action={`/d/${dept.id}/goals`}>
      <h3 class="h-ic"><Icon name="target" /> 부서 목표 (CEO 지정)</h3>
      <p class="muted">여기 적은 목표는 이 부서의 모든 업무에 반영됩니다.</p>
      <textarea name="goals">{dept.goals}</textarea>
      <details style="margin-top:10px">
        <summary>부서 사명과 직무 고치기</summary>
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
    <h2>이 부서의 기억 (중요한 순)</h2>
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
        {p.dept?.name}
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
          <Icon name="file" /> 보고서 파일 받기
        </a>
      )}
      {p.task.result_md && (
        <a class="pill" href={`/t/${p.task.id}/print`}>
          <Icon name="printer" /> 인쇄/PDF
        </a>
      )}
      {p.task.status === "done" && p.task.result_md && (
        <>
          <form method="post" action={`/t/${p.task.id}/good`}>
            <button class="ghost h-ic"><Icon name="thumb" /> 좋아요</button>
          </form>
          <form method="post" action={`/t/${p.task.id}/next`}>
            <button>▶️ 다음 단계로</button>
          </form>
          <form method="post" action={`/t/${p.task.id}/apply`}>
            <button class="ghost h-ic"><Icon name="zap" /> 실제로 적용하기</button>
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
        <h3 class="h-ic"><Icon name="message" /> 피드백 남기기</h3>
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
            {isPlaybook(k.content) ? <span class="pill" style="border-color:var(--accent);color:var(--accent)">대응 매뉴얼</span> : <span class="pill">{KIND_LABEL[k.kind] ?? k.kind}</span>}{" "}
            {k.weight > 1 && <span class="pill">×{k.weight}</span>}{" "}
            {departments && <span class="muted">{d ? d.name : "전사"} · </span>}
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
    <h1>회사의 기억</h1>
    <p class="muted">부서가 일하며 배운 점, 사장님의 피드백과 결정입니다. 모든 업무에서 관련 있는 기억을 찾아 참고합니다. 틀린 기억은 "잊게 하기"로 지우세요.</p>
    {!playbooks && items.length > 0 && <MemoryGraph data={graphData(currentCompany().name, departments, items)} />}
    <div class="row">
      <a class="pill" href="/knowledge/export.md"><Icon name="download" /> 전체 기억 파일로 받기</a>
      <form method="post" action="/knowledge/backup">
        <button class="ghost" style="padding:2px 10px"><Icon name="send" /> 지금 텔레그램으로 백업</button>
      </form>
      <span class="muted">매주 일요일 20시에 자동으로 텔레그램 백업이 옵니다.</span>
    </div>
    <form class="row" method="get" action="/knowledge">
      <select name="dept">
        <option value="">전체</option>
        {departments.map((d) => (
          <option value={d.id} selected={dept === d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <label class="muted">
        <input type="checkbox" name="playbooks" value="1" checked={playbooks} /> 대응 매뉴얼만
      </label>
      <button class="ghost">보기</button>
    </form>
    {playbooks && (
      <p class="card muted">
        대응 매뉴얼은 "이런 일이 생기면 이렇게 한다"를 미리 적어 둔 것입니다. 부서마다 매일 정해진 시간(11시부터 한 시간에 한 부서씩)에 대비 훈련을 하며 늘어나고, 비슷한 상황이 실제로 생기면 부서가 먼저 꺼내 봅니다. 제목을 누르면 내용이 펼쳐집니다.
      </p>
    )}
    {playbooks && (
      <form method="post" action="/knowledge/drill" class="row">
        <button class="h-ic"><Icon name="flag" /> 지금 전 부서 대비 훈련 시작</button>
        <span class="muted">모든 부서가 매뉴얼을 2~3개씩 만듭니다. 무료 두뇌 한도에 따라 몇 시간에 걸쳐 끝날 수 있습니다.</span>
      </form>
    )}
    <form class="card" method="post" action="/knowledge" style="margin-top:12px">
      <h3 class="h-ic"><Icon name="pencil" /> 직접 가르치기</h3>
      <textarea name="content" required placeholder="예: 우리는 할인 경쟁을 하지 않는다. 가격 인하 제안은 하지 않는다." />
      <div class="row">
        <select name="department">
          <option value="">전사 공통</option>
          {departments.map((d) => (
            <option value={d.id} selected={dept === d.id}>
              {d.name}
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
    <h1>회사 비전과 현황</h1>
    <p class="muted">모든 부서가 모든 업무와 자율 제안에서 이 내용을 기준으로 삼습니다.</p>
    <form class="card" method="post" action="/vision">
      <h3 class="h-ic"><Icon name="bars" /> 지금 회사 현황 (숫자)</h3>
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
    <h1>자율 제안함</h1>
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
              {d?.name} · {kstTime(p.created_at)}
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
          {p.action && <p class="muted">승인 시 실행: {p.action.type === "hide_product" ? `상품 비노출 (${p.action.productTitle ?? p.action.productId})` : p.action.type}</p>}
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
                <button name="decision" value="approve">승인</button>
                {p.status === "pending" && (
                  <button class="ghost" name="decision" value="hold">
                    ⏸ 보류
                  </button>
                )}
                <button class="ghost" name="decision" value="reject">
                  거절
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
      <h1>부서별 성과 점수판</h1>
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
                  {r.department.name}
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

      <h2>최근 배운 점</h2>
      <div class="grid">
        {rows
          .filter((r) => r.recentLessons.length)
          .map((r) => (
            <div class="card">
              <h3 class="h-ic">
                <DeptIcon id={r.department.id} /> {r.department.name}
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

      <h2>두뇌 사용량 (최근 {days}일)</h2>
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
          <button onclick="window.print()">인쇄 / PDF로 저장</button>
          <a href={`/t/${task.id}`}>← 돌아가기</a>
        </div>
        <div class="meta">
          {currentCompany().name} AI 본사 · {dept ? dept.name : task.department} · {kstTime(task.finished_at ?? task.created_at)}
        </div>
        <h1>{task.title}</h1>
        {task.summary && <p class="summary">{task.summary}</p>}
        <div class="report">{raw(reportHtml)}</div>
        <footer>AI 부서가 작성한 문서입니다. 숫자는 회사 기록에서 코드가 센 값과 CEO 가 적은 현황이며, 판단은 CEO 가 합니다.</footer>
      </main>
    </body>
  </html>
);
