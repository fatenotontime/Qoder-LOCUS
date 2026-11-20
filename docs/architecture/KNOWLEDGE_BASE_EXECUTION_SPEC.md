# LOCUS 知识库防偏移执行合同 v1.0

- 文档类型：可交给实施 agent 的执行规范，不是实施完成报告。
- 编制日期 / 轮次：2026-11-20 / [S04-T8](../../record/sessions/2026-11-20_session-04.md#s04-t8)。
- 产品依据：[知识库整体设计 v0.2](KNOWLEDGE_BASE_DESIGN_DRAFT.md)。
- 编制时代码基线：分支 `main`，HEAD `14b6616`。实施时必须重新核查，不要求回退至该提交。
- 当前授权：用户要求编写本合同；本轮不修改功能代码、运行数据、权限或部署配置。后续实施必须有明确的阶段授权。

## 0. 如何使用本合同

执行者只需做三种判断：代码是否符合契约、测试是否证明契约、是否触发停点；不得重新选择产品形态、数据语义、技术栈或用缩减功能替代交付。

术语：

- **必须 / 禁止：** 硬约束；不满足不能报告完成。
- **固定决定：** 为降低执行歧义，本合同将原设计的可选工程方案具体化；实施授权后按此执行，不再自行比较其他方案。
- **停点：** 缺用户授权或真实输入时，只停止受影响的步骤并报告，其他已经授权且独立的步骤可以继续。
- **技术完成：** 自动测试和隔离浏览器通过；不代表真实模型提取质量、用户课题可用性或外部工具兼容性已经验证。

执行授权指定阶段时只做该阶段；若用户明确授权连续执行 E0–E8，可在各阶段验收通过后顺序推进，无须每步重复询问。真实数据、模型外发、外部只读服务及 Git 提交/推送不从这种笼统授权中推定，须按 §2 单独确认。

若本合同与最新用户指令或项目安全约束冲突，遵循更高优先级要求并记录冲突；不得通过修改本合同、AGENTS.md 或测试预期让不合格实现变合格。

## 1. 一页总纲：最后必须交付什么

### 1.1 固定产品链

```text
选定文献及研究目的
→ 提取可回查的观察 / 方法 / 定义 / 解释 / 限制
→ 知识项绑定条件、阶段和逐项来源
→ 人工核对并沉淀到研究主题
→ 与同范围的实际研究数据比较
→ 知识总览页面展示认识、数据、依据和缺口
→ 同一快照输出 wiki、JSON、CSV
→ 内置 AI 与外部文件导入使用相同知识契约
```

### 1.2 交付层级

| 编号 | 交付 | 必须包含 | 不能冒充完成的替代物 |
| --- | --- | --- | --- |
| A1 | 知识提取与入库 | 观察—条件—来源绑定、分项人审、重试不丢不同条件 | 只改提示词、只增加 fields 字段 |
| A2 | 研究知识组织 | 主题、条件化认识、证据与限制、原模块数据关联 | 文件列表、总量统计、未经保存的 AI 摘要 |
| A3 | 可视化知识总览 | 主题/条件筛选、文献与研究数据、比较、逐项回查 | 纯 Markdown 下载、静态截图、全库关系图 |
| A4 | 同源交付 | 固定版本 JSON/CSV/wiki、历史与缺失状态 | 分别让 AI 拼三个文件 |
| A5 | AI 读取闭环 | 输入范围预览、实际发送记录、引用解析、结果人工采纳 | 原样发送 state.json 或全库附件 |
| A6 | 全模块贯通 | 方案/执行/样品/结果/报告/采纳对话逐类验证 | 只有文献卡与表格却声称覆盖全部模块 |
| B1 | 外部只读 API | 独立只读入口、明确授权、固定范围与版本 | 公开现有主服务的 /api/state |

A1–A5 为 E0–E7 的首个完整闭环；A6 在 E8 完成；B1 在单独授权的 B1 阶段完成。不能把 B1 延后解释为永久取消接口目标，也不能为赶进度省略 A3 可视化页面。

## 2. 固定决定、授权边界与停点

### 2.1 本合同固定的工程决定

| ID | 固定决定 |
| --- | --- |
| D01 | Node 24 原生 TypeScript、现有单进程与 Store；浏览器仍为纯 JavaScript；不安装新依赖，不换框架/数据库/构建系统 |
| D02 | 新增 `LocusState.knowledge` 命名空间；原论文、原件、表格、执行和报告不迁走、不重建 ID |
| D03 | 首版所有权威知识元数据、源历史和任务快照随同一 state 保存；导出文件从快照派生，不新增另一套权威文件事务 |
| D04 | 知识入口使用“总览 / 审阅 / wiki / 比较”四个子视图；保留既有七入口及双主题，不重做其他页面布局 |
| D05 | wiki 默认模板生成；人工编辑回到源对象或知识陈述编辑器；不做 Markdown 双向同步，不在页面加载时调用 AI 写认识 |
| D06 | 首版检索为确定性的文本包含/筛选/关系展开；不接向量库、不计算知识成熟度总分、不自动计独立研究数 |
| D07 | 首批数值操作只实现原值并列、已确认单位换算、两项差值和比值；不做自动统计检验、跨研究平均、异常点剔除 |
| D08 | 旧数据只迁移存储形状，不自动重提、不猜条件、不整体降为待审；结构化转换按需显式发生 |
| D09 | 所有视图通过同一知识读取与快照函数；禁止前端自行拼出另一份“AI 数据” |
| D10 | 外部文件导入先交付；外部 API 使用 B1 独立只读监听器，不给现有全库主服务包装一个 token 就宣称安全 |

D03 将设计稿的“快照可另存文件”建议收束为首版单状态方案，目的是避免两份权威状态的提交一致性问题；不能以此把整个项目原件复制到每个快照。E1 须测量状态增长和保存耗时，超限按 S08 停止扩容，不擅自换库。

### 2.2 必须停下来而不能替用户决定的情况

| 停点 | 触发条件 | 必须做什么 | 禁止做什么 |
| --- | --- | --- | --- |
| S01 | 无明确实施阶段授权 | 交付文档/计划，等待授权 | 直接开始改业务代码 |
| S02 | 首个用户课题/允许使用的数据尚未指定 | synthetic 工程测试可继续；真实业务验收记为待件 | 自行选用户运行数据、复制私人材料或宣称真实课题通过 |
| S03 | 需要真实模型调用或把材料交给外部工具 | 确认材料范围、工具/模型及费用授权 | 读取/打印密钥、使用整包开发参考答案测试模型 |
| S04 | 需要重启/重置现有实例或迁移现用数据 | 提供备份与隔离验证结果，获得确认 | 覆盖现用 state、占用已在使用的端口 |
| S05 | 文件名/函数已变，或同文件有不明并行修改 | 核对实际符号与差异，记录等价落点；无法判断时询问 | 按旧行号硬改、回退他人更改 |
| S06 | 必须新增依赖、更换存储、改变科学语义或未列入范围的功能 | 说明具体约束与最小变更，待批准 | 以“更优架构”为由顺手重构 |
| S07 | 缺外部客户端/鉴权/材料外发授权 | B1 保持未开放，A 可继续 | 绑定 0.0.0.0、改防火墙/云权限/CI/仓库设置 |
| S08 | 知识增加量或性能超过 §12 容量门槛 | 给测量、定位原因和最小调整建议 | 截断原件/历史、自动删快照、压低测试数据量过关 |
| S09 | 当前分支/存储版本已经被其他工作推进 | 保留既有迁移，按当前版本增加下一版并记录 | 强行设为9、重写历史迁移或降级数据 |
| S10 | 发现不涉及本任务的既有缺陷 | 登记影响；只有阻塞当前硬契约时申请扩大范围 | 偷修整片模块或把旧缺陷算新功能完成 |

未授权 Git 提交时只保留工作区改动；提交、推送、PR、合并分别按用户授权执行，提交须遵循项目 Turn/Agent trailer，不更新 Git 配置，不跳过 hooks。

## 3. 永不放宽的不变式

| ID | 不变式 | 必须有的证明 |
| --- | --- | --- |
| I01 | 原值/原文不被规范值覆盖 | 原值、规范值与换算规则同时可读 |
| I02 | 一个数值只使用明确绑定的条件/阶段 | 同卡不同温度、前处理与后续培养的反例测试 |
| I03 | 计划、实际、文献报告、重构和 AI 建议分开 | 原模块→知识→wiki→AI 性质不变 |
| I04 | 人工确认不等于事实，采用不等于核对 | 已确认假设仍是 hypothesis；分项未审不能借卡壳通过 |
| I05 | 固定版本不能读取 latest 兜底 | 老快照与当前值不同；缺历史返回明确状态 |
| I06 | 定位成功不等于论断被证明 | evidence location 与 review 状态分开 |
| I07 | unknowns 不被默认为0或默认条件 | 缺单位、歧义、未测、低于检出限分别保留 |
| I08 | 不按概述文本吞掉不同研究条件 | 同summary异context同时存在 |
| I09 | 失败/取消/冲突不发布半份知识或已确认态 | 注入保存失败与在途修改测试 |
| I10 | 同源页面、wiki、CSV、JSON共享事实 | 同快照字段逐项比对，而非只比文件存在 |
| I11 | 上下文关系不当作支持关系，转述不当独立证据 | 同源拆卡/报告/AI再述不增加来源独立性 |
| I12 | 未授权内容不进入AI/导出；凭据不进入state或包 | 范围外材料与秘密哨兵负向测试 |
| I13 | 知识总览是实际可操作页面 | 浏览器端从筛选到证据抽屉再到wiki的真实操作 |
| I14 | 旧业务仍可运行且不要求重复录入 | 既有回归 + 原模块更正后知识更新 |
| I15 | 读取不写库、不自动提取、不自动发送网络 | 对GET读取的save/AI调用计数为0 |
| I16 | 无法证明完成时明确未完成 | 技术/真实模型/真实课题/外部接口分别报告 |

## 4. 数据契约：执行者不得另起命名体系

本节字段为实施合同，不是已存在类型。TypeScript 类型放在 §9 指定文件；不生成通用对象平台，不建立全领域词表。

### 4.1 命名空间和存储版本

`LocusState.knowledge` 必含：

| 字段 | 内容 |
| --- | --- |
| `schemaVersion: 1` | 知识命名空间版本，与业务state.version分开 |
| `items` | 知识陈述/观察/定义/方法/派生判断 |
| `contexts` | 明确阶段与组别的条件上下文 |
| `evidence` | 固定来源锚点 |
| `relations` | 有类别和依据的关系 |
| `themes` | 用户维护的知识主题及成员 |
| `mappings` | 版本化的字段含义与换算规则 |
| `datasets` | 固定表格范围及列含义 |
| `comparisons` | 新比较的固定输入、决策、计算与结果；旧state.comparisons不搬迁 |
| `sourcePolicies` | 本机用户对来源内容的读取/导出/AI发送决定；不是多租户权限系统 |
| `extractionRuns` | 固定输入、批次/块记录、状态与幂等信息 |
| `snapshots` | 持久不可变的知识快照 |
| `sourceVersions` | 已纳管业务对象的只读历史payload |

以上均为数组，空库为空数组。首个迁移在基线8上升为9；若执行时已非8，按 S09，不覆盖其他迁移。v8载入新增空knowledge，既有对象和值深度相等；v9缺knowledge、缺集合、未知knowledge.schemaVersion均报损坏/不支持，不补空。继续保留原有v2–v7升级入口，禁止悄悄改变它们的历史规则。

`JsonFileStore.load` 只在文件确实不存在时返回 emptyState；文件存在但解析/版本/结构不合法时显式失败，createApp不启动空工作台；`loadStrict` 对不存在仍报错。所有外部导入/隔离恢复共用同一结构检查，不只检验version字段存在。

### 4.2 引用、版本和修订

- 知识引用：`KnowledgeRef = {kind, id, revision}`，kind限 `item|context|evidence|relation|theme|mapping|dataset|comparison`，revision为正整数。
- 源引用：`SourceRef = {kind, id, version, contentHash}`，kind限 `topic|subquestion|paper|attachment|asset|card|table|protocol|template|execution|sample|measurement|result|report|report_block|chat_proposal|ocr`；子对象ID需包含所属实体身份以免碰撞。version为命名空间字符串，已有真实revision用 `r:N`，无业务revision的纳管版本用 `k:N`，不可变原件用 `sha256:HASH`。
- 对可编辑知识对象固定使用 `{id, revision, createdAt, updatedAt, payload, history}`；history每项为完整旧 `{revision,at,reason,payload}`。新revision保存完整当前payload，禁止将diff字符串当唯一历史。
- `extractionRuns`是任务状态，不伪装成知识内容版本；`snapshots`保存后不可修改内容；`sourceVersions`每个键只能追加，不可覆盖。
- ID由服务端UUID产生且更新不变；模型只产生批次内localId，不能提供服务端稳定ID、版本、审核或历史。合成测试可注入固定ID，运行时不得写死案例ID。
- 两个引用若kind/id相同但revision不同，不能在去重或JSON导出时合并。
- 审核、定位及内容更改均生成新revision和完整history；审核更新仅改review时不重置为pending，内容更改才触发pending。不能在同一KnowledgeRef下原位改review。
- 审核接口返回新ref；UI后续显式使用它。先确认context/condition获得新版contextRef，再更新/确认item；旧item、theme和snapshot引用不自动重绑。UI可给“采用已确认新版条件/知识”的明确预览动作，但不能后台替换固定引用。
- 正式使用同时核查被引用版本的review与稳定ID当前是否withdrawn/excluded；当前撤回可阻止借用旧confirmed版本进行新计算/外发。旧快照本地历史事实仍可读，另叠加动态告警；来源本身被限制读取时按§7.5拒绝。
- 当前源与引用版不一致产生stale提示；保留显式选择旧版的能力，但不得以latest内容冒充旧版。

### 4.3 TypedValue 与未知项

所有值保存 `raw` 原始字符串；有数字时保存十进制字符串，禁止NaN/Infinity和未声明逗号规则。数值类型固定为：

| kind | 必要字段 | 语义 |
| --- | --- | --- |
| `scalar` | raw, value, unit | 明确单值；无量纲单位规范为 `1`，未知单位用null并附unknown |
| `bound` | raw, operator(gt/gte/lt/lte), value, unit | 界限，不自动变等号 |
| `range` | raw, lower, upper, unit | 范围，不取中点 |
| `category` | raw, label | 是/否/立即下沉等定性内容，不强制数字化 |
| `summary` | raw, statistic, value, unit, uncertainty?, sampleSize? | 均值/中位数等，uncertainty须有SD/SE/CI类型；未知不填 |
| `missing` | raw, reasonCode | 明确缺失，不能默认为0 |

纯叙述无测量值时 `value:null`，与“该指标有值但缺测”的missing区分。不支持解析的表达保留raw为category并标 `unparsed_numeric`，不得强行parseFloat。

`Unknown = {id, fieldPath, reasonCode, detail, scopeRefs, evidenceRefs}`；reasonCode限 `not_in_selected_material|unprocessed_source|not_reported_in_checked_scope|ambiguous|conflicting|not_measured|below_detection_limit|unparsed_numeric|unresolved_link`。是否阻断由具体操作推导，不保存一个全局“有unknown就全部禁用”的标志。

### 4.4 主要payload字段

| 类型 | 必要字段与定义 |
| --- | --- |
| item | `contentType`(observation/method/definition/claim/limitation/question), `nature`(observation/hypothesis/interpretation/to_verify/human_judgment), `text`, `subject:{raw,entityRef?}`, `predicate:{raw,metricId?}`, `value:TypedValue|null`, `contextRefs`, `evidenceRefs`, `sourceRefs`, `origin`, `scopeText`, `unknowns`, `review`, `cardId?` |
| context | `researchUnitId`, `subject`, `groupLabel`, `stage`, `methodRefs`, `conditions`, `unknowns`, `review`；stage为来源保持的文字，不全局推断 |
| condition | 内嵌context：`id,field:{raw,standardId?},value,appliesTo:{subject,stage},evidenceRefs,obtainedBy,review`；obtainedBy限source_explicit/human_record/human_assumption，AI提取不等于来源已明示通过核对 |
| evidence | `sourceRef`, `locator`, `quote`, `locationStatus`, `candidates`；定位状态matched/ambiguous/unmatched/source_missing；候选含sourceRef及位置 |
| relation | `from`, `to`(各为KnowledgeRef或SourceRef), `relationType`, `basis`, `evidenceRefs`, `establishedBy`, `review`；关系限belongs_to/derived_from/supports/contradicts/limits/uses_method/precondition_of/supersedes |
| theme | `topicId,name,definition,subquestionIds,members:KnowledgeRef[],currentJudgmentRefs:KnowledgeRef[]`；成员固定版本，新版本出现只提示可更新 |
| mapping | `topicId,metricId,definition,aliases,applicability,valueKind,targetUnit,conversion,basis,evidenceRefs,review`；不定义全局默认映射 |
| dataset | `topicId,sourceRef`(table), `selection:{rowIndices,columnIndices}`, `columns`(index/originalName/standardId/type/unit/review), `rowBindings`, `unknowns,review`；每个rowBinding为`{rowIndex,contextRef?,sampleStateRef?,group?,time?,replicate?:{label,type}}`，replicate.type限technical/biological/unknown；不从位置猜 |
| comparison | §7.2输入契约加 `topicId,normalizedInputs,computedValue,formatting,warnings,createdFromViewId`；normalizedInputs每项保存原值/规范值/所用mappingRefs，computedValue为TypedValue或null；固定版本引用，重新计算生成新记录 |

`origin = {sourceClass,createdBy,secondaryCitation}`：sourceClass限literature_report/local_observation/historical_reconstruction/human_statement/model_suggestion；createdBy为human/model/import。AI提取文献得到literature_report+model，AI自己的建议是model_suggestion，不能因为模型提取就抹掉原文来源。

`review = {status,reviewedAt,reviewedBy,basis}`，status限pending/confirmed/needs_info/excluded/withdrawn；只由专用review操作改变，客户端不得在普通内容更新时指定。机器导入和模型结果默认pending；已明确由原业务人工保存的实际记录通过sourceRefs沿用原记录事实性质，不自动确认额外推断。

K的 `evidenceRefs` 使用 `{ref,fieldPaths}` 将引用精确指向 text/value/subject 等；条件的evidenceRefs独立标记。只有 `matched` 不是支持确认，review.basis要能记录人工核对的内容。

所有新科学记录payload增加 `topicIds:string[]`、`subquestionIds:string[]`、`createdFromRunId?:string`；领域对象的单topicId必须在topicIds内。提取从明确job范围初始化（无归属为空），加入theme可由显式成员操作增加相应归属；跨课题加入前要求用户确认，不以同论文关联自动扩散判断。来源和共享context可有多个归属，但查询按所选item闭包返回必要依赖，不反向返回使用同来源的其他课题内容。

原模块数据的只读投影使用其可验证课题归属；不能验证归属时进入资料审阅而非默认当前课题。sourceRefs和relation端点一律由服务端验证真实存在/版本/范围，不能相信客户端声称属于某课题。

### 4.5 来源定位的固定格式

- 文本：`{type:"text",start,end,printedPage?,scanPage?,section?}`，start/end为归档asset.text的UTF-16码元半开区间；必须验证slice===quote。
- 表格：`{type:"table",row,column,originalLocation?}`，以固定表版本的0基索引定位，UI显示1基；无原件行映射不得声称已定位原始CSV行。
- 手动未定位：`{type:"unresolved",description}`，不能带虚构偏移。
- 图片：首版只保存来源与明确区域/图注；无已验证区域则unresolved，不新增PDF/OCR/图像读数解析器。
- printedPage与scanPage独立，未给出时不推断；文本预处理必须保持源偏移映射，否则返回unresolved而不是错误高亮。

### 4.6 新旧卡片共存与唯一编辑权

1. 旧卡保留原业务编辑功能；知识只读投影引用其固定sourceVersion，并标 `structureStatus:"legacy_unbound"`。旧audit=confirm可以用于原有阅读，但不使多指标单位自动绑定，也不自动解锁数值比较。
2. 新提取仍创建 `LitCardRecord` 阅读壳，新增 `knowledgeItemIds`；text/展示摘要、论文归属和原件归档由壳承接，原始模型响应保存在提取run审计中。新知识语义只编辑knowledge.items/contexts，不双写可编辑的旧fields。
3. 壳 `extracted` 初始化为空结构，旧接口不得把它读成“没有数据所以用概述计算”。所有涉及新壳的消费者必须经过统一适配器；未接入消费者明确返回 `structured_knowledge_required`，不能latest/空字段兜底。
4. 壳assetId使用提取块携带的真实归档来源，不代表引文已经匹配；locator只在定位确认后填写。未匹配引文仍可待审，但不能制造确定证据。
5. 新壳audit由各项状态派生，不能通过旧reviewCard直接确认所有项；旧端点对新壳语义修改/整卡确认返回409及应使用的知识审阅入口，备注/重要度仍可正常修改。
6. 旧卡显式结构化时，固定其旧版本，建立新item/context并设置knowledgeItemIds；旧fields保留为历史输入、停止独立编辑。引用旧版继续可读，不自动替换既有报告/比较引用。
7. `created/skipped`继续表示新增/跳过阅读壳数量；额外返回 `createdItems/pendingItems`，禁止后台把created改成item数而前端仍显示“张卡”。
8. 所有采用、统计、比较、分析核心/候选、对话范围均不得同时把壳和所属items算作两份证据。显式选部分item时只导出那些item，不能反向展开整卡。
9. 壳audit只作展示/旧入口保护：空items或全pending→unreviewed；全部confirmed→confirm；全部excluded/withdrawn→exclude；其他混合→need_info。正式item选择不以混合壳的need_info整体否决，而是逐项验证所选固定revision。使用旧cardId选择整壳时，只有全部项均满足用途门槛才展开，否则422并要求显式选择，不能静默剔除用户以为已选的项。
10. E2创建第一张新壳之前必须接入最低fail-closed守卫：所有旧选择/计算/引用消费者遇新壳而未适配即明确拒绝；E3完成分项UI和正式可用路径后再开放。不存在“先让旧接口用空fields凑合”的阶段。

### 4.7 正式使用门槛

| 用途 | 固定门槛 |
| --- | --- |
| 待审页/用户显式探索 | 可展示pending/needs_info，标性质和未知项；不得写成“当前认识” |
| 总览/正式wiki | item已确认，未撤回；无来源的人工判断可展示但标来源性质与缺口，不称观察证据 |
| 数值换算/比较 | item及所需条件/映射已确认、类型支持、来源可解析、关键条件满足本次契约；判断不是“所有unknown必须为空” |
| 内置正式分析/聊天 | 继承现有未审知识卡不得选入守卫，对新项分项复检；本合同不放宽旧守卫 |
| 原文探索AI | 必须显式选原件/待审项并选择探索模式；不污染正式推荐/报告输入；该入口在E7才新增 |
| 历史快照阅读 | 固定内容不变，可显示现在已撤回/来源失效的动态提示；动态提示不写回旧内容 |

知识内容、value、条件、来源绑定或nature更改：创建新版本并将受影响项置pending；单改名称、重要度或非科学备注不触发科学复核。已确认假设仍保持hypothesis，系统永远不自动转observation。

## 5. 写入、历史与故障恢复的算法合同

### 5.1 唯一写入边界

在createApp内部引入一个顺序提交入口，签名语义为 `commitState(changeFn)`；changeFn只能接收队列执行时的最新state，返回完整nextState及响应结果。不要实现通用事件总线或跨服务事务框架。

严格顺序：

1. 提交动作进入队列。
2. 读取最新state，重新验证baseRevision、取消状态、选定对象存在性。
3. 执行同步纯业务变更，不在队列中调用模型/网络。
4. 为已纳管且发生内容变化的源对象保存旧/新payload，追加知识修订与必要复核标记。
5. 校验新状态关联与版本；`await store.save(nextState)`。
6. 保存成功后才将闭包state替换为nextState，返回成功响应。
7. 若失败，内存state保持旧值，返回明确错误，队列解除并可处理下一笔；不得把失败的Promise永久挂死队列。

所有createApp内持久化state赋值与save，包括启动恢复、后台回调、错误记录、附件归档+结果提交都须进入该边界。允许为此机械替换全文件写入点，禁止趁机改业务规则/路由架构。不能只保护知识job而让其他并发保存覆盖knowledge集合。

模型调用在队列外固定输入；结果返回后在队列内基于最新state合并。原有完整业务操作内的多个实体变化必须同笔保存，不把“文件已入库、结果未入库”当整体成功。GET读取只能看到已提交state。

JsonFileStore临时文件改名只保证单文件写入完整，不等于已有应用级事务；用延迟/失败Store测试上述行为，不能只用立即成功的MemoryStore证明并发正确。

### 5.2 源版本归档

- 纳管范围由知识item/context/dataset/快照的sourceRefs闭包决定；首次引用当前源时保存基线，不扫描并复制全库所有历史。
- `sourceVersions`保存 `{sourceRef,archivedAt,payload}`；payload是该类型完整可回查内容，不递归包含knowledge自身；原件源payload保留实际text，不能仅存hash。
- 有现成完整修订且能精确重建的方案版本可按原修订读取；无法重建的旧版本返回history_unavailable，不推测补齐。
- 原件不可原位改写；新文件形成新asset，旧asset或其纳管副本仍可回查。源历史的重复引用仅共享同一归档键，不在每个知识项复制一遍。
- 纳管表保存列、行、列审核和来源；支持当前值与初次纳管后的修订，接入前不能恢复的历史明确不在保障内。
- 外部手工改state导致已归档同版本hash不符：报content_mismatch并停止以该版本生成新正式快照，不覆盖存档。

### 5.3 任务与取消语义

- 正常提取：一块校验通过后，壳、items、contexts、evidence、relations与批次完成标记同笔提交；结构断裂时整块不进入可用知识，错误可重试。
- 暂停：停止调度后续块，允许已发出块完成并作为pending保存，界面明确“暂停中”。
- 取消：保留取消前已提交的块；队列确认取消后，尚未提交的在途响应丢弃，不再新增内容。
- 再试失败块：复用固定输入与块ID。提交成功但响应丢失时，用已持久化receipt返回原结果，不重复提取/插入。重放顺序为先查已提交receipt（即使run后续已取消也返回原成功结果，不能再写入），未命中才检查取消；取消后未提交响应丢弃。
- 重启：已持久化候选保留；原内存job不能假称运行，run标interrupted。用户显式继续时依据run冻结块和receipt跳过成功块；新作业句柄对应原run，不调用模型重做成功块。
- 旧聊天/方案等任务保留各自既有取消业务语义；只改其持久化边界，不强行套用知识提取规则。

### 5.4 extractionRun 持久契约

run字段固定为 `id,idempotencyKey,inputHash,paperRef,attachmentRefs,purpose,topicId?,subquestionId?,promptVersion,schemaVersion,createdAt,updatedAt,status,chunks`；status限running/paused/completed/partial/failed/cancelled/interrupted。

chunk固定 `id,sourceRef,start,end,additionalRanges,sourceTextHash,status,rawResponse?,error?,receipt?`；status限pending/running/committed/failed/discarded。原文通过固定sourceRef读取；保存rawResponse是审计原始文本，不允许其中credentials进入记录，API不默认返回rawResponse。

receipt固定 `inputHash,committedAt,cardIds,itemIds,contextIds,evidenceIds,relationIds,response:{created,skipped,createdItems,pendingItems}`；确认、修改后receipt仍描述最初提交，不能重放时把旧内容覆盖当前知识。

已有pause/cancel/resume/retry-chunk路径保持，运行时jobId指向持久runId并返回两者。全块committed→completed；部分失败且有成功→partial；全部失败→failed；取消→cancelled；重启的running→interrupted。停止等待的poll UI仍沿用旧job.status终态表示，完整处理结果另看run.status，不能把partial显示为“全部提取成功”。

## 6. 文献提取的固定实现范围

### 6.1 输入与分块

`POST /api/knowledge/jobs`使用现有入口，body固定为 `{paperId,attachmentIds,purpose,topicId?,subquestionId?,idempotencyKey}`。attachmentIds必须显式非空数组；选择“全部”由UI展开具体ID，不允许空/缺省解释为全选。未知ID、重复ID、附件不属于论文均422。subquestionId必须属于topicId，无topicId而有subquestionId为422。

run保存论文版本、附件ID/hash、目的、课题/子问题、提示词版本、提取结构版本、块清单和每块处理状态；正文只在已授权范围内读取。未归属提取允许无topicId，但不能自动进入所有课题；后续由用户加入课题theme。

每个附件独立分块，不先拼接成失去来源的全文；复用现有约4000字符/最多24主块限制，记录块在asset.text中的start/end。不跨附件补句，不更改原文去迎合逐字匹配。无章节标识的文本仍可按段落分块，source offset必须准确。

上下文补读规则固定为：仅在原文有明确表号/小节引用，且能在用户选定附件中唯一定位时，补入对应段落/表注（每主块最多一个、最多4000字符）；找不到/多命中/超限则记录unresolved_link，给用户手动指定来源。不能根据最近出现的温度自动继承，不能超出附件授权范围另抓网络文章。

### 6.2 模型输出与校验

输出结构固定为 `{schemaVersion:1,evidence:[],contexts:[],cards:[],relations:[]}`。

- evidence含localId、sourceBlockId、quote；模型偏移不是可信定位，必须服务端在合法范围逐字验证。条件和item用evidenceLocalIds引用对应片段。
- context含批次localId、subject/group/stage/method、conditions、unknowns及来源片段localRefs。
- card含localId、summary、items；item含§4所需科学内容、contextLocalIds与逐项quotes（每个quote明确sourceBlockId），不允许模型指定audit/revision/stableId/history。
- relations只引用本批localId，跨批已知对象关系由服务端/用户建立，不接受模型臆造库内ID。
- 方法、定义、解释、限制允许非数值item；不是每张卡必须含所有类型。
- 结构合法但来源未匹配可保存pending；结构无效、悬空localId或非法类型不能静默降级成argument。
- 数字与原文不一致先作为核对问题，不根据格式正确即确认；规则校验不会宣称已经验证科学真实性。
- 来源搜索只在对应冻结块/允许补读内进行；多命中保留候选，单命中验证偏移。确实来自本块但引文不匹配时，归档来源可确定而证据定位仍为unmatched。

提示词版本由现有常量机制递增，新增结构版本1；保留研究目的驱动与反注入约束。外部材料中的命令只能当文本，不能改变工具权限或外发范围。

### 6.3 幂等与重复

- 请求幂等键由UI生成并在网络重试时复用；同键同输入返回同run，同键不同输入409。
- run内每个块以固定 `runId+chunkId` 标识，成功receipt包含生成对象ID；同已成功块的重试返回receipt，不重新调用模型。
- 同批candidate localId重复为422，整个批次不半写。
- 不同run的相似概述只形成duplicateCandidate提示；不自动删除、合并或复用旧review。
- 跨块同一证据重复可提示用户归并；实体合并操作不在首版范围，用户可排除多余候选，不篡改旧证据。

## 7. 查询、比较、快照与导出的固定合同

### 7.1 查询与作用域

`readKnowledge(state, query)`是所有总览/wiki/比较/AI读取的共同入口，返回 `viewId,scope,items,contexts,evidence,relations,datasets,themes,mappings,comparisons,referenceMap,warnings,coverage`。

- query的来源二选一：`{source:"current",topicId,...filters}` 或 `{source:"snapshot",snapshotId,...filters}`。current必须有topicId；snapshot从快照取得课题与固定对象，禁止回读当前主题/判断/映射填正文，仅允许当前告警与授权校验；两种模式返回同型视图。
- 无主题时显示该课题范围，不返回其他课题。无归属资料只在显式资料审阅入口处理。
- 支持themeId/subquestionId/text/contentType/nature/sourceClass/metricId/condition/status筛选；默认formal。关系展开只限选定范围和必要来源，不能沿共享论文走进其他课题的私人判断。
- text先NFKC用于检索副本并忽略拉丁大小写，原文不修改；按完整子串命中，顺序为精确主题名、陈述/指标、来源题名、ID；同级ID排序。不得将分词/语义召回作为既有能力宣传。
- 每次响应content hash作为viewId；前端后续动作携带viewId，数据已变返回409要求刷新，不在同页混合两次读取。
- GET不落库；持久冻结由POST完成。页大小默认50、最大200，显式hasMore/nextCursor/totalKnown；超过单次范围要分页或提示，不静默截断。

### 7.2 比较契约

保存的Comparison payload必须含 `question,inputRefs,metricId,varyingFields,requiredEqualFields,operation,baselineRef?,mappingRefs,exclusions,decision`；决策为 `computable|display_only|blocked`，附逐项reasonCodes。

比较操作数固定两种格式：`{type:"item",ref:KnowledgeRef}`（ref.kind必须为item），或 `{type:"cell",datasetRef:KnowledgeRef,rowIndex,columnIndex}`（datasetRef.kind为dataset，0基行列索引必须在该数据集固定selection范围内）。inputRefs是上述操作数数组，baselineRef必须逐字段等于其中一项；不允许只传整个dataset让执行者猜哪个值，也不为每个单元格生成知识item。

cell值通过dataset.sourceRef读取固定表版本，指标/单位来自该列映射，条件来自对应rowBinding/context；缺列含义或行条件时仍可display但不得绕过计算门槛。normalizedInputs每项保存完整操作数、类型化原值、规范值和来源token。两项difference定义为“非基线值减基线值”，ratio为“非基线值除以基线值”，不依赖输入数组位置隐式决定符号。

判断顺序固定：同指标定义→对象/阶段→数值类型/统计口径→单位换算→必需条件→review/来源→操作要求。varyingFields允许差异，requiredEqualFields缺失或冲突阻止计算；两集合不得重叠。

- `display`允许定性/界限并列且不产生统计结论。
- `difference/ratio`首版仅两个scalar同口径；必须选baseline，ratio分母0阻断；summary/bound/range不参与这两个运算。
- 换算只用 `scaleOffset = {factor,offset,fromUnit,toUnit}` 的已确认规则，不执行任意JS/表达式；单位定义/因子缺依据即不能自动换算。
- 服务端使用明确十进制输入校验和固定舍入策略（最多12位有效数字，并在结果给出formatting说明）；原值不改，不虚构实验测量精度。
- 每个结果保存inputs、规范值、原值、操作与规则版本；文字判断通过人工建立为item，不把计算返回直接标confirmed科学结论。
- 原有ComparisonRecord只读可用，不用新算法重写既有快照；旧createComparison改为读取适配入口后，遇到未绑定字段只能display_only。

### 7.3 快照

`freezeKnowledge(state,input)`固定 `snapshotId,createdAt,schemaVersion:1,projectionVersion:1,scope,contentHash,content,sourceVersionRefs,mappingRefs,coverage,excluded`。

content固定包含选定items、contexts、evidence、relations、datasets及实际行列、themes（含definition/members/currentJudgmentRefs）、comparisons、mappings完整payload、referenceMap与必要片段；每个对象含固定KnowledgeRef。主题的成员与当前判断只保留本次选中闭包，排除项记录原因，不能为凑齐主题而超出选择。referenceMap按排序后的固定引用生成稳定token并随快照冻结。

不包含整个LocusState、密钥、绝对本机路径或未经选择的聊天。来源历史保全与snapshot同笔提交；保存失败不返回ready。首次读取current生成的临时referenceMap只用于预览，冻结生成正式token后所有导出/API/页面使用该表，不各自生成不同token。

canonical hash算法：对象键递归排序、数组顺序按契约稳定、UTF-8 JSON、SHA-256；createdAt/snapshotId不计入contentHash，scope/内容/规则/版本计入。同内容重复冻结可不同ID但同contentHash；导出复用快照createdAt，不因导出时钟变化污染内容。

正式冻结复查所有选中item的审核和上下文要求；探索快照保存mode=explore并加明显标识。部分材料未读或行被筛选时coverage列 `selected,totalAvailable,processed,omittedReasons`；complete仅指声明范围完整，不指全库/全文完整。

动态 `warnings.current`（当前撤回、权限变化、存在新版）从服务读取叠加，不改变contentHash；历史内容仍保持当时审核和知识性质。新计算不得利用已经撤回/现在不允许使用的旧快照冒充有效依据。

### 7.4 wiki、CSV、JSON与引用

- JSON由snapshot.content序列化，机器schema和数据字典随包。
- wiki固定模板页型：首页、子问题、主题、比较、来源、缺口；方法页在E8补齐。没有内容的页显示空态，不编造正文。
- 总览“当前认识”只取theme.currentJudgmentRefs中已确认且有效的item；其余显示“尚未形成综合判断”。
- reference token为不含路径的snapshot内opaque ID，映射固定KnowledgeRef/SourceRef/locator；token不是访问凭据。
- 包内来源链接指向相对路径，命名使用ID不使用未清理的标题；禁止路径穿越和绝对路径。
- 一个比较CSV一行一条明确观察，列含operand_type/item_id/dataset_id/revision/row_index/column_index/context_id/metric/raw_value/value_kind/normalized_value/unit/source_token；item与dataset单元格二选一，另一组位置字段为空而非伪造ID。不能表示的结构引用JSON，不展开成丢关系的扁平字符串。
- 默认下载面向机器的CSV，标明不是已转义电子表格视图；额外提供sheet-safe版本，含formula-like字符串时前置安全转义并在manifest标注。原始/机器数据不被改写，默认页面用安全文本渲染。
- 用户内容、Markdown链接和HTML均视作不可信文本；首版仅渲染自有模板的受限Markdown结构，禁止原始HTML、javascript协议和模型输出脚本进入DOM。
- 导出manifest列出每个文件hash、schema、来源许可、被排除附件及原因；附件默认不带，只在明确选择且允许再分发时带入。是否允许向某AI发送还须单独用户授权，不能仅凭论文公有领域推定。
- 全库备份覆盖knowledge及sourceVersions/snapshots；备份ZIP不是AI知识包，不允许按钮混用。

### 7.5 当前来源策略与所有出口的共用检查

sourcePolicies固定为 `{id,sourceKind,sourceId,revision,allowLocalRead,allowExport,allowAiSend,reason,updatedAt,history}`，引用稳定来源ID，适用于其历史版本。缺策略时在本机所有者模式下允许localRead，export/aiSend默认不允许；不把本地可读、许可公开与允许某次AI发送混为一件事。

E5实现本地用户显式选择允许导出的来源及理由；E7实现允许发送AI的选择。写入策略只改变该资料的应用内使用决定，不触碰Qoder权限、文件权限或平台设置。一次外发还须明确purpose、target和snapshot范围，策略allowAiSend不是自动网络调用授权。

所有view/item/rows/snapshot/reference/export/AI发送共用 `assertKnowledgeAccess(operation,refs,currentPolicies)`：检查实际依赖的源引用闭包，包括派生判断的上游来源。含无权限来源的快照整包拒绝（403），不只加warning后继续返回；可在用户明确POST时为剩余范围创建新快照，GET不能修改或裁剪后冒充旧包。

本地历史读取被allowLocalRead禁止时不得提供存档副本；allowExport=false不妨碍仍获准的本地阅读。当前已撤回的item不再用于新的正式推理/发送，但历史阅读与原样历史归档导出保留当时事实和动态撤回说明，前提是sourcePolicies允许相应操作；不把历史归档当新结论。

策略变更追加历史，不修改旧snapshot.content或hash；下一次读取/下载/发送立即生效，B1不能只读取启动时策略。人工无来源陈述以该知识item稳定ID建立同样策略对象（sourceKind="knowledge_item"），避免无来源对象绕过外发许可。无法确定依赖闭包时外发拒绝并指出缺口。

## 8. UI与本地API固定合同

### 8.1 本地接口

以下是新接口合同，实施前均视为未实现；保留原有非知识路由行为。错误体沿用现有 `{error}` 并增加 `{code,details?}`，不给客户端堆栈或密钥。

| 方法与路径 | body/query要点 | 行为 |
| --- | --- | --- |
| GET `/api/knowledge/view` | source=current+topicId或source=snapshot+snapshotId、筛选、mode、cursor | §7.1统一读取，不写state |
| GET `/api/knowledge/items/:id` | revision必填，topicId或snapshotId | 指定版本，不用latest兜底 |
| GET `/api/knowledge/datasets/:id/rows` | revision、range、cursor、scope | 返回行列与typed metadata；检查范围 |
| POST `/api/knowledge/datasets` 与 `/:id/update`、`/:id/review` | create用topicId/sourceRef/selection/columns/rowBindings；update用baseRevision/patch/reason；review用baseRevision/columnIndices/decision/basis | 只编辑数据含义与绑定，不改原表数值；列审核明确到索引，版本和审核按§4.2 |
| POST `/api/knowledge/relations` 与 `/:id/update`、`/:id/review` | 固定from/to/type/basis/evidenceRefs；更新审核带baseRevision | 科学支持/限制关系人工确认；纯业务结构关系由验证后的业务字段建立，不靠模型自报 |
| POST `/api/knowledge/source-policies` | sourceKind/sourceId/baseRevision或新建、allowLocalRead/allowExport/allowAiSend/reason | 明确的本地用户操作；不由模型或外部只读客户端更改 |
| POST `/api/knowledge/items/:id/update` | baseRevision、patch、reason | 内容修订，不接受review/history |
| POST `/api/knowledge/items/:id/review` | baseRevision、decision、basis | 服务端核对条件/来源门槛，确认仍不等于采用 |
| POST `/api/knowledge/contexts/:id/update` | baseRevision、patch、reason | 更新条件及新的审核状态，不改旧引用 |
| POST `/api/knowledge/contexts/:id/review` | baseRevision、conditionIds、decision、basis | 分项确认，整体可用性派生 |
| POST `/api/knowledge/evidence/:id/resolve` | baseRevision、candidate、basis | 服务端验证quote/offset，不采信伪造matched |
| POST `/api/knowledge/cards/:id/structure` | baseRevision、显式items/contexts/evidence | 局部结构化旧卡，进入pending，禁止全库自动转换 |
| POST `/api/knowledge/themes` 与 `/:id/update` | topicId/name/definition/memberRefs；更新带baseRevision | 人工组织主题与当前判断，不自动采用全库同名项 |
| POST `/api/knowledge/statements` | topicId、text/nature、inputRefs、evidence、scope | 建立人工/AI派生候选，AI内容不得自报human_confirmed |
| POST `/api/knowledge/mappings` 与 `/:id/update`、`/:id/review` | §4映射、baseRevision、basis | 内容编辑与审核分开 |
| POST `/api/knowledge/comparisons` | §7.2契约、viewId | 验证范围，返回比较记录/决策，旧输入不自动升级 |
| POST `/api/knowledge/snapshots` | viewId、selectedRefs、purpose、mode | 原子冻结，返回snapshotId/contentHash |
| GET `/api/knowledge/snapshots/:id` | scope | manifest与固定内容，不重新生成 |
| GET `/api/knowledge/snapshots/:id/export` | format=zip/json/wiki/csv；csv必选datasetId或comparisonId且二选一，variant=machine/sheet-safe | 由同一快照导出且复检§7.5；导出失败不改快照 |
| GET `/api/knowledge/references/:token` | snapshotId | 指定来源/版本的结果或明确不可用 |

422用于结构/选择范围非法；409用于baseRevision/viewId/idempotency冲突；404对象不存在；410明确历史或来源内容已不可用；403来源读取/发送授权不足；500持久化失败；502模型失败。不得自动重试用户写入或用200+空数组隐藏失败。

本地服务目前不是多用户权限系统；topicId筛选属于范围契约，不得宣称实现租户隔离。主监听保持127.0.0.1。本合同不授权公开此服务或新增跨域允许。

### 8.2 页面固定行为

- 新增知识总览为知识入口默认子视图；默认当前课题，保留“审阅”通往原文提取与人审，不改变其他七入口。
- 总览布局：问题/主题导航、当前认识、文献证据/本地数据分区、比较、限制/缺口；选中项的右侧证据抽屉包含原文/条件/版本。
- 四子视图共享scope/viewId/snapshotId；切换主题或快照同步更新列表、图、wiki和证据抽屉。切换期间显示加载，不保留跨scope错配旧详情。
- current视图有更新时显示刷新提示，未保存编辑存在时不自动重绘丢输入；沿用现有dirty守卫。
- 数值图首版使用原生SVG条形/点图，只展示当前比较；分类显示文字，bound显示边界箭头；不画没有数据依据的误差棒。
- 主题页建立判断的动作固定为“新增认识”→选择来源项→写text/nature/scope→保存pending→专用确认→设为当前认识。AI可在E7产生草稿，不能直接占据当前认识。
- 原文抽屉必须切到对应附件/表格/版本再定位，不能只在当前已打开附件里搜同一句话。
- 修改实际表值/方案/执行时跳回原模块；知识页面只编辑新知识语义，不提供第二个业务事实编辑器。
- 空状态分别显示无资料/有资料待审/已审但无当前判断/条件不足/引用缺失；不使用一个“暂无数据”混淆。
- 双主题、键盘焦点、窄屏横向表格滚动必须保留；移动端证据抽屉可改全宽面板，不能缩小字体假装适配。
- 不添加吉祥物、全站动画、主题重设计、独立展示网站或截图画廊来代替功能。

## 9. 文件职责与范围白名单

路径相对仓库根；标“新建”的只在实施阶段创建，本次仅文档。若已有等价文件，复用并在阶段记录写明，不复制另一份实现。

| 文件 | 固定职责 |
| --- | --- |
| [sciworkbench/store.ts](../../sciworkbench/store.ts#L572) | knowledge字段、空状态、迁移、严格加载；不搬迁既有实体 |
| 新建 `sciworkbench/domain/knowledge.ts` | §4类型、纯校验、hash规范辅助；无网络/文件IO |
| 新建 `sciworkbench/services/knowledge-base.ts` | 源历史适配、查询、审核、比较、冻结；共享函数而非每消费者各拼一份 |
| 新建 `sciworkbench/services/knowledge-export.ts` | 快照→wiki/JSON/CSV/ZIP；复用现有ZIP工具，不拷贝ZIP实现 |
| [sciworkbench/services/knowledge.ts](../../sciworkbench/services/knowledge.ts#L24) | 现有文献提取准备/map/apply，接入新契约与receipt |
| [sciworkbench/services/ai.ts](../../sciworkbench/services/ai.ts#L34) | 仅知识提示词/结构化块输入与版本；其他任务参数不顺手改 |
| [sciworkbench/server.ts](../../sciworkbench/server.ts#L121) | 单写入队列、路由编排、job状态；不塞科学判断/视图模板 |
| [sciworkbench/services/app.ts](../../sciworkbench/services/app.ts#L348) | 旧卡与新壳编辑门槛、比较适配、采用/计数兼容 |
| [sciworkbench/services/analysis.ts](../../sciworkbench/services/analysis.ts#L63) | 分析/聊天上下文与报告固定引用适配，不取消原分析核心条件 |
| [sciworkbench/services/references.ts](../../sciworkbench/services/references.ts#L232) | 知识与源节点/边、固定版本回查、变更提示 |
| [sciworkbench/services/export.ts](../../sciworkbench/services/export.ts#L264) | 全库备份/恢复覆盖knowledge，报告引用新类型导出 |
| [sciworkbench/public/lib/pages/knowledge.js](../../sciworkbench/public/lib/pages/knowledge.js#L51) | 审阅与入口切换，复用现有操作 |
| 新建 `sciworkbench/public/lib/pages/knowledge-base.js` | 总览/wiki/比较/证据抽屉渲染与事件 |
| [sciworkbench/public/app.js](../../sciworkbench/public/app.js)、[api.js](../../sciworkbench/public/lib/api.js)、[format.js](../../sciworkbench/public/lib/format.js) | 入口分发、API方法、中文状态；纯JS |
| [sciworkbench/public/styles.css](../../sciworkbench/public/styles.css) | 仅知识页面局部样式，复用主题变量 |
| 既有context-map/analysis/refs页面与services/experiment.ts | 仅消费者/纳管适配确实需要时改，阶段E0列出具体符号，不重做功能 |
| 新建 `sciworkbench/tests/knowledge-base.test.ts` | 数据/历史/查询/比较/同源contract tests |
| 新建 `sciworkbench/tests/knowledge-pipeline.test.ts` | 提取/receipt/模拟模型/慢Store/路由测试 |
| 新建 `sciworkbench/tests/knowledge-view.test.ts` | 纯渲染与API往返结构；不能替代浏览器 |
| 新建 `sciworkbench/scripts/acceptance-knowledge.ts` | 显式synthetic隔离验收种子；无网络、无真实密钥，输出文件已存在即拒绝 |
| 既有tests中受改契约影响的具体文件 | 更新有意变更及保持回归，不删测试/降低旧断言绕过 |

除上述与当轮record外，不改prompt包、其他设计历史、AGENTS.md、用户memory、CI/CD、包依赖、外部服务配置。若ZIP辅助函数未导出，可最小导出复用，不能复制或引入通用导出框架。

## 10. 执行阶段：按顺序，不跳步

每阶段输入包含：本合同版本、最新git状态、前阶段证据、用户授权范围。阶段结束须给实际文件、测试和未完成项；不得只说“已按设计完成”。本表E阶段细化产品设计P0–P6，不新增另一条产品路线。

### E0 — 基线与执行范围登记（对应P0）

- **改动范围：** 只读代码/测试，更新本会话记录。
- **步骤：** 核查git；运行既有完整测试；枚举server内所有state赋值/save、cards消费者及store版本；列出真实模型/样例/外发授权是否具备。
- **输出：** 基线命令/结果、写入点清单、消费者清单、活体实例保护范围。
- **通过：** 基线已知；失败若与本任务无关如实登记，不能以“之后可能好了”推进依赖它的验收。
- **禁止：** 偷清理工作区；启动原实例；将预编制HEAD当当前HEAD。

### E1 — 类型、迁移、单写入与源历史（对应P1基础）

- **范围：** store/domain/knowledge-base/server提交边界、相关tests；不改页面布局。
- **步骤：** 按§4建类型；v8→下一版；严格读取；commitState替换所有持久化写点；新增源历史与固定版本解析；更新全库备份恢复校验。
- **通过：** T01–T05、T20–T23；慢/失败Store证明保存成功才可读；迁移后旧对象不变；备份恢复含knowledge；多份state异步保存不覆盖。
- **必须停止：** 找到无法纳管却仍可修改同源对象的旁路，不能先声称历史可靠。

### E2 — 文献提取与入库（对应P2前半）

- **范围：** knowledge.ts/ai.ts/server知识路由、知识纯服务、pipeline tests；修改已有提取表单的显式附件选择参数，并在app/analysis/context-map/引用选择入口为新壳接入最低fail-closed守卫。完整分项使用在E3开放。
- **步骤：** 固定run输入；每附件带偏移分块；有界补读；模型结构→校验→完整候选批次；幂等receipt；暂停/取消/重启语义；同条件异文案仅候选提示。
- **通过：** T06–T12、T24；新壳不得进入旧选择器兜底；每个错误与输入范围可追溯。
- **禁止：** 为使模拟测试简单只实现一张卡/一个条件，或改共享chunkText影响所有旧任务却不回归。

### E3 — 分项人审、主题与消费者守卫（对应P2后半）

- **范围：** 专用update/review接口、现有知识审阅UI、app/analysis/context-map必要守卫、对应tests。
- **步骤：** 展示观察/条件/解释/unknowns与各自来源；正确附件回查；分项确认；旧卡按需结构化；主题创建/成员/当前判断；旧cardId引用与新item选择适配。
- **通过：** T13–T16、T25；浏览器新/旧卡、人审冲突、部分项未审、刷新恢复和dirty保护通过；原有analysis/chat不得借壳audit绕过。
- **阶段交付：** 即使总览未做，审阅链必须真实可用，不能留所有确认按钮到最后补。

### E4 — 数据集、查询与比较（对应P1读取+P2比较）

- **范围：** knowledge-base、dataset适配、mapping与comparison接口、tests。
- **步骤：** 最薄表格/测量读取和固定版本；显式列含义/样品状态绑定；§7检索/范围与操作；原值/条件/规则完整保存。
- **通过：** T17–T19、T26–T28；missing/unit/type正确拒绝，条件作为自变量不误拦截，scope不沿共享论文串课题。
- **禁止：** 用摘要/前30行代替选定数据集，绕过既有分析“需实际数据核心”规则。

### E5 — 快照、wiki与知识包（对应P3数据面）

- **范围：** freeze/export/本地读取路由、备份完整性与tests。
- **步骤：** viewId检查；固定snapshot；统一JSON/CSV/wiki；tokens/许可排除；sourcePolicies显式选择及所有出口共用检查；同源比较；源缺失/历史不可用；schema/data dictionary。
- **通过：** T29–T35；改数据和映射后旧快照不变，新版确有差异；包内链接合法，检查私密哨兵。
- **禁止：** 只检查文件存在/JSON可解析；把机器CSV中缺失值写成0；用真实用户全文作导出测试。

### E6 — 可视化知识总览（对应P3页面）

- **范围：** §9指定前端文件、view tests、synthetic验收脚本。
- **步骤：** 四子视图、主题与条件筛选、认识/文献/研究数据/限制、比较图表、同版本证据抽屉、空态/错误态、当前/快照切换。
- **通过：** T36–T40及§12浏览器全链；主题切换与引用不串；两个主题与窄屏可用；刷新/未保存/失败不丢工作。
- **禁止：** 只做静态设计稿、截图或假按钮，或为测试页面创建另一个与主应用无关的展示站。

### E7 — 内置AI统一输入与外部文件实测（对应P4）

- **范围：** analysis/聊天/推荐输入适配、选择器和引用解析、pipeline tests。
- **步骤：** 核心/可选预览从readKnowledge产生；固定snapshot；保存真实payload与截断/省略说明；适配卡壳和item；AI引用校验；人工采纳回原模块；手动下载选定包。
- **通过：** T41–T45、既有review/contract-roundtrip回归；模拟AI部分先验，真实模型与外部工具另按S03获准后验。
- **注意：** 既有AnalysisTask依然需要执行/测量/表格核心；纯文献任务使用知识阅读/比较/探索对话，不为了演示修改该约束。
- **状态：** 无真实工具授权时只能标“代码与模拟调用通过；真实工具待验”，不能将外部文件兼容性标完成。

### E8 — 其余模块逐类贯通（对应P5）

固定顺序：方案与模板→执行事件→样品状态→分析结果→报告块→已采纳对话；表/测量已在E4接入。

每类必须完成：当前读取、纳管历史、固定来源、性质/审核继承、更新提示、wiki/总览入口、AI选择器读取、一项更正回查测试。分别新增T46子用例，不允许只为这些类型返回标签。

- 方法来源≠执行性质，按文献写方案不把真实执行改为reconstructed。
- 公开数据导入不创建虚构执行/样品；无本地关联仍可作为公开数据集存在。
- 报告内容拆到知识时是派生陈述，不算新一手来源；报告必须解析当时refs的版本。
- 聊天只将明确采纳内容进入知识主题，保留提案和采纳事件依据，不将全量聊天默认索引成正式知识。
- **通过：** 逐类清单全绿及既有origin/reference/report守卫回归；方法页、局部关系图与引用跳转实测。没有真实样例的类型使用synthetic并如实标验证层级。

### B1 — 外部只读接口（对应P6，独立授权后执行）

- 新建独立只读监听器文件 `sciworkbench/knowledge-reader.ts`；不能导入并暴露主createApp全部路由。
- 默认仅127.0.0.1；读取已授权snapshot副本与当前来源策略，不提供业务写入/任意文件读/配置接口。
- 授权对象固定为特定snapshotId及允许内容类别，有有效期；随机Bearer token只显示一次，服务内存保存hash，重启失效；不落入业务state/导出/URL或日志。授权创建和发送由用户明确执行，不能自动读取某配置中的Key当知识访问token。
- 路径限 `GET /api/knowledge/view?source=snapshot&snapshotId=ID`（text/筛选/分页只在授权快照内）、`GET /api/knowledge/items/:id?revision=N&snapshotId=ID`、datasets/:id/rows（同样带revision/snapshotId）、snapshots/:id（含export）与references/:token（带snapshotId）。不另造search路径，不接受current模式或任意topicId检索；这些路由必须复用§7的固定快照读取/授权/导出函数。
- 全部先验token与snapshot范围；请求all-state、current或snapshot外引用均403/404；POST/PUT/PATCH/DELETE等写请求405，未知路径404，不转发主服务。
- 每token最多30请求/分钟，分页最大200、单响应UTF-8 JSON最大2MiB，超限分页/413，不截断后返回complete；不允许CORS通配，不做远程部署。
- Host限定实际loopback端口；提供Origin时只允许明确授权的本机源，未授权Origin拒绝；不提供Origin的本机非浏览器客户端仍须Bearer。
- 来源授权撤销后，含撤销源的整包不可再下载；只读服务未能读取/验证最新策略时fail closed，不靠启动时缓存永久放行。已有下载副本无法收回，界面明示。
- 本机其他进程仍可能直接访问既有主服务；此接口不声称能防御已拥有本机文件/主服务权限的用户。若需互联网或多租户安全，必须单独设计，不在B1扩张。
- **通过：** T47鉴权/范围/限量/撤销/过期/重启 + 用户指定实际客户端读取到正确版本；未批准运行时仅保留阶段说明，不在A阶段偷偷新增listener。

## 11. 测试判据：先写反例，再实现

新测试文件组织按§9；表中ID必须出现在测试名称或测试描述中，便于执行者与审阅者核对。禁止减少本表断言换取全绿。

| ID | 输入/操作 | 必须观察到的结果 |
| --- | --- | --- |
| T01 | v8状态迁移→保存→重启 | 旧实体deepEqual，knowledge空且版本正确，不重建ID |
| T02 | 已存在JSON损坏/未知knowledge版/缺集合 | 明确拒绝加载，不写空库；不存在文件可新建 |
| T03 | 旧源纳管后更正两次 | 初始/两次修订各有可读payload；索要更早未知版不可用 |
| T04 | 延迟Store，交错两次用户操作和AI完成 | 三笔基于最新提交串行保留；GET不见未提交态 |
| T05 | Store首次保存失败，随后成功 | 失败不发布任何业务/知识变化，队列可继续 |
| T06 | attachmentIds空/缺省/错论文/子问题错课题 | 422；模型调用次数0，无run或知识残留 |
| T07 | 同summary、不同组别/条件的两候选 | 两项均保留，不按summary去重 |
| T08 | 同run同已成功块重复请求/响应丢失后重试 | 返回同receipt，对象数不增加，不重调模型 |
| T09 | 相同引文在该quote合法搜索范围内多处出现；另加范围外同句 | 范围内多命中才ambiguous；范围外同句不构成候选，不默认首个 |
| T10 | 指定块中不存在的引文 | pending+unmatched；不生成matched假定位 |
| T11 | 方法与结果不同块/附件，组别不同 | 仅明确唯一引用可绑定，否则unresolved；不串条件 |
| T12 | 非法类型、localId重复、悬空context引用 | 整块拒收，不返回半套可用知识 |
| T13 | 一卡两项，一确认一待审 | 正式范围只含确认项；整卡选择不能夹带待审 |
| T14 | 修改value/条件/来源/nature | 新revision变pending；旧确认快照可读；409保护过期编辑 |
| T15 | 修改重要度/普通备注；修改时偷传review/history | 不改变科学性质；伪造生命周期不生效 |
| T16 | 旧卡无逐项绑定→显式结构化 | 旧版仍可回查，新结构待审，不双编辑fields |
| T17 | 1 d与24 h；另测1 d与48 h，规范单位h，以1 d为基线；分别用item与同dataset的两行单元格操作数测试 | 独立oracle：首组规范值24/24，差0、比1；次组24/48，差24 h、比2；操作数/基线/行列唯一，不生成虚构item，原值与规则可回查 |
| T18 | 同名不同定义、单位未知、summary与scalar混用 | 不进入差值/比值；display_only或blocked有明确理由 |
| T19 | ratio基线为0，bound>90，定性“立即” | 0基线拒绝；界限/定性不变scalar参与运算 |
| T20 | 导出全库→隔离恢复 | knowledge、源历史、run receipt、快照完整且hash有效 |
| T21 | 原件/源版本丢失或hash漂移 | source_missing/history_unavailable/content_mismatch，不读latest |
| T22 | 后台模型完成前用户改备注/条件 | 不丢用户改动、不覆盖确认、不改变冻结输入 |
| T23 | 多实体结果提交在save处失败 | 文件与结果均未发布，无孤儿业务记录 |
| T24 | pause/cancel/restart/继续 | 按§5.3精确处理；成功块保留，取消后未提交块丢弃 |
| T25 | 普通reviewCard确认新壳，伪造item审核 | 拒绝绕过；旧卡正常流程仍过 |
| T26 | 两课题共享论文，一方有私有判断 | 当前课题查询不越界，不沿共享来源扩散 |
| T27 | 温度是varying与requiredEqual分别测试 | 前者可按明确契约比较；后者不同/未知阻止计算 |
| T28 | 两条映射都命中或规则修改 | 冲突不取第一条；旧比较保留旧规则 |
| T29 | 同snapshot分别生成页面数据/JSON/wiki/CSV | 公共事实、单位、性质、unknowns、引用一致，且分别满足T17独立数值oracle，避免共同算错 |
| T30 | 冻结后修改数据、映射、主题当前判断和比较再导出 | 旧页面/wiki/包的事实、判断选择和token不变，新包hash/版本变化 |
| T31 | 选择表前31行且最后1行不同 | 31行均在范围内，无前30行截断；coverage准确 |
| T32 | viewId过期后冻结/比较 | 409要求刷新，不悄悄改输入 |
| T33 | 非法文件名、HTML/script、javascript链接、CSV公式 | 包路径与DOM安全；机器值保真，sheet-safe版明确转义 |
| T34 | scope外内容、密钥哨兵、未选聊天；冻结后撤销源导出/发送许可 | 不在任何导出或AIpayload；检查ZIP解包内容；本地导出/AI/B1均拒绝受限整包，原snapshot不被改写 |
| T35 | 首次freeze保存失败，旧snapshot存在 | 不返回新ready；旧snapshot仍读得出 |
| T36 | 总览筛选主题→条件→选择数据点 | 图表/列表/抽屉同scope同版本；真实DOM操作 |
| T37 | 打开历史快照，再切wiki和证据 | 全部显示历史值，不只页头写“历史” |
| T38 | 空资料、全待审、无判断、缺来源、不可比 | 每种空态/错误态准确，无假认识 |
| T39 | 人审未保存期间后台完成/切主题/刷新 | 不静默丢输入，沿用dirty确认与恢复策略 |
| T40 | 双主题、桌面与窄屏、键盘操作 | 主要动作可达，页面无未捕获错误 |
| T41 | 内置正式AI选择新项+数据核心 | 仅选中且已确认内容，actualPayload可复查 |
| T42 | 待审探索与正式推荐分别发送 | 探索有标记，正式守卫仍阻断待审 |
| T43 | 模型返回不存在/不属快照的引用 | 标invalid，不能自动写入confirmed报告/知识 |
| T44 | 模型上下文超预算 | 显式要求缩小/分页或记录partial；不默默截断条件 |
| T45 | 相同输入给内置与外部文件 | 科学字段/引用相同；包装差异及兼容测试工具明确 |
| T46 | E8每类读取→更正→历史→wiki/AI | 原模块性质不变、条件不借用、对话只纳采纳内容 |
| T47 | B1无token/过期/越scope/重启/撤权/超限 | 按合同拒绝，不访问主state/API/本机任意文件 |

### 11.1 固定合成oracle

自动测试使用清晰标记为synthetic的材料：同一对象两处理组，1 d与24 h，同文字不同组、>90下界、“立即下沉”定性、后续发芽观察与未知培养条件、第二课题私有哨兵。对象名字使用“合成对象A/B”，不得借达尔文名义包装合成数据。

达尔文真实案例只作已许可的本地人工演示：23/85天、随后萌发不等于100%、影印371/372与印刷359/360、波浪限制属于作者判断。内部测试包不能复制进public或公开fixture；真实材料缺失时人工演示明确待件，不能修改自动测试让其伪装真实。

### 11.2 消费者回归清单

每阶段收尾确认以下是否涉及；涉及必须测，不涉及注明理由：

- 知识卡入候选/撤回/采用/排除/批审与重要度。
- 比较输入、旧比较快照和单位显示。
- 课题首页数量、候选列表与新壳/item去重。
- context-map必选/可选、实际选择与冻结前复检。
- 分析任务核心约束、方法推荐、结果提交。
- 对话范围、取消与人工采纳。
- 报告块添加/调序/修改/确认/删除/刷新与固定refs。
- 引用网络、缺失引用、样品状态及重构来源。
- DOCX/追溯ZIP、全库备份/隔离恢复。

## 12. 验证命令、容量与浏览器证据

### 12.1 已有可用命令

从仓库根运行完整测试：

```bash
npm --prefix "sciworkbench" test
```

单测工具以 `node --test` 运行，命令必须指向阶段实际创建的文件，不能把未存在文件的预期命令记录为已通过。现有脚本没有build/typecheck，不能凭空报告“构建成功/类型检查全过”。

新增文件完成后，可运行：

```bash
node --test "sciworkbench/tests/knowledge-base.test.ts" "sciworkbench/tests/knowledge-pipeline.test.ts" "sciworkbench/tests/knowledge-view.test.ts"
git diff --check
```

浏览器验收使用专用synthetic种子和新临时数据路径：脚本必须要求显式输出路径，拒绝覆盖已有文件。起服务前核对端口，端口冲突直接停止换未占用端口，不结束不明进程；`LOCUS_DATA`和`LOCUS_AI_CONFIG`均指向本次隔离位置，不能读现用Key。默认不配置真实模型，模拟服务只在本机返回标记内容。

启动模板如下，由实际环境填入已确认空闲端口和绝对路径，不复制占位符执行；在该次子进程环境移除AI配置，不修改用户持久环境，也不打印变量值：

```bash
env -u LOCUS_AI_BASE_URL -u LOCUS_AI_MODEL -u LOCUS_AI_KEY -u LOCUS_AI_TIMEOUT_MS PORT="<已确认空闲端口>" LOCUS_DATA="<本次新文件绝对路径>" LOCUS_AI_CONFIG="<隔离配置文件绝对路径>" node "sciworkbench/server.ts"
```

隔离配置文件不得复用用户配置，首次未创建时按无模型启动。后续桩服务配置只用synthetic地址/凭据，通过隔离实例设置。仅关闭本轮启动并确认身份的测试进程。

### 12.2 容量门槛（首版工程门槛，不是性能宣传）

- 合成负载：1个课题、1000知识项（每项text约200字符）、100条件上下文、10000行×10列数据表（每格8字符以内）、10份每份100KiB的合成文献文本、20个只选择10项的快照；源版本共用归档，不能每快照复制全库。
- 追加增长负载：表格更正3次、100知识项各修订3次、10个提取run各含20KiB合成rawResponse与完整receipt；包含实际历史payload而不是只改version数字。
- 在用户机器上记录初始state大小、加载时间、查询/保存耗时和内存峰值；查询与保存各运行5次，报告中位数和最大值。保存计时从commitState入队到JsonFileStore保存及内存发布完成，包含历史归档和校验，不只计rename；E1测基础负载，E5完整快照实现后复测全负载。
- 附加knowledge部分序列化大小不超过50MiB，5次查询中位数不超过1秒、保存中位数不超过2秒；只作为S08工程停点，不能删历史/降低数据规模通过。
- 此门槛不在业务运行中自动截断/删除资料；超限明确告知，不宣称无限扩展。性能测试不得使用用户真实数据。

### 12.3 浏览器验收固定路线

1. 用既有Edge/可用浏览器工具打开隔离主应用，确认数据标为synthetic。
2. 审阅一张含两条件的卡：逐项原文、修改条件、确认一项、另一项仍待审。
3. 总览创建主题与有限认识；确认后才能出现在“当前认识”。
4. 筛选该主题与条件，打开比较，检查原值/规范值和不可比项。
5. 点击图中或表中数值，切到正确附件/固定版本高亮；再测试缺失来源。
6. 冻结、读wiki、下载JSON/CSV/ZIP；校验同一事实与token。
7. 回原模块更正值，当前视图提示更新；旧快照仍显示旧值；未保存表单不被后台刷新覆盖。
8. 双主题、窄屏和键盘焦点复验；查看控制台错误与失败网络请求。
9. 对方案/记录/分析/报告至少各做一个未受影响的黄金路径回归。

关键节点截图由用户提供；agent可使用浏览器状态、DOM和控制台验证，不代为生成或宣称已有截图。无法使用浏览器时保持UI阶段未验收，不用纯渲染单测替代。

## 13. 每阶段输出模板与偏移处置

将以下内容写入当次真实会话记录，不再为每个阶段制造新的报告目录：

```text
阶段：E?
本次授权范围：
实际基线：分支 / HEAD / 存储版本
修改文件与具体入口：
完成的契约：D/I/T编号
验证：准确命令、退出码、测试数、浏览器实际操作
未验证：真实模型 / 真实课题 / 外部工具 / 其他
数据与进程：所用隔离路径、启动/关闭的测试实例
偏差：事实、影响、是否触发S编号、待用户决定
下一步：仅列已授权的下一阶段或明确阻塞
本轮提交：真实hash或“本轮无提交”
```

停点报告固定为“原要求 → 观察事实 → 无法满足的契约 → 最小需要决定的事项”；没有确凿证据不得擅自归因于旧架构。批准的例外必须记录具体范围，不能变成后续默认豁免。

阶段完成状态只有 `pending / in_progress / passed / blocked`；passed要求该阶段所有强制T与浏览器项已验，不把“实现了但没验”改名passed。E7可分别记录工程passed、真实模型blocked；总体阶段仍注明未全验。

新会话按项目规则新建会话号，不因同一项目续写旧会话。每轮先git status/log再记录，不能自行提交；已存在他人记录不重写，修正用新增说明。

## 14. 可直接复制给执行agent的启动指令

> 在遵守项目AGENTS.md和当前用户授权的前提下，阅读本合同及链接的知识库设计v0.2。本次只执行用户指定阶段，未指定则仅读合同与必要材料并报告等待阶段授权；E0包含测试和记录工作，也不能从“阅读/审阅文档”推定其执行授权。用户明确要求只读时，不以阶段收尾为由修改文件。不要重新讨论技术栈或缩减交付；按固定数据/API/UI契约和T编号测试实施。仅在白名单文件内做必要修改；遇到S停点就停止对应动作并报告，不补造真实数据、不发出未授权模型请求、不改现用实例。每阶段交付实际文件、测试/浏览器证据、未完成项与真实Git状态；不得把截图、假按钮或测试桩称作功能/模型验收。没有额外授权不得提交、推送、发布或开放外部接口。

## 15. 本轮文档交付与待执行状态

本合同在S04-T8编制，代码仅做只读核查；E0–E8、B1均尚未执行验收。本文中路径、函数和测试用例属于后续实施目标，除明确指向既有源文件者外不得描述成已经存在。

当前已完成的是：把产品设计转成固定决定、对象与关系契约、函数改造边界、原子阶段、反例测试、浏览器路线和停点规则。执行者仍须阅读代码和核实证据，但不应再自行决定“这个功能做成什么样”。
