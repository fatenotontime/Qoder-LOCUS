# locus-site/demo-data — 公开展示数据（A 角色交付）

> 角色 A（executor-a）独占写入目录，产出评委公开展示所需的**案例数据、预生成快照、原件与评委 ZIP**。
> 基线提交：`8120986`。会话：`S08-T2`。全部只读、无网络、无模型调用。

主课题：`topic_f6bff443-3f74-4677-810d-0c15c7d06bf0`「种子经海水漂流后的萌发（达尔文 1859）」。

## 目录

| 路径 | 说明 |
| --- | --- |
| `fixture.json` | **A→B 贯通夹具**（第一版）：真实对象 ID 串起「文献+原件定位→卡片→知识条目」与「结果→处理记录→表行/执行→原件」。供 B 接线，可随正式导出替换。 |
| `snapshot/state.json` | 正式快照主体，`LocusState` 前端消费格式（topics/papers/assets/cards/tables/protocols/executions/samples/measurements/analysisTasks/analysisResults/reports/chats + 空 knowledge）。 |
| `snapshot/manifest.json` | 固定清单：`schemaVersion/fixtureVersion/sourceCommit/projectId` + `generatedAt` + 原件与快照文件 SHA-256 + `verificationStatus`。 |
| `snapshot/context-map.json` | **真实生成**的上下文图（`mapTask` 任务现有选择 + `mapPre` 建任务前推导），非手绘。 |
| `snapshot/references.json` | 引用网络（`buildNetwork` 真实生成：34 节点 / 75 边）。 |
| `snapshot/knowledge.json` | 知识条目（由 cards 同源派生：字段/单位/条件/未知项/定位状态）+ 跨来源比较 `cmp_darwin_vs_martens`。 |
| `snapshot/ai-products.json` | AI 产物登记：`modelRunThisSession=false`，逐项 `unverified/incomplete/curated`。 |
| `snapshot/next-steps.json` | 下一步方向 2 条，每条含「分歧/缺口→补什么→区分什么解释→仍不确定」。 |
| `snapshot/report-snippet.md` | 可回查报告片段（按 nature 分列，回链到卡片→原件）。 |
| `snapshot/figures.json` | 展示增量（S10-C）：方案流程示意图（据方案 r1 步骤）+ 结果柱状图（据表行数值）。 |
| `snapshot/chain-90d.json` | 「90 天」贯通链（报告块→结果→测量→表/执行→原件），逐跳固定版本与缺边说明。 |
| `snapshot/exports/` | 站内导出：`report.docx`（报告 Word）与 `traceability.zip`（追溯包，同版）。 |
| `originals/` | 可再分发原件：`origin-1859-p371-373.md`、`sources/page-369..373.wiki`、`data/*.csv`。全部 Public Domain。 |
| `docs/` | `来源与许可.md`、`五步走查.md`、`站内映射.md`、`公开快照对应表.md`。 |
| `tools/build-demo.mjs` | 生成器（读私有输入 → 写快照，纯本地）。 |
| `tools/build-judge-zip.mjs` | 打包评委 ZIP（纯 Node，STORED，确定性）。 |
| `tools/verify.mjs` | 复核 + 生成 `SHA256SUMS.txt`。 |
| `locus-demo-public.zip` | 评委样本包（13 项）。 |
| `SHA256SUMS.txt` | 原件 + 快照 + fixture + ZIP 的 SHA-256。 |

## 数据契约（固定字段）

- `schemaVersion=1`、`fixtureVersion=s08-a-fixture-1`、`sourceCommit=8120986`、`projectId=topic_f6bff443…`。
- `generatedAt`、原件与快照文件 SHA-256、`verificationStatus=verified-local` 均写入 `snapshot/manifest.json`。

## fixture.json 字段

- `chainA_literatureToKnowledge`：`paper`→`original`(asset+locator)→`attachment`→`card`→`knowledgeItem`。
  - `locator` 并记**扫描索引页**（`djvuIndexPage`）与**书页**（`printedBookPage`）；Wikisource 影印本两者不同（371↔359、372↔360、373↔361）。
  - `knowledgeItem` 为夹具用**简化**「卡片→知识条目」映射；正式对应 `snapshot/knowledge.json` 的 `items`（源自 `state.cards`）。
- `chainB_resultToOriginal`：`result`→`processingSample`(measurement)→`tableRow`(表行 0)→`execution`→`original`(asset)。

## 读取接口（B 接线要点）

| 数据 | 现有后端只读路径 | 返回形态 |
| --- | --- | --- |
| 整份状态 | `GET /api/state` | `LocusState`（与 `snapshot/state.json` 同形） |
| 原件 | `GET /api/source/{assetId}` | `sourceView(state, assetId)` |
| 卡片回查 | `GET /api/backtrace?kind=card&id=…&dir=both` | `{start,nodes,edges,pending}` |
| 上下文地图 | `GET /api/analysis/map?topicId=…&taskId=…` | `ContextMap{ok,scope,nodes,edges,gaps}` |
| 知识条目 | `GET /api/knowledge/items/{id}?revision=…` | 正式库版本读取 |

B 在 `web-overlay/demo/` 按**明确路径匹配**把上述只读路径适配到本目录静态数据；未知路径直接报缺项。`snapshot/state.json` 已可直接按 `LocusState` 提供给只读适配。

## 生成与复核

```bash
# 生成快照（读 worktree 内 gitignore 的私有输入，纯本地）
node locus-site/demo-data/tools/build-demo.mjs
# 并行 worktree 内无私有输入时，可用环境变量指向只读外部副本：
#   LOCUS_ACCEPTANCE_INPUT=<path>/acceptance-darwin.json LOCUS_SEED_DIR=<path>/darwin-seed-saltwater \
#     node locus-site/demo-data/tools/build-demo.mjs
# 打包评委 ZIP（纯 Node，无网络）
node locus-site/demo-data/tools/build-judge-zip.mjs
# 复核 + 生成 SHA256SUMS.txt（含图形/贯通链/导出文件校验）
node locus-site/demo-data/tools/verify.mjs
```

复核原始输出（`verify.mjs` 全绿，EXIT=0）：

```
PASS  JSON 可解析: fixture.json … snapshot/next-steps.json（8 个）
PASS  manifest.schemaVersion=1 / fixtureVersion="s08-a-fixture-1"
PASS  manifest.sourceCommit=8120986 / projectId=topic_f6bff443…
PASS  manifest.generatedAt=2026-11-24T10:26:37.139Z / verificationStatus="verified-local"
PASS  state 引用无悬空（cards 10 / tables 2 / …）
PASS  fixture 全部引用可解析到 snapshot state
PASS  knowledge 条目/比较引用无悬空（items 10，comparisons 1）
PASS  原件 SHA-256 全部复算一致（9 个）
PASS  快照文件 SHA-256 复算一致（7 个）
PASS  SHA256SUMS.txt 已生成（19 行）
PASS  ZIP SHA-256 与校验文件一致 785b468908b0f024…
PASS  ZIP 条目与磁盘一致（13 项）
结果：全部通过
```

## 评委 ZIP

- 文件：`locus-demo-public.zip`
- SHA-256：`785b468908b0f0246b4e0cafb407a8f4e66d2fbb4db31ed6599fba9f68f4312b`
- 内容（13 项）：`README.md`、`docs/{来源与许可,五步走查,站内映射}.md`、`originals/`（全文摘录 + 5 张 wikitext + 3 个 CSV）。
- 已用 `unzip -t` 与 Python `zipfile` 双验：CRC 全通过、`originals/` 内容与磁盘字节一致、中文文件名按 UTF-8 标志正确解码。

## 未测项与原因

- **独立跨文献比较：未具备**。仅有一份达尔文材料；马滕斯试验为达尔文同页**转引（二手）**，不构成独立两篇文献。已在 `snapshot/knowledge.json` 的 `comparison.independenceStatus` 标「未具备」，未另凑来源。展示用的是「静水 vs 真实海水」同页跨来源比较，并如实写明条件差异与未知字段。
- **真实模型预跑：未做（未授权）**。P8/D2 记录 `/api/ai/status configured=false`；本轮未调用任何模型。`snapshot/ai-products.json` 全部标 `unverified/incomplete/curated`，不冒充真实运行。
- **平台端渲染/浏览器走查：未做**（属 B/D/E）。

## 交接

- **给 B**：以 `fixture.json` 接两条最小链；正式数据用 `snapshot/state.json`（`LocusState` 同形）+ `snapshot/context-map.json` + `snapshot/knowledge.json`。只读适配按上表路径匹配。
- **给 D**：把 `snapshot/`、`originals/`、`locus-demo-public.zip` 纳入公开构建；构建后核对 `SHA256SUMS.txt`（D 侧可调用 `tools/verify.mjs`）。ZIP 下载入口指向该文件。
- **给 E**：下载 ZIP 后按 `SHA256SUMS.txt` 复核哈希；对照 `docs/站内映射.md` 核对站上文献/数据与包内文件。
