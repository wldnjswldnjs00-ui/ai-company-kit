import { Hono } from "hono";
import { cleanEnv, type Env } from "./env";
import { web } from "./routes/web";
import { telegram } from "./routes/telegram";
import { assets } from "./assets";
import { processQueue } from "./company/worker";
import { runRoutines } from "./company/routines";
import { db } from "./db";
import { heartbeat, hqAudit } from "./company/health";
import { remindLater } from "./company/reminders";
import { hydrate } from "./settings";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));
app.route("/", assets);
app.route("/", telegram);
app.route("/", web);

app.onError((err, c) => {
  console.error(err);
  return c.text(`오류가 발생했습니다: ${err.message}`, 500);
});

// Settings typed into Cloudflare, cleaned, plus everything the setup screen
// saved and the secrets derived from them (see settings.ts). A broken
// Supabase address must not break the setup screen that explains it.
async function prepare(raw: Env): Promise<Env> {
  const env = cleanEnv(raw);
  let client = null;
  try {
    client = db(env);
  } catch {
    client = null;
  }
  return (await hydrate(env, client)).env;
}

export default {
  fetch: async (req: Request, raw: Env, ctx: ExecutionContext) => app.fetch(req, await prepare(raw), ctx),

  // The company's heartbeat, every 5 minutes (wrangler.toml [triggers]).
  // Each step is isolated so one failing never stops the others.
  async scheduled(_controller: ScheduledController, raw: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const env = await prepare(raw);
        const steps: [string, () => Promise<unknown>][] = [
          ["본사 심장", () => heartbeat(env, db(env))],
          ["정기 업무", () => (env.AGENTS_ENABLED === "false" ? Promise.resolve() : runRoutines(env, db(env)))],
          ["업무 처리", () => processQueue(env)],
          ["감사실 점검", () => hqAudit(env, db(env))],
          ["미뤄 둔 일", () => remindLater(env, db(env))],
        ];
        for (const [name, step] of steps) {
          try {
            console.log(name, await step());
          } catch (err) {
            console.error(`${name} 실패`, err);
          }
        }
      })()
    );
  },
} satisfies ExportedHandler<Env>;
