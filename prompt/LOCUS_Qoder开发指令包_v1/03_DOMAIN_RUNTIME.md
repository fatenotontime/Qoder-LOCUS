# 数据模型 API与Agent Runtime契约

这是行为及最小字段要求，不预先指定React/数据库或把概念当已实现API。Qoder先输出实际schema/API/架构ADR，再实现；不得以换栈为由迁移私人Gradio仓库。

## 对象与版本

所有实体稳定id，修订revision/id、创建/修改时间、操作者、来源/状态；引用固定revision而非只指向latest。版本冲突返回可恢复冲突而非覆盖；删除以撤回/归档和数据删除策略分别处理。

| 对象 | 最小语义 |
|---|---|
| Topic/Subquestion | 名称/研究问题、可选依据/目标/未知/设计、主从关系 |
| SourceAsset | 原文件hash、mime/大小、来源URL/版本/许可、授权范围、私有位置、解析状态 |
| EvidenceCard | sourceRevision、定位、原文、抽取字段/条件/单位、不确定/缺项、核对状态 |
| TopicEvidence | 卡引用、课题重要程度/备注；不得把研究价值写成全局事实 |
| EvidenceAdoption | 任务引用、采用/排除与理由、固定证据版本 |
| NameMapping/Comparison | 原名/映射/来源依据；输入快照、筛选、换算、排除、分歧分类、未决状态 |
| ProtocolRevision | 目的、输入/操作/输出/条件/来源片段、完成判据、未知；图与表单同数据 |
| RecordTemplateRevision | 对应方案版本、通用规范版本、AI草稿、人工确认、字段与步骤定位 |
| Execution/Session | 固定方案/模板、实际过程层、步骤事件、补录时间、暂停状态和恢复事实 |
| Sample/SampleState | 稳定短名、来源执行/母样、状态版本、量/单位/估计性质、处理/用途/备注 |
| Measurement | 样品状态、时间/方法/仪器条件、原文件引用、原始/确认数据，独立测量重复 |
| ContextSnapshot | 用户选择范围、实际片段/引用版本/摘要、发送目的、快照hash、内容敏感边界 |
| AnalysisTask/Run | 子问题、固定上下文、建议/实际方法软件版本、参数、输入输出、状态与失败 |
| ResultRevision | 原作者或复现标记、图表/数值/项目文件、运行引用、核查范围、待补、结果版本 |
| ReportBlock/Revision | 内容及顺序、明确引用与上下文清单分开、草稿/假设/人工结论、局部修改历史 |
| DependencyEdge | fromRevision/toRevision、关系类别、定位、由何运行建立；非全靠LLM推断 |
| ChangeSet/Review | 修改前后、原因、实际受影响对象、复核状态/人工动作与版本 |
| ImpactAssessment | 见下：AI分析不覆盖确定性传播 |
| ExportSnapshot | 选中报告/结果/依赖版本、复核清单、可分发附件、hash manifest |

首次确认记录须原件、原响应、草稿、确认稿一致提交，避免半成功目录看似正式。上传/解析/导出可异步，但失败不得产生已确认态。

## API能力（具体路由可变）

- topic/subquestion CRUD及版本冲突；创建最小字段独立于完整度检查。
- asset上传、hash重复拒收、私有读取/签名引用、撤回/删除与生命周期。
- parse/extract任务提交、查询、取消/重试，证据卡列表、修改、批审、手动补卡、定位回查。
- mapping/compare明确输入快照及人工决定；新增提醒不能自动改历史比较。
- protocol/template生成、确认、版本比较；diagram仅为视图、执行实际层另保存。
- execution会话暂存/恢复、样品创建/修订、测量及附件关联。
- context预览/冻结、analysis任务/建议、结果版本提交（可偏离建议但填实际方法/原因）。
- report按任务/阶段生成、局部diff提案、接受、撤回/历史；聊天默认只讨论。
- change/dependency查询、impact任务与结果、人工复核、导出/恢复。

接口返回不可把“请求成功”当“科学确认”。统一任务ID、状态、错误码、可重试性、当前revision、幂等键。私有对象权限在服务端校验，不靠前端隐藏ID。下载ZIP/导入要验证路径和文件类型/大小，不执行包内宏或未知脚本。

## Agent Runtime

任务类型：文献解析/抽取、命名与比较、方案拆解/模板、暂停风险建议、方法建议、结果解释、报告块、编辑影响分析。AI重排不接入。

每任务流程：明确触发→固定ContextSnapshot→schema约束提示词→服务端调用→原响应留存→结构/来源校验→草稿入队→人工动作。状态至少queued/running/succeeded/failed/cancelled，复核状态另存，不把succeeded当confirmed。重试不会重复入库，过期响应不得覆盖当前编辑。解析内容作为不可信数据，不能执行文档内指令或泄露其他课题。

已支持文件先保存再解析；服务不支持/格式未知仍可人工关联。不要为所有仪器格式硬造解析器。上下文先选范围再抽相关片段，长文截断/摘要标记，不静默丢关键单位条件。

模型适配统一接口，开发模型与运行模型分开。明确成本、超时、速率、会话Key、清理、模型版本（可得时）及提示词版本。不把密钥回显进导出。匿名演示会话隔离，评委免配额方案未决定则列验证关卡，不默默无限消耗用户账户。

## 新增 Edit Impact 详细契约

输入包含changeSetId、baseRevision/newRevision、改动字段及前后值、原因、课题/子问题、方案关键步骤、执行是否已开始/暂停、有关样品状态/测量/分析结果/报告引用、已知依赖、适用证据及缺项。只收相关上下文，不全库、不逐项推荐理由；发送清单可展开。

输出结构建议：
```
change_set_id / input_snapshot_hash / model / prompt_version
status: pending | running | completed | failed | stale
summary: 简短总体结论
assessment: impact | no_supported_impact_found | needs_review
items[]:
  target_ref + revision
  category: timing | execution | comparability | analysis | interpretation
  finding + reason
  evidence_refs[]
  unknowns[]
  suggested_action
```

“未发现有依据的影响”不等于证明无风险；未知、模型失败/未配置分别明确。时间传播由确定性模型提供，AI只补语义评估，不重复猜数学。标题/备注变化可确定性判无需重算；科学变化需审慎，不能所有改动无差别报警。

编辑应用后立即保存版本，显眼空白区展示影响分析pending→结果；允许继续工作，不硬阻塞保存。较新改动到来则旧分析stale，引用旧快照供查，不覆盖新结果。保留人工确认/待补/撤回等动作；风险提示是可核对建议，不是设备安全授权。

原型若未接模型，显示待接入并允许查看/导出上下文，不以模板文字假充AI分析。生产阶段须用真实已授权测试模型完成至少一个有影响、一个无足够依据和一个失败用例，并记录成本。

## ADR要求

至少记录：运行存储架构、实体/版本与原件策略、影响传播边类型、模板复用、解析/模型服务选型、会话身份和API额度、报告引用/外部编辑边界、导出恢复、公开数据许可策略。只写已作决定与依据，不虚构日期或已通过。
