# E3 完成交接（简要）

> 范围：知识库防偏移执行合同 **E3 分项人审、主题与消费者开放**（§4.2/§4.6.5/§4.7/§8.1/§13 E3，判据 **T13–T16、T25** ＋ §10 E3 浏览器清单）。
> 状态：**passed**（PR #8 已以 merge commit `410ea85` 于 2026-11-21 15:22 合入 main）。执行依据见 [KNOWLEDGE_BASE_EXECUTION_SPEC.md](../docs/architecture/KNOWLEDGE_BASE_EXECUTION_SPEC.md)；完整过程见 [会话记录 S05-T5](sessions/2026-11-21_session-05.md#s05-t5) 与 [提交台账 #86](COMMIT_LEDGER.md)。

## 一句话结论

E2 入库的结构化分项不再是「只读死数据」：**逐项可看原文、可改、可单独确认或打回，未逐字定位的引文不放行，壳与卡片状态一律由分项派生，条件一变就级联回退**；消费者（分析核心／上下文地图／新增认识）从此只认「当前仍有效的已确认分项」，旧版固定值照旧可读但不冒充。

## 落点

| 文件 | 承担 |
| --- | --- |
| `sciworkbench/services/knowledge-base.ts` | 本轮主战场（+1118）：`updateKnowledgeItem`／`reviewKnowledgeItem`、`updateKnowledgeContext`（返回 `affectedItems`）、`reviewKnowledgeContext`（部分确认→`need_info`＋`pendingConditions`）、`resolveKnowledgeEvidence`（服务端逐字定位，给 `candidateOffsets`，**不接受客户端自称 matched**）、`structureLegacyCard`（引文锚原件 `SourceRef`、同批条件用 `localId`）、`syncShellAudit`／`shellItemRefs`／`shellAllItemsConfirmed`、`knowledgeItemConfirmedAt`（钉住的版本）／`knowledgeItemLiveStatus`（当前有效性）、`createKnowledgeTheme`／`updateKnowledgeTheme`／`createKnowledgeStatement`、`describe*` 中文词表 |
| `sciworkbench/server.ts` | §8.1 端点接入（`/api/knowledge/items/:id`〔?revision=&topicId= 回查固定版〕、`…/update`、`…/review`、`/api/knowledge/contexts/:id/update|review`、`/api/knowledge/evidence/:id/resolve`、`/api/knowledge/cards/:id/structure`、`/api/knowledge/themes`〔GET/POST〕`/themes/:id/update`、`/api/knowledge/statements`）；**卡片编辑／重抽／删除不再覆盖或残留新壳**（重抽 409 式拒绝、删除级联清理 `knowledgeItemIds`／context／evidence／主题成员） |
| `sciworkbench/services/{app,analysis,context-map}.ts` | 消费者开放与门槛：`knowledgeUseBlockers` → 422 `knowledge_review_required`（分项未全部有效确认不得用于正式认识）；分析核心加入／勾选／运行按当前版校验，门槛未过**不落库**；上下文地图 `item` 引用取固定版渲染、固定用所选版本；整卡确认／改原文仍 409，备注与重要度放行 |
| `sciworkbench/domain/knowledge.ts`、`sciworkbench/store.ts` | 校验错误带字段名（`fieldLabels`）；关系端点可指 `item`；`ObjectRef` 增 `kind:"item"` 与可选 `revision`（所选即所审那一版） |
| `sciworkbench/public/lib/pages/knowledge.js` | 分项审阅区（+482）：分项原文＋引文定位状态＋**出现位置全列**（第 k 处／当前）、条件内联编辑（名／值／单位／未知原因）、`kzEvFollowHtml`「本处引用第1版：未定位 → **改绑当前版**」（知识项与每个条件各给入口，只读旧版不给）、旧卡按需结构化＋来源选择（本卡记录／原件正文）、主题面板与「当前认识」门槛提示、`KZ_DRAFT` 草稿保护与快照前 dirty 检查、`kzCondSplit` 纯函数 |
| `sciworkbench/public/lib/{api.js,format.js}`、`styles.css` | 11 个新端点包装；词表补齐 `fieldPath`／`reasonCode` 中文与 `NATURE_OPTIONS`（与后端枚举同源）；`.stalev`、条件行内编辑样式 |
| `sciworkbench/scripts/acceptance-knowledge.ts` | E3 浏览器验收种子（全合成，不联网、不需要 Key）：卡 A 已结构化（1 条引文＋1 个含两条件的条件对象＋2 个分项）＋卡 B 未结构化留给「按需结构化」；同一句引文在原件正文中出现 3 次，用于测「多处命中」的 fail-closed |
| `sciworkbench/tests/{knowledge-base,frontend-render,knowledge-pipeline}.test.ts` | **T13／T14／T15／T16／T16b／T16c／T16d／T25** ＋ A7 渲染断言（条件与知识项的改绑入口、旧版只读不给入口、`kzCondSplit` 三例）＋ pipeline 卡片归属与重抽守卫 |

## 关键口径（本轮定下的，别在 E4 被改回去）

- **确认门槛按钉住的版本判定**（§4.6.9「逐项验证所选固定 revision」优先于便利）：引文「定位修订」生成新版后，旧引用**不自动升级**，由人显式点「改绑当前版」，而改绑本身把审阅打回 pending——这是 T16 与 T16d 共同的断言基线。
- 对照：**条件／分项的审阅状态**按该对象最新版判定（既有实现如此，因为每次审阅都会升版）；「旧版能不能读」走 `knowledgeItemConfirmedAt`，「现在能不能用」走 `knowledgeItemLiveStatus`／`shellAllItemsConfirmed`。
- 科学内容改动 → 新 revision ＋ `pending`；备注／重要度／展示分组改动 → 不升版、不影响门槛；`baseRevision` 过期 → 409，不静默覆盖人审。
- 条件 `review` 只随上下文对象走（`strictConditions` 不收该键），别把它塞进 payload 条件对象里。

## 验收证据

- `npm --prefix sciworkbench test` → **294 / 294 通过**（E2 合入后基线 279，本轮 +15）。
- §10 E3 判据 T13–T16、T25 全部有同名测试且通过；强制不变量另测：未逐字定位引文不能确认（知识项与条件两条路径）、重抽不覆盖新壳、删除卡不残留索引。
- 浏览器验收（隔离实例 `PORT=5217`、`LOCUS_DATA=sciworkbench/data/scratch-e3/run.json`、AI 环境变量全清、Edge）：定位（1 处→matched／3 处→ambiguous 全列可点）→ 改绑当前版 → 部分确认条件（「条件 1/2 已确认」）→ 知识项确认被拦 → 改绑 → 「分项 1/2 已确认 · 整卡待补」→ 主题建／「当前认识」422 → 确认后 200 → 旧卡结构化（原件正文锚定）→ 人审冲突 409 → dirty 保护 → 刷新恢复；控制台 **0 error / 0 warn**。
- 未触碰活体实例 `127.0.0.1:5184 / 5187 / 5191`；验收数据只在 `.gitignore` 覆盖的 `sciworkbench/data/` 内。

## 顺手修掉的真实缺陷（浏览器验收暴露）

1. **知识页显示 0 卡 0 待审**：提取按附件作答，新壳常无 `paperId`，而左栏／待审队列／右栏计数只认 `paperId`。改为一处 `kzCardPaper`（缺失时按附件回查所属论文）派生全部口径，并让旧数据卡（无 paperId）也进待审队列。
2. 多处命中时**当前出现位置无法采用**（只列第 2／3 处）——全列并标「第1处（当前）」。
3. 条件的引文**界面完全不显示**，未定位条件下确认必失败 → 死路。条件行补逐字原文＋定位状态＋改绑入口。
4. 种子构造器把「温度＝25 °C」整串塞进 `field.raw`，显示成「温度＝温度＝25 °C」→ `kzCondSplit` 拆分。
5. 种子条件的 `evidenceRefs: [{kind,localId}]` 不绑定、`sourceRef:{kind:"asset",id}` 缺 revision/hash 被整批拒收。
6. `reviewCard`（备注／重要度）与卡片编辑／**重抽**／删除都会整行覆盖新壳卡 → 重抽显式拒绝、删除级联清理。
7. 前端陈述表单的 `nature` 选项与后端枚举不符（422「nature不能为空」）→ 词表两侧对齐；未知原因词表补 `unparsed_numeric` 等。
8. 分析核心允许在门槛未过时先落库 → 改为先过 `knowledgeUseBlockers` 再写（「核心结果未写入」）。
9. 上下文地图固定用最新版冒充所选旧版 → 按引用版本读取。

## 偏差与未做（如实）

- §12.3 步骤 1 写「进『总览』」：现有界面顶部条就是课题总览，无同名入口，沿用现路径；功能判据已覆盖。
- `scripts/frontend-text-check.ts` 在本机 headless Edge（`--headless=new` 与 `--headless`）均返回空 DOM（0 字节），属**环境／工具限制**；改用同规则在已连线 Edge 内扫描可见文本（禁用模式零命中）替代。接手者若换机器应重跑该脚本再下结论。
- 级联回退后「当前认识」在**读取侧**的复检（T18／T33 家族）本轮只给了写侧 422 与前端提示，留给 E4／E5 一并验证。
- 截图归用户（AGENTS.md §1），本文不引用未存在的截图。
- 仍不在授权内、**不得自动执行**：真实模型与外部工具验证（S03）、真人课题数据（S02）、B1 只读监听（S07）。

## Git 现状与下一步：E4（数据集／查询／比较）

- 分支 `feat/s05-e3-item-review`：代码 `26f7d65`（2026-11-21 15:17，17 files +2776/−40）、记录 `22f677b`（15:18）；main 上另有交接文档提交 `c065bb2`（15:25，经 `docs/s05-e3-handoff` ＋ PR #9）。
- **PR #8**「E3 分项人审：逐项审阅／定位修订／旧卡结构化／主题门槛＋卡片归属修复」审计通过（294/294、范围与标题一致、无敏感文件）后以 **merge commit `410ea85`（15:22）** 合入 main；台账 #86 已回填该 hash，PR #9 的 merge hash 按 §7.3 由下一轮回填。
- E4 判据 **T17–T19、T26–T28**：数值换算要有独立 oracle（1 d vs 24 h 差 0 比 1；1 d vs 48 h 差 24 h 比 2）；missing／单位／类型不符正确拒绝；条件作自变量不得误拦截；scope 不得沿共享论文串到别的课题；禁止用摘要或前 30 行代替选定数据集。
- 顺序纪律不变：短命分支 → 全绿 → 由 `git log` 写记录 → PR merge commit → 回填 merge hash；发现无法纳管的旁路按合同 §14 停下报告。

## 勘误与后续（2026-11-21，S05-T8/T9；原文保留）

- 上文「确认门槛按钉住的 revision 判定（§4.6.9）」是正确口径，但**当时实现并未如此**：消费者门槛（`knowledgeItemConfirmedAt`/`knowledgeItemLiveStatus`）实际返回**当前版本**的审核态。S05-T8 以反例取证，S05-T9 按用户裁决**按 §4.2 修正实现**（新增 `knowledgeItemGate`：被引用版本 review ＋ 当前非 withdrawn/excluded），并更新 T13 与 E6.5②a/b 测试。此处保留原文，仅追加勘误，不追改历史通过记录。
- E6 阶段被拆为 E6-A（数据接线，已完成）／E6-B（页面集成＋浏览器验收，等前端交付）；E3 的浏览器项口径不变，E6-B 通过后不应视为 E3 漏项。
