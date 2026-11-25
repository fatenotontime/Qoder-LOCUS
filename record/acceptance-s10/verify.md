# S10 本地展示整改 · 独立验收台账（executor-e3）

> 反例格式：**模式与候选版本 → 点击或输入 → 实际状态／文件 → 判定**。
> 取证：DOM／请求体／替身日志／文件哈希，不用截图代替结论。本地环境与 Site 发布环境**分开记**。

## 0. 冻结信息

| 项 | 值 |
| --- | --- |
| 候选分支 / HEAD | `feat/s08-public-demo` · `dcf795b`（并入 e3 后 HEAD `1345ab2`，merge commit） |
| 构建版本 | `public-1345ab2` |
| 公开静态入口 | `http://127.0.0.1:5380/`（`--mode=public`，**无 Node**） |
| trial 入口（→ 原生 Node） | `http://127.0.0.1:5581/`（反代 `/functions/v1/app/api/*`→5284） |
| 原生 Node 入口 | `http://127.0.0.1:5284/` |
| 模型替身 | `http://127.0.0.1:5490/v1`（`stub-model.mjs`；`knowledge_struct` 延迟 8s） |
| 临时目录 | `F:/qoder-dev-tmp/s10-e3-1345ab2` |
| 端口说明 | 本机 5280/5290 被 c 角色 serve/stub 占用、5283 被 QQ 占用、5281 被 c 角色 serve 占用；本轮用 5380/5581/5284/5490，开工前探测空闲 |

## 1. R01–R10 验收表

| 编号 | 模式·版本 | 实际操作 | 实际状态／文件 | 判定 |
| --- | --- | --- | --- | --- |
| R01 | 可写·1345ab2 | 分析页取消「作者修正意见」→ 直接推荐；再空子问题建任务；版本冲探针 | 前端推荐请求体 keys=`[purpose,subquestionId,optional,versions]`（**无 workspace/topicId**），替身收到冻结快照仍「候选 3」，UI 勾选 2 → 不一致；服务端契约本身正确：`workspace:true` 建任务→**422 subquestion_required**，版本冲→**409 selection_stale** | ❌ 不通过（前端未带 workspace，服务端新校验未生效） |
| R02 | 可写·1345ab2 | A（达尔文）发起提取（run kr_81dc1e08，2 块）→ 切空课题 B → 等 9.5s → 回 A | B 页 `kz-paper=「本课题暂无文献」`、0 卡、队列空、`leaksA=false`；回 A 队列见其任务与替身卡，`finalRun=completed` | ✅ 通过 |
| R03 | 可写·1345ab2 | 两行填值只存第 1 行；events 503 复点；取消拦截重试 | 保存后 row1=`R03-ROW1`、**row2=`R03-ROW2` 保留**、事件 4→5；失败后输入保留 `R03-FAIL`、行旁 `.rowerr=「未保存，请重试」`可见、状态「记录步骤失败」；重试事件 5→6（**只追加一次**） | ✅ 通过 |
| R04 | 可写·1345ab2 | UI 发起提取 → 提取中填卡备注（仅 input）→ 切页/返回 → 刷新 | 提取中舞台 `working(0/2)`；返回后备注仍 `R04-未保存备注`、舞台 `working`、卡仍展开；刷新后 `working(1/2)`（**按已存 runId 找回**） | ✅ 通过 |
| R05 | 公开·1345ab2（无 Node） | 打开首页，遍历 library/papers/protocol/record/analysis/chat | `theme=paper`、`displayMode=on`、badge「展示课题·只读」、8 导航；分析页数值贯通链「榛子（干燥后漂浮）=90 days」6 跳 + 2 导出链接；全程 **`/api`=0、`/demo-data`=47、外链=0** | ✅ 通过 |
| R06 | 公开·1345ab2 | 点第一跳；下载 Word/追溯包/样本 ZIP | 首跳可点（右栏出方案示意图）；下载成功：`report.docx` 1863B、`traceability.zip` 6378B、`locus-demo-public.zip` 33855B（sha256 前16 `5362d30267b23a98`，与构建一致） | ✅ 通过 |
| R07 | 公开·1345ab2 | 拦 `chain-90d.json` 返回 404 后重载 → 打开样本 ZIP → 取消拦截重试 | 受影响区域出 `.dx-fail`「该区域暂时加载失败（引用文件不可读）。」+ 重试按钮；样本 ZIP 仍下载 33855B；重试后链恢复 6 跳 | ✅ 通过 |
| R08 | 三入口·1345ab2 | 三入口各开设置；Esc 关闭；390×800 窄屏；列表→详情→返回/浏览器后退/刷新（`r08_navigation.mjs`，可写源 5582/5286） | 三入口设置均可开（外观/模型/关于）、Esc 后焦点归还 `settings-open`；**protocol/record：点开详情→哈希 `#/nav/id`→返回按钮→浏览器后退→刷新恢复 全通过**；papers/analysis 进入即自动选中首个对象（不写详情哈希，刷新靠 localStorage 回到同卷，非阻断）；窄屏 **公开态横向溢出（docW 511 > 390）**，trial/Node 无溢出 | ⚠️ 部分（核心导航与设置通过；公开窄屏溢出待 C 修） |
| R09 | 可写·1345ab2（+达尔文预导入实例 5286） | 新建可写课题导入公开材料，走 P8 五步（`r09_p8.mjs`） | ①文献导入（**UI**：开卷表单建条目＋导入附件）→ papers 页见条目与原文；②表格导入（**API**：本构建无表格导入 UI）首导 7 行、**同字节二导 409「已导入相同内容…已拒收」**；③方案重构来源绑定原件（API）；④执行事件 2 条追加＋样品状态 2 版＋测量（API）；⑤知识卡确认定位后**采纳落库**＋建对话（API）；五步闭环，UI 复核各页可见对象 | ✅ 通过（①UI，②–⑤ API；模型未调用，真实模型待授权） |
| R10 | 公开 vs 可写·1345ab2 | 两源同套材料逐视图比较（`r10_compare.mjs`；可写=5286 达尔文预导入课题） | 导航 8 项一致、方案主要点击路径一致（点开进详情）；**papers/protocol/record 三核心视图类名集合严格同构**；隔离成立：预存态 `/api`=0 且 `/demo-data`=37，可写态 `/demo-data`=0 且经 `/functions.../api`、选中课题为可写自己课题；其余差异为展示增量(`dx-*`)或数据内容（预存快照有知识卡/会话，可写 seed 无） | ✅ 通过（核心三视图同构＋隔离成立） |

## 2. 单元测试（`npm --prefix sciworkbench test`，实跑）

- **tests 358 / pass 357 / fail 1**（duration ~12.7s）。
- 唯一失败：`tests/reconstructed-origin.test.ts:142` 重构-6 达尔文验收夹具端到端 —— 报错「缺少内部测试包：`../test-packages/darwin-seed-saltwater`」。属**环境缺内部夹具**（`test-packages/` 不入公开仓库），非候选回归。

## 3. 请求证据汇总

| 项 | 公开静态（无 Node） | 写态（trial→Node） |
| --- | --- | --- |
| `/api/` 或 `/functions/` 命中 | **0** | 经 `/functions/v1/app/api/*` 反代（见 `logs/trial-http.txt`） |
| `/demo-data` 命中 | 47 | 0（核心视图） |
| 外部（含模型）请求 | 0 | 替身经服务端调用（见 `logs/stub.jsonl`） |

## 4. 环境启动命令（本轮实跑）

```bash
REV=1345ab2 ; AUD=F:/qoder-dev-tmp/s10-e3-$REV
node locus-site/build-web.mjs sciworkbench/public "$AUD/web-public" --mode=public "--version=public-$REV"
node locus-site/build-web.mjs sciworkbench/public "$AUD/web-trial"  --mode=trial
cp locus-site/demo-data/snapshot/state.json "$AUD/node-data/state.json"
node record/acceptance-s10/scripts/stub-model.mjs 5490 "$AUD/logs/stub.jsonl"
PORT=5284 LOCUS_DATA="$AUD/node-data/state.json" LOCUS_AI_CONFIG="$AUD/node-data/ai-config.json" \
  LOCUS_AI_BASE_URL=http://127.0.0.1:5490/v1 LOCUS_AI_MODEL=locus-audit-stub LOCUS_AI_KEY=local-audit-only node sciworkbench/server.ts
python record/acceptance-s09/scripts/serve.py "$AUD/web-public" 5380 "$AUD/logs/public-http.txt"
python record/acceptance-s09/scripts/serve_proxy.py "$AUD/web-trial" 5581 5284 "$AUD/logs/trial-http.txt"
```

## 5. 阻断缺陷（含复现与负责角色）

**B1 · R01：工作台推荐入口未把选择标记传给服务端（阻断）**
- 复现：可写态分析页取消一张候选 → 直接推荐；抓 `POST /api/analysis/tasks/:id/recommend` 请求体。
- 期望：`{workspace:true, topicId, subquestionId, core, optional:[{ref,included,version}], versions}`。
- 实测：keys 仅 `[purpose, subquestionId, optional, versions]`，**缺 `workspace`（及 `topicId`/`core`）**；服务端 `isWorkspace`（`server.ts:1594`）判定为假 → 走旧路径，按库内已存 optional（3 张全含）冻结 → 取消的卡仍入快照（UI 2 vs 快照候选 3）。
- 影响：R01 不通过；取消候选/版本校验在**前端路径**均不生效（服务端逻辑与错误码本身正确）。
- 负责角色：集成/前端接线（`sciworkbench/public/lib/pages/analysis.js` 的 `recommendMethods` 调用，及 `lib/api.js`）。

**B2 · R08：公开态窄屏横向溢出**
- 复现：公开态 390×800 打开首页。
- 实测：`documentElement.scrollWidth=511 > 390`（trial/Node 无此问题，均为 390）。
- 负责角色：C 展示与构建（`locus-site/web-overlay/display/display-extras.css`）。

## 6. 未测项 / 下一依赖

- R09 经 **API 完成 ②–⑤**（本构建无表格导入 UI 入口；测量/样品/采纳/对话的 UI 表单自动化受限）；**真实模型待授权**（本脚本未触发模型调用）；P8 完整 UI 走查（全表单）待授权后补。
- R10 的 analysis/knowledge/chat 差异为**展示增量(`dx-*`)与数据内容**（预存快照含知识卡/会话，可写 seed 无），非组件差异；如需严格同数据对比，另建同内容两源。
- R08 公开态窄屏横向溢出（docW 511>390）待 C 修后复验。
- 单测 1 失败为内部夹具缺失（`test-packages/darwin-seed-saltwater` 在本 worktree 已临时提供后用于 R09，未入库），非候选缺陷。
- 内部夹具 `sciworkbench/data/acceptance-darwin.json`、`test-packages/` 属 gitignore 私有包，**未入库**；R09 用其生成临时可写实例（`F:/qoder-dev-tmp/s10-e3-r0910/darwin-writable.json`）。

## 7. 证据位置

- `evidence/raw/`：`baseline_r01_r04.json`（R01–R04）、`r05_r10_skeleton.json`（R05–R07）、`r08_navigation.json`（R08 导航）、`r09_p8.json`（R09 五步）、`r10_compare.json`（R10 两源）。
- `evidence/screens/`：`r01_recommend.png`、`r02_onB.png`、`r02_backA.png`、`r03_fail.png`、`r04_reload.png`、`r05_public_analysis.png`、`r06_downloads.png`、`r07_regionfail.png`、`r08_{protocol,record,auto_papers,auto_analysis}.png`、`r09_ui.png`。
- 请求日志：`F:/qoder-dev-tmp/s10-e3-1345ab2/logs/`（公开/trial/stub）、`F:/qoder-dev-tmp/s10-e3-r0910/logs/`（可写实例 trial-5286）。
- 脚本：`scripts/{stub-model,baseline_r01_r04,r05_r10_skeleton,r08_navigation,r09_p8,r10_compare}.mjs`、`scripts/README.md`。
