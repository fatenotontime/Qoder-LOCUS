// LOCUS 最小闭环前端（本地开发版）。
// 结构：state ← api.getState()（刷新恢复）；render* 纯渲染；事件 → api → 重新拉取。
// 队友接手点：换 UI 只动 render*；换存储/部署只动 lib/api.js。
import { api } from "./lib/api.js";

let state = { assets: [], cards: [], measurements: [] };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function refresh() {
  state = await api.getState();
  render();
}

function setStatus(msg) { $("#status").textContent = msg; }

function assetName(assetId) {
  const a = state.assets.find((x) => x.id === assetId);
  return a ? a.name : assetId;
}

function render() {
  setStatus(`素材 ${state.assets.length} · 证据卡 ${state.cards.length} · 测量项 ${state.measurements.length}`);
  renderCards();
  renderMeasurements();
}

function renderCards() {
  const box = $("#lit-list");
  if (state.cards.length === 0) { box.innerHTML = `<p class="hint">尚无证据卡。先在上方导入一段文献摘录。</p>`; return; }
  box.innerHTML = state.cards.map((c) => `
    <div class="item" data-id="${c.id}">
      <div class="meta">来源：${esc(assetName(c.assetId))} · <span class="badge ${c.audit}">${c.audit}</span></div>
      <div class="raw">${esc(c.rawText)}</div>
      <div class="row">
        <label>核对</label>
        <select data-field="audit">
          ${["unreviewed", "confirm", "need_info", "exclude", "skip"].map((v) => `<option ${v === c.audit ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <label>重要程度</label>
        <select data-field="importance">
          ${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v || "—"}</option>`).join("")}
        </select>
      </div>
      <div class="row">
        <label>备注</label><input data-field="note" value="${esc(c.note)}" />
      </div>
      <div class="row">
        <label>原因</label><input data-field="reason" value="${esc(c.reason)}" placeholder="排除/改关键数值时必填" />
        <button class="save">保存</button>
        <button class="source-btn">原件回查</button>
      </div>
    </div>`).join("");
}

function renderMeasurements() {
  const box = $("#meas-list");
  if (state.measurements.length === 0) { box.innerHTML = `<p class="hint">尚无测量项。先在上方导入 CSV。</p>`; return; }
  box.innerHTML = state.measurements.map((m) => `
    <div class="item" data-id="${m.id}">
      <div class="meta">来源：${esc(assetName(m.assetId))} · ${esc(m.source.column)}（第 ${m.source.rowIndex + 1} 行） · <span class="badge ${m.decision}">${m.decision}</span></div>
      <div class="row">
        <label>数值</label><input class="value" data-field="value" value="${esc(m.value)}" />
        <label>单位</label><input class="value" data-field="unit" value="${esc(m.unit)}" />
        <label>核对</label>
        <select data-field="decision">
          ${["unreviewed", "confirm", "need_info"].map((v) => `<option ${v === m.decision ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="row">
        <label>备注</label><input data-field="note" value="${esc(m.note)}" />
        <button class="save">保存</button>
        <button class="source-btn">原件回查</button>
      </div>
    </div>`).join("");
}

// ── 事件 ────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${t.dataset.tab}`));
  });
});

$("#lit-import").addEventListener("click", async () => {
  try {
    const r = await api.importLiterature($("#lit-name").value, $("#lit-text").value);
    $("#lit-text").value = "";
    await refresh();
    setStatus(`导入成功：生成 ${r.created} 张待审证据卡`);
  } catch (e) { alert(`导入失败：${e.message}`); }
});

$("#meas-import").addEventListener("click", async () => {
  try {
    const file = $("#meas-file").files?.[0];
    let csv = $("#meas-text").value;
    let name = $("#meas-name").value;
    if (file) { csv = await file.text(); if (!name) name = file.name; }
    const r = await api.importMeasurements(name, csv);
    $("#meas-text").value = "";
    await refresh();
    setStatus(`导入成功：生成 ${r.created} 个待核对测量项`);
  } catch (e) { alert(`导入失败：${e.message}`); }
});

$("#lit-list").addEventListener("click", (ev) => handleItemClick(ev, "card"));
$("#meas-list").addEventListener("click", (ev) => handleItemClick(ev, "measurement"));

async function handleItemClick(ev, kind) {
  const item = ev.target.closest(".item");
  if (!item) return;
  const id = item.dataset.id;
  const val = (f) => item.querySelector(`[data-field="${f}"]`)?.value ?? "";
  try {
    if (ev.target.classList.contains("save")) {
      if (kind === "card") {
        const importance = val("importance") || null;
        await api.reviewCard(id, { audit: val("audit"), importance, note: val("note"), reason: val("reason") });
      } else {
        await api.reviewMeasurement(id, { value: val("value"), unit: val("unit"), decision: val("decision"), note: val("note") });
      }
      await refresh();
      setStatus("已保存（刷新页面仍可见）");
    } else if (ev.target.classList.contains("source-btn")) {
      await openSource(kind, id,
        kind === "card" ? state.cards.find((c) => c.id === id)
                        : state.measurements.find((m) => m.id === id));
    }
  } catch (e) { alert(`操作失败：${e.message}`); }
}

async function openSource(kind, id, obj) {
  const sv = await api.getSource(obj.assetId);
  $("#drawer-title").textContent = `原件回查 · ${sv.asset.name}`;
  $("#drawer-meta").textContent = `类型：${sv.asset.kind} · bytes ${sv.asset.bytes} · hash ${sv.asset.hash.slice(0, 12)}…`;
  const lines = sv.asset.text.split(/\r?\n/);
  let html;
  if (kind === "card") {
    const q = obj.locator.sectionQuote;
    html = esc(sv.asset.text).replace(esc(q), `<mark>${esc(q)}</mark>`);
  } else {
    // 高亮对应数据行（0 行=表头，数据行 r 即第 r 行）
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    const target = nonEmpty[obj.source.rowIndex] ?? "";
    html = lines.map((l) => (l === target && target ? `<mark>${esc(l)}</mark>` : esc(l))).join("\n");
  }
  $("#drawer-source").innerHTML = html;
  $("#drawer").hidden = false;
}

$("#drawer-close").addEventListener("click", () => { $("#drawer").hidden = true; });

// 启动即恢复（刷新恢复）
refresh().catch((e) => setStatus(`加载失败：${e.message}`));
