// 验收台种子：只建课题/子问题（真实 TS 用例函数），材料保持「待上传」。
// 用法：node scripts/acceptance-seed.ts [数据文件] [--force]
// --force 清空验收环境重建；不影响主实例 data/state.json。
import { JsonFileStore, MemoryStore } from "../store.ts";
import { createTopic, createSubquestion } from "../services/app.ts";

const file = process.argv[2] ?? "data/acceptance.json";
const force = process.argv.includes("--force");
const store = new JsonFileStore(file);
let state = await store.load();
if (state.topics.length > 0 && !force) {
  console.log(`验收数据已有课题（${file}），不覆盖。重建请加 --force（仅清验收环境）。`);
  process.exit(0);
}
if (force) state = await new MemoryStore().load();

const t = createTopic(state, {
  name: "SLAC 漆酶动力学表征（验收演示）",
  researchQuestion: "pH 3–5.5、25–45°C 范围内 SLAC 动力学参数如何随条件变化？数据与条件的关联是否可信？",
});
state = t.state;
const subs: { question: string; kind: "declared" | "exploratory" }[] = [
  { question: "各 pH/温度条件下的动力学参数有何差异？", kind: "declared" },
  { question: "标准曲线与双通道质量平衡质控能否支撑浓度换算？", kind: "declared" },
  { question: "对照扣除策略能否推广到其他漆酶？", kind: "exploratory" },
];
for (const s of subs) state = createSubquestion(state, { topicId: t.topic.id, question: s.question, kind: s.kind }).state;
await store.save(state);
console.log(`已种子：课题 ${t.topic.id} + ${subs.length} 子问题 → ${file}`);
console.log("材料均为待上传；启动：PORT=5180 LOCUS_DATA=" + file + " node server.ts，打开 /acceptance.html");