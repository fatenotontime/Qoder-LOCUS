// S10 R08 导航断言：列表 → 详情 → 返回 / 浏览器后退 / 刷新恢复（可重跑）。
// 新选择器：.material[data-pid|data-eid|data-atid|data-paperid]、#detail-back[data-back]、#material-list；
// 路由哈希 #/<nav>/<id>（app.js applyRoute / pushDetailRoute / backToList）。
// 每卷目独立 context（清 localStorage）。
// 结果分两类：
//  (a) listDetail：protocol / record（进入为列表态）→ 点开详情→哈希 #/nav/id→返回按钮→浏览器后退→刷新恢复。
//  (b) autoSelect：papers / analysis（进入即自动选中首个对象）→ 观察哈希是否同步、刷新后是否回到同一卷。
// 用法：BASE=http://127.0.0.1:5582 OUT=<evidence> node record/acceptance-s10/scripts/r08_navigation.mjs
import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5582";
const OUT = process.env.OUT || ".";
const R = { base: BASE, listDetail: {}, autoSelect: {} };
fs.mkdirSync(`${OUT}/raw`, { recursive: true });
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });

async function withPage(fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const unroll = async () => { await page.waitForTimeout(3200); const ov = await page.evaluate(() => document.getElementById("overlay")?.className || ""); if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2000); } };
  const nav = async (k) => { await page.keyboard.press("Escape"); await page.waitForTimeout(120); try { await page.click(`.navitem[data-nav="${k}"]`, { timeout: 6000 }); } catch { try { await page.click(".navtoggle, #nav-toggle, #nd-open", { timeout: 1500 }); await page.waitForTimeout(300); } catch {} await page.click(`.nd-item[data-nav="${k}"]`, { timeout: 4000 }); } await page.waitForTimeout(800); };
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 }); await unroll();
  const out = await fn({ page, nav, unroll });
  await ctx.close();
  return out;
}
const snap = (page) => page.evaluate(() => ({ hash: location.hash, nav: document.body.dataset.nav, backVisible: (() => { const b = document.getElementById("detail-back"); return !!b && !b.hidden; })(), mid: (document.querySelector("#mid-title")?.textContent || "").trim(), listCount: document.querySelectorAll("#material-list .material").length, active: document.querySelectorAll("#material-list .material.active").length }));

// (a) 列表→详情→返回/后退/刷新
for (const [kind, attr] of [["protocol", "data-pid"], ["record", "data-eid"]]) {
  R.listDetail[kind] = await withPage(async ({ page, nav, unroll }) => {
    const rec = {};
    await nav(kind); rec.list = await snap(page);
    const first = await page.$(`#material-list .material[${attr}]`);
    if (!first) { rec.error = "无列表项"; rec.pass = false; return rec; }
    await first.click(); await page.waitForTimeout(700); rec.afterOpen = await snap(page);
    await page.click("#detail-back"); await page.waitForTimeout(700); rec.afterBackBtn = await snap(page);
    const f2 = await page.$(`#material-list .material[${attr}]`); if (f2) { await f2.click(); await page.waitForTimeout(600); }
    await page.goBack(); await page.waitForTimeout(700); rec.afterBrowserBack = await snap(page);
    const f3 = await page.$(`#material-list .material[${attr}]`); if (f3) { await f3.click(); await page.waitForTimeout(600); }
    rec.beforeReload = await snap(page);
    await page.reload({ waitUntil: "networkidle" }); await unroll(); rec.afterReload = await snap(page);
    rec.openHashOk = new RegExp(`^#/${kind}/`).test(rec.afterOpen.hash);
    rec.backBtnOk = rec.afterBackBtn.hash === `#/${kind}` && !rec.afterBackBtn.backVisible;
    rec.browserBackOk = !rec.afterBrowserBack.backVisible && rec.afterBrowserBack.hash === `#/${kind}`;
    rec.reloadOk = rec.afterReload.hash === rec.beforeReload.hash && /^#\/[\w-]+\/.+/.test(rec.afterReload.hash) && rec.afterReload.nav === kind;
    rec.pass = rec.openHashOk && rec.backBtnOk && rec.browserBackOk && rec.reloadOk;
    await page.screenshot({ path: `${OUT}/screens/r08_${kind}.png` });
    return rec;
  });
}

// (b) 进入即自动选中：哈希是否同步 + 刷新后是否回到同卷
for (const [kind, attr] of [["papers", "data-paperid"], ["analysis", "data-atid"]]) {
  R.autoSelect[kind] = await withPage(async ({ page, nav, unroll }) => {
    const rec = {};
    await nav(kind); rec.entered = await snap(page);
    rec.autoSelected = rec.entered.active >= 1 && rec.entered.backVisible;
    rec.hashInSync = new RegExp(`^#/${kind}/`).test(rec.entered.hash);
    // 明确点一次对象（若已选中会 early-return）
    const first = await page.$(`#material-list .material[${attr}]`);
    if (first) { await first.click(); await page.waitForTimeout(600); }
    rec.afterClick = await snap(page);
    await page.reload({ waitUntil: "networkidle" }); await unroll(); rec.afterReload = await snap(page);
    rec.reloadSameNav = rec.afterReload.nav === kind;
    await page.screenshot({ path: `${OUT}/screens/r08_auto_${kind}.png` });
    return rec;
  });
}

R.summary = {
  listDetail: Object.fromEntries(Object.entries(R.listDetail).map(([k, v]) => [k, v.pass ? "PASS" : "FAIL"])),
  autoSelect: Object.fromEntries(Object.entries(R.autoSelect).map(([k, v]) => [k, { autoSelected: v.autoSelected, hashInSync: v.hashInSync, reloadSameNav: v.reloadSameNav }])),
};
await browser.close();
fs.writeFileSync(`${OUT}/raw/r08_navigation.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify(R.summary, null, 2));
console.log(JSON.stringify({ auto: R.autoSelect }, null, 2).slice(0, 1600));
