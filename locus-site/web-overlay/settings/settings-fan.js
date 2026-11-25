// LOCUS 设置折扇 · 公开版（独立交接组件）
// 几何与交互取自《设置页折扇_原型.html》v2；公开版内容差异以施工手册 C 为准：
//   - 外观 = 动效 / 疏密 / 字号；模型 = 只读状态 + 「结果为预生成」；关于 = 构建注入版本
//   - 自带 Esc / 遮罩 / Tab 焦点限制 / 关闭归还焦点 / 快速开合取消过期关窗计时
// 主题门控（手册 C.3）：只在「展示模式」固定暖色（paper）。
//   - 展示模式 = 公开展示构建注入 window.__LOCUS_DISPLAY__（对象）；此时置 data-theme=paper 并移除 body.theme-tech。
//   - 常规模式（无该对象）= 本地 / trial / 个人模式：不读不写 locus.theme.v1，不动 data-theme，
//     不删 theme-tech；冷色切换与既有入口照常可用。
// 公共接线（左栏入口按钮、窄屏卷目入口、旧 AI 面板删除）由 D 负责，见同目录 README.md。

const KEY = {
  motion: "locus.motion.v1",
  density: "locus.density.v1",
  fontsize: "locus.fontsize.v1",
};

const DEFAULT_CONFIG = {
  entrySelector: "#settings-open",
  adoptLegacyEntry: false, // 过渡期可设 true 复用尚未改名的 #ai-open（需同时移除旧监听）
  forcePaper: "auto", // "auto"＝仅展示模式固定暖色；true＝始终固定；false＝从不固定
  defaultTab: "appearance",
  version: null, // string 或 () => string；留空则读 window.__LOCUS_BUILD__ / meta
  beforeOpen: null, // () => void，用于先关闭卷目抽屉等
};

const G = { P: { x: 40, y: 720 }, N: 11, T0: 6, T1: 88, R: 712, R_SILK: 640, R_IN: 165, BOX: 760 };
const rad = (d) => (d * Math.PI) / 180;
const pt = (deg, r) => ({
  x: +(G.P.x + r * Math.cos(rad(deg))).toFixed(2),
  y: +(G.P.y - r * Math.sin(rad(deg))).toFixed(2),
});
const ribDeg = (i) => G.T0 + ((G.T1 - G.T0) * i) / (G.N - 1);
const TABS = [
  ["appearance", "外观", 8],
  ["models", "模型", 5],
  ["about", "关于", 2],
];

const state = { open: false, closing: false, timer: 0, lastFocus: null, tab: "appearance" };
let cfg = { ...DEFAULT_CONFIG };
let aside = null;
let scrim = null;
let entry = null;
let initialized = false;

const read = (k) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* 忽略 */ }
};

// ── 外观偏好：动效 / 疏密 / 字号（v2 的键与状态） ─────────
function osReduced() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
function storedMotion() {
  const v = read(KEY.motion);
  return v === "system" || v === "full" || v === "reduced" ? v : null;
}
function isReduced() {
  const v = storedMotion();
  if (v === "reduced") return true;
  if (v === "full") return false;
  return osReduced();
}
function storedDensity() {
  return read(KEY.density) === "compact" ? "compact" : "loose";
}
function storedFontsize() {
  const v = read(KEY.fontsize);
  return v === "sm" || v === "lg" ? v : "md";
}
function applyPreferences() {
  const html = document.documentElement;
  html.dataset.motion = isReduced() ? "reduced" : "full";
  html.dataset.density = storedDensity();
  html.dataset.fontsize = storedFontsize();
}
function syncAppearanceUi() {
  if (!aside) return;
  const sw = aside.querySelector("[data-motion-switch]");
  const hint = aside.querySelector("[data-motion-hint]");
  const reduced = isReduced();
  if (sw) sw.setAttribute("aria-checked", reduced ? "false" : "true");
  if (hint) {
    const v = storedMotion();
    hint.textContent = v === null ? "跟随系统" : v === "reduced" ? "已关闭" : "已开启";
  }
  aside.querySelectorAll("[data-density-seg] button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.v === storedDensity() ? "true" : "false");
  });
  aside.querySelectorAll("[data-fontsize-seg] button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.v === storedFontsize() ? "true" : "false");
  });
}

// ── 构建注入的版本与只读模型状态 ─────────────────────────
function buildInfo() {
  if (typeof cfg.version === "function") return { version: String(cfg.version() ?? "") };
  if (typeof cfg.version === "string" && cfg.version) return { version: cfg.version };
  const b = window.__LOCUS_BUILD__;
  if (b && typeof b === "object") {
    return { version: b.version ? String(b.version) : "", commit: b.commit ? String(b.commit) : "" };
  }
  const meta = document.querySelector('meta[name="locus-build-version"]');
  if (meta?.content) return { version: meta.content };
  const ds = document.documentElement.dataset.buildVersion;
  if (ds) return { version: ds };
  return {};
}
function syncAbout() {
  if (!aside) return;
  const el = aside.querySelector("[data-build-version]");
  if (!el) return;
  const info = buildInfo();
  const commit = info.commit ? ` · ${String(info.commit).slice(0, 7)}` : "";
  el.textContent = info.version ? info.version + commit : "—";
}
// 只读：优先显式注入，其次镜像已有的 AI 状态文本；绝不请求后端。
function modelStatusText() {
  if (typeof window.__LOCUS_MODEL_STATUS__ === "string" && window.__LOCUS_MODEL_STATUS__) {
    return window.__LOCUS_MODEL_STATUS__;
  }
  const chip = document.querySelector("#ai-chip-text")?.textContent?.trim();
  if (chip && chip !== "AI 读取中" && chip !== "AI 状态未知") return chip;
  const st = document.querySelector("#ai-state")?.textContent?.trim();
  if (st && st !== "读取中…") return st;
  return "状态未提供";
}
function syncModelStatus() {
  if (!aside) return;
  const el = aside.querySelector("[data-model-status]");
  if (el) el.textContent = "模型 · " + modelStatusText();
}

// ── 主题门控：展示模式 vs 常规模式 ───────────────────────
// 展示模式由公开展示构建注入 window.__LOCUS_DISPLAY__（对象）标识；常规模式无此对象。
function isDisplayMode() {
  const d = window.__LOCUS_DISPLAY__;
  return !!d && typeof d === "object";
}
function shouldForcePaper() {
  if (cfg.forcePaper === true) return true; // 显式强制（开发/预览可用）
  if (cfg.forcePaper === false) return false; // 显式关闭
  return isDisplayMode(); // "auto"：只在展示模式固定暖色
}
// 仅展示模式调用：置 data-theme=paper 并移除 body.theme-tech。不读也不写任何主题存储键。
function applyDisplayTheme() {
  if (document.documentElement.dataset.theme !== "paper") {
    document.documentElement.dataset.theme = "paper";
  }
  document.body?.classList.remove("theme-tech");
}

// ── 折扇几何（箱体 760） ─────────────────────────────────
const FAN_GLYPH_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true" focusable="false">' +
  '<path d="M2.2 14 L13.6 9.6 M2.2 14 L10.2 3.4 M2.2 14 L3.4 2.6 M13.6 9.6 A11.6 11.6 0 0 0 10.2 3.4 M10.2 3.4 A11.6 11.6 0 0 0 3.4 2.6" stroke-width="1.2"/>' +
  '<circle cx="2.2" cy="14" r="1.1" fill="currentColor" stroke="none"/></svg>';

function fanShellHtml() {
  return `
  <svg class="fan-art" viewBox="0 0 760 760" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="locus-fan-rib-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="rib-a"/><stop offset="1" class="rib-b"/>
      </linearGradient>
    </defs>
    <g class="fan-ribs" data-fan-ribs></g>
    <g class="fan-rivet"><circle class="ring" cx="40" cy="720" r="10"/><circle class="core" cx="40" cy="720" r="5.5"/></g>
  </svg>
  <svg class="fan-silk-svg fan-art" viewBox="0 0 760 760" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="locus-fan-silk-grad" gradientUnits="userSpaceOnUse" cx="40" cy="720" r="640">
        <stop offset=".22" class="silk-b"/><stop offset="1" class="silk-a"/>
      </radialGradient>
      <pattern id="locus-fan-silk-grain" width="14" height="14" patternUnits="userSpaceOnUse">
        <path d="M0 0H14" stroke="var(--fan-silk-grain)" stroke-width="1"/>
      </pattern>
    </defs>
    <g class="fan-silk" data-fan-silk></g>
  </svg>
  <div class="fan-ui">
    <nav class="fan-tabs" aria-label="设置分区" data-fan-tabs></nav>
    <section class="fan-content">
      <div class="fan-head">
        <strong class="fan-title" id="settings-fan-title">设置</strong>
        <button class="fan-close" type="button" data-fan-close aria-label="合拢设置">合拢 ✕</button>
      </div>
      <div class="sheet-tabs" data-sheet-tabs></div>
      <div class="fan-body">
        <section class="fan-panel" data-fan-panel="appearance">
          <div class="fan-field">
            <span class="fan-label">动画效果<span class="f-hint" data-motion-hint>跟随系统</span></span>
            <button class="switch" type="button" role="switch" aria-checked="true" aria-label="动画效果" data-motion-switch></button>
          </div>
          <div class="fan-field">
            <span class="fan-label">疏密</span>
            <span class="seg" data-density-seg>
              <button type="button" data-v="loose">宽松</button>
              <button type="button" data-v="compact">紧凑</button>
            </span>
          </div>
          <div class="fan-field">
            <span class="fan-label">字号</span>
            <span class="seg" data-fontsize-seg>
              <button type="button" data-v="sm">小</button>
              <button type="button" data-v="md">中</button>
              <button type="button" data-v="lg">大</button>
            </span>
          </div>
        </section>
        <section class="fan-panel" data-fan-panel="models" hidden>
          <p class="fan-note" data-model-status>模型 · 状态未提供</p>
          <p class="fan-note-strong">结果为预生成</p>
          <p class="fan-note">公开版不连模型</p>
        </section>
        <section class="fan-panel" data-fan-panel="about" hidden>
          <dl class="kv">
            <dt>名称</dt><dd>LOCUS · 科研上下文工作台</dd>
            <dt>版本</dt><dd data-build-version>—</dd>
            <dt>数据</dt><dd>预生成 · 只读</dd>
          </dl>
        </section>
      </div>
    </section>
  </div>`;
}

function buildFanArt() {
  const ribs = aside.querySelector("[data-fan-ribs]");
  ribs.innerHTML = Array.from({ length: G.N }, (_, i) => {
    const d = ribDeg(i);
    const guard = i === 0 || i === G.N - 1;
    const a = guard ? 3.4 : 2.2;
    const b = guard ? 6.2 : 4.2;
    const tip = pt(d, G.R);
    const inn = pt(d, 18);
    const nx = Math.sin(rad(d));
    const ny = Math.cos(rad(d));
    const tl = { x: tip.x + nx * b, y: tip.y + ny * b };
    const tr = { x: tip.x - nx * b, y: tip.y - ny * b };
    const il = { x: inn.x + nx * a, y: inn.y + ny * a };
    const ir = { x: inn.x - nx * a, y: inn.y - ny * a };
    const rank = G.N - 1 - i; // 最右骨先动，依次带出
    const hi0 = pt(d, 34);
    const hi1 = pt(d, G.R - 8);
    return `<g class="fan-rib" style="--fold:${(-(G.T1 - d)).toFixed(1)}deg;--k:${rank}">` +
      `<path class="rib-blade" d="M${il.x},${il.y} L${tl.x},${tl.y} L${tr.x},${tr.y} L${ir.x},${ir.y} Z"/>` +
      `<path class="rib-hi" d="M${hi0.x},${hi0.y} L${hi1.x},${hi1.y}" transform="translate(${(nx * -0.9).toFixed(2)},${(ny * -0.9).toFixed(2)})"/></g>`;
  }).join("");

  const a = pt(G.T0, G.R_SILK);
  const b = pt(G.T1, G.R_SILK);
  const c = pt(G.T1, G.R_IN);
  const e = pt(G.T0, G.R_IN);
  const ring = `M${e.x},${e.y} L${a.x},${a.y} A${G.R_SILK},${G.R_SILK} 0 0 0 ${b.x},${b.y} L${c.x},${c.y} A${G.R_IN},${G.R_IN} 0 0 1 ${e.x},${e.y} Z`;
  const folds = Array.from({ length: G.N - 2 }, (_, k) => {
    const d = ribDeg(k + 1);
    const p = pt(d, G.R_IN);
    const q = pt(d, G.R_SILK);
    return p.x + "," + p.y + " L" + q.x + "," + q.y;
  }).join(" M");
  aside.querySelector("[data-fan-silk]").innerHTML =
    `<path class="silk" d="${ring}"/><path class="grain" d="${ring}"/>` +
    `<path class="edge" d="M${a.x},${a.y} A${G.R_SILK},${G.R_SILK} 0 0 0 ${b.x},${b.y}"/>` +
    `<path class="fold" d="M${folds}"/>` +
    `<path class="edge2" d="M${e.x},${e.y} A${G.R_IN},${G.R_IN} 0 0 1 ${c.x},${c.y}"/>`;

  // 题签落在第 8 / 5 / 2 根骨的裸露段（r≈125），阶梯斜排
  aside.querySelector("[data-fan-tabs]").innerHTML = TABS.map(([k, l, i]) => {
    const p = pt(ribDeg(i), 125);
    return `<button class="fan-tab" type="button" data-fan-tab="${k}" style="left:${((p.x / G.BOX) * 100).toFixed(2)}%;top:${((p.y / G.BOX) * 100).toFixed(2)}%">${l}</button>`;
  }).join("");
  aside.querySelector("[data-sheet-tabs]").innerHTML = TABS.map(
    ([k, l]) => `<button type="button" data-fan-tab="${k}">${l}</button>`
  ).join("");
}

function setTab(tab) {
  if (!aside) return;
  const known = TABS.some(([k]) => k === tab);
  const t = known ? tab : "appearance";
  state.tab = t;
  aside.querySelectorAll("[data-fan-tab]").forEach((b) => {
    b.setAttribute("aria-current", b.dataset.fanTab === t ? "true" : "false");
  });
  aside.querySelectorAll(".fan-panel").forEach((p) => {
    p.hidden = p.dataset.fanPanel !== t;
  });
  if (t === "models") syncModelStatus();
  if (t === "about") syncAbout();
}

// ── 位置与降级 ───────────────────────────────────────────
function pinToGlyph() {
  const glyph = entry?.querySelector?.(".settings-glyph") || entry;
  const r = glyph?.getBoundingClientRect?.();
  let px = 96;
  let py = 24;
  if (r && r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0) {
    px = r.left + r.width / 2;
    py = window.innerHeight - (r.top + r.height / 2);
  }
  const S = Math.max(
    240,
    Math.min(window.innerHeight, 900, (window.innerWidth - 8 - px) / (1 - 40 / 760))
  );
  aside.style.setProperty("--px", px.toFixed(1) + "px");
  aside.style.setProperty("--py", py.toFixed(1) + "px");
  aside.style.setProperty("--S", S.toFixed(1) + "px");
  aside.dataset.fanSheet = S < 620 ? "true" : "false";
}

// ── 开合 ─────────────────────────────────────────────────
function activeTabButton() {
  const all = [...aside.querySelectorAll(`[data-fan-tab="${state.tab}"]`)];
  return all.find((b) => b.getClientRects().length) || all[0] || aside;
}
function setEntriesExpanded(v) {
  const targets = [entry, document.querySelector("#settings-open")].filter(Boolean);
  targets.forEach((el) => el.setAttribute("aria-expanded", v ? "true" : "false"));
}
function open(tab) {
  if (!aside) return;
  const t = tab || cfg.defaultTab;
  const willOpen = new CustomEvent("locus-settings:will-open", { cancelable: true, detail: { tab: t } });
  if (!document.dispatchEvent(willOpen)) return;
  try { cfg.beforeOpen?.(); } catch { /* 忽略 */ }

  if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
  const wasClosing = state.closing || Boolean(aside.dataset.closing);
  if (!state.open && !wasClosing) state.lastFocus = document.activeElement;
  state.open = true;
  state.closing = false;
  delete aside.dataset.closing;

  pinToGlyph();
  setTab(t);
  aside.hidden = false;
  if (scrim) scrim.hidden = false;
  setEntriesExpanded(true);

  const kick = () => {
    if (!state.open) return;
    aside.classList.add("is-open");
    scrim?.classList.add("is-on");
  };
  if (isReduced()) kick();
  else requestAnimationFrame(() => requestAnimationFrame(kick));

  setTimeout(() => {
    if (!state.open) return;
    const target = activeTabButton();
    target?.focus?.({ preventScroll: true });
  }, isReduced() ? 0 : 30);

  document.dispatchEvent(new CustomEvent("locus-settings:open", { detail: { tab: state.tab } }));
}
function finishClose() {
  if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
  state.closing = false;
  if (!aside) return;
  aside.hidden = true;
  delete aside.dataset.closing;
  if (scrim) {
    scrim.classList.remove("is-on");
    scrim.hidden = true;
  }
  const back = state.lastFocus;
  state.lastFocus = null;
  const restorable =
    back &&
    back !== document.body &&
    back.isConnected &&
    back.getClientRects().length &&
    (back.matches?.(FOCUSABLE) || entry?.contains?.(back));
  const target = restorable ? back : entry;
  target?.focus?.({ preventScroll: true });
  document.dispatchEvent(new CustomEvent("locus-settings:close"));
}
function close() {
  if (!aside || aside.hidden) return;
  state.open = false;
  state.closing = true;
  aside.classList.remove("is-open");
  aside.dataset.closing = "true";
  scrim?.classList.remove("is-on");
  setEntriesExpanded(false);
  const delay = isReduced() ? 0 : 380;
  if (!delay) { finishClose(); return; }
  state.timer = setTimeout(finishClose, delay);
}
function toggle(tab) {
  if (state.open) close();
  else open(tab);
}

// ── 焦点限制 ─────────────────────────────────────────────
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
function trapTab(ev) {
  if (!state.open || ev.key !== "Tab") return;
  const items = [...aside.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length);
  if (!items.length) {
    ev.preventDefault();
    aside.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (ev.shiftKey && (active === first || !aside.contains(active))) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && (active === last || !aside.contains(active))) {
    ev.preventDefault();
    first.focus();
  }
}

// ── 入口 ─────────────────────────────────────────────────
function findEntry() {
  return document.querySelector(cfg.entrySelector) ||
    (cfg.adoptLegacyEntry ? document.querySelector("#ai-open") : null);
}
function ensureGlyph(el) {
  if (!el) return;
  if (!el.querySelector(".settings-glyph")) {
    const span = document.createElement("span");
    span.className = "settings-glyph";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = FAN_GLYPH_SVG;
    el.prepend(span);
  }
  el.setAttribute("aria-haspopup", "dialog");
  el.setAttribute("aria-controls", "settings-fan");
  if (!el.hasAttribute("aria-expanded")) el.setAttribute("aria-expanded", "false");
}
function mountEntry(el) {
  if (!el) return;
  ensureGlyph(el);
  entry = el;
}

function onClick(ev) {
  const t = ev.target;
  if (!t?.closest) return;
  if (t.closest("[data-fan-close]")) { ev.preventDefault(); close(); return; }
  const tabBtn = t.closest("[data-fan-tab]");
  if (tabBtn && aside?.contains(tabBtn)) { ev.preventDefault(); setTab(tabBtn.dataset.fanTab); return; }
  if (aside?.contains(t)) {
    const segBtn = t.closest(".seg button");
    if (segBtn) {
      const seg = segBtn.parentElement;
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b === segBtn ? "true" : "false"));
      if (seg.hasAttribute("data-density-seg")) write(KEY.density, segBtn.dataset.v);
      else if (seg.hasAttribute("data-fontsize-seg")) write(KEY.fontsize, segBtn.dataset.v);
      applyPreferences();
      syncAppearanceUi();
      ev.preventDefault();
      return;
    }
    const sw = t.closest("[data-motion-switch]");
    if (sw) {
      write(KEY.motion, isReduced() ? "full" : "reduced");
      applyPreferences();
      syncAppearanceUi();
      ev.preventDefault();
      return;
    }
    return;
  }
  const navEntry = t.closest("[data-open-settings]");
  if (navEntry) { ev.preventDefault(); open("models"); return; }
  if (entry && (t === entry || entry.contains(t))) { ev.preventDefault(); toggle("appearance"); return; }
}

function onKeydown(ev) {
  if (ev.key === "Escape") {
    if (aside && !aside.hidden) {
      if (!state.open) { finishClose(); } // 合拢收尾中：立即收尾
      else close();
      ev.preventDefault();
    }
    return;
  }
  trapTab(ev);
}

function onResize() {
  if (aside && !aside.hidden) pinToGlyph();
}

function bootstrap(options) {
  cfg = { ...DEFAULT_CONFIG, ...(options || {}) };
  if (initialized) return window.LocusSettings;
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", () => bootstrap(options), { once: true });
    return;
  }

  applyPreferences();
  if (shouldForcePaper()) applyDisplayTheme();
  document.documentElement.dataset.settingsMode = isDisplayMode() ? "display" : "normal";

  aside = document.createElement("aside");
  aside.className = "settings-fan";
  aside.id = "settings-fan";
  aside.hidden = true;
  aside.setAttribute("role", "dialog");
  aside.setAttribute("aria-modal", "true");
  aside.setAttribute("aria-labelledby", "settings-fan-title");
  aside.setAttribute("tabindex", "-1");
  aside.innerHTML = fanShellHtml();

  scrim = document.createElement("div");
  scrim.className = "settings-fan-scrim";
  scrim.hidden = true;
  scrim.setAttribute("aria-hidden", "true");

  document.body.appendChild(scrim);
  document.body.appendChild(aside);

  buildFanArt();
  mountEntry(findEntry());
  setTab(cfg.defaultTab);
  syncAppearanceUi();
  syncAbout();
  syncModelStatus();

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  scrim.addEventListener("click", close);
  window.addEventListener("resize", onResize);

  const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  mq?.addEventListener?.("change", () => {
    if (storedMotion() !== null) return;
    applyPreferences();
    syncAppearanceUi();
  });

  document.documentElement.dataset.settingsFan = "ready";
  initialized = true;

  window.LocusSettings = {
    open,
    close,
    toggle,
    setTab: (t) => { setTab(t); },
    isOpen: () => state.open,
    isDisplayMode,
    refresh: () => { syncModelStatus(); syncAbout(); syncAppearanceUi(); },
    applyPreferences,
    mountEntry,
    config: (next) => { cfg = { ...cfg, ...(next || {}) }; },
  };
  return window.LocusSettings;
}

bootstrap(window.__LOCUS_SETTINGS__);

export { bootstrap as initSettingsFan, applyPreferences };
