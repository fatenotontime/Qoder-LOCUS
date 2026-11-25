#!/usr/bin/env python3
# 只做本地静态托管（不启 Node 业务后端）。每条请求写一行到 logfile，供 E1/E7 统计
# /api/ 与 /functions/ 的命中数（展示主线应为 0）。
# 用法: python serve.py <root> <port> <logfile>
import http.server, socketserver, sys, datetime

root, port, logf = sys.argv[1], int(sys.argv[2]), sys.argv[3]

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=root, **k)
    def log_message(self, fmt, *args):
        line = "%s %s %s %s\n" % (
            datetime.datetime.now().isoformat(timespec="seconds"),
            self.command, self.path, self.request_version)
        with open(logf, "a", encoding="utf-8") as f:
            f.write(line)
        sys.stderr.write(line)

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", port), H) as srv:
    srv.serve_forever()
