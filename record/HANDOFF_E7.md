# E7 交接（进行中：E7-A 服务层完成）

> 范围：知识库防偏移执行合同 **E7 内置AI统一输入与外部文件实测**（§10 E7；判据 T41–T45＋既有 review/contract-roundtrip 回归）。
> 状态：**E7-A 服务层＋模拟验证 = 已完成**（代码 `a3a27dc` · 2026-11-21 23:28，PR #18 merge `9908c9a` · 23:31）；**E7-B UI 接线 = 阻塞（等前端）**；**真实模型与外部工具 = 阻塞（S03 单独获准）**；E7 整体**未 passed**。
> 依据：合同 §10 E7（「模拟 AI 部分先验，真实模型与外部工具另按 S03 获准后验」）；过程见 [会话记录 S05-T10](sessions/2026-11-21_session-05.md#s05-t10) 与 [台账 #97](COMMIT_LEDGER.md)。

## 一句话状态

**AI 输入的"科学与引用纪律"已落到服务层**：核心/可选一律来自同一条 `readKnowledge` 读取；只送**固定版本且过正式门槛**的内容；待审内容只有在**探索模式**并带标记时才进入；超预算**明确要求缩小**而不偷偷截断；模型返回的引用**必须落在本次快照内**，否则标 `invalid` 且不能自动写进正式报告/知识；人工采纳只落**待审**候选。UI 接线（分析/聊天页）与真实模型/外部工具实测未做。

## 本轮落点（E7-A）

| 文件 | 承担 |
| --- | --- |
| `sciworkbench/services/analysis.ts` | `buildKnowledgeAiInput`／`validateAiReferences`／`adoptAiProposal`／`exportSelectedPackage` |
| `sciworkbench/tests/knowledge-pipeline.test.ts` | **T41／T42／T43／T44／T45** ＋ 选定包下载（模拟，无外发） |

## 关键口径（勿在 E7-B/E8 改回）

- **核心来源唯一**：核心/可选都由 `readKnowledge` 产生；**不**另建一套选择逻辑；卡壳不单独计为知识（item 走固定版本）。
- **正式 vs 探索**：正式模式只放行「被引用版本已确认、当前非撤回/排除」的固定版本（与 E6.5② 修正一致）；`explore` 才允许待审进入并**显式标记**，且不得进入正式推荐/报告。
- **快照冻结**：`snapshotHash` 覆盖 scope/mode/固定引用/实际 payload；同输入同 hash，便于复查与复现。
- **不静默截断**：超预算 → `requiresShrink=true` ＋ `notes`；(E7-B 可据此提供分页/缩小入口)。
- **引用校验**：`validateAiReferences` 只认本次输入快照内的 `id@revision`；无版本号也判 `invalid`（不允许 latest 兜底）。
- **采纳即待审**：`adoptAiProposal` 落 `pending` statement；无效引用直接 422 `ai_reference_invalid`。

## 未做（如实）

- **E7-B UI 接线**：合同 §10 E7 的 UI 面在分析/聊天页，而全站页面重构由前端负责（E6.1）；等交付后再接（届时按 E6.4 接入表同样的方式先填实）。
- **真实模型/外部工具**：仅在本机由用户按 S03 单独授权后验证；T45 本轮只证「同源结构科学字段一致」，**不能声称外部文件工具兼容性已验**。
- §12.2 容量未测；E6-B 未开工。

## Git

- 分支 `feat/s05-e7-ai-input`（自 main `83e8365`）：代码 `a3a27dc`（23:28）、记录 `7d632f3`（23:29）；**PR #18 已以 merge commit `9908c9a`（23:31）合入 main**（台账 **#97** 已回填；编号避让 S04-T12–T14 的 #94–#96）。
- 审计口径同前：全绿、范围与标题一致、无敏感文件。
