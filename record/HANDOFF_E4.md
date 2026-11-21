# E4 完成交接（简要）

> 范围：知识库防偏移执行合同 **E4 数据集、查询与比较**（§7.1 查询、§7.2 比较、§4.4、§8.1、§9，判据 **T17–T19、T26–T28**）。
> 状态：**passed**（代码 `9b20c1a` 16:10 ＋ 读取侧复检 `1bb626b` 16:14；PR #10 已以 **merge commit `a40f7bb`（2026-11-21 16:18）** 合入 main，台账 #87 已回填）。
> 执行依据见 [KNOWLEDGE_BASE_EXECUTION_SPEC.md](../docs/architecture/KNOWLEDGE_BASE_EXECUTION_SPEC.md)；完整过程见 [会话记录 S05-T6](sessions/2026-11-21_session-05.md#s05-t6) 与 [提交台账 #87](COMMIT_LEDGER.md)。

## 一句话结论

知识库不再只能「读一页文本」：**任何总览/wiki/比较/AI 读取统一走 `readKnowledge`**（同型视图＋`viewId`＋只在本课题范围内闭合）；数据可以按**固定表版本**取到选定行列（越界即拒、不读最新冒充）；字段含义与换算规则版本化、审核与编辑分离；比较只能拿 **item 或 dataset 单元格**做输入，缺基线/单位未知/类型不符/条件冲突/映射命中多条时**明确阻断并给理由**，能算的只算 scalar 同口径的差与比（分母 0 阻断、≤12 位有效数字）。

## 落点

| 文件 | 承担 |
| --- | --- |
| `sciworkbench/services/knowledge-base.ts` | 本轮主战场（+860）：`readKnowledge`／`currentViewId`（§7.1 统一读取）、`createKnowledgeDataset`／`updateKnowledgeDataset`／`reviewKnowledgeDataset`／`readDatasetRows`（§4.4/§8.1）、`createKnowledgeMapping`／`updateKnowledgeMapping`／`reviewKnowledgeMapping`、`createKnowledgeComparison`（§7.2 决策与计算）、`legacyComparisonViews`（旧比较读取适配）、`effectiveCurrentJudgments`（E3 遗留读取侧复检） |
| `sciworkbench/server.ts` | §8.1 九条路由：`GET /api/knowledge/view`、`GET /api/knowledge/datasets/:id/rows`；`POST /api/knowledge/datasets`、`/:id/update`、`/:id/review`、`/api/knowledge/mappings`、`/:id/update`、`/:id/review`、`/api/knowledge/comparisons`（全部入 commitState 队列、先存后发布） |
| `sciworkbench/tests/knowledge-base.test.ts` | **T17／T18／T19／T26／T27／T28** 同名用例＋E3 遗留读取侧复检用例；合成夹具 `seedE4` |
| `sciworkbench/tests/knowledge-pipeline.test.ts` | E4 路由往返：缺 topicId 422、`view_stale` 409、固定版本读不到 → 决策 blocked 不给结论 |

## 关键口径（本轮定下的，别在 E5/E6 改回去）

- **`viewId` 覆盖整个视图体（含 comparisons/datasets/mappings）**：因此「再写一条比较」会让上一枚 viewId 过期 —— 这是 §7.1「数据已变返回 409」的直接后果；写入方每次动作前须重取。
- **formal 默认**：formal 只含「**现在**仍 confirmed」的项（不是只看固定版本）；explore 才带 pending/needs_info，且必须标性质与未知项（§4.7）。
- **scope 闭包**：只按所选课题的 item 及其条件/引文 1 层闭包返回；**不反向带回**使用同来源的其他课题内容（T26）；跨课题取数据集在比较里直接 422 `cross_topic_scope`。
- **单元格操作数钉住「审核后的」数据集 revision**：列审核会推进 dataset revision（§4.2），旧 revision 读到的是未审核 payload → `dataset_not_confirmed`；这是固定版本语义的正确行为，不是缺陷。
- **换算只用已确认映射**：命中多条即 `mapping_conflict`（不取第一条）；映射未确认 → `mapping_not_confirmed`；缺单位 → `unit_unknown`；这些都在 `reasonCodes` 里逐项给出。
- **旧比较不改写**：`legacyComparisonViews` 只在**读取侧**把旧 `ComparisonRecord` 标 `display_only`（附 `legacy_no_computation`／`legacy_unbound_fields`）；既有快照与旧写入路径保持原样（§7.2 末）。

## 验收证据

- `npm --prefix sciworkbench test` → **302 / 302 通过**（E3 合入后基线 294，本轮 +8）。
- 判据 T17–T19、T26–T28 全部有同名测试且通过；T17 独立数值 oracle：item 组 1 d→24 h vs 24 h → 差 `0`、比 `1`，1 d vs 48 h → 差 `24`、比 `2`；dataset 单元格组（同表两行）同 oracle；断言不生成虚构 item、原表值按选定范围可读。
- 未触碰活体实例 `127.0.0.1:5184 / 5187 / 5191`；未调真实模型（无外发）；测试全为合成材料。

## 偏差与未做（如实）

- **对「旧 createComparison 改为读取适配入口」的解读**：旧路径本就只做「按名分组并列」、从不产生计算值，故未改其写入签名（避免重写历史数据），改为读取侧统一标 `display_only`。若后续要求旧路径也改签名，属行为变更，需与前端一起处理（E5/E6）。
- 自体 E4 无浏览器项（§10 E4 未要求页面）；**总览/比较页面在 E6**、快照与导出在 E5，故本轮不启动实例、不截图。
- 自查期修复实现缺陷 2 处（空 `applicability` 误拒、缺单位未登记 `unit_unknown`），已在代码与用例中体现。
- 仍不在授权内、**不得自动执行**：真实模型与外部工具验证（S03）、真人课题数据（S02）、B1 只读监听（S07）。

## Git 现状与下一步：E5（快照／wiki／知识包）

- 分支 `feat/s05-e4-datasets-comparison`（自 main `57d6d3d`）：代码 `9b20c1a`（16:10）、读取侧复检 `1bb626b`（16:14）、记录 `5f70b37`（16:18）。
- **PR #10**「E4 数据集/查询/比较：统一读取、固定表版本行读取、比较决策契约」审计通过（302/302、范围与标题一致、无敏感文件）后已以 **merge commit `a40f7bb`（16:18）** 合入 main；记录提交 `5f70b37`（16:18）。
- E5 判据 **T29–T35**：`freezeKnowledge` 固定 snapshot（`contentHash` 不含 createdAt/snapshotId、同内容可不同 ID 同 hash）；改数据/映射/主题判断后旧快照不变；`viewId` 过期 409；tokens／许可排除＋私密哨兵（含 ZIP 解包）；机器 CSV 缺失值不写 0。
- 顺序纪律不变：短命分支 → 全绿 → 由 `git log` 写记录 → PR merge commit → 回填 merge hash；发现无法纳管的旁路按合同 §14 停下报告。
