import type { FC } from "hono/jsx";
import { Layout } from "./pages";
import { helpPrompt, type Check } from "../setupChecks";
import type { Settings } from "../settings";
import type { CatalogDepartment } from "../company/departments";
import { currentBrand, brandUrl, BRAND_KINDS, type BrandKind } from "../brand";
import { Icon, DeptIcon } from "./icons";

// 설치 화면: five steps on one page. Every step shows ok/not-ok, and every miss
// says exactly where to go and what to change — the buyer needs no one.

const Mark: FC<{ state: "ok" | "bad" | "skip" }> = ({ state }) => (
  <span class={`mark mark-${state}`}>
    <Icon name={state === "ok" ? "check" : state === "bad" ? "x" : "minus"} />
  </span>
);

const Step: FC<{ n: number; done: boolean }> = ({ n, done }) => <span class={`stepno${done ? " stepno-done" : ""}`}>{done ? <Icon name="check" /> : n}</span>;

const Status: FC<{ check: Check }> = ({ check }) => (
  <li style="padding:6px 0">
    <Mark state={check.ok ? "ok" : check.optional ? "skip" : "bad"} /> <b>{check.label}</b>
    {check.detail && <span class="muted"> · {check.detail}</span>}
    {!check.ok && check.hint && <div class="muted" style="margin:2px 0 0 22px">{check.hint}</div>}
    {!check.ok && !check.optional && (
      <details style="margin:4px 0 0 22px">
        <summary>그래도 모르겠으면: 무료 AI 에게 물어보기</summary>
        <p class="muted">아래 글을 복사해서 ChatGPT·Gemini·Claude 같은 무료 AI 에 붙여 넣으세요. 열쇠·토큰은 들어 있지 않습니다. AI 가 달라고 해도 주지 마세요.</p>
        <textarea readonly rows={8} style="width:100%;font-size:13px">{helpPrompt(check)}</textarea>
        <button type="button" onclick="var t=this.previousElementSibling;t.select();navigator.clipboard&&navigator.clipboard.writeText(t.value);this.textContent='복사됨'">복사하기</button>
      </details>
    )}
  </li>
);

const BRAND_FIELDS: Record<BrandKind, { label: string; hint: string; bg: string }> = {
  logoLight: { label: "밝은 배경용 로고", hint: "검은색·진한 글씨 로고. 흰 메뉴에 쓰입니다.", bg: "#fff" },
  logoDark: { label: "어두운 배경용 로고", hint: "흰색·밝은 글씨 로고. 검정 메뉴에 쓰입니다.", bg: "#161618" },
  icon: { label: "앱 아이콘 (휴대폰 홈 화면)", hint: "정사각형 이미지. 512×512 크기를 추천합니다.", bg: "#f3f3f1" },
};

// 로고와 메뉴 색: optional, any time after the basics are connected.
const BrandForm: FC = () => {
  const b = currentBrand();
  return (
    <form class="card" method="post" action="/setup/brand" enctype="multipart/form-data">
      <p class="muted">
        올리지 않으면 회사 이름이 글자로 표시됩니다. 로고는 하나만 올려도 됩니다. PNG·JPG·WebP, 300KB 이하. 배경이 투명한 PNG 가 가장 깔끔합니다.
      </p>
      <label>왼쪽 메뉴 색</label>
      <div class="row" style="margin-top:4px">
        <label>
          <input type="radio" name="theme" value="black" checked={b.theme === "black"} /> <span class="swatch" style="background:#161618" /> 블랙
        </label>
        <label>
          <input type="radio" name="theme" value="white" checked={b.theme === "white"} /> <span class="swatch" style="background:#fff" /> 화이트
        </label>
      </div>
      {BRAND_KINDS.map((kind) => {
        const f = BRAND_FIELDS[kind];
        const url = brandUrl(kind, b);
        return (
          <div style="margin-top:14px">
            <label>
              <b>{f.label}</b> <span class="muted">— {f.hint}</span>
            </label>
            {url && (
              <div class="row">
                <img src={url} alt="" style={`max-height:44px;max-width:200px;padding:6px 10px;border-radius:10px;border:1px solid var(--line);background:${f.bg}`} />
                <label class="muted">
                  <input type="checkbox" name={`remove_${kind}`} value="1" /> 지우기
                </label>
              </div>
            )}
            <input type="file" name={kind} accept="image/png,image/jpeg,image/webp" style="margin-top:6px" />
          </div>
        );
      })}
      <div class="row">
        <button>저장</button>
      </div>
    </form>
  );
};

const input = "width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--bg);color:var(--ink);font:inherit";

export const SetupWizard: FC<{ checks: Check[]; settings: Settings | null; installed: string[]; catalog: CatalogDepartment[]; notice?: { ok: boolean; message: string } }> = ({
  checks,
  settings,
  installed,
  catalog,
  notice,
}) => {
  const step = (n: number) => checks.filter((c) => c.step === n);
  const done = (n: number) => step(n).every((c) => c.ok || c.optional);
  const basicsOk = done(1);
  const company = settings?.company;
  const firstTime = installed.length <= 1;
  const bot = checks.find((c) => c.key === "bot")?.detail;
  const allDone = [1, 2, 3, 4].every(done);
  return (
    <Layout title="설치">
      <h1>{allDone ? "설정" : "설치하기"}</h1>
      <p class="muted">위에서부터 차례로 하세요. 모든 단계에 초록 체크가 붙으면 끝입니다. 빨간 표시가 있으면 아래 설명을 그대로 따라 하고, 그래도 모르겠으면 "무료 AI 에게 물어보기"를 누르세요.</p>
      {notice && (
        <p class="card" style={`color:var(${notice.ok ? "--ok" : "--bad"})`}>
          <Mark state={notice.ok ? "ok" : "bad"} />{" "}
          {notice.message}
        </p>
      )}

      <h2 class="h-ic"><Step n={1} done={done(1)} /> 기본 연결</h2>
      <div class="card">
        <p class="muted">Cloudflare 에 넣은 값 4개와 설치 SQL 을 확인합니다. 값을 고쳤다면 1분 뒤 이 화면을 새로고침하세요.</p>
        <ul class="tasks">
          {step(1).map((c) => (
            <Status check={c} />
          ))}
        </ul>
      </div>

      {basicsOk && (
        <>
          <h2 class="h-ic"><Step n={2} done={done(2)} /> 회사 소개</h2>
          <form class="card" method="post" action="/setup/company">
            <p class="muted">모든 부서가 이 내용을 보고 일합니다. 구체적일수록 결과가 좋아집니다.</p>
            <label>회사 이름</label>
            <input name="name" value={company?.name ?? ""} placeholder="예) 봄날베이커리" style={input} />
            <label>무엇을 하는 회사인가요? *</label>
            <textarea name="business" required placeholder="예) 동네 수제 빵집. 매장 판매와 스마트스토어 온라인 주문을 한다. 주력은 천연발효 식빵.">
              {company?.business ?? ""}
            </textarea>
            <label>주요 고객</label>
            <input name="customers" value={company?.customers ?? ""} placeholder="예) 30~40대 동네 주민, 건강한 빵을 찾는 온라인 고객" style={input} />
            <label>지금 회사 단계</label>
            <input name="stage" value={company?.stage ?? ""} placeholder="예) 문 연 지 1년, 월 매출 2천만 원, 직원 3명" style={input} />
            <label>반드시 지킬 것 (하지 않는 일, 말투 등)</label>
            <textarea name="rules" placeholder="예) 할인 경쟁은 하지 않는다. 고객에게는 존댓말. 건강 효능은 말하지 않는다.">{company?.rules ?? ""}</textarea>
            <label>회사 비전 (선택)</label>
            <textarea name="vision" placeholder="예) 동네에서 가장 믿을 수 있는 빵집이 된다."></textarea>
            <label>배우고 싶은 회사 (벤치마킹, 선택)</label>
            <textarea name="benchmarks" placeholder="예) 쿠팡, 스타벅스, 파리바게뜨 — 비워 두면 부서들이 우리 업종에서 가장 잘하는 회사를 직접 골라 공부합니다.">{company?.benchmarks ?? ""}</textarea>
            <label>주 활동 국가</label>
            <input name="country" value={company?.country ?? "대한민국"} style={input} />
            <div class="row">
              <button>저장</button>
            </div>
          </form>
        </>
      )}

      {basicsOk && done(2) && (
        <>
          <h2 class="h-ic"><Step n={3} done={done(3)} /> 부서 고르기</h2>
          <form class="card" method="post" action="/setup/departments">
            <p class="muted">
              부서가 많을수록 무료 두뇌 사용량도 늘어납니다. 처음에는 추천(미리 체크된 것)으로 시작하고, 나중에 더 추가하세요. 비서실은 항상 있습니다.
            </p>
            <ul class="tasks">
              {catalog
                .filter((d) => d.id !== "cos")
                .map((d) => (
                  <li>
                    <label>
                      <input type="checkbox" name="departments" value={d.id} checked={installed.includes(d.id) || (firstTime && !!d.recommended)} disabled={installed.includes(d.id)} />{" "}
                      <b>
                        <span class="dept-inline"><DeptIcon id={d.id} />{d.name}</span>
                      </b>
                      {d.search && <span class="pill">최신 검색</span>} {d.needsWebsite && <span class="pill">웹사이트 필요</span>}
                      <div class="muted" style="margin-left:22px">{d.mission}</div>
                    </label>
                  </li>
                ))}
            </ul>
            <label>웹사이트 주소 (있으면)</label>
            <input name="website" value={settings?.websiteUrl ?? ""} placeholder="예) https://mybakery.com" style={input} />
            <p class="muted">이미 만든 부서는 여기서 지워지지 않습니다. 부서 이름·사명·직무는 설치 후 부서 화면에서 고칠 수 있습니다.</p>
            <div class="row">
              <button>저장</button>
            </div>
          </form>
        </>
      )}

      {basicsOk && done(2) && done(3) && (
        <>
          <h2 class="h-ic"><Step n={4} done={done(4)} /> 텔레그램 연결</h2>
          <div class="card">
            <ul class="tasks">
              {step(4).map((c) => (
                <Status check={c} />
              ))}
            </ul>
            {settings?.telegramCode && !checks.find((c) => c.key === "ceo")?.ok && (
              <p style="font-size:18px">
                텔레그램에서 <b>{bot ?? "봇"}</b> 을 열고 이렇게 보내세요: <code style="font-size:20px">/start {settings.telegramCode}</code>
                <br />
                <span class="muted">보냈으면 이 화면을 새로고침하세요.</span>
              </p>
            )}
            <form method="post" action="/setup/telegram" class="row">
              <button>{done(4) ? "다시 연결" : "봇 연결하기"}</button>
            </form>
          </div>
        </>
      )}

      {settings && (
        <>
          <h2 class="h-ic" id="brand"><Icon name="palette" /> 로고와 메뉴 색 (선택)</h2>
          <BrandForm />
        </>
      )}

      {allDone && (
        <>
          <h2 class="h-ic"><Icon name="done" /> 완료</h2>
          <form class="card" method="post" action="/setup/finish">
            <p>모든 준비가 끝났습니다. 이제 텔레그램으로 말하듯 지시하면 됩니다. 예) "이번 달 할 일 정리해줘"</p>
            <button>대시보드로 가기</button>
          </form>
        </>
      )}
    </Layout>
  );
};
