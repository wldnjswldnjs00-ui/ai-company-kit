import { followUp, type Followup } from "../company/followup";
import { KIT_VERSION } from "../version";
import { AUTO_AGENDA } from "../company/meeting";
import { PATROL_TITLE } from "../company/routines";
import { brainDescription } from "../brain";
import { Hono } from "hono";
import type { Env } from "../env";
import { secretEquals } from "../auth";
import { db, must, listDepartments, createTask, logEvent, type Task } from "../db";
import { isCeoChat, sendCeo, escapeHtml, answerCallback } from "../telegram";
import { decideProposal, type Decision } from "../company/proposals";
import { parseCeoMessage, titleFrom, TELEGRAM_HELP, MEETING_PREFIX } from "../company/orders";
import { transcribeVoice } from "../voice";
import { loadSettings, saveSetting } from "../settings";
import { processQueue } from "../company/worker";

type TelegramUpdate = {
  message?: { chat: { id: number }; text?: string; voice?: { file_id: string; duration?: number } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
};

export const telegram = new Hono<{ Bindings: Env }>();

// Quick status for /check: is everything the company needs connected?
export async function statusCheck(env: Env): Promise<string> {
  const client = db(env);
  const [departments, settings] = await Promise.all([listDepartments(client), loadSettings(client)]);
  const ok = (v: unknown) => (v ? "✅" : "❌");
  return [
    `🔌 <b>연결 점검</b> · AI 본사 ${KIT_VERSION}`,
    "",
    `${ok(settings)} 데이터베이스 (Supabase)`,
    `${ok(env.GEMINI_API_KEY)} 두뇌 열쇠 (GEMINI_API_KEY)`,
    `🧠 두뇌: ${escapeHtml(brainDescription(env))}`,
    `✅ 텔레그램 (이 메시지가 왔으면 정상)`,
    `🏢 부서 ${departments.length}개: ${escapeHtml(departments.map((d) => d.name).join(", "))}`,
    `${env.WEBSITE_URL ? "✅" : "➖"} 웹사이트 순찰${env.WEBSITE_URL ? `: ${escapeHtml(env.WEBSITE_URL)}` : " (주소 없음 — 설치 화면에서 넣을 수 있음)"}`,
    env.PUBLIC_BASE_URL ? `\n📌 대시보드 주소: ${env.PUBLIC_BASE_URL}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Pairing: before a CEO chat is saved, the setup screen shows a one-time
// code; the first chat that sends "/start <code>" becomes the CEO's.
export async function tryPairing(env: Env, chatId: number, text: string | undefined): Promise<boolean> {
  if (env.TELEGRAM_CEO_CHAT_ID || !text) return false;
  const code = text.trim().match(/^\/start(?:@\w+)?\s+(\d{6})$/)?.[1];
  const client = db(env);
  const settings = await loadSettings(client);
  const reply = { ...env, TELEGRAM_CEO_CHAT_ID: String(chatId) };
  if (!code || !settings?.telegramCode || !(await secretEquals(code, settings.telegramCode))) {
    await sendCeo(reply, "👋 아직 CEO 와 연결되지 않은 봇입니다. 대시보드 설치 화면에 나온 <b>/start 숫자6자리</b> 를 그대로 보내 주세요.");
    return true;
  }
  await saveSetting(client, "ceoChatId", String(chatId));
  await saveSetting(client, "telegramCode", "");
  await sendCeo(
    reply,
    `✅ <b>연결 완료!</b>\n이제 이 채팅으로 보고와 결재가 옵니다.${env.PUBLIC_BASE_URL ? `\n\n📌 대시보드 주소 (즐겨찾기해 두세요)\n${env.PUBLIC_BASE_URL}` : ""}\n\n아무 지시나 말하듯 보내 보세요. 예) 이번 달 할 일 정리해줘\n/도움말 로 명령어를, /check 로 대시보드 주소를 볼 수 있습니다.`
  );
  return true;
}

telegram.post("/telegram", async (c) => {
  if (!(await secretEquals(c.req.header("x-telegram-bot-api-secret-token"), c.env.TELEGRAM_WEBHOOK_SECRET))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const raw = await c.req.text();
  const update = JSON.parse(raw) as TelegramUpdate;

  // Always 200 after authentication — a non-2xx makes Telegram redeliver.
  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      if (!isCeoChat(c.env, cb.message?.chat.id)) return c.json({ ok: true });
      const [prefix, verb, id] = (cb.data ?? "").split(":");
      if (prefix === "hq" && (verb === "approve" || verb === "hold" || verb === "reject") && id) {
        // Stop the button's spinner right away; the decision itself (task,
        // memory, message edit) runs after the response so a slow step can
        // never leave the CEO staring at a flashing button.
        await answerCallback(c.env, cb.id, verb === "approve" ? "승인 접수 — 처리 중" : verb === "hold" ? "보류 접수" : "거절 접수");
        c.executionCtx.waitUntil(
          (async () => {
            try {
              const outcome = await decideProposal(c.env, db(c.env), id, verb as Decision);
              if (outcome.kind === "already") await sendCeo(c.env, `이 제안은 이미 처리됐습니다 (${outcome.status}).`);
              else if (outcome.kind === "not_found") await sendCeo(c.env, "해당 제안을 찾을 수 없습니다.");
              else if (outcome.taskId) await processQueue(c.env);
            } catch (err) {
              console.error("decideProposal failed", err);
              await sendCeo(c.env, `⚠️ 결재 처리 중 오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}\n대시보드의 "제안함"에서 다시 눌러 주세요.`);
            }
          })()
        );
      } else if (prefix === "hq" && (verb === "good" || verb === "next" || verb === "apply") && id) {
        await answerCallback(c.env, cb.id, verb === "good" ? "👍 기억했습니다" : verb === "next" ? "▶️ 다음 단계 접수 — 처리 중" : "🛠 개발본부에 전달 — 처리 중");
        c.executionCtx.waitUntil(
          (async () => {
            try {
              const outcome = await followUp(c.env, db(c.env), id, verb as Followup);
              if (outcome.kind === "already") await sendCeo(c.env, "이 보고서는 이미 처리했습니다.");
              else if (outcome.kind === "not_found") await sendCeo(c.env, "해당 보고서를 찾을 수 없습니다.");
              else if (outcome.kind === "next") {
                await sendCeo(c.env, `${verb === "apply" ? "🛠 <b>적용 준비</b>\n이 결과물을 실행 요청서로 바꿉니다. 끝나면 텔레그램으로 옵니다." : "▶️ <b>다음 단계 진행</b>\n같은 부서가 보고서의 다음 행동을 실제 결과물로 만듭니다. 끝나면 보고합니다."}${c.env.PUBLIC_BASE_URL ? `\n${c.env.PUBLIC_BASE_URL}/t/${outcome.taskId}` : ""}`);
                await processQueue(c.env);
              }
            } catch (err) {
              console.error("followUp failed", err);
              await sendCeo(c.env, `⚠️ 처리 중 오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`);
            }
          })()
        );
      }
      return c.json({ ok: true });
    }

    const msg = update.message;
    if (!msg) return c.json({ ok: true });
    if (await tryPairing(c.env, msg.chat.id, msg.text)) return c.json({ ok: true });
    if (!isCeoChat(c.env, msg.chat.id)) return c.json({ ok: true });

    if (msg.voice) {
      // Transcription takes a few seconds: acknowledge now, work after the
      // response so Telegram never waits on it.
      await sendCeo(c.env, "🎙 듣는 중…");
      const voice = msg.voice;
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const text = await transcribeVoice(c.env, db(c.env), voice.file_id, voice.duration ?? 0);
            await sendCeo(c.env, `🎙 들은 내용: <i>${escapeHtml(text)}</i>`);
            await handleCeoText(c.env, c.executionCtx, text);
          } catch (err) {
            await sendCeo(c.env, `⚠️ 음성 처리 실패: ${escapeHtml(err instanceof Error ? err.message : String(err))}`);
          }
        })()
      );
      return c.json({ ok: true });
    }
    if (!msg.text) {
      await sendCeo(c.env, "글자나 음성 메시지로 보내 주세요.");
      return c.json({ ok: true });
    }
    await handleCeoText(c.env, c.executionCtx, msg.text);
  } catch (err) {
    console.error("telegram webhook failed", err);
    await sendCeo(c.env, `⚠️ 처리 중 오류: ${escapeHtml(err instanceof Error ? err.message : String(err))}`);
  }
  return c.json({ ok: true });
});

// A CEO message (typed, or transcribed from voice): a command, a meeting, or
// an order.
async function handleCeoText(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, text: string): Promise<void> {
  const client = db(env);
  const departments = await listDepartments(client);
  const parsed = parseCeoMessage(text, departments);

  switch (parsed.kind) {
    case "help":
      await sendCeo(env, TELEGRAM_HELP);
      break;
    case "check":
      await sendCeo(env, await statusCheck(env));
      break;
    case "unknown_department":
      await sendCeo(env, `'${escapeHtml(parsed.name)}' 부서를 찾지 못했습니다. 부서: ${departments.map((d) => d.name).join(", ")}`);
      break;
    case "tasks": {
      const open = must<Task[]>(await client.from("tasks").select("*").in("status", ["queued", "working"]).order("created_at").limit(20));
      const lines = open.map((t) => {
        const d = departments.find((x) => x.id === t.department);
        return `${t.status === "working" ? "🟡" : "⚪"} ${d?.emoji ?? ""} ${escapeHtml(t.title)}`;
      });
      await sendCeo(env, lines.length ? `<b>진행 중인 업무</b>\n${lines.join("\n")}` : "진행 중인 업무가 없습니다.");
      break;
    }
    case "patrol": {
      if (!env.WEBSITE_URL || !departments.some((d) => d.id === "qa")) {
        await sendCeo(env, "웹사이트 순찰을 하려면 설치 화면에서 <b>웹사이트순찰팀</b>을 고르고 웹사이트 주소를 넣어 주세요.");
        break;
      }
      await createTask(client, { department: "qa", title: PATROL_TITLE, instruction: "처음 온 고객의 눈으로 우리 웹사이트를 순찰한다. (CEO 요청)", source: "ceo_telegram" });
      await sendCeo(env, "🔎 <b>웹사이트 순찰 시작</b>\n로봇 브라우저가 웹사이트를 휴대폰 화면으로 직접 열어 봅니다. 몇 분 뒤 보고합니다.");
      ctx.waitUntil(processQueue(env).catch((err) => console.error("processQueue failed", err)));
      break;
    }
    case "meeting": {
      const task = await createTask(client, {
        department: "cos",
        title: parsed.topic === AUTO_AGENDA ? "회의: 안건 자율" : `회의: ${titleFrom(parsed.topic)}`,
        instruction: `${MEETING_PREFIX} ${parsed.topic}`,
        source: "ceo_telegram",
      });
      await sendCeo(
        env,
        `🗣 <b>전 부서 회의 소집</b>\n${parsed.topic === AUTO_AGENDA ? "안건은 부서들이 직접 올립니다." : escapeHtml(parsed.topic)}\n부서마다 따로 의견을 내고, 서로 반론한 뒤 비서실이 정리합니다. 15~30분쯤 걸립니다.\n회의록과 실행 항목(결재)을 보내드립니다.`
      );
      await logEvent(client, task.id, "meeting", "CEO 가 텔레그램으로 회의를 소집함");
      ctx.waitUntil(processQueue(env).catch((err) => console.error("processQueue failed", err)));
      break;
    }
    case "order": {
      const task = await createTask(client, {
        department: parsed.department,
        title: titleFrom(parsed.instruction),
        instruction: parsed.instruction,
        source: "ceo_telegram",
      });
      const d = departments.find((x) => x.id === task.department);
      await sendCeo(env, `📝 지시 접수 → ${d?.emoji ?? ""} ${escapeHtml(d?.name ?? task.department)}\n<b>${escapeHtml(task.title)}</b>`);
      ctx.waitUntil(processQueue(env).catch((err) => console.error("processQueue failed", err)));
      break;
    }
  }
}
