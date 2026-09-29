import type { FC } from "hono/jsx";
import { Layout } from "./pages";
import { helpPrompt, type Check } from "../setupChecks";
import type { Settings } from "../settings";
import type { CatalogDepartment } from "../company/departments";

// 설치 화면: five steps on one page. Every step shows ✅/❌, and every ❌
// says exactly where to go and what to change — the buyer needs no one.

const Status: FC<{ check: Check }> = ({ check }) => (
  <li style="padding:6px 0">
    {check.ok ? "✅" : check.optional ? "➖" : "❌"} <b>{check.label}</b>
    {check.detail && <span class="muted"> · {check.detail}</span>}
    {!check.ok && check.hint && <div class="muted" style="margin:2px 0 0 22px">{check.hint}</div>}
    {!check.ok && !check.optional && (
      <details style="margin:4px 0 0 22px">
        <summary>🤖 그래도 모르겠으면: 무료 AI 에게 물어보기</summary>
        <p class="muted">아래 글을 복사해서 ChatGPT·Gemini·Claude 같은 무료 AI 에 붙여 넣으세요. 열쇠·토큰은 들어 있지 않습니다. AI 가 달라고 해도 주지 마세요.</p>
        <textarea readonly rows={8} style="width:100%;font-size:13px">{helpPrompt(check)}</textarea>
        <button type="button" onclick="var t=this.previousElementSibling;t.select();navigator.clipboard&&navigator.clipboard.writeText(t.value);this.textContent='✅ 복사됨'">📋 복사하기</button>
      </details>
    )}
  </li>
);

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
      <h1>🛠 설치하기</h1>
      <p class="muted">위에서부터 차례로 하세요. 모든 단계가 ✅ 가 되면 끝입니다. 막히면 ❌ 아래 설명을 그대로 따라 하고, 그래도 모르겠으면 "무료 AI 에게 물어보기"를 누르세요.</p>
      {notice && (
        <p class="card" style={`color:var(${notice.ok ? "--ok" : "--bad"})`}>
          {notice.ok ? "✅ " : "❌ "}
          {notice.message}
        </p>
      )}

      <h2>{done(1) ? "✅" : "1️⃣"} 기본 연결</h2>
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
          <h2>{done(2) ? "✅" : "2️⃣"} 회사 소개</h2>
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
          <h2>{done(3) ? "✅" : "3️⃣"} 부서 고르기</h2>
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
                        {d.emoji} {d.name}
                      </b>
                      {d.search && <span class="pill">🔎 최신 검색</span>} {d.needsWebsite && <span class="pill">🌐 웹사이트 필요</span>}
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
          <h2>{done(4) ? "✅" : "4️⃣"} 텔레그램 연결</h2>
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
              <button>{done(4) ? "🔄 다시 연결" : "봇 연결하기"}</button>
            </form>
          </div>
        </>
      )}

      {allDone && (
        <>
          <h2>🎉 완료</h2>
          <form class="card" method="post" action="/setup/finish">
            <p>모든 준비가 끝났습니다. 이제 텔레그램으로 말하듯 지시하면 됩니다. 예) "이번 달 할 일 정리해줘"</p>
            <button>대시보드로 가기</button>
          </form>
        </>
      )}
    </Layout>
  );
};
