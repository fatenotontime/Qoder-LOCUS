# 阶段3 · 文献与审阅闭环 — 交付报告

> 会话/轮次：`S01-T8` ｜ 2026-11-16 ｜ 依据：06 阶段3 + 02 LIT01–LIT12 + 05 T01/T10–T16。
> 口径：**领域层骨架 + 契约测试**，非完整 UI/AI 队列/存储实现。

## 一、本阶段范围（06 阶段3）

实现课题名称+问题、子问题、通用原件归档/去重，以及**文献专用**的解析任务与证据卡；AI 后台队列、人审工作区、已审候选/待审区分；补卡、批审、重要/备注选填及关键修订原因；原文定位、同源转引、命名映射、比较快照/分歧卡与新增提醒。验证 T01、T10–T16。不加入全库自动 RAG 或持续噪声提醒。

## 二、需求ID 落地

| 需求 | 落地（`sciworkbench/domain/`） |
| --- | --- |
| TOP01–03（T01） | `topic.ts`：`createTopic`（仅名称+问题）/`createSubquestion`（可探索性）/`missingForTask`（按任务查缺项） |
| LIT01–04（T10） | `literature.ts`：`CardReview` 四维分开；`reviewCard` 三维独立 + 关键修改须原因；`candidateState`（跳过=未复核）；`batchReviewPreview`/`batchConfirm`（先呈现共享条件/缺项/异常） |
| LIT05–06（T11） | `canAdoptFormally`/`adoptForTask`：缺定位不得正式采用；`Locator` 复用于 `types.ts` |
| LIT07（T12） | `dedupAction`：同 hash 拒收 / 同 DOI 不同内容=新版本 / 题名相似仅提示 |
| LIT08（T13） | `independentEvidenceCount`：综述转引不计多份独立证据 |
| LIT09（T14） | `mapName`：须有依据，原名保留 |
| LIT10（T15） | `freezeComparison`（固定快照）/`newMaterialReminder`（只提醒不自动重比） |
| LIT11（T16） | `summarize`（观察/分歧/假设分层）/`unbackedObservations`/`endorse`（认可不升级事实） |
| 领域边界 | `EvidenceCard` 仅文献路径使用；未引入实验读数→证据卡的强制转换 |

## 三、变更文件

- 新增：`sciworkbench/domain/topic.ts`、`sciworkbench/domain/literature.ts`、`sciworkbench/tests/stage3.test.ts`
- 修改：`sciworkbench/domain/index.ts`（导出）
- 无产品前端/存储/AI 接入改动。

## 四、实际测试证据

`cd sciworkbench && node --test "tests/*.test.ts"` → **37 项通过 / 0 失败**（阶段2 26 + 阶段3 11）。覆盖 T01、T10–T16 行为契约。证据为本轮终端输出。

## 五、未运行 / 失败 / 限制

- **未实现**：AI 解析任务与后台队列、人审工作区 UI、存储/持久化、跨会话权限（T01/T10–T16 的**端到端**未跑，仅领域行为契约）。
- **未接入**：任何真实模型/文献 API（无凭据）；无云资源。
- **无失败用例**：本阶段测试全绿；不表示端到端达标（"文档/单测通过 ≠ 完成"）。

## 六、ADR / 人工干预

- 无新增 ADR；沿用 02/03/10 的三路径边界与 `04_ADR` 既有条目。
- 人工干预：用户裁定清除 `12` 悬空引用并就地明确边界（已随 `7827a88` 落地）；本阶段按其决定回归主线。

## 七、下一阶段依赖（阶段4 方案/图/记录 + 影响分析）

1. 方案 Fixed 版本、记录模板首次确认后复用、执行实际层、暂停/恢复、短号样品/分样/测量。
2. 实验图 v03 交互 + **显眼 AI 影响分析**（确定性时间传播独立、过期与失败态可靠）。
3. 验证 T02–T08；不造专业安全许可，不做自由拓扑/设备控制。

## 八、外部副作用待审批

**无**：未发布、未付费、未改服务器、未创建云资源。Pro/Sites 实测仍按 ADR-0004 在**阶段6之后**。
