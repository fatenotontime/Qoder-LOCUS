import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { emptyState, JsonFileStore, MemoryStore } from "../store.ts";
import {
  AppError,
  MAX_IMPORT_BYTES,
  analyseTable,
  createSubquestion,
  createTopic,
  detectDelimiter,
  importLiterature,
  importMeasurements,
  parseCsv,
  reviewCard,
  reviewTable,
  sourceView,
} from "../services/app.ts";
import { aiConfigFromEnv, chunkText, clearAiConfig, describeConfig, extractJson, getAiConfig, setAiConfig, TASKS, runTask, type AiConfig } from "../services/ai.ts";
import { createApp } from "../server.ts";

// ── 修正③：超限拒绝，不截断 ─────────────────────────────────
test("导入超过上限 → 413 拒绝，且不产生素材（不截断）", async () => {
  const big = "x".repeat(MAX_IMPORT_BYTES + 1);
  assert.throws(() => importMeasurements(emptyState(), { name: "big.csv", csv: big }), (e: unknown) => e instanceof AppError && e.status === 413);
  const s = emptyState();
  await assert.rejects(importLiterature(s, { name: "l", text: big }), (e: unknown) => e instanceof AppError && e.status === 413);
  assert.equal(s.assets.length, 0);
});

test("边界：恰好等于上限允许", async () => {
  const exact = "a".repeat(MAX_IMPORT_BYTES);
  const s = await importLiterature(emptyState(), { name: "l", text: exact });
  assert.equal(s.asset.bytes, MAX_IMPORT_BYTES);
});

// ── 修正①：保留表格结构 ─────────────────────────────────────
test("导入 CSV → 一张表格（不是 N 个逐项记录）", () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "time,abs\n0,0.1\n30,0.3" });
  assert.equal(r.state.tables.length, 1);
  const t = r.state.tables[0];
  assert.deepEqual(t.columns, ["time", "abs"]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1][1], "0.3");
  assert.equal(t.columnMeta.length, 2);
});

test("parseCsv 支持引号与逗号", () => {
  assert.deepEqual(parseCsv('a,b\n"x,y",2\n'), [["a", "b"], ["x,y", "2"]]);
});

// ── 修正②：更正留历史 ───────────────────────────────────────
test("改单元格必须给原因（422）；给原因后记录前后值与修订号", () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  const id = r.state.tables[0].id;
  assert.throws(() => reviewTable(r.state, id, { cellUpdates: [{ row: 0, col: 1, value: "2" }] }), (e: unknown) => e instanceof AppError && e.status === 422);
  const s2 = reviewTable(r.state, id, { cellUpdates: [{ row: 0, col: 1, value: "2" }], reason: "原值抄错" });
  const t2 = s2.tables[0];
  assert.equal(t2.rows[0][1], "2");
  assert.equal(t2.revision, 2);
  const h = t2.history.at(-1)!;
  assert.equal(h.field, "cell[0][1]");
  assert.equal(h.before, "1");
  assert.equal(h.after, "2");
  assert.equal(h.reason, "原值抄错");
  assert.equal(h.revision, 2);
});

test("列单位/结论更正也留历史", () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  const id = r.state.tables[0].id;
  const s2 = reviewTable(r.state, id, { columnUpdates: [{ index: 0, unit: "s", decision: "confirm" }] });
  const fields = s2.tables[0].history.map((h) => h.field);
  assert.ok(fields.includes("col[0].unit"));
  assert.ok(fields.includes("col[0].decision"));
});

test("证据卡核对记录历史；排除须原因", async () => {
  const r = await importLiterature(emptyState(), { name: "s", text: "只有一段" });
  const id = r.state.cards[0].id;
  assert.throws(() => reviewCard(r.state, id, { audit: "exclude" }), (e: unknown) => e instanceof AppError && e.status === 422);
  const s2 = reviewCard(r.state, id, { audit: "confirm", importance: "high" });
  const fields = s2.cards[0].history.map((h) => h.field);
  assert.deepEqual(fields.sort(), ["audit", "importance"]);
});

// ── 原件回查（含表格） ──────────────────────────────────────
test("原件回查返回素材原文与表格定位点", () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  const sv = sourceView(r.state, r.asset.id);
  assert.equal(sv.asset.kind, "measurement");
  assert.equal(sv.points[0].kind, "table");
  assert.match(sv.points[0].locate, /1 行 × 2 列/);
});

// ── 刷新恢复 ────────────────────────────────────────────────
test("刷新恢复：JsonFileStore 往返一致（含历史）", async () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  const s2 = reviewTable(r.state, r.state.tables[0].id, { cellUpdates: [{ row: 0, col: 1, value: "9" }], reason: "更正" });
  const path = join(tmpdir(), `locus-test-${Date.now()}.json`);
  const file = new JsonFileStore(path);
  await file.save(s2);
  const back = await file.load();
  assert.equal(back.tables[0].rows[0][1], "9");
  assert.equal(back.tables[0].history.length, 1);
  rmSync(path, { force: true });
});

test("旧版本状态不迁移（返回空）", async () => {
  const path = join(tmpdir(), `locus-old-${Date.now()}.json`);
  await new JsonFileStore(path).save({ version: 1, assets: [], cards: [], tables: [] } as never);
  const back = await new JsonFileStore(path).load();
  assert.deepEqual(back, emptyState());
  rmSync(path, { force: true });
});

test("v2 → v3 迁移：保留既有数据，补空 topics/subquestions", async () => {
  const path = join(tmpdir(), `locus-v2-${Date.now()}.json`);
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  await new JsonFileStore(path).save({ version: 2, assets: r.state.assets, cards: [], tables: r.state.tables } as never);
  const back = await new JsonFileStore(path).load();
  assert.equal(back.version, 3);
  assert.equal(back.tables.length, 1);
  assert.deepEqual(back.topics, []);
  assert.deepEqual(back.subquestions, []);
  rmSync(path, { force: true });
});

// ── AI：独立任务 + 进程内配置 ───────────────────────────────
test("三个任务提示词与输出结构互不相同（不混用）", () => {
  const names = Object.keys(TASKS);
  assert.deepEqual(names.sort(), ["handwriting_ocr", "literature_extract", "protocol_parse"]);
  const systems = new Set(Object.values(TASKS).map((t) => t.system));
  const schemas = new Set(Object.values(TASKS).map((t) => t.schema));
  assert.equal(systems.size, 3);
  assert.equal(schemas.size, 3);
});

test("配置来自环境、缺项即 null；状态不泄露 key", () => {
  assert.equal(aiConfigFromEnv({}), null);
  assert.equal(aiConfigFromEnv({ LOCUS_AI_BASE_URL: "https://x", LOCUS_AI_MODEL: "m" } as never), null); // 缺 key
  const cfg = aiConfigFromEnv({ LOCUS_AI_BASE_URL: "https://x/", LOCUS_AI_MODEL: "m", LOCUS_AI_KEY: "secret" } as never)!;
  assert.equal(cfg.baseUrl, "https://x"); // 去尾斜杠
  const status = describeConfig(cfg);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("AI 文献抽取：经 stub 走通并映射为证据卡（extraction=ai）", async () => {
  const cfg: AiConfig = { baseUrl: "https://stub", model: "m", key: "k" };
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"cards":[{"rawText":"pH 3 下最适","extracted":{"fields":{"pH":"3"},"units":[]},"unknowns":[]}]}' } }] }), { status: 200 })) as typeof fetch;
  try {
    const out = await runTask(cfg, "literature_extract", "文本");
    assert.equal((out.value as { cards: unknown[] }).cards.length, 1);
    const r = await importLiterature(emptyState(), { name: "l.md", text: "文本", mode: "ai" }, cfg);
    assert.equal(r.state.cards[0].extraction, "ai");
    assert.equal(r.state.cards[0].rawText, "pH 3 下最适");
    assert.ok(r.audit && r.audit.raws.length === 1);
  } finally { globalThis.fetch = orig; }
});

test("AI 未配置却要求 ai 模式 → 400（不冒充）", async () => {
  await assert.rejects(importLiterature(emptyState(), { name: "l", text: "x", mode: "ai" }, null), (e: unknown) => e instanceof AppError && e.status === 400);
});

test("AI 输出结构不符 → 报错（不静默补造）", async () => {
  const cfg: AiConfig = { baseUrl: "https://stub", model: "m", key: "k" };
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"nope":1}' } }] }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(importLiterature(emptyState(), { name: "l", text: "x", mode: "ai" }, cfg));
  } finally { globalThis.fetch = orig; }
});

// ── 第二轮修复回归 ──────────────────────────────────────────
test("analyseTable：跳过章节标记行、识别真表头、丢弃键列独占空行", () => {
  const rows = [
    ["   Reactions", "", "", ""],
    ["ID", "Name", "pH value", "Reversible"],
    ["r0", "ABTS oxidation", "3", "irreversible"],
    ["r1", "", "", ""],
    ["r2", "", "", ""],
  ];
  const { columns, body } = analyseTable(rows);
  assert.deepEqual(columns, ["ID", "Name", "pH value", "Reversible"]);
  assert.equal(body.length, 1);
  assert.deepEqual(body[0], ["r0", "ABTS oxidation", "3", "irreversible"]);
});

test("真实 EnzymeML CSV：表头正确、空占位行被丢弃", () => {
  const csv = "\uFEFF,,,,\n   Reactions,,,\nID,Name,Temperature value,pH value\nr0,ABTS oxidation,25,3\nr1,,,\nr2,,,\n";
  const r = importMeasurements(emptyState(), { name: "EnzymeML_SLAC_pH5_5__Reactions.csv", csv });
  const t = r.state.tables[0];
  assert.deepEqual(t.columns, ["ID", "Name", "Temperature value", "pH value"]);
  assert.equal(t.rows.length, 1);
  assert.equal(r.created, 1);
});

test("extractJson 容错：围栏/未加引号键/尾逗号", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('{a:1,b:"x"}'), { a: 1, b: "x" });
  assert.deepEqual(extractJson('{"a":1,}'), { a: 1 });
});

test("chunkText 按段落分块，不超上限丢内容", () => {
  const chunks = chunkText("a".repeat(100) + "\n\n" + "b".repeat(100), 150);
  assert.equal(chunks.length, 2);
});

test("内容 hash 拒重：同内容二次导入 → 409（两条路径）", async () => {
  const s1 = await importLiterature(emptyState(), { name: "l.md", text: "同样内容" });
  await assert.rejects(importLiterature(s1.state, { name: "l.md", text: "同样内容" }), (e: unknown) => e instanceof AppError && e.status === 409);
  const m1 = importMeasurements(emptyState(), { name: "d.csv", csv: "a,b\n1,2" });
  assert.throws(() => importMeasurements(m1.state, { name: "d.csv", csv: "a,b\n1,2" }), (e: unknown) => e instanceof AppError && e.status === 409);
});

test("格式不支持 → 明确拒绝（文献非 md / 数据非 csv）", async () => {
  await assert.rejects(importLiterature(emptyState(), { name: "paper.pdf", text: "x" }), (e: unknown) => e instanceof AppError && e.status === 422);
  assert.throws(() => importMeasurements(emptyState(), { name: "book.xlsx", csv: "a,b\n1,2" }), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("Markdown 文献文件可导入（.md）", async () => {
  const r = await importLiterature(emptyState(), { name: "methods-source.md", text: "# 方法\npH 3 下最适 60°C。" });
  assert.equal(r.state.cards.length >= 1, true);
});

test("疑似二进制内容 → 拒绝", () => {
  assert.throws(() => importMeasurements(emptyState(), { name: "d.csv", csv: "a,b\n1,\u0000" }), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("detectDelimiter：逗号/制表符/无（仪器导出）", () => {
  assert.equal(detectDelimiter("a,b\n1,2"), ",");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(detectDelimiter("##BLOCKS= 2\nNote:\nprose"), null);
});

test("TSV 导入可用（按制表符解析）", () => {
  const r = importMeasurements(emptyState(), { name: "t.tsv", csv: "a\tb\tc\n1\t2\t3\n4\t5\t6\n" });
  assert.deepEqual(r.state.tables[0].columns, ["a", "b", "c"]);
  assert.equal(r.state.tables[0].rows.length, 2);
});

test("仪器导出（前言+制表符块，首行无分隔符）→ 明确拒绝，不硬解析", () => {
  const tc = "##BLOCKS= 2\nNote:\nBasic Endpoint Protocol\n00:00:00\t25\t0.03\n00:01:28\t25\t0.04\n";
  assert.throws(() => importMeasurements(emptyState(), { name: "run.txt", csv: tc }), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("两级表头合并：首级空缺由下一级填充（EnzymeML 风格）", () => {
  const rows = [
    ["   Data", "", "", "", "", ""],
    ["Experiment ID", "Type", "Reaction", "Protein", "", ""],
    ["", "", "", "Name", "Initial concentration", "Unit"],
    ["exp-1", "kinetic", "r1", "SLAC", "5", "mM"],
  ];
  const { columns, body } = analyseTable(rows);
  assert.deepEqual(columns, ["Experiment ID", "Type", "Reaction", "Protein/Name", "Initial concentration", "Unit"]);
  assert.equal(body.length, 1);
  assert.deepEqual(body[0], ["exp-1", "kinetic", "r1", "SLAC", "5", "mM"]);
});

test("下一行像数据行(r0) → 不误合并表头（Vessels 风格）", () => {
  const rows = [
    ["   Vessels", "", "", ""],
    ["ID", "Name", "Volume value", "Volume unit"],
    ["r0", "cup", "1", "mL"],
  ];
  const { columns, body } = analyseTable(rows);
  assert.deepEqual(columns, ["ID", "Name", "Volume value", "Volume unit"]);
  assert.equal(body.length, 1);
});

test("headerRows 显式指定（1/2）", () => {
  const rows = [["A", "B"], ["C", "D"], ["1", "2"]];
  assert.deepEqual(analyseTable(rows, 1).columns, ["A", "B"]);
  assert.deepEqual(analyseTable(rows, 2).columns, ["A/C", "B/D"]);
});

test("AI 分块失败（某块结构不符）→ 报错，不静默补造", async () => {
  const cfg: AiConfig = { baseUrl: "https://stub", model: "m", key: "k" };
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"nope":1}' } }] }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(importLiterature(emptyState(), { name: "l.md", text: "x", mode: "ai" }, cfg));
  } finally { globalThis.fetch = orig; }
});

test("MemoryStore 基本往返", async () => {
  const mem = new MemoryStore();
  const r = await importLiterature(emptyState(), { name: "s", text: "一段" });
  await mem.save(r.state);
  assert.equal((await mem.load()).cards.length, 1);
});

// ── 4A：课题/子问题 + 材料归属 ──────────────────────────────
test("课题最小创建：仅名称+研究问题；空值 422", () => {
  const r = createTopic(emptyState(), { name: "酶动力学", researchQuestion: "温度与pH如何影响活性" });
  assert.equal(r.state.topics.length, 1);
  assert.throws(() => createTopic(emptyState(), { name: "", researchQuestion: "q" }), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("子问题须挂在存在的课题下；可探索性", () => {
  const t = createTopic(emptyState(), { name: "T", researchQuestion: "Q" });
  const s = createSubquestion(t.state, { topicId: t.topic.id, question: "是否存在阈值", kind: "exploratory" });
  assert.equal(s.subquestion.kind, "exploratory");
  assert.throws(() => createSubquestion(emptyState(), { topicId: "nope", question: "x" }), (e: unknown) => e instanceof AppError && e.status === 404);
});

test("导入材料可归属课题（topicId）", async () => {
  const t = createTopic(emptyState(), { name: "T", researchQuestion: "Q" });
  const r = await importLiterature(t.state, { name: "l", text: "一段", topicId: t.topic.id });
  assert.equal(r.asset.topicId, t.topic.id);
  const m = importMeasurements(t.state, { name: "d.csv", csv: "a,b\n1,2", topicId: t.topic.id });
  assert.equal(m.asset.topicId, t.topic.id);
});

// ── AI 配置内置到网页（运行时内存，不落盘）──────────────────
test("运行时 AI 配置：设置/读取/清除；不完整不生效；状态不含 Key", () => {
  clearAiConfig();
  assert.equal(getAiConfig(), null);
  assert.equal(setAiConfig({ baseUrl: "https://x/v1", model: "m" }), false);
  assert.equal(getAiConfig(), null);
  assert.equal(setAiConfig({ baseUrl: "https://x/v1/", model: "m", key: "SECRET" }), true);
  assert.equal(getAiConfig()!.baseUrl, "https://x/v1");
  assert.equal(JSON.stringify(describeConfig(getAiConfig())).includes("SECRET"), false);
  clearAiConfig();
  assert.equal(getAiConfig(), null);
});

test("HTTP：网页配置 AI → 状态可见、Key 不回显、可清除", async () => {
  clearAiConfig();
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  try {
    let s = (await (await fetch(`${base}/api/ai/status`)).json()) as { configured: boolean };
    assert.equal(s.configured, false);

    const post = await fetch(`${base}/api/ai/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://api.agnes-ai.cn/v1", model: "m", key: "SECRET" }),
    });
    assert.equal(post.status, 200);
    const body = await post.json();
    assert.equal(body.configured, true);
    assert.equal(JSON.stringify(body).includes("SECRET"), false);

    const cleared = (await (await fetch(`${base}/api/ai/config`, { method: "DELETE" })).json()) as { configured: boolean };
    assert.equal(cleared.configured, false);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
  }
});
