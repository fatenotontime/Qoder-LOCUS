# E5 完成交接（简要）

> 范围：知识库防偏移执行合同 **E5 快照、wiki 与知识包**（§7.3 快照、§7.4 wiki/CSV/JSON/引用、§7.5 来源策略与出口检查、§8.1 路由，判据 **T29–T35**）。
> 状态：**passed**（代码 `e3a148c` 17:00；PR #12 已以 **merge commit `42d2f05`（2026-11-21 17:03）** 合入 main，台账 #88 已回填）。
> 依据：[KNOWLEDGE_BASE_EXECUTION_SPEC.md](../docs/architecture/KNOWLEDGE_BASE_EXECUTION_SPEC.md)；过程见 [会话记录 S05-T7](sessions/2026-11-21_session-05.md#s05-t7) 与 [台账 #88](COMMIT_LEDGER.md)。

## 一句话结论

知识现在可以**冻结成不可变快照并成套带走**：同一快照产出 JSON／CSV／wiki／ZIP，事实、单位、性质、unknowns 与引用 token 完全一致（不重新读当前库）；快照内带**实际行列**（31 行不会被截成 30 行）与**稳定 token**；导出前一律先过**来源许可共用检查**——默认「本机所有者模式」只允许本地读，含被拒来源的整包直接 403，撤权也不改写已冻结快照。

## 落点

| 文件 | 承担 |
| --- | --- |
| `sciworkbench/services/knowledge-base.ts` | `policyFor`／`upsertSourcePolicy`／`sourceRefsOf`／`knowledgeAccess`／`assertKnowledgeAccess`（§7.5）、`freezeKnowledge`（§7.3）、`readSnapshotKnowledge`／`readSnapshotDatasetRows`／`resolveSnapshotToken` |
| 新建 `sciworkbench/services/knowledge-export.ts` | `snapshotCsv`（机器版／sheet-safe）、`snapshotWiki`（六页模板）、`snapshotSchemaFiles`（schema＋数据字典）、`buildKnowledgePackage`（ZIP＋manifest＋NOTICE）、`exportKnowledge`（zip/json/wiki/csv）；`safeFileName`／`safeRelPath`／`safeText` 安全函数 |
| `sciworkbench/domain/knowledge.ts` | `SnapshotContent.datasetRows`（快照内实际行列）；**修正 `stableStringify`** 的 undefined 语义（见下） |
| `sciworkbench/server.ts` | §8.1 路由：`POST/GET /api/knowledge/snapshots`、`…/snapshots/:id/export`、`…/references/:token`、`POST …/source-policies`；`items/:id` 与 `datasets/:id/rows` 支持 `?snapshotId=` |
| `sciworkbench/tests/knowledge-base.test.ts` | **T29–T34、T34b**（含最小 ZIP 解包器验证包内容） |
| `sciworkbench/tests/knowledge-pipeline.test.ts` | **T35**（GatedStore 保存失败不 ready、旧快照仍可读）＋ E5 路由往返 |
| 新建 `sciworkbench/tests/knowledge-view.test.ts` | 纯渲染（wiki 六页/CSV 列固定/schema 字典）＋ API 往返结构 |

## 关键口径（勿在 E6/E7 改回）

- **冻结与预览共用一条读取路径**（`readAll`→`readKnowledge` 跨页合并）：避免「预览看到的」与「冻结下来的」两套口径。
- **默认拒绝导出/发送**：未设策略 = 本机所有者模式（只允许 localRead）；要带出必须先由用户显式写 `sourcePolicies`（含理由）。**本地读取**也可被显式撤销。
- **整包一致**：含被拒来源的快照，导出**整包 403**（不降级为 warning 后继续返回）；策略变更**不触碰**已冻结快照（token/内容不变）。
- **机器值保真**：CSV 机器版缺失值留空（**绝不写 0**）、公式样式原文不动；sheet-safe 版才前置 `'` 转义并在 manifest 标注。
- **引用 token**：`K1..Kn`（知识）／`S1..Sm`（来源），排序后生成、随快照冻结；token 不是访问凭据。
- **`stableStringify` 修正（重要）**：原实现对 `undefined` 值会写出 `"key":undefined`，而 JSON 落盘会丢键 —— 导致**归档来源经重启后 hash 失配**（`content_mismatch`，E5 快照会因此丢数据集）。已按 §7.3「UTF-8 JSON」语义修正：对象键略去、数组项记 `null`。修正会改变 canonicalHash，影响仅限**此前的归档/快照数据**（目前只存在于测试与合成验收数据）。

## 验收证据

- `npm --prefix sciworkbench test` → **313 / 313 通过**（E4 后基线 302，本轮 +11）。
- 判据 T29–T35 全部同名测试通过：T29 同快照三格式一致＋T17 oracle；T30 改映射/主题判断/比较后旧快照与 token 不变、新 hash 变化，且「同内容重复冻结：ID 不同、contentHash 相同」；T31 31 行全在快照内（末行 99 未被截）；T32 viewId 过期 → 409；T33 非法文件名/HTML/`javascript:`/CSV 公式安全；T34 scope 外哨兵（含 ZIP **解包**检查）不入包、撤权整包 403 且不改写原快照；T35 首次 freeze 保存失败 → 500 不 ready，旧快照仍可读且 hash 不变。
- 未启动任何实例；未调真实模型；活体 5184/5187/5191 未触碰。

## 偏差与未做（如实）

- **§12.2 全负载容量复测未做**：合同要求 E5 后复测（1000 项/31 行×10 列/20 快照等）。本轮未跑合成负载与 S08 停点数据，**属 S08 工程停点范围**，需单独一轮在用户机器上记录初始大小/加载/查询/保存耗时与内存峰值。
- **浏览器项未做**：§12.3 第 6–7 步（冻结、读 wiki、下载 JSON/CSV/ZIP、改值后旧快照不变）属 **E6 页面**范围，与 E6 一并验；本轮只有纯渲染与 API 往返结构测试（§9 明确它**不能替代浏览器**）。
- 导出格式选择：`format=json` 返回机器 JSON（含 schema 与数据字典副本），`format=zip` 为完整包（snapshot.json＋schema＋字典＋references＋CSV 对＋wiki＋manifest＋NOTICE）；wiki 单文件 .md。若 E6 需要别的形状，在 E6 内调整，不动已冻结快照格式。
- 仍在授权外、**不得自动执行**：真实模型与外部工具（S03）、真人课题数据（S02）、B1 只读监听（S07）。

## Git 现状与下一步：E6（**阻塞：等前端**）

- 分支 `feat/s05-e5-snapshots-export`（自 main `e0bdd01`）：代码 `e3a148c`（17:00）；记录提交随后。
- **PR #12**「E5 快照/wiki/知识包：冻结、统一导出、来源策略与访问共用检查」审计通过（313/313、范围与标题一致、无敏感文件）后已以 **merge commit `42d2f05`（17:03）** 合入 main；记录提交 `8372371`（17:02）。
- **E6 阻塞**：用户明确「E6 要等前端开发完成」——§9 指定前端文件 `public/lib/pages/knowledge-base.js`（总览/wiki/比较/证据抽屉渲染与事件）由前端开发交付，且 E6 判据 T36–T40 与 §12 浏览器全链**必须真实浏览器验收**（不能用纯渲染单测替代）。E6 未开工前不得标 passed。
- **连带**：E7（内置 AI 统一输入）依赖 E6 的选择器；E8 的「wiki/总览入口」项也依赖 E6 页面。数据面（快照/导出/AI 读取源）已在 E5 就绪，E6/E7 接入时直接复用 `readKnowledge`／快照读取／`assertKnowledgeAccess`。
- 顺序纪律不变：短命分支 → 全绿 → 由 `git log` 写记录 → PR merge commit → 回填 merge hash；发现无法纳管的旁路按合同 §14 停下报告。
