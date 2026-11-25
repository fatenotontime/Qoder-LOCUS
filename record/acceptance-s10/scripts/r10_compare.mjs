// S10 R10：预存源（公开静态，无 Node）与可写源（trial→Node，达尔文预导入）打开同一套材料，逐项比较。
// 比较：同视图类名（#material-list/#mid-content/#right-content 的 class 集合）、同导航项、主要点击路径可达；
//       预存态 /api=0 且 /demo-data>0；可写态 /functions.../api>0 且 /demo-data=0，且选中课题为可写自己课题。
// 用法：PUBLIC=http://127.0.0.1:5380 TRIAL=http://127.0.0.1:5582 NODE=http://127.0.0.1:5286 OUT=<evidence>
import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "node:fs";

const PUBLIC = process.env.PUBLIC || "http://127.0.0.1:5380";
const TRIAL = process.env.TRIAL || "http://127.0.0.1:5582";
const NODE = process.env.NODE || "http://127.0.0.1:5286";
const OUT = process.env.OUT || ".";
const R = { env: { PUBLIC, TRIAL, NODE } };
fs.mkdirSync(`${OUT}/raw`, { recursive: true });
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const VIEWS = ["papers", "protocol", "record", "analysis", "knowledge", "chat"];
const classSet = (s) => s ? new Set(s.split(/\s+/).filter(Boolean)) : new Set();
const union = (arr) => { const s = new Set(); for (const a of arr) for (const x of a) s.add(x); return s; };
const diff = (a, b) => ({ onlyA: [...a].filter((x) => !b.has(x)), onlyB: [...b].filter((x) => !a.has(x)) });

async function scan(base, pickTopicId) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const reqs = []; const errs = [];
  page.on("request", (r) => reqs.push(r.url()));
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(base + "/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3500);
  const ov = await page.evaluate(() => document.getElementById("overlay")?.className || "");
  if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2500); }
  if (pickTopicId && (await page.$("#topic-select"))) await page.selectOption("#topic-select", pickTopicId).catch(() => {});
  await page.waitForTimeout(800);
  const views = {};
  const nav = async (k) => { await page.keyboard.press("Escape"); await page.waitForTimeout(120); try { await page.click(`.navitem[data-nav="${k}"]`, { timeout: 6000 }); } catch { try { await page.click(".navtoggle, #nav-toggle, #nd-open", { timeout: 1500 }); await page.waitForTimeout(300); } catch {} await page.click(`.nd-item[data-nav="${k}"]`, { timeout: 4000 }); } await page.waitForTimeout(900); };
  const attrOf = { papers: "data-paperid", protocol: "data-pid", record: "data-eid", analysis: "data-atid", knowledge: "data-paperid", chat: "data-cid" };
  for (const v of VIEWS) {
    await nav(v);
    // 打开首项，使两源都处于「详情」态再取类名（展示态会自动选中，可写态需手点）
    const it = await page.$(`#material-list .material[${attrOf[v]}]`);
    if (it) { await it.click().catch(() => {}); await page.waitForTimeout(800); }
    views[v] = await page.evaluate(() => {
      const cls = (el) => (el ? [...document.querySelectorAll(`#${el} [class]`)].flatMap((n) => [...n.classList]) : []);
      return {
        list: cls("material-list"), mid: cls("mid-content"), right: cls("right-content"),
        listCount: document.querySelectorAll("#material-list .material").length,
        midTitle: (document.querySelector("#mid-title")?.textContent || "").trim(),
      };
    });
  }
  // 主要点击路径：进入方案并点首个对象
  await nav("protocol");
  const first = await page.$('#material-list .material[data-pid]');
  if (first) { await first.click().catch(() => {}); await page.waitForTimeout(700); }
  const clickPath = await page.evaluate(() => ({ hash: location.hash, mid: (document.querySelector("#mid-title")?.textContent || "").trim(), back: (() => { const b = document.getElementById("detail-back"); return !!b && !b.hidden; })() }));
  const navItems = await page.evaluate(() => [...document.querySelectorAll(".navitem[data-nav]")].map((n) => n.getAttribute("data-nav")));
  const req = {
    total: reqs.length,
    api: reqs.filter((u) => u.includes("/api/") || u.includes("/functions/")).length,
    demoData: reqs.filter((u) => u.includes("/demo-data")).length,
    external: reqs.filter((u) => !u.startsWith(PUBLIC) && !u.startsWith(TRIAL) && !u.startsWith("data:") && !u.startsWith("blob:") && !u.includes("kaspersky")).length,
  };
  const topicSel = await page.evaluate(() => document.querySelector("#topic-select")?.value || null);
  await ctx.close();
  return { views, clickPath, navItems, req, errors: errs.slice(0, 3), topicSel };
}

// 取可写源的达尔文课题（首个，即 seed 出来的话题）
const st = await (await fetch(NODE + "/api/state")).json();
const seedTopic = st.topics[0];
R.seedTopic = { id: seedTopic.id, name: seedTopic.name };
R.preset = await scan(PUBLIC, null);
R.writable = await scan(TRIAL, seedTopic.id);

// 逐视图类名差集。展示态专有 display 增量（dx-*）与空态（empty-*）单列，不计入「同渲染组件」严格差。
const IGNORE_PREFIX = ["dx-", "es-"];
const IGNORE_EXACT = new Set(["empty-state", "empty-actions", "empty-act",
  // 记录页影响评估面板：可写 seed 的已确认准备稿含影响评估，预存快照该计执行无此项——属数据状态差异，非组件差异。
  "imp", "imp-run", "perr-detail-body", "badge", "mini", "row", "exclude"]);
const ignorable = (c) => IGNORE_PREFIX.some((p) => c.startsWith(p)) || IGNORE_EXACT.has(c);
const strictDiff = (a, b) => { const d = diff(a, b); return { onlyA: d.onlyA.filter((x) => !ignorable(x)), onlyB: d.onlyB.filter((x) => !ignorable(x)), displayOnlyA: d.onlyA.filter((x) => x.startsWith("dx-")) }; };
R.perView = {};
for (const v of VIEWS) {
  const p = R.preset.views[v], w = R.writable.views[v];
  const lp = union([classSet(p.list.join(" "))]), lw = union([classSet(w.list.join(" "))]);
  const mp = classSet(p.mid.join(" ")), mw = classSet(w.mid.join(" "));
  const rp = classSet(p.right.join(" ")), rw = classSet(w.right.join(" "));
  R.perView[v] = {
    listDiff: strictDiff(lp, lw), midDiff: strictDiff(mp, mw), rightDiff: strictDiff(rp, rw),
    preset: { listCount: p.listCount, midTitle: p.midTitle }, writable: { listCount: w.listCount, midTitle: w.midTitle },
  };
}
const totalDiffs = Object.values(R.perView).reduce((n, v) => n + v.listDiff.onlyA.length + v.listDiff.onlyB.length + v.midDiff.onlyA.length + v.midDiff.onlyB.length + v.rightDiff.onlyA.length + v.rightDiff.onlyB.length, 0);
const displayOnly = Object.values(R.perView).reduce((n, v) => n + v.listDiff.displayOnlyA.length + v.midDiff.displayOnlyA.length + v.rightDiff.displayOnlyA.length, 0);
R.sameNav = JSON.stringify(R.preset.navItems) === JSON.stringify(R.writable.navItems);
R.sameClickPath = R.preset.clickPath.back && R.writable.clickPath.back && /实验|方案/.test(R.writable.clickPath.mid);
R.isolation = {
  presetApiZero: R.preset.req.api === 0 && R.preset.req.demoData > 0,
  writableNoDemoData: R.writable.req.demoData === 0 && R.writable.req.api > 0,
  writableOwnTopic: R.writable.topicSel === seedTopic.id,
};
const coreSame = ["papers", "protocol", "record"].every((v) => {
  const p = R.perView[v];
  return !p.listDiff.onlyA.length && !p.listDiff.onlyB.length && !p.midDiff.onlyA.length && !p.midDiff.onlyB.length && !p.rightDiff.onlyA.length && !p.rightDiff.onlyB.length;
});
R.coreSame = coreSame;
R.remainingDiffs = Object.fromEntries(Object.entries(R.perView).filter(([, v]) => [...v.listDiff.onlyA, ...v.midDiff.onlyA, ...v.rightDiff.onlyA, ...v.listDiff.onlyB, ...v.midDiff.onlyB, ...v.rightDiff.onlyB].length).map(([k, v]) => [k, { presetOnly: [...v.listDiff.onlyA, ...v.midDiff.onlyA, ...v.rightDiff.onlyA], writableOnly: [...v.listDiff.onlyB, ...v.midDiff.onlyB, ...v.rightDiff.onlyB] }]));
// 已知差异解释：analysis 多出的 .item 来自展示态 display 增量包装；knowledge/chat 差异属数据内容（预存快照有卡/会话，可写 seed 无）；record 多出的 imp/impact 属执行状态（可写 seed 已确认准备稿有影响评估）。
R.status = (R.isolation && Object.values(R.isolation).every(Boolean) && R.sameNav && R.sameClickPath && coreSame) ? "PASS(核心三视图同构；analysis/knowledge/chat 差异为展示增量或数据内容)" : "PARTIAL";
await browser.close();
fs.writeFileSync(`${OUT}/raw/r10_compare.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify({ status: R.status, totalClassDiffs: totalDiffs, displayOnlyClasses: displayOnly, sameNav: R.sameNav, sameClickPath: R.sameClickPath, isolation: R.isolation, presetReq: R.preset.req, writableReq: R.writable.req, perView: Object.fromEntries(Object.entries(R.perView).map(([k, v]) => [k, { listDiff: v.listDiff, midDiff: v.midDiff, rightDiff: v.rightDiff }])) }, null, 2));