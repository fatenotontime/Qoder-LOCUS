# 阶段5 · 重构计划：保留/调整/新建

依据 stages/05_PROMPT.md 与 00/02–05/10。偏差记录见 [00_DEVIATION.md](00_DEVIATION.md)。
基线：git tag `pre-stage5-refactor` → `fa385f0`；用户数据副本 `sciworkbench/data/backup-pre-stage5-20261117/`（state.json + acceptance.json，gitignored）。迁移先在副本验证；不清空/覆盖用户数据；不重写 Git 历史；用户 5173 实例不碰。

## 1. 保留/调整/新建清单（据当前代码与真实页面）

### 保留（已验证，直接复用）
| 能力 | 位置 |
| --- | --- |
| Store 接口 + JsonFileStore/MemoryStore、唯一临时名原子写 | store.ts |
| 修订历史 RevisionEntry、原件完整保存、超限拒绝 | store.ts / services/app.ts |
| 网页临时 AI 配置（进程内存）、job 运行/进度/重试/原响应留存 | services/ai.ts、server.ts、data/audit/ |
| 合并写回 prepare/apply（ADR-0018） | services/app.ts |
| 表格结构解析 profile + 语料门 | services/app.ts、scripts/corpus-check.ts |
| 泳道布局纯函数 + 锚点校验（ADR-0017）、t≥ 下界 | public/lib/lanes.js、services/experiment.ts |
| 确定性时间传播 + AI 影响评估分栏、stale 守卫 | services/experiment.ts |
| 样品短号/状态追加、测量固定状态 rev、OCR 草稿→确认链 | services/experiment.ts |

### 调整（语义或结构与新产物冲突）
| 项 | 现状 | 调整 |
| --- | --- | --- |
| 导航 | 4 个材料类型入口 | 七入口（课题展示/文献整理/领域知识积累/实验方案管理/实验执行与记录/数据处理与分析/底部上下文AI对话）；课题首页先进入 |
| 文献导入 | 上传即机械拆段出草稿卡 | 上传=条目+附件归档，**不触发强制解析**；解析移到知识积累工作区由用户选文献+目的发起 |
| 机械草稿卡 | 与 AI 卡混排 | 存量 extraction:"draft" 卡明确标「机械草稿（开发调试）」，不与语义提取结果混淆 |
| EvidenceCard | 单段原文+字段 | 演进为 KnowledgeCard：研究意义单位，可引多段/表/图；数据/作者解释/模型思路分开；适用范围与未知保留 |
| 原件 hash | 加载时按 canonical 重算覆盖 | hash=导入时原始字节 sha256；另存 fingerprint=逻辑内容指纹用于查重；**加载不再重算**；存量记录保留既有 hash 不覆盖 |
| 409 拒重 | 返回已有 id 但页面死路 | 前端提供「定位已有条目/原件」跳转 |
| 执行 | 创建即 active | 增 preparation（准备稿：基础方案引用+本次差异）→confirmed 快照→recording（待补记录/数据）；准备/实际开始/暂停/完成/数据完整度分开 |
| 右栏 | 审计字段永久摊开 | 默认只露当前工作所需；历史/映射/比较/连接设置按需展开；暂藏功能登记清单（§4） |
| 表格视图 | 右栏窄表 | 可展开/最大化工作区；原始 CSV 切换；空行/占位展示层折叠并说明，原件字节不动 |
| 验收台手写件 | 许可不明网络图在 public/samples | 移出公开演示包；手写专项按实际授权单列（5D/5F） |

### 新建
| 对象/能力 | 说明 |
| --- | --- |
| PaperEntry | 题录身份：题名/作者/年份/DOI/来源/许可；≠文件；多课题可引用；收藏不强制归属课题 |
| PaperAttachment | 条目下附件：角色（正文/补充材料/其他）、版本、assetId 定位；同 DOI 不同附件/版本不互拒 |
| KnowledgeCard + 来源片段 | 语义卡：kind（数据/论据/方法/思路）、多段 sourceSpans、条件/单位/适用范围、未知；审阅三维独立沿用 |
| KnowledgeJob | 选文献+范围+研究目的发起的语义提取任务（后台，完成进待审区，不换当前审阅版本） |
| ExecutionPreparation | 准备稿：protocolRevision 引用 + 本次参数/安排差异 + 图表说明；确认后快照 |
| AnalysisTask / ContextSnapshot | 子问题必选；地图核心=直接数据+其方案/记录，候选可取消；冻结实际发送片段/版本/hash |
| ResultRevision | 外部结果提交：图/表/数据/项目/脚本+实际方法/理由；原作者/用户处理/复现标记；允许无内部 Run |
| ReportDraft / ReportBlock | 初步报告：观察/假设/解释/待核查分开，块引用结果/证据固定版本；本阶段可见 |
| ChatSession / ChatMessage | 底部上下文对话：默认课题+子问题，可明确选材料；范围可查看/调整；讨论不改对象，采纳经确认写入 |
| 课题首页 | 概览：子问题、进展、待办、进入相关材料/实验/分析；最小创建沿用 |
| 干净验收入口 | 原：独立介绍页（acceptance.html）。**2026-11-17 覆盖**：验收直进主页面，材料导入并入课题展示常驻折叠区；逐附件许可/署名清楚的真实公开论文条目＋可导入材料（非仅方法节选）；干净模式与一键演示分开 |

## 2. 对象关系（共同对象，不复制）

```
Topic ─< Subquestion
PaperEntry ─< PaperAttachment >─ SourceAsset（文件归档/定位/修订共用）
PaperEntry ─< KnowledgeCard（sourceSpans→attachment+定位）
TopicEvidence（课题重要性/备注，分课题） / Adoption（任务采用，分任务）
ProtocolRevision（步骤稳定 id）─< ExecutionPreparation ─确认→ Execution（快照引用固定 rev）
Execution ─< Session/Events、Sample ─< SampleState、Measurement（固定状态 rev，cellRef→表格）
AnalysisTask（必选子问题）─ ContextSnapshot（冻结引用版本+片段+hash）
AnalysisTask ─< ResultRevision（runRef 可空=外部）─< ReportBlock ─ ReportDraft
ChatSession（上下文=明确选择的对象版本；采纳→目标对象修订）
```
文件归档/定位/修订共用 SourceAsset 机制；**业务状态不混用**：文献卡≠测量读数≠方案步骤。

## 3. 数据迁移 v5→v6（先副本验证）

- 新增实体补空数组；既有实体不丢。
- 存量 literature 资产 → 自动生成 PaperEntry（题名=文件名，来源/许可=未提供）+ 正文附件；原 assetId 不变，卡仍指 assetId，另补 paperId 关联。
- 存量卡 extraction:"draft" → 标 mechanical:true（展示「机械草稿」）；audit/importance/history 不动。
- assets.hash 保留既有值（历史口径=逻辑内容），fingerprint 补为同值；**不再加载重算**。新导入 hash=原始字节。
- executions 补 preparation:null、phase:"recording"（存量即视为已开始记录，不虚构准备过程）。
- 验证：副本 load→save→load 幂等；实体计数与关键字段逐一对比；用户 state.json 本体只在用户实例重启时经同一迁移代码路径，不手工改写。

## 4. 暂藏功能清单（5B，随实现更新；前端协作依据）

| 功能 | 模块 | 当前是否实现 | 入口/展开方式 | 后续呈现 |
| --- | --- | --- | --- | --- |
| 卡片修订历史明细 | 知识积累 | 已实现（底层） | 卡详情「历史」展开 | 保持按需 |
| 命名映射/比较快照 | 知识积累 | 已实现（4B） | 「比较」抽屉 | 独立工作面板 |
| 组审预览+ack | 知识积累 | 已实现 | 批审时弹出 | 保持 |
| 影响分析依据/发送清单 | 方案/执行 | 已实现 | 「依据」展开 | 保持 |
| AI 重排 | 实验图 | **未实现**（禁用占位） | 禁用按钮+明示 | 待技能/需求 |
| Zotero 实时连接 | 文献整理 | **未实现/未验证** | 说明文字，不做假按钮 | 验证后单列 |
| 记录模板 AI 生成 | 执行 | 已实现 | 模板区展开 | 保持 |
| Word/追溯包导出 | 报告 | **未实现**（阶段6） | 导航明示未实现 | 阶段6 |
| 原始响应审计 | 全局 | 已实现（data/audit） | 任务详情「原始响应」 | 保持授权区 |

## 5. 交付顺序（每段可操作链，应用/接口/存储/前端同步）

1. **第一段（尽早供实测）**：store v6 + 课题首页 + 七入口导航 + 文献整理工作区（条目/附件/题录导入）+ 领域知识工作区（语义提取任务→待审→沉淀，机械草稿标记）。
2. 第二段：方案直解入口 + 执行准备/快照/待补记录状态 + 图沿用。
3. 第三段：分析任务/上下文地图/建议/外部结果提交/初步报告。
4. 第四段：上下文对话 + 采纳确认。
5. 第五段：页面简洁化收尾、表格大视图、干净论文验收入口（**2026-11-17 覆盖**：主页面常驻验收材料区，删除独立介绍页）、暂藏清单定稿。
6. 验收：T01–T18 继承回归 + 新链行为实测 + 有界远端真调用（需授权）+ 三档报告。

## 6. 边界重申

技术栈按实际需要（零依赖不再是约束，但当前栈够用则不换）；不读旧私人仓库；不扩大成相邻工作区改造；Pro 建站仍在阶段6后；不擅自公开发布/付费/改服务器；私人 SRTP 材料不进公开物；密钥纪律沿用。