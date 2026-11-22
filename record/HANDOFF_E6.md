# E6 交接（进行中：E6-A 完成，E6-B 阻塞）

> 范围：知识库防偏移执行合同 **E6 容器式知识可视化与新前端页面集成**（最新修订版 E6.1–E6.5；判据 T36–T40＋§12 浏览器全链＋E6.5 子用例）。
> 状态：**E6-A 容器/流水线数据接线 = 已完成**（代码 `5775dcd` · 19:02，PR #14 merge `b5d63f1`）；**E6.5② 固定版本口径 = 已按 §4.2 修正**（`e6f48d8` · 20:15，PR #16 merge `f6bc9f5` · 20:16，见 [S05-T9](sessions/2026-11-21_session-05.md#s05-t9)）；**E6-B 新页面集成＋真实浏览器验收 = 阻塞（等前端交付）**；E6 整体**未 passed**。
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

## E6.4 接入表（S05-T16 核实版：前端交付列=事实，来自 PR/代码；E6 集成职责=我方要做的事）

> 核实基线：`origin/main` `46cfe5d`（#23 已并入）、`origin/feat/s05-t12-kz-overview`（#24 OPEN）、F 系列分支 `fix/s05-f7-review`；**PR #25（E8-A）已并入 main `dcb7b46`**。下方"前端交付"列只写代码/PR 中可核实的事实，未交付写"待前端补"。

| 接入项 | 前端交付（事实） | E6 集成职责（我方） |
| --- | --- | --- |
| 页面骨架与导航 | #23（已并入 main）：知识页插入 `knowledge-stage.js` 舞台与 `aiSproutHtml`；#24（OPEN）：知识页新增 `ui.kzPanel ∈ {library,cards,themes}`（默认 `library`）＋`localStorage` 记忆；F 系列另有 `ui.knowledgeView ∈ {overview,review}` → **与 #24 的 `kzPanel` 冲突，需 F 系列与 #24 合入后由前端合并** | 等前端合并定稿后确认知识页入口与返回目标（**当前「待定」**）；不另建导航，保持 `scope/viewId/snapshotId` |
| 大容器 | #24：`lib/pages/knowledge-container.js`（纯渲染）＋`knowledge-container.css`；数据经 `api.knowledgeContainer()` → `GET /api/knowledge/container`（`{topicId, mode:"explore", pageSize}`，单次响应）；状态 `ui.kzLib`：loading/ready/empty/unwired/error（404/405→`unwired`）；每聚簇展开上限 `DOT_LIMIT=60`，其余从同源列表进入；含 `dedupNote`（分项计数、卡不另计、版本不合并）；外形仅**内联 SVG 发芽图标占位**（非品牌素材，最终形象由用户决定） | 后端已就绪（`/api/knowledge/container` 在 main）；接线时按 E6.3 映射真实 run 状态；**不伪造填充数据**；品牌素材待用户定稿后再接 |
| 审阅与原文 | 审阅宿主仍是现有 `knowledge.js`（#23/#24 只在其**渲染点插入**舞台/入口，**未重写**审阅流程）；原文定位/返回参数**未见新增约定（待前端补）** | 迁入既有人审操作与 run 状态；验证"正确附件/固定版本"定位与 dirty/冲突保护 |
| 共用状态与素材 | `app.js` 为**共享文件**（#24 已改）；`ui.kzJob`（任务内存态）、`ui.kzLib`（库数据态）；素材仅内联 SVG 占位 | **把流水线任务恢复与计数改为以 `GET /api/knowledge/pipeline/:runId` 为准**（现舞台只观察内存 `ui.kzJob`，刷新/离开回待机）；减少动态效果下给纯文字状态 |
| 文件归属 | 前端持有 `knowledge-stage.js`／`knowledge-container.js` 与两份 CSS；`app.js` 共享 | 与前端约定 `app.js` 的修改先后；我方只改 `services/**`、`server.ts`、测试与 record |

### 「待前端补」清单（据代码核实，未交付/未接线）

1. **流水线任务恢复**：`/api/knowledge/pipeline/:runId`（我方已在 main 提供）**前端尚未调用**（`api.js` 无 `pipeline`；舞台只读 `ui.kzJob`）→ 待接线以实现刷新/离开后的任务恢复与真实计数。
2. **库总览功能入口**：容器仅有「继续积累」两个按钮（`data-kzlib-act="scan"|"statement"`），`app.js` **未见其处理**（未接线）；**快照／导出／比较／wiki 入口未接入**（文件内无对应调用）。
3. **知识页入口冲突**：F 系列 `ui.knowledgeView` 与 #24 `ui.kzPanel` 需前端合并定稿；**路由与返回目标「待定」**。
4. **品牌素材**：内联 SVG 发芽图标为占位；最终容器形态与迹芽素材由用户/前端定稿。
5. **原文定位约定**：审阅/阅读页的定位与返回参数未见交付约定。

### 与给定事实的核对差异（供你核对）

- 「审阅宿主沿用现有 `knowledge.js`，PR 未改」→ **不准确**：`knowledge.js` **被 #23/#24 修改**（仅在渲染点插入舞台/入口，审阅流程未重写）。
- 其余给定事实**均已核实为真**：`knowledge-container.js`＋CSS、`/api/knowledge/container`（`mode:"explore"`）、`api.knowledgeContainer`、`ui.kzLib` 五态、`DOT_LIMIT=60`、同源列表、`ui.kzPanel="library"`、`knowledge-stage.js` 只读 `ui.kzJob`＋卡片/知识项、内联发芽图标占位。
- **新增事实**：**PR #25（E8-A）已并入 main（`dcb7b46`）** → `/api/knowledge/container` 与 `/api/knowledge/pipeline/:runId` 在 main 上**均已可用**；**#23 已并入 main（`46cfe5d`）**，`knowledge-stage.js` 已在 main。

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
