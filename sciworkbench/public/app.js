// LOCUS 三栏工作台前端（本地开发版）。
// 左：课题/子问题/材料与导入；中：原始材料（可高亮定位）；右：结构化结果与核对。
// 队友接手点：换 UI 只动 render*；换存储/部署只动 lib/api.js。
import { api } from "./lib/api.js";

let state = { topics: [], subquestions: [], assets: [], cards: [], tables: [] };
const ui = { nav: "literature", topicId: "", assetId: null, highlight: null };

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const topicName = (id) => state.topics.find((t) => t.id === id)?.name;

async function refresh() {
  state = await api.getState();
  if (ui.assetId && !state.assets.some((a) => a.id === ui.assetId)) ui.assetId = null;
  if (ui.topicId && !state.topics.some((t) => t.id === ui.topicId)) ui.topicId = "";
  renderAll();
}

function setStatus(m) { $("#status").textContent = m; }
function materials() {
  return state.assets.filter((a) => a.kind === ui.nav && (!ui.topicId || a.topicId === ui.topicId));
}
function currentAsset() { return state.assets.find((a) => a.id === ui.assetId) ?? null; }

function renderAll() {
  setStatus(`课题 ${state.topics.length} · 子问题 ${state.subquestions.length} · 材料 ${state.assets.length} · 证据卡 ${state.cards.length} · 表格 ${state.tables.length}`);
  renderTopics();
  renderSubq();
  renderImportBox();
  renderMaterials();
  renderMiddle();
  renderRight();
}

function renderTopics() {
  const opts = [`<option value="">（全部课题）</option>`]
    .concat(state.topics.map((t) => `<option value="${t.id}" ${t.id === ui.topicId ? "selected" : ""}>${esc(t.name)}</option>`));
  $("#topic-select").innerHTML = opts.join("");
}

function renderSubq() {
  const list = state.subquestions.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  $("#subq-list").innerHTML = list.length
    ? list.map((s) => `<li class="${s.kind}">${esc(s.question)} <span class="hint">(${s.kind})</span></li>`).join("")
    : `<li class="hint">暂无子问题${ui.topicId ? "" : "（先选课题）"}</li>`;
}

function renderImportBox() {
  const box = $("#import-box");
  if (ui.nav === "literature") {
    box.innerHTML = `
      <details class="mini" open>
        <summary>导入文献摘录</summary>
        <input id="lit-name" placeholder="来源名称（如 SLAC methods-source）" />
        <textarea id="lit-text" rows="3" placeholder="粘贴文献/方法节选文本…"></textarea>
        <div class="row"><select id="lit-mode"><option value="draft">draft 草稿</option><option value="ai">AI 抽取</option></select>
        <button class="primary" id="lit-import">导入</button></div>
      </details>`;
    $("#lit-import").addEventListener("click", async () => {
      try {
        const r = await api.importLiterature($("#lit-name").value, $("#lit-text").value, $("#lit-mode").value, ui.topicId || undefined);
        $("#lit-text").value = "";
        await refresh();
        ui.assetId = r.assetId; renderAll();
        setStatus(`导入成功：${r.created} 张证据卡`);
      } catch (e) { alert(`导入失败：${e.message}`); }
    });
  } else {
    box.innerHTML = `
      <details class="mini" open>
        <summary>导入实验数据（CSV）</summary>
        <input id="meas-name" placeholder="文件名（如 EnzymeML_SLAC_pH3__Data.csv）" />
        <input id="meas-file" type="file" accept=".csv,text/csv,text/plain" />
        <textarea id="meas-text" rows="2" placeholder="或粘贴 CSV…"></textarea>
        <button class="primary" id="meas-import">导入</button>
      </details>`;
    $("#meas-import").addEventListener("click", async () => {
      try {
        const file = $("#meas-file").files?.[0];
        let csv = $("#meas-text").value, name = $("#meas-name").value;
        if (file) { csv = await file.text(); if (!name) name = file.name; }
        const r = await api.importMeasurements(name, csv, ui.topicId || undefined);
        $("#meas-text").value = "";
        await refresh();
        ui.assetId = r.assetId; renderAll();
        setStatus(`导入成功：表格 ${r.created} 行`);
      } catch (e) { alert(`导入失败：${e.message}`); }
    });
  }
}

function renderMaterials() {
  const list = materials();
  const box = $("#material-list");
  box.innerHTML = list.length
    ? list.map((a) => `<div class="material ${a.id === ui.assetId ? "active" : ""}" data-id="${a.id}">
        <div class="m-title">${esc(a.name)}</div>
        <div class="m-meta">${a.kind === "literature" ? "文献" : "数据"} · ${a.bytes}B ${a.topicId ? "· " + esc(topicName(a.topicId) ?? "") : ""}</div>
      </div>`).join("")
    : `<p class="hint">当前${ui.nav === "literature" ? "文献" : "数据"}（${ui.topicId ? "本课题" : "全部"}）暂无材料。</p>`;
}

function renderMiddle() {
  const a = currentAsset();
  $("#mid-title").textContent = a ? `原始材料 · ${a.name}` : "原始材料";
  const note = $("#mid-note");
  const content = $("#mid-content");
  if (!a) { note.hidden = true; content.textContent = "在左栏选择或导入材料。"; return; }
  const text = a.text;
  if (!ui.highlight) { note.hidden = true; content.innerHTML = esc(text); return; }
  const q = ui.highlight;
  if (q && text.includes(q)) {
    note.hidden = true;
    content.innerHTML = esc(text).replace(esc(q), `<mark>${esc(q)}</mark>`);
  } else {
    note.hidden = false; note.textContent = "定位不足：未能在原件中精确匹配该条目，已展示完整原件。";
    content.innerHTML = esc(text);
  }
}

function renderRight() {
  const a = currentAsset();
  const box = $("#right-content");
  if (!a) { $("#right-title").textContent = "结构化结果"; box.innerHTML = `<p class="hint">选中材料后，这里显示结构化草稿与核对操作。</p>`; return; }
  if (a.kind === "literature") { $("#right-title").textContent = "证据卡"; box.innerHTML = cardsHtml(a.id); }
  else { $("#right-title").textContent = "数据表格"; box.innerHTML = tableHtml(a.id); }
}

function cardsHtml(assetId) {
  const cards = state.cards.filter((c) => c.assetId === assetId);
  if (!cards.length) return `<p class="hint">暂无证据卡。</p>`;
  return cards.map((c) => `
    <div class="item" data-id="${c.id}">
      <div class="meta">抽取 <span class="badge ${c.extraction === "ai" ? "ai" : ""}">${c.extraction}</span> · 核对 <span class="badge ${c.audit}">${c.audit}</span> · rev ${c.revision}</div>
      <div class="raw linkable" title="点击在原文件中定位">${esc(c.rawText)}</div>
      <div class="row"><label>核对</label>
        <select data-field="audit">${["unreviewed", "confirm", "need_info", "exclude", "skip"].map((v) => `<option ${v === c.audit ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label>重要</label>
        <select data-field="importance">${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v || "—"}</option>`).join("")}</select>
      </div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(c.note)}" /></div>
      <div class="row"><label>原因</label><input data-field="reason" value="${esc(c.reason)}" placeholder="排除/改关键文本时必填" />
        <button class="save">保存</button><button class="history-btn">历史(${c.history.length})</button></div>
    </div>`).join("");
}

function tableHtml(assetId) {
  const t = state.tables.find((x) => x.assetId === assetId);
  if (!t) return `<p class="hint">暂无表格。</p>`;
  const head = t.columns.map((name, i) => `<th><div>${esc(name)}</div>
    <input data-col="${i}" data-k="unit" value="${esc(t.columnMeta[i].unit)}" placeholder="单位" />
    <select data-col="${i}" data-k="decision">${["unreviewed", "confirm", "need_info"].map((v) => `<option ${v === t.columnMeta[i].decision ? "selected" : ""}>${v}</option>`).join("")}</select></th>`).join("");
  const body = t.rows.map((r, ri) => `<tr>${t.columns.map((_, ci) => `<td class="cell" data-row="${ri}" data-col="${ci}">${esc(r[ci] ?? "")}</td>`).join("")}</tr>`).join("");
  return `
    <div class="item" data-id="${t.id}">
      <div class="meta">${t.rows.length} 行 × ${t.columns.length} 列 · rev ${t.revision}</div>
      <div class="tablewrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(t.note)}" />
        <label>原因</label><input data-field="reason" placeholder="改单元格数值时必填" />
        <button class="save-cols">保存列设置</button><button class="history-btn">历史(${t.history.length})</button></div>
      <p class="hint">点击中间原件中的行可定位；点击单元格后再改数值（需原因）。</p>
    </div>`;
}

// ── 事件 ────────────────────────────────────────────────────
$("#nav").addEventListener("click", (ev) => {
  const b = ev.target.closest(".navitem"); if (!b || b.disabled) return;
  ui.nav = b.dataset.nav; ui.highlight = null;
  $$(".navitem").forEach((x) => x.classList.toggle("active", x === b));
  renderAll();
});

$("#topic-select").addEventListener("change", (e) => { ui.topicId = e.target.value; ui.assetId = null; ui.highlight = null; renderAll(); });

$("#topic-create").addEventListener("click", async () => {
  try {
    const r = await api.createTopic($("#topic-name").value, $("#topic-q").value);
    ui.topicId = r.topicId; await refresh(); setStatus("课题已创建");
  } catch (e) { alert(`创建失败：${e.message}`); }
});

$("#subq-create").addEventListener("click", async () => {
  if (!ui.topicId) { alert("请先选择/创建一个课题"); return; }
  try { await api.createSubquestion(ui.topicId, $("#subq-q").value, $("#subq-kind").value); $("#subq-q").value = ""; await refresh(); setStatus("子问题已创建"); }
  catch (e) { alert(`创建失败：${e.message}`); }
});

$("#material-list").addEventListener("click", (ev) => {
  const el = ev.target.closest(".material"); if (!el) return;
  ui.assetId = el.dataset.id; ui.highlight = null; renderAll();
});

$("#right-content").addEventListener("click", async (ev) => {
  const item = ev.target.closest(".item"); if (!item) return;
  const val = (f) => item.querySelector(`[data-field="${f}"]`)?.value ?? "";
  try {
    if (ev.target.classList.contains("history-btn")) {
      const isCard = item.querySelector("select[data-field=audit]");
      const obj = isCard ? state.cards.find((c) => c.id === item.dataset.id) : state.tables.find((t) => t.id === item.dataset.id);
      openHistory(obj); return;
    }
    if (ev.target.classList.contains("raw") && ev.target.classList.contains("linkable")) {
      const c = state.cards.find((x) => x.id === item.dataset.id);
      ui.highlight = c?.locator.sectionQuote || c?.rawText || null; renderMiddle(); return;
    }
    if (ev.target.classList.contains("cell")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      const ri = Number(ev.target.dataset.row), ci = Number(ev.target.dataset.col);
      ui.highlight = lineOf(t, ri); renderMiddle();
      const before = t.rows[ri][ci];
      const nv = prompt(`更正单元格 r${ri}·c${ci}（需原因）\n当前值：${before}\n输入新值：`, before);
      if (nv === null || nv === before) return;
      const reason = prompt("更正原因："); if (!reason) { alert("必须填写原因"); return; }
      await api.reviewTable(t.id, { cellUpdates: [{ row: ri, col: ci, value: nv }], reason });
      await refresh(); setStatus("单元格已保存（含修订历史）"); return;
    }
    if (ev.target.classList.contains("save")) {
      await api.reviewCard(item.dataset.id, { audit: val("audit"), importance: val("importance") || null, note: val("note"), reason: val("reason") });
      await refresh(); setStatus("已保存（含修订历史）"); return;
    }
    if (ev.target.classList.contains("save-cols")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      const columnUpdates = t.columns.map((_, i) => ({
        index: i,
        unit: item.querySelector(`[data-col="${i}"][data-k="unit"]`).value,
        decision: item.querySelector(`[data-col="${i}"][data-k="decision"]`).value,
      }));
      await api.reviewTable(t.id, { columnUpdates, note: val("note"), reason: val("reason") });
      await refresh(); setStatus("列设置已保存"); return;
    }
  } catch (e) { alert(`操作失败：${e.message}`); }
});

function lineOf(t, ri) {
  // 表中数据行 ri 对应原件第 ri+1 行（0 行为表头）
  const lines = currentAsset().text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return (lines[ri + 1] ?? "").trim() || null;
}

function openHistory(obj) {
  if (!obj) return;
  $("#drawer-title").textContent = "修订历史";
  $("#drawer-meta").textContent = `当前 rev ${obj.revision} · 共 ${obj.history.length} 条`;
  $("#drawer-body").innerHTML = obj.history.length === 0
    ? `<p class="hint">暂无修订记录。</p>`
    : `<table class="grid"><thead><tr><th>rev</th><th>字段</th><th>前</th><th>后</th><th>原因</th><th>时间</th></tr></thead><tbody>${
        obj.history.slice().reverse().map((h) => `<tr><td>${h.revision}</td><td>${esc(h.field)}</td><td class="raw">${esc(h.before)}</td><td class="raw">${esc(h.after)}</td><td>${esc(h.reason)}</td><td>${esc(h.at)}</td></tr>`).join("")
      }</tbody></table>`;
  $("#drawer").hidden = false;
}
$("#drawer-close").addEventListener("click", () => { $("#drawer").hidden = true; });

async function refreshAiState() {
  const s = await api.aiStatus();
  $("#ai-state").textContent = s.configured ? `已配置 · ${s.model} @ ${s.baseUrl}（仅进程内存）` : "未配置：填写三项并保存后，文献导入可选 AI 抽取";
}
$("#ai-save").addEventListener("click", async () => {
  try { const s = await api.setAiConfig($("#ai-base").value, $("#ai-model").value, $("#ai-key").value); $("#ai-key").value = ""; await refreshAiState(); setStatus(s.configured ? `AI 已配置 · ${s.model}` : "AI 配置未生效"); }
  catch (e) { alert(`保存失败：${e.message}`); }
});
$("#ai-clear").addEventListener("click", async () => { try { await api.clearAiConfig(); await refreshAiState(); setStatus("AI 配置已清除"); } catch (e) { alert(`清除失败：${e.message}`); } });

refreshAiState().catch(() => {});
refresh().catch((e) => setStatus(`加载失败：${e.message}`));
