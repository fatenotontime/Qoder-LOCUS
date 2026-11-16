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
  importLiterature,
  importMeasurements,
  parseCsv,
  reviewCard,
  reviewTable,
  sourceView,
} from "../services/app.ts";
import { aiConfigFromEnv, clearAiConfig, describeConfig, getAiConfig, setAiConfig, TASKS, runTask, type AiConfig } from "../services/ai.ts";
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
    assert.ok((out as { cards: unknown[] }).cards.length === 1);
    const r = await importLiterature(emptyState(), { name: "l", text: "文本", mode: "ai" }, cfg);
    assert.equal(r.state.cards[0].extraction, "ai");
    assert.equal(r.state.cards[0].rawText, "pH 3 下最适");
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

test("MemoryStore 基本往返", async () => {
  const mem = new MemoryStore();
  const r = await importLiterature(emptyState(), { name: "s", text: "一段" });
  await mem.save(r.state);
  assert.equal((await mem.load()).cards.length, 1);
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
