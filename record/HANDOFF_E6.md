# E6 交接（进行中：E6-A 完成，E6-B 阻塞）

> 范围：知识库防偏移执行合同 **E6 容器式知识可视化与新前端页面集成**（最新修订版 E6.1–E6.5；判据 T36–T40＋§12 浏览器全链＋E6.5 子用例）。
> 状态：**E6-A 容器/流水线数据接线 = 已完成**（代码 `5775dcd` · 2026-11-21 19:02，PR #14 merge `b5d63f1` · 19:05）；**E6-B 新页面集成＋真实浏览器验收 = 阻塞（等前端交付）**；E6 整体**未 passed**。
> 依据：合同 E6 段（该修订原为 S04-T11 的工作区改动，随本 PR 原样落库）；过程见 [会话记录 S05-T8](sessions/2026-11-21_session-05.md#s05-t8) 与 [台账 #92](COMMIT_LEDGER.md)。

## 一句话状态

容器需要的**数据面已就绪**（元素/聚合/计数/同源/固定版本/流水线真实状态，全走既有读取与门槛）；**页面与浏览器验收未开始**——合同 E6.4 明确「等前端完成」的停点须由用户确认前端可接入，且接入表要用**真实前端交付**填写；`public/lib/pages/knowledge-base.js` 只是合同建议落点，不是前端唯一文件名，占位不算交付。

## 本轮落点（E6-A）

| 文件 | 承担 |
| --- | --- |
| `sciworkbench/services/knowledge-base.ts` | `buildKnowledgeContainer`（E6.2）、`knowledgePipelineStatus`（E6.3） |
| `sciworkbench/server.ts` | 只读 `GET /api/knowledge/container`（复用 §7.1 读取与 §7.5 访问检查）、`GET /api/knowledge/pipeline/:runId` |
| `sciworkbench/tests/knowledge-base.test.ts` | E6-A①②③⑤＋④（回执计数）、E6.5②a/b/c 反例 |
| `sciworkbench/tests/knowledge-view.test.ts` | 容器/流水线路由往返结构 |

数据侧已落实的容器语义（E6.2）：一条知识项 = 一个可寻址元素（固定 `KnowledgeRef(kind=item,id,revision)`）；数据集为**聚合元素**且「知识项数 / 数据集数」分开；外观类别由 `contentType/nature/sourceClass/review` 决定（不靠随机颜色）；条件随项、来源 token 可回查；`matched / loaded / totalKnown` 分列（不把一页冒称全库）；**卡壳不另计一条知识**（`cardIndex` 单列）；同源论文单入口（`bySource`）；未分主题的正式项单列（`undivided`，不丢弃）。

流水线（E6.3）：`knowledgePipelineStatus` 只从**已落库** run/chunk/receipt 计数——「请求已发出」不等于候选已保存，回执重放/刷新不重复计数，失败块与被丢弃块可见且不计入正式沉淀。

## E6.4 接入表（E6-A 侧已填；前端交付列**待交付**，不凭旧文件名/旧 DOM/固定四栏推断）

| 接入项 | 前端交付 | E6 集成职责（当前） |
| --- | --- | --- |
| 页面骨架与导航 | **待交付**：知识总览/继续积累/wiki/比较入口、返回方式、实际路由与模块路径 | 未接；数据接口就绪（`/api/knowledge/container`，保留 `scope/viewId/snapshotId`） |
| 大容器 | **待交付**：已确认外形、挂载/卸载方式、尺寸、主题变量、元素/聚合/详情交互（石榴仅候选） | **数据侧就绪**：元素/聚合/计数/图例素材/同源列表；不伪造填充数据 |
| 审阅与原文 | **待交付**：卡片详情承载方式、阅读页定位接口、附件/版本切换参数 | 未接；人审与 run 接口已在（`items/:id`〔?revision/?snapshotId〕、`pipeline/:runId`） |
| 共用状态与素材 | **待交付**：当前课题传递、加载/错误规范、迹芽资产与动效规范 | 数据侧就绪（真实状态映射、去重回执）；**减少动态效果**下纯文字状态可用 |
| 文件归属 | 待协调（前端持骨架/导航/全局样式；记录并行修改文件） | 本轮只改后端服务/路由与两个测试文件，未触碰前端文件 |

## 待裁决 / 未闭环（接手必读）

1. **E6.5② 固定版本审核口径——已闭环（S05-T9，用户裁决「按 §4.2 修正」）**：反例已跑（`tests/knowledge-base.test.ts` 的 E6.5②a/b/c）——
   - 引用钉**旧版 pending**、当前新版 confirmed、**未显式改绑** → 当前实现**放行**（合同 §4.2 要求核查被引用版本 → 应拒绝直到改绑）；
   - 引用钉**旧版 confirmed**、当前新版回 pending → 当前实现**拒绝**（合同按固定版应放行）；
   - 当前被**撤回** → 一致阻断。
   处置：已按 §4.2 修正——新增 `knowledgeItemGate`（**被引用版本 review ＋ 当前非 withdrawn/excluded**），`knowledgeItemConfirmedAt`/`itemFormalUsable`/比较门槛/analysis 勾选与冻结前复检统一改用；受影响测试有意更新（E6.5②a/b 断言合同行为；T13「回 needs_info」改判放行并补撤回断言）；E3 其余用例未改即通过，实现与 HANDOFF_E3 所述口径对齐。见 [S05-T9](sessions/2026-11-21_session-05.md#s05-t9)。
2. **容量未验证（E6.5⑤.1）**：合同 §12.2 负载为 **10000 行×10 列**＋完整增长负载；E5 交接的「31 行」是防截断样例（已在 HANDOFF_E5 勘误）。未测 → 不能判断是否触发 S08，也不得用 S08 名义免测、不得降负载。
3. **旧比较适配（E6.5⑤.3）**：写入 `POST /api/comparisons`（`server.ts:1134`）→ `createComparison`（`services/app.ts:598`）→ 旧 `state.comparisons`；前端消费者 `public/lib/api.js:20`、`public/app.js:1094`、`public/app.js:2514`；读取侧 `legacyComparisonViews` 目前**仅测试在用**。合同 §7.2 要求旧入口改「读取适配」；需业务变更时单独报告，不混进页面重构。
4. 过时边界勘误：总交接旧句「retry-chunk 在队列内等待模型」已不成立（当前 `server.ts` 该路由在队列外）；未复测并发，不声称已改 202 后台化。

## 恢复 E6-B 的前置（缺一不可）

1. 前端交付**真实**页面骨架/导航/容器组件/阅读定位/素材，并按 E6.4 接入表逐项落成实证（模块路径、挂载方式、实际路由）。
2. 用户**明确确认**「等前端完成」的停点已满足（合同 E6.4：不得自行解除）。
3. 就 E6.5② 的口径裁决（是否需要按 §4.2 修正门槛）；未闭环前**不得签署 E6 正式使用全链验收**（合同 E6.5 明确）。
4. 浏览器验收用 synthetic 隔离数据（不调真实模型、不复制内部样本、不覆盖现用实例），截图由用户负责；T36–T40＋E6.5 子用例 ①–⑧ 需真实浏览器通过。

## Git

- 分支 `feat/s05-e6a-container`（自 main `3f86aeb`）：代码 `5775dcd`（19:02）、记录 `9bdca3c`（19:04）；**PR #14 已以 merge commit `b5d63f1`（19:05）合入 main**（台账 #92 已回填）。
- 本 PR **同时原样落库** S04-T11 的合同 E6 修订、台账 #89–#91、session-04 补录与 HANDOFF_E0-E8/E5 追加（内容未改动）；不含 `record/sessions/2026-11-17_session-02.md` 与用户材料。
- 流程偏差留痕：E6-A 提交一度落在本地 main（未推送），随即 `git branch -f main origin/main` 复位并改挂功能分支。
