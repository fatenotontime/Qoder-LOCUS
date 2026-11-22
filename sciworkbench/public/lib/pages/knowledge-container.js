/**
 * 知识库总览容器：纯渲染，不发请求、不写状态。
 * 只消费 /api/knowledge/container 的同一次响应；计数分开写，不把已加载当全库。
 */
import { esc } from "../views.js";
import { fmtEnum, fmtReview } from "../format.js";

const DOT_LIMIT = 60;

function libOf(ui) {
  return ui?.kzLib ?? { status: "loading" };
}

export function kzLibState(ui) {
  const lib = ui?.kzLib;
  if (!lib) return "loading";
  return ["loading", "ready", "empty", "unwired", "error"].includes(lib.status) ? lib.status : "loading";
}

function refKey(r) {
  return `${r?.kind ?? "item"}:${r?.id ?? ""}@${r?.revision ?? 0}`;
}

function safeEnum(value) {
  const text = fmtEnum(value);
  return /[A-Za-z]/.test(text) ? "" : text;
}

function safeReview(value) {
  const text = fmtReview(value);
  return /[A-Za-z]/.test(text) ? "" : text;
}

function short(text, n = 32) {
  const s = String(text ?? "").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function topicName(state, data, ui) {
  const id = data?.scope?.topicId ?? ui?.topicId ?? "";
  if (!id) return "未选定课题";
  return state.topics?.find((t) => t.id === id)?.name ?? "当前课题";
}

function sourceNames(state, data) {
  const out = new Map();
  for (const s of data?.sources ?? []) {
    const ref = s.ref ?? {};
    const name = ref.kind === "paper"
      ? state.papers?.find((p) => p.id === ref.id)?.title
      : ref.kind === "asset"
        ? state.assets?.find((a) => a.id === ref.id)?.name
        : "";
    out.set(s.token, name ? `${s.token} · ${short(name, 24)}` : `来源 ${s.token}`);
  }
  return out;
}

function themeNames(data) {
  return new Map((data?.byTheme ?? []).map((t) => [t.themeId, t.name || "未命名主题"]));
}

function displayLabel(e) {
  if (e.kind === "dataset") {
    return e.aggregate ? `数据集聚合（${e.aggregate.rows} 行 × ${e.aggregate.columns} 列）` : "数据集聚合";
  }
  return e.label || "未命名";
}

function elementAria(e) {
  const kind = e.kind === "dataset" ? "数据集" : (safeEnum(e.nature) || safeEnum(e.contentType) || "知识项");
  const review = e.reviewStatus ? safeReview(e.reviewStatus) : "";
  return [kind, short(displayLabel(e), 40), review, e.unknownCount ? `${e.unknownCount} 个未知项` : ""].filter(Boolean).join("；");
}

function findElement(data, key) {
  return (data?.elements ?? []).find((e) => refKey(e.ref) === key) ?? null;
}

function reviewClass(e) {
  return e.reviewStatus === "confirmed" ? " is-confirmed" : e.reviewStatus === "pending" ? " is-pending" : " is-reference";
}

function dotHtml(e, selected) {
  const key = refKey(e.ref);
  return `<button type="button" class="kzlib-dot${reviewClass(e)}${e.kind === "dataset" ? " is-dataset" : ""}${selected === key ? " is-selected" : ""}" data-kzlib-el="${esc(key)}" aria-pressed="${selected === key}" aria-label="${esc(elementAria(e))}" title="${esc(short(displayLabel(e), 40))}"><span class="kzlib-dot-core" aria-hidden="true"></span></button>`;
}

function clusterHtml(label, note, els, selected) {
  const shown = els.slice(0, DOT_LIMIT);
  const rest = els.length - shown.length;
  return `<section class="kzlib-cluster">
    <div class="kzlib-cluster-head"><b>${esc(label)}</b><span>${els.length} 项</span></div>
    ${note ? `<p class="kzlib-cluster-note">${esc(note)}</p>` : ""}
    <div class="kzlib-dots">${shown.map((e) => dotHtml(e, selected)).join("")}</div>
    ${rest > 0 ? `<p class="kzlib-cluster-note">另有 ${rest} 项未在图中展开，仍可从同源列表进入。</p>` : ""}
  </section>`;
}

function clustersHtml(data, selected) {
  const byKey = new Map((data.elements ?? []).map((e) => [refKey(e.ref), e]));
  const groups = [];
  for (const theme of data.byTheme ?? []) {
    const refs = theme.memberRefs ?? [];
    const els = refs.map((r) => byKey.get(refKey(r))).filter(Boolean);
    if (!els.length) continue;
    const missing = refs.length - els.length;
    groups.push(clusterHtml(theme.name || "未命名主题", missing ? `另有 ${missing} 项不在已加载范围。` : "", els, selected));
  }
  const undivided = (data.undivided ?? []).map((r) => byKey.get(refKey(r))).filter(Boolean);
  if (undivided.length) groups.push(clusterHtml("未分主题", "尚未归入任何主题，不等于无效。", undivided, selected));
  const datasets = (data.elements ?? []).filter((e) => e.kind === "dataset");
  if (datasets.length) groups.push(clusterHtml("数据集", "按数据集聚合，不逐单元格展开。", datasets, selected));
  if (!groups.length) {
    const els = data.elements ?? [];
    if (els.length) groups.push(clusterHtml("全部已加载", "", els, selected));
  }
  return groups.join("");
}

function sourceListHtml(state, data, selected, ui) {
  const names = sourceNames(state, data);
  const byKey = new Map((data.elements ?? []).map((e) => [refKey(e.ref), e]));
  const rows = (data.bySource ?? []).map((s) => {
    const els = (s.itemRefs ?? []).map((r) => byKey.get(refKey(r))).filter(Boolean);
    if (!els.length) return "";
    return `<li>
      <div class="kzlib-source-head"><span>${esc(names.get(s.token) ?? `来源 ${s.token}`)}</span><b>${els.length} 项</b></div>
      <div class="kzlib-source-items">${els.map((e) => `<button type="button" class="kzlib-srcitem${selected === refKey(e.ref) ? " is-selected" : ""}" data-kzlib-el="${esc(refKey(e.ref))}">${esc(short(displayLabel(e), 28))}</button>`).join("")}</div>
    </li>`;
  }).join("");
  if (!rows) return `<p class="kzlib-src-empty">当前已加载范围没有可列出的同源条目。</p>`;
  return `<details class="kzlib-sources"${ui?.kzLib?.sourcesOpen ? " open" : ""}>
    <summary>同源列表 <span>可键盘逐条查看</span></summary>
    <ul>${rows}</ul>
  </details>`;
}

function detailHtml(state, data, selected) {
  const e = findElement(data, selected);
  if (!e) return `<div class="kzlib-detail is-empty"><p>点选一颗知识项，查看它的值、条件与来源。</p></div>`;
  const themes = themeNames(data);
  const names = sourceNames(state, data);
  const themeText = (e.themeIds ?? []).map((id) => themes.get(id) ?? "未命名主题");
  const conds = e.conditionTexts ?? [];
  const ref = refKey(e.ref);
  const cardId = (data.cardIndex ?? []).find((c) => (c.itemRefs ?? []).some((r) => refKey(r) === ref))?.cardId;
  const kindText = e.kind === "dataset" ? "数据集聚合" : (safeEnum(e.contentType) || "知识项");
  return `<div class="kzlib-detail">
    <div class="kzlib-detail-head">
      <b>${esc(displayLabel(e))}</b>
      <span class="kzlib-badge">${esc(kindText)}</span>
      ${e.reviewStatus ? `<span class="kzlib-badge">${esc(safeReview(e.reviewStatus))}</span>` : ""}
    </div>
    ${e.kind === "dataset" && e.aggregate ? `<p class="kzlib-detail-line">选定 ${e.aggregate.rows} 行 × ${e.aggregate.columns} 列；聚合入口，不逐格展开。</p>` : `<p class="kzlib-detail-line">值：${esc(e.valueText || "未填值")}</p>`}
    ${e.unknownCount ? `<p class="kzlib-detail-line">有 ${e.unknownCount} 个未知项，审阅时逐项标注。</p>` : ""}
    ${themeText.length ? `<p class="kzlib-detail-line">主题：${esc(themeText.join("、"))}</p>` : `<p class="kzlib-detail-line">主题：尚未归入。</p>`}
    ${conds.length ? `<div class="kzlib-detail-conds"><span>适用条件</span><ul>${conds.slice(0, 5).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>${conds.length > 5 ? `<p>另有 ${conds.length - 5} 条条件。</p>` : ""}</div>` : ""}
    <p class="kzlib-detail-line">来源：${(e.sourceTokens ?? []).map((t) => esc(names.get(t) ?? `来源 ${t}`)).join("、") || "未记录"}</p>
    ${cardId ? `<button type="button" class="kzlib-review" data-kzlib-card="${esc(cardId)}">去审阅这张卡</button>` : ""}
  </div>`;
}

function countsHtml(data) {
  const c = data.counts ?? {};
  const t = data.totals ?? {};
  return `<dl class="kzlib-counts">
    <div><dt>已加载</dt><dd>${c.loaded ?? 0} 项</dd></div>
    <div><dt>匹配</dt><dd>${c.matched ?? 0} 项</dd></div>
    <div><dt>全库</dt><dd>${c.totalKnown ?? 0} 项</dd></div>
    <div><dt>数据集</dt><dd>${t.datasets ?? 0} 个</dd></div>
    <div><dt>待审</dt><dd>${t.pending ?? 0} 项</dd></div>
    <div><dt>未纳入正式分析</dt><dd>${t.notFormal ?? 0} 项</dd></div>
  </dl>`;
}

function shell(state, ui, lib, body) {
  const hasData = !!lib.data;
  return `<section class="kzlib" data-state="${esc(kzLibState(ui))}" aria-label="知识库总览"${lib.status === "loading" ? ' aria-busy="true"' : ""}>
    <div class="kzlib-head">
      <div class="kzlib-title"><span class="kzlib-mark" aria-hidden="true">库</span><div><b>知识库总览</b><span>${esc(topicName(state, lib.data, ui))}</span></div></div>
      <div class="kzlib-head-actions">${lib.refreshing ? `<span class="kzlib-sync">同步中</span>` : ""}<button type="button" class="kzlib-reload"${lib.status === "loading" ? " disabled" : ""}>刷新</button></div>
    </div>
    ${(lib.status === "error" || lib.status === "unwired") && hasData ? `<p class="kzlib-warn">这次同步没有完成，下面仍是上次读到的一部分。</p>` : ""}
    ${hasData ? countsHtml(lib.data) : ""}
    ${hasData && kzLibState(ui) === "ready" ? `<div class="kzlib-continue"><span>继续积累</span><button type="button" data-kzlib-act="scan">AI 扫描文献</button><button type="button" data-kzlib-act="statement">新增认识</button></div>` : ""}
    ${body}
    ${hasData && (lib.data.warnings ?? []).length ? `<p class="kzlib-warn">有 ${lib.data.warnings.length} 条数据提醒，审阅时以卡片内说明为准。</p>` : ""}
    ${hasData && lib.data.hasMore ? `<p class="kzlib-trunc">当前只读取了已加载范围；匹配总数与全库总数分开写，不把这一页当作全部。</p>` : ""}
    ${hasData && kzLibState(ui) === "ready" && lib.data.dedupNote ? `<p class="kzlib-note">同一知识项的多个分项按分项计数，卡片本身不另计；不同版本分别计数、不合并。</p>` : ""}
  </section>`;
}

export function knowledgeOverviewHtml(state, ui) {
  const lib = libOf(ui);
  const status = kzLibState(ui);
  if (status === "loading" && !lib.data) {
    return shell(state, ui, lib, `<div class="kzlib-vessel is-waiting" aria-hidden="true"><span class="kzlib-rim"></span><span class="kzlib-water"></span></div><p class="kzlib-state-text">正在读取库总览；读到之前不画数量。</p>`);
  }
  if (status === "unwired" && !lib.data) {
    return shell(state, ui, lib, `<div class="kzlib-vessel is-empty" aria-hidden="true"><span class="kzlib-rim"></span></div><p class="kzlib-state-text">当前服务还没有库总览接口；卡片审阅与迹芽流水线不受影响。</p>`);
  }
  if (status === "error" && !lib.data) {
    return shell(state, ui, lib, `<div class="kzlib-vessel is-empty" aria-hidden="true"><span class="kzlib-rim"></span></div><p class="kzlib-state-text">库总览暂时读不到；卡片审阅与迹芽流水线不受影响。</p>`);
  }
  if (status === "empty") {
    const topicId = ui?.topicId ?? "";
    const hasPaper = (state.papers ?? []).some((p) => (p.topicIds ?? []).includes(topicId));
    return shell(state, ui, lib, `<div class="kzlib-vessel is-empty" aria-hidden="true"><span class="kzlib-rim"></span><span class="kzlib-seedline"></span></div>
      <div class="kzlib-empty">
        <p>这个课题还没有可展示的知识资产。${hasPaper ? "先扫描文献" : "先导入一篇文献"}，或直接记下一条判断。</p>
        <div class="kzlib-empty-actions">${hasPaper
          ? `<button type="button" class="primary" data-kzlib-act="scan">去发起语义提取</button>`
          : `<button type="button" class="primary" data-kzlib-act="papers">去导入文献</button>`}<button type="button" data-kzlib-act="statement">记一条认识</button></div>
      </div>`);
  }
  const data = lib.data ?? {};
  const selected = lib.selected ?? null;
  const duplicateHint = (data.byTheme ?? []).reduce((n, t) => n + (t.memberRefs ?? []).length, 0) > (data.elements ?? []).filter((e) => e.kind === "item").length;
  return shell(state, ui, lib, `<div class="kzlib-body">
    <div class="kzlib-vessel" aria-hidden="true"><span class="kzlib-rim"></span><span class="kzlib-water"></span></div>
    <div class="kzlib-clusters">${clustersHtml(data, selected)}</div>
  </div>
  ${duplicateHint ? `<p class="kzlib-note">同一知识项可归入多个主题，主题内数量合计可大于知识项数。</p>` : ""}
  <div class="kzlib-legend"><span class="kzlib-key is-confirmed">已确认</span><span class="kzlib-key is-pending">待审</span><span class="kzlib-key is-reference">其他状态</span><span class="kzlib-key is-dataset">数据集</span></div>
  <p class="kzlib-note">总览保留待审与非正式项；正式分析仍只取符合门槛的已确认项。</p>
  ${sourceListHtml(state, data, selected, ui)}
  ${detailHtml(state, data, selected)}`);
}