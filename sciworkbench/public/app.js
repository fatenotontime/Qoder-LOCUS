// LOCUS 三栏工作台前端（本地开发版）。
// 左：课题/子问题/材料与导入；中：原始材料（可高亮定位）；右：结构化结果与核对。
// 防护：所有写操作禁用按钮 + 处理中提示 + 内联错误 + 可重试；离开前脏检查。
import { api } from "./lib/api.js";
import { computeLanes, timeLabel, durationSourceOf } from "./lib/lanes.js";
import { fmtTime, fmtEnum, fmtVersion, fmtNameOnce, fmtKind } from "./lib/format.js";
import { refLabel, reconTag, missingTag, topicObjects } from "./lib/refs.js";
import {
  topbarTopicHtml, topicSwitcherListHtml, emptyTopicGuideHtml, navHtml, navChar, panelErrorHtml, sidebarListHtml,
  topicOverviewHtml, topicFlowHtml, topicTodosHtml, subqBlockHtml, subqDetailHtml, nextStepHtml, NAV_ITEMS,
} from "./lib/views.js";
import { knowledgeLeftHtml, knowledgeWorkspaceHtml, knowledgeQueueHtml, renderKnowledgeForm, bindKnowledge } from "./lib/pages/knowledge.js";
import { renderAnalysisForm, currentTask, contextMapHtml, analysisRightHtml, snapshotHtml, bindAnalysis } from "./lib/pages/analysis.js";

let state = { topics: [], subquestions: [], assets: [], papers: [], attachments: [], cards: [], tables: [], adoptions: [], mappings: [], comparisons: [], protocols: [], templates: [], executions: [], samples: [], measurements: [], impacts: [], ocrs: [], analysisTasks: [], analysisResults: [], reports: [], chats: [] };
const ui = { nav: "topic", topicId: "", assetId: null, paperId: null, attId: null, tableId: null, highlight: null, cell: null, dirty: false, busy: false, cardFilter: "all", groupSel: new Set(), batch: null, ack: false, protocolId: null, executionId: null, stepSel: null, viewRev: null, editEventId: null, pauseSuggest: null, prepExtra: 0, taskId: null, chatId: null, reportId: null, reportWorking: {}, navCollapsed: false, kzTab: "todo", kzPanel: "cards", cardOpen: null, kzJob: null, kzStruct: null, kiView: null, suppressRecheck: null, topicPane: "overview", subqId: null, paperView: "manage", paperQuery: "", paperFilter: "all" };

// 壳层按页布局能力（§2.1）：每页声明一种布局，壳层据此排布三块区域。
// aside：主体＋辅助（撤出左栏常驻目录）；single：只留主体（阅读）；review：三栏；canvas：宽画布。
const LAYOUT = { topic: "aside", papers: "aside" };
function layoutOf() {
  if (ui.nav === "papers" && ui.paperView === "read") return "single"; // 阅读页：只留原文
  return LAYOUT[ui.nav] ?? "review";
}
let lastAction = null; // { label, run }
function setDirty(value) {
  const next = Boolean(value);
  const changed = ui.dirty !== next;
  ui.dirty = next;
  const badge = document.getElementById("dirty-badge");
  if (!badge) return;
  badge.getAnimations().forEach((a) => a.cancel());
  if (next) {
    badge.hidden = false;
    if (changed && !prefersReducedMotion()) badge.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
  } else if (!badge.hidden) {
    if (prefersReducedMotion()) badge.hidden = true;
    else badge.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in" }).finished
      .then(() => { if (!ui.dirty) badge.hidden = true; })
      .catch(() => {});
  }
}

// A2 分区报错：只在触发它的面板内显示（left/mid/right），可关闭、带重试。
const errors = { left: null, mid: null, right: null };
const PANEL_OF = (el) => { const p = el?.closest?.(".pane"); return p ? (p.classList.contains("left") ? "left" : p.classList.contains("right") ? "right" : "mid") : "mid"; };

// 选择态持久（仅非敏感 UI 选择：页签/课题/材料/表块），刷新后归属正确。
const UI_KEY = "locus.ui.v2"; // 阶段5 重构：七入口导航，旧选择态作废，默认落课题首页
let uiRestored = false;
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ nav: ui.nav, topicId: ui.topicId, assetId: ui.assetId, paperId: ui.paperId, tableId: ui.tableId, cardFilter: ui.cardFilter, protocolId: ui.protocolId, executionId: ui.executionId, taskId: ui.taskId, chatId: ui.chatId, reportId: ui.reportId, navCollapsed: ui.navCollapsed, kzTab: ui.kzTab, kzPanel: ui.kzPanel, cardOpen: ui.cardOpen, topicPane: ui.topicPane, subqId: ui.subqId, paperView: ui.paperView, paperQuery: ui.paperQuery })); } catch {}
}
function restoreUi() {
  if (uiRestored) return;
  uiRestored = true;
  try {
    const s = JSON.parse(localStorage.getItem(UI_KEY) ?? "null");
    if (!s) return;
    if (["topic", "papers", "knowledge", "protocol", "record", "analysis", "chat"].includes(s.nav)) ui.nav = s.nav;
    if (s.cardFilter === "all" || s.cardFilter === "pending" || s.cardFilter === "reviewed") ui.cardFilter = s.cardFilter;
    if (state.topics.some((t) => t.id === s.topicId)) ui.topicId = s.topicId;
    if (state.assets.some((a) => a.id === s.assetId)) ui.assetId = s.assetId;
    if (state.papers.some((p) => p.id === s.paperId)) ui.paperId = s.paperId;
    if (state.tables.some((t) => t.id === s.tableId)) ui.tableId = s.tableId;
    if (state.protocols.some((p) => p.id === s.protocolId)) ui.protocolId = s.protocolId;
    if (state.executions.some((e) => e.id === s.executionId)) ui.executionId = s.executionId;
    if (state.analysisTasks.some((t) => t.id === s.taskId)) ui.taskId = s.taskId;
    if (state.chats.some((c) => c.id === s.chatId)) ui.chatId = s.chatId;
    if (state.reports.some((r) => r.id === s.reportId)) ui.reportId = s.reportId;
    if (typeof s.navCollapsed === "boolean") ui.navCollapsed = s.navCollapsed;
    if (["todo", "cand", "skip", "excl"].includes(s.kzTab)) ui.kzTab = s.kzTab;
    if (["cards", "themes"].includes(s.kzPanel)) ui.kzPanel = s.kzPanel;
    if (typeof s.cardOpen === "string" || s.cardOpen === null) ui.cardOpen = s.cardOpen;
    if (s.topicPane === "subq" && state.subquestions.some((q) => q.id === s.subqId)) { ui.topicPane = "subq"; ui.subqId = s.subqId; }
    if (s.paperView === "read" || s.paperView === "manage") ui.paperView = s.paperView;
    if (typeof s.paperQuery === "string") ui.paperQuery = s.paperQuery;
  } catch {}
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const topicName = (id) => state.topics.find((t) => t.id === id)?.name;

// ── 双卷主题与换卷动效 ─────────────────────────────────────
const THEME_KEY = "locus.theme.v1";
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const nextFrame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
function prefersReducedMotion() { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; }
function currentTheme() { return document.documentElement.dataset.theme === "tech" ? "tech" : "paper"; }
function applyTheme(theme, { persist = true } = {}) {
  const t = theme === "tech" ? "tech" : "paper";
  document.documentElement.dataset.theme = t;
  document.body.classList.toggle("theme-tech", t === "tech");
  if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch {} }
  const seal = $("#theme-seal");
  if (seal) {
    seal.setAttribute("aria-pressed", t === "tech" ? "true" : "false");
    seal.title = t === "paper" ? "宣纸卷 · 点击换光卷" : "光卷 · 点击换宣纸";
  }
  const meta = $("#theme-color");
  if (meta) meta.content = t === "tech" ? "#070d0f" : "#f2ede2";
}
let switchingTheme = false;
function sealAnchor(btn) {
  const r = (btn || $("#theme-seal"))?.getBoundingClientRect();
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
                     : { x: innerWidth / 2, y: innerHeight / 2 };
}
async function quickSwitchTheme(btn) {
  if (switchingTheme || replaying) return;
  const next = currentTheme() === "paper" ? "tech" : "paper";
  if (prefersReducedMotion()) { applyTheme(next); return; }
  switchingTheme = true;
  const origin = sealAnchor(btn);
  // 标识自己先合卷再开卷，随后整页换卷
  if (btn) btn.classList.add("is-curling");
  await wait(280);
  if (btn) btn.classList.remove("is-curling");
  await wait(150);
  // 亮→暗：界面拆成蓝图、由光标群重建成光卷；暗→亮：从朱印晕开的墨洗
  if (next === "tech") await runSwarmRebuild(next);
  else await runInkBloom(next, { origin });
  switchingTheme = false;
  setStatus(next === "tech" ? "已换光卷" : "已换宣纸");
}
let replaying = false;
const FIG_CURSOR_COLORS = ["#e0472f", "#e8833a", "#d9a520", "#2f9e6f", "#3b7fd6", "#6a54c9", "#c74d92", "#3aa8b8"];

function figEl(cls, css) {
  const d = document.createElement("div");
  d.className = cls;
  if (css) d.style.cssText = css;
  return d;
}
function figRect(sel) {
  const el = typeof sel === "string" ? $(sel) : sel;
  return el ? el.getBoundingClientRect() : null;
}
function typeText(el, text, delay, msPerChar = 55) {
  const t0 = performance.now() + delay;
  let i = 0;
  const step = () => {
    if (!el.isConnected) return;
    const n = Math.min(text.length, Math.max(0, Math.ceil((performance.now() - t0) / msPerChar)));
    if (n > i) { i = n; el.textContent = text.slice(0, i); }
    if (i < text.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// 光标群：围着朱印聚拢，随后散开在各元素间游走，靠近时互相让位
function startSwarmFlock(host, origin) {
  const cursors = [];
  const total = 16;
  for (let i = 0; i < total; i++) {
    const el = document.createElement("span");
    el.className = "fig-pointer";
    el.style.setProperty("--c", FIG_CURSOR_COLORS[i % FIG_CURSOR_COLORS.length]);
    el.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.4 1.2 14.6 6.4 8.9 8.6 6.9 14.8Z"/></svg>';
    host.append(el);
    const a = (i / total) * Math.PI * 2;
    const rad = 20 + (i % 5) * 14;
    const x = origin.x + Math.cos(a) * rad;
    const y = origin.y + Math.sin(a) * rad * 0.75;
    cursors.push({ el, x, y, vx: 0, vy: 0, tx: x, ty: y, ph: i * 1.93, onArrive: null });
  }
  let raf = 0, last = performance.now(), hand = 0, running = true;
  const tick = (now) => {
    if (!running) return;
    const dt = Math.min(48, Math.max(8, now - last));
    last = now;
    for (const c of cursors) {
      const dx = c.tx - c.x, dy = c.ty - c.y;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = Math.min(0.95, dist * 0.018);
      const dvx = (dx / dist) * speed + Math.cos(now * 0.0017 + c.ph) * 0.05;
      const dvy = (dy / dist) * speed + Math.sin(now * 0.0014 + c.ph * 1.4) * 0.05;
      c.vx += (dvx - c.vx) * 0.085;
      c.vy += (dvy - c.vy) * 0.085;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }
    for (let i = 0; i < cursors.length; i++) {
      for (let j = i + 1; j < cursors.length; j++) {
        const a = cursors[i], b = cursors[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (!d || d > 48) continue;
        const f = ((48 - d) / 48) * 0.7 * (dt / 16), ux = dx / d, uy = dy / d;
        a.x -= ux * f; a.y -= uy * f;
        b.x += ux * f; b.y += uy * f;
      }
    }
    for (const c of cursors) {
      if (c.onArrive && Math.hypot(c.tx - c.x, c.ty - c.y) < 24) {
        const fire = c.onArrive;
        c.onArrive = null;
        fire();
      }
      const rot = Math.atan2(c.vy, c.vx) * 57.2958 + 135;
      c.el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) rotate(${(Number.isFinite(rot) ? rot : 135).toFixed(1)}deg)`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    aim(x, y, onArrive) {
      const c = cursors[hand++ % cursors.length];
      if (c.onArrive) { const fire = c.onArrive; c.onArrive = null; fire(); }
      c.tx = x; c.ty = y;
      c.onArrive = onArrive || null;
      return c;
    },
    all(x, y) {
      cursors.forEach((c, i) => {
        if (c.onArrive) { const fire = c.onArrive; c.onArrive = null; fire(); }
        const a = (i / cursors.length) * Math.PI * 2;
        c.tx = x + Math.cos(a) * (24 + (i % 4) * 14);
        c.ty = y + Math.sin(a) * (18 + (i % 3) * 10);
      });
    },
    roam() {
      for (let k = 0; k < 5; k++) {
        const c = cursors[Math.floor(Math.random() * cursors.length)];
        if (c.onArrive) continue;
        c.tx = 60 + Math.random() * Math.max(40, innerWidth - 120);
        c.ty = 70 + Math.random() * Math.max(40, innerHeight - 140);
      }
    },
    stop() { running = false; cancelAnimationFrame(raf); host.innerHTML = ""; },
  };
}
function buildSwarmStage(bp) {
  bp.innerHTML = "";
  const vw = innerWidth, vh = innerHeight;
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  bp.append(figEl("fig-canvas"));
  const rh = figEl("fig-ruler h");
  for (let x = 0; x <= vw; x += 100) {
    const n = figEl("num", `left:${x + 4}px`);
    n.textContent = String(x);
    rh.append(n);
  }
  bp.append(rh);
  const rv = figEl("fig-ruler v");
  for (let y = 100; y <= vh; y += 100) {
    const n = figEl("num", `top:${y + 3}px`);
    n.textContent = String(y);
    rv.append(n);
  }
  bp.append(rv);
  const board = figEl("fig-board");
  for (const k of ["tl", "tr", "bl", "br"]) board.append(figEl(`fig-board-handle ${k}`));
  const size = figEl("fig-board-size");
  size.textContent = `${vw} × ${vh}`;
  board.append(size);
  bp.append(board);

  const host = figEl("fig-pointers");
  bp.append(host);
  const flock = startSwarmFlock(host, sealAnchor($("#theme-seal")));
  const hud = figEl("fig-hud");
  hud.innerHTML = '<b>16</b> 光标 · <span class="fig-done">0</span> / <span class="fig-total">0</span> 图层';
  bp.append(hud);
  const doneEl = hud.querySelector(".fig-done"), totalEl = hud.querySelector(".fig-total");
  let totalLayers = 0, doneLayers = 0;

  // 图层画完即“变前沿”：把真实元素抬到遮罩之上，线框随即淡出
  const liveEls = [];
  const shellBody = $(".shell-body");
  const goLive = (src, figNode) => {
    if (!src || !src.isConnected || liveEls.includes(src)) return;
    liveEls.push(src);
    // 整页的堆叠上下文先压平，真元素才能越过遮罩逐层出现
    if (shellBody) shellBody.style.zIndex = "auto";
    if (getComputedStyle(src).position === "static") src.style.position = "relative";
    src.style.zIndex = "212";
    src.style.opacity = "0";
    src.style.transition = "opacity .3s ease";
    requestAnimationFrame(() => { if (src.isConnected) src.style.opacity = "1"; });
    if (figNode) figNode.classList.add("is-done");
  };

  // 每个元素都是画布上的一个图层：光标飞到位置后，选框才落笔
  const box = (r, opt = {}) => {
    if (!r || r.width < 6 || r.height < 6) return null;
    const x = Math.round(r.left), y = Math.round(r.top);
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    const el = figEl("fig-el" + (opt.cls ? " " + opt.cls : ""), `left:${x}px;top:${y}px;width:${w}px;height:${h}px`);
    if (opt.fill) el.style.background = opt.fill;
    if (opt.handles !== false) for (const k of ["tl", "tr", "bl", "br"]) el.append(figEl(`fig-handle ${k}`));
    if (opt.dim) {
      const d = figEl("fig-dim");
      d.textContent = `${w} × ${h}`;
      if (opt.dimRight) { d.style.left = "calc(100% + 6px)"; d.style.top = "50%"; d.style.marginTop = "-7px"; }
      else if (y + h + 26 > vh) { d.style.top = "auto"; d.style.bottom = "6px"; }
      el.append(d);
    }
    let txt = null;
    if (opt.text) {
      txt = figEl("fig-txt");
      if (opt.textCss) txt.style.cssText = opt.textCss;
      el.append(txt);
    }
    bp.insertBefore(el, host);
    totalLayers++;
    totalEl.textContent = String(totalLayers);
    const reveal = () => {
      el.classList.add("on");
      doneEl.textContent = String(++doneLayers);
      if (txt) typeText(txt, opt.text, 140, 28);
      if (opt.src) {
        const hold = (txt ? 140 + opt.text.length * 28 : 0) + 420;
        timers.push(setTimeout(() => goLive(opt.src, el), hold));
      }
    };
    if (opt.cursor === false) requestAnimationFrame(() => requestAnimationFrame(reveal));
    else flock.aim(x + 12, y + 12, reveal);
    if (txt) flock.aim(x + Math.min(w - 16, 26 + opt.text.length * 7), y + Math.max(16, h / 2));
    return el;
  };
  const boxOf = (sel, opt = {}) => {
    const el = typeof sel === "string" ? $(sel) : sel;
    if (!el) return null;
    return box(el.getBoundingClientRect(), { ...opt, src: el });
  };
  const line = (x, y, w) => {
    const el = figEl("fig-line", `left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(w)}px`);
    el.append(figEl("fig-end l"), figEl("fig-end r"));
    bp.insertBefore(el, host);
    flock.aim(x + 10, y - 8, () => el.classList.add("on"));
  };

  // 时间轴整体拉长，按“线条 → 栏 → 标题 → 导航 → 表单”一层一层显形
  at(90, () => { rh.classList.add("on"); rv.classList.add("on"); board.classList.add("on"); });

  let topbarFig = null, brandFig = null, sealFig = null;
  at(300, () => { topbarFig = box(figRect(".topbar")); });

  at(520, () => {
    brandFig = box(figRect(".brand"), { text: "研迹 LOCUS", handles: false, textCss: "font-size:11px;letter-spacing:.16em;padding:9px 8px" });
  });

  at(760, () => { sealFig = box(figRect("#theme-seal"), { cls: "is-seal" }); });

  // 顶栏整体一次变成真界面（品牌与朱印都在其中）
  at(1560, () => {
    const tb = $(".topbar");
    if (!tb) return;
    goLive(tb, topbarFig);
    brandFig?.classList.add("is-done");
    sealFig?.classList.add("is-done");
  });

  // 每栏先落框，过一拍再补标题，一栏一栏地显
  [...$$(".pane")].slice(0, 3).forEach((p, i) => {
    at(1010 + i * 300, () => box(p.getBoundingClientRect(), { dim: true }));
    at(1150 + i * 300, () => {
      const t = p.querySelector(".pane-title");
      if (!t) return;
      boxOf(t, { cls: "is-text", text: t.textContent.trim(), handles: false, textCss: "font-size:11px;letter-spacing:.12em;padding:2px" });
    });
  });

  // 导航七格逐格出现（课题 → 对话）
  [...$$(".nav.spine .navitem")].slice(0, 7).forEach((n, i) => at(1900 + i * 150, () => {
    boxOf(n, {
      dim: i === 0,
      dimRight: i === 0,
      handles: i === 0,
      text: n.querySelector(".navsigil")?.textContent.trim() || "",
      textCss: "font-size:13px;text-align:center;padding:10px 0;letter-spacing:.1em",
    });
  }));

  [...$$(".pane .hint")].slice(0, 3).forEach((n, i) => at(2800 + i * 60, () => {
    const label = n.textContent.trim().replace(/\s+/g, " ").slice(0, 24);
    boxOf(n, { cls: "is-text", text: label, handles: false, textCss: "font-size:11px;padding:2px 4px" });
  }));
  // 中栏新建表单：整块作为一个图层，画完即变真界面
  at(2960, () => {
    const ca = $("#create-area");
    if (ca && ca.getBoundingClientRect().height > 40) boxOf(ca, { dim: true, handles: false });
  });

  // 空状态全息徽记与文字同步登场
  at(3080, () => {
    const holo = $(".pane .es-seal") || $(".pane .empty-seal");
    if (holo) boxOf(holo, { handles: false });
  });

  at(3180, () => {
    const h2 = $(".empty-guide h2") || $(".pane h2");
    if (h2) boxOf(h2, { cls: "is-text", text: h2.textContent.trim(), dim: true, textCss: "font-size:19px;font-weight:600;padding:12px 4px" });
  });

  at(3400, () => {
    const btn = $(".pane .primary");
    if (btn) boxOf(btn, { cls: "is-fill", fill: "#5fd3c8", dim: true, text: btn.textContent.trim(), textCss: "font-size:11px;color:#062a2a;padding:11px 0;text-align:center;width:100%" });
  });

  at(3640, () => boxOf("#topic-name", { handles: false, text: "例如：SLAC 漆酶动力学表征", textCss: "font-size:10px;padding:8px 10px;color:#8fb3b2" }));
  at(3860, () => boxOf("#topic-q", { handles: false, text: "想回答的科学问题", textCss: "font-size:10px;padding:8px 10px;color:#8fb3b2" }));

  [...$$(".pane .item")].slice(0, 2).forEach((n, i) => at(4100 + i * 210, () => {
    const label = n.textContent.trim().replace(/\s+/g, " ").slice(0, 12);
    boxOf(n, { handles: false, text: label, textCss: "font-size:10px;padding:8px 6px;color:#bcd6d4" });
  }));

  at(4520, () => boxOf(".pane .empty-sub", { cls: "is-text", text: "只需名称与研究问题即可开始…", handles: false, textCss: "font-size:10px;padding:3px 2px" }));
  at(4720, () => boxOf(".pane .goto", { dim: true }));
  at(4900, () => {
    const tb = figRect(".topbar");
    if (tb) line(24, tb.bottom + 3, vw - 48);
  });

  const roamTimer = setInterval(() => flock.roam(), 420);
  bp._figCleanup = () => {
    timers.forEach(clearTimeout);
    clearInterval(roamTimer);
    flock.stop();
    document.documentElement.classList.remove("swarm-build");
    liveEls.forEach((elm) => {
      elm.style.position = "";
      elm.style.zIndex = "";
      elm.style.opacity = "";
      elm.style.transition = "";
    });
    liveEls.length = 0;
    if (shellBody) shellBody.style.zIndex = "";
  };

  // 全部图层都落笔后，光标群再聚回朱印，光卷才落定
  return new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => {
      const elapsed = performance.now() - t0;
      if (elapsed < 5000 || doneLayers < totalLayers) {
        if (elapsed < 12000) { timers.push(setTimeout(check, 100)); return; }
      }
      clearInterval(roamTimer);
      const o = sealAnchor($("#theme-seal"));
      flock.all(o.x, o.y);
      timers.push(setTimeout(resolve, 750));
    };
    timers.push(setTimeout(check, 5000));
  });
}
// 亮→暗：整页摊成一张设计画布，光标群按图元重画这一页，随后光卷落定
async function runSwarmRebuild(next, { rebuild = false } = {}) {
  const layer = $("#replay-layer"), bp = $("#replay-blueprint");
  const caption = layer.querySelector(".replay-caption");
  if (caption) caption.textContent = rebuild ? "换卷 · 重绘" : "换卷";
  layer.classList.add("is-fig");
  // 暂时取消卷卡的裁切/毛玻璃，避免其层叠上下文把被抬升的真元素压回画布下
  document.documentElement.classList.add("swarm-build");
  const stageEnd = buildSwarmStage(bp);
  // 遮罩盖好之前先切到目标主题：画完的图层直接以真界面出现
  applyTheme(next);
  layer.hidden = false;
  layer.classList.remove("is-out");
  await nextFrame();
  layer.classList.add("is-on");
  await stageEnd;
  if (rebuild) renderAll();
  await wait(160);
  layer.classList.add("is-out");
  await wait(380);
  bp._figCleanup?.();
  document.documentElement.classList.remove("swarm-build");
  layer.classList.remove("is-on", "is-out", "is-fig");
  layer.hidden = true;
  bp.innerHTML = "";
}
// 暗→亮：古墨整屏垫底，宣纸色从朱印晕开，带湿纸墨边与飞溅
function themePalette(theme) {
  const probe = document.createElement("div");
  probe.dataset.theme = theme;
  probe.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px";
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const bg = cs.getPropertyValue("--bg").trim() || (theme === "tech" ? "#070d0f" : "#efe7d8");
  probe.remove();
  return bg;
}
async function runInkBloom(next, { origin, onApply } = {}) {
  if (document.querySelector(".ink-bloom")) return;
  const vw = innerWidth, vh = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  const oldBg = themePalette(currentTheme());
  const c = document.createElement("canvas");
  c.className = "ink-bloom";
  c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = oldBg;
  ctx.fillRect(0, 0, vw, vh);
  document.body.append(c);
  // 先垫满旧墨再换主题，覆盖层之下直接就是新宣纸，墨晕只负责揭开
  applyTheme(next);
  if (onApply) onApply();

  const ox = origin?.x ?? vw / 2, oy = origin?.y ?? vh / 2;
  const grains = [];
  for (let i = 0; i < 900; i++) grains.push([Math.random() * vw, Math.random() * vh, Math.random() * 0.05]);
  const maxR = Math.hypot(Math.max(ox, vw - ox), Math.max(oy, vh - oy)) + 90;
  const grow = 780;
  const ease = (p) => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const t0 = performance.now();

  return new Promise((resolve) => {
    function frame(now) {
      const p = Math.min(1, (now - t0) / grow);
      const e = ease(p);
      const r = 10 + e * maxR;
      const pts = [];
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const wob = 1 + .055 * Math.sin(3 * th + p * 7) + .035 * Math.sin(7 * th - p * 11) + .018 * Math.sin(13 * th + p * 17);
        pts.push([ox + Math.cos(th) * r * wob, oy + Math.sin(th) * r * wob]);
      }
      const trace = () => {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
      };
      ctx.clearRect(0, 0, vw, vh);
      ctx.fillStyle = oldBg;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = "destination-out";
      trace();
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      // 纸面颗粒
      ctx.save();
      trace();
      ctx.clip();
      for (let i = 0; i < grains.length; i++) {
        const gx = grains[i][0], gy = grains[i][1];
        if ((gx - ox) ** 2 + (gy - oy) ** 2 > (r * 1.06) ** 2) continue;
        ctx.fillStyle = `rgba(90,64,40,${grains[i][2]})`;
        ctx.fillRect(gx, gy, 1, 1);
      }
      ctx.restore();
      // 湿纸墨边：贴着纸色前沿的一圈墨，外加琥珀微光
      const rimA = 0.55 - 0.3 * e;
      ctx.lineWidth = 9 + 7 * (1 - e);
      ctx.strokeStyle = `rgba(96,62,36,${rimA})`;
      ctx.shadowColor = `rgba(160,108,58,${rimA * .9})`;
      ctx.shadowBlur = 24;
      trace();
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 墨点先于前沿在纸上洇开
      ctx.fillStyle = `rgba(96,62,36,${rimA * .45})`;
      for (let i = 0; i < 9; i++) {
        const th = i * 2.399 + p * 3;
        const rr = r * (0.9 + 0.06 * ((i * 37) % 10) / 10);
        ctx.beginPath();
        ctx.arc(ox + Math.cos(th) * rr, oy + Math.sin(th) * rr, 1.6 + ((i * 13) % 5), 0, Math.PI * 2);
        ctx.fill();
      }
      if (p < 1) { requestAnimationFrame(frame); return; }
      c.remove();
      resolve();
    }
    requestAnimationFrame(frame);
  });
}
async function replayAndRecast(btn) {
  if (replaying || switchingTheme) return;
  const next = currentTheme() === "paper" ? "tech" : "paper";
  if (prefersReducedMotion()) {
    applyTheme(next);
    renderAll();
    setStatus("已换卷并重绘");
    return;
  }
  replaying = true;
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
  const origin = sealAnchor(btn);
  if (next === "tech") await runSwarmRebuild(next, { rebuild: true });
  else await runInkBloom(next, { origin, onApply: renderAll });
  if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
  replaying = false;
  setStatus("已换卷并重绘");
}

function clearBootState() {
  document.body.classList.add("booted");
  const c = $("#mid-content");
  c.classList.remove("boot-skel");
  c.removeAttribute("aria-busy");
}
function bootFailure(e) {
  const h = humanError(e);
  const raw = String(e?.message ?? e ?? "");
  const msg = h.message === raw ? "服务暂时不可用，请稍后重试。" : h.message;
  notify("mid", `加载失败：${msg}`, h.detail);
  clearBootState();
  $("#mid-content").innerHTML = `<div class="empty-state boot-error">
    <span class="es-seal" aria-hidden="true">迹</span>
    <div class="es-eyebrow">卷宗未展开</div>
    <h3>暂时读不到卷宗</h3>
    <p>${esc(msg)}</p>
    <div class="empty-actions"><button class="primary" id="boot-retry" type="button">重试读取</button></div>
  </div>`;
  $("#material-list").innerHTML = `<p class="hint">等待卷宗…</p>`;
  $("#right-content").innerHTML = `<p class="hint">等待卷宗…</p>`;
  setStatus("读取失败");
}
async function bootstrap() {
  setStatus("读取卷宗…");
  try { await refresh(); clearError("mid"); clearBootState(); setStatus("就绪"); }
  catch (e) { bootFailure(e); }
}


async function refresh() {
  state = await api.getState();
  restoreUi();
  if (ui.assetId && !state.assets.some((a) => a.id === ui.assetId)) ui.assetId = null;
  if (ui.tableId && !state.tables.some((t) => t.id === ui.tableId)) ui.tableId = null;
  if (ui.topicId && !state.topics.some((t) => t.id === ui.topicId)) ui.topicId = "";
  // A1：有课题即自动落到第一个（单课题自动选中；多课题默认首项，可页头切换）；无课题由中间区引导创建。
  if (!ui.topicId && state.topics.length >= 1) ui.topicId = state.topics[0].id;
  if (ui.protocolId && !state.protocols.some((p) => p.id === ui.protocolId)) ui.protocolId = null;
  if (ui.executionId && !state.executions.some((e) => e.id === ui.executionId)) ui.executionId = null;
  if (ui.paperId && !state.papers.some((p) => p.id === ui.paperId)) { ui.paperId = null; ui.attId = null; }
  if (ui.attId && !state.attachments.some((a) => a.id === ui.attId)) ui.attId = null;
  if (ui.taskId && !state.analysisTasks.some((t) => t.id === ui.taskId)) ui.taskId = null;
  if (ui.chatId && !state.chats.some((c) => c.id === ui.chatId)) ui.chatId = null;
  if (ui.reportId && !state.reports.some((r) => r.id === ui.reportId)) ui.reportId = null;
  // E3：分项回查/结构化/展开的卡都要指向仍存在的对象，否则刷新后会出现空白详情。
  if (ui.kiView && !(state.knowledge?.items ?? []).some((e) => e.id === ui.kiView.id)) ui.kiView = null;
  if (ui.kzStruct && !state.cards.some((c) => c.id === ui.kzStruct)) ui.kzStruct = null;
  if (ui.cardOpen && !state.cards.some((c) => c.id === ui.cardOpen)) ui.cardOpen = null;
  renderAll();
  clearBootState();
}

let lastLiveAt = 0, lastLiveText = "";
function setStatus(m) {
  const el = $("#status");
  const previous = el.textContent;
  el.textContent = m;
  const kind = /失败|错误|无法|中断/.test(m) ? "error" : /连接中|处理中|运行中|中…/.test(m) ? "busy" : "ok";
  el.dataset.state = kind;
  if (previous !== m && previous && kind !== "busy" && !prefersReducedMotion()) {
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ opacity: 0.25, transform: "translateY(2px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 160, easing: "ease-out" });
  }
  const live = $("#status-live");
  if (!live || m === lastLiveText) return;
  const now = Date.now();
  if (kind === "busy" && now - lastLiveAt < 5000) return;
  live.textContent = m;
  lastLiveText = m;
  lastLiveAt = now;
}

/** 按 BOM 解码文本文件（UTF-8 / UTF-16LE / UTF-16BE），避免 UTF-16 仪器导出被误判。 */
async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let enc = "utf-8";
  if (u8[0] === 0xff && u8[1] === 0xfe) enc = "utf-16le";
  else if (u8[0] === 0xfe && u8[1] === 0xff) enc = "utf-16be";
  return new TextDecoder(enc).decode(buf).replace(/^\uFEFF/, "");
}
/** 人话错误：把原始报错翻译成可读文案，原始信息进「详情」。 */
function humanError(e) {
  const raw = String(e?.message ?? e ?? "");
  if (/fetch failed|Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw)) return { message: "连不上服务或模型，请检查网络与地址。", detail: raw };
  if (/401|403|unauthor|key/i.test(raw)) return { message: "认证失败：请检查 Key。", detail: raw };
  if (/429/.test(raw)) return { message: "请求过多（限流），请稍后重试。", detail: raw };
  if (/timeout|超时/i.test(raw)) return { message: "请求超时，请重试或调大超时。", detail: raw };
  return { message: raw || "操作失败。", detail: raw };
}
function setError(panel, err) { errors[panel] = err; renderErrors(); }
const notify = (panel, message, detail) => setError(panel, { panel, message, detail: detail ?? "", retry: null });
function clearError(panel) { errors[panel] = null; renderErrors(); }
function clearAllErrors() { errors.left = errors.mid = errors.right = null; renderErrors(); }
function renderErrors() {
  for (const p of ["left", "mid", "right"]) { const el = $("#err-" + p); if (el) el.innerHTML = panelErrorHtml(errors[p]); }
}

/** 证据可达：科学改动后，就地提示命中的报告块/分析（需复核，不自动改）。失败不阻断保存。 */
async function noteChangeHits(kind, id, fields) {
  if (!fields || !fields.length) return;
  let r;
  try { r = await api.changeHits(kind, id, { fields }); } catch { return; }
  if (r.category !== "needs_review") { setStatus("改动已保存（标题/备注：无需重算）"); return; }
  const blocks = r.byKind?.block ?? [];
  const tasks = r.byKind?.task ?? [];
  const results = r.byKind?.result ?? [];
  if (!blocks.length && !tasks.length && !results.length) { setStatus("改动已保存（暂无引用它的分析/报告块）"); return; }
  const parts = [];
  if (blocks.length) parts.push(`报告块 ${blocks.length}`);
  if (tasks.length) parts.push(`分析任务 ${tasks.length}`);
  if (results.length) parts.push(`结果 ${results.length}`);
  const rep = blocks.length ? state.reports.find((rp) => rp.blocks.some((bl) => bl.id === blocks[0].id)) : null;
  setError("right", { panel: "right", message: `改数值命中：${parts.join("、")}（需复核，不自动改）`, detail: (r.hits ?? []).map((h) => h.reason).join("\n"), retry: rep ? () => { clearAllErrors(); ui.nav = "analysis"; ui.reportId = rep.id; if (rep.taskId) ui.taskId = rep.taskId; renderAll(); } : null });
}

/** 所有写操作：禁用按钮 + 处理中 + 错误内联 + 可重试。 */
async function runBusy(btn, label, fn) {
  if (ui.busy) { setStatus("另一项操作进行中，请稍候"); return false; }
  ui.busy = true;
  const panel = PANEL_OF(btn); clearError(panel);
  const old = btn?.textContent; if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "处理中…"; }
  lastAction = { label, run: () => runBusy(btn, label, fn) };
  setStatus(`${label}…`);
  try {
    await fn();
    if ($("#status").textContent === `${label}…`) setStatus(`${label}完成`);
    return true;
  }
  catch (e) { const h = humanError(e); setStatus(`${label}失败`); setError(panel, { panel, message: `${label}失败：${h.message}`, detail: h.detail, retry: lastAction.run }); return false; }
  finally { ui.busy = false; if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = old; } }
}

/** 后台 AI job：并发上限 1，超出显示「排队中」；只禁用发起按钮，不锁全局编辑。 */
let aiActive = 0;
const AI_MAX = 1;
const aiWaiters = [];
async function runJob(btn, label, fn) {
  const old = btn?.textContent;
  if (aiActive >= AI_MAX) {
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "排队中…"; }
    setStatus(`${label}：排队中…`);
    await new Promise((res) => aiWaiters.push(res));
    if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = old; }
  }
  aiActive++;
  const panel = PANEL_OF(btn); clearError(panel);
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "后台运行中…"; }
  setStatus(`${label}…`);
  try {
    await fn();
    if ($("#status").textContent === `${label}…`) setStatus(`${label}完成`);
  }
  catch (e) { const h = humanError(e); setStatus(`${label}失败`); setError(panel, { panel, message: `${label}失败：${h.message}`, detail: h.detail, retry: () => runJob(btn, label, fn) }); }
  finally {
    if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = old; }
    aiActive--; const next = aiWaiters.shift(); if (next) next();
  }
}

function currentAsset() { return state.assets.find((a) => a.id === ui.assetId) ?? null; }

// ── 课题子页（总览 ⇄ 子问题详情）与返回 ──
function openSubq(id) {
  if (!id || id === ui.subqId) return;
  if (!guardLeave()) return;
  ui.topicPane = "subq"; ui.subqId = id;
  renderAll();
  const c = $("#mid-content");
  if (c) c.scrollTop = 0;
}
function backFromSubq() {
  if (!guardLeave()) return;
  ui.topicPane = "overview"; ui.subqId = null;
  renderAll();
}

// ── 文献：管理页 ⇄ 阅读页（相互独立）──
function openPaperRead(id) {
  if (!id) return;
  if (!guardLeave()) return;
  ui.paperId = id; ui.attId = null; ui.paperView = "read";
  renderAll();
  const c = $("#mid-content");
  if (c) c.scrollTop = 0;
}
function backToPaperManage() {
  if (!guardLeave()) return;
  ui.paperView = "manage";
  renderAll();
}

// ── 浏览器返回保护（§5.1：历史栈集成，不引入路由库）──
let historyReady = false;
let suppressHistory = false;
let lastPushedKey = "";
function pageState() { return { nav: ui.nav, topicId: ui.topicId, topicPane: ui.topicPane, subqId: ui.subqId, paperView: ui.paperView, paperId: ui.paperId }; }
/** 页面状态变化时写入一条历史；首次替换、后台刷新/主题/动画不入历史。 */
function syncHistory() {
  if (suppressHistory) return;
  const st = pageState();
  const key = JSON.stringify(st);
  if (!historyReady) { try { history.replaceState(st, ""); } catch {} historyReady = true; lastPushedKey = key; return; }
  if (key === lastPushedKey) return;
  try { history.pushState(st, ""); } catch {}
  lastPushedKey = key;
}
function applyPageState(st) {
  ui.nav = st.nav; ui.topicId = st.topicId ?? ""; ui.topicPane = st.topicPane ?? "overview";
  ui.subqId = state.subquestions.some((q) => q.id === st.subqId) ? st.subqId : null;
  if (ui.topicPane === "subq" && !ui.subqId) ui.topicPane = "overview";
  ui.paperId = state.papers.some((p) => p.id === st.paperId) ? st.paperId : null;
  ui.paperView = st.paperView === "read" && ui.paperId ? "read" : "manage";
  ui.highlight = null; ui.cell = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.stepSel = null; ui.viewRev = null; ui.editEventId = null; ui.pauseSuggest = null; ui.prepExtra = 0;
  renderAll();
}
window.addEventListener("popstate", (ev) => {
  const st = ev.state;
  if (!st || typeof st !== "object" || !st.nav) return; // 越过应用首条历史 → 交回浏览器，仍受 beforeunload 保护
  if (!guardLeave()) {
    suppressHistory = true;
    try { history.pushState(pageState(), ""); } catch {}
    suppressHistory = false;
    lastPushedKey = JSON.stringify(pageState());
    return;
  }
  suppressHistory = true;
  applyPageState(st);
  suppressHistory = false;
  lastPushedKey = JSON.stringify(pageState());
});

/** 切换前脏检查；返回 true 表示可离开。 */
function guardLeave() {
  if (!ui.dirty) return true;
  if (confirm("当前有未保存的编辑，确定离开？未保存内容会丢失。")) { setDirty(false); return true; }
  return false;
}

/** 切换卷目：统一清掉上一页的临时选择，避免跨页残留。 */
const navScrollPositions = new Map();
let navTransitionId = 0;
function navPanes() { return [document.querySelector(".pane.left"), document.querySelector(".pane.mid"), document.querySelector(".pane.right")]; }
function saveNavScroll() {
  navScrollPositions.set(ui.nav, navPanes().map((el) => el.scrollTop));
}
function restoreNavScroll() {
  const positions = navScrollPositions.get(ui.nav);
  navPanes().forEach((el, i) => { el.scrollTop = positions?.[i] ?? 0; });
}
async function activateNav(kind) {
  if (kind === ui.nav || !guardLeave()) return;
  const id = ++navTransitionId;
  const panes = navPanes();
  saveNavScroll();
  panes.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  if (!prefersReducedMotion()) {
    await Promise.all(panes.map((el) => {
      const style = getComputedStyle(el);
      return el.animate([
        { opacity: Number(style.opacity), transform: style.transform },
        { opacity: 0, transform: "translateY(-3px)" },
      ], { duration: 120, easing: "ease-in" }).finished.catch(() => {});
    }));
  }
  if (id !== navTransitionId) return;
  clearAllErrors();
  ui.nav = kind; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.stepSel = null; ui.viewRev = null; ui.editEventId = null; ui.pauseSuggest = null; ui.prepExtra = 0;
  ui.topicPane = "overview"; ui.subqId = null; ui.paperView = "manage";
  renderAll();
  restoreNavScroll();
  if (prefersReducedMotion()) return;
  await Promise.all(panes.map((el) => el.animate([
    { opacity: 0, transform: "translateY(6px)" },
    { opacity: 1, transform: "translateY(0)" },
  ], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" }).finished.catch(() => {})));
}

function renderAll() {
  if (["连接中…", "读取卷宗…"].includes($("#status").textContent)) setStatus("就绪");
  renderShell();
  renderMiddle(); renderRight();
  saveUi();
  syncHistory();
}

/** 外壳：页头当前课题、侧栏（导航＋本页列表）、中间「＋新建」区、分区报错。 */
function renderShell() {
  $("#curtopic").innerHTML = topbarTopicHtml(state, ui);
  const kz = ui.nav === "knowledge";
  if (!kz) ui.kzJob = null;
  if (kz && !ui.paperId && state.papers.length) ui.paperId = state.papers[0].id;
  if (ui.nav === "papers" && !ui.paperId) {
    const pool = state.papers.filter((p) => !ui.topicId || p.topicIds.includes(ui.topicId) || !p.topicIds.length);
    if (pool.length) ui.paperId = pool[0].id;
  }
  // B5：进入分析页自动打开最近的分析任务
  if (ui.nav === "analysis" && !ui.taskId) {
    const ts = state.analysisTasks.filter((t) => !ui.topicId || t.topicId === ui.topicId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (ts.length) ui.taskId = ts[0].id;
  }
  document.querySelector(".app").classList.toggle("mode-knowledge", kz);
  document.querySelector(".app").dataset.layout = layoutOf();
  document.querySelector(".app").classList.remove("nav-mini");
  $("#navrail").hidden = true;
  $("#nav").hidden = false;
  $("#nav").innerHTML = navHtml(ui, false);
  $("#nav").classList.remove("collapsed");
  $("#kz-left").hidden = !kz;
  if (kz) $("#kz-left").innerHTML = knowledgeLeftHtml(state, ui);
  $("#sec-materials").hidden = kz;
  $("#materials-title").textContent = ui.nav === "topic" ? "课题目录" : ({ papers: "论文条目", protocol: "方案", record: "执行", analysis: "分析任务", chat: "对话会话" }[ui.nav] ?? "材料");
  $("#material-list").innerHTML = kz ? "" : sidebarListHtml(state, ui);
  renderCreateArea();
  renderErrors();
}

/** 中间「＋新建」区：本页的新建/上传表单与工具（不再放侧栏）。 */
function renderCreateArea() {
  const box = $("#create-area"), tools = $("#tools-area");
  // 课题页、文献页（管理/阅读分离，表单移入按需流程）不走通用创建区；知识页无文献时不显示。
  if (ui.nav === "topic" || ui.nav === "papers" || (ui.nav === "knowledge" && !state.papers.length)) { box.innerHTML = ""; tools.innerHTML = ""; return; }
  box.innerHTML = ""; tools.innerHTML = "";
  renderImportBox(box);
  renderLitTools(tools);
}

function renderImportBox(box) {
  if (ui.nav === "papers") { box.innerHTML = ""; return; } // 文献页表单移入管理页按需流程
  if (ui.nav === "knowledge") { renderKnowledgeForm(box); return; }
  if (ui.nav === "protocol") { renderProtocolImport(box); return; }
  if (ui.nav === "record") { renderRecordImport(box); return; }
  if (ui.nav === "analysis") { renderAnalysisForm(box); return; }
  if (ui.nav === "chat") { renderChatForm(box); return; }
  box.innerHTML = "";
}
const EMPTY_META = {
  papers: { eyebrow: "文献卷尚空", actions: [] },
  knowledge: { eyebrow: "知识卷尚空", actions: [["先去文献", "goto:papers"]] },
  protocol: { eyebrow: "方案卷尚空", actions: [["从文献重构", "goto:papers"]] },
  record: { eyebrow: "执行卷尚空", actions: [["先定方案", "goto:protocol"], ["开卷执行", "focus-create"]] },
  analysis: { eyebrow: "分析卷尚空", actions: [["查看记录", "goto:record"]] },
  chat: { eyebrow: "对话卷尚空", actions: [["回顾方案", "goto:protocol"]] },
};
function emptyStateHtml(kind, title, desc) {
  const meta = !state.topics.length
    ? { eyebrow: "未开卷", actions: [["先建课题", "goto:topic"]] }
    : (EMPTY_META[kind] ?? { eyebrow: "本草目尚空", actions: [] });
  const acts = (meta.actions ?? []).map(([label, act], i) =>
    `<button class="empty-act ${i === 0 ? "primary" : ""}" type="button" data-act="${esc(act)}">${esc(label)}</button>`).join("");
  return `<div class="empty-state" data-empty="${esc(kind)}">
    <span class="es-seal" aria-hidden="true">${navChar(kind)}</span>
    <div class="es-eyebrow">${esc(meta.eyebrow)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(!state.topics.length ? "先开卷建立课题，再回到本卷积累内容。" : desc)}</p>
    ${acts ? `<div class="empty-actions">${acts}</div>` : ""}
  </div>`;
}
function midEmpty(kind, title, desc) {
  const c = $("#mid-content");
  c.classList.add("is-empty");
  c.innerHTML = emptyStateHtml(kind, title, desc);
}
function renderMiddle() {
  const note = $("#mid-note"), content = $("#mid-content");
  document.body.dataset.nav = ui.nav;
  content.classList.remove("is-empty", "rich", "reader");
  content.classList.toggle("kzw", ui.nav === "knowledge");
  if (ui.nav === "topic") {
    note.hidden = true;
    if (!state.topics.length) {
      $("#mid-title").textContent = "课题";
      content.innerHTML = emptyTopicGuideHtml();
      content.classList.add("rich");
      return;
    }
    if (ui.topicPane === "subq") {
      const s = state.subquestions.find((x) => x.id === ui.subqId);
      $("#mid-title").textContent = "子问题";
      content.innerHTML = subqDetailHtml(state, ui);
      content.classList.add("rich");
      if (!s) ui.topicPane = "overview";
      return;
    }
    const t = state.topics.find((x) => x.id === ui.topicId);
    $("#mid-title").textContent = "课题";
    content.innerHTML = t
      ? topicFlowHtml(state, ui) + topicOverviewHtml(state, ui) + subqBlockHtml(state, ui)
      : `<div class="empty-guide" data-empty="topic-pick"><div class="empty-seal" aria-hidden="true">课</div>
          <div class="eyebrow">未选课题</div><h2>尚未选择课题</h2>
          <p class="empty-sub">用顶栏「切换」选一个课题，或新建一个。</p></div>`;
    content.classList.add("rich");
    return;
  }
  if (ui.nav === "papers") {
    if (ui.paperView === "read" && currentPaper()) return renderPaperRead(content, note);
    ui.paperView = "manage";
    return renderPaperManage(content, note);
  }
  if (ui.nav === "knowledge") {
    $("#mid-title").textContent = "卡片审阅";
    note.hidden = true;
    if (!state.papers.length) { midEmpty("knowledge", "还没有可审的卡片", "先在文献卷建立条目并导入附件，再回到知识卷发起语义提取。"); return; }
    content.innerHTML = knowledgeWorkspaceHtml(state, ui);
    return;
  }
  if (ui.nav === "protocol") {
    $("#mid-title").textContent = currentProtocol() ? "实验图" : "实验方案";
    note.hidden = true;
    if (!currentProtocol()) { midEmpty("protocol", "还没有实验方案", "在上方新建方案、上传原件解析，或从论文方法重构。"); return; }
    content.innerHTML = protocolMainHtml();
    content.classList.add("rich");
    return;
  }
  if (ui.nav === "record") {
    const a = currentAsset();
    if (a && a.kind === "image") {
      $("#mid-title").textContent = `原始图片 · ${a.name}`;
      note.hidden = false; note.textContent = "原图归档；识别在右栏，须确认。";
      content.innerHTML = `<img class="ocrimg" src="${a.text}" alt="${esc(a.name)}" />`;
      return;
    }
    const e = currentExecution();
    if (!e) { note.hidden = true; $("#mid-title").textContent = "执行记录"; midEmpty("record", "还没有执行记录", "在左侧选择执行，或先创建一次执行；手写图片也可在这里查看。"); return; }
    const p = state.protocols.find((x) => x.id === e.protocolId);
    const snap = e.preparation?.snapshot ?? p?.revisions.find((r) => r.revision === (e.preparation?.baseRevision ?? e.protocolRevision));
    if ((e.phase ?? "recording") === "preparing") {
      $("#mid-title").textContent = "准备稿";
      note.hidden = false;
      note.textContent = `准备稿（未确认）：差异与确认在右栏；确认后进入步骤记录。`;
      content.textContent = snap ? fmtSnapshot(snap) : "（方案快照缺失）";
      return;
    }
    $("#mid-title").textContent = "步骤记录表";
    note.hidden = true;
    content.innerHTML = `<div class="item">${stepsTableHtml(e, snap)}</div>` + impactHtml([e.id]);
    content.classList.add("rich");
    return;
  }
  if (ui.nav === "analysis") {
    const t = currentTask(state, ui);
    $("#mid-title").textContent = t ? `上下文地图 · ${t.title}` : "分析任务";
    if (!t) { note.hidden = true; midEmpty("analysis", "还没有分析任务", "在左侧选择任务，或在上方基于数据表新建分析。"); return; }
    note.hidden = false;
    note.textContent = t.snapshot
      ? `快照已冻结（hash ${t.snapshot.hash.slice(0, 12)}…）；改候选不回改旧快照。`
      : "未冻结：推荐时按核心＋候选＋目的冻结发送内容。";
    content.innerHTML = contextMapHtml(state, ui, t);
    content.classList.add("rich");
    return;
  }
  if (ui.nav === "chat") {
    const c = currentChat();
    $("#mid-title").textContent = "上下文对话";
    if (!c) { note.hidden = true; midEmpty("chat", "还没有对话", "在左侧选择会话，或围绕课题新建对话；范围与采纳入右栏。"); return; }
    note.hidden = false;
    note.textContent = `范围：${c.subquestionId ? "子问题 ＋ " : ""}${c.scope.length} 对象；发送即冻结快照。讨论不改对象；采纳需确认。`;
    content.innerHTML = chatHtml(c);
    content.classList.add("rich");
    return;
  }
  note.hidden = true;
  $("#mid-title").textContent = "原始材料";
  content.textContent = "在左栏选择工作对象。";
}
function renderRight() {
  if (ui.nav === "topic") { $("#right-title").textContent = "下一步与待办"; $("#right-content").innerHTML = nextStepHtml(state, ui) + topicTodosHtml(state, ui); return; }
  if (ui.nav === "papers") {
    if (ui.paperView === "read") { $("#right-title").textContent = ""; $("#right-content").innerHTML = ""; return; }
    $("#right-title").textContent = "条目与附件"; $("#right-content").innerHTML = paperHtml(); return;
  }
  if (ui.nav === "knowledge") {
    $("#right-title").textContent = "审阅队列";
    $("#right-content").innerHTML = knowledgeQueueHtml(state, ui);
    return;
  }
  if (ui.nav === "protocol") { $("#right-title").textContent = "方案信息"; $("#right-content").innerHTML = protocolSideHtml(); return; }
  if (ui.nav === "record") { $("#right-title").textContent = "实验记录"; $("#right-content").innerHTML = recordHtml(); return; }
  if (ui.nav === "analysis") { $("#right-title").textContent = "推荐 · 结果 · 分析初稿"; $("#right-content").innerHTML = analysisRightHtml(state, ui); return; }
  if (ui.nav === "chat") { $("#right-title").textContent = "范围 · 来源 · 采纳"; $("#right-content").innerHTML = chatRightHtml(); return; }
  $("#right-title").textContent = "结构化结果";
  $("#right-content").innerHTML = `<p class="hint">在左栏选择工作对象。</p>`;
}
/** 候选库状态（与后端 candidateStateOf 同口径）：跳过保未复核；采用独立于核对。 */
const ROLE_LABEL = { fulltext: "正文", supplement: "补充材料", other: "其他" };


// ── 阶段5 第一段：课题首页 / 文献整理 / 领域知识积累 ─────────────

function currentPaper() { return state.papers.find((p) => p.id === ui.paperId) ?? null; }
function currentAttachment() {
  const p = currentPaper(); if (!p) return null;
  const atts = state.attachments.filter((a) => a.paperId === p.id);
  return atts.find((a) => a.id === ui.attId) ?? atts[0] ?? null;
}


/** 409 不死路：给出已有条目定位按钮（用分区报错承载）。 */
function showLocate(msg, paperId) {
  setError("right", { panel: "right", message: msg, detail: "", retry: paperId ? () => { clearAllErrors(); ui.paperId = paperId; ui.attId = null; renderAll(); } : null });
}

/** 新建条目表单字段（按需展开，落在文献管理页顶部）。 */
function paperFormFieldsHtml() {
  return `
    <input id="pp-title" placeholder="题名（必填）" />
    <input id="pp-authors" placeholder="作者（and 或分号分隔）" />
    <div class="row"><input id="pp-year" placeholder="年份" /><input id="pp-doi" placeholder="DOI（可空）" /></div>
    <input id="pp-source" placeholder="来源（期刊/预印本/网址）" />
    <input id="pp-license" placeholder="许可（如 CC BY 4.0；未提供留空，不补造）" />
    <button class="primary" id="pp-create" type="button">创建条目</button>
    <p class="hint">条目是题录身份，不是文件；附件在条目详情里导入，收藏不触发 AI 解析。</p>`;
}
/** 题录导入表单字段（按需展开，落在文献管理页顶部）。 */
function bibImportFieldsHtml() {
  return `
    <select id="bib-format"><option value="bibtex">BibTeX（.bib）</option><option value="csl-json">CSL-JSON（Zotero 导出）</option></select>
    <textarea id="bib-text" rows="4" placeholder="粘贴题录内容；同 DOI 已有条目会跳过并给定位"></textarea>
    <button class="primary" id="bib-import" type="button">导入题录</button>
    <p class="hint">题录导入（本功能）/ 附件导入（条目详情里上传）/ 实时连接（未实现，不做假入口）。</p>`;
}

/** 文献管理页列表（搜索/筛选后）。 */
function paperListHtml() {
  const scoped = state.papers.filter((p) => !ui.topicId || p.topicIds.includes(ui.topicId) || !p.topicIds.length);
  if (!scoped.length) return emptyStateHtml("papers", "还没有论文条目", "新建条目或导入题录；条目是题录身份，附件另存、不触发解析。");
  const q = (ui.paperQuery ?? "").trim().toLowerCase();
  let ps = scoped;
  if (q) ps = ps.filter((p) => p.title.toLowerCase().includes(q) || p.authors.join(" ").toLowerCase().includes(q));
  if (ui.paperFilter === "has") ps = ps.filter((p) => state.attachments.some((a) => a.paperId === p.id));
  if (ui.paperFilter === "none") ps = ps.filter((p) => !state.attachments.some((a) => a.paperId === p.id));
  if (!ps.length) {
    return `<div class="empty-state" data-empty="papers-filter"><span class="es-seal" aria-hidden="true">文</span>
      <div class="es-eyebrow">无匹配</div><h3>没有匹配的文献</h3><p>清空搜索或调整筛选。</p>
      <div class="empty-actions"><button class="primary" type="button" data-paper-clear>清除条件</button></div></div>`;
  }
  return ps.map((p) => {
    const nAtt = state.attachments.filter((a) => a.paperId === p.id).length;
    const nCard = state.cards.filter((c) => c.paperId === p.id).length;
    const authors = p.authors.join("、");
    return `<article class="paper-item ${p.id === ui.paperId ? "active" : ""}" data-paperrow="${p.id}">
      <div class="pi-main">
        <div class="pi-title">${esc(p.title)}</div>
        <div class="pi-meta">${p.year ? esc(p.year) + " · " : ""}${esc(authors.length > 40 ? authors.slice(0, 40) + "…" : authors)} · ${nAtt} 附件 · ${nCard} 卡</div>
      </div>
      <div class="pi-actions">
        <button class="mini-act paper-read" type="button" data-paper="${p.id}"${nAtt ? "" : ' disabled title="这个条目还没有附件"'}>阅读</button>
      </div>
    </article>`;
  }).join("");
}

/** 文献管理页：主体＝可扫描列表；新建/导入按需展开；条目详情在右侧辅助区。 */
function renderPaperManage(content, note) {
  note.hidden = true;
  $("#mid-title").textContent = "文献管理";
  $("#tools-area").innerHTML = "";
  content.classList.remove("is-empty");
  content.classList.add("rich");
  const paused = ui.paperQuery ? ` · 搜索「${esc(ui.paperQuery)}」` : "";
  content.innerHTML = `
    <div class="lit-manage-head">
      <div class="lm-search"><input id="paper-search" placeholder="搜索题名或作者" value="${esc(ui.paperQuery ?? "")}" aria-label="搜索文献" /></div>
      <div class="lm-filter">
        <select id="paper-filter" aria-label="筛选文献">
          <option value="all"${ui.paperFilter !== "has" && ui.paperFilter !== "none" ? " selected" : ""}>全部</option>
          <option value="has"${ui.paperFilter === "has" ? " selected" : ""}>有附件</option>
          <option value="none"${ui.paperFilter === "none" ? " selected" : ""}>无附件</option>
        </select>
      </div>
      <div class="lm-tools">
        <details class="mini"><summary>新建条目</summary>${paperFormFieldsHtml()}</details>
        <details class="mini"><summary>导入题录</summary>${bibImportFieldsHtml()}</details>
      </div>
    </div>
    <p class="hint">共 ${state.papers.filter((p) => !ui.topicId || p.topicIds.includes(ui.topicId) || !p.topicIds.length).length} 篇${paused}；点条目在右侧管理题录与附件，「阅读」进入原文。</p>
    <div id="paper-list" class="paper-list">${paperListHtml()}</div>`;
}

/** 阅读页工具栏：返回、题名、当前附件，多附件时可切换（阅读行为）。 */
function paperReadToolbarHtml(p, att) {
  const atts = state.attachments.filter((a) => a.paperId === p.id);
  const opts = atts.map((a) => {
    const asset = state.assets.find((x) => x.id === a.assetId);
    return `<option value="${a.id}"${a.id === att?.id ? " selected" : ""}>${ROLE_LABEL[a.role]}：${esc(asset?.name ?? a.assetId)}${a.version ? " · " + esc(a.version) : ""}</option>`;
  }).join("");
  const asset = att && state.assets.find((x) => x.id === att.assetId);
  return `<div class="read-bar">
    <button class="back-btn" type="button" data-paper-back>← 返回文献管理</button>
    <div class="read-head">
      <div class="read-title" title="${esc(p.title)}">${esc(p.title)}</div>
      <div class="read-sub">${att ? `${ROLE_LABEL[att.role]} · ${esc(asset?.name ?? "")}${att.version ? " · " + esc(att.version) : ""}` : "无附件"}</div>
    </div>
    ${atts.length > 1 ? `<label class="read-more"><span class="hint">切换附件</span><select id="read-att">${opts}</select></label>` : ""}
  </div>`;
}

/** 阅读页：以原文为中心，无导入/列表/附件管理/大块元数据。 */
function renderPaperRead(content, note) {
  const p = currentPaper();
  const att = currentAttachment();
  note.hidden = true;
  $("#mid-title").textContent = "文献阅读";
  $("#tools-area").innerHTML = paperReadToolbarHtml(p, att);
  content.classList.remove("rich", "is-empty");
  if (!att) {
    content.classList.add("is-empty");
    content.innerHTML = `<div class="empty-state" data-empty="papers-read"><span class="es-seal" aria-hidden="true">文</span>
      <div class="es-eyebrow">正文尚无</div><h3>这个条目还没有附件</h3><p>回到文献管理，在条目详情里导入正文。</p>
      <div class="empty-actions"><button class="primary" type="button" data-paper-back>返回文献管理</button></div></div>`;
    return;
  }
  const asset = state.assets.find((a) => a.id === att.assetId);
  content.classList.add("reader");
  content.innerHTML = esc(asset?.text ?? "");
}

/** 右栏：条目元信息（修订留历史）＋附件管理＋课题关联＋去知识提取。 */
function paperHtml() {
  const p = currentPaper();
  if (!p) return `<p class="hint">在左栏选择论文条目；或新建条目/导入题录。</p>`;
  const atts = state.attachments.filter((a) => a.paperId === p.id);
  const nCard = state.cards.filter((c) => c.paperId === p.id).length;
  return `
    <div class="item" data-id="${p.id}">
      <div class="meta">题录 · ${nCard} 张知识卡</div>
      <div class="ppform">
        <label>题名<input data-field="pTitle" value="${esc(p.title)}" /></label>
        <label>作者<input data-field="pAuthors" value="${esc(p.authors.join(" and "))}" /></label>
        <div class="ppgrid2">
          <label>年份<input data-field="pYear" value="${esc(p.year)}" /></label>
          <label>DOI<input data-field="pDoi" value="${esc(p.doi)}" /></label>
        </div>
        <label>来源<input data-field="pSource" value="${esc(p.source)}" /></label>
        <label>许可<input data-field="pLicense" value="${esc(p.license)}" placeholder="未提供留空" /></label>
        <label>备注<input data-field="pNote" value="${esc(p.note)}" /></label>
        <div class="ppsave"><input data-field="pReason" placeholder="修改原因（修订留历史）" />
          <button class="primary" id="paper-save">保存题录</button><button class="history-btn">历史(${p.history.length})</button></div>
      </div>
      <div class="pane-title">课题关联（可多课题引用）</div>
      ${state.topics.length ? state.topics.map((t) => `<label class="cmppick"><input type="checkbox" class="paper-topic" value="${t.id}" ${p.topicIds.includes(t.id) ? "checked" : ""}/> ${esc(t.name)}</label>`).join("") : `<p class="hint">暂无课题；先在「课题展示」创建。</p>`}
      <div class="row"><button class="primary goto" data-goto="knowledge" data-paper="${p.id}">去知识提取（选目的后发起）</button></div>
    </div>
    <div class="item">
      <div class="meta">附件（${atts.length}）· 导入只归档，不触发解析</div>
      ${atts.map((a) => {
        const asset = state.assets.find((x) => x.id === a.assetId);
        return `<div class="material ${a.id === (currentAttachment()?.id ?? "") ? "active" : ""}" data-attid="${a.id}">
          <div class="m-title">${esc(asset?.name ?? a.assetId)}</div>
          <div class="m-meta">${ROLE_LABEL[a.role]}${a.version ? " · " + esc(a.version) : ""} · ${asset?.bytes ?? 0}B</div>
        </div>`;
      }).join("") || `<p class="hint">暂无附件。</p>`}
      <details class="mini">
        <summary>导入附件（Markdown/纯文本）</summary>
        <input id="att-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" />
        <textarea id="att-text" rows="3" placeholder="或粘贴文本…"></textarea>
        <div class="row"><select id="att-role"><option value="fulltext">正文</option><option value="supplement">补充材料</option><option value="other">其他</option></select>
          <input id="att-version" placeholder="版本（可空，如 v2）" /></div>
        <button class="primary" id="att-add">导入附件</button>
        <p class="hint">同 DOI 的不同附件/版本不互拒；真重复（同内容）会给出已有原件定位。PDF 等格式解析器未配置。</p>
      </details>
    </div>`;
}

/** 左栏：知识提取发起（目的必填）＋机械草稿调试入口（明确标记）。 */
/** 左栏文献工具：命名映射 + 条件比较（仅文献导航显示）。 */
function renderLitTools(box) {
  if (ui.nav === "record") { renderRecordTools(box); return; }
  if (ui.nav === "papers") { box.innerHTML = ""; return; } // 题录导入移入文献管理页
  if (ui.nav !== "knowledge") { box.innerHTML = ""; return; }
  const maps = state.mappings.filter((m) => !ui.topicId || !m.topicId || m.topicId === ui.topicId);
  const cmps = state.comparisons.filter((c) => !ui.topicId || c.topicId === ui.topicId);
  const confirmed = state.cards.filter((c) => c.audit === "confirm" && (!ui.topicId || state.assets.find((a) => a.id === c.assetId)?.topicId === ui.topicId || state.papers.find((p) => p.id === c.paperId)?.topicIds.includes(ui.topicId)));
  const DIV = { single: "单源", consistent: "一致", value_diff: "值分歧", conditions_diff: "条件差异" };
  box.innerHTML = `
    <details class="mini" id="map-box">
      <summary>命名映射（${maps.length}）</summary>
      ${maps.map((m) => `<div class="hint">${esc(m.original)} → ${esc(m.mapped)}（依据：${esc(m.basis)}）</div>`).join("") || `<p class="hint">暂无映射。原名保留，映射须有依据。</p>`}
      <div class="row"><input id="map-original" placeholder="原名" /><input id="map-mapped" placeholder="映射名" /></div>
      <div class="row"><input id="map-basis" placeholder="来源依据（必填）" /><button id="map-create">添加映射</button></div>
    </details>
    <details class="mini" id="cmp-box">
      <summary>条件比较（${cmps.length}）</summary>
      ${ui.topicId ? `
        <div class="hint">仅已确认证据卡可入比较；快照固定卡版本，不自动合并/平均。</div>
        ${confirmed.length ? confirmed.map((c) => `<label class="cmppick"><input type="checkbox" class="cmp-card" value="${c.id}" /> ${esc(c.rawText.slice(0, 40))}（第${c.revision}版）</label>`).join("") : `<p class="hint">本课题暂无已确认证据卡。</p>`}
        <div class="row"><input id="cmp-filters" placeholder="筛选（逗号分隔）" /><input id="cmp-conversions" placeholder="换算（逗号分隔）" /></div>
        <div class="row"><input id="cmp-exclusions" placeholder="排除（逗号分隔）" /><button class="primary" id="cmp-create">固定快照比较</button></div>
      ` : `<p class="hint">先选课题。</p>`}
      ${cmps.map((cmp) => `
        <div class="item cmp" data-id="${cmp.id}">
          <div class="meta">快照 ${esc(fmtTime(cmp.snapshot.pinnedAt))}${cmp.reviewFlags.length ? ` · <span class="badge warn">需复核（${cmp.reviewFlags.length} 张卡已修改）</span>` : ""}</div>
          <div class="hint">口径：筛选[${cmp.snapshot.filters.map(esc).join("、") || "—"}] 换算[${cmp.snapshot.conversions.map(esc).join("、") || "—"}] 排除[${cmp.snapshot.exclusions.map(esc).join("、") || "—"}]</div>
          ${cmp.groups.map((g) => `<div class="cmpgroup">
            <strong>${esc(g.name)}</strong> <span class="badge div-${g.divergence}">${DIV[g.divergence]}</span>
            ${g.entries.map((e) => `<div class="hint">${esc(e.value)}${e.unit ? " " + esc(e.unit) : ""} · 条件[${e.conditions.map(esc).join("、") || "—"}] · 卡${esc(e.cardId.slice(5, 13))} rev${e.cardRevision}${e.originalName !== e.mappedName ? `（原名 ${esc(e.originalName)}）` : ""}</div>`).join("")}
            ${g.unresolved.map((u) => `<div class="hint warn">${esc(u)}</div>`).join("")}
          </div>`).join("")}
          <div class="row"><button class="cmp-again" data-id="${cmp.id}">按当前版本重新比较（新快照）</button></div>
        </div>`).join("")}
    </details>`;
}

let foldEmpty = true;
/** 表格渲染（中间/最大化共用）：全空行只在展示层折叠，零值与标记行不折叠，原件字节不改。 */
function tableGridHtml(t, big) {
  const markers = new Set(t.markerRows ?? []);
  const isEmptyRow = (r) => (r ?? []).every((c) => String(c ?? "").trim() === "");
  const folded = [];
  const rows = t.rows.map((r, ri) => {
    const isMarker = markers.has(ri);
    if (isEmptyRow(r) && foldEmpty) { folded.push(ri + 1); return ""; }
    return `<tr${isMarker ? ` class="marker" title="标记行：疑似标题/备注/占位或分块标记，保留原样待人工核对（不删行）"` : ""}>${t.columns.map((_, ci) => `<td class="cell" data-row="${ri}" data-col="${ci}">${esc(r[ci] ?? "")}</td>`).join("")}</tr>`;
  }).join("");
  const note = folded.length
    ? `<p class="hint">已折叠 ${folded.length} 个全空行（仅展示层；原件字节未改，零值与标记行不折叠）：第 ${folded.slice(0, 12).join("、")}${folded.length > 12 ? "…" : ""} 行</p>`
    : "";
  return { html: `<div class="tablewrap${big ? " big" : ""}"><table class="grid"><thead><tr>${t.columns.map((n) => `<th>${esc(n)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>${note}`, folded: folded.length };
}
function openTableMax(tid) {
  const t = state.tables.find((x) => x.id === tid); if (!t) return;
  document.querySelector("#table-max")?.remove();
  const asset = state.assets.find((a) => a.id === t.assetId);
  const markers = new Set(t.markerRows ?? []);
  const cell = ui.cell && ui.cell.tableId === t.id ? ui.cell : null;
  const wrap = document.createElement("div");
  wrap.id = "table-max"; wrap.className = "item"; wrap.dataset.id = t.id;
  wrap.innerHTML = `
    <div class="tblmax-head"><strong>${esc(t.name)}</strong>${t.origin === "reconstructed" ? ` <span class="badge warn">文献重构</span>` : ""} <span class="hint">${t.rows.length} 行（含 ${markers.size} 个标记行：疑似标题/备注/占位，保留待核对）× ${t.columns.length} 列 · 原件 ${asset?.bytes ?? 0}B${t.origin === "reconstructed" ? " · 历史文献重构数据，非本地实测" : ""}</span>
      <button id="tblmax-fold">${foldEmpty ? "展开全空行" : "折叠全空行"}</button>
      <button id="tblmax-csv">查看原始 CSV</button>
      <button id="tblmax-close">关闭</button></div>
    <div class="tblmax-body">
      ${tableGridHtml(t, true).html}
      <div id="tblmax-raw" hidden><pre>${esc(asset?.text ?? "")}</pre></div>
      ${cell ? `<div class="row celledit"><label>单元格 行${cell.row}·列${cell.col}</label>
        <input data-field="cellValue" value="${esc(t.rows[cell.row]?.[cell.col] ?? "")}" />
        <input data-field="cellReason" placeholder="更正原因（必填）" />
        <button class="save-cell">保存单元格</button><button class="cancel-cell">取消</button></div>` : `<p class="hint">点单元格可更正；改值需原因。</p>`}
      <details class="mini"><summary>列设置（单位 / 核对）</summary>
        <div class="tablewrap"><table class="grid"><thead><tr>${t.columns.map((name, i) => `<th><div>${esc(name)}</div>
          <input data-col="${i}" data-k="unit" value="${esc(t.columnMeta[i].unit)}" placeholder="单位" />
          <select data-col="${i}" data-k="decision">${[["unreviewed", "待审"], ["confirm", "已确认"], ["need_info", "待补"]].map(([v, l]) => `<option value="${v}" ${v === t.columnMeta[i].decision ? "selected" : ""}>${l}</option>`).join("")}</select></th>`).join("")}</tr></thead></table></div>
      </details>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(t.note)}" />
        <label>原因</label><input data-field="reason" placeholder="改单元格数值时必填" />
        <button class="save-cols">保存列设置</button><button class="history-btn">历史(${t.history.length})</button></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#tblmax-close").onclick = () => { ui.cell = null; wrap.remove(); };
  wrap.querySelector("#tblmax-fold").onclick = () => { foldEmpty = !foldEmpty; saveUi(); openTableMax(tid); };
  wrap.querySelector("#tblmax-csv").onclick = () => { const r = wrap.querySelector("#tblmax-raw"); r.hidden = !r.hidden; };
  wrap.querySelector(".tblmax-body").addEventListener("click", (ev) => {
    const td = ev.target.closest("td.cell"); if (!td) return;
    ev.stopPropagation();
    ui.cell = { tableId: tid, row: Number(td.dataset.row), col: Number(td.dataset.col) };
    openTableMax(tid);
  });
}

// ── 4C：方案 / 实验图 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR ──

function currentProtocol() { return state.protocols.find((p) => p.id === ui.protocolId) ?? null; }
function currentExecution() { return state.executions.find((e) => e.id === ui.executionId) ?? null; }
function viewSnapshot(p) { return p.revisions.find((r) => r.revision === (ui.viewRev ?? p.revision)) ?? p.revisions[p.revisions.length - 1]; }
/** 方案本体在、但所固定的那一版不存在 → 缺失版本（与后端缺口节点一致，不画看似正常的历史版本）。 */
function verMissing(p, rev) { return !!p && !p.revisions.some((r) => r.revision === rev); }

function fmtSnapshot(s) {
  const lines = [`目的：${s.purpose || "（未写）"}`, `输入：${s.inputs.join("、") || "（未写）"}`, "步骤："];
  const L = computeLanes(s.steps);
  const mainById = new Map(L.main.map((m) => [m.step.id, m]));
  for (const st of s.steps) {
    const dsrc = durationSourceOf(st);
    const dur = dsrc === "unknown" ? "时长未知" : `${st.durationMin}min${dsrc === "estimated" ? "（估计）" : dsrc === "computed" ? "（由量·速率计算）" : ""}`;
    const branch = st.branch ? `［支路:${st.branch}］` : "";
    if (!st.branch) {
      const m = mainById.get(st.id);
      lines.push(`  ${timeLabel(m.offset, m.approx)}  ${st.op}  ${dur}${st.observeEnd ? `  终点:${st.observeEnd}` : ""}`);
    } else {
      const anchors = st.branchFrom || st.mergeInto ? `［分叉自:${st.branchFrom ?? "未指定"} / 汇合入:${st.mergeInto ?? "未指定"}］` : "";
      lines.push(`  ${st.op}  ${dur}${branch}${anchors}${st.observeEnd ? `  终点:${st.observeEnd}` : ""}`);
    }
    for (const [k, v] of Object.entries(st.params)) lines.push(`      ${k}=${v}`);
    if (st.note) lines.push(`      注：${st.note}`);
  }
  if (L.unknownCount) lines.push(`（主线有 ${L.unknownCount} 步时长未知：其后偏移为下界 t≥，未按零累计；已知总时长 ${L.totalKnown}min）`);
  lines.push(`条件：${s.conditions.join("、") || "（未写）"}`, `判据：${s.criteria || "（未写）"}`);
  if (s.unknowns.length) lines.push(`未知项：${s.unknowns.join("、")}`);
  if (s.sourceFragments.length) lines.push("方法来源片段：", ...s.sourceFragments.map((f) => `  「${f}」`));
  lines.push(`（${fmtVersion(s.revision)} · ${fmtTime(s.at)} · 原因：${s.reason}）`);
  return lines.join("\n");
}

/** 步骤行格式：操作 | 时长分钟(可空) | 支路名(可空) | est(可空) */
function parseStepsText(text) {
  return String(text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [op, dur, branch, est] = l.split("|").map((x) => (x ?? "").trim());
    return { op, durationMin: dur === "" ? null : Number(dur), branch: branch || null, estimated: est === "est" || est === "估计" };
  });
}

async function pollJob(jobId, label) {
  for (let i = 0; i < 1200; i++) {
    const job = await api.getJob(jobId);
    setStatus(`${label}：${job.message}`);
    if (job.status === "done") return job.result ?? {};
    if (job.status === "error") throw new Error(job.error || `${label}失败`);
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error(`${label}等待超时`);
}

/** 后台任务完成后的刷新：若有未保存编辑，不静默丢弃，改为提示后再由用户决定。 */
async function refreshAfterJob() {
  if (ui.dirty) {
    notify("mid", "后台任务已完成，但当前有未保存编辑（未刷新，以免丢弃）。保存或放弃后再刷新查看结果。");
    return;
  }
  await refresh();
}

function renderProtocolImport(box) {
  const protos = state.assets.filter((a) => a.kind === "protocol" && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
  const paperAtts = state.assets.filter((a) => a.kind === "literature" && state.attachments.some((x) => x.assetId === a.id));
  box.innerHTML = `
    <details class="mini" ${state.protocols.length ? "" : "open"}>
      <summary>＋新建方案</summary>
      <details class="mini" open><summary>① 上传原件并解析</summary>
        <input id="proto-up-name" placeholder="文件名（如 protocol.md）" />
        <input id="proto-up-file" type="file" accept=".md,.markdown,.txt,.text,text/markdown,text/plain" />
        <textarea id="proto-up-text" rows="3" placeholder="或粘贴方案文本（Markdown/纯文本）…"></textarea>
        <button class="primary" id="proto-upload">上传并解析为方案草稿</button>
        <p class="hint">原件按方案类归档；草稿标「模型草稿」，须人工编辑确认。AI 未配置时只归档，可稍后解析。</p>
        ${protos.length ? `<div class="hint">已归档方案原件（${protos.length}）：</div>${protos.map((a) => `<div class="row protoasset" data-aid="${a.id}"><span class="hint">${esc(a.name)} · ${a.bytes}B</span><button class="protoasset-parse">解析为草稿</button></div>`).join("")}` : ""}
      </details>
      <details class="mini"><summary>② 从论文重构（非作者原始）</summary>
        ${paperAtts.length ? `<select id="parse-asset">${paperAtts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
        <button id="proto-parse">重构为方案草稿</button>
        <p class="hint">重构来源仅限论文附件；草稿标「重构」并固定来源原件，不是作者原始方案。</p>` : `<p class="hint">先在「文献整理」为论文条目导入正文/方法附件。</p>`}
      </details>
      <details class="mini"><summary>③ 手动新建</summary>
        <input id="proto-name" placeholder="方案名称" />
        <select id="proto-src"><option value="user">用户编写</option><option value="reconstructed">公开材料重构（须标来源）</option></select>
        <input id="proto-purpose" placeholder="目的" />
        <textarea id="proto-steps" rows="4" placeholder="每行一步：操作 | 时长分钟 | 支路名 | est&#10;例：配缓冲液 | 10 | |&#10;孵育 | 30 | | est&#10;对照 | 60 | 对照支路 |"></textarea>
        <input id="proto-criteria" placeholder="完成判据" />
        <input id="proto-frag" placeholder="来源片段（重构时必填，逗号分隔）" />
        <button class="primary" id="proto-create">创建方案</button>
      </details>
    </details>`;
  $("#proto-upload").addEventListener("click", (ev) => runJob(ev.target, "上传并解析方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const file = $("#proto-up-file").files?.[0];
    let text = $("#proto-up-text").value, name = $("#proto-up-name").value;
    if (file) { text = await readTextFile(file); if (!name) name = file.name; }
    let assetId;
    try {
      const up = await api.uploadProtocolSource(name, text, ui.topicId);
      assetId = up.assetId;
    } catch (e) {
      if (e.status === 409 && e.details?.existingAssetId) { assetId = e.details.existingAssetId; setStatus("原件已归档：定位已有原件，继续解析"); }
      else throw e;
    }
    $("#proto-up-text").value = ""; if ($("#proto-up-file")) $("#proto-up-file").value = "";
    let r;
    try { r = await api.parseProtocol(assetId, ui.topicId); }
    catch (e) {
      if (e.status === 422) { await refresh(); setStatus(`原件已归档。${e.message}`); return; }
      throw e;
    }
    const res = await pollJob(r.jobId, "方案解析");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refreshAfterJob();
    setStatus("方案草稿已生成（模型草稿，须人工确认）");
  }));
  $$(".protoasset-parse").forEach((b) => b.addEventListener("click", (ev) => runJob(ev.target, "AI 解析方案", async () => {
    const aid = b.closest(".protoasset").dataset.aid;
    const r = await api.parseProtocol(aid, ui.topicId);
    const res = await pollJob(r.jobId, "方案解析");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refreshAfterJob();
    setStatus("方案草稿已生成（模型草稿，须人工确认）");
  })));
  $("#proto-create").addEventListener("click", (ev) => runBusy(ev.target, "创建方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const sourceKind = $("#proto-src").value;
    await api.createProtocol({
      topicId: ui.topicId, name: $("#proto-name").value, sourceKind,
      purpose: $("#proto-purpose").value, criteria: $("#proto-criteria").value,
      steps: parseStepsText($("#proto-steps").value),
      sourceFragments: splitList($("#proto-frag").value),
    });
    await refresh(); setStatus("方案已创建（r1）");
  }));
  const parseBtn = $("#proto-parse");
  if (parseBtn) parseBtn.addEventListener("click", (ev) => runJob(ev.target, "AI 重构方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const r = await api.parseProtocol($("#parse-asset").value, ui.topicId, undefined, "reconstructed");
    const res = await pollJob(r.jobId, "方案重构");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refreshAfterJob();
    setStatus("重构草稿已生成（重构：非作者原始方案，须人工确认）");
  }));
}

function renderRecordImport(box) {
  const ps = state.protocols.filter((p) => !ui.topicId || p.topicId === ui.topicId);
  const tmpls = state.templates.filter((t) => t.humanConfirmed);
  box.innerHTML = `
    <details class="mini" ${state.executions.length ? "" : "open"}>
      <summary>创建执行（进准备稿）</summary>
      ${ps.length ? `<select id="exec-proto">${ps.map((p) => `<option value="${p.id}">${esc(p.name)}（${fmtVersion(p.revision)}）</option>`).join("")}</select>
      <select id="exec-tmpl"><option value="">不用模板</option>${tmpls.map((t) => `<option value="${t.id}">模板 ${fmtVersion(t.protocolRevision)} · ${t.fields.length} 字段</option>`).join("")}</select>
      <button class="primary" id="exec-start">创建执行</button>
      <p class="hint">创建后进入准备稿：可登记本次差异，确认快照后才开始补记录；实际开始另行记录。之后方案修订不影响本执行。</p>` : `<p class="hint">先在「方案与图」创建方案。</p>`}
    </details>`;
  const btn = $("#exec-start");
  if (btn) btn.addEventListener("click", (ev) => runBusy(ev.target, "创建执行", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const r = await api.startExecution({ topicId: ui.topicId, protocolId: $("#exec-proto").value, templateId: $("#exec-tmpl").value || undefined });
    ui.executionId = r.executionId; ui.assetId = null; ui.prepExtra = 0; await refresh(); setStatus("执行已创建：进入准备稿（尚未开始实验）");
  }));
}

/** 实验图：横向时间泳道——主线一条泳道，支路在分叉/汇合锚点间平行展开；
 * 未知时长不按零累计（其后 t≥ 下界）；无锚点明示不猜；点击节点 → 下方固定编辑器。 */
function diagramHtml(p, snap) {
  const L = computeLanes(snap.steps);
  const node = (s, offset, approx) => {
    const src = durationSourceOf(s);
    const bar = src === "unknown"
      ? `<span class="dbar unknown" title="时长未知（不按 0）">时长未知</span>`
      : `<span class="dbar ${src === "estimated" ? "est" : src === "computed" ? "computed" : "fixed"}" title="${src === "computed" ? "由量·速率计算" : src === "estimated" ? "估计" : "方案规定"}">${s.durationMin}min${src === "estimated" ? "·估" : src === "computed" ? "·算" : ""}</span>`;
    const op = s.op.length > 16 ? `${s.op.slice(0, 16)}…` : s.op;
    return `<div class="dnode ${ui.stepSel === s.id ? "sel" : ""}" data-step="${s.id}" title="${esc(s.op)}">
      <div class="dop">${esc(op)}</div>
      <div class="dmeta">${offset !== null ? `<span class="dtime">${timeLabel(offset, approx)}</span>` : ""}${bar}${s.slackMin ? `<span class="hint">余量:${s.slackMin}min</span>` : ""}${s.observeEnd ? `<span class="hint">终点:${esc(s.observeEnd)}</span>` : ""}</div>
    </div>`;
  };
  // B3：时间等比——列宽按主线各步分钟数；未知/0 用最短基准（≥1）
  const weightOf = (m) => Math.max(1, m.step.durationMin ?? 1);
  const colTemplate = L.main.map((m) => `minmax(96px,${weightOf(m)}fr)`).join(" ");
  let html = `<div class="diagram" style="grid-template-columns:${colTemplate}">`;
  L.main.forEach((m, i) => {
    html += `<div class="dcell" style="grid-column:${i + 1};grid-row:1">${node(m.step, m.offset, m.approx)}${i < L.main.length - 1 ? `<span class="darrow-h">→</span>` : ""}</div>`;
  });
  L.lanes.forEach((lane, li) => {
    const forkOp = lane.forkIdx !== null ? L.main[lane.forkIdx].step.op : null;
    const mergeOp = lane.mergeIdx !== null ? L.main[lane.mergeIdx].step.op : null;
    const anchorText = lane.anchored
      ? `分叉自「${esc(forkOp)}」之后 · 汇合入「${esc(mergeOp)}」之前`
      : `<span class="badge warn">锚点未指定（横跨全程，不猜）</span>`;
    html += `<div class="dlane ${lane.anchored ? "" : "unanchored"}" style="grid-column:${lane.start + 1}/${lane.end + 2};grid-row:${li + 2}">
      <div class="dlane-title">支路 · ${esc(lane.name)} · ${anchorText}</div>
      <div class="dlane-nodes">${lane.steps.map((s) => node(s, null, false)).join(`<span class="darrow-h">→</span>`)}</div>
    </div>`;
  });
  const estCount = snap.steps.filter((s) => durationSourceOf(s) === "estimated").length;
  const compCount = snap.steps.filter((s) => durationSourceOf(s) === "computed").length;
  const unkCount = snap.steps.filter((s) => durationSourceOf(s) === "unknown").length;
  html += `</div><p class="hint">横轴：时间（等比，按各步分钟数；未知/未计时按最短基准）；纵轴：线程／泳道。虚线＝估计或时长未知${unkCount ? `（未知 ${unkCount} 步不按 0，其后为下界）` : ""}${estCount ? `（估计 ${estCount} 步）` : ""}；·算＝由量·速率计算${compCount ? `（${compCount} 步）` : ""}；已知主线 ${L.totalKnown}min。</p>`;
  return html;
}

/** 触发浏览器下载（Blob/字符串）。 */
function downloadBlob(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

/** 取当前应用样式表文本，用于自包含导出（离线保真；失败则退化为仅结构）。 */
async function appCss() { try { return await (await fetch("/styles.css")).text(); } catch { return ""; } }

/** archify E：导出实验图为自包含 HTML（内联 CSS + 图结构，离线可看）。 */
async function exportDiagramHtml(p, snap) {
  const el = document.querySelector(".diagram");
  if (!el) { setStatus("未找到实验图"); return; }
  const css = await appCss();
  const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>${esc(p.name)} · 实验图</title><style>${css}</style></head>
<body style="padding:16px;background:#f7f7f5">
<h1 style="font:600 18px/1.4 system-ui,'Microsoft YaHei',sans-serif">${esc(p.name)} · 实验图（${fmtVersion(snap.revision)}）</h1>
<p style="color:#525862;font-size:13px">离线快照 · 由 LOCUS 导出 · ${fmtTime(snap.at)}</p>
${el.outerHTML}
</body></html>`;
  downloadBlob(`${p.name}_实验图_${fmtVersion(snap.revision)}.html`, doc, "text/html;charset=utf-8");
  setStatus("实验图已导出为 HTML（离线可看）");
}

/** archify E：导出实验图为 PNG（SVG foreignObject → canvas 栅格化，2× 缩放；无第三方库）。 */
async function exportDiagramPng(p, snap) {
  const el = document.querySelector(".diagram");
  if (!el) { setStatus("未找到实验图"); return; }
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(rect.width)), h = Math.max(1, Math.ceil(rect.height));
  const css = await appCss();
  const inner = new XMLSerializer().serializeToString(el);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="background:#f7f7f5"><style>${css}</style>${inner}</div></foreignObject></svg>`;
  const img = new Image();
  img.onload = () => {
    try {
      const scale = 2;
      const c = document.createElement("canvas"); c.width = w * scale; c.height = h * scale;
      const ctx = c.getContext("2d"); ctx.scale(scale, scale); ctx.fillStyle = "#f7f7f5"; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);
      c.toBlob((b) => { if (b) { downloadBlob(`${p.name}_实验图_${fmtVersion(snap.revision)}.png`, b, "image/png"); setStatus("实验图已导出为 PNG"); } else setStatus("PNG 生成失败，可改用「导出图 HTML」"); }, "image/png");
    } catch { setStatus("PNG 生成失败（浏览器限制），可改用「导出图 HTML」"); }
  };
  img.onerror = () => setStatus("PNG 导出失败（浏览器不支持），可改用「导出图 HTML」");
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function stepEditorHtml(p, snap) {
  const s = ui.stepSel === "new" ? { id: "", op: "", params: {}, note: "", durationMin: null, estimated: false, durationSource: "unknown", amount: null, ratePerMin: null, slackMin: null, branch: null, observeEnd: "" } : snap.steps.find((x) => x.id === ui.stepSel);
  if (!s) return `<div class="stepeditor"><p class="hint">点击图中节点编辑步骤；保存将追加方案新快照（旧版本不动）。</p>
    <div class="row"><input id="newstep-op" placeholder="新步骤操作名" /><button id="step-add">添加步骤</button><button disabled title="占位：AI 重排未接入">AI 重排（未实现）</button></div></div>`;
  const paramsText = Object.entries(s.params).map(([k, v]) => `${k}=${v}`).join("\n");
  const mainOpts = (cur) => snap.steps.filter((x) => !x.branch).map((x) => `<option value="${x.id}" ${x.id === cur ? "selected" : ""}>${esc(x.op)}</option>`).join("");
  const src = durationSourceOf(s);
  const srcOpt = (v, l) => `<option value="${v}" ${src === v ? "selected" : ""}>${l}</option>`;
  return `<div class="stepeditor">
    <div class="meta">${ui.stepSel === "new" ? "新步骤" : `编辑步骤 · ${esc(s.op)}`}（保存 → 方案第${p.revision + 1}版）</div>
    <div class="row"><label>操作</label><input id="se-op" value="${esc(s.op)}" /></div>
    <div class="row"><label>时长来源</label>
      <select id="se-dursrc">${srcOpt("fixed", "规定")}${srcOpt("computed", "由量·速率计算")}${srcOpt("estimated", "估计")}${srcOpt("unknown", "未知")}</select>
      <span class="dur-fixed" ${src === "computed" || src === "unknown" ? "hidden" : ""}><label>时长(分)</label><input id="se-dur" type="number" min="0" value="${s.durationMin ?? ""}" placeholder="空=未知" /></span>
      <span class="dur-comp" ${src === "computed" ? "" : "hidden"}><label>用量</label><input id="se-amount" type="number" min="0" value="${s.amount ?? ""}" placeholder="用量" />
        <label>速率(量/分)</label><input id="se-rate" type="number" min="0" value="${s.ratePerMin ?? ""}" placeholder="量/分钟" />
        <span class="hint">时长＝用量÷速率</span></span>
      <label>等待余量(分)</label><input id="se-slack" type="number" min="0" value="${s.slackMin ?? ""}" placeholder="余量，吸收延迟" />
      <label>支路</label><input id="se-branch" value="${esc(s.branch ?? "")}" placeholder="空=主线" /></div>
    <div class="row"><label>分叉自</label><select id="se-fork"><option value="">（未指定）</option>${mainOpts(s.branchFrom)}</select>
      <label>汇合入</label><select id="se-merge"><option value="">（未指定）</option>${mainOpts(s.mergeInto)}</select>
      <span class="hint">支路锚点：仅支路步骤生效；未指定则图中明示不猜</span></div>
    <div class="row"><label>观察终点</label><input id="se-end" value="${esc(s.observeEnd)}" /></div>
    <textarea id="se-params" rows="2" placeholder="参数，每行 键=值">${esc(paramsText)}</textarea>
    <div class="row"><label>备注</label><input id="se-note" value="${esc(s.note)}" /></div>
    <div class="row"><input id="se-reason" placeholder="修改原因（必填）" /><button class="primary" id="step-save">保存步骤</button><button id="step-cancel">取消</button><button disabled title="占位：AI 重排未接入">AI 重排（未实现）</button></div>
  </div>`;
}

/** 影响分析面板：确定性传播与 AI 语义评估分栏；失败/未配置/stale 明示，不暗示无影响。 */
function impactHtml(entityIds) {
  const imps = state.impacts
    .filter((i) => entityIds.includes(i.change.entityId) && (!ui.topicId || i.topicId === ui.topicId))
    .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!imps.length) return `<div class="item impactpanel"><div class="meta">AI 影响分析</div><p class="hint">保存方案/记录/样品/测量修改后，这里自动登记影响分析。</p></div>`;
  const STATUS = { pending: "待评估", running: "评估中", completed: "已完成", failed: "评估失败", stale: "已过时" };
  const ASSESS = { impact: "有影响", no_supported_impact_found: "未发现支持的影响", needs_review: "需人工复核" };
  return `<div class="item impactpanel"><div class="meta">AI 影响分析（${imps.length}）<span class="hint">确定性时间传播独立计算；AI 只做语义评估</span></div>
    ${imps.map((i) => {
      const disp = i.status === "failed" ? "failed" : i.status === "stale" ? (i.assessment === "no_supported_impact_found" ? "needs_review" : i.assessment ?? "not_analyzed") : i.status === "completed" ? i.assessment : "not_analyzed";
      const dispLabel = disp === "failed" ? "评估失败（≠无影响）" : disp === "not_analyzed" ? "未分析/进行中" : disp === "needs_review" ? "需人工复核" : ASSESS[disp];
      return `<details class="mini imp" ${i === imps[0] ? "open" : ""}>
        <summary><span class="badge ${i.status === "failed" ? "exclude" : i.status === "stale" ? "warn" : i.status === "completed" ? "confirm" : "cand-pending"}">${STATUS[i.status]}</span>
          ${esc(i.change.summary)} <span class="hint">${esc(fmtTime(i.createdAt))}</span></summary>
        <div class="hint">结论口径：<strong>${esc(dispLabel)}</strong>${i.status === "stale" ? "（旧结论仅供历史查看，已有更新改动）" : ""}</div>
        ${i.error ? `<details class="mini"><summary>错误详情（折叠）</summary><pre class="perr-detail-body">${esc(i.error)}</pre></details>` : ""}
        ${i.deterministic.timeShifts.length ? `<div class="hint">确定性时间传播：${esc(i.deterministic.note)}</div>
          <table class="grid"><thead><tr><th>步骤</th><th>平移(min)</th><th>主线总时长(min)</th></tr></thead><tbody>
          ${i.deterministic.timeShifts.map((s) => `<tr><td>${esc(s.op)}</td><td>${s.deltaMin > 0 ? "+" : ""}${s.deltaMin}</td><td>${s.newTotalMin}</td></tr>`).join("")}</tbody></table>`
          : `<div class="hint">${esc(i.deterministic.note)}</div>`}
        ${i.summary ? `<div>${esc(i.summary)}</div>` : ""}
        ${i.items.length ? `<div class="hint">逐条（${i.items.length}）：</div>${i.items.map((it) => `<div class="impitem">
          <span class="badge secondary">${esc(fmtEnum(it.category))}</span> <strong>${esc(it.finding)}</strong>
          <div class="hint">对象：${esc(fmtKind(it.targetKind))} ${esc(it.targetId)}${it.targetRevision ? ` ${fmtVersion(it.targetRevision)}` : ""} · 理由：${esc(it.reason)}</div>
          ${it.evidenceRefs.length ? `<div class="hint">证据：${it.evidenceRefs.map(esc).join("、")}</div>` : ""}
          ${it.unknowns.length ? `<div class="hint warn">未知：${it.unknowns.map(esc).join("、")}</div>` : ""}
          ${it.suggestedAction ? `<div class="hint">建议：${esc(it.suggestedAction)}</div>` : ""}
        </div>`).join("")}` : ""}
        ${(i.status === "pending" || i.status === "failed") ? `<div class="row"><button class="imp-run" data-id="${i.id}">运行 AI 语义评估</button></div>` : ""}
      </details>`;
    }).join("")}
  </div>`;
}

function protocolMainHtml() {
  const p = currentProtocol();
  if (!p) return `<p class="hint">在左栏选择方案，或用中间「＋新建方案」创建。图中节点可点击编辑；保存追加新快照，旧版本与已固定的执行/模板不受影响。</p>`;
  const snap = viewSnapshot(p);
  const viewingOld = snap.revision !== p.revision;
  return `
    <div class="item" data-id="${p.id}">
      <div class="meta">${esc(p.name)} · 来源 ${fmtEnum(p.sourceKind)}</div>
      <div class="row"><label>查看版本</label>
        <select id="proto-rev">${p.revisions.map((r) => `<option value="${r.revision}" ${r.revision === snap.revision ? "selected" : ""}>${fmtVersion(r.revision)} · ${esc(r.reason)}</option>`).join("")}</select>
        <button id="proto-export">导出 JSON</button>
        <button id="diagram-html">导出图 HTML</button>
        <button id="diagram-png">导出图 PNG</button>
        <button class="history-btn">快照历史(${p.revisions.length})</button></div>
      ${viewingOld ? `<p class="hint warn">正在查看旧快照 ${fmtVersion(snap.revision)}（只读）；编辑将基于最新 ${fmtVersion(p.revision)} 追加。</p>` : ""}
      ${diagramHtml(p, snap)}
      ${!viewingOld ? stepEditorHtml(p, snap) : ""}
    </div>
    ${impactHtml([p.id])}`;
}

function protocolSideHtml() {
  const p = currentProtocol();
  if (!p) return `<p class="hint">选择方案后显示元信息、来源原件与记录模板。</p>`;
  const snap = viewSnapshot(p);
  const viewingOld = snap.revision !== p.revision;
  const tmpls = state.templates.filter((t) => t.protocolId === p.id);
  const src = p.sourceAssetId ? state.assets.find((a) => a.id === p.sourceAssetId) : null;
  return `
    <div class="item">${!viewingOld ? `<details class="mini" open><summary>方案元信息</summary>
      <div class="row"><label>目的</label><input data-field="purpose" value="${esc(snap.purpose)}" /></div>
      <div class="row"><label>判据</label><input data-field="criteria" value="${esc(snap.criteria)}" /></div>
      <div class="row"><label>条件</label><input data-field="conditions" value="${esc(snap.conditions.join(","))}" /></div>
      <div class="row"><label>未知项</label><input data-field="unknowns" value="${esc(snap.unknowns.join(","))}" /></div>
      <div class="row"><input data-field="reason" placeholder="修改原因（必填）" /><button class="primary" id="proto-save">保存元信息</button></div></details>`
      : `<p class="hint">正在查看旧快照（只读）。</p>`}</div>
    ${src ? `<details class="mini"><summary>来源原件 · ${esc(src.name)}</summary><pre class="srcpre">${esc(src.text)}</pre></details>` : ""}
    <div class="item"><div class="meta">记录模板（${tmpls.length}）</div>
      ${tmpls.map((t) => `<div class="row tmpl" data-id="${t.id}">
        <span class="badge ${t.humanConfirmed ? "confirm" : "cand-pending"}">${t.humanConfirmed ? "已确认" : "待确认"}</span>
        ${t.aiDraft ? `<span class="badge ai">AI 草稿</span>` : ""}
        <span class="hint">固定 ${fmtVersion(t.protocolRevision)}${t.protocolRevision !== p.revision ? `（方案已变 → 当前 ${fmtVersion(p.revision)}，复用前须比较）` : ""} · ${t.fields.length} 字段</span>
        ${!t.humanConfirmed ? `<button class="tmpl-confirm">人工确认</button>` : `<button class="tmpl-use">用于执行</button>`}
      </div>`).join("") || `<p class="hint">暂无模板。</p>`}
      <div class="row"><label><input type="checkbox" id="tmpl-ai" /> AI 草稿</label><button id="tmpl-create">生成模板（固定 ${fmtVersion(p.revision)}）</button></div>
    </div>`;
}

/** 5D 准备稿：基础快照图＋本次差异编辑（固定底部编辑区）；确认前可反复改，确认后冻结。 */
/** 步骤记录表（B4）：左＝计划（来自本次快照，不改源方案）；右＝实际（用量/时长/意外影响到哪一环节）。 */
function stepsTableHtml(e, snap) {
  const steps = snap?.steps ?? [];
  if (!steps.length) return `<p class="hint">本次快照无步骤（方案可能缺失）。</p>`;
  const lastStepEv = (sid) => { const evs = e.events.filter((ev) => ev.kind === "step" && ev.stepId === sid); return evs[evs.length - 1]; };
  const hasDev = (sid) => e.events.some((ev) => ev.kind === "deviation" && ev.stepId === sid);
  const rows = steps.map((s) => {
    const last = lastStepEv(s.id);
    const plan = s.durationMin === null ? `<span class="dbar unknown">时长未知</span>` : `<span class="dbar ${s.estimated ? "est" : "fixed"}">${s.durationMin}min${s.estimated ? "·估" : ""}</span>`;
    const others = steps.filter((x) => x.id !== s.id);
    const dev = hasDev(s.id);
    return `<tr data-step="${s.id}" data-op="${esc(s.op)}">
      <td>${esc(s.op)}${s.branch ? ` <span class="hint">支路:${esc(s.branch)}</span>` : ""}</td>
      <td>${plan}</td>
      <td><input data-f="amount" value="${esc(last?.actual.amount ?? "")}" placeholder="用量" /></td>
      <td><input data-f="dur" type="number" min="0" value="${last?.actual.durationMin ?? ""}" placeholder="分" /></td>
      <td><label class="hint"><input type="checkbox" data-f="incident" ${dev ? "checked" : ""}/> 意外</label>
        <div class="devtargets">${others.map((x) => `<label class="hint"><input type="checkbox" data-f="target" value="${x.id}" data-op="${esc(x.op)}"/> 影响:${esc(x.op)}</label>`).join("") || `<span class="hint">（无其它步骤）</span>`}</div></td>
      <td><button class="steptbl-save">${last ? "更新" : "记录"}</button>${dev ? ` <span class="hint warn">已标意外</span>` : ""}</td>
    </tr>`;
  }).join("");
  return `<div class="tablewrap"><table class="grid steptbl"><thead><tr><th>步骤（计划）</th><th>计划时长</th><th>实际用量</th><th>实际时长</th><th>意外/影响</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">左＝计划（本次快照，不改源方案）；右＝实际，逐行记录。实际开始/暂停/备注见下方「事件时间线」。</p>`;
}

function preparationHtml(e, p, baseSnap) {
  const adj = e.preparation?.adjustments ?? [];
  const FIELDS = [["op", "操作"], ["durationMin", "时长(分)"], ["estimated", "估计(true/false)"], ["params", "参数(JSON)"], ["note", "备注"], ["observeEnd", "观察终点"], ["branch", "支路"]];
  const stepOpts = (cur) => (baseSnap?.steps ?? []).map((s) => `<option value="${s.id}" ${s.id === cur ? "selected" : ""}>${esc(s.op)}</option>`).join("");
  const fieldOpts = (cur) => FIELDS.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("");
  const rowHtml = (a) => `<div class="preprow celledit">
    <div class="row"><select data-pf="stepId">${stepOpts(a?.stepId)}</select><select data-pf="field">${fieldOpts(a?.field ?? "durationMin")}</select>
      <input data-pf="after" placeholder="调整后值（时长可填 null=未知）" value="${esc(a?.after ?? "")}" />
      <button class="prep-del">删除</button></div>
    <div class="hint">调整前：${a ? esc(a.before) : "（保存时自动取基础快照值）"}</div>
    <div class="row"><input data-pf="reason" placeholder="本次差异原因（必填）" value="${esc(a?.reason ?? "")}" /></div>
  </div>`;
  return `
    <div class="item" data-id="${e.id}">
      <div class="meta">${esc(p?.name ?? e.protocolId)}${missingTag(state, "protocol", e.protocolId) ? ` <span class="badge warn">方案缺失</span>` : ""} · 准备稿 · 基础 ${fmtVersion(e.preparation?.baseRevision ?? e.protocolRevision)}${verMissing(p, e.preparation?.baseRevision ?? e.protocolRevision) ? ` <span class="badge warn">缺失版本</span>` : ""} · <span class="badge cand-pending">未确认</span></div>
      <p class="hint">准备≠已做实验：这里登记本次差异；确认快照后进入记录状态，实际开始另行记录。源方案不被改动。</p>
      ${baseSnap ? diagramHtml(p, baseSnap) : `<p class="hint warn">基础方案快照缺失。</p>`}
      <div class="pane-title">本次差异（${adj.length}）</div>
      ${adj.map((a) => rowHtml(a)).join("")}
      ${Array.from({ length: ui.prepExtra }, () => rowHtml(null)).join("")}
      <textarea id="prep-notes" rows="2" placeholder="准备备注（如室温/试剂批次）">${esc(e.preparation?.notes ?? "")}</textarea>
      <div class="row"><button id="prep-add">＋添加差异</button><button id="prep-save">保存准备稿</button><button class="primary" id="prep-confirm">确认本次执行快照</button></div>
      <p class="hint">确认＝把「基础快照＋差异」冻结为本次执行的独立快照；有时长差异时自动登记确定性时间传播。确认前草稿不算数。</p>
    </div>`;
}

function recordHtml() {
  const a = currentAsset();
  if (a && a.kind === "image") return ocrHtml(a);
  const e = currentExecution();
  if (!e) return `<p class="hint">在左栏选择执行；或选择手写图片进行 OCR。</p>`;
  const p = state.protocols.find((x) => x.id === e.protocolId);
  const baseSnap = p?.revisions.find((r) => r.revision === (e.preparation?.baseRevision ?? e.protocolRevision));
  if ((e.phase ?? "recording") === "preparing") return preparationHtml(e, p, baseSnap) + impactHtml([e.id]);
  const snap = e.preparation?.snapshot ?? baseSnap;
  const samples = state.samples.filter((s) => s.topicId === e.topicId);
  const meas = state.measurements.filter((m) => m.topicId === e.topicId);
  const KIND = { start: "开始", step: "步骤", pause: "暂停", resume: "恢复", note: "备注", deviation: "偏差" };
  const suggest = ui.pauseSuggest;
  const nAdj = e.preparation?.adjustments.length ?? 0;
  const coveredIds = new Set(e.events.filter((ev) => ev.kind === "step").map((ev) => ev.stepId));
  const missing = (snap?.steps ?? []).filter((s) => !coveredIds.has(s.id));
  const unknownDur = (snap?.steps ?? []).filter((s) => s.durationMin === null).length;
  const hasStart = e.events.some((ev) => ev.kind === "start");
  return `
    <div class="item" data-id="${e.id}">
      <div class="meta">${esc(p?.name ?? e.protocolId)}${missingTag(state, "protocol", e.protocolId) ? ` <span class="badge warn">方案缺失</span>（来源不可溯）` : ""} · 固定 ${fmtVersion(e.protocolRevision)}${verMissing(p, e.protocolRevision) ? ` <span class="badge warn">缺失版本</span>（方案无此版）` : ""}${nAdj ? ` ＋ 本次差异 ${nAdj} 条` : ""} · <span class="badge ${e.status === "paused" ? "warn" : e.status === "active" ? "confirm" : ""}">${fmtEnum(e.status)}</span>${e.templateId ? " · 模板" : ""}</div>
      ${e.origin === "reconstructed" ? `<div class="hint"><span class="badge warn">文献重构</span> 本执行为历史文献重构（非本地实际实验）：事件与数值均为原文陈述的补记，来源原件 ${esc(state.assets.find((a) => a.id === e.sourceAssetId)?.name ?? e.sourceAssetId ?? "未标")}。</div>` : ""}
      ${e.preparation?.confirmedAt ? `<div class="hint">本次快照确认于 ${esc(fmtTime(e.preparation.confirmedAt))}（基础 ${fmtVersion(e.preparation.baseRevision)}${nAdj ? ` ＋ ${nAdj} 条差异` : "，无差异"}）；源方案后续不影响本次。</div>` : ""}
      <div class="hint">数据完整度：步骤记录 ${(snap?.steps.length ?? 0) - missing.length}/${snap?.steps.length ?? 0}${missing.length ? ` · 未记录：${missing.map((s) => esc(s.op)).join("、")}` : ""}${unknownDur ? ` · ${unknownDur} 步时长未知（不按 0 计）` : ""}</div>
      ${e.status === "active" && !hasStart ? `<div class="row"><button class="primary" id="exec-begin">记录实际开始</button><span class="hint">由人记录，系统不代填。</span></div>` : ""}
      ${e.preparation?.snapshot ? `<details class="mini"><summary>另存新方案（不改源）</summary>
        <div class="row"><input id="saveas-name" placeholder="新方案名称" /><button id="exec-saveas">另存为新方案 r1</button></div>
        <p class="hint">把本次确认快照存为新方案；不默认改动全局源方案。</p></details>` : ""}
      ${e.status === "active" ? `<div class="row"><input id="pause-reason" placeholder="暂停原因（必填）" />
        <button id="exec-assist">AI 暂停建议</button><button class="primary" id="exec-pause">暂停</button><button id="exec-done">结束执行</button></div>
        ${suggest ? `<div class="hint">AI 建议（仅建议，采纳由人决定）：风险[${suggest.risks.map(esc).join("、") || "—"}] 恢复检查[${suggest.resumeChecks.map(esc).join("、") || "—"}]${suggest.unknowns.length ? ` 未知[${suggest.unknowns.map(esc).join("、")}]` : ""}</div>` : ""}` : ""}
      ${e.status === "paused" && e.pausedState ? `<div class="celledit">
        <div class="hint">暂停于 ${esc(e.pausedState.at)} · 原因：${esc(e.pausedState.reason)}${e.pausedState.aiSuggested ? "（含 AI 建议）" : ""}</div>
        <div class="hint">风险：${e.pausedState.risks.map(esc).join("、") || "—"} · 恢复检查：${e.pausedState.resumeChecks.map(esc).join("、") || "—"}</div>
        <div class="row"><input id="resume-decision" placeholder="人的恢复决定（必填）" /><button class="primary" id="exec-resume">恢复执行</button></div>
      </div>` : ""}
    </div>
    <div class="item">
      <details class="mini"><summary>事件时间线（${e.events.length}，默认折叠）</summary>
      ${e.events.map((ev) => ui.editEventId === ev.id ? `<div class="celledit" data-evid="${ev.id}">
          <div class="row"><label>内容</label><input data-field="evText" value="${esc(ev.text)}" /></div>
          <div class="row"><label>实际用量</label><input data-field="evAmount" value="${esc(ev.actual.amount ?? "")}" />
            <label>实际时长</label><input data-field="evDur" type="number" min="0" value="${ev.actual.durationMin ?? ""}" /></div>
          <div class="row"><input data-field="evReason" placeholder="修改原因（必填）" /><button class="primary ev-save">保存</button><button class="ev-cancel">取消</button></div>
        </div>` : `<div class="evrow" data-evid="${ev.id}">
          <span class="badge ${ev.kind === "deviation" ? "exclude" : ev.kind === "pause" ? "warn" : ""}">${KIND[ev.kind]}</span>
          <span class="hint">${esc(fmtTime(ev.at))}${ev.backfilled ? " · 后补" : ""}</span>
          <span>${esc(ev.text)}</span>
          ${ev.actual.amount ? `<span class="hint">用量 ${esc(ev.actual.amount)}</span>` : ""}
          ${ev.actual.durationMin !== undefined ? `<span class="hint">实际 ${ev.actual.durationMin}min</span>` : ""}
          ${ev.kind === "step" || ev.kind === "note" || ev.kind === "deviation" ? `<button class="ev-edit">编辑(${ev.history.length})</button>` : ""}
        </div>`).join("") || `<p class="hint">暂无事件。</p>`}
      <details class="mini"><summary>追加事件</summary>
        <div class="row"><select id="ev-kind"><option value="step">步骤</option><option value="note">备注</option><option value="deviation">偏差</option></select>
          <select id="ev-step">${(snap?.steps ?? []).map((s) => `<option value="${s.id}">${esc(s.op)}</option>`).join("")}</select></div>
        <div class="row"><input id="ev-text" placeholder="内容（备注/偏差必填）" /></div>
        <div class="row"><input id="ev-amount" placeholder="实际用量" /><input id="ev-dur" type="number" min="0" placeholder="实际时长(分)" />
          <label><input type="checkbox" id="ev-backfill" /> 后补</label><button class="primary" id="ev-add">追加</button></div>
      </details>
      </details>
    </div>
    <div class="item"><div class="meta">样品与测量（本课题）</div>
      ${samples.map((s) => {
        const last = s.states[s.states.length - 1];
        const mOfS = meas.filter((m) => m.sampleId === s.id);
        return `<div class="smprow" data-id="${s.id}">
          <div class="row"><input class="smp-name" value="${esc(s.displayName)}" placeholder="名称" />
            ${s.shortName !== s.displayName ? `<span class="hint">编号 ${esc(s.shortName)}</span>` : ""}
            <button class="smp-rename">改名</button></div>
          <div class="hint">总量：${esc(last?.amount.value ?? "—")} ${esc(last?.amount.unit ?? "")}${last?.amount.estimated ? "（估计）" : ""} · 拆分：${s.states.length} 个状态${last?.handling ? ` · 处理：${esc(last.handling)}` : ""}${last?.use ? ` · 用途：${esc(last.use)}` : ""}${s.origin === "reconstructed" ? ` · <span class="badge warn">文献重构</span>（非本地样品）` : ""}</div>
          <div class="hint">测量结果：${mOfS.length ? mOfS.map((m) => `${esc(m.value)}${esc(m.unit)}`).join("、") : "（无）"}</div>
        </div>`;
      }).join("") || `<p class="hint">暂无样品（左栏新建）。</p>`}
      <details class="mini"><summary>新增测量（固定样品状态版本）</summary>
        ${samples.length ? `<div class="row"><select id="meas-sample">${samples.map((s) => `<option value="${s.id}">${esc(s.shortName)} ${esc(s.displayName)}</option>`).join("")}</select>
          <select id="meas-srev">${samples[0].states.map((st) => `<option value="${st.revision}">状态 ${fmtVersion(st.revision)}</option>`).join("")}</select></div>
        <div class="row"><input id="meas-value" placeholder="测量值（必填）" /><input id="meas-unit" placeholder="单位" /></div>
        <div class="row"><input id="meas-method" placeholder="方法" /><input id="meas-instr" placeholder="仪器" /></div>
        <div class="row"><input id="meas-note" placeholder="备注" /><button class="primary" id="meas-add">记录测量</button></div>` : `<p class="hint">先建样品。</p>`}
      </details>
      ${meas.map((m) => `<div class="item meas" data-id="${m.id}">
        <div class="meta">${esc(state.samples.find((s) => s.id === m.sampleId)?.shortName ?? m.sampleId)}${missingTag(state, "sample", m.sampleId) ? ` <span class="badge warn">样品缺失</span>（来源不可溯）` : ""} · 样品状态 ${fmtVersion(m.sampleStateRevision)}${m.cellRef ? ` · 回链表 行${m.cellRef.row}列${m.cellRef.col}` : ""}${reconTag(state, "measurement", m.id) ? ` · <span class="badge warn">文献重构</span>（数值为原文陈述，非本地测量）` : ""}</div>
        <div class="row"><input data-field="mValue" value="${esc(m.value)}" /><input data-field="mUnit" value="${esc(m.unit)}" />
          <input data-field="mMethod" value="${esc(m.method)}" /><input data-field="mInstr" value="${esc(m.instrument)}" /></div>
        <div class="row"><input data-field="mNote" value="${esc(m.note)}" /><input data-field="mReason" placeholder="修改原因（必填）" />
          <button class="meas-save">保存</button><button class="history-btn">历史(${m.history.length})</button></div>
      </div>`).join("")}
    </div>`;
}

// ── 5E：数据处理与分析 / 上下文AI对话 ──────────────────────
function currentChat() { return state.chats.find((c) => c.id === ui.chatId) ?? null; }
const collectPicks = (cls) => [...$$(`.${cls}:checked`)].map((cb) => ({ kind: cb.dataset.kind, id: cb.dataset.id }));

function renderChatForm(box) {
  if (!ui.topicId) { box.innerHTML = `<p class="hint">先在上方选择课题，再创建对话。</p>`; return; }
  const { execs, tables, meas, protos, cards } = topicObjects(state, ui);
  const subqs = state.subquestions.filter((s) => s.topicId === ui.topicId);
  const conf = cards.filter((c) => c.audit === "confirm");
  const row = (kind, id, label) => `<label class="ctxpick"><input type="checkbox" class="ch-scope" data-kind="${kind}" data-id="${id}"/> ${esc(label)}</label>`;
  box.innerHTML = `
    <details class="mini" open>
      <summary>＋新建对话</summary>
      <select id="ch-subq"><option value="">（课题层，不挂子问题）</option>${subqs.map((s) => `<option value="${s.id}">${esc(s.question)}</option>`).join("")}</select>
      <p class="hint">默认已选（已入候选知识卡，可取消）：</p>
      ${conf.length ? conf.map((c) => `<label class="ctxpick"><input type="checkbox" class="ch-scope" data-kind="card" data-id="${c.id}" checked/> ${esc(c.scope || c.rawText.slice(0, 24))}</label>`).join("") : `<p class="hint">暂无。</p>`}
      <details class="mini"><summary>其他可选（折叠：执行/测量/表/方案/其余卡）</summary>
        ${execs.map((e) => row("execution", e.id, refLabel(state, { kind: "execution", id: e.id }))).join("")}
        ${meas.map((m) => row("measurement", m.id, refLabel(state, { kind: "measurement", id: m.id }))).join("")}
        ${tables.map((t) => row("table", t.id, refLabel(state, { kind: "table", id: t.id }))).join("")}
        ${protos.map((p) => row("protocol", p.id, refLabel(state, { kind: "protocol", id: p.id }))).join("")}
        ${cards.filter((c) => c.audit !== "confirm").map((c) => row("card", c.id, `知识卡 · ${c.scope || c.rawText.slice(0, 20)}`)).join("")}
      </details>
      <button class="primary" id="ch-create">创建会话</button>
    </details>`;
  $("#ch-create").addEventListener("click", (ev) => runBusy(ev.target, "创建会话", async () => {
    const r = await api.createChat({ topicId: ui.topicId, subquestionId: $("#ch-subq").value || undefined, scope: collectPicks("ch-scope") });
    ui.chatId = r.chatId; await refresh(); setStatus("会话已创建：在中栏开始讨论");
  }));
}

function chatHtml(c) {
  const msgs = c.messages.map((m) => {
    if (m.role === "user") return `<div class="chatmsg user"><p>${esc(m.content)}</p></div>`;
    const badge = { running: `<span class="badge warn">运行中</span>`, done: "", failed: `<span class="badge cand-pending">失败</span>`, cancelled: `<span class="badge">已取消</span>` }[m.status];
    let body;
    if (m.status === "running") body = `<p class="hint">等待 AI 返回… <button class="chat-cancel" data-mid="${m.id}">取消</button></p>`;
    else if (m.status === "failed") body = `<p class="hint">失败：${esc(m.error ?? "")} <button class="chat-retry" data-mid="${m.id}">重试</button></p>`;
    else if (m.status === "cancelled") body = `<p class="hint">已取消：返回内容被丢弃，不写入。 <button class="chat-retry" data-mid="${m.id}">重试</button></p>`;
    else body = `<p>${esc(m.content)}</p>
      ${m.sources.length ? `<details class="mini"><summary>来源（${m.sources.length}）</summary><ul>${m.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}
      ${m.snapshot ? `<details class="mini"><summary>本次冻结快照 · hash ${m.snapshot.hash.slice(0, 12)}…</summary>${snapshotHtml(m.snapshot)}</details>` : ""}`;
    return `<div class="chatmsg assistant">${badge}${body}</div>`;
  }).join("");
  const running = c.messages.some((m) => m.status === "running");
  return `<div class="chatlog">${msgs || `<p class="hint">还没有消息。输入问题开始讨论（范围与采纳见右栏）。</p>`}</div>
    <div class="row"><textarea id="chat-text" rows="2" placeholder="围绕本课题/子问题与已选对象提问…"></textarea>
    <button class="primary" id="chat-send" ${running ? "disabled" : ""}>${running ? "回答运行中…" : "发送"}</button></div>`;
}

function chatRightHtml() {
  const c = currentChat();
  if (!c) return `<p class="hint">选择会话后：这里显示范围、建议采纳与最近一次冻结快照。</p>`;
  const q = c.subquestionId ? state.subquestions.find((x) => x.id === c.subquestionId) : null;
  let h = `<p><b>范围</b>：课题「${esc(topicName(c.topicId) ?? c.topicId)}」${q ? ` → 子问题「${esc(q.question)}」` : ""}</p>
    <ul>${c.scope.map((r) => `<li>${esc(refLabel(state, r))} <span class="hint">${fmtKind(r.kind)}:${r.id}</span></li>`).join("") || `<li class="hint">未选对象（仅课题层）。</li>`}</ul>
    <p class="hint"><b>建议采纳</b>：讨论不修改对象；逐条预览＋人工确认后才写入目标。</p>`;
  const proposals = c.messages.flatMap((m) => m.proposals.map((p, i) => ({ m, p, i })));
  h += proposals.length
    ? proposals.map(({ m, p, i }) => `<div class="item"><p>${esc(p.preview)}</p>
        <p class="hint">目标：${p.targetKind === "execution-note" ? "执行备注" : "报告待验证"} · ${esc(p.targetId)}</p>
        ${p.confirmed ? `<span class="badge confirm">已采纳 ${esc(p.adoptedAt ?? "")}</span>` : `<button class="chat-adopt" data-mid="${m.id}" data-idx="${i}">确认采纳</button>`}</div>`).join("")
    : `<p class="hint">暂无建议。</p>`;
  const last = [...c.messages].reverse().find((m) => m.role === "assistant" && m.status === "done" && m.snapshot);
  if (last) h += snapshotHtml(last.snapshot);
  return h;
}

function ocrHtml(asset) {
  const ocrs = state.ocrs.filter((o) => o.assetId === asset.id);
  return `
    <div class="item" data-id="${asset.id}">
      <div class="meta">手写记录 · ${esc(asset.name)} · 原图已归档</div>
      <div class="row"><button class="primary" id="ocr-ai">AI 识别（视觉独立任务）</button><span class="hint">失败不降级为假 AI；可人工转录兜底（标 manual）。</span></div>
      <details class="mini"><summary>人工转录（兜底）</summary>
        <textarea id="ocr-raw" rows="3" placeholder="逐字转录，不清处用 ? 占位"></textarea>
        <textarea id="ocr-fields" rows="2" placeholder="字段，每行 键=值"></textarea>
        <div class="row"><input id="ocr-unknowns" placeholder="未知项（逗号分隔）" /><button id="ocr-manual-add">保存转录草稿</button></div>
      </details>
    </div>
    ${ocrs.map((o) => `<div class="item ocr" data-id="${o.id}">
      <div class="meta"><span class="badge ${o.extraction === "ai" ? "ai" : ""}">${fmtEnum(o.extraction)}</span>
        <span class="badge ${o.status === "confirmed" ? "confirm" : "cand-pending"}">${o.status === "confirmed" ? "已确认" : "草稿"}</span> · 第${o.revision}版</div>
      <div class="row"><label>转录</label><input data-field="oRaw" value="${esc(o.rawText)}" /></div>
      ${Object.entries(o.fields).map(([k, v]) => `<div class="row"><label>${esc(k)}</label><input data-ofkey="${esc(k)}" value="${esc(v)}" /></div>`).join("")}
      <div class="row"><input data-field="oNewKey" placeholder="新字段名" /><input data-field="oNewVal" placeholder="值" /></div>
      ${o.unknowns.length ? `<div class="hint warn">未知：${o.unknowns.map(esc).join("、")}</div>` : ""}
      <div class="row"><input data-field="oReason" placeholder="修改原因（改转录/数值必填）" />
        <button class="primary ocr-confirm">${o.status === "confirmed" ? "再次确认" : "人工确认"}</button><button class="history-btn">历史(${o.history.length})</button></div>
    </div>`).join("")}`;
}

/** 左栏工具：方案导航=模板；记录导航=样品/图片；文献导航=映射/比较。 */
function renderRecordTools(box) {
  const samples = state.samples.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  const imgs = state.assets.filter((a) => a.kind === "image" && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
  box.innerHTML = `
    <div class="pane-title">样品（短号稳定，改名不破引用）</div>
    ${samples.map((s) => `<div class="item smp" data-id="${s.id}">
      <div class="meta"><strong>${esc(s.shortName)}</strong> · ${s.states.length} 状态${s.origin === "reconstructed" ? ` · <span class="badge warn">文献重构</span>` : ""}</div>
      <div class="row"><input data-field="smpName" value="${esc(s.displayName)}" /><button class="smp-rename">改名</button></div>
      <details class="mini"><summary>追加状态（分样/处理/用途）</summary>
        <div class="row"><input data-field="stValue" placeholder="用量（必填）" /><input data-field="stUnit" placeholder="单位" />
          <label><input type="checkbox" data-field="stEst" /> 估计</label></div>
        <div class="row"><input data-field="stHandling" placeholder="处理" /><input data-field="stUse" placeholder="用途" /></div>
        <div class="row"><input data-field="stNote" placeholder="备注" /><button class="smp-state">追加状态</button></div>
      </details>
      <div class="hint">历史：${s.states.map((st) => `${fmtVersion(st.revision)} ${esc(st.amount.value)}${esc(st.amount.unit)}${st.amount.estimated ? "(估)" : ""}`).join(" → ")}</div>
    </div>`).join("") || `<p class="hint">暂无样品。</p>`}
    <details class="mini"><summary>新建样品</summary>
      <div class="row"><input id="smp-short" placeholder="短号（唯一，如 S1）" /><input id="smp-display" placeholder="显示名（可后改）" /></div>
      <div class="row"><input id="smp-value" placeholder="用量（必填）" /><input id="smp-unit" placeholder="单位" />
        <label><input type="checkbox" id="smp-est" /> 估计</label></div>
      <div class="row"><input id="smp-handling" placeholder="处理" /><input id="smp-use" placeholder="用途" /></div>
      <button class="primary" id="smp-create">创建样品</button>
    </details>
    <div class="pane-title">手写图片（OCR）</div>
    <details class="mini"><summary>上传原图（PNG/JPEG/WebP）</summary>
      <input id="img-file" type="file" accept="image/png,image/jpeg,image/webp" />
      <button id="img-import">归档原图</button>
    </details>
    ${imgs.map((a) => `<div class="material ${a.id === ui.assetId ? "active" : ""}" data-aid="${a.id}">
      <div class="m-title">${esc(a.name)}</div><div class="m-meta">图片 · ${a.bytes}B · OCR ${state.ocrs.filter((o) => o.assetId === a.id).length}</div>
    </div>`).join("") || `<p class="hint">暂无图片。真实手写公开材料缺位时可用人工转录兜底。</p>`}`;
}

// ── 事件 ────────────────────────────────────────────────────
/** 工作区跳转（课题首页/待办/条目页的入口按钮）。 */
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(".goto"); if (!b) return;
  if (!guardLeave()) return;
  if (b.dataset.topic) ui.topicId = b.dataset.topic;
  if (b.dataset.paper) ui.paperId = b.dataset.paper;
  ui.nav = b.dataset.goto; ui.highlight = null; ui.cell = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.topicPane = "overview"; ui.subqId = null; ui.paperView = "manage";
  renderAll();
});
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(".empty-act"); if (!b) return;
  const act = b.dataset.act ?? "";
  if (act === "focus-create") {
    const box = $("#create-area");
    const target = box?.querySelector("input:not([type=file]), textarea, select, button");
    box?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
    return;
  }
  if (act.startsWith("goto:")) activateNav(act.slice(5));
});
$("#nav").addEventListener("click", (ev) => {
  const b = ev.target.closest(".navitem"); if (!b || b.disabled) return;
  activateNav(b.dataset.nav);
});
// 页头「当前课题」（容器 #curtopic 常驻，用委托）：点击打开切换器弹层
$("#curtopic").addEventListener("click", (ev) => {
  if (!ev.target.closest("#topic-switch-btn")) return;
  openTopicSwitcher();
});

// ── 顶栏课题切换器：可查找、可选、可新建；切换走未保存保护 ──
function renderTopicSwitcherList() {
  const q = $("#ts-search")?.value ?? "";
  $("#ts-list").innerHTML = topicSwitcherListHtml(state, q, ui.topicId);
}
function openTopicSwitcher() {
  renderTopicSwitcherList();
  const n = $("#ts-new-name"), q = $("#ts-new-q");
  if (n) n.value = ""; if (q) q.value = "";
  const det = $("#topic-switcher .ts-newbox");
  if (det && !state.topics.length) det.open = true;
  openDialog($("#topic-switcher"), state.topics.length ? "#ts-search" : "#ts-new-name");
  $("#topic-switch-btn")?.setAttribute("aria-expanded", "true");
}
function closeTopicSwitcher() {
  closeDialog($("#topic-switcher"));
  $("#topic-switch-btn")?.setAttribute("aria-expanded", "false");
}
function switchTopic(id) {
  if (id === ui.topicId) { closeTopicSwitcher(); return; }
  if (!guardLeave()) return;
  clearAllErrors();
  ui.topicId = id; ui.topicPane = "overview"; ui.subqId = null;
  ui.assetId = null; ui.paperId = null; ui.highlight = null; ui.cell = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.protocolId = null; ui.executionId = null; ui.stepSel = null; ui.viewRev = null; ui.taskId = null; ui.chatId = null; ui.reportId = null;
  closeTopicSwitcher();
  renderAll();
}
$("#topic-switcher").addEventListener("input", (ev) => { if (ev.target.id === "ts-search") renderTopicSwitcherList(); });$("#topic-switcher").addEventListener("click", (ev) => {
  if (ev.target.closest("#ts-close")) { closeTopicSwitcher(); return; }
  const pick = ev.target.closest("[data-topicpick]");
  if (pick) { switchTopic(pick.dataset.topicpick); return; }
  if (ev.target.id === "ts-new-create") {
    runBusy(ev.target, "创建课题", async () => {
      const name = $("#ts-new-name").value.trim();
      if (!name) { notify("mid", "课题名称不能为空"); return; }
      const r = await api.createTopic(name, $("#ts-new-q").value);
      setDirty(false);
      const creating = ui.nav !== "topic";
      ui.topicId = r.topicId; ui.topicPane = "overview"; ui.subqId = null;
      if (creating) ui.nav = "topic";
      closeTopicSwitcher();
      await refresh(); setStatus("课题已创建");
    });
  }
});
// 创建课题 / 子问题（中间区随渲染重建，用委托）
document.addEventListener("click", (ev) => {
  if (ev.target.id === "topic-create") { runBusy(ev.target, "创建课题", async () => {
    const r = await api.createTopic($("#topic-name").value, $("#topic-q").value);
    ui.topicId = r.topicId; setDirty(false); await refresh(); setStatus("课题已创建");
  }); return; }
  if (ev.target.id === "subq-create") { runBusy(ev.target, "创建子问题", async () => {
    if (!ui.topicId) { setError("mid", { panel: "mid", message: "请先创建或选择课题。", detail: "", retry: null }); return; }
    await api.createSubquestion(ui.topicId, $("#subq-q").value, $("#subq-kind").value); $("#subq-q").value = ""; setDirty(false); await refresh(); setStatus("子问题已添加");
  }); return; }
  const subqOpen = ev.target.closest(".subq-open");
  if (subqOpen) { openSubq(subqOpen.dataset.subq); return; }
  if (ev.target.closest("[data-subq-back]")) { backFromSubq(); return; }
  if (ev.target.closest("[data-paper-back]")) { backToPaperManage(); return; }
  if (ev.target.id === "pp-create") { runBusy(ev.target, "创建论文条目", async () => {
    try {
      const r = await api.createPaper({
        title: $("#pp-title").value, authors: $("#pp-authors").value, year: $("#pp-year").value,
        doi: $("#pp-doi").value, source: $("#pp-source").value, license: $("#pp-license").value,
        topicIds: ui.topicId ? [ui.topicId] : [],
      });
      ui.paperId = r.paperId; ui.attId = null; ui.paperView = "manage"; await refresh(); setStatus("论文条目已创建（未解析）");
    } catch (e) {
      if (e.status === 409 && e.details?.existingPaperId) { showLocate(e.message, e.details.existingPaperId); return; }
      throw e;
    }
  }); return; }
  if (ev.target.id === "bib-import") { runBusy(ev.target, "导入题录", async () => {
    const r = await api.importBibliography($("#bib-format").value, $("#bib-text").value);
    $("#bib-text").value = "";
    if (r.created?.length) ui.paperId = r.created[0];
    ui.paperView = "manage";
    await refresh();
    setStatus(`题录导入：新建 ${r.created?.length ?? 0} 条${r.skipped?.length ? `，跳过同 DOI ${r.skipped.length} 条（已有条目可定位）` : ""}`);
  }); return; }
});
// 分区报错条：关闭 / 详情 / 重试
document.addEventListener("click", (ev) => {
  const bar = ev.target.closest(".panelerr"); if (!bar) return;
  const panel = bar.dataset.panel || "mid";
  if (ev.target.classList.contains("perr-close")) { clearError(panel); return; }
  if (ev.target.classList.contains("perr-detail")) { const d = bar.querySelector(".perr-detail-body"); if (d) d.hidden = !d.hidden; return; }
  if (ev.target.classList.contains("perr-retry")) { const r = errors[panel]?.retry; clearError(panel); if (r) r(); return; }
});
// 实验图（中栏）：点节点选择步骤 + 图下固定区编辑（保存追加新快照）
document.addEventListener("click", (ev) => {
  const t = ev.target;
  const node = t.closest(".dnode");
  if (node) { if (ui.nav === "protocol") { ui.stepSel = node.dataset.step; renderMiddle(); } return; }
  if (t.id === "step-cancel") { ui.stepSel = null; setDirty(false); renderMiddle(); return; }
  if (t.id === "step-add") {
    const op = ($("#newstep-op")?.value ?? "").trim();
    if (!op) { notify("mid", "新步骤操作名不能为空"); return; }
    const p = currentProtocol(); const latest = p.revisions[p.revisions.length - 1];
    runBusy(t, "添加步骤", async () => { await api.editProtocol(p.id, { steps: [...latest.steps, { op, durationMin: null, branch: null, estimated: false }], reason: `添加步骤：${op}` }); setDirty(false); await refresh(); setStatus(`已添加步骤（${fmtVersion(p.revision + 1)}）`); }); return;
  }
  if (t.id === "step-save") {
    const p = currentProtocol(); const latest = p.revisions[p.revisions.length - 1];
    const params = {};
    for (const line of $("#se-params").value.split(/\n/)) { const i = line.indexOf("="); if (i > 0) params[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    const durRaw = $("#se-dur").value;
    const amountRaw = $("#se-amount")?.value ?? "";
    const rateRaw = $("#se-rate")?.value ?? "";
    const src = $("#se-dursrc")?.value ?? "fixed";
    const edited = {
      id: ui.stepSel === "new" ? undefined : ui.stepSel,
      op: $("#se-op").value, params, note: $("#se-note").value,
      durationSource: src,
      durationMin: durRaw === "" ? null : Number(durRaw),
      amount: amountRaw === "" ? null : Number(amountRaw),
      ratePerMin: rateRaw === "" ? null : Number(rateRaw),
      slackMin: ($("#se-slack")?.value ?? "") === "" ? null : Number($("#se-slack").value),
      estimated: src === "estimated", branch: $("#se-branch").value.trim() || null, observeEnd: $("#se-end").value,
      branchFrom: $("#se-fork")?.value || null, mergeInto: $("#se-merge")?.value || null,
    };
    const steps = ui.stepSel === "new" ? [...latest.steps, edited] : latest.steps.map((s) => (s.id === ui.stepSel ? { ...s, ...edited, id: s.id } : s));
    runBusy(t, "保存步骤", async () => { await api.editProtocol(p.id, { steps, reason: $("#se-reason").value }); ui.stepSel = null; setDirty(false); await refresh(); setStatus("步骤已保存（追加新快照，旧版本不动）"); }); return;
  }
});
// 时长来源切换：规定/估计 → 时长输入；由量·速率计算 → 用量/速率；未知 → 两者皆隐。
document.addEventListener("change", (ev) => {
  if (ev.target.id !== "se-dursrc") return;
  const v = ev.target.value;
  const fixed = document.querySelector(".dur-fixed");
  const comp = document.querySelector(".dur-comp");
  if (fixed) fixed.hidden = v === "computed" || v === "unknown";
  if (comp) comp.hidden = v !== "computed";
});

// 通用（中栏或右栏皆可）：修订/快照历史、方案导出 JSON、影响分析运行
document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (t.classList.contains("history-btn")) {
    const item = t.closest(".item"); const id = item?.dataset.id; if (!id) return;
    const obj = state.cards.find((c) => c.id === id) ?? state.tables.find((x) => x.id === id) ?? state.ocrs.find((o) => o.id === id) ?? state.measurements.find((m) => m.id === id) ?? state.papers.find((p) => p.id === id);
    if (obj) { openHistory(obj); return; }
    const p = state.protocols.find((x) => x.id === id);
    if (p) { openHistory({ revision: p.revision, history: p.revisions.map((r) => ({ revision: r.revision, field: "整版快照", before: r.revision > 1 ? fmtVersion(r.revision - 1) : "—", after: `${r.steps.length} 步`, reason: r.reason, at: r.at })) }); return; }
    return;
  }
  if (t.id === "proto-export") {
    const p = currentProtocol(); if (!p) return;
    const snap = viewSnapshot(p);
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const aEl = document.createElement("a"); aEl.href = URL.createObjectURL(blob); aEl.download = `${p.name}_${fmtVersion(snap.revision)}.json`;
    aEl.click(); URL.revokeObjectURL(aEl.href); setStatus("已导出当前快照 JSON"); return;
  }
  if (t.id === "diagram-html") { const p = currentProtocol(); if (!p) return; runBusy(t, "导出图 HTML", () => exportDiagramHtml(p, viewSnapshot(p))); return; }
  if (t.id === "diagram-png") { const p = currentProtocol(); if (!p) return; runBusy(t, "导出图 PNG", () => exportDiagramPng(p, viewSnapshot(p))); return; }
  if (t.classList.contains("imp-run")) {
    const iid = t.dataset.id;
    runJob(t, "AI 影响评估", async () => { const r = await api.runImpact(iid); const res = await pollJob(r.jobId, "影响评估"); await refreshAfterJob(); setStatus(res.discarded ? "已有更新改动：旧评估被丢弃（stale 守卫）" : "影响评估完成"); }); return;
  }
  // B4 步骤记录表 + 样品改名（记录页）
  const stepBtn = t.closest(".steptbl-save");
  if (stepBtn) {
    const row = stepBtn.closest("tr"); const sid = row.dataset.step; const opText = row.dataset.op || "步骤";
    const amount = row.querySelector('[data-f="amount"]').value.trim();
    const durRaw = row.querySelector('[data-f="dur"]').value.trim();
    const incident = row.querySelector('[data-f="incident"]').checked;
    const targetEls = [...row.querySelectorAll('[data-f="target"]:checked')];
    const targetOps = targetEls.map((el) => el.dataset.op).filter(Boolean);
    runBusy(stepBtn, "记录步骤", async () => {
      await api.appendEvent(ui.executionId, { kind: "step", stepId: sid, text: opText, actual: { ...(amount ? { amount } : {}), ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) } });
if (incident && targetOps.length) await api.appendEvent(ui.executionId, { kind: "deviation", stepId: sid, text: `意外：影响到${targetOps.map((o) => `「${o}」`).join("")}` });
      setDirty(false); await refresh(); setStatus("步骤已记录（实际值入本次执行，不改源方案）");
    }); return;
  }
  const smpRename = t.closest(".smp-rename");
  if (smpRename) {
    const row = smpRename.closest(".smprow"); const id = row.dataset.id; const name = row.querySelector(".smp-name").value.trim();
    runBusy(smpRename, "改样品名", async () => { await api.renameSample(id, name); setDirty(false); await refresh(); setStatus("样品名已改（稳定编号不变）"); }); return;
  }
});
const dialogFocusReturns = new WeakMap();
const dialogMotionIds = new WeakMap();
const DIALOG_SELECTORS = ["#ai-drawer", "#drawer", "#navdrawer", "#topic-switcher"];
const isDialogOpen = (el) => Boolean(el && !el.hidden && !el.dataset.closing);
function syncDialogScrim() {
  const scrim = $("#dialog-scrim");
  if (!scrim) return;
  const visible = DIALOG_SELECTORS.some((selector) => { const el = $(selector); return el && !el.hidden; });
  const interactive = DIALOG_SELECTORS.some((selector) => isDialogOpen($(selector)));
  scrim.style.pointerEvents = interactive ? "auto" : "none";
  scrim.getAnimations().forEach((a) => a.cancel());
  if (visible) {
    const wasHidden = scrim.hidden;
    const opacity = wasHidden ? 0 : Number(getComputedStyle(scrim).opacity);
    scrim.hidden = false;
    if (!prefersReducedMotion()) scrim.animate([{ opacity }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
  } else if (!scrim.hidden) {
    if (prefersReducedMotion()) scrim.hidden = true;
    else {
      const opacity = Number(getComputedStyle(scrim).opacity);
      scrim.animate([{ opacity }, { opacity: 0 }], { duration: 180, easing: "ease-in" }).finished
        .then(() => {
          const anyVisible = DIALOG_SELECTORS.some((selector) => { const el = $(selector); return el && !el.hidden; });
          if (!anyVisible) scrim.hidden = true;
        })
        .catch(() => {});
    }
  }
}
function openDialog(el, initialSelector) {
  if (!el || isDialogOpen(el)) return;
  const reopening = Boolean(el.dataset.closing);
  const id = (dialogMotionIds.get(el) ?? 0) + 1;
  dialogMotionIds.set(el, id);
  dialogFocusReturns.set(el, document.activeElement);
  const style = reopening ? getComputedStyle(el) : null;
  el.hidden = false;
  delete el.dataset.closing;
  el.getAnimations().forEach((a) => a.cancel());
  syncDialogScrim();
  if (!prefersReducedMotion()) {
    const from = reopening
      ? { opacity: Number(style.opacity), transform: style.transform }
      : { opacity: 0, transform: el.id === "navdrawer" ? "translateY(-6px)" : "translateX(28px)" };
    el.animate([from, { opacity: 1, transform: "translate(0)" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  const target = (initialSelector && el.querySelector(initialSelector)) || el.querySelector("button, input, select, textarea") || el;
  target.focus({ preventScroll: true });
}
function closeDialog(el) {
  if (!isDialogOpen(el)) return;
  const id = (dialogMotionIds.get(el) ?? 0) + 1;
  dialogMotionIds.set(el, id);
  el.dataset.closing = "true";
  el.getAnimations().forEach((a) => a.cancel());
  syncDialogScrim();
  const previous = dialogFocusReturns.get(el);
  dialogFocusReturns.delete(el);
  if (previous?.isConnected && typeof previous.focus === "function") previous.focus({ preventScroll: true });
  const finish = () => {
    if (dialogMotionIds.get(el) !== id) return;
    el.hidden = true;
    delete el.dataset.closing;
    syncDialogScrim();
  };
  if (prefersReducedMotion()) { finish(); return; }
  const style = getComputedStyle(el);
  el.animate([
    { opacity: Number(style.opacity), transform: style.transform },
    { opacity: 0, transform: el.id === "navdrawer" ? "translateY(-6px)" : "translateX(28px)" },
  ], { duration: 180, easing: "ease-in" }).finished.then(finish).catch(() => {});
}
$("#dialog-scrim").addEventListener("click", () => {
  if (isDialogOpen($("#ai-drawer"))) closeAiDrawer();
  else if (isDialogOpen($("#drawer"))) closeDialog($("#drawer"));
  else if (isDialogOpen($("#topic-switcher"))) closeTopicSwitcher();
  else if (isDialogOpen($("#navdrawer"))) closeNavDrawer();
});
const DIALOG_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Tab") return;
  const dialog = [...document.querySelectorAll("#ai-drawer:not([hidden]):not([data-closing]), #drawer:not([hidden]):not([data-closing]), #topic-switcher:not([hidden]):not([data-closing]), #navdrawer:not([hidden]):not([data-closing])")].at(-1);
  if (!dialog) return;
  const items = [...dialog.querySelectorAll(DIALOG_FOCUSABLE)].filter((el) => el.getClientRects().length);
  if (!items.length) { ev.preventDefault(); dialog.focus(); return; }
  const first = items[0], last = items.at(-1), active = document.activeElement;
  if (ev.shiftKey && (active === first || !dialog.contains(active))) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && (active === last || !dialog.contains(active))) { ev.preventDefault(); first.focus(); }
});

// 窄屏卷目抽屉：一字印列表；点击后关闭并切页。
function openNavDrawer() {
  $("#nd-list").innerHTML = NAV_ITEMS.map(([k, l]) => `<button class="nd-item ${k === ui.nav ? "active" : ""}" data-nav="${k}"${k === ui.nav ? ' aria-current="page"' : ""}><span class="nd-seal" aria-hidden="true">${navChar(k)}</span><span>${esc(l)}</span></button>`).join("");
  openDialog($("#navdrawer"), ".nd-item.active");
  $("#spine-menu").setAttribute("aria-expanded", "true");
}
function closeNavDrawer() {
  closeDialog($("#navdrawer"));
  $("#spine-menu").setAttribute("aria-expanded", "false");
}
$("#spine-menu").addEventListener("click", () => { if (!isDialogOpen($("#navdrawer"))) openNavDrawer(); else closeNavDrawer(); });
$("#navrail").addEventListener("click", (ev) => { if (ev.target.closest(".navitem")) openNavDrawer(); });
$("#navdrawer").addEventListener("click", (ev) => {
  if (ev.target.id === "nd-close" || ev.target.closest("[data-close-navdrawer]")) { closeNavDrawer(); return; }
  if (ev.target.closest("[data-open-ai]")) { closeNavDrawer(); openAiDrawer(); return; }
  const b = ev.target.closest(".nd-item"); if (!b) return;
  closeNavDrawer();
  activateNav(b.dataset.nav);
});

$("#material-list").addEventListener("click", (ev) => {
  const el = ev.target.closest(".material"); if (!el) return;
  if (el.dataset.topicpick) {
    if (el.dataset.topicpick === ui.topicId) return;
    if (!guardLeave()) return;
    clearAllErrors();
    ui.topicId = el.dataset.topicpick; ui.assetId = null; ui.highlight = null; ui.groupSel.clear(); ui.batch = null;
    ui.protocolId = null; ui.executionId = null; ui.stepSel = null; ui.viewRev = null; ui.taskId = null; ui.chatId = null; ui.reportId = null;
    ui.topicPane = "overview"; ui.subqId = null;
    renderAll(); return;
  }
  if (el.dataset.paperid) {
    if (el.dataset.paperid === ui.paperId) return;
    if (!guardLeave()) return;
    ui.paperId = el.dataset.paperid; ui.attId = null; ui.assetId = null; ui.highlight = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderAll(); return;
  }
  if (el.dataset.pid) {
    if (el.dataset.pid === ui.protocolId) return;
    if (!guardLeave()) return;
    ui.protocolId = el.dataset.pid; ui.stepSel = null; ui.viewRev = null; ui.highlight = null; renderAll(); return;
  }
  if (el.dataset.eid) {
    if (el.dataset.eid === ui.executionId) return;
    if (!guardLeave()) return;
    ui.executionId = el.dataset.eid; ui.editEventId = null; ui.pauseSuggest = null; ui.prepExtra = 0; ui.assetId = null; renderAll(); return;
  }
  if (el.dataset.atid) {
    if (el.dataset.atid === ui.taskId) return;
    if (!guardLeave()) return;
    ui.taskId = el.dataset.atid; ui.reportId = null; renderAll(); return;
  }
  if (el.dataset.cid) {
    if (el.dataset.cid === ui.chatId) return;
    if (!guardLeave()) return;
    ui.chatId = el.dataset.cid; renderAll(); return;
  }
  if (el.dataset.id === ui.assetId) return;
  if (!guardLeave()) return;
  ui.assetId = el.dataset.id; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderAll();
});
$("#mid-content").addEventListener("click", async (ev) => {
  const readBtn = ev.target.closest(".paper-read");
  if (readBtn) { if (!readBtn.disabled) openPaperRead(readBtn.dataset.paper); return; }
  if (ev.target.closest("[data-paper-clear]")) { ui.paperQuery = ""; ui.paperFilter = "all"; renderAll(); return; }
  const prow = ev.target.closest("[data-paperrow]");
  if (prow) { const id = prow.dataset.paperrow; if (id !== ui.paperId) { ui.paperId = id; ui.attId = null; renderAll(); } return; }
  if (ev.target.classList.contains("tbl-open")) { openTableMax(ev.target.dataset.tid); return; }
  if (ev.target.id === "chat-send") {
    const c = currentChat(); if (!c) return;
    const text = $("#chat-text").value.trim();
    if (!text) { setStatus("请输入讨论内容"); return; }
    await runJob(ev.target, "上下文讨论", async () => {
      const r = await api.sendChat(c.id, text);
      $("#chat-text").value = "";
      setDirty(false);
      await refresh();
      await pollJob(r.jobId, "上下文讨论");
      await refreshAfterJob(); setStatus("讨论完成（建议采纳见右栏）");
    }); return;
  }
  if (ev.target.classList.contains("chat-cancel")) {
    const c = currentChat(); if (!c) return;
    await runBusy(ev.target, "取消回答", async () => {
      await api.cancelChatMessage(c.id, ev.target.dataset.mid);
      await refresh(); setStatus("已取消：若 AI 稍后返回，内容将被丢弃不写入");
    }); return;
  }
  if (ev.target.classList.contains("chat-retry")) {
    const c = currentChat(); if (!c) return;
    await runJob(ev.target, "重试回答", async () => {
      const r = await api.retryChatMessage(c.id, ev.target.dataset.mid);
      await refresh();
      await pollJob(r.jobId, "上下文讨论");
      await refreshAfterJob(); setStatus("重试完成");
    }); return;
  }
});
$("#mid-content").addEventListener("input", (ev) => {
  if (ev.target.id !== "paper-search") return;
  ui.paperQuery = ev.target.value;
  const list = $("#paper-list");
  if (list) list.innerHTML = paperListHtml();
});
$("#mid-content").addEventListener("change", (ev) => {
  if (ev.target.id !== "paper-filter") return;
  ui.paperFilter = ev.target.value;
  const list = $("#paper-list");
  if (list) list.innerHTML = paperListHtml();
});
document.addEventListener("change", (ev) => {
  if (ev.target.id !== "read-att") return;
  ui.attId = ev.target.value; ui.highlight = null; renderMiddle();
});
$("#right-content").addEventListener("change", async (ev) => {
  if (ev.target.classList.contains("paper-topic")) {
    const p = currentPaper(); const checkbox = ev.target; const desired = checkbox.checked;
    const ok = await runBusy(checkbox, "课题关联", async () => {
      await api.linkPaperTopic(p.id, checkbox.value, desired);
      await refresh(); setStatus(desired ? "已关联课题（多课题可引用同一来源）" : "已解除课题关联");
    });
    if (!ok) checkbox.checked = !desired;
    return;
  }
  if (ev.target.id === "proto-rev") { ui.viewRev = Number(ev.target.value); ui.stepSel = null; renderMiddle(); renderRight(); }
  if (ev.target.id === "meas-sample") {
    const s = state.samples.find((x) => x.id === ev.target.value);
    $("#meas-srev").innerHTML = (s?.states ?? []).map((st) => `<option value="${st.revision}">状态 ${fmtVersion(st.revision)}</option>`).join("");
  }
  if (ev.target.classList.contains("grp")) {
    const id = ev.target.dataset.id;
    if (ev.target.checked) ui.groupSel.add(id); else ui.groupSel.delete(id);
    renderRight();
  }
  if (ev.target.id === "batch-ack") { ui.ack = ev.target.checked; renderRight(); }
});
$("#right-content").addEventListener("input", (ev) => { if (ev.target.closest(".item") || ev.target.closest(".resedit") || ev.target.closest(".reprow")) setDirty(true); });
function trackMidDirty(ev) {
  const el = ev.target;
  if (!el.closest?.("#mid-content")) return;
  if (el.matches(".kz-note, .kz-imp, #kz-paper, #proto-rev")) return;
  if (el.closest(".lit-manage-head") || el.id === "paper-search" || el.id === "paper-filter") return; // 搜索/筛选/创建表单不算未保存编辑
  if (el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]), textarea, select')) setDirty(true);
}
document.addEventListener("input", trackMidDirty);
document.addEventListener("change", trackMidDirty);
$("#right-content").addEventListener("click", async (ev) => {
  const item = ev.target.closest(".item");
  const val = (f) => item?.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  try {
    if (ev.target.classList.contains("chat-adopt")) {
      const c = currentChat(); if (!c) return;
      await runBusy(ev.target, "采纳建议", async () => {
        await api.adoptChatProposal(c.id, ev.target.dataset.mid, Number(ev.target.dataset.idx));
        await refresh(); setStatus("已采纳：写入目标对象（执行备注/报告待验证），来源可溯");
      }); return;
    }
    if (ev.target.classList.contains("span-link")) { ui.assetId = ev.target.dataset.asset; ui.highlight = ev.target.dataset.quote; renderMiddle(); return; }
    const attEl = ev.target.closest(".material[data-attid]");
    if (attEl) { ui.attId = attEl.dataset.attid; ui.highlight = null; renderMiddle(); renderRight(); return; }
    if (ev.target.id === "paper-save") {
      const p = currentPaper();
      await runBusy(ev.target, "保存题录", async () => {
        try {
          await api.updatePaper(p.id, { title: val("pTitle"), authors: val("pAuthors"), year: val("pYear"), doi: val("pDoi"), source: val("pSource"), license: val("pLicense"), note: val("pNote"), reason: val("pReason") });
          setDirty(false); await refresh(); setStatus("题录已保存（修订留历史）");
        } catch (e) {
          if (e.status === 409 && e.details?.existingPaperId) { showLocate(e.message, e.details.existingPaperId); return; }
          throw e;
        }
      }); return;
    }
    if (ev.target.id === "att-add") {
      const p = currentPaper();
      await runBusy(ev.target, "导入附件", async () => {
        const file = $("#att-file").files?.[0];
        let text = $("#att-text").value, name = file?.name ?? "";
        if (file) text = await readTextFile(file);
        if (!name) name = "attachment.md";
        try {
          const r = await api.addPaperAttachment(p.id, { name, text, role: $("#att-role").value, version: $("#att-version").value });
          ui.attId = r.attachmentId; $("#att-text").value = ""; if ($("#att-file")) $("#att-file").value = "";
          await refresh(); setStatus("附件已归档（未触发解析）");
        } catch (e) {
          if (e.status === 409) { showLocate(e.message, e.details?.existingPaperId ?? p.id); return; }
          throw e;
        }
      }); return;
    }
    if (ev.target.classList.contains("tab")) { ui.cardFilter = ev.target.dataset.filter; renderRight(); saveUi(); return; }
    if (ev.target.classList.contains("batch-preview")) {
      ui.batch = await api.batchPreview([...ui.groupSel]); ui.ack = false; renderRight(); return;
    }
    if (ev.target.classList.contains("batch-clear")) { ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderRight(); return; }
    if (ev.target.classList.contains("batch-cancel")) { ui.batch = null; ui.ack = false; renderRight(); return; }
    if (ev.target.classList.contains("batch-confirm")) {
      await runBusy(ev.target, "整组确认", async () => {
        await api.batchConfirm([...ui.groupSel], ui.ack);
        ui.groupSel.clear(); ui.batch = null; ui.ack = false; setDirty(false);
        await refresh(); setStatus("整组已确认（含修订历史）");
      }); return;
    }
    if (ev.target.id === "mc-add") {
      await runBusy(ev.target, "手动补卡", async () => {
        const fields = {};
        for (const line of $("#mc-fields").value.split(/\n/)) {
          const i = line.indexOf("=");
          if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
        await api.addCard({
          assetId: ui.assetId ?? state.attachments.find((a) => a.paperId === ui.paperId)?.assetId, rawText: $("#mc-raw").value, sectionQuote: $("#mc-quote").value,
          fields, units: splitList($("#mc-units").value), conditions: splitList($("#mc-conditions").value),
          unknowns: splitList($("#mc-unknowns").value), secondaryCitation: $("#mc-secondary").checked, reason: $("#mc-reason").value,
        });
        setDirty(false); await refresh(); setStatus("补卡成功（manual，待核对）");
      }); return;
    }
    if (!item) return;
    if (ev.target.classList.contains("raw") && ev.target.classList.contains("linkable")) {
      const c = state.cards.find((x) => x.id === item.dataset.id); ui.highlight = c?.locator.sectionQuote || c?.rawText || null;
      if (ui.nav === "knowledge" && c) ui.assetId = c.assetId;
      renderMiddle(); return;
    }
    if (ev.target.classList.contains("save-fields")) {
      const fields = {};
      item.querySelectorAll("[data-fkey]").forEach((inp) => { fields[inp.dataset.fkey] = inp.value; });
      const nk = val("newkey").trim();
      if (nk) fields[nk] = val("newval");
      await runBusy(ev.target, "保存字段", async () => {
        await api.reviewCard(item.dataset.id, { extracted: { fields, units: splitList(val("units")), conditions: splitList(val("conditions")) }, reason: val("reason") });
        setDirty(false); await refresh(); setStatus("字段/单位/条件已保存（含修订历史）");
      }); return;
    }
    if (ev.target.classList.contains("sec-toggle")) {
      const c = state.cards.find((x) => x.id === item.dataset.id);
      await runBusy(ev.target, "转引标记", async () => {
        await api.reviewCard(item.dataset.id, { secondaryCitation: !c.secondaryCitation, reason: val("reason") });
        setDirty(false); await refresh(); setStatus(c.secondaryCitation ? "已取消转引标记" : "已标记转引（二手，不计独立证据）");
      }); return;
    }
    if (ev.target.classList.contains("adopt-btn")) {
      await runBusy(ev.target, "记录采用", async () => {
        await api.adopt(item.dataset.id, val("adoptSubq"), val("adoptDecision"), val("adoptReason"));
        setDirty(false); await refresh(); setStatus("任务采用/排除已记录（独立于核对）");
      }); return;
    }
    if (ev.target.classList.contains("cell")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      ui.cell = { tableId: t.id, row: Number(ev.target.dataset.row), col: Number(ev.target.dataset.col) };
      ui.highlight = lineOf(t, ui.cell.row); openTableMax(t.id); return;
    }
    if (ev.target.classList.contains("cancel-cell")) { const tid = ui.cell?.tableId; ui.cell = null; if (tid) openTableMax(tid); return; }
    if (ev.target.classList.contains("save-cell") && ui.cell) {
      const tid = ui.cell.tableId;
      await runBusy(ev.target, "保存单元格", async () => {
        await api.reviewTable(tid, { cellUpdates: [{ row: ui.cell.row, col: ui.cell.col, value: val("cellValue") }], reason: val("cellReason") });
        ui.cell = null; setDirty(false); await refresh(); setStatus("单元格已保存（含修订历史）"); openTableMax(tid);
      }); return;
    }
    if (ev.target.classList.contains("save")) {
      await runBusy(ev.target, "保存核对", async () => {
        await api.reviewCard(item.dataset.id, { audit: val("audit"), importance: val("importance") || null, note: val("note"), reason: val("reason") });
        setDirty(false); await refresh(); setStatus("已保存（含修订历史）");
      }); return;
    }
    if (ev.target.classList.contains("save-cols")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      await runBusy(ev.target, "保存列设置", async () => {
        const columnUpdates = t.columns.map((_, i) => ({ index: i, unit: item.querySelector(`[data-col="${i}"][data-k="unit"]`).value, decision: item.querySelector(`[data-col="${i}"][data-k="decision"]`).value }));
        await api.reviewTable(t.id, { columnUpdates, note: val("note"), reason: val("reason") });
        setDirty(false); await refresh(); setStatus("列设置已保存"); openTableMax(t.id);
      }); return;
    }
    // ── 4C 操作 ──
    if (ev.target.id === "proto-save") {
      const p = currentProtocol();
      await runBusy(ev.target, "保存方案元信息", async () => {
        await api.editProtocol(p.id, { purpose: val("purpose"), criteria: val("criteria"), conditions: splitList(val("conditions")), unknowns: splitList(val("unknowns")), reason: val("reason") });
        setDirty(false); await refresh(); setStatus("方案元信息已保存（新快照）");
      }); return;
    }
    if (ev.target.classList.contains("tmpl-confirm")) {
      const tid = ev.target.closest(".tmpl").dataset.id;
      await runBusy(ev.target, "确认模板", async () => { await api.confirmTemplate(tid); setDirty(false); await refresh(); setStatus("模板已人工确认，可复用"); }); return;
    }
    if (ev.target.classList.contains("tmpl-use")) {
      const tid = ev.target.closest(".tmpl").dataset.id;
      const t = state.templates.find((x) => x.id === tid);
      await runBusy(ev.target, "按模板开始执行", async () => {
        const r = await api.startExecution({ topicId: ui.topicId || currentProtocol().topicId, protocolId: t.protocolId, protocolRevision: t.protocolRevision, templateId: tid });
        ui.executionId = r.executionId; ui.nav = "record"; ui.prepExtra = 0; setDirty(false); await refresh(); setStatus("执行已创建：进入准备稿（固定模板所指方案版本）");
      }); return;
    }
    if (ev.target.id === "tmpl-create") {
      await runBusy(ev.target, "生成模板", async () => {
        await api.createTemplate({ protocolId: ui.protocolId, aiDraft: $("#tmpl-ai").checked });
        setDirty(false); await refresh(); setStatus("模板已生成（固定当前方案版本；AI 草稿须人工确认）");
      }); return;
    }
    if (ev.target.id === "prep-add") { ui.prepExtra += 1; renderRight(); return; }
    if (ev.target.classList.contains("prep-del")) { ev.target.closest(".preprow").remove(); return; }
    if (ev.target.id === "prep-save" || ev.target.id === "prep-confirm") {
      const confirm = ev.target.id === "prep-confirm";
      const rows = [];
      $$("#right-content .preprow").forEach((r) => {
        const after = r.querySelector('[data-pf="after"]').value.trim();
        if (!after) return;
        rows.push({ stepId: r.querySelector('[data-pf="stepId"]').value, field: r.querySelector('[data-pf="field"]').value, after, reason: r.querySelector('[data-pf="reason"]').value.trim() });
      });
      await runBusy(ev.target, confirm ? "确认快照" : "保存准备稿", async () => {
        await api.updatePreparation(ui.executionId, { adjustments: rows, notes: $("#prep-notes").value });
        if (!confirm) { ui.prepExtra = 0; setDirty(false); await refresh(); setStatus("准备稿已保存（未确认，不算数）"); return; }
        const r = await api.confirmPreparation(ui.executionId);
        ui.prepExtra = 0; setDirty(false); await refresh();
        setStatus(r.impactId ? "快照已确认：进入记录状态；已登记影响分析（含确定性时间传播）" : "快照已确认（无差异）：进入记录状态；实际开始请另行记录");
      }); return;
    }
    if (ev.target.id === "exec-begin") {
      await runBusy(ev.target, "记录实际开始", async () => {
        await api.appendEvent(ui.executionId, { kind: "start" });
        setDirty(false); await refresh(); setStatus("实际开始已记录（由人记录，非系统虚构）");
      }); return;
    }
    if (ev.target.id === "exec-saveas") {
      await runBusy(ev.target, "另存新方案", async () => {
        const r = await api.saveExecutionAsProtocol(ui.executionId, $("#saveas-name").value);
        ui.protocolId = r.protocolId; ui.nav = "protocol"; ui.viewRev = null; setDirty(false); await refresh();
        setStatus("已另存为新方案 r1（源方案未改动）");
      }); return;
    }
    if (ev.target.id === "exec-assist") {
      await runBusy(ev.target, "AI 暂停建议", async () => {
        ui.pauseSuggest = await api.pauseAssist(ui.executionId);
        renderRight(); setStatus("AI 建议已给出（仅建议，是否采纳由人决定）");
      }); return;
    }
    if (ev.target.id === "exec-pause") {
      await runBusy(ev.target, "暂停执行", async () => {
        await api.pauseExecution(ui.executionId, {
          reason: $("#pause-reason").value,
          risks: ui.pauseSuggest?.risks ?? [], resumeChecks: ui.pauseSuggest?.resumeChecks ?? [],
          aiSuggested: !!ui.pauseSuggest,
        });
        ui.pauseSuggest = null; setDirty(false); await refresh(); setStatus("已暂停（状态与风险已记录）");
      }); return;
    }
    if (ev.target.id === "exec-resume") {
      await runBusy(ev.target, "恢复执行", async () => {
        await api.resumeExecution(ui.executionId, $("#resume-decision").value);
        setDirty(false); await refresh(); setStatus("已恢复（人的决定已记录）");
      }); return;
    }
    if (ev.target.id === "exec-done") {
      await runBusy(ev.target, "结束执行", async () => { await api.completeExecution(ui.executionId); await refresh(); setStatus("执行已结束"); }); return;
    }
    if (ev.target.classList.contains("ev-edit")) { ui.editEventId = ev.target.closest(".evrow").dataset.evid; renderRight(); return; }
    if (ev.target.classList.contains("ev-cancel")) { ui.editEventId = null; renderRight(); return; }
    if (ev.target.classList.contains("ev-save")) {
      const evid = ev.target.closest(".celledit").dataset.evid;
      const durRaw = val("evDur");
      await runBusy(ev.target, "保存记录修订", async () => {
        await api.editEvent(ui.executionId, evid, {
          text: val("evText"),
          actual: { amount: val("evAmount"), ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) },
          reason: val("evReason"),
        });
        ui.editEventId = null; setDirty(false); await refresh(); setStatus("记录已原位修订（留历史，不改源方案）");
      }); return;
    }
    if (ev.target.id === "ev-add") {
      const durRaw = $("#ev-dur").value;
      await runBusy(ev.target, "追加事件", async () => {
        await api.appendEvent(ui.executionId, {
          kind: $("#ev-kind").value, stepId: $("#ev-step").value || undefined, text: $("#ev-text").value,
          actual: { amount: $("#ev-amount").value, ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) },
          backfilled: $("#ev-backfill").checked,
        });
        setDirty(false); await refresh(); setStatus("事件已追加");
      }); return;
    }
    if (ev.target.id === "meas-add") {
      await runBusy(ev.target, "记录测量", async () => {
        await api.addMeasurement({
          topicId: ui.topicId || currentExecution().topicId, sampleId: $("#meas-sample").value,
          sampleStateRevision: Number($("#meas-srev").value), value: $("#meas-value").value, unit: $("#meas-unit").value,
          method: $("#meas-method").value, instrument: $("#meas-instr").value, note: $("#meas-note").value,
        });
        setDirty(false); await refresh(); setStatus("测量已记录（固定样品状态版本）");
      }); return;
    }
    if (ev.target.classList.contains("meas-save")) {
      const before = state.measurements.find((m) => m.id === item.dataset.id);
      await runBusy(ev.target, "保存测量修订", async () => {
        await api.editMeasurement(item.dataset.id, { value: val("mValue"), unit: val("mUnit"), method: val("mMethod"), instrument: val("mInstr"), note: val("mNote"), reason: val("mReason") });
        const fields = [];
        if (before) { if (val("mValue") !== before.value) fields.push("value"); if (val("mUnit") !== before.unit) fields.push("unit"); if (val("mMethod") !== before.method) fields.push("method"); }
        setDirty(false); await refresh(); setStatus("测量已修订（留历史）");
        await noteChangeHits("measurement", item.dataset.id, fields);
      }); return;
    }
    if (ev.target.id === "ocr-ai") {
      await runJob(ev.target, "AI 识别", async () => {
        const r = await api.runOcr(ui.assetId);
        const res = await pollJob(r.jobId, "手写识别");
        await refreshAfterJob(); setStatus(`识别完成：${res.created} 条草稿（须人工确认）`);
      }); return;
    }
    if (ev.target.id === "ocr-manual-add") {
      const fields = {};
      for (const line of $("#ocr-fields").value.split(/\n/)) { const i = line.indexOf("="); if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      await runBusy(ev.target, "保存转录", async () => {
        await api.manualOcr(ui.assetId, { rawText: $("#ocr-raw").value, fields, unknowns: splitList($("#ocr-unknowns").value) });
        setDirty(false); await refresh(); setStatus("人工转录草稿已保存（manual）");
      }); return;
    }
    if (ev.target.classList.contains("ocr-confirm")) {
      const fields = {};
      item.querySelectorAll("[data-ofkey]").forEach((inp) => { fields[inp.dataset.ofkey] = inp.value; });
      const nk = val("oNewKey").trim(); if (nk) fields[nk] = val("oNewVal");
      await runBusy(ev.target, "确认 OCR", async () => {
        await api.confirmOcr(item.dataset.id, { rawText: val("oRaw"), fields, reason: val("oReason") });
        setDirty(false); await refresh(); setStatus("OCR 记录已人工确认（修订留历史）");
      }); return;
    }
  } catch (e) { const h = humanError(e); setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); }
});
function lineOf(t, ri) {
  const lines = currentAsset().text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return (lines[ri + 1] ?? "").trim() || null;
}
const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
$("#tools-area").addEventListener("click", (ev) => {
  const t = ev.target;
  const imgEl = t.closest?.(".material[data-aid]");
  if (imgEl) {
    if (!guardLeave()) return;
    ui.assetId = imgEl.dataset.aid; ui.executionId = null; ui.highlight = null; renderAll(); return;
  }
  if (t.id === "smp-create") {
    runBusy(t, "创建样品", async () => {
      if (!ui.topicId) throw new Error("请先选择/创建课题");
      await api.createSample({
        topicId: ui.topicId, executionId: ui.executionId || undefined,
        shortName: $("#smp-short").value, displayName: $("#smp-display").value,
        amount: { value: $("#smp-value").value, unit: $("#smp-unit").value, estimated: $("#smp-est").checked },
        handling: $("#smp-handling").value, use: $("#smp-use").value,
      });
      await refresh(); setStatus("样品已创建（短号唯一，状态追加式）");
    }); return;
  }
  if (t.classList.contains("smp-rename")) {
    const item = t.closest(".smp");
    runBusy(t, "样品改名", async () => {
      await api.renameSample(item.dataset.id, item.querySelector('[data-field="smpName"]').value);
      await refresh(); setStatus("显示名已改（短号与引用不变）");
    }); return;
  }
  if (t.classList.contains("smp-state")) {
    const item = t.closest(".smp");
    const v = (f) => item.querySelector(`[data-field="${f}"]`)?.value ?? "";
    runBusy(t, "追加样品状态", async () => {
      await api.addSampleState(item.dataset.id, {
        amount: { value: v("stValue"), unit: v("stUnit"), estimated: item.querySelector('[data-field="stEst"]').checked },
        handling: v("stHandling"), use: v("stUse"), note: v("stNote"),
      });
      await refresh(); setStatus("样品状态已追加（历史不改写）");
    }); return;
  }
  if (t.id === "img-import") {
    runBusy(t, "归档原图", async () => {
      const file = $("#img-file").files?.[0];
      if (!file) throw new Error("请先选择图片文件");
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("读取图片失败")); fr.readAsDataURL(file); });
      const r = await api.importImage(file.name, dataUrl, ui.topicId || undefined);
      ui.assetId = r.assetId; ui.executionId = null; await refresh(); setStatus("原图已归档（可选择 AI 识别或人工转录）");
    }); return;
  }
  if (t.id === "map-create") {
    runBusy(t, "添加映射", async () => {
      await api.createMapping($("#map-original").value, $("#map-mapped").value, $("#map-basis").value, ui.topicId || undefined);
      await refresh(); setStatus("映射已添加（原名保留，依据必填）");
    }); return;
  }
  if (t.id === "cmp-create") {
    runBusy(t, "固定快照比较", async () => {
      const cardIds = [...$$(".cmp-card")].filter((x) => x.checked).map((x) => x.value);
      if (!cardIds.length) throw new Error("请先勾选已确认证据卡。");
      await api.createComparison({ topicId: ui.topicId, cardIds, filters: splitList($("#cmp-filters").value), conversions: splitList($("#cmp-conversions").value), exclusions: splitList($("#cmp-exclusions").value) });
      await refresh(); setStatus("比较快照已固定（追加式，不覆盖旧结论）");
    }); return;
  }
  if (t.classList.contains("cmp-again")) {
    runBusy(t, "重新比较", async () => {
      const cmp = state.comparisons.find((c) => c.id === t.dataset.id);
      const cardIds = [...new Set(cmp.groups.flatMap((g) => g.entries.map((e) => e.cardId)))];
      await api.createComparison({ topicId: cmp.topicId, subquestionId: cmp.subquestionId, cardIds, filters: cmp.snapshot.filters, conversions: cmp.snapshot.conversions, exclusions: cmp.snapshot.exclusions });
      await refresh(); setStatus("已按当前卡版本生成新快照（旧快照保留）");
    });
  }
});
function openHistory(obj) {
  if (!obj) return;
  $("#drawer-title").textContent = "修订历史";
  $("#drawer-meta").textContent = `当前第${obj.revision}版 · 共 ${obj.history.length} 条`;
  $("#drawer-body").innerHTML = obj.history.length === 0 ? `<p class="hint">暂无修订记录。</p>`
    : `<table class="grid"><thead><tr><th>版本</th><th>字段</th><th>前</th><th>后</th><th>原因</th><th>时间</th></tr></thead><tbody>${
        obj.history.slice().reverse().map((h) => `<tr><td>${h.revision}</td><td>${esc(h.field)}</td><td class="raw">${esc(h.before)}</td><td class="raw">${esc(h.after)}</td><td>${esc(h.reason)}</td><td>${esc(fmtTime(h.at))}</td></tr>`).join("")
      }</tbody></table>`;
  openDialog($("#drawer"), "#drawer-close");
}
$("#drawer-close").addEventListener("click", () => closeDialog($("#drawer")));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  let closed = false;
  if (isDialogOpen($("#drawer"))) { closeDialog($("#drawer")); closed = true; }
  if (isDialogOpen($("#ai-drawer"))) { closeAiDrawer(); closed = true; }
  if (isDialogOpen($("#topic-switcher"))) { closeTopicSwitcher(); closed = true; }
  if (isDialogOpen($("#navdrawer"))) { closeNavDrawer(); closed = true; }
  const tm = $("#table-max"); if (tm) { tm.remove(); closed = true; }
  if (closed) e.preventDefault();
});
window.addEventListener("beforeunload", (e) => { if (ui.dirty) { e.preventDefault(); e.returnValue = ""; } });

let aiStatus = null;
function openAiDrawer() {
  openDialog($("#ai-drawer"), "#ai-base");
  $("#ai-chip").setAttribute("aria-expanded", "true");
  if (aiStatus && !$("#ai-msg").textContent) {
    $("#ai-msg").textContent = aiStatus.configured
      ? `当前已配置 · ${aiStatus.model}（修改后需重新保存）`
      : "未配置：填写地址、模型与 Key 后保存；配置保存在本机数据目录，不入库。";
  }
}
function closeAiDrawer() {
  closeDialog($("#ai-drawer"));
  $("#ai-chip").setAttribute("aria-expanded", "false");
}
$("#ai-chip").addEventListener("click", () => { if (!isDialogOpen($("#ai-drawer"))) openAiDrawer(); else closeAiDrawer(); });
$("#ai-close").addEventListener("click", closeAiDrawer);
document.addEventListener("click", (ev) => { if (ev.target.closest("[data-open-ai]")) openAiDrawer(); });

async function refreshAiState() {
  const s = await api.aiStatus();
  aiStatus = s;
  const chip = $("#ai-chip"), txt = $("#ai-chip-text");
  txt.textContent = s.configured ? `AI · ${s.model}` : "AI 未配置";
  chip.dataset.state = s.configured ? "ready" : "off";
  chip.title = s.configured ? `AI 已配置 · ${s.model}（点击管理）` : "AI 未配置（点击配置）";
  $("#ai-state").textContent = s.configured ? `已配置 · ${s.model}` : "未配置";
  const st2 = $("#ai-state-2");
  if (st2) st2.textContent = s.configured ? `已配置 · ${s.model} @ ${s.baseUrl}` : "未配置：填写接口地址 / 模型 / Key 后保存。";
  if (s.configured) {
    if (!$("#ai-base").value) $("#ai-base").value = s.baseUrl;
    if (!$("#ai-model").value) $("#ai-model").value = s.model;
    if (!$("#ai-timeout").value && s.timeoutMs) $("#ai-timeout").value = Math.round(s.timeoutMs / 1000);
  }
}
$("#ai-open").addEventListener("click", () => { openAiDrawer(); refreshAiState().catch(() => {}); });
$("#ai-save").addEventListener("click", async (ev) => {
  const btn = ev.target, old = btn.textContent;
  btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "处理中…"; $("#ai-msg").textContent = "";
  try {
    const secs = Number($("#ai-timeout").value);
    const timeoutMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined;
    const s = await api.setAiConfig($("#ai-base").value, $("#ai-model").value, $("#ai-key").value, timeoutMs);
    $("#ai-key").value = "";
    if (s.configured) { $("#ai-msg").textContent = `已保存 · ${s.model}`; setStatus(`AI 已配置 · ${s.model}`); }
    else { $("#ai-msg").textContent = "配置不完整：需要地址 / 模型 / Key 三项。"; }
    await refreshAiState();
  } catch (e) { const h = humanError(e); $("#ai-msg").textContent = `保存失败：${h.message}`; }
  finally { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = old; }
});
$("#ai-clear").addEventListener("click", (ev) => runBusy(ev.target, "清除模型配置", async () => { await api.clearAiConfig(); $("#ai-models-list").hidden = true; await refreshAiState(); setStatus("模型配置已清除"); }));
$("#ai-test").addEventListener("click", (ev) => {
  const btn = ev.target, old = btn.textContent;
  btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "测试中…"; $("#ai-msg").textContent = "";
  api.aiTest()
    .then((r) => { $("#ai-msg").textContent = (r.ok ? "✓ " : "✗ ") + r.message; })
    .catch((e) => { $("#ai-msg").textContent = "测试失败：" + (e.status === 400 ? "未配置（先保存再测）" : String(e.message ?? e)); })
    .finally(() => { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = old; });
});
$("#ai-models").addEventListener("click", (ev) => {
  const btn = ev.target, old = btn.textContent;
  const box = $("#ai-models-list");
  btn.disabled = true; btn.textContent = "检测中…"; $("#ai-msg").textContent = "";
  api.listAiModels()
    .then((r) => {
      $("#ai-msg").textContent = (r.ok ? "✓ " : "✗ ") + r.message;
      if (r.ok && r.models.length) {
        box.innerHTML = `<div class="hint">可用模型（点选填入）：</div>${r.models.map((m) => `<button type="button" class="moption" data-model="${esc(m)}">${esc(m)}</button>`).join("")}`;
        box.hidden = false;
      } else { box.hidden = true; }
    })
    .catch((e) => { $("#ai-msg").textContent = "检测失败：" + (e.status === 400 ? "未配置（先保存再测）" : String(e.message ?? e)); box.hidden = true; })
    .finally(() => { btn.disabled = false; btn.textContent = old; });
});
// 点选可用模型 → 填入模型名输入框（不自动保存）。
$("#ai-models-list").addEventListener("click", (ev) => {
  const b = ev.target.closest(".moption");
  if (!b) return;
  $("#ai-model").value = b.dataset.model;
  $("#ai-msg").textContent = `已填入模型名：${b.dataset.model}（点「保存配置」生效）`;
});

// 领域知识积累 / 数据处理与分析 两页的渲染与事件（拆分到 lib/pages/*，行为不变）。
bindKnowledge({
  getState: () => state, ui, api, $, $$, refresh, refreshAfterJob, renderAll, renderShell, renderMiddle, renderRight,
  setStatus, setError, setDirty, humanError, runBusy, runJob, notify, pollJob, noteChangeHits, clearAllErrors,
});
bindAnalysis({
  getState: () => state, ui, api, $, $$, refresh, refreshAfterJob, renderAll, renderShell, renderMiddle, renderRight,
  setStatus, setError, setDirty, humanError, runBusy, runJob, notify, pollJob, noteChangeHits, clearAllErrors,
});

$("#theme-seal").addEventListener("click", (ev) => quickSwitchTheme(ev.currentTarget));
$("#replay-theme").addEventListener("click", (ev) => replayAndRecast(ev.currentTarget));
$("#replay-splash").addEventListener("click", () => window.__locusSplash?.play());
document.addEventListener("click", (ev) => {
  if (ev.target.id !== "boot-retry") return;
  ev.target.disabled = true;
  bootstrap();
});

applyTheme(currentTheme(), { persist: false });
refreshAiState().catch(() => {
  $("#ai-chip-text").textContent = "AI 状态未知";
  $("#ai-chip").dataset.state = "off";
});
bootstrap();
