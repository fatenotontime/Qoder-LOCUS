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

## 待补 ADR（阶段2 之后）

并发冲突的具体解决交互、跨会话暂存/恢复的存储形态、来源定位的精度门槛、AI 任务熔断参数、匿名演示会话清理策略。均**待实测或用户评审**，不预填日期。
