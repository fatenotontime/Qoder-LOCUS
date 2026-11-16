# 阶段0 · 恢复与盘点 — 交付报告

> 会话/轮次：`S01-T5` ｜ 日期：2026-11-16 ｜ 制定依据：`stages/00_PROMPT.md` + `01_SYSTEM_PROMPT.md` + `00_START_HERE.md` + 02–05 + 10。
> 结论口径：**本阶段为文档/盘点交付，不是网站已实现/已上线/已部署**。

## 一、一句话结论

独立竞赛仓库与 AGENTS 已确认（不在旧 personal/release 上修补）；指令包 00–10 + sources 已通读并提炼为结构化知识库；旧仓库只读盘点完成（Gradio 应用「研迹」）；公开样本三案 **approved 且完整性实测通过**；**未大规模改代码**（仅新增文档与改名 1 个文件）。

## 二、需求ID 对照（K03 交付项）

| 需求 | 状态 | 产物 |
| --- | --- | --- |
| 读取 00–05、10、sources，最新决议覆盖旧记录 | 完成 | `01_KNOWLEDGE_BASE.md` §1 |
| 确认独立竞赛仓库路径及 AGENTS，不在旧仓库修补 | 完成 | 见 §三 |
| 只读盘点旧功能/依赖/继承/缺陷/失败 + 证据 | 完成 | `01_KNOWLEDGE_BASE.md` §6–§8 |
| 确认公开样本 approved 状态和路径 | 完成 | `04_VERIFY_ITEMS.md` §4 |
| 结构化知识库 | 完成 | `01_KNOWLEDGE_BASE.md` |
| 功能映射 | 完成 | `02_FEATURE_MAP.md` |
| 旧改动保护清单 | 完成 | `03_PROTECTION_LIST.md` + `OLD_REPO_MANIFEST.txt` |
| 待验证清单 | 完成 | `04_VERIFY_ITEMS.md` |
| 不大规模改代码 | 遵守 | 本阶段仅文档 |
| 技术栈不锁 Gradio；Repo Wiki 暂缓 | 记录 | `01` §8、`04` §6 |
| 未通过样本不得用私人 SRTP 替补 | 遵守 | 未读 SRTP |

## 三、关键确认（实测证据）

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 独立竞赛仓库 | `F:\Qoder dev competition`，git 仓库，remote `origin → github.com/fatenotontime/Qoder-LOCUS` | `git remote -v` / `git status` `[已核]` |
| AGENTS | 仓库根 `AGENTS.md`（本轮由 `AGENT.md` 改名） | 文件存在 `[已核]` |
| 旧仓库 | `E:\GLM工作区\sciworkbench\intergration\research workbench\{personal,release}`；**无 `.git`** | `git rev-parse` 三处均 not a repo `[已核]` |
| 未在旧仓库修补 | 本轮对旧仓库**只读**，零写入 | 见 `03` §4 `[已核]` |
| 样本 approved | 三案 approved，SLAC 主展示 | 用户确认 + `04` §4 |
| 样本完整性 | 6 ZIP SHA256 与 `FILE_SHA256.txt` **全一致**，CRC 全 OK | 实测 `sha256sum` `[已核]` |

## 四、变更文件（本阶段）

新增（竞赛仓库）：
- `AGENTS.md`（由 `AGENT.md` git mv 改名，内容不变）
- `docs/stage0/00_STAGE0_REPORT.md`（本文件）
- `docs/stage0/01_KNOWLEDGE_BASE.md`
- `docs/stage0/02_FEATURE_MAP.md`
- `docs/stage0/03_PROTECTION_LIST.md`
- `docs/stage0/04_VERIFY_ITEMS.md`
- `docs/stage0/OLD_REPO_MANIFEST.txt`（旧仓库只读保护基线，185 行，源码/文档范围）
- `record/COMMIT_LEDGER.md`、`record/sessions/…`（按 AGENTS.md 规范更新）

提交：见 `record/COMMIT_LEDGER.md` 中 `S01-T5` 行（trailer `Turn: S01-T5`）。

## 五、实际测试/校验证据

1. 样本哈希：6 个 ZIP `sha256sum` → 与 `FILE_SHA256.txt` 逐一相等。`[已核]`
2. 旧仓库版本控制：`git -C <3 路径> rev-parse` → not a git repository。`[已核]`
3. 旧仓库结构：`ls`/`find`/`wc -l` 得到模块清单（`01` §6）。`[已核]`
4. 旧仓库源码：只读读取 `note_parser.py`/`data_processing.py`/`experiment_records.py` 全文 + 其余按符号检索。`[已核]`
5. 保护基线：`OLD_REPO_MANIFEST.txt`（sha256+size+path，排除 .venv/data/缓存）。`[已核]`
6. 竞赛仓库状态：`git status`/`git remote -v`。`[已核]`

## 六、未运行 / 失败 / 限制

- **未运行**：ENV01–12、M01–M10、T01–T27、I-V01–V13 全部（本阶段不涉及代码与环境实操）。
- **限制**：旧仓库无 `.git`，**不能依赖 Git 回滚**既有改动，需**另外的恢复措施**（本轮以文件级只读基线 `OLD_REPO_MANIFEST.txt` 兜底）。
- **样本审核记录**：用户已补入 `prompt/…/SAMPLE_REVIEW.md` 与 `11_HANDWRITING_STATUS.md`。**三态严格分开**：材料审核通过=`SAMPLE_REVIEW.md` 所列范围（SLAC/Chymotrypsin/CotA，SLAC 主展示）；用户最终验收=独立事项，未据此宣布；OCR 通过=**未达成**（无合格手写集）。
- **未读（红线遵守）**：旧仓库 `data/`、`.env*`、`.venv/`，以及 `E:\SRTP`。
- **不是完成声明**：文档覆盖表验证"文档有条目"，不代表实现符合。

## 七、ADR / 人工干预

| 类型 | 内容 |
| --- | --- |
| 人工干预 | 用户授权只读深读旧仓库；用户要求 `AGENT.md`→`AGENTS.md`；**用户决定 Pro/Sites 实测时机=阶段6之后** |
| 三态严格分开 | **材料审核通过**（`SAMPLE_REVIEW.md`）=材料层面；**用户最终验收**=另一件事，本阶段用户仅"认可该审核记录的口径"，不等于最终验收；**OCR 通过**=未达成 |
| 决策(ADR 候补) | **ADR-0001**：独立竞赛仓库 `F:\Qoder dev competition`，不复用旧 personal/release（依据 01 SYSTEM_PROMPT + K01） |
| 决策(ADR 候补) | **ADR-0002**：旧仓库只读冻结，不纳入竞赛仓库（依据 WB-002 + 本清单） |
| 决策(ADR 候补) | **ADR-0003**：记录主线=git 提交历史、双线记录（依据 AGENTS.md） |
| 待立项 ADR | 运行存储架构、实体/版本与原件策略、影响传播边类型、模板复用、解析/模型选型、会话身份与额度、报告引用边界、导出恢复、公开数据许可（03 §ADR要求） |

## 八、时序安排与下一阶段依赖（修正）

> **Pro / Sites 环境实测时机（用户 2026-11-16 决定）**：安排在 **阶段6 之后**进入 Pro，随后持续开发。阶段1–6 以**本地可逆开发与架构**为主。**不再把"下一步=登录 Pro / 做 Sites 实测"当作紧邻动作**（此前阶段1 直接排 Pro 实测为旧安排，已作废）。

- **紧接下一阶段** = **阶段2 架构与运行契约**（本地、可逆，不越权云发布）。
- 其余依赖：模型服务方案（开发/运行模型分离，Q04/Q06/ENV07）；ECS 是否纳入（默认不纳入，ENV10 待用户批准）。

## 九、外部副作用待审批

**本阶段无任何外部副作用**：未发布、未付费、未改服务器/安全组、未发外部消息、未创建云资源。后续一切发布/付费/服务器操作按授权执行。
