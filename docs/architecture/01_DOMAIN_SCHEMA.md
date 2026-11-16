# 阶段2 · 领域 Schema 与字段字典

> 行为契约来自 03；本文给出可实现的最小 schema。骨架实现见 `sciworkbench/domain/`。**概念** ≠ 已实现 API；具体路由可变。
> **领域边界见指令包 `02/03/10`**（三条路径分开；`EvidenceCard` 为**文献专用**；外部结果允许无内部 Run）。

## 1. 通用规则

- 每个实体：`id`（稳定）+ `revision`（追加式，不复用编号）+ `createdAt` / `updatedAt` + `operator` + `source` + `status`。
- 引用一律**固定 `revision`**（`Ref = {id, revision}`），**不指向 latest**。
- 版本冲突 → 返回**可恢复冲突**，不静默覆盖。
- 删除分两类：**撤回/归档**（保留历史）与**数据删除**（策略单独处理）。
- 首次确认记录须 `原件 + 原响应 + 草稿 + 确认稿` 一致提交；失败不得产生"已确认态"。

## 2. 实体清单与最小字段（字段字典）

| 实体 | 最小字段 | 关键约束 |
| --- | --- | --- |
| `Topic` | name, researchQuestion, (basis/goal/unknown/design 可选), parentId? | 仅 name+question 即可建（TOP01） |
| `Subquestion` | topicId, question, kind(declared/exploratory) | 分析**必选**子问题，可现场新建（ANA02） |
| `SourceAsset` | fileHash, mime, bytes, originUrl?/version?/license, scope, privatePath, parseStatus | 原件**不覆盖**（OCR01） |
| `EvidenceCard` | sourceRef{assetId,revision}, locator, rawText, extracted{fields,conditions,units}, unknowns[], reviewStatus | **文献证据专用**；抽取≠核对≠采用；**非所有实验测量的统一容器** |
| `TopicEvidence` | cardRef, topicId, importance?, note? | 重要程度可空；非全局事实（LIT01） |
| `EvidenceAdoption` | cardRef, taskRef, decision(adopt/exclude), reason?, fixedRevision | 采用/排除独立于核对 |
| `NameMapping` / `Comparison` | originalName, mappedName, basis, inputSnapshot{filters,conversions,exclusions}, divergenceClass, unresolved | 不自动合并/平均（LIT09） |
| `ProtocolRevision` | purpose, inputs[], operations[], conditions[], criteria, unknowns[], sourceFragments[] | 图与表单**同数据**（EXP02/ARC） |
| `RecordTemplateRevision` | protocolRef, generalSpecVersion, aiDraft, humanConfirmed, fieldLayout | 确认后复用；方案变更需比对（EXP03） |
| `Execution` / `Session` | protocolRef(fixed), actualLayer, stepEvents[], backfillTimes, pausedState/恢复事实 | 实际层不改源方案（EXP02/05） |
| `Sample` / `SampleState` | stableShortName, originExecutionId, stateRevision, amount{value,unit,estimated}, handling, use, note | 改名不破引用；历史不被改写（TOP04/05） |
| `Measurement` | sampleStateRef, time/method/instrument, sourceFileRef, rawData/confirmedData, replicateGroup | 独立测量，独立批次（TOP04） |
| `ContextSnapshot` | scopeRefs[], sentFragments[], purpose, promptVersion, snapshotHash, sensitivityBoundary | 固定本次输入（ANA03） |
| `AnalysisTask` / `Run` | subquestionRef, contextSnapshotRef, suggested{method,software}, actual{method,software,version,params}, inputs[], outputs[], status, failure | 多次提交=多版本；不覆盖（ANA05） |
| `ResultRevision` | authorKind(author/user/reproduced), figures/tables/data/projectFiles[], runRef?, verificationScope, pendingItems[] | 区分作者/用户/复现；**外部结果允许无内部 Run**（`runRef` 可空，回查到作者文件/已知处理说明） |
| `ReportBlock` / `Revision` | content, order, explicitRefs[], contextList[], draftOrAssumptionOrHuman, localEditHistory[] | 明确引用 ≠ 上下文清单（REP02） |
| `DependencyEdge` | fromRef, toRef, edgeKind, locator, establishedBy(run/human) | **非全靠 LLM**（LIN01） |
| `ChangeSet` / `Review` | before/after, reason, affectedRefs[], reviewStatus, humanAction, version | 复核针对具体变更与版本（LIN04） |
| `ImpactAssessment` | changeSetRef, inputSnapshotHash, model, promptVersion, status, summary, assessment, items[] | 见 §5；**不覆盖确定性传播** |
| `ExportSnapshot` | reportRefs[], resultRefs[], dependencyRefs[], reviewChecklist, distributableAttachments[], hashManifest | 固定某次导出状态（REP04） |

## 3. 三业务路径的实体归属（先分路径）

| 路径 | 主实体 |
| --- | --- |
| LIT 文献建库 | SourceAsset(文献) → EvidenceCard → (TopicEvidence/EvidenceAdoption) → NameMapping/Comparison |
| EXP/ARC 方案解析 | ProtocolRevision → RecordTemplateRevision → (图视图) |
| OCR 数据核对 | SourceAsset(数据) → Execution/Session(skeleton) → Sample/SampleState → Measurement |

## 4. 两事件（同"导入"不同产物）

- `data.importPublic(sourceDeps)`：产 `SourceAsset`(+可标"重构"的 `ProtocolRevision`)+公开证据用 `Measurement`；**不**产 `Execution`、**不**建用户 `Sample`、**不**标"用户原创"。
- `exec.start(protocolRef)`：产 `Execution`/`Session` + `Sample`/`SampleState` + `Measurement` + 事件；跨会话 `pause/resume`。

## 5. 影响分析输出结构（03 §Edit Impact）

```text
change_set_id / input_snapshot_hash / model / prompt_version
status: pending | running | completed | failed | stale
summary: 简短总体结论
assessment: impact | no_supported_impact_found | needs_review
items[]: { target_ref+revision, category(timing|execution|comparability|analysis|interpretation),
           finding+reason, evidence_refs[], unknowns[], suggested_action }
```

规则：**时间传播由确定性模型给**，AI 只补语义评估；**失败/未配置 ≠ 无影响**；新改动到达 → 旧分析标 `stale`，不覆盖。

## 6. 来源定位 schema（LIT06）

- 文献：`{assetId, revision, kind: pdf|web, page?, region?, sectionQuote?, table?{tableNo,row,col}, figureCaption?}`。
- 实验数据：`{assetId, revision, region?, fieldPath?, sheetName?, cellRange?}`。
- **不强制唯一定位或精确坐标**；定位不足 → 扩大复核范围并明示；缺定位可暂存搜索，不用于正式判断。
