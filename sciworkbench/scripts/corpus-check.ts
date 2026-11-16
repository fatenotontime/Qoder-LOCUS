/**
 * 真实语料结构回归：node scripts/corpus-check.ts <csv目录>
 * 逐文件跑 importMeasurements，打印每张表的列名/行数/块标记行/占位列。
 * 解析层任何改动后必须跑本脚本并核对结构差异，不以单测全绿代替。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AppError, importMeasurements } from "../services/app.ts";
import { emptyState } from "../store.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("用法：node scripts/corpus-check.ts <csv目录>");
  process.exit(2);
}
const files = readdirSync(dir).filter((f) => /\.(csv|tsv)$/i.test(f)).sort();
let ok = 0;
let rejected = 0;
let placeholder = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  try {
    const r = importMeasurements(emptyState(), { name: f, csv: text });
    ok++;
    const ph = r.state.tables.some((t) => t.columns.some((c) => /^col\d+$/.test(c)));
    if (ph) placeholder++;
    console.log(`OK   ${f}${ph ? "  [含占位列]" : ""}`);
    for (const t of r.state.tables) {
      console.log(`     ${t.name} | ${t.rows.length} 行(标记 ${(t.markerRows ?? []).length}) × ${t.columns.length} 列 | ${t.columns.join(" / ")}`);
    }
  } catch (e) {
    if (e instanceof AppError) {
      rejected++;
      console.log(`REJ  ${f} | ${e.status} ${e.message}`);
    } else throw e;
  }
}
console.log(`\n合计 ${files.length}：成功 ${ok} / 拒绝 ${rejected} / 含占位列表 ${placeholder}`);