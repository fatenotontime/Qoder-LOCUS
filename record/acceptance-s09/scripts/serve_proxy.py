#!/usr/bin/env python3
# E8 本地拓扑：静态托管 trial 构建 + 把 /functions/v1/app/api/* 反代到本地后端 /api/*
# （模拟生产链路：浏览器 → Site 静态 + Site 函数 → 后端。本地无 Site 函数，故反代到 127.0.0.1:<backend>）
# 用法: python serve_proxy.py <static_root> <listen_port> <backend_port> <logfile>
import http.server, socketserver, sys, datetime, http.client, urllib.parse

root, port, backend, logf = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
PREFIX = "/functions/v1/app/api/"

def log(line):
    with open(logf, "a", encoding="utf-8") as f:
        f.write(line + "\n")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=root, **k)

    def log_message(self, fmt, *args):
        log("%s %s %s %s" % (datetime.datetime.now().isoformat(timespec="seconds"),
                              self.command, self.path, self.request_version))

    def _proxy(self):
        assert self.path.startswith(PREFIX)
        target = "/api/" + self.path[len(PREFIX):]
        body = None
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            body = self.rfile.read(n)
        conn = http.client.HTTPConnection("127.0.0.1", backend, timeout=30)
        hdr = {k: v for k, v in self.headers.items()
               if k.lower() not in ("host", "connection", "accept-encoding")}
        conn.request(self.command, target, body=body, headers=hdr)
        r = conn.getresponse()
        data = r.read()
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() in ("transfer-encoding", "connection", "content-length", "content-encoding"):
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)
        conn.close()

    def do_GET(self):  self._proxy() if self.path.startswith(PREFIX) else super().do_GET()
    def do_HEAD(self): self._proxy() if self.path.startswith(PREFIX) else super().do_HEAD()
    def do_POST(self): self._proxy() if self.path.startswith(PREFIX) else self.send_error(404)
    def do_PUT(self):  self._proxy() if self.path.startswith(PREFIX) else self.send_error(404)
    def do_DELETE(self): self._proxy() if self.path.startswith(PREFIX) else self.send_error(404)

socketserver.TCPServer.allow_reuse_address = True
log("== E8 proxy up: static=%s listen=%d backend=%d ==" % (root, port, backend))
with socketserver.ThreadingTCPServer(("127.0.0.1", port), H) as srv:
    srv.serve_forever()
