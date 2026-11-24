# locus-site/demo-data — 公开展示数据（A 角色交付）

> 角色 A（executor-a）独占写入目录。本目录产出评委公开展示所需的**案例数据、预生成结果快照、原件与评委 ZIP**。
> 基线提交：`8120986`。会话：`S08-T2`。

## 目录与文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `fixture.json` | 已交付（第一版） | **A→B 贯通夹具**：用真实对象 ID 串起「文献+原件定位→卡片→知识条目」与「结果→处理记录→表行/执行→原件」两条最小链。供 B 接线，可随正式导出替换。 |
| `README.md` | 本文件 | 字段含义、读取接口、复核命令与输出。 |

> 后续将追加：`snapshot/`（正式快照：state / manifest / context-map / references / comparisons / ai-products / report 片段）、`originals/`（可再分发原件与数据集）、`docs/`（来源许可、五步走查）、`tools/`（生成与打包脚本）、`SHA256SUMS.txt`、评委 ZIP。

## fixture.json 字段说明

- 固定清单字段：`schemaVersion`、`fixtureVersion`、`sourceCommit`（=8120986）、`projectId`（=主课题 ID `topic_f6bff443…`）。
- `readPaths`：夹具每个对象落到的**现有前端读取路径**（只读）。
- `topic` / `nav`：主课题与五个演示入口的对象 ID。
- `chainA_literatureToKnowledge`：`paper`→`original`(asset+locator)→`attachment`→`card`→`knowledgeItem`。
  - `locator` 同时给出**扫描索引页**(djvuIndexPage=371) 与**书页**(printedBookPage=359) 两套页码——Wisiksource 影印本两者不同，必须并记。
  - `knowledgeItem` 是夹具用的**简化**「卡片→知识条目」映射；正式库对应 `state.knowledge.items`（见快照）。
- `chainB_resultToOriginal`：`result`→`processingSample`(measurement)→`tableRow`(表行)→`execution`→`original`(asset)。

## 读取接口映射（B 接线要点）

| 夹具块 | 现有后端只读路径 | 返回形态 |
| --- | --- | --- |
| 整份状态 | `GET /api/state` | `LocusState`（顶层数组：topics/papers/assets/…/reports/chats） |
| 文献原件 | `GET /api/source/{assetId}` | `sourceView(state, assetId)` |
| 卡片回查 | `GET /api/backtrace?kind=card&id=…&dir=both` | `{start,nodes,edges,pending}` |
| 上下文地图 | `GET /api/analysis/map?topicId=…&taskId=…` | `ContextMap{ok,scope,nodes,edges,gaps}` |
| 知识条目 | `GET /api/knowledge/items/{id}?revision=…` | 简化 kitem / 正式 `state.knowledge.items` 版本 |

B 在 `web-overlay/demo/` 只需把上述只读路径按**明确路径匹配**适配到本目录的静态数据；未知路径直接报缺项。

## 复核

```bash
node -e "JSON.parse(require('fs').readFileSync('locus-site/demo-data/fixture.json','utf8')); console.log('fixture.json 可解析')"
```

（正式快照/ ZIP 的完整复核命令与原始输出见本文件后续「复核记录」节。）
