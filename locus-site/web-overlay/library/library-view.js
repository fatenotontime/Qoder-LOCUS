/**
 * 文献库可视化 · 嵌入视图（S09 只读展示）
 *
 * 用法（在既有三栏工作台内部，给定容器内渲染）：
 *   import { renderLibraryPane } from "/library/library-view.js";
 *   renderLibraryPane(document.getElementById("lv-mount"), { baseUrl: "/demo-data" });
 *
 * 约定：
 * - 只读。数据来自 demo-data 快照（a-snapshot → snapshot-adapter），不触达 /api，不写。
 * - 不产生自己的 <html> 外壳、不接管路由；只在 container 内渲染。
 * - 缺项（对象/版本/来源缺失）抛 DemoMissingError 或就地显示「缺项」原因，**不补造数据**。
 */
import { loadASnapshot } from "./a-snapshot.js";
import { createDemoData, DemoMissingError } from "./snapshot-adapter.js";

const CSS_URL = new URL("./library-view.css", import.meta.url).href;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const AUDIT = { confirm: "已确认", need_info: "待补", unreviewed: "未审", exclude: "排除", skip: "跳过" };
const auditLabel = (a) => AUDIT[a] ?? a ?? "未审";
const VIEWS = [["original", "原文定位"], ["cards", "证据卡"], ["compare", "两端对照"], ["backtrace", "引用回查"]];

function ensureCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[data-lv-css="1"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = CSS_URL; l.dataset.lvCss = "1";
  document.head.appendChild(l);
}

/** 在原文中高亮引文（逐字命中才高亮；否则明示「未逐字命中」）。 */
function markQuote(text, quote) {
  const escd = esc(text);
  if (!quote) return escd;
  const h = esc(quote);
  return escd.includes(h)
    ? escd.split(h).join(`<mark>${h}</mark>`)
    : `${escd}<p class="lv-miss-inline">证据引文未在原件中逐字命中（可能为节选）：${esc(quote)}</p>`;
}

function missHtml(e) {
  const path = e instanceof DemoMissingError ? e.path : "未知";
  const reason = e instanceof DemoMissingError ? e.reason : String(e?.message ?? e);
  return `<div class="lv-miss" role="alert"><div class="lv-miss-t">本栏读取缺项</div>
    <p>路径：<code>${esc(path)}</code></p><p>原因：${esc(reason)}</p></div>`;
}

export async function renderLibraryPane(container, options = {}) {
  if (!container) throw new Error("renderLibraryPane 需要 container 元素");
  ensureCss();
  const baseUrl = options.baseUrl ?? "/demo-data";
  const st = {
    d: null, meta: null,
    paperId: null, view: "original", openCard: null, backtraceOf: null, hl: null,
  };

  container.classList.add("lv-root");
  container.setAttribute("aria-busy", "true");
  container.innerHTML = `<div class="lv-loading">读取预置文献…</div>`;

  let snapshot;
  try {
    snapshot = options.snapshot ?? await loadASnapshot({ baseUrl, fetch: options.fetch, zipUrl: options.zipUrl ?? `${baseUrl}/locus-demo-public.zip` });
  } catch (e) {
    container.removeAttribute("aria-busy");
    container.innerHTML = missHtml(e);
    throw e;
  }
  st.d = createDemoData(snapshot, { topicId: options.topicId });
  st.meta = st.d.meta();
  st.paperId = st.d.listPapers(st.meta.mainTopicId)[0]?.id ?? null;

  container.innerHTML = "";
  container.removeAttribute("aria-busy");

  container.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-lv]");
    if (!el) return;
    const a = el.dataset.lv;
    try {
      if (a === "paper") { st.paperId = el.dataset.id; st.openCard = null; st.backtraceOf = null; st.hl = null; render(); }
      else if (a === "view") { st.view = el.dataset.view; render(); }
      else if (a === "card") { st.openCard = st.openCard === el.dataset.id ? null : el.dataset.id; render(); }
      else if (a === "locate") { st.view = "original"; st.hl = el.dataset.quote || null; render(); locateInto(el.dataset.quote); }
      else if (a === "cmpcard") { st.view = "cards"; st.openCard = el.dataset.card; render(); }
      else if (a === "backtrace") { st.view = "backtrace"; st.backtraceOf = { kind: el.dataset.kind, id: el.dataset.id }; render(); }
      else if (a === "viewreset") { st.view = "backtrace"; st.backtraceOf = null; render(); }
    } catch (e) {
      renderMiss(e);
    }
  });

  function locateInto(quote) {
    const srcEl = container.querySelector(".lv-src");
    if (srcEl && quote) {
      const mark = srcEl.querySelector("mark");
      if (mark) mark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function render() {
    try {
      container.innerHTML = shellHtml();
    } catch (e) {
      renderMiss(e);
    }
  }
  function renderMiss(e) {
    container.innerHTML = `<div class="lv-panel">${missHtml(e)}</div>`;
  }

  function papers() { return st.d.listPapers(st.meta.mainTopicId); }

  function shellHtml() {
    const d = st.d, papersL = papers();
    const topic = d.getMainTopic();
    const fixture = d.isFixture();
    const papersRows = papersL.map((p) => {
      const cards = safe(() => d.listCards({ paperId: p.id }), []);
      const pending = cards.filter((c) => c.audit !== "confirm").length;
      return `<button class="lv-paper${st.paperId === p.id ? " active" : ""}" type="button" data-lv="paper" data-id="${esc(p.id)}"${st.paperId === p.id ? ' aria-current="true"' : ""}>
        <span class="lv-ptitle">${esc(p.title)}</span>
        <span class="lv-pmeta">${esc(p.year || "年份未标注")} · ${esc(p.license || "许可未提供")} · 卡 ${cards.length}${pending ? ` · ${pending} 待审` : ""}</span>
      </button>`;
    }).join("") || `<p class="lv-hint">快照无文献条目。</p>`;

    return `<div class="lv-wrap">
      <header class="lv-head">
        <div class="lv-headl"><span class="lv-seal" aria-hidden="true">库</span><b>文献库</b><span class="lv-sub">只读 · 预置展示</span></div>
        <div class="lv-headmeta"><span class="lv-topic">${esc(topic.name)}</span>${fixture ? `<span class="lv-badge warn">接线夹具</span>` : ""}</div>
      </header>
      <div class="lv-grid">
        <aside class="lv-side" aria-label="论文条目">
          <div class="lv-sidehead">论文条目（${papersL.length}）</div>
          ${papersRows}
        </aside>
        <section class="lv-main" aria-label="文献库内容">${mainHtml()}</section>
      </div>
    </div>`;
  }

  function mainHtml() {
    const tabs = `<div class="lv-tabs">${VIEWS.map(([k, l]) => `<button class="lv-tab${st.view === k ? " on" : ""}" type="button" data-lv="view" data-view="${k}">${l}</button>`).join("")}</div>`;
    let body;
    try {
      if (st.view === "original") body = viewOriginal();
      else if (st.view === "cards") body = viewCards();
      else if (st.view === "compare") body = viewCompare();
      else body = viewBacktrace();
    } catch (e) {
      body = missHtml(e);
    }
    return tabs + body;
  }

  function currentPaper() {
    const p = st.paperId ? safe(() => st.d.getPaper(st.paperId), null) : null;
    if (!p) throw new DemoMissingError(`paper:${st.paperId ?? "(none)"}`, "未选择或不存在论文条目");
    return p;
  }
  function firstAttachment(paper) {
    const atts = st.d.listAttachments(paper.id);
    if (!atts.length) throw new DemoMissingError(`attachments:${paper.id}`, "该条目没有附件");
    return atts[0];
  }

  // 1) 原文定位
  function viewOriginal() {
    const d = st.d, p = currentPaper(), att = firstAttachment(p);
    const asset = d.getAsset(att.assetId);
    const src = d.getOriginalUrl(att.assetId);
    const cards = d.listCards({ paperId: p.id });
    const head = `<div class="lv-panelhead">原始材料 · ${esc(asset.name)}
      <span class="lv-hint">角色 ${esc(att.role)}${st.hl ? ` · 已高亮「${esc(st.hl)}」` : ""}</span></div>`;
    const dochead = `<div class="lv-dochead"><h3>${esc(p.title)}</h3>
      <p class="lv-hint">${esc((p.authors || []).join("、"))} · ${esc(p.year || "")}${p.doi ? ` · DOI ${esc(p.doi)}` : ""} · 许可 ${esc(p.license || "未提供")}</p></div>`;
    const body = src.kind === "inline"
      ? `<article class="lv-src">${markQuote(src.text, st.hl)}</article>
         <p class="lv-hint">许可：${esc(src.license)} · ${esc(src.provenance)}${src.href ? ` · <a href="${esc(src.href)}" target="_blank" rel="noreferrer noopener">原始来源</a>` : ""}</p>`
      : `<div class="lv-block"><p>原件外链：<a href="${esc(src.href)}" target="_blank" rel="noreferrer noopener">${esc(src.href)}</a></p>
         <p class="lv-hint">许可：${esc(src.license)} · ${esc(src.provenance)}</p></div>`;
    const jumps = cards.length ? `<div class="lv-block"><h4>卡片定位</h4>${cards.map((c) => `<div class="lv-jump">
        <span class="lv-jt">${esc((c.scope || c.rawText || "").slice(0, 34))}…</span>
        <button class="lv-link" type="button" data-lv="locate" data-quote="${esc(c.locator?.sectionQuote || c.rawText || "")}">在原文中定位</button>
      </div>`).join("")}</div>` : "";
    return head + dochead + body + jumps;
  }

  // 2) 证据卡展开
  function viewCards() {
    const d = st.d, p = currentPaper();
    const cards = d.listCards({ paperId: p.id });
    if (!cards.length) return `<div class="lv-panelhead">证据卡（0）</div><p class="lv-hint">本条目暂无卡。</p>`;
    const list = cards.map((c) => {
      const open = st.openCard === c.id;
      const asset = safe(() => d.getAsset(c.assetId), null);
      const title = c.scope || (c.rawText || "").slice(0, 40);
      return `<div class="lv-card${open ? " open" : ""}">
        <button class="lv-cardbtn" type="button" data-lv="card" data-id="${esc(c.id)}" aria-expanded="${open}">
          <span class="lv-ctitle">${esc(title)}</span>
          <span class="lv-cmeta">出处：${esc(asset?.name ?? c.assetId)} · ${esc(c.locator?.sectionQuote || "未标注小节")}</span>
          <span class="lv-cstate"><span class="lv-badge ${c.audit === "confirm" ? "ok" : "warn"}">${esc(auditLabel(c.audit))}</span></span>
        </button>
        ${open ? cardDetail(c) : ""}
      </div>`;
    }).join("");
    return `<div class="lv-panelhead">证据卡（${cards.length}）<span class="lv-hint">默认折叠；点开看条件、提取字段、引文与知识条目关系。</span></div>${list}`;
  }

  function cardDetail(c) {
    const d = st.d;
    const det = d.getCardDetail(c.id); // 缺 source/item 会抛缺项
    const f = c.extracted?.fields ?? {};
    const fieldRows = Object.entries(f).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
    const conds = (det.contexts || []).map((x) => `<tr><td>${esc(x.field)}</td><td>${esc(String(x.value?.label ?? x.value?.raw ?? ""))}</td></tr>`).join("");
    const evs = (c.locator?.sectionQuote ? `<blockquote class="lv-quote">原文：${esc(c.locator.sectionQuote)}</blockquote>` : "");
    const rels = det.items.length
      ? det.items.map((it) => `<div class="lv-rel"><button class="lv-link" type="button" data-lv="backtrace" data-kind="item" data-id="${esc(it.id)}">${esc((it.text || "").slice(0, 36))}…</button>
          <span class="lv-hint">${esc(auditLabel(it.status))} · 条件 ${it.contexts.length} · 引文 ${it.evidence.length}</span></div>`).join("")
      : `<p class="lv-hint">尚无结构化知识条目。</p>`;
    return `<div class="lv-cdetail">
      <div class="lv-cdrow"><b>出处定位</b>
        <button class="lv-link" type="button" data-lv="locate" data-quote="${esc(c.locator?.sectionQuote || c.rawText || "")}">在原文中定位</button>
        ${det.source ? `<span class="lv-hint">${esc(det.source.name)}</span>` : ""}</div>
      <blockquote class="lv-quote">摘要：${esc(c.rawText || "")}</blockquote>
      ${evs}
      <table class="lv-table kv"><tbody>
        ${fieldRows || `<tr><th>提取字段</th><td class="lv-hint">未提供</td></tr>`}
        <tr><th>单位</th><td>${esc((c.extracted?.units || []).join("、") || "未提供")}</td></tr>
        <tr><th>条件</th><td>${esc((c.extracted?.conditions || []).join("；") || "未提供")}</td></tr>
        <tr><th>性质</th><td>${esc(c.kind ?? "—")}${det.secondaryCitation ? " · 综述转引（不计独立证据）" : ""}</td></tr>
        ${(c.unknowns || []).length ? `<tr><th>未知项</th><td>${esc(c.unknowns.join("；"))}</td></tr>` : ""}
      </tbody></table>
      ${conds ? `<table class="lv-table"><thead><tr><th>条件字段</th><th>值</th></tr></thead><tbody>${conds}</tbody></table>` : ""}
      <div class="lv-cdrow"><b>知识条目关系</b></div>${rels}
      <div class="lv-cdrow"><button class="lv-link" type="button" data-lv="backtrace" data-kind="card" data-id="${esc(c.id)}">引用回查此卡</button></div>
    </div>`;
  }

  // 3) 两端对照
  function viewCompare() {
    const d = st.d;
    const cmps = d.listComparisons(st.meta.mainTopicId);
    if (!cmps.length) return `<div class="lv-panelhead">两端对照</div><div class="lv-miss"><p>快照未提供比较（缺项：comparisons）。</p></div>`;
    return `<div class="lv-panelhead">两端对照</div>` + cmps.map((c) => compareHtml(c)).join("");
  }
  function compareHtml(c) {
    const d = st.d;
    const sideOf = (side) => {
      const card = (side.refs || []).find((r) => r.kind === "card");
      const cardObj = card ? safe(() => d.getCard(card.id), null) : null;
      const att = cardObj ? safe(() => d.listAttachments(cardObj.paperId ?? "").find((a) => a.assetId === cardObj.assetId), null) : null;
      const srcName = cardObj ? safe(() => d.getAsset(cardObj.assetId)?.name, card.id) : "";
      return { side, card, cardObj, att, srcName };
    };
    const sides = (c.sides || []).map(sideOf);
    return `<div class="lv-block">
      <h3>比较：${esc(c.title ?? "")}</h3>
      <p class="lv-hint">独立性：${esc(c.independenceStatus ?? "未标注")} · ${esc(c.independenceNote ?? "")}</p>
      <table class="lv-table"><thead><tr><th>来源</th><th>指标</th><th>值</th><th>条件</th><th>二手转引</th><th></th></tr></thead><tbody>
        ${sides.map(({ side, card, cardObj, att, srcName }) => `<tr>
          <td>${esc(side.label)}${srcName ? `<br/><span class="lv-hint">${esc(srcName)}</span>` : ""}</td>
          <td>${esc(side.metric ?? "")}</td><td>${esc(side.value ?? "")}</td><td>${esc(side.conditions ?? "")}</td>
          <td>${side.secondaryCitation ? `<span class="lv-badge warn">二手</span>` : "否"}</td>
          <td>${card && cardObj ? `<button class="lv-link" type="button" data-lv="cmpcard" data-card="${esc(card.id)}">看这张卡</button>
            ${att ? `<button class="lv-link" type="button" data-lv="backtrace" data-kind="card" data-id="${esc(cardObj.id)}">回查</button>` : ""}` : `<span class="lv-hint">引用缺失</span>`}</td>
        </tr>`).join("")}
      </tbody></table>
      ${(c.conditionDiff || []).length ? `<p class="lv-hint">条件差异：${c.conditionDiff.map(esc).join("；")}</p>` : ""}
      ${(c.unknownFields || []).length ? `<p class="lv-hint">未知字段：${c.unknownFields.map(esc).join("；")}</p>` : ""}
      ${c.caveat ? `<p class="lv-hint">作者说明：${esc(c.caveat)}</p>` : ""}
    </div>`;
  }

  // 4) 引用回查（网络）
  function viewBacktrace() {
    const d = st.d;
    if (!st.backtraceOf) {
      const cards = st.paperId ? d.listCards({ paperId: st.paperId }) : d.listCards({ topicId: st.meta.mainTopicId });
      return `<div class="lv-panelhead">引用回查<span class="lv-hint">选择起点对象，查看其在快照引用网络中的可达对象。</span></div>
        <div class="lv-startrow">${cards.map((c) => `<button class="lv-link" type="button" data-lv="backtrace" data-kind="card" data-id="${esc(c.id)}">${esc((c.scope || c.rawText || "").slice(0, 22))}…</button>`).join("")}</div>`;
    }
    const { kind, id } = st.backtraceOf;
    const r = d.backtrace(kind, id); // 未知起点 → 抛缺项
    const byKind = {};
    for (const n of r.nodes) (byKind[n.kind] ??= []).push(n);
    const groups = Object.entries(byKind).map(([k, ns]) => `<div class="lv-netgroup"><div class="lv-nk">${esc(k)}（${ns.length}）</div>
      <div class="lv-nodes">${ns.map((n) => `<span class="lv-node${n.key === `${kind}:${id}` ? " start" : ""}">${esc(n.label || n.id)}</span>`).join("")}</div></div>`).join("");
    const edges = r.edges.map((e) => `<li><code>${esc(e.from)}</code> —<span class="lv-ek">${esc(e.edgeKind)}</span>→ <code>${esc(e.to)}</code></li>`).join("");
    return `<div class="lv-panelhead">引用回查 · 起点 ${esc(kind)}:${esc(id)}
        <button class="lv-link" type="button" data-lv="viewreset">换起点</button></div>
      <div class="lv-block">${groups}</div>
      <div class="lv-block"><h4>关系（${r.edges.length}）</h4><ul class="lv-edges">${edges}</ul></div>`;
  }

  render();
  return { render, data: st.d, navigate: (view) => { st.view = view; render(); } };
}
