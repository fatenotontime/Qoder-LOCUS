#!/usr/bin/env bash
# S08 取证骨架：静态服务 + 无头 Edge 截图与 NetLog（不依赖 Node）。
# 用法：
#   bash smoke-capture.sh <生成物目录> <证据输出目录> <本地服务地址> [视口,默认1440x900] [页面路径,默认/]
# 例：
#   bash smoke-capture.sh "F:/Qoder dev competition/.worktrees/d/locus-site/web-demo" "record/acceptance-s08/evidence" "http://127.0.0.1:8799" 1440x900 /
# 产物：<out>/server.log、<out>/netlog.json、<out>/shot.png、<out>/hosts.txt、<out>/api-hits.txt
set -u

SITE_DIR="${1:?生成物目录}"
OUT_DIR="${2:?证据输出目录}"
BASE_URL="${3:?本地服务地址，如 http://127.0.0.1:8799}"
VIEWPORT="${4:-1440x900}"
PAGE_PATH="${5:-/}"

EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
[ -x "$EDGE" ] || EDGE="/c/Program Files/Microsoft/Edge/Application/msedge.exe"
[ -x "$EDGE" ] || { echo "找不到 Edge"; exit 1; }

PY="$(command -v python || true)"
[ -n "$PY" ] || PY="/f/python3.13/python"

PORT="$(echo "$BASE_URL" | sed -E 's#.*:([0-9]+).*#\1#')"
mkdir -p "$OUT_DIR"
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/e-edge-profile.XXXXXX")"
SERVER_LOG="$OUT_DIR/server.log"
: > "$SERVER_LOG"

# 1) 仅本机静态服务（不启动任何 Node 后端）
NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 \
  "$PY" -m http.server "$PORT" --directory "$SITE_DIR" >> "$SERVER_LOG" 2>&1 &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null; rm -rf "$PROFILE"' EXIT

# 等端口就绪
for _ in $(seq 1 30); do
  curl -s -o /dev/null "$BASE_URL/" && break
  sleep 0.2
done

# 2) 无头 Edge：阻断外部解析、仅放行 127.0.0.1；Default 模式（不抓凭据）
"$EDGE" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --disable-background-networking --disable-component-update --disable-sync \
  --disable-domain-reliability --disable-client-side-phishing-detection \
  --disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions \
  --user-data-dir="$PROFILE" \
  --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1" \
  --log-net-log="$OUT_DIR/netlog.json" --net-log-capture-mode=Default \
  --virtual-time-budget=8000 \
  --screenshot="$OUT_DIR/shot.png" --window-size="${VIEWPORT/x/,}" \
  "$BASE_URL$PAGE_PATH" >/dev/null 2>&1

# 3) 判读：触达后端? 外部主机?
grep -nE "/api/|/functions/" "$SERVER_LOG" > "$OUT_DIR/api-hits.txt" || true
grep -oE 'https?://[A-Za-z0-9._-]+(:[0-9]+)?' "$OUT_DIR/netlog.json" 2>/dev/null \
  | sort -u | grep -vE '://(127\.0\.0\.1|localhost)' > "$OUT_DIR/hosts-all.txt" || true
# 浏览器/本机自带噪声白名单（与本页无关；raw 全量见 hosts-all.txt，仍逐次人工确认无遗漏）
grep -vE '://(edge\.microsoft\.com|config\.edge\.skype\.com|clients2\.google\.com|clients2\.googleusercontent\.com|cn\.bing\.com|bing\.com|csp\.withgoogle\.com|google\.com|googleusercontent\.com|microsoft\.com|me\.kis\.v2\.scr\.kaspersky-labs\.com)' \
  "$OUT_DIR/hosts-all.txt" > "$OUT_DIR/hosts.txt" || true

echo "== 产出 =="
echo "  $OUT_DIR/server.log  $OUT_DIR/netlog.json  $OUT_DIR/shot.png"
echo "  api-hits.txt（期望空） / hosts.txt（期望空或逐条说明）"
