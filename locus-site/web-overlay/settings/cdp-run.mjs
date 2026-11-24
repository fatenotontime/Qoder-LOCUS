// 开发自测用 CDP 驱动（非发布物）：精确视口截图 + 页面内自测。
// 依赖：本机 Edge（--remote-debugging-port），Node 24 全局 WebSocket。
// 用法：node cdp-run.mjs
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const OUT = resolve(HERE, "_evidence");
mkdirSync(OUT, { recursive: true });

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const BASE = "http://127.0.0.1:8781/settings/preview.html";
const PROFILE = "C:/Users/PC/AppData/Local/Temp/edge-fan-cdp";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 每个新文档先清掉偏好键，避免同一 profile 的 localStorage 串场
const CLEAN =
  "try{['locus.theme.v1','locus.motion.v1','locus.density.v1','locus.fontsize.v1'].forEach(function(k){localStorage.removeItem(k)});}catch(e){}";

async function waitJson(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(200);
  }
  throw new Error("CDP endpoint not ready: " + url);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        if (msg.method === "Runtime.exceptionThrown") {
          this.errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
        }
        if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
          this.errors.push(msg.params.args?.map((a) => a.value ?? a.description).join(" "));
        }
        const list = this.waiters.get(msg.method);
        if (list?.length) {
          const w = list.shift();
          w(msg.params);
        }
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  once(method) {
    return new Promise((res) => {
      const list = this.waiters.get(method) ?? [];
      list.push(res);
      this.waiters.set(method, list);
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result?.value;
  }
}

async function withPage({ url, width, height, initScript }, fn) {
  const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new Cdp(ws);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    if (initScript) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: initScript });
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(900);
    return await fn(cdp);
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${page.id}`); } catch { /* 忽略 */ }
    ws.close();
  }
}

async function shot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(OUT, name), Buffer.from(data, "base64"));
  console.log("shot:", name);
}

const jobs = [
  { name: "fan-1440x900.png", w: 1440, h: 900, q: "open=appearance&still=1", tab: null },
  { name: "fan-1280x720.png", w: 1280, h: 720, q: "open=appearance&still=1" },
  { name: "fan-1024x768-models.png", w: 1024, h: 768, q: "open=models&still=1" },
  { name: "fan-390x800-sheet.png", w: 390, h: 800, q: "open=about&still=1" },
  { name: "fan-1280x560-short.png", w: 1280, h: 560, q: "open=models&still=1" },
  { name: "fan-800x600-sheet.png", w: 800, h: 600, q: "open=appearance&still=1" },
  { name: "fan-reduced-1024x768.png", w: 1024, h: 768, q: "open=appearance&still=1&seedmotion=reduced" },
  { name: "fan-seedtech-1024x768.png", w: 1024, h: 768, q: "open=appearance&still=1&seedtech=1" },
];

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "about:blank",
], { stdio: "ignore" });

const report = { shots: [], tests: [], errors: [] };

try {
  await waitJson(`http://127.0.0.1:${PORT}/json/version`);

  for (const job of jobs) {
    const info = await withPage({ url: `${BASE}?${job.q}`, width: job.w, height: job.h, initScript: CLEAN }, async (cdp) => {
      await shot(cdp, job.name);
      return cdp.evaluate(`(() => ({
        viewport: [innerWidth, innerHeight],
        sheet: document.querySelector('#settings-fan')?.dataset.fanSheet,
        theme: document.documentElement.dataset.theme,
        motion: document.documentElement.dataset.motion,
        open: document.querySelector('#settings-fan')?.classList.contains('is-open'),
        visible: !document.querySelector('#settings-fan')?.hidden,
        fanRect: (() => { const r = document.querySelector('#settings-fan').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()
      }))()`);
    });
    report.shots.push({ name: job.name, ...info });
    console.log(job.name, JSON.stringify(info));
  }

  // 减少动效的样式断言（不靠截图，直接读计算样式）
  report.reduced = await withPage({
    url: `${BASE}?open=appearance&still=1&seedmotion=reduced`,
    width: 1024, height: 768, initScript: CLEAN,
  }, async (cdp) =>
    cdp.evaluate(`(() => {
      const fan = document.querySelector('#settings-fan');
      const rib = fan.querySelector('.fan-rib');
      const ui = fan.querySelector('.fan-ui');
      return {
        motionAttr: document.documentElement.dataset.motion,
        switchChecked: fan.querySelector('[data-motion-switch]').getAttribute('aria-checked'),
        hint: fan.querySelector('[data-motion-hint]').textContent,
        ribTransform: getComputedStyle(rib).transform,
        ribTransition: getComputedStyle(rib).transitionDuration,
        a: getComputedStyle(fan).getPropertyValue('--locus-fan-a').trim(),
        uiOpacity: getComputedStyle(ui).opacity,
      };
    })()`)
  );
  console.log("REDUCED", JSON.stringify(report.reduced));

  // 1280×720 跑完整 DOM 自测（默认偏好）
  const tests = await withPage({ url: `${BASE}?still=1`, width: 1280, height: 720, initScript: CLEAN }, async (cdp) => {
    const res = await cdp.evaluate("window.__fanSelfTest()");
    report.errors.push(...cdp.errors);
    return res;
  });
  report.tests = tests;
  console.log("SELFTEST", JSON.stringify(tests));

  // 偏好刷新保留：改后刷新，值应与设置一致
  report.persist = await withPage({ url: `${BASE}?still=1`, width: 1280, height: 720 }, async (cdp) => {
    await cdp.evaluate("localStorage.clear()");
    let loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.reload");
    await loaded;
    await sleep(700);
    await cdp.evaluate(`(() => {
      window.LocusSettings.open('appearance');
      const fan = document.querySelector('#settings-fan');
      fan.querySelector('[data-density-seg] button[data-v="compact"]').click();
      fan.querySelector('[data-fontsize-seg] button[data-v="lg"]').click();
      const sw = fan.querySelector('[data-motion-switch]');
      if (sw.getAttribute('aria-checked') === 'true') sw.click();
      return true;
    })()`);
    loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.reload");
    await loaded;
    await sleep(700);
    return cdp.evaluate(`(() => {
      const fan = document.querySelector('#settings-fan');
      return {
        density: document.documentElement.dataset.density,
        fontsize: document.documentElement.dataset.fontsize,
        motion: document.documentElement.dataset.motion,
        pressedDensity: fan.querySelector('[data-density-seg] button[aria-pressed="true"]')?.dataset.v,
        pressedFontsize: fan.querySelector('[data-fontsize-seg] button[aria-pressed="true"]')?.dataset.v,
        stored: { density: localStorage.getItem('locus.density.v1'), fontsize: localStorage.getItem('locus.fontsize.v1'), motion: localStorage.getItem('locus.motion.v1') },
      };
    })()`);
  });
  console.log("PERSIST", JSON.stringify(report.persist));

  // 预存 tech 的独立校验（通过 CDP initScript 在页面脚本前写入）
  const seed = await withPage({
    url: `${BASE}?still=1`,
    width: 1024, height: 768,
    initScript: "try{localStorage.setItem('locus.theme.v1','tech');}catch(e){}",
  }, async (cdp) => {
    return cdp.evaluate(`(() => ({
      theme: document.documentElement.dataset.theme,
      stored: (()=>{try{return localStorage.getItem('locus.theme.v1')}catch(e){return 'err'}})(),
      techNodes: document.querySelectorAll('[data-theme="tech"]').length,
      hasColdEntry: !!document.querySelector('#theme-seal, #replay-theme')
    }))()`);
  });
  report.seedtech = seed;
  console.log("SEEDTECH", JSON.stringify(seed));
} finally {
  proc.kill();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("report written");
}
