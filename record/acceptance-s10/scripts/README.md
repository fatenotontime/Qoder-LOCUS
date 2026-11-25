# S10 本地展示整改 · 验收脚本与启动方式（executor-e3）

环境复用 `record/acceptance-s09/scripts/` 的 `serve.py`（纯静态）与 `serve_proxy.py`
（静态 + `/functions/v1/app/api/*` 反代到原生 Node）。无头 **Edge**（Playwright `channel:msedge`）离屏。
Playwright 模块取自 npx 缓存（ESM 用 `createRequire` 指定目录，可用 `PW_MODULES` 覆盖）。

## 0. 端口约定（避开 5184/5187/5191，以及本机已被其他角色占用的 5280/5283/5290）

| 角色 | 本报告端口 | 说明 |
| --- | --- | --- |
| 公开静态 | `5380` | 只托管 `web-public`，**无 Node** |
| trial 反代 | `5281` | 托管 `web-trial` + 反代到原生 Node |
| 原生 Node | `5284` | `sciworkbench/server.ts` 可写后端 |
| 模型替身 | `5490` | `stub-model.mjs`，OpenAI 兼容 `/v1/chat/completions` |

> 实测时 `5280` 与 `5290` 已被并行角色占用（b3 的 serve / stub），故改用上表端口。任何端口同样以先探测空闲为准。

## 1. 构建与数据副本

```bash
REV=$(git rev-parse --short HEAD)
AUD="F:/qoder-dev-tmp/s10-e3-$REV"
mkdir -p "$AUD/node-data" "$AUD/logs"
node locus-site/build-web.mjs sciworkbench/public "$AUD/web-public" --mode=public "--version=public-$REV"
node locus-site/build-web.mjs sciworkbench/public "$AUD/web-trial"  --mode=trial
cp locus-site/demo-data/snapshot/state.json "$AUD/node-data/state.json"   # 可写验收数据副本
# 每次需还原样本：停掉本轮 Node 后，用上面 cp 重新覆盖 state.json，再重启 Node。
```

## 2. 启动四类服务（各自独立终端）

```bash
# (a) 模型替身
node record/acceptance-s10/scripts/stub-model.mjs 5490 "$AUD/logs/stub.jsonl"

# (b) 原生 Node（AI 指向替身）
export PORT=5284 LOCUS_DATA="$AUD/node-data/state.json" LOCUS_AI_CONFIG="$AUD/node-data/ai-config.json" \
       LOCUS_AI_BASE_URL="http://127.0.0.1:5490/v1" LOCUS_AI_MODEL="locus-audit-stub" LOCUS_AI_KEY="local-audit-only" \
       NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
node sciworkbench/server.ts

# (c) 公开静态（无 Node）
python record/acceptance-s09/scripts/serve.py "$AUD/web-public" 5380 "$AUD/logs/public-http.txt"

# (d) trial 反代（→ 原生 Node）
python record/acceptance-s09/scripts/serve_proxy.py "$AUD/web-trial" 5281 5284 "$AUD/logs/trial-http.txt"
```

## 3. 运行验收

```bash
# R01–R04 基线（已实现）
TRIAL=http://127.0.0.1:5281 NODE=http://127.0.0.1:5284 STUBLOG="$AUD/logs/stub.jsonl" \
OUT="$(pwd)/record/acceptance-s10/evidence" EVRAF="$AUD" \
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
node record/acceptance-s10/scripts/baseline_r01_r04.mjs   # → evidence/raw/baseline_r01_r04.json

# R05–R10 骨架（入口/选择器待新候选更新）
TRIAL=... NODE=... PUBLIC=... STUBLOG=... OUT=... EVRAF=... \
node record/acceptance-s10/scripts/r05_r10_skeleton.mjs
```

## 4. 脚本清单

| 文件 | 作用 |
| --- | --- |
| `stub-model.mjs` | 本机 OpenAI 兼容替身：按 system 判任务；`knowledge_struct` 延迟 8s 返回 1 张合法卡；`analysis_recommend` 返回固定方法；记录输入正文与请求次数到 jsonl |
| `baseline_r01_r04.mjs` | R01–R04 实测（可用） |
| `r05_r10_skeleton.mjs` | R05–R10 可重跑骨架（选择器/断言按新入口补全） |

## 5. 注意

- 本机 `Date.now()/performance.now()` 在虚拟时钟下可能恒为 0；帧时从外部墙钟拟合。
- 页面内请求不出现替身命中（替身由 Node 服务端调用），核对替身输入请读 `$AUD/logs/stub.jsonl`。
- 用完停掉本轮启动的 Node / 静态 / 反代 / 替身；不碰其他角色的端口。
