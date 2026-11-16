# 阶段0 · 结构化知识库

> 来源：指令包 00–10 + sources（权威）＋ 旧仓库只读盘点（证据）。
> 证据等级标：`[已核]`=本轮实测/读到源码；`[文档]`=指令包声明；`[待验]`=未实测。

## 1. 最新决议覆盖旧记录表

| 主题 | 旧状态（sources/早期） | 最新决议（00 覆盖，以此为准） |
| --- | --- | --- |
| 账号套餐 | Free，可买 Pro；优先 Free+S​​ites | **已有 Pro，不再让用户充值/按 Free 删功能**；先核实 Pro 原生动态能力，ECS 仅备选 |
| 第三议题（文献） | 部分"待讨论/未确认" | **此前确认内容全部视为已决**，不重开 |
| 数据处理定位 | 待讨论数据处理范围 | 收束为**分析任务与结果管理**，专业计算交外部软件；不重建 Origin |
| 实验图版本 | 曾退回 v01 长解释/弹窗/推迟滑块 | **固定 v03 初版**：主线直行、节点箭头、下方固定编辑区、AI 重排仅占位 |
| 影响分析 | 仅记录修改原因 | **新增必做**：编辑后显眼"AI 影响分析"区，判断有影响/无依据/待确认+原因；模型失败不得显示"无影响" |
| 五步/任务拆分 | 六任务曾混成五步 | 方案拆分/上下文地图/外部结果/局部初稿/实际五步**按最新文件**，不硬凑五步文案 |
| 母样/污染子样 | U08/U09 复杂返并设计 | **收窄**：母样可改可备注，不围绕污染子样建复杂引导；原始材料不覆盖 |
| OCR 定位 | 曾被说成"缺失" | 旧实现**已有**原图+哈希+原始响应+初稿+确认稿+审计，`[已核]`；只是本地，非 Web |
| AI 重排 | 初版曾含 | **本轮仅占位**，不接入 |
| Repo Wiki | — | **暂缓**（尚无代码） |
| OSM 许可 | "打不开" | 档案可读但 **All Rights Reserved**，不能以项目默认 CC BY 覆盖 |

## 2. 领域对象（03 §对象与版本，`[文档]`）

| 对象 | 最小语义 |
| --- | --- |
| Topic/Subquestion | 名称/研究问题、可选依据/目标/未知/设计、主从关系 |
| SourceAsset | 原文件 hash、mime/大小、来源 URL/版本/许可、授权范围、私有位置、解析状态 |
| EvidenceCard | sourceRevision、定位、原文、抽取字段/条件/单位、不确定/缺项、核对状态 |
| TopicEvidence | 卡引用、课题重要程度/备注（≠全局事实） |
| EvidenceAdoption | 任务引用、采用/排除与理由、固定证据版本 |
| NameMapping/Comparison | 原名/映射/来源依据；输入快照、筛选、换算、排除、分歧分类、未决 |
| ProtocolRevision | 目的、输入/操作/输出/条件/来源片段、完成判据、未知；图与表单同数据 |
| RecordTemplateRevision | 对应方案版本、通用规范版本、AI 草稿、人工确认、字段与步骤定位 |
| Execution/Session | 固定方案/模板、实际过程层、步骤事件、补录时间、暂停状态与恢复事实 |
| Sample/SampleState | 稳定短名、来源执行/母样、状态版本、量/单位/估计性质、处理/用途/备注 |
| Measurement | 样品状态、时间/方法/仪器条件、原文件引用、原始/确认数据、独立重复 |
| ContextSnapshot | 选择范围、实际片段/引用版本/摘要、目的、快照 hash、敏感边界 |
| AnalysisTask/Run | 子问题、固定上下文、建议/实际方法软件版本、参数、输入输出、状态与失败 |
| ResultRevision | 原作者/复现标记、图表/数值/项目文件、运行引用、核查范围、待补 |
| ReportBlock/Revision | 内容及顺序、明确引用与上下文清单分开、草稿/假设/人工结论、局部修改历史 |
| DependencyEdge | fromRevision/toRevision、关系类别、定位、由何运行建立（非全靠 LLM） |
| ChangeSet/Review | 修改前后、原因、实际受影响对象、复核状态/人工动作与版本 |
| ImpactAssessment | AI 分析，不覆盖确定性传播 |
| ExportSnapshot | 选中报告/结果/依赖版本、复核清单、可分发附件、hash manifest |

公共规则：稳定 id + revision；引用固定 revision 而非 latest；版本冲突返回可恢复冲突；删除分撤回/归档与数据删除；首次确认须原件+原响应+草稿+确认稿一致提交，失败不得产生已确认态。

## 3. 模块地图与需求编号（02）

| 模块 | 编号段 | 一句话 |
| --- | --- | --- |
| TOP 课题与样品 | TOP01–05 | 课题=名称+问题最小创建；样品/母样/分样/测量独立，历史不被篡改 |
| EXP 方案·现场记录·拆分执行 | EXP01–05 | 方案版本与执行分离，实际层可原位改，跨会话暂存/恢复 |
| ARC 实验图·影响分析 | ARC01–09 | v03 图交互 + 新增显眼 AI 影响分析 + 可跳过执行条件选项卡 |
| OCR 数据记录 | OCR01–02 | 原件归档建关系，分类评测数字/单位/错列，空输出不入正式 |
| LIT 文献与领域库 | LIT01–12 | 抽取/审阅/采用三分，重复拒收，原文回查，比较固定快照 |
| ANA 上下文地图与外部分析 | ANA01–05 | 不造专业软件，地图选范围+固定快照，结果多次提交版本 |
| REP 初稿·对话·导出 | REP01–04 | 局部 diff 接受才新版本，Word+追溯包 |
| LIN 贯穿影响链 | LIN01–05 | 数据链+科学依据链双链，具体影响路径 |
| DEMO 五步与样本 | DEMO01–05 | 首页测试包，五步实测，团队名 LOCUS |

## 4. 四类关系（10 §四，切勿混为"关联"）

1. **组织归属**：属哪个课题/子问题/执行（帮查找，不证明结论用了它）。
2. **来源溯源**：内容从哪来、经过什么转换（原文→抽取→标准化→人工修订分开）。
3. **处理依赖**：结果实际用了哪些输入、怎样得到（由实际处理建立，非事后 AI 猜）。
4. **科学支持**：观察/解释依靠哪些证据及条件限制（须明确引用 + 人审，不能"模型读过"替代）。

## 5. Agent Runtime（03 §Agent Runtime）

- 任务类型：文献解析/抽取、命名与比较、方案拆解/模板、暂停风险建议、方法建议、结果解释、报告块、编辑影响分析。**AI 重排不接入**。
- 流程：明确触发→固定 ContextSnapshot→schema 约束提示词→服务端调用→原响应留存→结构/来源校验→草稿入队→人工动作。
- 状态：queued/running/succeeded/failed/cancelled；复核状态另存；succeeded ≠ confirmed。
- 重试幂等、过期响应不覆盖当前编辑、文档内指令视为不可信数据。

## 6. 旧仓库盘点（证据，`[已核]`）

**身份**：旧项目 = 「研迹 · Research Ledger」（LOCUS 前身），Gradio 桌面应用。
**物理**：`E:\GLM工作区\sciworkbench\intergration\research workbench\`
- `personal/`（独立仓库；**当前无 `.git`**，仅文件快照）— 本轮盘点对象
- `release/`（打包版：PyInstaller onedir + Inno Setup；同样无 `.git`）
- 顶层治理文档：ARCHITECTURE/DECISIONS(WB-001~008)/STATUS/AGENTS.md

**personal/ 模块清单（约 7800 行 + 45 测试文件）**

| 模块 | 行数 | 职能 | 证据 |
| --- | --- | --- | --- |
| app.py | 2638 | Gradio UI：实验记录/研读日志/科研助手/数据处理/文献管理/模型设置 | `[已核]` |
| note_parser.py | 401 | OCR 草稿解析→normalise→audit→`save_confirmed_record`（原图副本+sha256+原始响应+初稿+重构稿+确认稿+audit_warnings） | `[已核]` |
| experiment_records.py | 250 | 正式记录只读索引 + `events.jsonl` 追加事件 + trash/restore + rename | `[已核]` |
| data_processing.py | 259 | AST 白名单校验 + subprocess 受限 runner（safe_builtins、NO_PROXY、timeout） | `[已核]` |
| literature_library.py | 636 | 文献库 CRUD、引用格式(BibTeX/RIS/GB-T7714)、标签组 | `[已核]` |
| bibliography_import.py | 330 | Zotero RDF/XML、EndNote XML、RIS 解析 | `[已核]` |
| model_providers.py | 312 | Ollama / OpenAI Responses / ChatCompletions 适配 | `[已核]` |
| model_settings.py | 350 | 预设+会话 Key（不落盘）+历史去重 | `[已核]` |
| vision_pipeline.py / _preprocessing / _regions / _benchmark | 280/208/132/238 | 视觉识别管线（整页→聚焦复核→安全合并）、预处理、区域、benchmark | `[已核]` |
| plugin_registry.py / plugin_inspector.py / plugins/ | 197/174/5 插件 | 插件体系：bibtex/cnki/csl_json/doi_normalizer/anthropic_provider | `[已核]` |
| research_assistant.py / research_context.py | 70/162 | 科研助手 + 上下文组装（ContextBundle） | `[已核]` |
| zotero_connector.py / endnote_export_connector.py | 165/103 | 本机 Zotero API(127.0.0.1:23119)、EndNote 导出文件 | `[已核]` |
| literature_deduplicator.py / _metadata_validator.py | 101/75 | 去重、元数据校验 | `[已核]` |
| research_journey.py / record_manager.py / note_output.py | 158/106/98 | 研读日志、记录管理、XLSX/CSV 导出 | `[已核]` |
| config.py / launcher.py / theme.py / reference_connectors.py | 88/88/89/93 | 设置、loopback 启动器、主题、连接器候选 | `[已核]` |

## 7. 可继承思路（K02，`[已核]` 对应源码）

- 课题与证据/修订的组织方式 → 对应 03 的 Topic/EvidenceCard。
- 记录表格索引 + append-only 事件（`events.jsonl`） → 对应 Execution/Session + 事件轨迹。
- 原图哈希 + 模型初稿 + 确认稿 + 审计告警（`save_confirmed_record`） → 对应 SourceAsset/Draft/Confirmed。
- 处理输入/运行/输出（`processing.json` + artifacts） → 对应 AnalysisTask/Run/ResultRevision。
- 上下文组合（`ContextBundle`/`build_context`） → 对应 ContextSnapshot 思想（旧版无 hash 固定）。
- 模型适配层（Provider Protocol） → 对应"模型适配统一接口"。
- 插件注册/检查（parser/exporter/provider） → 可继承的解耦思路。

## 8. 架构缺陷与失败案例（`[已核]`，逐条带证据）

| 缺陷/失败 | 证据 | 新版要求 |
| --- | --- | --- |
| 正式记录无不可变 revision 链 | `note_parser.save_confirmed_record` 把 confirmed 直接写入 `record.json`；`experiment_records.rename` 原地覆盖 record.json | 03：修订需生成新 revision，不原地覆盖 |
| 受限执行非 OS 级沙箱 | `data_processing.py` 自述 "not an OS-level sandbox"；AST 白名单 + subprocess | 03：不得把本地 AST 限制搬上公共后端冒充系统隔离 |
| 本地单用户，无服务端权限模型 | loopback-only（ARCHITECTURE WB-001），无跨访客/身份 | 04 ENV04/M03：普通访客隔离、服务端校验 |
| 无持久化后端/Cloud | local-first，data/ 本机目录；无 DB/对象存储/函数 | 04：Pro 动态能力或 ECS 需实测 |
| 技术栈 Gradio 桌面 | app.py 全程 gr.Blocks | 01：技术栈不因旧 Gradio 锁死 |
| 视觉 benchmark 证据不足 | README：单样本 60.4%–76.7%；ARCHITECTURE 标 `partial` | WB-006：分类证据 + 人工复核负担，不以单一准确率 |
| 无摘要/定位强制 | 上下文组合为文本拼接，无区域定位 | LIT06：原文可回查（页/区/表行列） |
| 依赖本机外部软件 | Zotero/EndNote 连接器依赖本机进程与固定路径 | 09/DEMO：评委无需装专业软件 |
| 版本/依赖未显式 | 无 DependencyEdge 模型 | LIN01：稳定 ID+revision |
| 交付物未含公开 benchmark | STATUS：无独立留出集 | 05 Benchmark：开发/留出分离 |

## 9. 边界与红线（贯穿）

- 私人 SRTP/导师/学校材料**不得**进入公开提示词、Git、截图、测试、站点、样本（D01/U 系列）。
- 公开样本仅用 approved 的 DaRUS 三案（见 04_VERIFY_ITEMS）。
- 密钥不进前端构建/持久存储/Git/普通配置/日志。
- 旧仓库只读；不清理、不提交、不搬迁、不混入竞赛提交。
