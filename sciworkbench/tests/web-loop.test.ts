import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { emptyState, JsonFileStore, MemoryStore } from "../store.ts";
import {
  AppError,
  importLiterature,
  importMeasurements,
  parseCsv,
  reviewCard,
  reviewMeasurement,
  sourceView,
} from "../services/app.ts";

test("parseCsv 支持引号与逗号", () => {
  const rows = parseCsv('a,b\n"x,y",2\n');
  assert.deepEqual(rows, [["a", "b"], ["x,y", "2"]]);
});

test("导入文献：生成待审卡（unreviewed），id 为 uuid 非内容派生", () => {
  const r = importLiterature(emptyState(), { name: "src", text: "P1\n\nP2" });
  assert.equal(r.created, 2);
  assert.ok(r.state.cards.every((c) => c.audit === "unreviewed"));
  assert.ok(r.state.cards[0].id.startsWith("card_"));
  // 内容相同但 id 不同（稳定 ID 与显示名分离）
  const r2 = importLiterature(emptyState(), { name: "src", text: "P1\n\nP2" });
  assert.notEqual(r.state.cards[0].id, r2.state.cards[0].id);
});

test("导入 CSV：逐单元格生成待核对项，带源定位", () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "time,abs\n0,0.1\n30,0.3" });
  assert.equal(r.created, 4);
  const m = r.state.measurements[0];
  assert.equal(m.source.rowIndex, 1);
  assert.equal(m.source.column, "time");
  assert.equal(m.decision, "unreviewed");
});

test("CSV 缺数据行 → 422", () => {
  assert.throws(() => importMeasurements(emptyState(), { name: "d.csv", csv: "a,b\n" }), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("人工核对：排除必须给原因（422），给原因通过", () => {
  const r = importLiterature(emptyState(), { name: "s", text: "只有一段" });
  const id = r.state.cards[0].id;
  assert.throws(() => reviewCard(r.state, id, { audit: "exclude" }), (e: unknown) => e instanceof AppError && e.status === 422);
  const s2 = reviewCard(r.state, id, { audit: "exclude", reason: "不适用" });
  assert.equal(s2.cards[0].audit, "exclude");
  assert.equal(s2.cards[0].reason, "不适用");
});

test("测量核对：更新数值/单位/结论", () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  const id = r.state.measurements[0].id;
  const s2 = reviewMeasurement(r.state, id, { value: "0", unit: "s", decision: "confirm" });
  assert.equal(s2.measurements[0].unit, "s");
  assert.equal(s2.measurements[0].decision, "confirm");
});

test("原件回查：返回素材原文与定位点（两条路径）", () => {
  const lit = importLiterature(emptyState(), { name: "l", text: "甲\n乙" });
  const sv1 = sourceView(lit.state, lit.asset.id);
  assert.equal(sv1.asset.kind, "literature");
  assert.equal(sv1.points.length, 2);
  assert.equal(sv1.points[0].locate, "甲");

  const dat = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  const sv2 = sourceView(dat.state, dat.asset.id);
  assert.equal(sv2.asset.kind, "measurement");
  assert.match(sv2.points[0].locate, /第 2 行 · t/);
});

test("刷新恢复：MemoryStore 与 JsonFileStore 往返一致", async () => {
  const r = importLiterature(emptyState(), { name: "s", text: "一段" });
  const mem = new MemoryStore();
  await mem.save(r.state);
  assert.equal((await mem.load()).cards.length, 1);

  const path = join(tmpdir(), `locus-test-${Date.now()}.json`);
  const file = new JsonFileStore(path);
  await file.save(r.state);
  const back = await file.load();
  assert.equal(back.cards.length, 1);
  assert.equal(back.assets[0].hash, r.asset.hash);
  rmSync(path, { force: true });
});

test("存储缺文件 → 空状态（不抛）", async () => {
  const s = await new JsonFileStore(join(tmpdir(), `locus-missing-${Date.now()}.json`)).load();
  assert.deepEqual(s, emptyState());
});
