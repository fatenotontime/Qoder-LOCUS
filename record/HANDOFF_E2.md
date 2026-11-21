# E2 完成交接（简要）

> 范围：知识库防偏移执行合同 **E2 提取契约**（§5.3/§5.4/§6/§8，判据 **T06–T12、T24** ＋ §4.6 新壳守卫）。
> 状态：**passed**（PR 合入 main 后生效）。执行依据见 [KNOWLEDGE_BASE_EXECUTION_SPEC.md](../docs/architecture/KNOWLEDGE_BASE_EXECUTION_SPEC.md)；完整过程见 [会话记录 S05-T4](sessions/2026-11-21_session-05.md#s05-t4) 与 [提交台账 #85](COMMIT_LEDGER.md)。

## 一句话结论

知识提取已从「按段落拆文本、返回 cards 数组」换成**结构化 run 契约**：输入被冻结、逐字引文由服务端定位、一个块要么整批入库要么整块拒收、重放与重启都凭回执不重复计数，且未适配的旧消费者遇到新壳一律显式拒绝而不是静默半用。

## 落点

| 文件 | 承担 |
| --- | --- |
| `sciworkbench/services/knowledge.ts` | `prepareKnowledgeRun`（输入冻结＋`inputHash`）、`chunkInputTexts`（冻结块＋有界补读）、`validateKnowledgeBatch`（整批校验）、`locateQuote`（逐字定位）、`buildKnowledgeBatch`（壳＋实体同批、全部待审）、`commitKnowledgeChunk`（回执优先→取消→同笔写入）、`settleRun` |
| `sciworkbench/server.ts` | 知识路由编排：幂等（200 `replayed` / 409 `idempotency_conflict` / 202）、模型调用在队列外且提交在队列内、单块失败隔离与逐块重试、取消/暂停/继续、`GET /api/knowledge/runs/:id`、启动 `running→interrupted`、计数由回执推导 |
| `sciworkbench/services/{app,analysis,context-map,references}.ts` | §4.6 守卫：422 `structured_knowledge_required`（比较／采用 adopt／分析 core 与勾选／地图 pick）、409（整卡确认、整卡改原文）；备注与重要度放行；地图呈现但不可选 |
| `sciworkbench/public/lib/{api.js,pages/knowledge.js}` | 表单带 `attachmentIds`＋输入派生幂等键；动作按 `runId`；replayed/未定位提示；新壳只读标「待逐项审」，一键跳过不含新壳 |
| `sciworkbench/tests/knowledge-pipeline.test.ts` | T06–T12、T24、E2 守卫（fetch 门控桩） |
| `sciworkbench/tests/ai-stream.test.ts` | 五个块级流式例改写到新契约＋新增**落盘重启续跑**（真 HTTP 假模型、`JsonFileStore` 临时目录、两个 app 生命周期） |
| `sciworkbench/tests/papers-knowledge.test.ts`、`web-loop.test.ts` | 旧函数依赖清除；单元段改用 `prepareKnowledgeRun/buildKnowledgeBatch/commitKnowledgeChunk`；AI 任务清单 8→9（`knowledge_struct`） |

## 验收证据

- `npm --prefix sciworkbench test` → **279 / 279 通过**（E1 合入后基线 269，本轮 +10）。
- 关键硬断言：非法输入 0 模型调用＋0 run；同键同输入返回同 `runId`；已提交块重试**不重调模型**（按块请求次数断言）；歧义引文不挑第一个；未命中不产生假偏移；越界 `sourceBlockId` 整块拒收；取消丢弃在途响应且无回执；重启后 `interrupted`/`paused` 可续跑且累计计数不重复。
- 前端三文件 `node --check`（ESM 方式）通过；未触碰活体实例 `127.0.0.1:5184 / 5187 / 5191`。

## 顺手修掉的真实缺陷（新测试暴露）

1. 回执重放路径按 `prepared.index` 找块 → 422「块不存在…第 undefined 块」（改为显式 `index`）。
2. 循环正常跑完不置 `job.status` → 前端无限轮询（收尾补 `done`）。
3. relation 被要求携带 `localId`（合同里没有）→ 合法批被整块拒收。
4. relation 端点指向卡时**构建期**崩溃 → 校验期可寻址集合＋「多项卡歧义」拒收＋单项卡别名。
5. 最后一块重试成功后 run 仍显示 `partial` → 重试收尾回推 `completed`。
6. 故意不回复的测试桩会挂住 `postChat` 120s 超时计时器（测试基建，非产品行为）。

## 下一步：E3（分项人审、主题与消费者守卫）

- 判据：合同 §11 的 **T13–T16、T25** ＋ §12.3 浏览器验收（验收截图由用户提供，agent 只引用路径）。
- 入口已经就绪：知识项/上下文/证据/关系与 unknown 都已入库且全部 `pending`，阅读壳只读；E3 要补的是**分项审阅**（逐项确认/修正/拒绝、unknown 处置）与审阅状态如何派生回卡片与消费者。
- 仍需单独授权，**不得擅自执行**：真实模型调用与外部工具发送（S03）、真人课题数据（S02）、B1 只读监听（S07）。
- 协作不变：短命分支（建议 `feat/s05-e3-item-review`）→ 全绿 → 由 `git log` 写记录 → PR merge commit；台账 #85 的 merge hash 在 E3 那轮回填。
