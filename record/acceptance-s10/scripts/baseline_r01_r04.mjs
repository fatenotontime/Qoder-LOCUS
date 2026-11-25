// S10 基线 R01–R04 实测（独立验收 executor-e3）。
// 环境：trial 5281（写态，代理 → node 5284）、公开静态 5380、模型替身 5490。
// 用法：
//   TRIAL=http://127.0.0.1:5281 NODE=http://127.0.0.1:5284 STUBLOG=<stub.jsonl> \
//   OUT=<evidence 目录> EVRAF=<临时目录> \
//   NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
//   node record/acceptance-s10/scripts/baseline_r01_r04.mjs
import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "node:fs";

const TRIAL = process.env.TRIAL || "http://127.0.0.1:5281";
const NODE = process.env.NODE || "http://127.0.0.1:5284";
const STUBLOG = process.env.STUBLOG;
const OUT = process.env.OUT || ".";
const EVRAF = process.env.EVRAF || "/tmp";
const R = { env: { TRIAL, NODE, candidate: null }, r01: {}, r02: {}, r03: {}, r04: {}, reqs: [] };
const api = async (p, opt) => {
  const res = await fetch(NODE + p, { ...(opt || {}), headers: { "content-type": "application/json", ...(opt?.headers || {}) } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const stubRead = () => {
  if (!STUBLOG || !fs.existsSync(STUBLOG)) return [];
  return fs.readFileSync(STUBLOG, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

fs.mkdirSync(`${OUT}/raw`, { recursive: true });
fs.mkdirSync(`${OUT}/screens`, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("request", (r) => R.reqs.push({ url: r.url(), method: r.method() }));
const gotoBase = async (url) => {
  await page.goto(url + "/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3500);
  const ov = await page.evaluate(() => document.getElementById("overlay")?.className || "");
  if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2500); }
};
const clickNav = async (kind) => {
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  try { await page.click(`.navitem[data-nav="${kind}"]`, { timeout: 5000 }); }
  catch { await page.click(`.navitem[data-nav="${kind}"]`, { force: true }); }
  await page.waitForTimeout(1000);
};

// ── 冻结候选版本 ──
try {
  const st = await api("/api/state");
  R.env.candidate = { headStateTopics: (st.json?.topics || []).length };
} catch (e) { R.env.candidateErr = String(e); }

// ═══════════════ R01：取消一张候选后直接推荐 + 空子问题 ═══════════════
try {
  await gotoBase(TRIAL);
  await clickNav("analysis");
  await page.waitForTimeout(1200);
  R.r01.taskSelected = await page.evaluate(() => ({
    rightHasRecommend: !!document.querySelector("#an-recommend"),
    candToggles: [...document.querySelectorAll("#mid-content .cand-toggle")].map((cb) => ({ idx: cb.dataset.idx, checked: cb.checked, label: (cb.closest("label")?.textContent || "").trim().slice(0, 40) })),
  }));
  // 取消最后一张候选（不保存）
  const toggles = await page.$$("#mid-content .cand-toggle");
  let cancelledLabel = null;
  if (toggles.length) {
    const last = toggles[toggles.length - 1];
    cancelledLabel = await last.evaluate((cb) => (cb.closest("label")?.textContent || "").trim().slice(0, 60));
    await last.uncheck().catch(() => {});
  }
  R.r01.cancelled = { label: cancelledLabel, uiCheckedAfterCancel: await page.$$eval("#mid-content .cand-toggle", (cbs) => cbs.filter((c) => c.checked).length) };
  const stubBefore = stubRead().length;
  await page.fill("#an-purpose", "估计海水漂流时长对萌发率的影响并比较干燥组与新鲜组");
  await page.click("#an-recommend").catch(() => {});
  await page.waitForTimeout(7000);
  R.r01.statusAfter = await page.evaluate(() => (document.querySelector("#status")?.textContent || "").trim().slice(0, 120));
  const recReq = stubRead().slice(stubBefore).find((x) => x.task === "analysis_recommend");
  const snapSummary = await page.evaluate(() => (document.querySelector("#right-content")?.textContent.match(/冻结上下文快照[^\n]*?碎片[^\n]*/) || [])[0] || "");
  const candCount = (snapSummary.match(/候选\s*(\d+)/) || [])[1];
  R.r01.snapshot = {
    summary: snapSummary.slice(0, 120),
    candidateCountInSnapshot: candCount != null ? Number(candCount) : null,
    uiChecked: R.r01.cancelled.uiCheckedAfterCancel,
    consistent: candCount != null ? Number(candCount) === R.r01.cancelled.uiCheckedAfterCancel : null,
  };
  R.r01.stubRequest = recReq ? { task: recReq.task, userLen: recReq.userLen, userHead: recReq.user.slice(0, 300) } : null;
  R.r01.snapshotHashShown = await page.evaluate(() => (document.body.textContent.match(/快照已冻结\s*([0-9a-f]{6,})/) || [])[1] || null);
  await page.screenshot({ path: `${OUT}/screens/r01_recommend.png` });
} catch (e) { R.r01.error = String(e).slice(0, 300); }

try {
  // 空子问题：经 API 直接建任务（无 subquestionId），观察是否被拦
  const st0 = await api(`/api/state`);
  const topicId = (st0.json?.topics || [])[0]?.id;
  const tbl = (st0.json?.tables || [])[0];
  const emptySubq = await api("/api/analysis/tasks", { method: "POST", body: JSON.stringify({ topicId, title: "验收·空子问题", core: tbl ? [{ kind: "table", id: tbl.id }] : [], optional: [] }) });
  R.r01.emptySubqCreate = { status: emptySubq.status, body: emptySubq.json };
} catch (e) { R.r01.emptySubqErr = String(e).slice(0, 300); }

// ═══════════════ R02：A 启动提取 → 切 B → 等 → 回 A ═══════════════
try {
  const st = await api("/api/state");
  const s = st.json;
  const topicA = (s.topics || [])[0];
  const paper = (s.papers || []).find((p) => p.topicIds?.includes(topicA.id)) || (s.papers || [])[0];
  const att = (s.attachments || []).find((a) => a.paperId === paper.id);
  const mkB = await api("/api/topics", { method: "POST", body: JSON.stringify({ name: "验收B·空课题", researchQuestion: "（空课题，用于迟到响应归属测试）" }) });
  const topicB = mkB.json?.topicId;
  R.r02.topics = { A: topicA.id, AName: topicA.name, B: topicB, mkBStatus: mkB.status };
  const start = await api("/api/knowledge/jobs", { method: "POST", body: JSON.stringify({ paperId: paper.id, attachmentIds: att ? [att.id] : [], purpose: "验收替身：比较干燥与新鲜茎枝在海水的漂浮时长", topicId: topicA.id, idempotencyKey: "s10-r02-" + Date.now() }) });
  R.r02.startExtract = { status: start.status, body: start.json };
  // 立即进写态 → 选 A → 切 B
  await gotoBase(TRIAL);
  await clickNav("knowledge");
  await page.waitForTimeout(1500);
  // 切到 B（顶栏 #topic-select 才出现，多课题）
  const hasSel = await page.$("#topic-select");
  if (hasSel) await page.selectOption("#topic-select", topicB).catch(() => {});
  await page.waitForTimeout(1500);
  R.r02.onB_initial = await page.evaluate(() => ({
    selectedTopic: document.querySelector("#topic-select")?.value || null,
    paperOptionsInLeft: [...document.querySelectorAll("[data-paperid]")].map((e) => e.textContent.trim().slice(0, 30)),
    kzPaper: document.querySelector("#kz-paper")?.value || null,
    midText: (document.querySelector("#mid-content")?.textContent || "").replace(/\s+/g, " ").slice(0, 200),
    hasQueue: !!document.querySelector(".kzq"),
  }));
  // 等替身 8s 回执到达
  await page.waitForTimeout(9500);
  R.r02.onB_afterReceipt = await page.evaluate(() => ({
    selectedTopic: document.querySelector("#topic-select")?.value || null,
    leaksA: /M\. Martens|漂流的种子|验收替身卡/.test(document.querySelector("#mid-content")?.textContent || ""),
    queueText: (document.querySelector(".kzq")?.textContent || "").replace(/\s+/g, " ").slice(0, 160),
    status: (document.querySelector("#status")?.textContent || "").slice(0, 100),
  }));
  await page.screenshot({ path: `${OUT}/screens/r02_onB.png` });
  // 回 A
  if (hasSel) await page.selectOption("#topic-select", topicA.id).catch(() => {});
  await page.waitForTimeout(2500);
  R.r02.backToA = await page.evaluate(() => ({
    selectedTopic: document.querySelector("#topic-select")?.value || null,
    hasQueue: !!document.querySelector(".kzq"), queueText: (document.querySelector(".kzq")?.textContent || "").replace(/\s+/g, " ").slice(0, 160),
    hasStage: !!document.querySelector(".kzstage"), stageState: document.querySelector(".kzstage")?.dataset.state || null,
    cardOrQueue: /验收替身卡|AI 待审/.test(document.body.textContent),
  }));
  await page.screenshot({ path: `${OUT}/screens/r02_backA.png` });
  // 记录最终 run 状态
  const st2 = await api("/api/state");
  const run = (st2.json?.knowledge?.extractionRuns || []).slice(-1)[0];
  R.r02.finalRun = run ? { id: run.id, status: run.status, chunks: run.chunks?.length } : null;
} catch (e) { R.r02.error = String(e).slice(0, 300); }

// ═══════════════ R03：执行记录编辑两行只存一行 + 失败就地 ═══════════════
try {
  await gotoBase(TRIAL);
  await clickNav("record");
  await page.waitForTimeout(1500);
  const eidEl = await page.$("[data-eid]");
  if (eidEl) { await eidEl.click().catch(() => {}); await page.waitForTimeout(1200); }
  const rows = await page.$$(".steptbl tbody tr");
  R.r03.rows = rows.length;
  const evBefore = (await api("/api/state")).json;
  const exec0 = (evBefore.executions || [])[0];
  R.r03.eventsBefore = exec0?.events?.length ?? null;
  if (rows.length >= 2) {
    await rows[0].$eval('[data-f="amount"]', (el) => { el.value = "R03-ROW1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await rows[1].$eval('[data-f="amount"]', (el) => { el.value = "R03-ROW2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await rows[0].$eval(".steptbl-save", (b) => b.click());
    await page.waitForTimeout(2500);
    R.r03.afterSaveRow1 = await page.evaluate(() => {
      const rs = [...document.querySelectorAll(".steptbl tbody tr")];
      return { row1: rs[0]?.querySelector('[data-f="amount"]')?.value, row2: rs[1]?.querySelector('[data-f="amount"]')?.value, status: (document.querySelector("#status")?.textContent || "").slice(0, 100) };
    });
    const evAfter = (await api("/api/state")).json;
    R.r03.eventsAfter = (evAfter.executions || [])[0]?.events?.length ?? null;
    // 失败：拦截 events POST
    await page.route("**/api/executions/*/events", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "验收注入：503" }) }));
    await rows[0].$eval('[data-f="amount"]', (el) => { el.value = "R03-FAIL"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await rows[0].$eval(".steptbl-save", (b) => b.click());
    await page.waitForTimeout(2500);
    R.r03.afterFail = await page.evaluate(() => {
      return {
        row1Input: document.querySelectorAll(".steptbl tbody tr")[0]?.querySelector('[data-f="amount"]')?.value,
        inlineErrorNearRow: !!document.querySelector(".steptbl tbody tr .err, .steptbl tbody tr .error, .steptbl tbody tr .badge.warn"),
        anyErrorNode: document.querySelectorAll("[data-err], .error, .err, .inline-error, .rerr").length,
        status: (document.querySelector("#status")?.textContent || "").slice(0, 120),
        rightText: (document.querySelector("#right-content")?.textContent || "").replace(/\s+/g, " ").slice(0, 160),
      };
    });
    await page.screenshot({ path: `${OUT}/screens/r03_fail.png` });
    await page.unroute("**/api/executions/*/events");
  }
} catch (e) { R.r03.error = String(e).slice(0, 300); }

// ═══════════════ R04：提取中填备注 → 切页/返回/刷新 ═══════════════
try {
  const st = await api("/api/state");
  const s = st.json;
  const topicA = (s.topics || [])[0];
  const paper = (s.papers || []).find((p) => p.topicIds?.includes(topicA.id)) || (s.papers || [])[0];
  await gotoBase(TRIAL);
  const sel = await page.$("#topic-select");
  if (sel) await page.selectOption("#topic-select", topicA.id).catch(() => {});
  await clickNav("knowledge");
  await page.waitForTimeout(1500);
  // 保证文献选中
  if (await page.$("#kz-paper")) await page.selectOption("#kz-paper", paper.id).catch(() => {});
  await page.waitForTimeout(600);
  await page.fill("#k-purpose", "验收替身 R04（UI 发起）：干燥与新鲜茎枝漂流时长记录 " + Date.now()).catch(() => {});
  const kstart = await page.$("#k-start");
  R.r04.kstartAvailable = !!kstart;
  if (kstart) await kstart.click().catch(() => {});
  await page.waitForTimeout(2500);
  R.r04.stageDuringExtract = await page.evaluate(() => ({ stage: document.querySelector(".kzstage")?.dataset.state || null, stageText: (document.querySelector(".kzstage-state")?.textContent || "").trim(), status: (document.querySelector("#status")?.textContent || "").slice(0, 80) }));
  // 等首张替身卡出现（最多 ~20s）
  let card = null;
  for (let i = 0; i < 20 && !card; i++) { await page.waitForTimeout(1200); card = await page.$(".kzcard .kz-open"); }
  R.r04.cardAppeared = !!card;
  if (card) {
    await card.click().catch(() => {});
    await page.waitForTimeout(600);
    await page.$eval(".kz-note", (el) => { el.value = "R04-未保存备注"; el.dispatchEvent(new Event("input", { bubbles: true })); }).catch(() => {});
    R.r04.noteTyped = await page.$eval(".kz-note", (el) => el.value).catch(() => null);
  }
  R.r04.stageBefore = await page.evaluate(() => ({ stage: document.querySelector(".kzstage")?.dataset.state || null, queueText: (document.querySelector(".kzq")?.textContent || "").replace(/\s+/g, " ").slice(0, 120) }));
  // 切页 → 返回
  await clickNav("analysis");
  await page.waitForTimeout(1000);
  await clickNav("knowledge");
  await page.waitForTimeout(2000);
  R.r04.afterReturn = await page.evaluate(() => ({ noteVal: document.querySelector(".kz-note")?.value ?? null, stage: document.querySelector(".kzstage")?.dataset.state || null, cardOpen: !!document.querySelector(".kzcard.open"), status: (document.querySelector("#status")?.textContent || "").slice(0, 80) }));
  // 刷新
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const ov = await page.evaluate(() => document.getElementById("overlay")?.className || "");
  if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2000); }
  R.r04.afterReload = await page.evaluate(() => ({ stage: document.querySelector(".kzstage")?.dataset.state || null, stageText: (document.querySelector(".kzstage-state")?.textContent || "").trim(), hasQueue: !!document.querySelector(".kzq"), queueText: (document.querySelector(".kzq")?.textContent || "").replace(/\s+/g, " ").slice(0, 120) }));
  await page.screenshot({ path: `${OUT}/screens/r04_reload.png` });
} catch (e) { R.r04.error = String(e).slice(0, 300); }

// 请求汇总（写态 api 命中）
R.reqSummary = {
  total: R.reqs.length,
  api: R.reqs.filter((r) => r.url.includes("/api/") || r.url.includes("/functions/")).length,
  demoData: R.reqs.filter((r) => r.url.includes("/demo-data")).length,
  stub: R.reqs.filter((r) => r.url.includes(":5490")).length,
};

await browser.close();
fs.writeFileSync(`${OUT}/raw/baseline_r01_r04.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
