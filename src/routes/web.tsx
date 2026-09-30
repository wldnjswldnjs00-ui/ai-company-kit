import { Hono } from "hono";
import { graphData } from "../views/memgraph";
import { currentCompany } from "../company/charter";
import { setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "../env";
import { requireCeo, secretEquals, issueSession, SESSION_COOKIE, SESSION_TTL_S } from "../auth";
import { db, must, listDepartments, getDepartment, getTask, createTask, logEvent, type Task, type TaskEvent } from "../db";
import { HomePage, DepartmentPage, TaskPage, AllTasksPage, LoginPage, KnowledgePage, VisionPage, ProposalsPage, ScoreboardPage, PrintPage, type DeptStats } from "../views/pages";
import { SetupWizard } from "../views/setup";
import { loadScores } from "../company/scoreboard";
import { registerWebhook, webhookInfo } from "../telegram";
import { buildMemoryExport, sendMemoryBackup } from "../company/backup";
import { getProfile, remember, type Knowledge } from "../company/memory";
import { decideProposal, type Decision } from "../company/proposals";
import type { Proposal } from "../db";
import { renderMarkdown } from "../markdown";
import { titleFrom } from "../company/orders";
import { processQueue } from "../company/worker";
import { followUp } from "../company/followup";
import { kstNow, drillsFor, DRILL_TITLE_PREFIX } from "../company/routines";
import { loadSettings, saveSetting } from "../settings";
import { BRAND_KINDS, BRAND_ROW_PREFIX, currentBrand, setBrand, toDataUrl, fromDataUrl, loadBrandImage, type BrandKind } from "../brand";
import { CATALOG, installDepartments } from "../company/departments";
import { DEFAULT_COMPANY, type Company } from "../company/charter";
import { setupChecks } from "../setupChecks";
import { PLAYBOOK_PREFIX, drillInstruction, listPlaybookTitles } from "../company/playbooks";
import { checkLogin, recordLogin, visitorFrom, WINDOW_MINUTES } from "../loginGuard";

export const web = new Hono<{ Bindings: Env }>();

web.get("/login", (c) =>
  c.html(
    <LoginPage
      error={c.env.DASHBOARD_PASSWORD ? undefined : "아직 비밀번호가 없습니다. Cloudflare → 이 Worker → Settings → Variables and Secrets 에 DASHBOARD_PASSWORD 를 Secret 으로 넣고 1분 뒤 새로고침하세요."}
    />
  )
);

web.post("/login", async (c) => {
  const client = db(c.env);
  const visitor = visitorFrom(c.req.raw.headers);
  const verdict = await checkLogin(client, visitor.ip);
  if (verdict !== "allow") {
    const who = verdict === "blocked_ip" ? "이 접속 위치에서" : "여러 곳에서";
    return c.html(<LoginPage error={`${who} 비밀번호가 여러 번 틀려 ${WINDOW_MINUTES}분 동안 잠시 막았습니다.`} />, 429);
  }
  const form = await c.req.parseBody();
  const ok = await secretEquals(String(form.password ?? ""), c.env.DASHBOARD_PASSWORD);
  c.executionCtx.waitUntil(recordLogin(c.env, client, visitor, ok && !!c.env.SESSION_SECRET).catch((err) => console.error("login record failed", err)));
  if (!ok || !c.env.SESSION_SECRET) {
    // Slow down guessing a little; there is exactly one account.
    await new Promise((r) => setTimeout(r, 800));
    return c.html(<LoginPage error="비밀번호가 맞지 않습니다." />, 401);
  }
  setCookie(c, SESSION_COOKIE, await issueSession(c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return c.redirect("/");
});

web.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/login");
});

web.use("/", requireCeo);
web.use("/tasks", requireCeo);
web.use("/orders", requireCeo);
web.use("/d/*", requireCeo);
web.use("/t/*", requireCeo);
web.use("/knowledge", requireCeo);
web.use("/knowledge/*", requireCeo);
web.use("/vision", requireCeo);
web.use("/proposals", requireCeo);
web.use("/proposals/*", requireCeo);
web.use("/setup", requireCeo);
web.use("/scoreboard", requireCeo);
web.use("/setup/*", requireCeo);

const KNOWLEDGE_COLUMNS = "id,department,kind,content,weight,source_task,active,created_at,updated_at";

// The dashboard's own address, saved so scheduled reports can link to it.
async function rememberBase(env: Env, requestUrl: string) {
  const origin = new URL(requestUrl).origin;
  if (env.DB_OK && env.PUBLIC_BASE_URL !== origin) await saveSetting(db(env), "publicBaseUrl", origin).catch(() => undefined);
}

web.get("/", async (c) => {
  const client = db(c.env);
  const settings = await loadSettings(client);
  if (!settings?.setupDone) return c.redirect("/setup");
  await rememberBase(c.env, c.req.url);
  const departments = await listDepartments(client);
  const { dateStartUtc } = kstNow(new Date());

  const [open, doneToday, recent, usage, pendingProposals, memoryCount] = await Promise.all([
    client.from("tasks").select("*").in("status", ["queued", "working"]),
    client.from("tasks").select("*").eq("status", "done").gte("finished_at", dateStartUtc.toISOString()),
    client.from("tasks").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(15),
    client.from("brain_usage").select("calls").eq("provider", "gemini").eq("day", new Date(dateStartUtc.getTime() + 9 * 3600e3).toISOString().slice(0, 10)).maybeSingle(),
    client.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    client.from("knowledge").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const openTasks = must<Task[]>(open);
  const doneTasks = must<Task[]>(doneToday);
  const recentTasks = must<Task[]>(recent);

  const stats: Record<string, DeptStats> = {};
  for (const d of departments) {
    stats[d.id] = {
      queued: openTasks.filter((t) => t.department === d.id && t.status === "queued").length,
      working: openTasks.filter((t) => t.department === d.id && t.status === "working").length,
      doneToday: doneTasks.filter((t) => t.department === d.id).length,
      latest: recentTasks.find((t) => t.department === d.id),
    };
  }

  return c.html(
    <HomePage
      departments={departments}
      stats={stats}
      recent={recentTasks}
      usage={usage.data?.calls ?? 0}
      limit={Number(c.env.BRAIN_DAILY_LIMIT) || 200}
      paused={c.env.AGENTS_ENABLED === "false"}
      pendingProposals={pendingProposals.count ?? 0}
      memoryCount={memoryCount.count ?? 0}
    />
  );
});

web.get("/tasks", async (c) => {
  const client = db(c.env);
  const [departments, tasks] = await Promise.all([
    listDepartments(client),
    client.from("tasks").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(100),
  ]);
  return c.html(<AllTasksPage tasks={must<Task[]>(tasks)} departments={departments} />);
});

web.post("/orders", async (c) => {
  const form = await c.req.parseBody();
  const instruction = String(form.instruction ?? "").trim();
  const department = String(form.department ?? "cos");
  if (!instruction) return c.redirect("/");

  const client = db(c.env);
  if (!(await getDepartment(client, department))) return c.text("알 수 없는 부서", 400);
  const task = await createTask(client, { department, title: titleFrom(instruction), instruction, source: "ceo_web" });
  c.executionCtx.waitUntil(processQueue(c.env).catch((err) => console.error("processQueue failed", err)));
  return c.redirect(`/t/${task.id}`);
});

web.get("/d/:id", async (c) => {
  const client = db(c.env);
  const dept = await getDepartment(client, c.req.param("id"));
  if (!dept) return c.notFound();
  const [departments, open, history, memories] = await Promise.all([
    listDepartments(client),
    client.from("tasks").select("*").eq("department", dept.id).in("status", ["queued", "working"]).order("created_at"),
    client.from("tasks").select("*").eq("department", dept.id).in("status", ["done", "failed"]).order("finished_at", { ascending: false }).limit(30),
    client.from("knowledge").select(KNOWLEDGE_COLUMNS).eq("department", dept.id).eq("active", true).order("weight", { ascending: false }).order("updated_at", { ascending: false }).limit(10),
  ]);
  return c.html(
    <DepartmentPage
      dept={dept}
      departments={departments}
      open={must<Task[]>(open)}
      history={must<Task[]>(history)}
      memories={must<Knowledge[]>(memories)}
    />
  );
});

web.post("/d/:id/goals", async (c) => {
  const form = await c.req.parseBody();
  const client = db(c.env);
  must(
    await client
      .from("departments")
      .update({
        goals: String(form.goals ?? "").slice(0, 4000),
        ...(typeof form.mission === "string" && form.mission.trim() ? { mission: form.mission.trim().slice(0, 1000) } : {}),
        ...(typeof form.job === "string" ? { job: form.job.trim().slice(0, 6000) || null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.req.param("id"))
  );
  return c.redirect(`/d/${c.req.param("id")}`);
});

web.get("/t/:id", async (c) => {
  const client = db(c.env);
  const task = await getTask(client, c.req.param("id"));
  if (!task) return c.notFound();
  const [departments, events, children, parent] = await Promise.all([
    listDepartments(client),
    client.from("task_events").select("*").eq("task_id", task.id).order("at"),
    client.from("tasks").select("*").eq("parent_id", task.id).order("created_at"),
    task.parent_id ? getTask(client, task.parent_id) : Promise.resolve(null),
  ]);
  return c.html(
    <TaskPage
      task={task}
      dept={departments.find((d) => d.id === task.department)}
      departments={departments}
      events={must<TaskEvent[]>(events)}
      children={must<Task[]>(children)}
      parent={parent}
      reportHtml={task.result_md ? renderMarkdown(task.result_md) : null}
    />
  );
});

web.get("/t/:id/print", async (c) => {
  const client = db(c.env);
  const task = await getTask(client, c.req.param("id"));
  if (!task?.result_md) return c.notFound();
  const dept = (await listDepartments(client)).find((d) => d.id === task.department);
  return c.html(<PrintPage task={task} dept={dept} reportHtml={renderMarkdown(task.result_md)} />);
});

web.get("/t/:id/report.md", async (c) => {
  const task = await getTask(db(c.env), c.req.param("id"));
  if (!task?.result_md) return c.notFound();
  const filename = encodeURIComponent(`${task.title}.md`);
  return c.body(`# ${task.title}\n\n요약: ${task.summary ?? ""}\n\n${task.result_md}`, 200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
  });
});

web.post("/t/:id/cancel", async (c) => {
  const client = db(c.env);
  const id = c.req.param("id");
  const res = must<Task[]>(await client.from("tasks").update({ status: "cancelled" }).eq("id", id).eq("status", "queued").select());
  if (res.length) await logEvent(client, id, "cancelled", "CEO 가 취소함");
  return c.redirect(`/t/${id}`);
});

web.post("/t/:id/retry", async (c) => {
  const client = db(c.env);
  const id = c.req.param("id");
  const res = must<Task[]>(await client.from("tasks").update({ status: "queued", attempts: 0, error: null, finished_at: null }).eq("id", id).eq("status", "failed").select());
  if (res.length) {
    await logEvent(client, id, "retry", "CEO 가 다시 시도를 요청함");
    c.executionCtx.waitUntil(processQueue(c.env).catch((err) => console.error("processQueue failed", err)));
  }
  return c.redirect(`/t/${id}`);
});

web.post("/t/:id/good", async (c) => {
  await followUp(c.env, db(c.env), c.req.param("id"), "good");
  return c.redirect(`/t/${c.req.param("id")}`);
});

web.post("/t/:id/:action{next|apply}", async (c) => {
  const outcome = await followUp(c.env, db(c.env), c.req.param("id"), c.req.param("action") as "next" | "apply");
  if (outcome.kind === "next") {
    c.executionCtx.waitUntil(processQueue(c.env).catch((err) => console.error(err)));
    return c.redirect(`/t/${outcome.taskId}`);
  }
  return c.redirect(`/t/${c.req.param("id")}`);
});

web.post("/t/:id/feedback", async (c) => {
  const form = await c.req.parseBody();
  const feedback = String(form.feedback ?? "").trim();
  const client = db(c.env);
  const task = await getTask(client, c.req.param("id"));
  if (!task || !feedback) return c.redirect(`/t/${c.req.param("id")}`);
  // CEO feedback outranks anything a department learned on its own.
  await remember(c.env, client, [{ department: task.department, kind: "feedback", content: `'${task.title}' 보고서에 대한 CEO 피드백: ${feedback}`, weight: 5, source_task: task.id }]);
  await logEvent(client, task.id, "feedback", `CEO 피드백: ${feedback}`);
  return c.redirect(`/t/${task.id}`);
});

web.get("/knowledge", async (c) => {
  const client = db(c.env);
  const dept = c.req.query("dept") || undefined;
  const playbooks = c.req.query("playbooks") === "1";
  let query = client.from("knowledge").select(KNOWLEDGE_COLUMNS).eq("active", true);
  if (dept) query = query.eq("department", dept);
  if (playbooks) query = query.like("content", `${PLAYBOOK_PREFIX}%`);
  const [departments, items] = await Promise.all([
    listDepartments(client),
    query.order("weight", { ascending: false }).order("updated_at", { ascending: false }).limit(150),
  ]);
  return c.html(<KnowledgePage items={must<Knowledge[]>(items)} departments={departments} dept={dept} playbooks={playbooks} />);
});

// Start 대비 훈련 for every department now instead of waiting for its hour.
web.post("/knowledge/drill", async (c) => {
  const client = db(c.env);
  const { data: open } = await client.from("tasks").select("department").like("title", `${DRILL_TITLE_PREFIX}%`).in("status", ["queued", "working"]);
  const busy = new Set(((open ?? []) as { department: string }[]).map((t) => t.department));
  const departments = await listDepartments(client);
  for (const r of drillsFor(departments).filter((x) => !busy.has(x.department))) {
    const d = departments.find((x) => x.id === r.department);
    if (!d) continue;
    await createTask(client, { department: d.id, title: r.title, instruction: drillInstruction(d, await listPlaybookTitles(client, d.id)), source: "schedule" });
  }
  return c.redirect("/tasks");
});

// 기억 지도: every active memory — the list page shows only the top ones.
// Read in pages because the database returns at most 1000 rows at a time.
const GRAPH_MAX = 5000;
web.get("/knowledge/graph.json", async (c) => {
  const client = db(c.env);
  const rows: Pick<Knowledge, "department" | "kind" | "content" | "weight">[] = [];
  for (let from = 0; from < GRAPH_MAX; from += 1000) {
    const { data, error } = await client.from("knowledge").select("department,kind,content,weight").eq("active", true).order("weight", { ascending: false }).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  return c.json(graphData(currentCompany().name, await listDepartments(client), rows), 200, { "Cache-Control": "no-store" });
});

web.get("/knowledge/export.md", async (c) => {
  const md = await buildMemoryExport(db(c.env));
  const filename = encodeURIComponent(`회사의기억_${new Date().toISOString().slice(0, 10)}.md`);
  return c.body(md, 200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${filename}` });
});

web.post("/knowledge/backup", async (c) => {
  await sendMemoryBackup(c.env, db(c.env));
  return c.redirect("/knowledge");
});

web.post("/knowledge", async (c) => {
  const form = await c.req.parseBody();
  const content = String(form.content ?? "").trim();
  const department = String(form.department ?? "") || null;
  if (content) await remember(c.env, db(c.env), [{ department, kind: "feedback", content: `CEO 지시: ${content}`, weight: 5 }]);
  return c.redirect(`/knowledge${department ? `?dept=${department}` : ""}`);
});

web.post("/knowledge/:id/forget", async (c) => {
  must(await db(c.env).from("knowledge").update({ active: false, updated_at: new Date().toISOString() }).eq("id", c.req.param("id")));
  return c.redirect(c.req.header("referer") ?? "/knowledge");
});

web.get("/vision", async (c) => {
  const client = db(c.env);
  const [profile, settings] = await Promise.all([getProfile(client), loadSettings(client)]);
  return c.html(<VisionPage profile={profile} statusNote={settings?.statusNote ?? ""} />);
});

web.post("/vision", async (c) => {
  const form = await c.req.parseBody();
  const vision = String(form.vision ?? "").trim().slice(0, 4000);
  const strategy = String(form.strategy ?? "").trim().slice(0, 6000);
  if (vision) {
    must(await db(c.env).from("company_profile").upsert({ id: 1, vision, strategy, updated_at: new Date().toISOString() }));
  }
  if (typeof form.statusNote === "string") await saveSetting(db(c.env), "statusNote", form.statusNote.trim().slice(0, 4000));
  return c.redirect("/vision");
});

web.get("/proposals", async (c) => {
  const client = db(c.env);
  const [departments, open, decided] = await Promise.all([
    listDepartments(client),
    client.from("proposals").select("*").in("status", ["pending", "held"]).order("created_at", { ascending: false }).limit(50),
    client.from("proposals").select("*").in("status", ["approved", "rejected"]).order("decided_at", { ascending: false }).limit(30),
  ]);
  return c.html(<ProposalsPage proposals={[...must<Proposal[]>(open), ...must<Proposal[]>(decided)]} departments={departments} />);
});

web.post("/proposals/:id", async (c) => {
  const form = await c.req.parseBody();
  const decision = String(form.decision ?? "") as Decision;
  if (!["approve", "hold", "reject"].includes(decision)) return c.text("잘못된 결정", 400);
  const outcome = await decideProposal(c.env, db(c.env), c.req.param("id"), decision, String(form.note ?? ""));
  if (outcome.kind === "done" && outcome.taskId) {
    c.executionCtx.waitUntil(processQueue(c.env).catch((err) => console.error("processQueue failed", err)));
  }
  return c.redirect("/proposals");
});

// 설치 화면: one page, five steps, each with a ✅/❌ and what to fix.
// Logo images are public (they appear on the login page and home screen).
web.get("/brand/:kind", async (c) => {
  const kind = c.req.param("kind") as BrandKind;
  if (!BRAND_KINDS.includes(kind) || !c.env.DB_OK) return c.notFound();
  const image = fromDataUrl((await loadBrandImage(db(c.env), kind)) ?? "");
  if (!image) return c.notFound();
  return new Response(image.bytes, { headers: { "Content-Type": image.type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});

async function renderSetup(c: { env: Env; req: { url: string }; html: (h: unknown) => Response | Promise<Response> }, notice?: { ok: boolean; message: string }) {
  const checks = await setupChecks(c.env);
  const dbReady = !!c.env.DB_OK;
  const settings = dbReady ? await loadSettings(db(c.env)).catch(() => null) : null;
  let departments: string[] = [];
  try {
    departments = dbReady ? (await listDepartments(db(c.env))).map((d) => d.id) : [];
  } catch {
    departments = [];
  }
  return c.html(<SetupWizard checks={checks} settings={settings} installed={departments} catalog={CATALOG} notice={notice} />);
}

web.get("/setup", async (c) => {
  await rememberBase(c.env, c.req.url).catch(() => undefined);
  return renderSetup(c);
});

web.post("/setup/company", async (c) => {
  const form = await c.req.parseBody();
  const text = (k: string, max = 1000) => String(form[k] ?? "").trim().slice(0, max);
  const company: Company = { ...DEFAULT_COMPANY, name: text("name", 80) || DEFAULT_COMPANY.name, business: text("business"), customers: text("customers"), stage: text("stage"), rules: text("rules", 3000), country: text("country", 40) || "대한민국", benchmarks: text("benchmarks", 1000) };
  if (!company.business) return renderSetup(c, { ok: false, message: "'무엇을 하는 회사인가요?' 를 적어 주세요. 모든 부서가 이걸 보고 일합니다." });
  const client = db(c.env);
  await saveSetting(client, "company", company);
  const vision = text("vision", 4000);
  if (vision) must(await client.from("company_profile").upsert({ id: 1, vision, strategy: "", updated_at: new Date().toISOString() }));
  return renderSetup(c, { ok: true, message: "회사 소개를 저장했습니다. 이제 부서를 고르세요." });
});

// 로고와 메뉴 색: any of the three images, the side menu colour, or removals.
web.post("/setup/brand", async (c) => {
  const form = await c.req.parseBody();
  const client = db(c.env);
  const versions = { ...currentBrand().versions };
  const changed: string[] = [];
  for (const kind of BRAND_KINDS) {
    const key = `${BRAND_ROW_PREFIX}${kind}`;
    if (form[`remove_${kind}`]) {
      must(await client.from("settings").delete().eq("key", key));
      delete versions[kind];
      changed.push(`${BRAND_LABEL[kind]} 삭제`);
      continue;
    }
    const file = form[kind];
    if (!(file instanceof File) || file.size === 0) continue;
    const converted = toDataUrl(new Uint8Array(await file.arrayBuffer()));
    if (!converted.ok) return renderSetup(c, { ok: false, message: `${BRAND_LABEL[kind]}: ${converted.message}` });
    must(await client.from("settings").upsert({ key, value: converted.dataUrl, updated_at: new Date().toISOString() }));
    versions[kind] = Date.now();
    changed.push(`${BRAND_LABEL[kind]} 저장`);
  }
  const theme = form.theme === "white" ? "white" : "black";
  await saveSetting(client, "brand", JSON.stringify(versions));
  await saveSetting(client, "sideTheme", theme);
  setBrand({ versions, theme });
  return renderSetup(c, { ok: true, message: `${[...changed, `메뉴 색: ${theme === "white" ? "화이트" : "블랙"}`].join(" · ")}. 휴대폰 홈 화면 아이콘은 한 번 지웠다가 다시 추가해야 바뀝니다.` });
});

const BRAND_LABEL: Record<BrandKind, string> = { logoLight: "밝은 배경용 로고", logoDark: "어두운 배경용 로고", icon: "앱 아이콘" };

web.post("/setup/departments", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const picked = ([] as unknown[]).concat(form.departments ?? []).map(String);
  const website = String(form.website ?? "").trim();
  const client = db(c.env);
  await installDepartments(client, picked);
  if (website) {
    const url = /^https?:\/\//.test(website) ? website : `https://${website}`;
    await saveSetting(client, "websiteUrl", url.replace(/\/+$/, ""));
  }
  return renderSetup(c, { ok: true, message: `부서를 만들었습니다. 이제 텔레그램을 연결하세요.` });
});

web.post("/setup/telegram", async (c) => {
  const registered = await registerWebhook(c.env);
  if (!registered.ok) return renderSetup(c, registered);
  if (!c.env.TELEGRAM_CEO_CHAT_ID) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
    await saveSetting(db(c.env), "telegramCode", code);
  }
  return renderSetup(c, { ok: true, message: c.env.TELEGRAM_CEO_CHAT_ID ? "텔레그램을 다시 연결했습니다. /check 를 보내 보세요." : "봇이 준비됐습니다. 아래 코드를 봇에게 보내세요." });
});

web.post("/setup/finish", async (c) => {
  const checks = await setupChecks(c.env);
  if (!checks.every((x) => x.ok || x.optional)) return renderSetup(c, { ok: false, message: "❌ 표시가 남아 있습니다. 위에서 하나씩 해결해 주세요." });
  await saveSetting(db(c.env), "setupDone", new Date().toISOString());
  return c.redirect("/");
});

web.get("/scoreboard", async (c) => {
  const requested = Number(c.req.query("days"));
  const days = [7, 30, 90].includes(requested) ? requested : 7;
  const client = db(c.env);
  const { rows, usage } = await loadScores(client, days);
  return c.html(<ScoreboardPage rows={rows} days={days} usage={usage} />);
});

