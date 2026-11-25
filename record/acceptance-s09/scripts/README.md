# S09 展示验收 · 脚本与启动方式（executor-e2）

环境：无头 **Edge**（Playwright `channel:msedge`）离屏；**硬断 Node**——不启任何 Node 业务后端，只用本地静态托管。
Playwright 模块取自 npx 缓存（ESM 用 `createRequire` 指定目录，可用 `PW_MODULES` 覆盖）。

## 1) 本地静态托管（逐请求写日志）

```bash
# 公开构建
node locus-site/build-web.mjs sciworkbench/public /tmp/web-public --mode=public
python record/acceptance-s09/scripts/serve.py /tmp/web-public 5280 /tmp/pub.log
# trial 构建
node locus-site/build-web.mjs sciworkbench/public /tmp/web-trial --mode=trial
python record/acceptance-s09/scripts/serve.py /tmp/web-trial 5281 /tmp/trial.log
```

## 2) 运行验收

```bash
BASE=http://127.0.0.1:5280 TRIAL=http://127.0.0.1:5281 \
OUT="$(pwd)/record/acceptance-s09/evidence" EVRAF=/tmp \
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
node record/acceptance-s09/scripts/accept.mjs   # E1–E7，结果写 evidence/raw/accept.json
```

`e1.mjs` 为 E1 的独立最小脚本。断引用复测：复制生成物到临时副本、改断一条引用（如改某卡 `assetId` 为不存在）另起端口（如 5282）比对。

## 2b) E4 复验（新候选）

```bash
git merge --no-edit feat/s08-public-demo            # 并入集成分支（不能 ff 时用 merge）
node locus-site/build-web.mjs sciworkbench/public /tmp/web-public --mode=public
node locus-site/build-web.mjs sciworkbench/public /tmp/web-trial  --mode=trial
# 重启 5280/5281 静态服务后：
BASE=http://127.0.0.1:5280 TRIAL=http://127.0.0.1:5281 \
OUT="$(pwd)/record/acceptance-s09/evidence" \
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
node record/acceptance-s09/scripts/e4_retest.mjs    # E4 复验 + E1/E5/E6-trial 回归抽检 → evidence/raw/e4_retest.json
```

## 3) 端口

避开仓库既有 5187/5191/5184；本报告用 5280（public）/5281（trial）/5282（断引用副本）。
