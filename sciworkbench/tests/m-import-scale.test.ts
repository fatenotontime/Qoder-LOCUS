/**
 * A08 规模：10000 数据行 × 10 列 + 独立表头，CSV 与 XLSX 全量解析 + 画像。
 * 记录耗时与内存测量方式（heapUsed 快照），不设虚假性能承诺。
 */
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseBytes, profileGrid } from "../services/import-formats/index.ts";

const ROWS = 10000;
const COLS = 10;
const HEADER = Array.from({ length: COLS }, (_, c) => `c${c}`);

function makeCsv(): Uint8Array {
  const lines: string[] = [HEADER.join(",")];
  for (let r = 0; r < ROWS; r++) {
    const cells = Array.from({ length: COLS }, (_, c) => (c === 0 ? `r${r}` : String(c * 1000 + r)));
    lines.push(cells.join(","));
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

async function makeXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Big");
  ws.addRow(HEADER);
  for (let r = 0; r < ROWS; r++) {
    ws.addRow(Array.from({ length: COLS }, (_, c) => (c === 0 ? `r${r}` : c * 1000 + r)));
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function timed<T>(label: string, fn: () => T): T {
  const h0 = process.hrtime.bigint();
  const m0 = process.memoryUsage().heapUsed;
  const out = fn();
  const ms = Number(process.hrtime.bigint() - h0) / 1e6;
  const dm = (process.memoryUsage().heapUsed - m0) / 1024 / 1024;
  console.log(`  [A08] ${label}: ${ms.toFixed(0)} ms, heapUsed Δ ${dm.toFixed(1)} MiB`);
  return out;
}

test("A08 CSV 10000×10：完整解析 + 画像，末行与计数正确", async () => {
  const csv = makeCsv();
  const r = await timed("csv parse", () => parseBytes(csv, "big.csv"));
  assert.equal(r.status, "ok");
  const t = r.tables[0];
  assert.equal(t.rows.length, ROWS + 1); // 表头 + 数据
  assert.deepEqual(t.rows[0], HEADER);
  assert.equal(t.rows[ROWS][0], `r${ROWS - 1}`); // 末数据行
  const p = timed("csv profile", () => profileGrid(t));
  assert.equal(p.totalRows, ROWS + 1);
  assert.equal(p.totalColumns, COLS);
  assert.equal(p.columns[0].nonEmpty, ROWS + 1);
});

test("A08 XLSX 10000×10：完整解析 + 画像，末行与计数正确", async () => {
  const xlsx = await makeXlsx();
  const r = await timed("xlsx parse", () => parseBytes(xlsx, "big.xlsx", { sheet: "Big" }));
  assert.equal(r.status, "ok");
  const t = r.tables[0];
  assert.equal(t.rows.length, ROWS + 1);
  assert.equal(t.rows[ROWS][0], `r${ROWS - 1}`);
  const p = timed("xlsx profile", () => profileGrid(t));
  assert.equal(p.totalRows, ROWS + 1);
  assert.equal(p.columns[COLS - 1].nonEmpty, ROWS + 1);
});
