# sciworkbench — LOCUS 领域层骨架（阶段2）

零依赖、纯函数的领域层骨架，编码 03_DOMAIN_RUNTIME 的关键契约，作为**最小可测试接口**。
设计与契约见 [`docs/architecture/`](../docs/architecture/)。

## 运行

```bash
cd sciworkbench
node --test "tests/*.test.ts"     # 或 npm test
```

要求 Node ≥ 22（本项目在 Node 24 实测；使用 Node 原生 TypeScript 类型剥离，无需构建、无需安装依赖）。

## 结构

| 文件 | 内容 |
| --- | --- |
| `domain/types.ts` | 实体与版本（稳定 id + 追加式 revision、Ref 固定 revision、复核状态 vs 任务状态） |
| `domain/paths.ts` | **三业务路径** + **两事件** |
| `domain/graph.ts` | 关系网络：lineage / support / provenance / affiliation；下游查询 |
| `domain/impact.ts` | **确定性传播**（按变更类型分流）+ **影响分析状态机**（失败≠无影响、stale 不覆盖） |
| `domain/backtrace.ts` | **按类型的回查链原型**（不是一条固定串联链） |
| `domain/topic.ts` | 课题/子问题最小创建、按任务查缺项（阶段3） |
| `domain/literature.ts` | 文献证据卡四维审阅、候选库状态、组审、查重、命名映射、比较快照、汇总分层（阶段3） |
| `tests/*.test.ts` | 契约测试（37 项） |

## 边界

- 这是**骨架**，不是完整产品，也不是"已部署/已验证"。存储/API/前端/模型接入均在后续阶段。
- 领域层不 import 框架、存储、网络；换技术栈不丢产品语义。
- Pro / Sites 实测在**阶段6之后**（ADR-0004）。
