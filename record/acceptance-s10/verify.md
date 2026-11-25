# S10 本地展示整改 · 独立验收台账（executor-e3）

> 反例格式：**模式与候选版本 → 点击或输入 → 实际状态／文件 → 判定**。
> 取证：DOM／请求体／替身日志／文件哈希，不用截图代替结论。本地环境与 Site 发布环境**分开记**。

## 0. 冻结信息

| 项 | 值 |
| --- | --- |
| 候选分支 / HEAD | `feat/s08-public-demo` · `c0c9c0c`（并入 e3 后 HEAD `be8b3c4`，merge commit） |
| 构建版本 | `public-be8b3c4` |
| 公开静态入口 | `http://127.0.0.1:5380/`（`--mode=public`，**无 Node**） |
| trial 入口（→ 原生 Node） | `http://127.0.0.1:5581/`（反代 `/functions/v1/app/api/*`→5284）；可写实例 trial `http://127.0.0.1:5582/`（→5286 达尔文预导入） |
| 原生 Node 入口 | `http://127.0.0.1:5284/`（快照副本）；可写 `5286`（`acceptance-darwin.ts` 预导入） |
| 模型替身 | `http://127.0.0.1:5490/v1`（`stub-model.mjs`；`knowledge_struct` 延迟 8s） |
| 临时目录 | `F:/qoder-dev-tmp/s10-e3-be8b3c4`（公开/trial/快照副本）；`F:/qoder-dev-tmp/s10-e3-r0910`（可写实例） |
| 端口说明 | 本轮用 5380/5581/5582/5284/5286/5490，均先探测空闲；不碰 5184/5187/5191 |

## 1. R01–R10 验收表

| 编号 | 模式·版本 | 实际操作 | 实际状态／文件 | 判定 |
| --- | --- | --- | --- | --- |
| R01 | 可写·be8b3c4 | 分析页取消「作者修正意见」→ 直接推荐；空子问题建任务；版本冲探针 | 前端推荐请求体 keys=`[purpose,workspace,topicId,subquestionId,core,optional,versions]`（**含 `workspace:true`/`topicId`/`core`**）；替身收到冻结快照为**「候选 2」=UI 勾选 2**（取消的卡不入快照）；`workspace:true` 建任务空子问题→**422 subquestion_required**；版本冲→**409 selection_stale**（保留选择） | ✅ 通过（B 修已生效） |
| R02 | 可写·be8b3c4 | A（达尔文）发起提取（run kr_81dc1e08，2 块）→ 切空课题 B → 等 9.5s → 回 A | B 页 `kz-paper=「本课题暂无文献」`、0 卡、队列空、`leaksA=false`；回 A 队列见其任务与替身卡，`finalRun=completed` | ✅ 通过 |
| R03 | 可写·be8b3c4 | 两行填值只存第 1 行；events 503 复点；取消拦截重试 | 保存后 row1=`R03-ROW1`、**row2=`R03-ROW2` 保留**、事件 4→5；失败后输入保留 `R03-FAIL`、行旁 `.rowerr=「未保存，请重试」`可见、状态「记录步骤失败」；重试事件 5→6（**只追加一次**） | ✅ 通过 |
| R04 | 可写·be8b3c4 | UI 发起提取 → 提取中填卡备注（仅 input）→ 切页/返回 → 刷新 | 提取中舞台 `working(0/2)`；返回后备注仍 `R04-未保存备注`、舞台 `working`、卡仍展开；刷新后 `working(1/2)`（**按已存 runId 找回**） | ✅ 通过 |
| R05 | 公开·be8b3c4（无 Node） | 打开首页，遍历 library/papers/protocol/record/analysis/chat | `theme=paper`、`displayMode=on`、badge「展示课题·只读」、8 导航；分析页数值贯通链「榛子（干燥后漂浮）=90 days」6 跳 + 2 导出链接；全程 **`/api`=0、`/demo-data`=47、外链=0** | ✅ 通过 |
| R06 | 公开·be8b3c4 | 点第一跳；下载 Word/追溯包/样本 ZIP | 首跳可点（右栏出方案示意图）；下载成功：`report.docx` 1863B、`traceability.zip` 6378B、`locus-demo-public.zip` 33855B（sha256 前16 `5362d30267b23a98`，与构建一致） | ✅ 通过 |
| R07 | 公开·be8b3c4 | 拦 `chain-90d.json` 返回 404 后重载 → 打开样本 ZIP → 取消拦截重试 | 受影响区域出 `.dx-fail`「该区域暂时加载失败（引用文件不可读）。」+ 重试按钮；样本 ZIP 仍下载 33855B；重试后链恢复 6 跳 | ✅ 通过 |
| R08 | 三入口·be8b3c4 | 三入口各开设置；Esc 关闭；390×800 窄屏；列表→详情→返回/浏览器后退/刷新（`r08_navigation.mjs`） | 三入口设置均可开、Esc 焦点归还 `settings-open`；**protocol/record：点开详情→哈希 `#/nav/id`→返回按钮→浏览器后退→刷新恢复 全通过**；papers/analysis 进入即自动选中首项（不写详情哈希，刷新靠 localStorage 回同卷，非阻断）；窄屏 **公开/trial/Node 均 docW=390 无横向溢出**（C 修已生效） | ✅ 通过 |
| R09 | 可写·be8b3c4（+达尔文预导入实例 5286） | 新建可写课题导入公开材料，走 P8 五步（`r09_p8.mjs`） | ①文献导入（**UI**：开卷表单建条目＋导入附件）→ papers 页见条目与原文；②表格导入（**API**：本构建无表格导入 UI）首导 7 行、**同字节二导 409「已导入相同内容…已拒收」**；③方案重构来源绑定原件（API）；④执行事件 2 条追加＋样品状态 2 版＋测量（API）；⑤知识卡确认定位后**采纳落库**＋建对话（API）；五步闭环，UI 复核各页可见对象 | ✅ 通过（①UI，②–⑤ API；模型未调用，真实模型待授权） |
| R10 | 公开 vs 可写·be8b3c4 | 两源同套材料逐视图比较（`r10_compare.mjs`；可写=5286 达尔文预导入课题） | 导航 8 项一致、方案主要点击路径一致（点开进详情）；**papers/protocol/record 三核心视图类名集合严格同构**；隔离成立：预存态 `/api`=0 且 `/demo-data`=37，可写态 `/demo-data`=0 且经 `/functions.../api`、选中课题为可写自己课题；其余差异为展示增量(`dx-*`)或数据内容（预存快照有知识卡/会话，可写 seed 无） | ✅ 通过（核心三视图同构＋隔离成立） |

## 2. 单元测试（`npm --prefix sciworkbench test`，实跑）

- **tests 358 / pass 358 / fail 0**（duration ~12.6s；候选 `be8b3c4`）。
- 说明：全绿前提是**本机存在内部夹具** `test-packages/darwin-seed-saltwater`（本轮为跑 R09 临时复制到 worktree，私有包 gitignore，未入库）；夹具缺失时 `reconstructed-origin.test.ts` 会报「缺少内部测试包」。

## 3. 请求证据汇总

| 项 | 公开静态（无 Node） | 写态（trial→Node） |
| --- | --- | --- |
| `/api/` 或 `/functions/` 命中 | **0** | 经 `/functions/v1/app/api/*` 反代（见 `logs/trial-http.txt`） |
| `/demo-data` 命中 | 47 | 0（核心视图） |
| 外部（含模型）请求 | 0 | 替身经服务端调用（见 `logs/stub.jsonl`） |

## 4. 环境启动命令（本轮实跑）

```bash
REV=be8b3c4 ; AUD=F:/qoder-dev-tmp/s10-e3-$REV
node locus-site/build-web.mjs sciworkbench/public "$AUD/web-public" --mode=public "--version=public-$REV"
node locus-site/build-web.mjs sciworkbench/public "$AUD/web-trial"  --mode=trial
cp locus-site/demo-data/snapshot/state.json "$AUD/node-data/state.json"
node record/acceptance-s10/scripts/stub-model.mjs 5490 "$AUD/logs/stub.jsonl"
PORT=5284 LOCUS_DATA="$AUD/node-data/state.json" LOCUS_AI_CONFIG="$AUD/node-data/ai-config.json" \
  LOCUS_AI_BASE_URL=http://127.0.0.1:5490/v1 LOCUS_AI_MODEL=locus-audit-stub LOCUS_AI_KEY=local-audit-only node sciworkbench/server.ts
python record/acceptance-s09/scripts/serve.py "$AUD/web-public" 5380 "$AUD/logs/public-http.txt"
python record/acceptance-s09/scripts/serve_proxy.py "$AUD/web-trial" 5581 5284 "$AUD/logs/trial-http.txt"
```

## 5. 缺陷关闭记录（本轮两处已修复并复验关闭）

**B1 · R01（已在 `c0c9c0c` 修复，复验通过）**
- 修复：`analysis.js` 新增 `workspaceSelection()`，推荐请求体带 `workspace:true/topicId/subquestionId/core/optional/versions`；建任务带 `workspace:true`。
- 复验（`be8b3c4`）：请求体 keys 含上述全字段；冻结快照「候选 2」= UI 勾选 2（取消卡不入快照）；空子问题 422 `subquestion_required`；版本冲 409 `selection_stale`。

**B2 · R08 公开态窄屏横向溢出（已在 `c0c9c0c` 修复，复验通过）**
- 修复：`display-extras.css` 在 ≤720px 收起顶栏只读徽标、长 code 换行。
- 复验（`be8b3c4`）：公开/trial/Node 390×800 均 `docW=390`、无横向溢出。

## 6. 未测项 / 下一依赖

- R09 经 **API 完成 ②–⑤**（本构建无表格导入 UI 入口；测量/样品/采纳/对话的 UI 表单自动化受限）；**真实模型待授权**（本脚本未触发模型调用）；P8 完整 UI 全表单走查待授权后补。
- R10 的 analysis/knowledge/chat 差异为**展示增量(`dx-*`)与数据内容**（预存快照含知识卡/会话，可写 seed 无），非组件差异；如需严格同数据对比，另建同内容两源。
- 单测全绿依赖本机内部夹具 `test-packages/darwin-seed-saltwater`（私有，未入库）；缺夹具时对应测试会报「缺少内部测试包」。
- 内部夹具 `sciworkbench/data/acceptance-darwin.json`、`test-packages/` 属 gitignore 私有包，**未入库**；R09 用其生成临时可写实例（`F:/qoder-dev-tmp/s10-e3-r0910/darwin-writable.json`）。

## 7. 证据位置

- `evidence/raw/`：`baseline_r01_r04.json`（R01–R04）、`r05_r10_skeleton.json`（R05–R07）、`r08_navigation.json`（R08 导航）、`r09_p8.json`（R09 五步）、`r10_compare.json`（R10 两源）。
- `evidence/screens/`：`r01_recommend.png`、`r02_onB.png`、`r02_backA.png`、`r03_fail.png`、`r04_reload.png`、`r05_public_analysis.png`、`r06_downloads.png`、`r07_regionfail.png`、`r08_{protocol,record,auto_papers,auto_analysis}.png`、`r09_ui.png`。
- 请求日志：`F:/qoder-dev-tmp/s10-e3-be8b3c4/logs/`（公开/trial/stub）、`F:/qoder-dev-tmp/s10-e3-r0910/logs/`（可写实例 trial-5286）。
- 脚本：`scripts/{stub-model,baseline_r01_r04,r05_r10_skeleton,r08_navigation,r09_p8,r10_compare}.mjs`、`scripts/README.md`。
