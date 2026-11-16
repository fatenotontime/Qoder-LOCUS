# 阶段0 · 旧改动保护清单

> 目标：确保阶段0 及后续开发**不破坏**用户既有工作。旧仓库仅作只读输入，竞赛仓库历史不被重写。

## 1. 旧仓库（只读，绝对冻结）

**路径**：`E:\GLM工作区\sciworkbench\intergration\research workbench\`

| 子路径 | 性质 | 保护规则 |
| --- | --- | --- |
| `personal/` | 独立旧仓库（**当前无 `.git`**，纯文件快照） | 只读；不修改/删除/移动任何文件；不读 `data/`、`.env*`、`.venv/` |
| `release/` | 打包版（无 `.git`） | 只读；同上 |
| 顶层治理文档 | ARCHITECTURE/DECISIONS/STATUS/AGENTS.md | 只读参考 |
| `docs/`、`plugin-agent-handoff/` | 设计/交接 | 只读参考 |

**证据（`[已核]`）**：
- `git rev-parse` 在 `research workbench/`、`personal/`、`release/` 均返回 *not a git repository* → **不能依赖 Git 回滚**，需另外的恢复措施（本轮以文件级只读基线 `OLD_REPO_MANIFEST.txt` 兜底）。
- STATUS.md（2026-09-11）记载 `personal` main 曾超前 origin 24 提交且有未跟踪文件 → 历史状态复杂，不得清理。
- 只读保护基线：`docs/stage0/OLD_REPO_MANIFEST.txt`（sha256+大小+路径，排除 `.venv`/`data`/缓存）。

**红线**：
- 不清理、不提交、不搬迁旧仓库任何内容。
- 不把旧 `personal`/`release` 作为竞赛仓库的 remote、submodule、subtree 或构建输入。
- 不复制旧 `data/`、缓存、`.venv`、构建物、`.git` 进竞赛仓库。

## 2. 邻近目录（不在授权范围，一律不动）

| 路径 | 说明 |
| --- | --- |
| `E:\GLM工作区\archify`、`workbench 架构`、`workbench-loop-replica`、`workbench-plugins` | 其他历史工作区，非本竞赛输入 |
| `E:\GLM工作区\sciworkbench\task\**` | 含多个内嵌 `.git` 的独立任务仓，**不触碰** |
| `E:\SRTP` | **私人 SRTP，禁止读取**（D01 红线） |
| `E:\GLM工作区\professor comment`、`reviewer judge.md` 等 | 导师/评审材料，不公开、不入库 |

## 3. 竞赛仓库（`F:\Qoder dev competition`）

| 条目 | 保护规则 |
| --- | --- |
| 已推送历史（`2c9bfac`→…） | 不 rebase/amend 已推送提交 |
| `record/` 台账既有条目 | 不删改他人既有条目；修正走"修订"条目 |
| `prompt/`、`reference reseach data/` | 指令包与样本包原样保留，不改内容 |
| 分支 | 他人分支不强推、不删 |

## 4. 已验证未改动事实（本轮）

- 本轮对旧仓库**只执行读操作**（`ls`/`find`/`sha256sum`/`git rev-parse`/读取源码文本），**未写入任何文件**。
- 竞赛仓库本轮新增：`AGENTS.md`（由 AGENT.md 改名）、`docs/stage0/*`。其余目录未动。
- 样本包 6 个 ZIP 只做 `sha256sum` 读取校验，**未解压、未修改**。

## 5. 回归检查建议（写入 CI/流程）

1. 修改旧仓库前 → 对 `OLD_REPO_MANIFEST.txt` 抽样 `sha256sum` 比对，出现差异即告警。
2. 提交竞赛仓库前 → `git status` 确认未误纳 `.venv`/`data`/密钥。
3. 任何声称"已改旧仓库"的动作 → 默认禁止，需用户显式授权且走 patch 提案。
