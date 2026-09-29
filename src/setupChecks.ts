import type { Env } from "./env";
import { db, supabaseUrl } from "./db";
import { loadSettings } from "./settings";
import { webhookInfo } from "./telegram";

// What the setup screen checks, in the order the buyer does things. Each
// failing check says, in plain words, where to go and what to change.

export type Check = { key: string; step: 1 | 2 | 3 | 4; label: string; ok: boolean; hint?: string; detail?: string; optional?: boolean };

// A service that doesn't answer must not freeze the setup screen.
const TIMEOUT_MS = 6000;
function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS))]);
}
const timeoutError: { error: { message: string; code?: string } | null } = { error: { message: "응답 없음 (6초)", code: "timeout" } };

const CF_PATH = "Cloudflare → Workers & Pages → 이 Worker → Settings → Variables and Secrets";

export async function setupChecks(env: Env): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. Supabase address, key and the setup SQL.
  let urlOk = false;
  try {
    supabaseUrl(env.SUPABASE_URL);
    urlOk = true;
  } catch {
    urlOk = false;
  }
  checks.push({
    key: "supabase_url",
    step: 1,
    label: "Supabase 주소 (SUPABASE_URL)",
    ok: urlOk,
    hint: `Supabase → Project Settings → Data API 의 Project URL(https://xxxx.supabase.co)을 복사해서 ${CF_PATH} 의 SUPABASE_URL 에 넣으세요.`,
  });

  let keyOk = false;
  let sqlOk = false;
  let keyProblem = "SUPABASE_SECRET_KEY 가 없습니다.";
  if (urlOk && env.SUPABASE_SECRET_KEY) {
    const { error } = await withTimeout(
      Promise.resolve(db(env).from("settings").select("key").limit(1)).then((r): { error: { message: string; code?: string } | null } => ({ error: r.error })),
      timeoutError
    );
    if (!error) {
      keyOk = true;
      sqlOk = true;
    } else if (/relation|does not exist|schema cache|PGRST20/i.test(`${error.message} ${(error as { code?: string }).code ?? ""}`)) {
      keyOk = true; // connected, table missing
    } else {
      keyProblem = `Supabase 가 열쇠를 받지 않았습니다: ${error.message}`;
    }
  }
  checks.push({
    key: "supabase_key",
    step: 1,
    label: "Supabase 열쇠 (SUPABASE_SECRET_KEY)",
    ok: keyOk,
    hint: `${keyProblem} Supabase → Project Settings → API Keys 의 Secret key(sb_secret_…)를 복사해서 ${CF_PATH} 의 SUPABASE_SECRET_KEY 에 Secret 으로 넣으세요.`,
  });
  checks.push({
    key: "sql",
    step: 1,
    label: "설치 SQL 실행",
    ok: sqlOk,
    hint: "Supabase → SQL Editor → New query → 설치 파일(supabase/setup.sql) 전체를 붙여 넣고 Run 을 누르세요. 여러 번 실행해도 안전합니다.",
  });

  // Gemini key: ask Google for one model.
  let geminiOk = false;
  let geminiProblem = "GEMINI_API_KEY 가 없습니다.";
  if (env.GEMINI_API_KEY) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": env.GEMINI_API_KEY }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      geminiOk = res.ok;
      if (!res.ok) geminiProblem = `Google 이 열쇠를 받지 않았습니다 (HTTP ${res.status}).`;
    } catch (err) {
      geminiProblem = `Google 에 접속하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  checks.push({
    key: "gemini",
    step: 1,
    label: "두뇌 열쇠 (GEMINI_API_KEY)",
    ok: geminiOk,
    hint: `${geminiProblem} aistudio.google.com → Get API key → Create API key 로 만든 열쇠를 ${CF_PATH} 의 GEMINI_API_KEY 에 Secret 으로 넣으세요.`,
  });

  // Telegram bot token.
  let botName: string | undefined;
  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = (await res.json()) as { ok: boolean; result?: { username?: string } };
      botName = body.ok ? body.result?.username : undefined;
    } catch {
      botName = undefined;
    }
  }
  checks.push({
    key: "bot",
    step: 1,
    label: "텔레그램 봇 (TELEGRAM_BOT_TOKEN)",
    ok: !!botName,
    detail: botName ? `@${botName}` : undefined,
    hint: `텔레그램에서 @BotFather → /newbot 으로 봇을 만들고 받은 토큰(숫자:영문 전체)을 ${CF_PATH} 의 TELEGRAM_BOT_TOKEN 에 Secret 으로 넣으세요.`,
  });

  // 2~4. Saved by this screen.
  let settings = null;
  let departmentCount = 0;
  if (sqlOk && env.DB_OK) {
    const client = db(env);
    settings = await loadSettings(client);
    const { count } = await client.from("departments").select("id", { count: "exact", head: true });
    departmentCount = count ?? 0;
  }
  checks.push({ key: "company", step: 2, label: "회사 소개", ok: !!settings?.company?.business, hint: "아래 2단계에서 회사 소개를 저장하세요." });
  checks.push({ key: "departments", step: 3, label: "부서 고르기", ok: departmentCount > 1, detail: departmentCount ? `${departmentCount}개 부서` : undefined, hint: "아래 3단계에서 부서를 고르고 저장하세요." });

  const info = botName ? await withTimeout(webhookInfo(env), null) : null;
  const expected = env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}/telegram` : "";
  checks.push({
    key: "webhook",
    step: 4,
    label: "텔레그램 연결",
    ok: !!info && !!expected && info.url === expected,
    detail: botName ? `@${botName}` : undefined,
    hint: "아래 4단계의 '봇 연결하기' 버튼을 누르세요.",
  });
  checks.push({
    key: "ceo",
    step: 4,
    label: "CEO 채팅 연결",
    ok: !!env.TELEGRAM_CEO_CHAT_ID,
    hint: settings?.telegramCode ? `텔레그램에서 @${botName ?? "봇"} 을 열고 /start ${settings.telegramCode} 를 보낸 뒤, 이 화면을 새로고침하세요.` : "먼저 '봇 연결하기' 를 누르세요.",
  });
  checks.push({
    key: "website",
    step: 3,
    label: "웹사이트 순찰 (선택)",
    ok: !!env.WEBSITE_URL,
    optional: true,
    detail: env.WEBSITE_URL,
    hint: "웹사이트가 있으면 3단계에서 주소를 넣고 '웹사이트순찰팀' 을 고르세요.",
  });
  return checks;
}

// A ready-to-paste question for any free AI (ChatGPT, Gemini, Claude…), so a
// buyer stuck on a ❌ can get step-by-step help without asking anyone.
// Only the check's label and hint go in — never keys, tokens or codes.
export function helpPrompt(check: Pick<Check, "key" | "label" | "hint">): string {
  const hint = check.key === "ceo" ? "텔레그램에서 내 봇을 열고, 설치 화면에 나온 /start 숫자 6자리를 보낸 뒤 새로고침하라고 한다." : (check.hint ?? "");
  return `나는 코딩을 모르는 사장이다. "AI 본사"라는 프로그램을 설치하는 중인데 한 단계에서 막혔다. 초등학생도 따라 할 수 있게, 화면에서 어디를 누르는지 순서대로 알려 줘.

[구성]
- Cloudflare Workers 에 올린 웹 프로그램이다. GitHub 저장소에서 Cloudflare 가 자동으로 가져가 배포한다.
- 데이터베이스는 Supabase, AI 는 Google Gemini(API 키), 알림은 텔레그램 봇이다.
- 비밀 값(열쇠·토큰)은 Cloudflare → Workers & Pages → 내 Worker → Settings → Variables and Secrets 에 넣는다.
- 값을 바꾼 뒤 1분쯤 기다렸다가 설치 화면을 새로고침하면 다시 확인된다.

[설치 화면에 나온 ❌]
${check.label}

[설치 화면의 안내]
${hint}

부탁:
1. 이 문제가 생기는 흔한 이유를 가능성 높은 순서로 알려 줘.
2. 각각 확인하고 고치는 방법을 한 단계씩 알려 줘.
3. 버튼 이름은 영어 화면 그대로 적어 줘.
4. 내 열쇠·토큰·비밀번호를 보여 달라고 하지 마. 나도 여기에 붙여 넣지 않을게.`;
}
