# sciworkbench — LOCUS（三栏结构化 Web · 本地开发版）

零依赖工程。设计见 [`docs/architecture/`](../docs/architecture/)；**三栏页面与协作交接见 [`docs/stage4/10_FRONTEND_HANDOFF.md`](../docs/stage4/10_FRONTEND_HANDOFF.md)**；阶段3 闭环见 [`docs/stage3/01_WEB_LOOP.md`](../docs/stage3/01_WEB_LOOP.md)。

界面：**左栏** 课题/子问题/材料与导入 · **中栏** 原始材料（可高亮定位）· **右栏** 结构化结果与核对。

## 运行

```bash
cd sciworkbench
node server.ts                 # 最小 Web 闭环 → http://127.0.0.1:5173
node --test "tests/*.test.ts"  # 契约测试（81 项）
```

要求 Node ≥ 22（本项目 Node 24 实测）：原生 TypeScript 类型剥离 + `node:test`，**无需安装依赖、无需构建**。

## 结构

| 文件 | 内容 |
| --- | --- |
| `server.ts` | 零依赖本地 HTTP 服务：静态托管 + REST（前端协作接口） |
| `store.ts` | **可替换存储**（`Store` 接口 + `JsonFileStore`/`MemoryStore`）与 DTO |
| `services/app.ts` | 用例层：文献证据路径 与 实验数据路径**分开**（导入/核对/保存/原件回查/修订历史） |
| `services/ai.ts` | OpenAI 兼容 AI：**三个独立任务**（文献抽取/方案解析/手写识别）；配置仅进程内存 |
| `public/` | 最小前端（`index.html`/`app.js`/`styles.css`/`lib/api.js`），设计变量在 `:root` |
| `domain/types.ts` | 实体与版本（稳定 id + 追加式 revision、固定 revision 引用） |
| `domain/paths.ts` | **三业务路径** + **两事件** |
| `domain/graph.ts` | 关系网络：lineage / support / provenance / affiliation |
| `domain/impact.ts` | **确定性传播** + **影响分析状态机**（失败≠无影响、stale 不覆盖） |
| `domain/backtrace.ts` | **按类型的回查链原型**（不是一条固定串联链） |
| `domain/topic.ts` | 课题/子问题最小创建、按任务查缺项 |
| `domain/literature.ts` | 文献证据卡四维审阅、候选库状态、组审、查重、命名映射、比较快照、汇总分层 |
| `tests/*.test.ts` | 契约测试（81 项） |

## 边界

- 当前为**本地开发版最小闭环**，非 Qoder Sites 部署（Pro 实测按 ADR-0004 在阶段6后）。
- **无 AI 解析**：抽取为按行/按格草稿生成，非真实 OCR/文献解析。
- 领域层不 import 框架/存储/网络；换技术栈不丢产品语义。
