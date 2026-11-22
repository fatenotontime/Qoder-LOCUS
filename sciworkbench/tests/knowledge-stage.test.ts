import test from "node:test";
import assert from "node:assert/strict";
import { aiSproutHtml, knowledgeStageHtml, kzStageState, stageCounts } from "../public/lib/pages/knowledge-stage.js";

const state = {
  papers: [{ id: "p1", title: "论文一" }, { id: "p2", title: "论文二" }],
  assets: [{ id: "as1", name: "一.pdf" }, { id: "as2", name: "二.pdf" }],
  attachments: [
    { id: "a1", paperId: "p1", assetId: "as1", role: "fulltext" },
    { id: "a2", paperId: "p2", assetId: "as2", role: "fulltext" },
  ],
  cards: [
    { id: "c1", paperId: "p1", extraction: "ai", audit: "unreviewed", rawText: "一" },
    { id: "c2", paperId: "p2", extraction: "ai", audit: "confirm", rawText: "二" },
    { id: "c3", paperId: "p1", extraction: "manual", audit: "confirm", rawText: "三" },
  ],
  knowledge: {
    items: [
      { id: "ki1", payload: { cardId: "c1", review: { status: "pending" } } },
      { id: "ki2", payload: { cardId: "c2", review: { status: "confirmed" } } },
      { id: "ki3", payload: { cardId: "c1", review: { status: "confirmed" } } },
    ],
  },
};

const ui = { paperId: "p1", kzJob: null };

const visibleText = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

test("迹芽舞台：待机不画进度，计数只取当前文献范围", () => {
  const html = knowledgeStageHtml(state, ui);
  assert.ok(html.includes('data-state="idle"'));
  assert.ok(visibleText(html).includes("积累流水线"));
  assert.ok(visibleText(html).includes("待机"));
  assert.ok(visibleText(html).includes("1 份"), "当前文献附件数");
  assert.ok(visibleText(html).includes("1 卡 / 1 项"), "当前文献待审卡与待审项");
  assert.ok(visibleText(html).includes("已归入 1 项"), "当前文献已确认项");
  assert.ok(!html.includes('role="progressbar"'), "没有任务回执不画进度条");
  assert.deepEqual(stageCounts(state, ui), { attachments: 1, pendingCards: 1, pendingItems: 1, confirmed: 1 });
});

test("迹芽舞台：库总览传入容器数据后只按当前课题计数", () => {
  const scoped = {
    ...state,
    papers: [{ id: "p1", title: "论文一", topicIds: ["t1"] }, { id: "p2", title: "论文二", topicIds: ["t2"] }],
  };
  const data = {
    elements: [
      { kind: "item", reviewStatus: "confirmed" },
      { kind: "item", reviewStatus: "pending" },
      { kind: "dataset", reviewStatus: "pending" },
    ],
    totals: { pending: 1 },
  };
  const t = visibleText(knowledgeStageHtml(scoped, { topicId: "t1", paperId: null }, data));
  assert.ok(t.includes("1 份"), "原文献只数当前课题关联的附件");
  assert.ok(t.includes("1 卡 / 1 项"), "待审项取容器响应，待审卡按当前课题论文过滤");
  assert.ok(t.includes("已归入 1 项"), "数据集不混入已归入项");
  const empty = visibleText(knowledgeStageHtml(scoped, { topicId: "t3", paperId: null }, { elements: [], totals: { pending: 0 } }));
  assert.ok(empty.includes("0 份") && empty.includes("0 卡 / 0 项") && empty.includes("已归入 0 项"), "空课题不借用别的课题计数");
});

test("迹芽舞台：加工中按真实回执显示 done/total 与已出张数", () => {
  const job = { status: "running", done: 2, total: 5, created: 3, chunkErrors: [] };
  const html = knowledgeStageHtml(state, { ...ui, kzJob: job });
  assert.ok(html.includes('data-state="working"'));
  assert.ok(html.includes('role="progressbar"') && html.includes('aria-valuenow="2"'));
  assert.ok(visibleText(html).includes("2/5 块"));
  assert.ok(visibleText(html).includes("已出 3 张"));
  assert.ok(visibleText(html).includes("第 2/5 块"));
  assert.ok(html.includes('data-step="ai"') && html.match(/kzstage-step active" data-step="ai"/), "AI 步骤是当前步");
});

test("迹芽舞台：任务已发起但无 total 时只说等待回执", () => {
  const html = knowledgeStageHtml(state, { ...ui, kzJob: { status: "running", done: 0, total: 0, created: 0, chunkErrors: [] } });
  assert.ok(!html.includes('role="progressbar"'));
  assert.ok(visibleText(html).includes("等待回执"));
  assert.ok(visibleText(html).includes("不预设进度"));
});

test("迹芽舞台：暂停与失败保留已出内容，不冒充完成", () => {
  const paused = knowledgeStageHtml(state, { ...ui, kzJob: { status: "paused", done: 2, total: 5, created: 3, chunkErrors: [] } });
  assert.ok(paused.includes('data-state="paused"'));
  assert.ok(visibleText(paused).includes("已暂停"));
  assert.ok(visibleText(paused).includes("保留已出 3 张"));
  assert.ok(!visibleText(paused).includes("已归入 3"));

  const failed = knowledgeStageHtml(state, { ...ui, kzJob: { status: "running", done: 2, total: 5, created: 3, chunkErrors: [{ index: 4, message: "boom" }] } });
  assert.ok(failed.includes('data-state="failed"'));
  assert.ok(visibleText(failed).includes("1 块失败"));
  assert.ok(visibleText(failed).includes("保留"));

  const broken = knowledgeStageHtml(state, { ...ui, kzJob: { status: "error", done: 1, total: 5, created: 2, chunkErrors: [] } });
  assert.ok(broken.includes('data-state="failed"'));
  assert.ok(visibleText(broken).includes("中断"));
});

test("迹芽舞台：完成与取消都说清「扫描完成不等于全部归入」", () => {
  const done = knowledgeStageHtml(state, { ...ui, kzJob: { status: "done", done: 5, total: 5, created: 8, chunkErrors: [] } });
  assert.ok(visibleText(done).includes("本轮完成"));
  assert.ok(visibleText(done).includes("本轮已出 8 张"));
  assert.ok(visibleText(done).includes("扫描完成不等于全部归入"));
  assert.ok(done.includes('aria-valuenow="5"'));

  const cancelled = knowledgeStageHtml(state, { ...ui, kzJob: { status: "done", done: 5, total: 5, created: 8, cancelled: true, chunkErrors: [] } });
  assert.ok(visibleText(cancelled).includes("已取消"));
  assert.ok(visibleText(cancelled).includes("保留已出 8 张"));
});

test("迹芽舞台：只渲染已知字段，不回显原始错误文本", () => {
  const html = knowledgeStageHtml(state, { ...ui, kzJob: { status: "error", done: 1, total: 5, created: 2, message: "<img src=x onerror=alert(1)>", chunkErrors: [] } });
  assert.ok(!html.includes("<img"));
  assert.ok(!visibleText(html).includes("alert"));
});

test("迹芽状态与图标：四态映射、SVG 装饰不参与可读文本", () => {
  assert.equal(kzStageState(undefined), "idle");
  assert.equal(kzStageState({ kzJob: { status: "running" } }), "working");
  assert.equal(kzStageState({ kzJob: { status: "paused" } }), "paused");
  assert.equal(kzStageState({ kzJob: { status: "error" } }), "failed");
  for (const s of ["idle", "working", "paused", "failed"]) {
    const html = aiSproutHtml(s, "x");
    assert.ok(html.includes(`data-state="${s}"`));
    assert.ok(html.includes('aria-hidden="true"'));
  }
});