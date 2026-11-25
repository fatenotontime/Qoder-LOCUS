// S10 验收 R05–R10 可重跑骨架（独立验收 executor-e3）。
// 定位：本轮只给结构与可测的粗粒度取证；具体断言/选择器随集成负责人交付的新入口更新。
// 未实现处标 TODO 并如实返回 status="TODO"，不伪造通过。
// 用法：
//   PUBLIC=http://127.0.0.1:5380 TRIAL=http://127.0.0.1:5281 NODE=http://127.0.0.1:5284 \
//   OUT=<evidence 目录> EVRAF=<临时目录> \
//   NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
//   node record/acceptance-s10/scripts/r05_r10_skeleton.mjs
import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "node:fs";

const PUBLIC = process.env.PUBLIC || "http://127.0.0.1:5380";
const TRIAL = process.env.TRIAL || "http://127.0.0.1:5281";
const OUT = process.env.OUT || ".";
const R = { env: { PUBLIC, TRIAL, candidate: null }, r05: {}, r06: {}, r07: {}, r08: {}, r09: {}, r10: {}, reqs: [] };
const api = async (p) => { const r = await fetch("http://127.0.0.1:5284" + p); return { status: r.status, json: await r.json().catch(() => null) }; };
fs.mkdirSync(`${OUT}/raw`, { recursive: true });
fs.mkdirSync(`${OUT}/screens`, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const unroll = async (p) => {
  await p.waitForTimeout(3500);
  const ov = await p.evaluate(() => document.getElementById("overlay")?.className || "");
  if (ov.includes("awaiting")) { await p.mouse.click(720, 450); await p.waitForTimeout(2500); }
};
const nav = async (p, kind) => {
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  try { await p.click(`.navitem[data-nav="${kind}"]`, { timeout: 5000 }); } catch { await p.click(`.navitem[data-nav="${kind}"]`, { force: true }); }
  await p.waitForTimeout(900);
};

try {
  const st = await api("/api/state");
  R.env.candidate = { topics: st.json?.topics?.length ?? null };
} catch (e) { R.env.candidateErr = String(e); }

// ── R05：无 Node 打开公开首页，点各类对象；业务请求应为 0 ──
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const reqs = [];
  page.on("request", (r) => reqs.push({ url: r.url(), method: r.method() }));
  page.on("pageerror", (e) => (R.r05.pageerror = (R.r05.pageerror || []).concat(e.message)));
  await page.goto(PUBLIC + "/", { waitUntil: "networkidle", timeout: 30000 }); await unroll(page);
  R.r05.boot = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme, displayMode: document.documentElement.dataset.displayMode || null,
    badge: (document.querySelector("#display-badge")?.textContent || "").trim(),
    navItems: [...document.querySelectorAll(".navitem[data-nav]")].map((n) => n.getAttribute("data-nav")),
  }));
  for (const k of ["library", "protocol", "record", "analysis", "chat"]) { await nav(page, k); }
  // TODO(新入口)：点文献卡/方案/记录/方法/初稿/对话的具体对象并断言可见内容与真实采用上下文；
  //              目前只取导航可达性与请求计数。
  R.r05.navReachable = await page.evaluate(() => [...document.querySelectorAll(".navitem[data-nav]")].length);
  R.r05.req = {
    total: reqs.length,
    api: reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/")).length,
    demoData: reqs.filter((r) => r.url.includes("/demo-data")).length,
    external: reqs.filter((r) => !r.url.startsWith(PUBLIC) && !r.url.startsWith(TRIAL) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.includes("kaspersky")).length,
  };
  R.r05.status = R.r05.req.api === 0 ? "PARTIAL(api=0；对象级断言 TODO)" : "FAIL(api>0)";
  await page.screenshot({ path: `${OUT}/screens/r05_public.png` });
  await ctx.close();
} catch (e) { R.r05.error = String(e).slice(0, 300); R.r05.status = "ERROR"; }

// ── R06：报告数值 → 结果/表/记录/原件，下载 Word/追溯包/样本 ZIP ──
try {
  // TODO(新入口)：定位报告「90 天」数值块 → 逐跳点击；三处下载用 acceptDownloads 保存并校验类型/哈希。
  R.r06.status = "TODO";
} catch (e) { R.r06.error = String(e).slice(0, 300); R.r06.status = "ERROR"; }

// ── R07：临时拦掉一份静态引用文件，打开样本 ZIP ──
try {
  // TODO：page.route 拦截某引用文件返回 404，断言受影响区域有可见提示+重试入口；ZIP 仍可下载。
  R.r07.status = "TODO";
} catch (e) { R.r07.error = String(e).slice(0, 300); R.r07.status = "ERROR"; }

// ── R08：列表→详情→返回/后退/刷新；三入口打开设置；窄屏 ──
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(TRIAL + "/", { waitUntil: "networkidle", timeout: 30000 }); await unroll(page);
  R.r08.settingsBtn = await page.evaluate(() => !!document.getElementById("settings-open"));
  try { await page.click("#settings-open"); await page.waitForTimeout(800); R.r08.settingsOpen = await page.evaluate(() => !!document.querySelector("#settings-fan-title") && document.querySelector("#settings-fan-title").getBoundingClientRect().width > 0); } catch {}
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(600);
  R.r08.narrowScrollX = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth + 2 }));
  // TODO(新入口)：列表→详情→返回位置/筛选/滚动恢复、浏览器后退、刷新恢复的逐项断言；公开 5380 与原生 5284 也各开一次设置。
  R.r08.status = "PARTIAL(设置按钮/窄屏横向宽度已测；列表恢复断言 TODO)";
  await page.screenshot({ path: `${OUT}/screens/r08_narrow.png` });
  await ctx.close();
} catch (e) { R.r08.error = String(e).slice(0, 300); R.r08.status = "ERROR"; }

// ── R09：可写课题导入公开材料并完成 P8 五步 ──
try { R.r09.status = "TODO(P8 五步：文献/数据导入→重复原件拒绝→方案引用→执行追加→地图选择/对话核对)"; } catch (e) { R.r09.error = String(e).slice(0, 300); }

// ── R10：预存课题 vs 可写课题同套材料逐项比较 ──
try { R.r10.status = "TODO(文献卡/表格/实验图/结果/回查逐项比较；个人态请求应属自己课题，预存态只读快照)"; } catch (e) { R.r10.error = String(e).slice(0, 300); }

await browser.close();
fs.writeFileSync(`${OUT}/raw/r05_r10_skeleton.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
