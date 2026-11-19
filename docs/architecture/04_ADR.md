# 阶段2 · ADR 记录

> 只写**已作决定**与依据，不虚构日期或"已通过"。状态：`accepted` / `proposed` / `pending`（待实测/待用户）。

| 编号 | 决定 | 状态 | 依据 |
| --- | --- | --- | --- |
| ADR-0001 | 独立竞赛仓库 `F:\Qoder dev competition`，**不复用**旧 personal/release | accepted | 01_SYSTEM_PROMPT；sources K01；stage0 报告 |
| ADR-0002 | 旧仓库**只读冻结**，不纳入竞赛仓库（无 `.git` → 不能依赖 Git 回滚） | accepted | WB-002；stage0 保护清单 |
| ADR-0003 | 记录主线 = **Git 提交历史**，并行分支**双线记录** | accepted | 用户要求；`AGENTS.md` |
| ADR-0004 | **Pro / Sites 实测时机 = 阶段6 之后**，随后持续开发；阶段1–6 本地可逆为主 | accepted（用户 2026-11-16） | 用户明确纠正；stage0 §八 |
| ADR-0005 | **领域层纯函数、零依赖**，与技术栈解耦；骨架用 TS(Node 类型剥离)+`node:test` | accepted | 03 不预选框架；避免换栈丢语义 |
| ADR-0006 | 运行存储架构：接口 + 可替换实现；**服务端私有校验**；具体后端（Sites DB/对象存储 vs ECS）**待实测** | proposed | 04 §B；ENV01–03 |
| ADR-0007 | 实体/版本与原件策略：稳定 id + 追加式 revision；引用固定 revision；原件不覆盖 | accepted | 03 §对象与版本 |
| ADR-0008 | 影响传播**边类型**：lineage(数据链) 与 support(科学依据链) 分开；provenance/affiliation 亦区分 | accepted | 10 §四；LIN01 |
| ADR-0009 | 确定性传播 + AI 语义评估**分栏**；AI 不重复猜数学；失败≠无影响 | accepted | 03 §Edit Impact |
| ADR-0010 | 模板复用：通用规范 + 按方案版本生成专用模板，**人工确认后复用**（首次引用解析） | accepted | EXP03 |
| ADR-0011 | 解析/模型服务选型：开发=DeepSeek；**运行模型与服务未定** | pending | Q06/ENV07 |
| ADR-0012 | 会话身份与 API 额度：Key **不持久化/日志/Git**；匿名演示隔离与免配额方案**未定** | pending | E07/Q04/Q05/ENV06 |
| ADR-0013 | 报告引用/外部编辑边界：块级明确引用；对话默认只讨论；**外部 Word 编辑不∈审计** | accepted | REP02/REP04 |
| ADR-0014 | 导出恢复：固定快照 + 依赖索引/复核状态 + 许可过滤附件；**隔离恢复验证待做** | proposed | REP04；M07 |
| ADR-0015 | 公开数据许可策略：**逐附件**核许可；DaRUS 三案 CC BY 4.0 且 approved 限范围；**不得以项目默认许可覆盖 All Rights Reserved** | accepted | 09/SAMPLE_REVIEW；OSM 教训 |
| ADR-0016 | 三业务路径/两事件在应用服务层分离；共领域模型，不共"导入"入口 | accepted | 用户纠正；`05_DATAFLOW_WALKTHROUGH.md` |
| ADR-0017 | 实验图=**横向时间泳道**：支路加 `branchFrom`/`mergeInto` 锚点（追加式可选字段，须指向同快照主线步骤、分叉在汇合前）；未指定锚点明示不猜；**未知时长不按零累计**，其后偏移为下界 t≥；布局模型为纯函数 `public/lib/lanes.js`（浏览器/测试共用） | accepted（用户 2026-11-16 实测反馈） | S02-T10；`tests/diagram-lanes.test.ts` |
| ADR-0018 | AI 后台 job **合并写回**：请求时同步校验/查重，AI 计算与 state 写回分离；完成时对**最新** state 只追加本 job 新实体，查重复检，等待期同内容已入库则丢弃结果并指向已有原件；409 附 `existingAssetId` | accepted（用户 2026-11-16 实测反馈） | S02-T10 反例复现；`tests/job-race.test.ts` |
| ADR-0019 | 实验图**以用户提供的 experiment-archify v0.4 草案为规格**（应用内实现通用合同 `docs/stage5/05_EXPERIMENT_ARCHIFY_CONTRACT.md`）：**不安装**上游 tt-a1i/archify、**不冒充**其 native finalize；**AI 重排不接入**（依 `03_DOMAIN_RUNTIME`）；技能原文/过程日志/私人案例参数**不入公开仓库** | accepted（用户 2026-11-18 拍板"要接"→提供草案路径） | 合同 10 条对照：6 符合 / 4 部分 / 1 未实现（见该文档） |

| ADR-0020 | 分析初稿**块化**：报告从固定四类 `sections` 改为**有序块** `blocks`（`order`＋`nature`∈观察/假设/解释/待验证/人工判断＋固定 `refs`〔kind/id/version〕＋`draft` AI 草稿标记＋块内 `history`）；**块级 diff 预览→接受→新版本**（`preview` 不改状态，`apply` 以 `baseRevision` 乐观并发，不符返回 **409＋currentRevision**，不覆盖新结果）；AI 草稿 `draft=true` 须人工 `confirm`；store **v8**，v2–v7 迁移把旧四类按序展开为块（旧自由文字来源记为 `note` 引用，修订号不变、幂等） | accepted（阶段6 6A-1） | `03_DOMAIN_RUNTIME` §对象/§报告块；`01_DOMAIN_SCHEMA` ReportBlock；`tests/analysis.test.ts`、`tests/web-loop.test.ts` |

| ADR-0021 | 阶段6 **6A-2/6A-3/6A-4/6A-5**：①**真实引用网络**由 state 的**实际引用字段**确定性建边（affiliation/provenance/lineage/support），`traverseNetwork` 按关系类型且可限方向/类别——回查是**网络非串联链**；分析结果一律标 `external` 明示**无内部 Run**。②**改动命中**：`classifyChange` 区分科学改动（value/unit/criteria/…→needs_review）与标题/备注（→no_recompute 不误报），`changeHits` 给下游报告块/结果/分析的**具体复核对象**。③**导出**：零依赖 ZIP（deflate）＋最小 DOCX（Word 可打开；块顺序/性质/固定引用清单）；**外部 Word 编辑不回流为审计**。④**追溯包**：版本索引（固定版本）＋**逐附件许可过滤**（CC BY/CC0/PD 可，NC/ND/未标排除并登记）＋sha256 manifest＋NOTICE。⑤**整体导出＋隔离恢复**：包内含 manifest；`loadStrict` 损坏/未知版本**显式报错**（load 仍宽容），恢复写入**临时隔离文件**、**绝不覆盖主数据** | accepted（阶段6） | 03_DOMAIN_RUNTIME §报告/§ADR；ADR-0013/0014/0015；`tests/references.test.ts`、`tests/export.test.ts`；DOCX 经 office-docx 读回 9 块校验 |

| ADR-0022 | 证据卡**排除原因改为可选填**（2026-11-18 用户拍板，前端纠偏第 2 步）：`reviewCard` 的排除不再强制原因；改关键文本/抽取字段/标记转引**仍须原因**。上下文地图的候选改为**仅取自「已入候选」**（`audit=confirm`）；「任务采用」后端 `AdoptionRecord` **保留**但不再有前端入口 | accepted（用户 2026-11-18） | `services/app.ts`；`tests/web-loop.test.ts`；用户前端纠偏反馈 |

| ADR-0023 | 阶段6收尾 B：知识抽取**暂停/继续**——逐块流式任务可暂停（保留已出，任务 `paused`，运行句柄保留），`isDone` 跳已完成块后续跑补完（重跑去重，不重复入库）；前端 AI job **并发上限 1**，超出显示「排队中」 | accepted（用户 2026-11-19） | `services/ai.ts`、`server.ts`、`txt`前端；`tests/ai-stream.test.ts` |

| ADR-0024 | **模型设置：后端 Key 落盘 + 可用模型测试 + 入口移到左下角**（2026-11-19 用户拍板）。①配置**落盘**到本机数据目录 `<数据目录>/ai-config.json`（`sciworkbench/data/` 已被 .gitignore 覆盖，含 Key 明文、文件权限 0600；不入 Git/日志/导出），启动时读回（**环境变量优先**，其次文件）；POST `/api/ai/config` 保存即写盘、DELETE 即删盘。②新增 `POST /api/ai/models`：`GET {baseUrl}/models` 返回**可用模型列表 + 联通性**（Key 无效/地址不通/不支持分别明示）。③入口从顶部横幅移出，改为**左栏左下角「模型设置」按钮 → 设置抽屉**。**修订 ADR-0012**：Key 由「不持久化」改为「**本机落盘**、仍不入 Git/日志/导出」 | accepted（用户 2026-11-19） | `services/ai-config.ts`、`services/ai.ts`、`server.ts`、`public/index.html`、`public/app.js`；`tests/ai-config.test.ts` |

| ADR-0025 | **archify 缺口 A/C/E**（2026-11-19 用户拍板补做，合同 `docs/stage5/05_EXPERIMENT_ARCHIFY_CONTRACT.md`）。**A**：时长第2类「由量·速率计算」——`ProtocolStep` 增 `durationSource`(fixed/computed/estimated/unknown)＋`amount`＋`ratePerMin`，`computed` 时 `durationMin=用量÷速率`；速率缺失/非正→未知（**不猜**）。**C**：确定性时间传播**等待余量先吸收延迟**——`ProtocolStep` 增 `slackMin`，`computeTimeShifts` 在该步先吸收累计平移再下传，余量不足部分吸收，note 明示吸收量。**E**：实验图**导出本地 HTML**（自包含内联 CSS，离线可看）与 **PNG**（`SVG foreignObject`→`canvas` 栅格化，2×，无第三方库）。合同条款2「节点邻近编辑」仍**不做**（合同不强制） | accepted（用户 2026-11-19） | `store.ts`、`services/experiment.ts`、`public/lib/lanes.js`、`public/app.js`；`tests/archify.test.ts` |

| ADR-0026 | 记录页「意外影响到哪一环节」由**单选改多选**（2026-11-19 用户拍板）：一次意外可勾选多个受影响步骤；仍记为**一条** `deviation` 事件（文本列出全部受影响步骤），不改源方案 | accepted（用户 2026-11-19） | `public/app.js`（`stepsTableHtml`）；HANDOFF 遗留项结案 |

| ADR-0027 | **上下文地图只读接口（后端）**（2026-11-19 用户拍板；提示词原写 ADR-0024，编号已被占用改 0027）。新增 `GET /api/analysis/map`（建任务前，按 `pick` 推导）与 `GET /api/analysis/tasks/:id/map`（任务当前选择）；返回 `{scope,nodes(role:core/selected/optional/context),edges,gaps,truncated}`。**节点/边一律来自 `buildNetwork`**（不补造、不新增边类型、同课题≠连线）；**必选自动推导后端化**为纯函数 `deriveCore`（测量→样品→执行→方案），与前端既有逻辑结果一致，**前端旧推导暂留**（待地图界面接入后再删）；可选对象类型＝`resolveFragment` 支持的 kind；只读（不写 state/不 save/不起 job）；节点上限 300，超出 `truncated`；`topicId` 缺/不存在→404，`pick` 坏→422 | accepted（用户 2026-11-19） | `services/context-map.ts`、`server.ts`；`tests/context-map.test.ts` |

## 待补 ADR（阶段2 之后）

并发冲突的具体解决交互、跨会话暂存/恢复的存储形态、来源定位的精度门槛、AI 任务熔断参数、匿名演示会话清理策略。均**待实测或用户评审**，不预填日期。
