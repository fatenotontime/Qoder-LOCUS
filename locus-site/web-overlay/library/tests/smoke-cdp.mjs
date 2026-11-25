// 文献库嵌入视图 · 冒烟与回归（开发自测，非发布物）
// 依赖：本机 Edge + Node 24 全局 WebSocket / fetch。
// 用法：node smoke-cdp.mjs  （需先由 build-web.mjs 生成 ../../web/）
// 覆盖：新「文献库」导航可进入，卡片/定位/对照/回查可用；回归原有导航页与冷色主题入口。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../../../web");            // 静态站点根（build-web 产物）
const DEMO = resolve(HERE, "../../../demo-data");      // 预置快照
const OUT = resolve(HERE, "_evidence");
mkdirSync(OUT, { recursive: true });

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const CDP_PORT = 9336;
const WEB_PORT = 8795;
const PROFILE = "C:/Users/PC/AppData/Local/Temp/edge-lib-cdp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(resolve(ROOT, "index.html"))) { console.error("缺少 web/ 产物：先运行 build-web.mjs（public 模式）"); process.exit(2); }

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".wiki": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

function sendFile(res, path) {
  if (!existsSync(path) || !statSync(path).isFile()) { res.writeHead(404, { "content-type": "text/plain" }); res.end("404"); return; }
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(path));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  // 让前端可启动：shim 把 /api/state 改写为 /functions/v1/app/api/state；映射到预置快照。
  if (p === "/functions/v1/app/api/state") return sendFile(res, resolve(DEMO, "snapshot/state.json"));
  if (p === "/functions/v1/app" || p.startsWith("/functions/v1/app/")) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
  if (p === "/") p = "/index.html";
  sendFile(res, resolve(ROOT, "." + p));
});

async function waitJson(url, tries = 50) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(200); }
  throw new Error("CDP not ready: " + url);
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.waiters = new Map(); this.errors = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
      else if (m.method) {
        if (m.method === "Runtime.exceptionThrown") this.errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
        if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") this.errors.push(m.params.args?.map((a) => a.value ?? a.description).join(" "));
        const list = this.waiters.get(m.method); if (list?.length) list.shift()(m.params);
      }
    });
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  once(method) { return new Promise((res) => { const l = this.waiters.get(method) ?? []; l.push(res); this.waiters.set(method, l); }); }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result?.value;
  }
}

async function shot(cdp, name) { const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(OUT, name), Buffer.from(data, "base64")); console.log("shot:", name); }

const report = { nav: null, library: null, interactions: null, regression: null, errors: [] };

let proc;
try {
  await new Promise((r) => server.listen(WEB_PORT, "127.0.0.1", r));
  proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, "about:blank"], { stdio: "ignore" });
  await waitJson(`http://127.0.0.1:${CDP_PORT}/json/version`);

  const page = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.clear();}catch(e){}" });
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/index.html` });
  await loaded; await sleep(1200);

  // 1) 导航项存在（新增项在最末）
  report.nav = await cdp.evaluate(`(() => {
    const items = [...document.querySelectorAll('#nav .navitem')].map(b => b.dataset.nav);
    const lib = document.querySelector('#nav .navitem[data-nav="library"]');
    return { items, hasLibrary: !!lib, libLabel: lib?.textContent?.trim() ?? null, status: document.querySelector('#status')?.textContent,
      midText: document.querySelector('#mid-content')?.textContent?.trim().slice(0, 160),
      shim: typeof window.fetch === 'function' };
  })()`);
  console.log("NAV", JSON.stringify(report.nav));
  console.log("LOAD-ERRORS", JSON.stringify(cdp.errors.slice(0, 8)));

  // 2) 进入文献库
  await cdp.evaluate(`document.querySelector('#nav .navitem[data-nav="library"]').click()`);
  for (let i = 0; i < 40 && !(await cdp.evaluate(`!!document.querySelector('#lv-mount.lv-root')`)); i++) await sleep(200);
  report.library = await cdp.evaluate(`(() => {
    const root = document.querySelector('#lv-mount.lv-root');
    return {
      mounted: !!root,
      papers: document.querySelectorAll('#lv-mount .lv-paper').length,
      tabs: [...document.querySelectorAll('#lv-mount .lv-tab')].map(b => b.textContent.trim()),
      originalText: !!document.querySelector('#lv-mount .lv-src'),
      missText: document.querySelector('#lv-mount .lv-miss')?.textContent?.slice(0, 120) ?? null,
      cssApplied: getComputedStyle(document.querySelector('#lv-mount .lv-tab') || document.body).borderRadius,
    };
  })()`);
  console.log("LIBRARY", JSON.stringify(report.library));
  await shot(cdp, "lib-01-original.png");

  // 3) 交互：定位 / 卡片展开 / 对照 / 回查
  report.interactions = await cdp.evaluate(`(async () => {
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => [...document.querySelectorAll(s)];
    const out = {};
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    // 原文定位
    const loc = $('#lv-mount [data-lv="locate"]'); if (loc) loc.click(); await wait(120);
    out.highlighted = $$('#lv-mount .lv-src mark').length;
    // 证据卡
    $$('#lv-mount .lv-tab').find(b => b.dataset.view === 'cards')?.click(); await wait(120);
    out.cardCount = $$('#lv-mount .lv-card').length;
    const cb = $('#lv-mount .lv-cardbtn'); if (cb) cb.click(); await wait(120);
    out.cardDetailOpen = !!$('#lv-mount .lv-cdetail');
    out.cardHasFields = $$('#lv-mount .lv-cdetail .lv-table tbody tr').length;
    // 对照
    $$('#lv-mount .lv-tab').find(b => b.dataset.view === 'compare')?.click(); await wait(120);
    out.compareTables = $$('#lv-mount .lv-table').length;
    out.compareMiss = !!$('#lv-mount .lv-miss');
    // 回查
    $$('#lv-mount .lv-tab').find(b => b.dataset.view === 'backtrace')?.click(); await wait(120);
    out.backtraceStartRows = $$('#lv-mount .lv-startrow .lv-link').length;
    const bs = $('#lv-mount .lv-startrow .lv-link'); if (bs) bs.click(); await wait(150);
    out.backtraceNodes = $$('#lv-mount .lv-node').length;
    out.backtraceGroups = $$('#lv-mount .lv-netgroup').length;
    out.backtraceEdges = $$('#lv-mount .lv-edges li').length;
    return out;
  })()`);
  console.log("INTERACTIONS", JSON.stringify(report.interactions));
  await shot(cdp, "lib-02-backtrace.png");

  // 4) 回归：原有导航页与冷色入口
  report.regression = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const click = async (nav) => { document.querySelector('#nav .navitem[data-nav="'+nav+'"]').click(); await wait(500); };
    const out = {};
    await click('topic'); out.topic = { title: document.querySelector('#mid-title')?.textContent, hasFlow: !!document.querySelector('.flowcard') || !!document.querySelector('.topiccard') };
    await click('papers'); out.papers = { title: document.querySelector('#mid-title')?.textContent, hasSidebar: document.querySelectorAll('#material-list .material').length };
    await click('knowledge'); out.knowledge = { title: document.querySelector('#mid-title')?.textContent, hasKz: !!document.querySelector('.kzw') || !!document.querySelector('#mid-content .kz') };
    out.themeSeal = !!document.querySelector('#theme-seal');
    out.replayTheme = !!document.querySelector('#replay-theme');
    out.aiDrawer = !!document.querySelector('#ai-drawer');
    return out;
  })()`);
  console.log("REGRESSION", JSON.stringify(report.regression));
  await shot(cdp, "reg-01-topic.png");

  report.errors = cdp.errors.filter((e) => !/404|Failed to load resource|\/api\//.test(e));
  console.log("PAGE-ERRORS(non-404)", JSON.stringify(report.errors));

  ws.close();
} finally {
  if (proc) proc.kill();
  server.close();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("report written:", resolve(OUT, "report.json"));
}
