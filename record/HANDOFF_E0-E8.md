# 知识库执行合同 E0–E8 交接文档

> 用途：交给下一个执行会话/协作者，零上下文接手知识库防偏移执行合同的推进。
> **唯一执行依据**：[知识库防偏移执行合同 v1.0](../docs/architecture/KNOWLEDGE_BASE_EXECUTION_SPEC.md)（下称「合同」）。本文与合同冲突时以合同为准；本文与仓库实际状态冲突时以 `git log` / `record/COMMIT_LEDGER.md` 为准。
> 本文只保留最终版。撰写时点：2026-11-21 15:30 前后，main HEAD `0f361aa`（PR #7 merge，13:09）；E3 代码在 `feat/s05-e3-item-review`（`26f7d65` 15:17 ＋ 记录 `22f677b` 15:18），PR #8 待合。

---

## 一、任务与授权边界

- 任务：按合同 §10 顺序执行 **E0→E8**，不跳步；每阶段强制 T 测试（合同 §11，ID 必须出现在测试名中）全部有同名测试且通过，才可标该阶段 passed。
- 用户已授权（S05-T2 拍板）：**连续执行 E0–E8**，逐阶段验收推进，不必每阶段重新请示。
- **不在授权内**（合同 §2.2 停点，须单独获准）：真实模型调用（S03）、外发/外部工具实测（S03）、真实用户课题数据（S02）、B1 只读监听器（S07）。自动测试一律 synthetic / fetch stub，不借达尔文等真实材料名义。
- 协作规程（AGENTS.md §5.1，2026-11-21 起）：**禁止 main 直提**；短命分支 `<type>/<会话号>-<主题>` → PR（merge commit，不 squash）→ 审计（`npm --prefix sciworkbench test` 全绿＋范围与标题一致＋无敏感文件）通过即自动合并（用户已授权此合并策略）。提交带 `Turn:`/`Agent:` trailer。
- 敏感文件不入仓库：`ai-config.json`（含 Key 明文）、私人测试包 `test-packages/`、`vibe_images/`、`record/screenshots/from-pictures/`、`reference reseach data/` 下用户材料。默认不读不打印 Key。
- 活体实例不得覆盖/重置：`127.0.0.1:5184`（用户 SLAC）、`5187`（达尔文验收）、`5191`（演示）。验证一律离屏、浏览器只用 Edge；截图由用户负责。
- 前端文案硬规则（E6 起相关）：导航/按钮 ≤4 字优先；禁 ISO 时间/英文枚举/裸版本出现在可见文本；词表唯一来源 `public/lib/format.js`；`public/app.js` 纯 JS 严禁 TS 语法。

## 二、已完成阶段（证据均在仓库）

### E0 — 基线与执行范围登记：**passed**（S05-T1）

- 基线：HEAD `14b6616`，`STATE_VERSION = 8`，`npm --prefix sciworkbench test` → **259/259 pass**。
- 产出（详见 [session-05 S05-T1](sessions/2026-11-21_session-05.md)）：server 内 60 处 `store.save` 写入点清单、cards 消费者清单（app/analysis/context-map/references/export/前端）、活体实例保护范围、授权缺口登记。
- 登记偏差：A `JsonFileStore.load()` 吞错返回空库（E1 已修）；B AI 任务提示词版本为字面量无集中常量（E2 处理）；C 合同 §9 新建文件当时全缺。
- 记录提交：`0d32601`（00:24，PR #4 merge `8256f8a` 00:26）；AGENTS.md 协作规程 `175bbe0`（00:21，用户特批直提 main 定约定）。

### E1 — 类型、迁移、单写入与源历史：**passed**（S05-T2/T3，两个 PR）

**PR #5**（分支 `feat/s05-e1-knowledge-foundation`，`78eb9e3` 00:44 → merge `5039167` 00:45）：

- 新建 `sciworkbench/domain/knowledge.ts`：合同 §4 全部类型（KnowledgeRef/SourceRef/TypedValue/Unknown/Review/Origin、item/context/condition/evidence/relation/theme/mapping/dataset/comparison/sourcePolicy/extractionRun/snapshot/sourceVersion）＋ `assertKnowledgeShape`、`stableStringify`、`canonicalHash`。
- `store.ts`：`STATE_VERSION` 8→**9**；`LocusState.knowledge` 命名空间（schemaVersion=1，12 集合）；v2–v8→v9 迁移补空 knowledge（旧实体 deepEqual 不变）；`load()` 改**仅文件不存在才空**，损坏/未知版本/缺集合显式拒绝。
- 新建 `services/knowledge-base.ts`：`sourcePayload`/`currentSourceRef`/`archiveSourceVersion`/`ensureArchived`/`readSourceVersion`/`resolveSourceVersion`（ok / source_missing / history_unavailable / content_mismatch，不读 latest 冒充旧版）。
- `services/export.ts`：`countsOf` 增 knowledge 计数；`inspectLibraryJson` 执行 `assertKnowledgeShape`。
- 新测试 `tests/knowledge-base.test.ts`：**T01/T02/T03/T20/T21**。既有 web-loop/export 测试按新 load 语义有意更新（非降断言）。当时 265/265。

**PR #6**（分支 `feat/s05-e1-commit-state`，`e7245c9` 01:32 → merge `b09029b` 01:35）：

- `server.ts` `createApp` 内 `commitState(changeFn)`：promise 串行队列；changeFn 执行时读**最新** state；**save 成功后才发布内存 state**；单笔失败不挂死队列。写方法整体入队，GET/HEAD/OPTIONS 直通只读已提交态。
- 49 处主模式改「先存后发布」；特殊写点（reviewCard/batchConfirm/cancelChat/retryChat/reviewTable+registerImpact/atResult 多附件）用局部 next 累积。
- 后台 job 全部「模型调用在队列外、写回在队列内对最新合并」：对话（取消检查入队）、知识逐块、文献 AI/方案解析/推荐、影响评估（**只合并本条 impact＋stale 守卫**）、OCR 追加。
- 新测试 `tests/knowledge-pipeline.test.ts`（GatedStore 延迟/失败驱动真实 HTTP）：**T04/T05/T22/T23**。
- 验证：**269/269 pass**。E1 强制判据 T01–T05、T20–T23 全部同名测试通过 → passed。
- **已知边界（如实登记）**：`retry-chunk` 路由在队列内 await 模型调用，重试期间其他写请求排队（不丢数据仅阻塞）；202 后台化属 API 行为变更，留待与前端一起改。

## 三、E2 — 文献提取与入库：**passed（S05-T4，代码 `7ca563e`；详见 [HANDOFF_E2.md](HANDOFF_E2.md)）**

合同 §10 E2：范围 knowledge.ts/ai.ts/server 知识路由＋最低 fail-closed 守卫；通过判据 **T06–T12、T24**（§11）；完整分项人审在 E3 开放。

> 本节 3.1–3.4 是**接手时刻的快照**（当时的未完成状态与计划），保留以便对照；实际落地结果见 3.5 与 [HANDOFF_E2.md](HANDOFF_E2.md)。

### 3.1 当前工作区真实状态（接手者先核对）

- 未提交改动（`git status`）：`sciworkbench/services/ai.ts`、`sciworkbench/services/knowledge.ts`、`sciworkbench/store.ts`、`record/COMMIT_LEDGER.md`（#84 merge hash 回填）。
- **当前工作区测试跑不绿**：`server.ts` 仍 `import { applyKnowledge, mapKnowledgeCards, prepareKnowledge } from "./services/knowledge.ts"`，而旧函数已随重写删除。实测 `import('./server.ts')` 报 `does not provide an export named 'applyKnowledge'`；整套测试因此挂起（失败用例遗留假 AI server 未关闭）。**这是预期中间态，不是 main 回归**——main（`b09029b`）仍是 269/269。
- 接手第一步：**先建分支**（建议 `feat/s05-e2-extraction`）再继续改；不要把这些改动提在 main。

### 3.2 已完成（未提交）

**`services/ai.ts`**：

- `TaskName` 增 `knowledge_struct`；常量 `KNOWLEDGE_STRUCT_PROMPT_VERSION = "knowledge_struct/v1"`、`KNOWLEDGE_STRUCT_SCHEMA_VERSION = 1`（处理 E0 偏差 B）。
- `TASKS.knowledge_struct`：研究意义提取系统提示＋完整输出 schema（`{schemaVersion:1, evidence, contexts, cards, relations}`；逐字引文带 sourceBlockId；禁模型指定 audit/revision/stableId/history；禁臆造库内 ID；抗注入）。
- `chunkTextSpans(text, size=4000)`：与旧 `chunkText` 同边界规则，但返回**精确原文切片＋start/end 偏移**（不改共享 `chunkText`，避免影响旧任务——合同 E2 禁止项）。
- `knowledgeStructInput(purpose, blockId, chunkText, index, total, supplements)`、`extractKnowledgeStructChunk(cfg, input)`。

**`services/knowledge.ts`（整体重写，旧 prepareKnowledge/map/apply 已删）**，导出与语义：

- `prepareKnowledgeRun(state, input)`：T06 严格校验（attachmentIds 显式非空数组、重复/不存在/不属该论文→422；子问题须属课题、无课题带子问题→422；idempotencyKey 必填）；**每附件独立分块**（≤24 块/附件，超限 422）；有界补读 `findSupplements`（表N/Table N/第X节/Section X 引用，选定附件内唯一标题行命中才补读，≤4000 字符，否则 unresolved_link）；`inputHash = canonicalHash(冻结输入含块计划)`；产出 `ExtractionRunRecord`。
- `validateKnowledgeBatch(value, blockIds)`：T12 整批校验——schemaVersion=1、四数组、localId 各集合内唯一、sourceBlockId 限本块＋补读块、悬空引用/非法 contentType/nature/relationType/模型禁带字段→整块拒收（AiError recoverable）；`cleanTypedValue` 六 kind 全校验，数值只收十进制字符串（不强行 parseFloat，无 NaN/Infinity）。
- `locateQuote(quote, spaces, fallbackRef)`：T09/T10 只在冻结块＋补读空间逐字 indexOf；0 命中→unmatched、1→matched（验证偏移）、>1→ambiguous＋全部候选；不默认首个。
- `chunkInputTexts(state, chunk)`：按固定 sourceRef 读原文，hash 漂移→409 content_mismatch；返回块文本/补读块/搜索空间/blockIds。
- `buildKnowledgeBatch(...)`：全部实体 rev1＋pendingReview；origin literature_report＋model；context.method 文字→额外方法 item＋methodRefs；evidence 定位不足→item/context unknowns（unresolved_link/ambiguous）；同概述已有项→duplicateCandidates **仅提示不去重**（T07）；阅读壳 `LitCardRecord` 带 `knowledgeItemIds`、extracted 空结构、spans 来自 evidence。
- `commitKnowledgeChunk(...)`：**receipt 重放守卫最先**（已提交块即使 run 已取消也返回原 receipt，不重调模型不重复写入，T08）；其次取消检查（在途未提交→discarded）；成功则壳＋items/contexts/evidence/relations＋receipt **同笔**追加（T23 语义）。
- `deriveRunStatus`/`settleRun`：running/paused/completed/partial/failed/cancelled/interrupted 推导。

**`store.ts`**：`LitCardRecord` 增 `knowledgeItemIds?: string[]`（非空即新契约壳；旧卡无此字段）。

### 3.3 未完成（按此顺序做）

1. **server 知识路由重写**（`server.ts` 约 364–466 行，设计已定）：
   - POST `/api/knowledge/jobs`：body 固定 `{paperId, attachmentIds, purpose, topicId?, subquestionId?, idempotencyKey}`；先查 `state.knowledge.extractionRuns` 幂等——同 key＋同 inputHash→返回既有 run（不新建不重调）；同 key＋异 inputHash→**409**；创建时 `ensureArchived`（paper＋各 asset，签名 `(state, k, kind, id)→{ref, knowledge}|null`）并把 run 落库；返回 `{jobId, runId, total}`。
   - 后台循环：每块从**最新已提交 state** 读 run/chunks；跳过已 committed（receipt）；块流程 = chunkInputTexts→knowledgeStructInput→extractKnowledgeStructChunk（队列外）→validateKnowledgeBatch→buildKnowledgeBatch→`commitState(commitKnowledgeChunk)`；可恢复失败→chunk failed＋job.result.chunkErrors；致命 AiError 停循环。
   - pause：停调度，**在途块照常完成落库**，settleRun(paused)；resume：按 receipt 跳过已提交块续跑；cancel：保留已提交、在途未提交丢弃（注意 `commitKnowledgeChunk` 的丢弃条件是 `run.status==="cancelled"` 或 built=null——cancel 路由须立即 settleRun(cancelled)，或提交时传 built=null）。
   - retry-chunk：按块序号重试，receipt 重放优先；做成不依赖活体 job 的独立函数（重启后 partial/failed run 也能重试）；重试后全 committed→settleRun 推 completed。
   - 启动恢复：running 的 run 标 **interrupted**（paused 保留可 resume）；resume 路由须能凭 runId 重建 job。
   - 新增 GET `/api/knowledge/runs/:runId`（run 记录＋活体 job 状态）。
   - `Job.result` 类型扩 `runId/createdItems/pendingItems/duplicateCandidates` 等。
   - **遗留细节**：`prepareKnowledgeRun` 算出的 unresolvedLinks 目前未持久化（ExtractionChunk 无该字段），`chunkInputTexts` 返回空数组——需决定在 job.result 暴露或构建时重算，别悄悄丢。
2. **最低 fail-closed 守卫**（合同 §4.6，E2 必须在第一个新壳产生前就位）：新壳（knowledgeItemIds 非空）进入旧选择器/确认链一律拒 `422 {code:"structured_knowledge_required"}`，**不得空字段兜底**。点位：`analysis.ts` assertSelectable（约 :50）/resolveFragment case "card"（约 :111）、`context-map.ts`（约 :49）、`references.ts` card 节点（约 :269）、`app.ts` reviewCard/upsertAdoption/createComparison。旧 reviewCard 对新壳语义变更/整卡确认→**409**；note/importance 仍允许。
3. **测试**：
   - 新增 **T06–T12、T24** 同名测试（放 `tests/knowledge-pipeline.test.ts`，沿用 GatedStore/boot 模式；假 AI 返回新 schema）。
   - **有意更新**旧契约测试（非降断言）：`tests/ai-stream.test.ts` 5 个用例（fakeAi 改返回 `{schemaVersion:1,...}`，请求体补 attachmentIds＋idempotencyKey，保留失败隔离/重试/取消/流式/暂停继续的回归意图）；`tests/papers-knowledge.test.ts`（import 旧函数段约 102–143 行、HTTP job 段约 192–223 行）。
4. **收尾**：全量测试绿 → 记录 S05-T4（session-05 追加＋台账双线表/轮次索引，hash/时间取自真实 git log）→ 分支提交（Turn: S05-T4 trailer）→ PR → 审计 → 自动合并 → 回填 merge hash → 标 E2 passed，进 E3。

### 3.5 E2 实际结果（S05-T4 收尾，2026-11-21）

- 3.1 的「测试跑不绿」中间态已收口：`server.ts` 不再引用旧函数；三份旧契约测试（`ai-stream`／`papers-knowledge`／`web-loop`）按合同 §11 意图**等价或更强**地迁移到结构化契约，未删断言。
- 判据落地：T06–T12、T24 全部有同名测试；`unresolvedLinks` 不再悄悄丢（持久化到 context 的 unknown，字段路径 `supplement`）；最低 fail-closed 守卫覆盖比较／采用／分析勾选／上下文地图（422 `structured_knowledge_required`）与整卡确认／改原文（409），备注与重要度放行（§4.6.5）。
- 全量：`npm --prefix sciworkbench test` → **279/279 绿**（E1 后基线 269，本轮 +10）。新发现并修掉 5 个实现缺陷＋1 个测试基础设施缺陷，逐条见 [S05-T4 记录](sessions/2026-11-21_session-05.md)。
- 提交：分支 `feat/s05-e2-extraction`，代码 `7ca563e`（2026-11-21 13:01，14 files +2204/−367，带 `Turn: S05-T4`/`Agent: qoder-main`）；PR 审计（测试全绿／范围与标题一致／无敏感文件）后 merge commit 合入，merge hash 按 §7.3 在下一轮回填台账 #85。
- 未做（不在本轮授权内）：B1 只读监听（S07 另批）；真实模型与外部工具验证（S03）；真人课题数据（S02）。活体实例 5184/5187/5191 全程未触碰。

## 三·五 E3 — 分项人审、主题与消费者开放：**passed（S05-T5，代码 `26f7d65` 15:17 ＋ 记录 `22f677b` 15:18；详见 [HANDOFF_E3.md](HANDOFF_E3.md)）**

合同 §10 E3：新增 `services/knowledge-base.ts` 的分项审阅服务与主题（原「待建」）；判据 **T13–T16、T25** ＋ §10 E3 浏览器清单。

- 落地要点：`update`／`review`／`resolve`／`structure`／`themes`／`statements` 端点接入；壳与卡片状态一律由分项派生；**条件改动级联回退已确认项**（`affectedItems`），部分确认→`need_info`＋`pendingConditions`；引文未逐字定位（服务端核对）不放行；`baseRevision` 过期→409；重要度／备注不升版不改科学性质。
- 关键口径（勿在后续阶段改回）：**确认门槛按钉住的 revision 判定**（§4.6.9）——定位修订后不自动升级，人在界面显式「改绑当前版」，改绑即回待审；旧版可读性走 `knowledgeItemConfirmedAt`，正式使用有效性走 `knowledgeItemLiveStatus`／`shellAllItemsConfirmed`。
- 全量：**294/294 绿**（E2 后基线 279，本轮 +15）。浏览器验收在隔离实例（`PORT=5217`、`LOCUS_DATA=sciworkbench/data/scratch-e3/`、AI 环境变量全清、Edge）跑完 §12.3 步骤 1–3 与 §10 E3 清单，控制台 0 error／0 warn。
- 修掉 9 个真实缺陷（详见 HANDOFF_E3 同名小节），其中「知识页显示 0 卡 0 待审」「条件引文不可见造成确认死路」「重抽静默清空人审」三项属会毁结论级。
- 偏差如实：§12.3 步骤 1「总览」入口沿用现有顶部条路径；`scripts/frontend-text-check.ts` 在本机 headless Edge 取到空 DOM（环境限制），改用同规则在已连线 Edge 内扫描零命中替代；级联回退后「当前认识」读取侧复检留待 E4／E5。
- PR：**#8**（`feat/s05-e3-item-review`，merge commit）审计通过——294/294、范围与标题一致、无敏感文件；合入后按 §7.3 在下一轮回填台账 #86 的 merge hash。

## 四、E3–E8 与 B1 计划（一律引用合同，不另造路线）

各阶段完整范围/步骤/禁止项见合同 **§10**（457–542 行）；测试判据见 **§11**（548–596 行）；每阶段输出按 **§13** 模板（实际文件、测试、未完成项，不得只说「已按设计完成」）。以下仅列判据与关键提醒：

| 阶段 | 合同节 | 通过判据（§11 同名测试） | 关键提醒 |
| --- | --- | --- | --- |
| ~~E3 分项人审/主题/守卫~~ **passed（见 §三·五，PR #8）** | §10 E3（483–488 行） | T13–T16、T25 ✅ | 专用 update/review 接口；改 value/条件/来源/nature→新 revision 回 pending＋409 保护过期编辑；重要度/备注不改科学性质；旧卡显式结构化不双编辑 fields；**浏览器实测**新旧卡/人审冲突/刷新恢复/dirty 保护；审阅链必须真实可用，不能把确认按钮留到最后 |
| E4 数据集/查询/比较 | §10 E4（490–495 行） | T17–T19、T26–T28 | T17 独立数值 oracle（1 d vs 24 h→差0比1；1 d vs 48 h→差24 h 比2）；missing/unit/type 正确拒绝；条件作自变量不误拦截；scope 不沿共享论文串课题；禁用摘要/前30行代替选定数据集；**E3 遗留**：级联回退后「当前认识」读取侧复检、分析运行／地图固定用当前有效版（T18/T33 家族） |
| E5 快照/wiki/知识包 | §10 E5（497–502 行） | T29–T35 | viewId 过期→409；冻结后改数据旧快照不变；tokens/许可排除＋私密哨兵检查（含 ZIP 解包）；机器 CSV 缺失值不写 0；不用真实用户全文做导出测试 |
| E6 可视化知识总览 | §10 E6（504–509 行） | T36–T40＋§12 浏览器全链 | §9 指定前端文件；四子视图/筛选/证据抽屉/空态错误态/当前快照切换；双主题＋窄屏＋键盘；禁静态稿/假按钮/另起展示站；前端文案硬规则（见本文 §一） |
| E7 内置 AI 统一输入 | §10 E7（511–517 行） | T41–T45＋既有 review/contract-roundtrip 回归 | readKnowledge 产生核心/可选预览；固定 snapshot＋真实 payload 留痕；AI 引用校验 invalid 不自动写入；**模拟先验，真实模型/外部工具按 S03 另获准**，未获准只能标「代码与模拟调用通过；真实工具待验」；AnalysisTask 仍需执行/测量/表格核心 |
| E8 其余模块逐类贯通 | §10 E8（519–529 行） | T46 逐类子用例＋既有 origin/reference/report 守卫回归 | 固定顺序：方案模板→执行事件→样品状态→分析结果→报告块→已采纳对话；每类八件事（读取/纳管历史/固定来源/性质继承/更新提示/wiki 入口/AI 选择器/更正回查测试）；方法来源≠执行性质；聊天只纳明确采纳内容 |
| B1 外部只读接口 | §10 B1（531–542 行） | T47＋用户指定实际客户端读取 | **独立授权（S07）后才执行**；独立 `knowledge-reader.ts`，不暴露主 createApp；仅 127.0.0.1；固定 snapshotId 授权＋一次性 Bearer（内存 hash、重启失效）；30 请求/分、分页≤200、响应≤2MiB；撤权后整包拒下载、策略读不到 fail closed |

顺序纪律：E3 依赖 E2 的新壳与守卫；E4 的读取/比较依赖 E3 的分项确认；E5 快照依赖 E4 数据集；E6 页面依赖 E5 数据面；E7 依赖 E6 的选择器；E8 收尾贯通。**任何阶段发现无法纳管的旁路/会毁结论的缺陷，按合同 §14 停下来报告，不硬推进。**

## 五、记录与台账现状

- 台账 [record/COMMIT_LEDGER.md](COMMIT_LEDGER.md)：#84（E1 commitState PR #6，merge `b09029b`）、#85（E2 `7ca563e` 13:01，PR #7 merge `0f361aa` 13:09，已回填）、**#86（E3 `26f7d65` 15:17 ＋ 记录 `22f677b` 15:18，分支 `feat/s05-e3-item-review`，PR #8 merge hash 待下一轮回填）**。
- 叙述记录：[record/sessions/2026-11-21_session-05.md](sessions/2026-11-21_session-05.md)（S05-T1 E0 / T2 基座 / T3 commitState / T4 E2 提取契约 / **T5 E3 分项人审＋交接**）。E4 完成后追加 S05-T6。
- 用户未跟踪/改动材料（`vibe_images/`、`record/screenshots/from-pictures/`、`reference reseach data/…`、session-02.md 的用户改动）：**不删不擅自提交**。
- 每轮收尾照 AGENTS.md §8 清单：先 git log 取真实 hash/时间 → 台账双线表＋轮次索引 → 会话记录 → trailer → 分支 PR 审计合并。无提交的轮次显式记「本轮无提交」。

## 六、常用命令

```bash
npm --prefix sciworkbench test          # 全量测试（E1 后 269/269；E2 后 279/279；E3 后 294/294）
cd sciworkbench && node server.ts       # 起服务（ PORT/LOCUS_DATA 环境变量隔离数据）
git -c http.proxy= -c https.proxy= push # 代理 7897 失败时直连推送
```

- 验收隔离数据另起 temp 文件；勿动 5184/5187/5191 现有实例；重启任何实例先备份＋用户确认。
- E3 浏览器验收种子：`cd sciworkbench && node scripts/acceptance-knowledge.ts data/scratch-e3/run.json --force`，再 `PORT=<空闲端口> LOCUS_DATA=data/scratch-e3/run.json LOCUS_AI_CONFIG=<隔离配置> node server.ts`（全合成材料、不联网、不需要 Key；同一句引文在正文中出现三次，用于测「多处命中」的 fail-closed 与出现位置全列；卡 A 已结构化、卡 B 留给「按需结构化」入口）。
- 本文档随 E2 分支提交（测试已全绿，满足合并审计条件）；E2 的简要交接见 [HANDOFF_E2.md](HANDOFF_E2.md)，E3 的见 [HANDOFF_E3.md](HANDOFF_E3.md)。