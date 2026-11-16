# 阶段2 · 新版 Web 架构（LOCUS）

> 依据：03_DOMAIN_RUNTIME（行为契约）、02_CURRENT_DECISIONS、10_PRODUCT_DESIGN_NARRATIVE。本文是**设计与骨架**，不是"已上线/已验证"声明。云/Pro 实测在**阶段6之后**。

## 1. 目标与边界

- 目标：围绕**研究问题**保存对象、材料、操作与判断之间**可解释的关系**，在具体工作时把合适上下文交给 AI，并让**原始→结果→报告**可追溯、可复核。
- 不造：公共 SaaS/会员/支付；不重建 Origin/MATLAB/DFT 平台；不把私人 Locus 的数据/服务接入。
- 交付物优先级：**真实可用闭环 + 可解释工程** > 功能数量。

## 2. 分层（依赖方向单向向下）

```text
视图层 (View)        页面/组件；只读领域 schema，不直接碰存储
接口层 (API)         HTTP / Function 路由；鉴权、幂等键、错误码
应用服务层 (App)     用例编排：审阅、冻结上下文、运行、传播、导出
领域层 (Domain)      ★纯函数、零依赖、可单测★：实体/版本、双链、确定性传播、回查、影响状态机
存储适配层 (Store)   接口 + 可替换实现（本地内存 / Sites DB / 对象存储）；私有数据服务端校验
```

**红线**：`Domain` 不 import 框架/存储/网络；实体引用固定 `revision`，不依赖全局 `latest`；不通过共享目录耦合。

## 3. 三条业务路径与两事件的架构落点

- 路径 = 应用服务层的**三个用例族**：`lit.*`（文献建库）、`protocol.*`（方案解析）、`data.*`（实验数据核对）。三者共用 Domain，不共用同一个"导入"入口。
- 事件 = `data.importPublic()`（产来源/证据）与 `exec.start()`（产 Execution/Session）。**不同用例、不同产物**。
- 边界细节以 `prompt/…/12_DOMAIN_BOUNDARIES.md` 为准：`EvidenceCard` **文献专用**；导入公开数据**不伪造**本地执行/样品。

## 4. 关键机制（见 03 契约）

| 机制 | 落点 |
| --- | --- |
| 实体/版本/修订 | Domain `types.ts`（id+revision；追加式修订） |
| 双链（数据链+科学依据链） | Domain `graph.ts`（edgeKind: lineage/support/provenance/affiliation） |
| 确定性传播 | Domain `impact.ts`（按变更类型分流，不靠 LLM） |
| 按类型回查 | Domain `backtrace.ts`（多原型，非单链） |
| 影响分析状态机 | Domain `impact.ts`（pending/running/completed/failed/stale；失败≠无影响） |
| 上下文快照 | Domain `types.ts#ContextSnapshot`（固定 revision + 快照 hash） |

## 5. 部署目标（阶段6后实测，现在不锁定）

- 首选：**Qoder Sites**（静态前端 + 一个 `app` Function；按需 DB/Storage/Secrets）。**Pro 实测在阶段6之后**。
- 备选：ECS（仅当平台能力实测不足，需用户批准）。
- 现在只保证：**领域层与技术栈解耦**，换栈不丢产品语义。

## 6. 与旧版（Gradio「研迹」）的关系

继承**思路**（记录索引/事件、原件哈希+初稿确认、运行输入输出、上下文组合），**不继承**其技术栈与本地单机假设（见 `docs/stage0/01_KNOWLEDGE_BASE.md` §8：local-first 是私人版设计原则，竞赛版需重设计）。

## 7. 需求ID 覆盖

对齐 02 编号：TOP/EXP/ARC/OCR/LIT/ANA/REP/LIN/DEMO；契约落点见 `01_DOMAIN_SCHEMA.md`、`02_API_CONTRACT.md`、`03_AGENT_RUNTIME.md`；决策见 `04_ADR.md`。
