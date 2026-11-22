/**
 * 知识页迹芽流水线舞台：纯渲染，不发请求、不写状态。
 * 只消费已有 cards / knowledge.items / ui.kzJob；没有回执时不画进度。
 */
import { esc } from "../views.js";

const STAGE_LABEL = { idle: "待机", working: "加工中", paused: "已暂停", failed: "有失败" };

function cardPaper(state, c) {
  return c.paperId ?? state.attachments?.find((a) => a.assetId === c.assetId)?.paperId ?? "";
}

function scopedCards(state, ui) {
  const cards = state.cards ?? [];
  if (!ui.paperId) return cards;
  return cards.filter((c) => cardPaper(state, c) === ui.paperId);
}

function scopedItems(state, ui, cards = scopedCards(state, ui)) {
  const ids = new Set(cards.map((c) => c.id));
  return (state.knowledge?.items ?? []).filter((e) => !ui.paperId || ids.has(e.payload?.cardId));
}

export function kzStageState(ui) {
  const j = ui?.kzJob;
  if (!j) return "idle";
  if ((j.chunkErrors ?? []).length) return "failed";
  if (j.status === "paused") return "paused";
  if (j.status === "error") return "failed";
  if (j.status === "running") return "working";
  return "idle";
}

export function stageCounts(state, ui) {
  const cards = scopedCards(state, ui);
  const items = scopedItems(state, ui, cards);
  const pendingCards = cards.filter((c) => c.extraction === "ai" && !["confirm", "skip", "exclude"].includes(c.audit)).length;
  const confirmedItems = items.filter((e) => e.payload?.review?.status === "confirmed").length;
  const confirmedCards = cards.filter((c) => c.audit === "confirm").length;
  return {
    attachments: (state.attachments ?? []).filter((a) => !ui.paperId || a.paperId === ui.paperId).length,
    pendingCards,
    pendingItems: items.filter((e) => e.payload?.review?.status === "pending").length,
    confirmed: state.knowledge?.items?.length ? confirmedItems : confirmedCards,
  };
}

function stageLabel(j, stage) {
  if (stage === "idle" && j?.status === "done") return j.cancelled ? "已取消" : "本轮完成";
  return STAGE_LABEL[stage];
}

function aiValue(j, stage) {
  if (stage === "working") return j.total ? `${j.done}/${j.total} 块` : "等待回执";
  if (stage === "paused") return `已出 ${j.created ?? 0} 张`;
  if (stage === "failed") return j.status === "error" ? "中断" : `${j.chunkErrors?.length ?? 0} 块失败`;
  if (j?.status === "done") return `已出 ${j.created ?? 0} 张`;
  return "待机";
}

function stageNote(j, stage, c) {
  if (stage === "working") {
    if (!j.total) return "已发起，等待第一块回执；不预设进度。";
    return `抽取中：第 ${j.done}/${j.total} 块；已出 ${j.created ?? 0} 张，本范围 ${c.pendingItems} 项待审。`;
  }
  if (stage === "paused") return `已暂停：保留已出 ${j.created ?? 0} 张；继续后按当前回执恢复。`;
  if (stage === "failed") {
    if (j.status === "error") return "任务中断：已出内容保留；去右栏查看失败块，不自动重试。";
    return `${j.chunkErrors?.length ?? 0} 块失败：已出内容保留；去右栏逐块重试。`;
  }
  if (j?.status === "done") {
    if (j.cancelled) return `已取消：保留已出 ${j.created ?? 0} 张；扫描完成不等于全部归入。`;
    return `本轮已出 ${j.created ?? 0} 张；扫描完成不等于全部归入。`;
  }
  return "待机：发起语义提取后，流水线按真实回执生长。";
}

export function aiSproutHtml(state = "idle", cls = "") {
  return `<span class="kz-sprout ${esc(cls)}" data-state="${esc(state)}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path class="sprout-seed" d="M12 20.2c-3.1 0-5.1-2.1-5.1-5 0-3.3 2.6-5.4 5.1-5.4s5.1 2.1 5.1 5.4c0 2.9-2 5-5.1 5Z"/><path class="sprout-stem" d="M12 12.4V7.5"/><path class="sprout-leaf-a" d="M12 8.4C9.7 8.2 8.2 6.7 7.9 4.5c2.5.1 4 1.3 4.1 3.9Z"/><path class="sprout-leaf-b" d="M12 9.4c2.3-.2 3.7-1.5 4-3.7-2.4.1-3.8 1.3-4 3.7Z"/><path class="sprout-curl" d="M12 7.5c-1.1-.9-1-2.3.4-3.1"/></svg></span>`;
}

export function knowledgeStageHtml(state, ui) {
  const stage = kzStageState(ui);
  const j = ui.kzJob;
  const c = stageCounts(state, ui);
  const total = j?.total ?? 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round(((j.done ?? 0) / total) * 100))) : 0;
  const active = stage === "working" || stage === "paused" || stage === "failed"
    ? "ai"
    : c.pendingCards || c.pendingItems ? "review" : c.confirmed ? "in" : "source";
  const steps = [
    ["source", "原文献", `${c.attachments} 份`],
    ["ai", "AI 加工", aiValue(j, stage)],
    ["review", "待人审", `${c.pendingCards} 卡 / ${c.pendingItems} 项`],
    ["in", "已归入", `${c.confirmed} 项`],
  ];
  return `<section class="kzstage" data-state="${stage}" aria-label="知识积累流水线">
    <div class="kzstage-top">
      ${aiSproutHtml(stage, "kzstage-sprout")}
      <div class="kzstage-heading"><b>积累流水线</b><span class="kzstage-state">${stageLabel(j, stage)}</span></div>
      ${total > 0
        ? `<div class="kzstage-progress" role="progressbar" aria-label="抽取进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${j.done ?? 0}"><span style="width:${pct}%"></span></div>`
        : `<div class="kzstage-progress is-waiting" aria-hidden="true"><span></span></div>`}
    </div>
    <ol class="kzstage-rail">
      ${steps.map(([key, label, value], i) => `<li class="kzstage-step${key === active ? " active" : ""}" data-step="${key}">
        ${i ? `<span class="kzstage-link" aria-hidden="true"></span>` : ""}
        <span class="kzstage-dot" aria-hidden="true"></span>
        <span class="kzstage-label">${label}</span>
        <b class="kzstage-value">${esc(value)}</b>
      </li>`).join("")}
    </ol>
    <p class="kzstage-note">${esc(stageNote(j, stage, c))}</p>
  </section>`;
}