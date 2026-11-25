/**
 * 公开展示增强叠加层（S10-C 交付，自举模块，**不修改 app.js**）。
 *
 * 仅当 window.__LOCUS_DISPLAY__ 存在（公开展示构建）时启用；trial/原生 Node 不注入，行为零影响。
 *
 * 职责（手册 §5–§6）：
 *   1) 展示态把「生成/发送」类写按钮换成「查看已有内容」：点击弹出共用详情，显示既有产物与真正采用的上下文。
 *   2) 用站内静态文件承载 Word 导出与追溯包下载（不请求 /api）。
 *   3) 在对应页注入展示增量：方案示意图、结果图表、报告数值「90 天」逐跳贯通链。
 *   4) 局部静态引用加载失败时，保留可正常显示的页面，给出可见提示与「重试」恢复入口。
 *   5) 展示态自动选中预存课题的方案/执行/对话（驱动既有左栏点击，不改状态结构）。
 *
 * 数据来源单一：A 的静态快照（/demo-data），经 /display/display-api.js 只读适配。缺项不补造。
 */

const CFG = (typeof window !== "undefined" && window.__LOCUS_DISPLAY__) || null;
if (CFG && typeof CFG === "object") boot();

const LOG = (...a) => { try { console.debug("[display-extras]", ...a); } catch { /* 忽略 */ } };

function boot() {
  const state = { api: null, ready: false, injected: new WeakSet(), panel: null, missingRegion: {} };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ── 等展示模式就绪（app.js installDisplayMode 后置 dataset.displayMode=on）──
  function whenDisplayReady(cb) {
    if (document.documentElement.dataset.displayMode === "on") return cb();
    const obs = new MutationObserver(() => {
      if (document.documentElement.dataset.displayMode === "on") { obs.disconnect(); cb(); }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-display-mode"] });
    setTimeout(() => { if (document.documentElement.dataset.displayMode === "on") { obs.disconnect(); cb(); } }, 8000);
  }

  whenDisplayReady(async () => {
    try {
      const mod = await import("./display-api.js");
      state.api = await mod.createDisplayApi({ baseUrl: CFG.baseUrl, topicId: CFG.topicId, zipUrl: CFG.zipUrl });
      state.ready = true;
    } catch (e) {
      LOG("展示 API 装载失败：", String(e?.message ?? e));
    }
    install();
  });

  // ── 写按钮 → 查看已有内容 ──────────────────────────────
  // 选择器 → { label, view }。view 决定详情面板呈现哪个既有产物与上下文。
  const VIEW_ACTIONS = [
    { sel: "#an-recommend", label: "查看已有方法推荐", view: "recommend" },
    { sel: "#res-submit", label: "查看已有结果", view: "result" },
    { sel: "#rep-create", label: "查看已有初稿", view: "report" },
    { sel: ".rep-draft", label: "查看已有初稿", view: "report" },
    { sel: "#chat-send", label: "查看已有对话", view: "chat" },
  ];
  const DOWNLOAD_ACTIONS = [
    { sel: ".rep-docx", kind: "docx", label: "下载 Word（站内文件）" },
    { sel: ".rep-trace", kind: "trace", label: "下载追溯包（站内文件）" },
  ];

  function relabel(root = document) {
    for (const a of VIEW_ACTIONS) {
      for (const el of $$(a.sel, root)) {
        if (el.dataset.dxAction) continue;
        el.dataset.dxAction = a.view;
        el.dataset.dxLabel = a.label;
        el.classList.add("dx-view");
        if (el.tagName === "BUTTON" || el.tagName === "A") el.textContent = a.label;
      }
    }
    for (const a of DOWNLOAD_ACTIONS) {
      for (const el of $$(a.sel, root)) {
        if (el.dataset.dxDownload) continue;
        el.dataset.dxDownload = a.kind;
        el.classList.add("dx-download");
      }
    }
  }

  // 捕获阶段拦截：阻止 app.js 的写流程，改执行「查看已有内容 / 真实下载」。
  document.addEventListener(
    "click",
    (ev) => {
      const t = ev.target;
      const retryEl = t?.closest?.("[data-dx-retry]");
      if (retryEl) { ev.preventDefault(); retryRegion(retryEl.dataset.dxRetry); return; }
      const closeEl = t?.closest?.("[data-dx-close]");
      if (closeEl && state.panel) { state.panel.hidden = true; return; }
      const viewEl = t?.closest?.(".dx-view");
      const dlEl = t?.closest?.(".dx-download");
      if (viewEl) { ev.preventDefault(); ev.stopImmediatePropagation(); openView(viewEl.dataset.dxAction, viewEl); return; }
      if (dlEl) { ev.preventDefault(); ev.stopImmediatePropagation(); downloadExport(dlEl.dataset.dxDownload); return; }
    },
    true,
  );

  // ── 共用详情面板 ────────────────────────────────────────
  function ensurePanel() {
    if (state.panel) return state.panel;
    const wrap = document.createElement("div");
    wrap.id = "locus-dx-panel";
    wrap.className = "dx-panel";
    wrap.hidden = true;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "dx-title");
    wrap.innerHTML = `
      <div class="dx-scrim" data-dx-close></div>
      <div class="dx-card">
        <div class="dx-head"><strong id="dx-title">查看已有内容</strong>
          <span class="dx-badge" data-dx-badge>展示 · 只读</span>
          <button class="dx-x" type="button" data-dx-close aria-label="关闭">关闭 ✕</button></div>
        <div class="dx-body" data-dx-body></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-dx-close]")) { wrap.hidden = true; }
      const rb = ev.target.closest("[data-dx-retry]");
      if (rb) { retryRegion(rb.dataset.dxRetry); }
    });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !wrap.hidden) wrap.hidden = true; });
    state.panel = wrap;
    return wrap;
  }
  function showPanel(title, badge, html) {
    const p = ensurePanel();
    $("#dx-title", p).textContent = title;
    $("[data-dx-badge]", p).textContent = badge;
    $("[data-dx-body]", p).innerHTML = html;
    p.hidden = false;
  }

  const refChip = (kind, id, label, version) =>
    `<button type="button" class="dx-ref" data-dx-kind="${esc(kind)}" data-dx-id="${esc(id)}" title="查看该对象">${esc(label || `${kind}:${String(id).slice(0, 14)}…`)}${version ? ` <span class="dx-ver">${esc(version)}</span>` : ""}</button>`;

  function openView(kind, el) {
    ensurePanel();
    const body = $("[data-dx-body]", ensurePanel());
    body.innerHTML = `<p class="dx-hint">读取已有内容…</p>`;
    const p = ensurePanel();
    p.hidden = false;
    showPanel(el?.dataset.dxLabel || "查看已有内容", "展示 · 只读", `<p class="dx-hint">读取已有内容…</p>`);
    Promise.resolve(renderView(kind)).then((html) => { $("[data-dx-body]", p).innerHTML = html; }).catch((e) => {
      $("[data-dx-body]", p).innerHTML = `<p class="dx-warn">读取失败：${esc(String(e?.message ?? e))}</p>`;
    });
  }

  async function renderView(kind) {
    if (!state.ready) return `<p class="dx-warn">展示适配器未就绪。</p>`;
    const st = await state.api.getState();
    if (kind === "recommend") {
      const t = (st.analysisTasks || [])[0];
      if (!t) return `<p class="dx-warn">缺项：快照无分析任务。</p>`;
      const rec = t.recommendation || t.snapshot || null;
      const core = (t.core || []).map((r) => refChip(r.kind, r.id, r.kind + " · " + String(r.id).slice(0, 12))).join(" ");
      const opt = (t.optional || []).filter((o) => o.included).map((o) => refChip(o.ref.kind, o.ref.id, o.ref.kind + " · " + String(o.ref.id).slice(0, 12))).join(" ");
      return `<p class="dx-k">既有方法推荐</p>
        <p class="dx-v">${esc(t.title || "—")}</p>
        <p class="dx-k">真正采用的上下文（冻结快照）</p>
        <p class="dx-hint">子问题：${esc(t.subquestionId ? String(t.subquestionId).slice(0, 18) + "…" : "未标")} · 任务 ${esc(String(t.id).slice(0, 18))}…</p>
        <p class="dx-hint">核心输入：${core || "（无）"}</p>
        <p class="dx-hint">已选候选：${opt || "（无）"}</p>
        ${rec ? `<p class="dx-hint">推荐用途/快照：${esc(rec.purpose || t.snapshot?.purpose || JSON.stringify(rec).slice(0, 120))}</p>` : `<p class="dx-hint">展示快照未导出推荐正文（缺项，不现场生成）。</p>`}
        <p class="dx-note">展示态不发起新推荐；此处只读呈现既有选择与其冻结上下文。</p>`;
    }
    if (kind === "result") {
      const r = (st.analysisResults || [])[0];
      if (!r) return `<p class="dx-warn">缺项：快照无分析结果。</p>`;
      const assets = (r.assetIds || []).map((a) => refChip("asset", a, "结果附件 · " + String(a).slice(0, 12))).join(" ");
      return `<p class="dx-k">既有结果</p>
        <p class="dx-v">${esc(r.method || "—")}</p>
        <p class="dx-hint">参数：${esc(r.params || "—")}</p>
        <p class="dx-hint">版本：r${esc(r.revision)} · 可复现：${r.reproducible ? "是" : "否"}</p>
        <p class="dx-hint">附件：${assets || "（无）"}</p>
        <p class="dx-note">${esc(r.note || "")}</p>
        <p class="dx-note">展示态不提交新结果；此处只读呈现既有结果与其固定附件。</p>`;
    }
    if (kind === "report") {
      const rep = (st.reports || [])[0];
      if (!rep) return `<p class="dx-warn">缺项：快照无分析初稿。</p>`;
      const blocks = [...(rep.blocks || [])].sort((a, b) => a.order - b.order)
        .map((b, i) => `<li><b>#${i + 1} [${esc(b.nature)}]</b> ${esc(b.text)} <span class="dx-hint">引用：${(b.refs || []).filter((r) => r.kind !== "note").map((r) => esc(r.label || r.id)).join("；") || "无"}</span></li>`).join("");
      return `<p class="dx-k">既有分析初稿 · 第 ${esc(rep.revision)} 版</p>
        <ul class="dx-blocks">${blocks || "<li>（无块）</li>"}</ul>
        <p class="dx-hint">钉住结果：${(rep.pinned?.resultIds || []).map((id) => esc(String(id).slice(0, 16))).join("、") || "无"}</p>
        <p class="dx-note">初稿由人工撰写/复核（非模型生成）；展示态不新建、不生成草稿。</p>`;
    }
    if (kind === "chat") {
      const c = (st.chats || [])[0];
      if (!c) return `<p class="dx-warn">缺项：快照无对话。</p>`;
      const msgs = (c.messages || []).map((m) => `<div class="dx-msg ${m.role}"><span class="dx-role">${m.role === "user" ? "研究者" : "助手"}</span><p>${esc(m.content)}</p>${m.curated ? `<span class="dx-tag">展示补录 · 人工整理</span>` : ""}${m.snapshot?.model ? `<span class="dx-tag">历史记录 · ${esc(m.snapshot.model)}</span>` : ""}</div>`).join("");
      const scope = (c.scope || []).map((s) => refChip(s.kind, s.id, s.kind + ":" + String(s.id).slice(0, 12))).join(" ");
      return `<p class="dx-k">既有对话</p>
        <p class="dx-hint">范围：${(c.scope || []).length} 个对象 ${scope}</p>
        <div class="dx-thread">${msgs || "<p class='dx-hint'>（无消息）</p>"}</div>
        <p class="dx-note">${esc(c.displayNote || "展示态不实时发送；此处只读呈现既有对话与冻结范围。")}</p>`;
    }
    return `<p class="dx-warn">未知内容：${esc(kind)}</p>`;
  }

  // ── 下载站内导出文件 ────────────────────────────────────
  async function downloadExport(kind) {
    if (!state.ready) return;
    try {
      const ex = await state.api.exports();
      const f = kind === "trace" ? ex.trace : ex.docx;
      const a = document.createElement("a");
      a.href = f.url; a.download = f.fileName; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      LOG("下载导出：", f.fileName, f.url);
    } catch (e) {
      showPanel("下载失败", "展示 · 只读", `<p class="dx-warn">导出文件不可用：${esc(String(e?.message ?? e))}</p><p class="dx-note">样本 ZIP 仍可在右栏「样本与来源」下载。</p>`);
    }
  }

  // ── 展示增量：方案图 / 结果图 / 90 天链 ────────────────────
  function figureFlowHtml(fig) {
    const nodes = fig.nodes || [], edges = fig.edges || [];
    const colW = 260, rowH = 74, boxH = 46;
    const pos = new Map(nodes.map((n, i) => [n.id, { x: 16, y: 12 + i * rowH }]));
    const width = colW + 32, height = 12 + nodes.length * rowH;
    const arrows = edges.map((e) => { const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return ""; return `<path d="M${a.x + colW - 40},${a.y + boxH / 2} L${a.x + colW - 40},${b.y + boxH / 2}" fill="none" stroke="#c9b79b" stroke-width="1.4" marker-end="url(#dx-arrow)"/>`; }).join("");
    const boxes = nodes.map((n) => { const p = pos.get(n.id); return `<g><rect x="${p.x}" y="${p.y}" width="${colW - 40}" height="${boxH}" rx="8" fill="#fbf6ec" stroke="#8c7a63" stroke-width="1.2"/><text x="${p.x + 12}" y="${p.y + 20}" font-size="12.5" fill="#3a3128">${esc(String(n.label).slice(0, 22))}</text>${n.note ? `<text x="${p.x + 12}" y="${p.y + 36}" font-size="10.5" fill="#8c7a63">${esc(String(n.note).slice(0, 26))}</text>` : ""}</g>`; }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="方案流程示意"><defs><marker id="dx-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#c9b79b"/></marker></defs>${arrows}${boxes}</svg>`;
  }
  function figureBarHtml(ch) {
    const rows = ch.rows || [];
    const w = 360, rowh = 46, pad = 8, labelW = 96, plotW = w - labelW - 60;
    const max = Math.max(1, ...rows.flatMap((r) => [r.fresh ?? 0, r.dried ?? 0]));
    const bars = rows.map((r, i) => {
      const y = pad + i * rowh;
      const bw = (v) => Math.max(1, ((v ?? 0) / max) * plotW);
      const f = r.fresh ?? 0, d = r.dried ?? 0;
      return `<text x="0" y="${y + 20}" font-size="12" fill="#3a3128">${esc(r.item)}</text>
        <rect x="${labelW}" y="${y + 4}" width="${bw(f)}" height="14" fill="${ch.series?.[0]?.color || "#8c7a63"}"/><text x="${labelW + bw(f) + 4}" y="${y + 15}" font-size="11" fill="#6b5f4e">新鲜 ${esc(String(r.fresh ?? "—"))}</text>
        <rect x="${labelW}" y="${y + 22}" width="${bw(d)}" height="14" fill="${ch.series?.[1]?.color || "#a63f2e"}"/><text x="${labelW + bw(d) + 4}" y="${y + 33}" font-size="11" fill="#6b5f4e">干燥 ${esc(String(r.dried ?? "—"))}</text>`;
    }).join("");
    const height = pad * 2 + rows.length * rowh + 12;
    return `<svg viewBox="0 0 ${w} ${height}" width="100%" role="img" aria-label="漂浮天数对比图">${bars}</svg>`;
  }

  /** 通用可重试区域：只替换区域自身内容（不覆盖宿主），失败给提示 + 重试。 */
  function retryRegionHost(key, renderHtml, host) {
    let box = host.querySelector(`[data-dx-region="${key}"]`);
    if (!box) {
      box = document.createElement("div");
      box.className = "dx-region";
      box.setAttribute("data-dx-region", key);
      host.appendChild(box);
    }
    const run = () => {
      box.innerHTML = `<p class="dx-hint">读取中…</p>`;
      Promise.resolve(renderHtml()).then((html) => { box.innerHTML = html; }).catch((e) => {
        state.missingRegion[key] = true;
        box.innerHTML = `<div class="dx-fail"><p class="dx-warn">该区域暂时加载失败（引用文件不可读）。</p>
          <p class="dx-hint">${esc(String(e?.message ?? e))}</p>
          <button type="button" class="dx-retry" data-dx-retry="${esc(key)}">重试读取该区域</button></div>`;
      });
    };
    box.__run = run;
    run();
  }
  function retryRegion(key) {
    const box = $(`[data-dx-region="${key}"]`);
    if (box?.__run) box.__run();
  }

  async function renderProtocolFigure(host) {
    retryRegionHost("fig-protocol", async () => {
      const figs = await state.api.reloadFigures();
      const pid = CFG.topicId && state.api.protocolFigure ? await state.api.protocolFigure().then((f) => f.protocolId).catch(() => null) : null;
      const fig = (pid && figs.protocolFigures?.[pid]) || Object.values(figs.protocolFigures || {})[0];
      if (!fig) throw new Error("图形文件不含方案示意图");
      return `<div class="dx-figbox"><p class="dx-figcap">${esc(fig.title)}</p>${figureFlowHtml(fig)}<p class="dx-hint">${esc(fig.caption)}</p></div>`;
    }, host);
  }
  async function renderResultChart(host) {
    retryRegionHost("fig-result", async () => {
      const figs = await state.api.reloadFigures();
      const ch = Object.values(figs.charts || {})[0];
      if (!ch) throw new Error("图形文件不含图表");
      return `<div class="dx-figbox"><p class="dx-figcap">${esc(ch.title)}</p>${figureBarHtml(ch)}<p class="dx-hint">${esc(ch.caption)}</p></div>`;
    }, host);
  }
  async function renderChain90(host) {
    retryRegionHost("chain-90", async () => {
      const c = state.api.reloadChain90 ? await state.api.reloadChain90() : await state.api.chain90();
      const hops = (c.hops || []).map((h) => {
        const via = h.direct ? "" : ` <span class="dx-hint">（经 ${esc(h.via || "对象")}；${esc(h.note || "无直接引用边")}）</span>`;
        const ver = h.version || (h.revision ? `r${h.revision}` : "");
        return `<li>${refChip(h.kind, h.id, `${h.hop}. ${h.label}`, ver)}${via}</li>`;
      }).join("");
      return `<div class="dx-chain"><p class="dx-figcap">数值贯通链：「${esc(c.subject)} = ${esc(c.value)} ${esc(c.unit)}」</p>
        <ol class="dx-hops">${hops}</ol><p class="dx-hint">${esc(c.deeper || "")}</p></div>`;
    }, host);
  }

  // ── 注入到页面（观测 DOM 变化）─────────────────────────
  function inject() {
    const nav = document.body.dataset.nav;
    relabel(document);
    if (nav === "protocol") {
      const host = $("#right-content");
      if (host && !host.querySelector('[data-dx-region="fig-protocol"]')) {
        const card = document.createElement("div"); card.className = "item dx-card-item";
        card.innerHTML = `<p class="dx-k">方案示意图 · 据方案步骤生成</p>`;
        host.prepend(card);
        renderProtocolFigure(card);
      }
    }
    if (nav === "analysis") {
      const host = $("#right-content");
      if (host && !host.querySelector('[data-dx-region="chain-90"]')) {
        const card = document.createElement("div"); card.className = "item dx-card-item";
        card.innerHTML = `<p class="dx-k">展示增量</p><div data-dx-region="chain-90"></div><div data-dx-region="fig-result"></div>
          <div class="dx-exports-row" data-dx-exports></div>`;
        host.appendChild(card);
        renderChain90(card);
        renderResultChart(card);
        renderExportLinks($("[data-dx-exports]", card));
      }
    }
  }

  async function renderExportLinks(host) {
    if (!host) return;
    host.innerHTML = `<p class="dx-hint">读取导出文件…</p>`;
    try {
      const ex = await state.api.exports();
      host.innerHTML = `<p class="dx-k">导出（同一固定版本 · 站内文件）</p>
        <a class="dx-dl" href="${esc(ex.docx.url)}" download="${esc(ex.docx.fileName)}">下载 Word（${esc(ex.docx.fileName)}）</a>
        <a class="dx-dl" href="${esc(ex.trace.url)}" download="${esc(ex.trace.fileName)}">下载追溯包（${esc(ex.trace.fileName)}）</a>
        <p class="dx-hint">Word：块顺序/性质/固定引用；追溯包：report.docx＋versions.json＋manifest。</p>`;
    } catch (e) {
      host.innerHTML = `<p class="dx-warn">导出文件不可用：${esc(String(e?.message ?? e))}</p>`;
    }
  }

  // ── 展示态自动选中预存方案/执行/对话 ──────────────────────
  const AUTO_SEL = { protocol: "[data-pid]", record: "[data-eid]", chat: "[data-cid]" };
  function autoSelect(nav) {
    const sel = AUTO_SEL[nav];
    if (!sel) return;
    const host = $("#material-list");
    if (!host) return;
    const first = host.querySelector(sel);
    if (!first) return;
    if (first.classList.contains("active")) return;
    try { first.click(); } catch { /* 忽略 */ }
  }

  // ── 观测：页面切换 / 重渲染后重新施加 ─────────────────────
  function install() {
    const apply = () => { try { inject(); autoSelect(document.body.dataset.nav); } catch (e) { LOG("inject 失败：", String(e?.message ?? e)); } };
    const mo = new MutationObserver(apply);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-nav"], subtree: false });
    for (const id of ["#mid-content", "#right-content", "#material-list"]) {
      const el = $(id);
      if (el) mo.observe(el, { childList: true, subtree: true });
    }
    apply();
    LOG("已就绪（展示增量叠加层）");
  }

  // 供独立验收脚本探测
  window.__LOCUS_DX__ = {
    isDisplayMode: () => !!CFG,
    relabel: () => relabel(document),
    inject: () => { inject(); },
    downloads: async () => state.api?.exports ? await state.api.exports() : null,
    hasPanel: () => !!state.panel && !state.panel.hidden,
  };
}
