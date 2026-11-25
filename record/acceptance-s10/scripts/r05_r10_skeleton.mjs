// S10 验收 R05–R10（独立验收 executor-e3）。
// R05–R08 实测；R09/R10 部分（P8 五步/两源逐项比较的重 UI 项待 P8 脚本与达尔文预导入）。
// 用法：
//   PUBLIC=http://127.0.0.1:5380 TRIAL=http://127.0.0.1:5581 NODE=http://127.0.0.1:5284 \
//   OUT=<evidence 目录> EVRAF=<临时目录> \
//   NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
//   node record/acceptance-s10/scripts/r05_r10_skeleton.mjs
import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "node:fs";
import crypto from "node:crypto";

const PUBLIC = process.env.PUBLIC || "http://127.0.0.1:5380";
const TRIAL = process.env.TRIAL || "http://127.0.0.1:5581";
const NODEURL = process.env.NODE || "http://127.0.0.1:5284";
const OUT = process.env.OUT || ".";
const EVRAF = process.env.EVRAF || ".";
const R = { env: { PUBLIC, TRIAL, NODE: NODEURL, candidate: null }, r05: {}, r06: {}, r07: {}, r08: {}, r09: {}, r10: {} };
const api = async (p, opt) => { const r = await fetch(NODEURL + p, opt); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j }; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const ext = (n) => (n.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
const okd = (o) => !!(o && o.found && o.bytes > 0 && !o.error);
fs.mkdirSync(`${OUT}/raw`, { recursive: true });
fs.mkdirSync(`${OUT}/screens`, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const unroll = async (p) => { await p.waitForTimeout(3500); const ov = await p.evaluate(() => document.getElementById("overlay")?.className || ""); if (ov.includes("awaiting")) { await p.mouse.click(720, 450); await p.waitForTimeout(2500); } };
const nav = async (p, kind) => { await p.keyboard.press("Escape"); await p.waitForTimeout(150); try { await p.click(`.navitem[data-nav="${kind}"]`, { timeout: 5000 }); } catch { await p.click(`.navitem[data-nav="${kind}"]`, { force: true }); } await p.waitForTimeout(900); };
const dl = async (p, sel, name) => {
  try {
    const el = p.locator(sel).first();
    if (!(await el.count())) return { found: false };
    const [d] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), el.click({ force: true })]);
    const path = `${EVRAF}/${name}`; await d.saveAs(path); const b = fs.readFileSync(path);
    return { found: true, file: path, bytes: b.length, ext: ext(d.suggestedFilename() || name), sha256: sha(b).slice(0, 16), suggested: d.suggestedFilename() };
  } catch (e) { return { found: true, error: String(e).slice(0, 160) }; }
};

try { const st = await api("/api/state"); R.env.candidate = { topics: st.json?.topics?.length ?? null }; } catch (e) { R.env.candidateErr = String(e); }

// ═══════════ R05：无 Node 公开首页，找到对象/产物，零业务请求 ═══════════
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const reqs = []; const errs = [];
  page.on("request", (r) => reqs.push({ url: r.url(), method: r.method() }));
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(PUBLIC + "/", { waitUntil: "networkidle", timeout: 30000 }); await unroll(page);
  R.r05.boot = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, displayMode: document.documentElement.dataset.displayMode || null, badge: (document.querySelector("#display-badge")?.textContent || "").trim(), navItems: [...document.querySelectorAll(".navitem[data-nav]")].map((n) => n.getAttribute("data-nav")) }));
  const views = {};
  for (const k of ["library", "protocol", "record", "analysis", "chat", "papers"]) {
    await nav(page, k);
    views[k] = await page.evaluate(() => ({ midLen: (document.querySelector("#mid-content")?.textContent || "").trim().length, rightLen: (document.querySelector("#right-content")?.textContent || "").trim().length }));
  }
  R.r05.views = views;
  await nav(page, "analysis");
  await page.waitForSelector(".dx-chain", { timeout: 10000 }).catch(() => {});
  R.r05.analysis = await page.evaluate(() => ({ hasChain: !!document.querySelector(".dx-chain"), chainTitle: (document.querySelector(".dx-chain .dx-figcap")?.textContent || "").trim(), hops: document.querySelectorAll(".dx-hops li").length, hopTexts: [...document.querySelectorAll(".dx-hops li")].map((li) => li.textContent.trim().slice(0, 40)), exportLinks: document.querySelectorAll(".dx-dl").length }));
  await nav(page, "protocol");
  R.r05.protocolFig = await page.evaluate(() => ({ region: !!document.querySelector('[data-dx-region="fig-protocol"]'), figbox: !!document.querySelector(".dx-figbox") }));
  R.r05.req = { total: reqs.length, api: reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/")).length, demoData: reqs.filter((r) => r.url.includes("/demo-data")).length, external: reqs.filter((r) => !r.url.startsWith(PUBLIC) && !r.url.startsWith(TRIAL) && !r.url.startsWith("data:") && !r.url.startsWith("blob:") && !r.url.includes("kaspersky")).length };
  R.r05.pageerrors = errs.slice(0, 5);
  R.r05.status = (R.r05.req.api === 0 && R.r05.req.external === 0 && R.r05.analysis.hasChain && R.r05.analysis.exportLinks >= 2) ? "PASS" : "FAIL";
  await page.screenshot({ path: `${OUT}/screens/r05_public_analysis.png` });

  // ═══════════ R06：90 天逐跳 + 三处下载 ═══════════
  try {
    // 逐跳：点第一个 hop 内的可点元素
    R.r06.chain = { title: R.r05.analysis.chainTitle, hops: R.r05.analysis.hopTexts };
    const firstChip = await page.$(".dx-hops li .refchip, .dx-hops li button, .dx-hops li a");
    if (firstChip) { await firstChip.click().catch(() => {}); await page.waitForTimeout(800); }
    R.r06.afterHopClick = await page.evaluate(() => ({ anyPanel: !!document.querySelector(".dx-panel, #right-content .item:not(.dx-card-item), dialog[open], .overlay"), rightHead: (document.querySelector("#right-content")?.textContent || "").replace(/\s+/g, " ").slice(0, 120) }));
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await nav(page, "analysis"); await page.waitForSelector("[data-dx-exports] .dx-dl", { timeout: 8000 }).catch(() => {});
    R.r06.word = await dl(page, 'a.dx-dl[href*=".docx"]', "r06-report.docx");
    R.r06.trace = await dl(page, 'a.dx-dl[href*="traceability"]', "r06-traceability.zip");
    await nav(page, "topic"); await page.waitForTimeout(600);
    R.r06.sampleZip = await dl(page, '#right-content a[href*="locus-demo-public.zip"]', "r06-sample.zip");
    R.r06.status = (okd(R.r06.word) && okd(R.r06.trace) && okd(R.r06.sampleZip) && R.r05.analysis.hops > 0) ? "PASS" : "PARTIAL";
    await page.screenshot({ path: `${OUT}/screens/r06_downloads.png` });
  } catch (e) { R.r06.error = String(e).slice(0, 300); R.r06.status = "ERROR"; }

  // ═══════════ R07：静态引用失败有提示+重试；样本 ZIP 仍可下载 ═══════════
  try {
    await page.route("**/chain-90d.json", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    // 重新加载，使首屏就从被拦截的引用读取（模块内缓存不跨 reload）
    await page.reload({ waitUntil: "networkidle" }); await unroll(page);
    await nav(page, "analysis");
    await page.waitForTimeout(2500);
    R.r07.region = await page.evaluate(() => ({ fail: !!document.querySelector('[data-dx-region="chain-90"] .dx-fail, .dx-fail'), retry: !!document.querySelector('.dx-retry, [data-dx-retry]'), warn: (document.querySelector(".dx-warn")?.textContent || "").trim().slice(0, 80) }));
    // 样本 ZIP 仍可下载
    await nav(page, "topic"); await page.waitForTimeout(500);
    R.r07.sampleZipWhileFail = await dl(page, '#right-content a[href*="locus-demo-public.zip"]', "r07-sample.zip");
    // 取消拦截 → 重试
    await page.unroute("**/chain-90d.json");
    await nav(page, "analysis"); await page.waitForTimeout(1500);
    const retryBtn = await page.$(".dx-retry, [data-dx-retry]");
    if (retryBtn) { await retryBtn.click().catch(() => {}); await page.waitForTimeout(2500); }
    R.r07.afterRetry = await page.evaluate(() => ({ hasChain: !!document.querySelector(".dx-chain"), hops: document.querySelectorAll(".dx-hops li").length }));
    R.r07.status = (R.r07.region.fail && R.r07.region.retry && R.r07.afterRetry.hasChain && okd(R.r07.sampleZipWhileFail)) ? "PASS" : "PARTIAL";
    await page.screenshot({ path: `${OUT}/screens/r07_regionfail.png` });
  } catch (e) { R.r07.error = String(e).slice(0, 300); R.r07.status = "ERROR"; }
  await ctx.close();
} catch (e) { R.r05.error = String(e).slice(0, 300); R.r05.status = "ERROR"; }

// ═══════════ R08：三入口设置 + 窄屏（列表→详情→返回/后退/刷新 待补）═══════════
try {
  const openSettings = async (base) => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    await p.goto(base + "/", { waitUntil: "networkidle", timeout: 30000 }); await unroll(p);
    const present = await p.evaluate(() => !!document.getElementById("settings-open"));
    await p.click("#settings-open").catch(() => {});
    await p.waitForTimeout(1200);
    const open = await p.evaluate(() => { const t = document.querySelector("#settings-fan-title"); return !!t && t.getBoundingClientRect().width > 0; });
    const tabs = await p.evaluate(() => [...document.querySelectorAll("[data-fan-tab]")].map((b) => b.textContent.trim()));
    // Esc 关闭 + 焦点归还
    await p.keyboard.press("Escape"); await p.waitForTimeout(600);
    const afterEsc = await p.evaluate(() => document.activeElement?.id || "");
    // 窄屏
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(700);
    const narrow = await p.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth + 2 }));
    await c.close();
    return { present, open, tabs: tabs.slice(0, 6), focusAfterEsc: afterEsc, narrow };
  };
  R.r08.public = await openSettings(PUBLIC);
  R.r08.trial = await openSettings(TRIAL);
  R.r08.node = await openSettings(NODEURL);
  R.r08.status = (R.r08.public.open && R.r08.trial.open && R.r08.node.open && !R.r08.trial.narrow.overflow) ? "PASS(设置三入口；列表恢复断言待补)" : "PARTIAL";
} catch (e) { R.r08.error = String(e).slice(0, 300); R.r08.status = "ERROR"; }

// ═══════════ R09：可写课题导入公开材料走 P8 五步 ═══════════
try {
  // 部分取证：可写态新建课题 + 导入达尔文公开材料（枚举/导入块）→ 记录接口可用；
  // 五步（文献/数据导入→重复原件拒绝→方案引用→执行追加→地图选择/对话）完整 UI 走查待 P8 脚本+达尔文预导入。
  const mk = await api("/api/topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "S10-R09 可写课题", researchQuestion: "（验收：导入公开材料并走完 P8 五步）" }) });
  R.r09.topicCreate = { status: mk.status, topicId: mk.json?.topicId };
  R.r09.status = "部分：可写课题创建可用；P8 五步完整走查待 P8 脚本（sciworkbench/scripts/acceptance-darwin.ts 预导入）+ 浏览器复跑";
} catch (e) { R.r09.error = String(e).slice(0, 300); R.r09.status = "ERROR"; }

// ═══════════ R10：预存 vs 可写两源逐项比较 ═══════════
try {
  // 部分取证：写态请求应属自身课题（/functions→/api），预存态只读快照（/demo-data，零 /api）——见 R05 与写态请求日志。
  R.r10.note = "预存态：/api=0 且 /demo-data>0（R05）；写态：经 /functions/v1/app/api（trial 反代）。逐项（文献卡/表格/实验图/结果/回查）同视图比较待补。";
  R.r10.status = "部分"; 
} catch (e) { R.r10.error = String(e).slice(0, 300); R.r10.status = "ERROR"; }

await browser.close();
fs.writeFileSync(`${OUT}/raw/r05_r10_skeleton.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify({ r05: R.r05.status, r06: R.r06.status, r07: R.r07.status, r08: R.r08.status, r09: R.r09.status, r10: R.r10.status, r05req: R.r05.req, r06: { word: R.r06.word, trace: R.r06.trace, sampleZip: R.r06.sampleZip }, r07: R.r07.status ? { region: R.r07.region, afterRetry: R.r07.afterRetry } : null }, null, 2));
