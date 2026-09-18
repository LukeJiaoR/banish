#!/usr/bin/env python3
"""开发用静态服务器：禁用缓存，避免改代码后浏览器使用旧文件。
用法: python3 dev-server.py [端口]  (默认 8613)"""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8613


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
