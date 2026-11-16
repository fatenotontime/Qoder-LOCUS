/**
 * v5→v6 迁移验证（只读原件，输出到指定副本路径）：
 *   node scripts/verify-migration.ts <源 state.json> <输出副本.json>
 * 校验：实体计数不减、原件 hash 逐条不变、加载→保存→再加载幂等（论文/附件不重复建）。
 */
import { readFileSync } from "node:fs";
import { JsonFileStore } from "../store.ts";

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("用法：node scripts/verify-migration.ts <源 state.json> <输出副本.json>"); process.exit(2); }
if (src === out) { console.error("源与输出不得同路径（保护原件）。"); process.exit(2); }

const before = JSON.parse(readFileSync(src, "utf8")) as Record<string, unknown[]> & { version?: number };
const store = new JsonFileStore(out);
const migrated = await new JsonFileStore(src).load(); // 只读源；迁移发生在 load
await store.save(migrated);
const again = await store.load(); // 再加载：幂等检查

const keys = ["topics", "subquestions", "assets", "cards", "tables", "adoptions", "mappings", "comparisons", "protocols", "templates", "executions", "samples", "measurements", "impacts", "ocrs"] as const;
let fail = 0;
console.log(`源版本 v${before.version ?? "?"} → v${migrated.version}`);
for (const k of keys) {
  const b = (before[k] ?? []).length;
  const m = (migrated[k] as unknown[]).length;
  const ok = m >= b;
  if (!ok) fail++;
  console.log(`${ok ? "✔" : "✖"} ${k}: ${b} → ${m}`);
}
console.log(`papers: ${(before.papers ?? []).length} → ${migrated.papers.length}；attachments: ${(before.attachments ?? []).length} → ${migrated.attachments.length}`);

const hashBefore = new Map(((before.assets ?? []) as { id: string; hash: string }[]).map((a) => [a.id, a.hash]));
let changed = 0;
for (const a of migrated.assets) if (hashBefore.get(a.id) !== a.hash) changed++;
console.log(`${changed === 0 ? "✔" : "✖"} 原件 hash 逐条不变（${migrated.assets.length} 条，变动 ${changed}）`);
if (changed) fail++;

const idem = again.papers.length === migrated.papers.length && again.attachments.length === migrated.attachments.length && again.cards.length === migrated.cards.length;
console.log(`${idem ? "✔" : "✖"} 保存→再加载幂等（papers ${again.papers.length} / attachments ${again.attachments.length} / cards ${again.cards.length}）`);
if (!idem) fail++;

const mech = migrated.cards.filter((c) => c.mechanical === true).length;
console.log(`机械草稿标记：${mech} / ${migrated.cards.length} 张卡`);
console.log(fail === 0 ? "迁移验证通过" : `迁移验证失败（${fail} 项）`);
process.exit(fail === 0 ? 0 : 1);