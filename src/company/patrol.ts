import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../env";

// 웹사이트 순찰: a real browser (Cloudflare Browser Rendering, free plan: 10
// browser-minutes a day) opens the company's website on a phone-sized
// screen, the way a first-time visitor would, and records what a person
// would run into: broken pages, errors, dead images, slow loads, leftover
// placeholder text — plus a screenshot of each page for the brain to look at.

export type PageCheck = {
  step: string;
  url: string;
  status: number | null;
  loadMs: number;
  title: string;
  consoleErrors: string[];
  failedRequests: string[];
  brokenImages: number;
  rawKeys: string[];
  text: string;
  screenshot?: string; // base64 JPEG
  error?: string;
};

export const PATROL_TITLE_PREFIX = "웹사이트 순찰";
const MAX_PAGES = 7;
const PAGE_TIMEOUT_MS = 20_000;

// Pages to visit after the home page: the site's own links, one per section
// (first path segment), so a patrol covers different parts of the site.
export function planVisits(base: string, links: string[], max = MAX_PAGES - 1): { step: string; url: string }[] {
  const origin = new URL(base).origin;
  const seenSections = new Set<string>([""]);
  const visits: { step: string; url: string }[] = [];
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link, origin);
    } catch {
      continue;
    }
    if (u.origin !== origin || /\.(pdf|jpg|jpeg|png|gif|zip|webp)$/i.test(u.pathname)) continue;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const section = path.split("/")[1] ?? "";
    if (seenSections.has(section)) continue;
    seenSections.add(section);
    visits.push({ step: decodeURIComponent(path), url: origin + path });
    if (visits.length >= max) break;
  }
  return visits;
}

// Template keys that leaked onto the screen, like "product.addToCart".
export function findRawKeys(text: string): string[] {
  return [...new Set(text.match(/\b[a-z][a-zA-Z]+(?:\.[a-z][a-zA-Z0-9]+){1,3}\b/g) ?? [])]
    .filter((k) => !/\.(com|net|org|io|site|kr|app|png|jpg|js|co)$/i.test(k) && !/^(e\.g|i\.e)/.test(k))
    .slice(0, 10);
}

export async function patrol(env: Env): Promise<PageCheck[]> {
  const base = (env.WEBSITE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("순찰할 웹사이트 주소가 없습니다. 설치 화면에서 웹사이트 주소를 넣어 주세요.");
  if (!env.BROWSER) throw new Error("브라우저 기능(BROWSER)이 연결되지 않았습니다.");

  const browser = await puppeteer.launch(env.BROWSER as Parameters<typeof puppeteer.launch>[0]);
  const checks: PageCheck[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 AI-HQ-Patrol"
    );

    let consoleErrors: string[] = [];
    let failedRequests: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => consoleErrors.push(`페이지 오류: ${String((e as Error).message ?? e).slice(0, 200)}`));
    page.on("response", (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${new URL(r.url()).pathname.slice(0, 120)}`);
    });

    const visit = async (step: string, url: string): Promise<string[]> => {
      consoleErrors = [];
      failedRequests = [];
      const started = Date.now();
      let status: number | null = null;
      try {
        const res = await page.goto(url, { waitUntil: "networkidle2", timeout: PAGE_TIMEOUT_MS });
        status = res?.status() ?? null;
        const info = (await page.evaluate(`(() => ({
          title: document.title,
          text: (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 1500),
          brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
          links: [...document.querySelectorAll("a[href]")].map((a) => a.href),
        }))()`)) as { title: string; text: string; brokenImages: number; links: string[] };
        const screenshot = (await page.screenshot({ type: "jpeg", quality: 45, encoding: "base64" })) as string;
        checks.push({
          step,
          url,
          status,
          loadMs: Date.now() - started,
          title: info.title,
          consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
          failedRequests: [...new Set(failedRequests)].slice(0, 8),
          brokenImages: info.brokenImages,
          rawKeys: findRawKeys(info.text),
          text: info.text,
          screenshot,
        });
        return info.links;
      } catch (err) {
        checks.push({ step, url, status, loadMs: Date.now() - started, title: "", consoleErrors, failedRequests, brokenImages: 0, rawKeys: [], text: "", error: err instanceof Error ? err.message : String(err) });
        return [];
      }
    };

    const links = await visit("첫 화면", `${base}/`);
    for (const v of planVisits(base, links)) await visit(v.step, v.url);
  } finally {
    await browser.close();
  }
  return checks;
}

// Plain-text findings for the brain (screenshots go separately, as images).
export function formatChecks(checks: PageCheck[]): string {
  return checks
    .map((c, i) =>
      [
        `### ${i + 1}. ${c.step} — ${c.url}`,
        c.error ? `❌ 열리지 않음: ${c.error}` : `HTTP ${c.status ?? "?"} · ${(c.loadMs / 1000).toFixed(1)}초 · 제목 "${c.title}"`,
        c.consoleErrors.length ? `콘솔 오류: ${c.consoleErrors.join(" / ")}` : "",
        c.failedRequests.length ? `실패한 요청: ${c.failedRequests.join(" / ")}` : "",
        c.brokenImages ? `깨진 이미지 ${c.brokenImages}개` : "",
        c.rawKeys.length ? `치환 안 된 것 같은 글자: ${c.rawKeys.join(", ")}` : "",
        c.text ? `화면 글자(앞부분): ${c.text.slice(0, 600)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

export function hasHardProblems(checks: PageCheck[]): boolean {
  return checks.some((c) => c.error || (c.status ?? 200) >= 500 || c.consoleErrors.length > 0 || c.brokenImages > 0 || c.loadMs > 8000);
}

export function patrolInstruction(): string {
  return `[지금 할 일: 웹사이트 순찰 보고]
로봇 브라우저가 휴대폰 화면 크기로 우리 웹사이트를 직접 열어 본 결과와 화면 캡처다. 너는 처음 온 고객의 눈으로 본다.
로그인 없이 본 것이다. 로그인이 필요한 화면에서 막히는 것 자체는 정상이다. 다만 막히는 안내가 친절한지는 본다.
찾을 것:
1. 오류: 안 열리는 화면, 콘솔 오류, 실패한 요청, 깨진 이미지, 8초 넘는 로딩
2. 어색한 점: 이해하기 어려운 문구, 남아 있는 임시 글자, 겹치거나 잘린 화면, 버튼이 어디 있는지 모르겠는 곳, 신뢰가 안 가는 부분
3. 더 있어야 할 것: 고객이 결정하는 데 필요한데 없는 정보(가격, 연락처, 환불·예약 안내, 믿을 근거)
캡처 화면을 실제로 보고 판단한다. 확인하지 못한 것은 추측하지 말고 "확인 필요"라고 쓴다.
문제마다 심각도(높음·중간·낮음)를 붙인다. 고칠 것 중 가장 심각한 하나는 "## 개발 요청서" 로 쓴다.
문제가 하나도 없으면 첫 줄을 정확히 "요약: 이상 없음" 으로 쓴다.`;
}
