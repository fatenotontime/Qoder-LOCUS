import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "fs";
import crypto from "crypto";

const BASE = process.env.BASE;
const TRIAL = process.env.TRIAL;
const OUT = process.env.OUT;
const EVRAF = process.env.EVRES;
const R = { e1: {}, e2: {}, e3: {}, e4: {}, e5: {}, e6: {}, e7: {}, reqs: [] };
const shot = (p, n) => p.screenshot({ path: `${OUT}/screens/${n}.png` });

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("request", (r) => R.reqs.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

async function clickNav(kind) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const sel = `.navitem[data-nav="${kind}"]`;
  try { await page.click(sel, { timeout: 5000 }); }
  catch { await page.click(sel, { force: true }); }
  await page.waitForTimeout(1000);
}
async function unroll() {
  await page.waitForTimeout(3500);
  const ov = await page.evaluate(() => document.getElementById("overlay")?.className || "");
  if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2500); }
}
const info = () => page.evaluate(() => ({
  url: location.href, title: document.title, theme: document.documentElement.dataset.theme,
  displayMode: document.documentElement.dataset.displayMode || null,
  curtopic: (document.querySelector("#curtopic")?.textContent || "").trim().replace(/\s+/g, " "),
  badge: (document.querySelector("#display-badge")?.textContent || "").trim(),
  navItems: [...document.querySelectorAll(".navitem[data-nav]")].map((n) => n.getAttribute("data-nav")),
}));

// ═══ E1 ═══
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 });
await unroll();
R.e1.first = await info();
R.e1.first.midTitle = await page.textContent("#mid-title");
R.e1.coldSwitches = await page.evaluate(() => {
  const oc = (id) => { const e = document.getElementById(id); if (!e) return "absent"; const rc = e.getBoundingClientRect(); if (rc.width === 0) return "zero"; const t = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2); return (t === e || e.contains(t)) ? "ONTOP" : "COVERED"; };
  return { themeSeal: oc("theme-seal"), replayTheme: oc("replay-theme") };
});
await shot(page, "e1_root");
await page.reload({ waitUntil: "networkidle" }); await unroll();
R.e1.reload = await info();
await page.goto(BASE + "/demo/demo.html", { waitUntil: "networkidle" }); await unroll();
R.e1.legacy = await info();
await shot(page, "e1_legacy");

// ═══ E2 文献库 ═══
await page.goto(BASE + "/", { waitUntil: "networkidle" }); await unroll();
await clickNav("library");
await page.waitForSelector(".lv-mount", { timeout: 15000 });
await page.waitForSelector(".lv-card, .lv-paper", { timeout: 15000 });
await page.waitForTimeout(800);
await page.click('.lv-tab[data-view="cards"]').catch(() => {});
await page.waitForTimeout(500);
R.e2.papers = await page.$$eval(".lv-paper", (ns) => ns.map((n) => n.textContent.trim().replace(/\s+/g, " ").slice(0, 60)));
R.e2.cards = await page.$$eval(".lv-card", (ns) => ns.map((n) => ({
  title: (n.querySelector(".lv-ctitle") || {}).textContent || "",
  state: (n.querySelector(".lv-badge") || {}).textContent || "",
  ok: !!n.querySelector(".lv-badge.ok"), warn: !!n.querySelector(".lv-badge.warn"),
})));
await shot(page, "e2_cards");
// 点开一张卡 → 回查原文（在原文中定位）
await page.click(".lv-cardbtn"); await page.waitForTimeout(500);
R.e2.cardDetail = await page.evaluate(() => {
  const d = document.querySelector(".lv-cdetail");
  return d ? { hasLocate: !!d.querySelector('[data-lv="locate"]'), fields: d.querySelectorAll(".lv-table.kv tr").length, quote: (d.querySelector(".lv-quote")?.textContent || "").slice(0, 50) } : null;
});
await page.click('.lv-cdetail [data-lv="locate"]'); await page.waitForTimeout(700);
R.e2.afterLocate = await page.evaluate(() => ({
  hasSrc: !!document.querySelector(".lv-src"), hasMark: !!document.querySelector(".lv-src mark"), hl: !!document.body.textContent.includes("已高亮"),
}));
R.e2.afterLocate.highlightedText = await page.$eval(".lv-src mark", (m) => m.textContent.slice(0, 60)).catch(() => null);
await shot(page, "e2_locate");
// 两端对照
await page.click('.lv-tab[data-view="compare"]'); await page.waitForTimeout(600);
R.e2.compare = await page.evaluate(() => {
  const t = document.querySelector(".lv-table");
  return { rows: t ? t.querySelectorAll("tbody tr").length : 0, text: (document.querySelector("#mid-content")?.textContent || "").replace(/\s+/g, " ").slice(0, 200) };
});
await shot(page, "e2_compare");
// 引用回查
await page.click('.lv-tab[data-view="backtrace"]'); await page.waitForTimeout(400);
await page.click(".lv-startrow .lv-link").catch(() => {}); await page.waitForTimeout(600);
R.e2.backtrace = await page.evaluate(() => ({
  groups: document.querySelectorAll(".lv-netgroup").length, nodes: document.querySelectorAll(".lv-node").length,
  edges: document.querySelectorAll(".lv-edges li").length,
}));
await shot(page, "e2_backtrace");

// ═══ E3 报告→分析/记录/表/原件 ═══
await clickNav("analysis");
R.e3.analysis = await page.evaluate(() => ({
  midTitle: document.querySelector("#mid-title")?.textContent,
  hasReport: !!document.querySelector(".rep"), hasRefBack: document.querySelectorAll(".ref-back").length,
  hasTblOpen: document.querySelectorAll(".tbl-open").length, hasContextMap: !!document.querySelector('[aria-label="实跑上下文地图"]'),
}));
await shot(page, "e3_analysis");
// 依次点回查与查看表格，记录是否发生了跳转/展开
R.e3.jumps = [];
const refBack = await page.$$(".ref-back");
for (let i = 0; i < Math.min(refBack.length, 3); i++) {
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  const before = await page.evaluate(() => ({ nav: document.body.dataset.nav, mid: document.querySelector("#mid-title")?.textContent }));
  await refBack[i].click().catch(() => {});
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ nav: document.body.dataset.nav, mid: document.querySelector("#mid-title")?.textContent }));
  R.e3.jumps.push({ before, after, changed: before.nav !== after.nav || before.mid !== after.mid });
  // 回到分析页继续下一个
  await clickNav("analysis");
}
await shot(page, "e3_after_refback");
await clickNav("analysis");
const tblOpen = await page.$$(".tbl-open");
if (tblOpen.length) { await tblOpen[0].click().catch(() => {}); await page.waitForTimeout(800); }
R.e3.tableOpened = await page.evaluate(() => !!document.querySelector("table,.tblview,[data-tid]"));
await shot(page, "e3_table");

// ═══ E4 上下文图 / 下一步 / 对话 ═══
await clickNav("topic");
R.e4.rightPanel = await page.evaluate(() => {
  const rc = document.querySelector("#right-content");
  return { hasNextSteps: /下一步指导/.test(rc?.textContent || ""), hasZip: !!rc?.querySelector('a[download]'), text: (rc?.textContent || "").replace(/\s+/g, " ").slice(0, 220) };
});
await shot(page, "e4_topic_right");
await clickNav("analysis");
R.e4.contextMap = await page.evaluate(() => {
  const svg = document.querySelector('svg[aria-label="实跑上下文地图"]');
  return { present: !!svg, nodes: svg ? svg.querySelectorAll("g").length : 0, label: !!document.querySelector("p.hint") && /实跑生成/.test(document.body.textContent) };
});
await shot(page, "e4_contextmap");
// 对话
await clickNav("chat");
R.e4.chat = await page.evaluate(() => ({ text: (document.querySelector("#mid-content")?.textContent || "").replace(/\s+/g, " ").slice(0, 160) }));
await shot(page, "e4_chat");

// ═══ E5 ZIP 下载 ═══
await clickNav("topic");
await page.waitForTimeout(500);
try {
  const zipLink = page.locator('#right-content a[href*="locus-demo-public.zip"]').first();
  R.e5.anchor = await zipLink.evaluate((a) => ({ href: a.href, download: a.getAttribute("download"), text: a.textContent.trim() }));
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    zipLink.click({ force: true }),
  ]);
  const p = EVRAF + "/downloaded.zip";
  await dl.saveAs(p);
  const buf = fs.readFileSync(p);
  R.e5.saved = p; R.e5.bytes = buf.length; R.e5.sha256 = crypto.createHash("sha256").update(buf).digest("hex");
} catch (e) { R.e5.error = String(e).slice(0, 200); }

// ═══ E6 设置折扇（展示构建）═══
await page.goto(BASE + "/", { waitUntil: "networkidle" }); await unroll();
R.e6.open = await page.evaluate(() => {
  const btn = document.getElementById("settings-open");
  return { btn: !!btn, label: (btn?.textContent || "").trim().slice(0, 20) };
});
await page.click("#settings-open"); await page.waitForTimeout(900);
R.e6.panel = await page.evaluate(() => {
  const aside = document.querySelector("#settings-fan-title")?.closest("aside,[class*=fan]") || document.querySelector("aside.fan, .fan");
  return {
    title: document.querySelector("#settings-fan-title")?.textContent,
    tabs: [...document.querySelectorAll("[data-fan-tab]")].map((b) => b.textContent.trim()),
    hasMotion: !!document.querySelector("[data-motion-switch]"),
    hasDensity: !!document.querySelector("[data-density-seg]"),
    hasFont: !!document.querySelector("[data-fontsize-seg]"),
    hasKey: !!document.querySelector('input[type="password"], [data-model-key]'),
    buildVer: document.querySelector("[data-build-version]")?.textContent || "",
  };
});
await shot(page, "e6_fan_open");
// 切到模型/关于签，确认无密钥控件
await page.click('[data-fan-tab][data-tab="model"], [data-fan-tab]:nth-child(2)').catch(() => {});
await page.waitForTimeout(400);
R.e6.modelTab = await page.evaluate(() => ({
  hasKeyInput: document.querySelectorAll('#mid-content input[type="password"], .fan input[type="password"]').length,
  text: (document.querySelector(".fan-panel:not([hidden]), [data-panel]")?.textContent || "").replace(/\s+/g, " ").slice(0, 120),
}));
await shot(page, "e6_model_tab");
// 改字号/疏密 → 检查 localStorage 与 DOM 属性
R.e6.prefBefore = await page.evaluate(() => ({ density: document.documentElement.dataset.density, font: localStorage.getItem("locus.fontsize.v1") }));
await page.click('[data-density-seg] button[data-v="compact"]').catch(() => {});
await page.click('[data-fontsize-seg] button').catch(() => {});
await page.waitForTimeout(400);
R.e6.prefAfter = await page.evaluate(() => ({ density: document.documentElement.dataset.density, font: localStorage.getItem("locus.fontsize.v1"), vibe: localStorage.getItem("locus.density.v1") }));
// Esc 关闭 + 焦点归还
await page.keyboard.press("Escape"); await page.waitForTimeout(600);
R.e6.afterEsc = await page.evaluate(() => ({
  panelOpen: document.querySelector("#settings-fan-title") ? (document.querySelector("#settings-fan-title").getBoundingClientRect().width > 0) : false,
  focusId: document.activeElement?.id || document.activeElement?.className || "",
}));
// 刷新保留
await page.reload({ waitUntil: "networkidle" }); await unroll();
R.e6.afterReload = await page.evaluate(() => ({ density: document.documentElement.dataset.density, font: localStorage.getItem("locus.fontsize.v1"), theme: document.documentElement.dataset.theme }));
await shot(page, "e6_after_reload");
// 窄屏抽屉
await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(600);
await page.click("#settings-open").catch(() => {}); await page.waitForTimeout(800);
R.e6.narrow = await page.evaluate(() => ({
  drawerOpen: !!document.querySelector("#settings-fan-title") && document.querySelector("#settings-fan-title").getBoundingClientRect().width > 0,
  bottom: (() => { const e = document.querySelector("#settings-fan-title")?.closest("aside,[class*=fan]"); if (!e) return null; const rc = e.getBoundingClientRect(); return rc.top > window.innerHeight * 0.4; })(),
}));
await shot(page, "e6_narrow_drawer");
// 减少动效
await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/", { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
R.e6.reducedMotion = await page.evaluate(() => ({ density: document.documentElement.dataset.density, bodyClass: document.body.className, reduceApplied: document.documentElement.dataset.motion || getComputedStyle(document.body).animationDuration }));

// ═══ E6-trial：冷色与入口仍可用 ═══
const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const tp = await tctx.newPage();
await tp.goto(TRIAL + "/", { waitUntil: "networkidle" }); await tp.waitForTimeout(3500);
const tov = await tp.evaluate(() => document.getElementById("overlay")?.className || "");
if (tov.includes("awaiting")) { await tp.mouse.click(720, 450); await tp.waitForTimeout(2500); }
R.e6.trial = await tp.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); if (!e) return "absent"; const rc = e.getBoundingClientRect(); return rc.width > 0 && rc.height > 0 ? "present" : "zero"; };
  return { displayCfg: !!window.__LOCUS_DISPLAY__, theme: document.documentElement.dataset.theme, themeSeal: vis("theme-seal"), replay: vis("replay-theme"), aiOpen: !!document.getElementById("ai-open"), settingsBtn: !!document.getElementById("settings-open") };
});
// 点主题封印切换冷色
await tp.click("#theme-seal").catch(() => {});
await tp.waitForTimeout(2500);
R.e6.trialAfterSeal = await tp.evaluate(() => ({ theme: document.documentElement.dataset.theme, bodyClass: document.body.className }));
await tp.screenshot({ path: `${OUT}/screens/e6_trial_theme.png` });
await tctx.close();

// ═══ E7 请求与发布文件 ═══
R.e7.apiRequests = R.reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/"));
R.e7.external = R.reqs.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith(TRIAL) && !r.url.startsWith("data:") && !r.url.startsWith("blob:"));
R.e7.writeMethods = R.reqs.filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method));
R.e7.total = R.reqs.length;

await browser.close();
fs.writeFileSync(OUT + "/raw/accept.json", JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
