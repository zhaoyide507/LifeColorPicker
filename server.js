// ═══════════ 采色生活 · 本地服务（Node 版，零依赖） ═══════════
// 作用：
//   1. 静态托管本目录网页（绑定 0.0.0.0，手机同一 Wi-Fi 下可通过 http://电脑IP:端口 访问）；
//   2. 提供同源代理通道 /proxy/deepseek 与 /proxy/volcano，
//      手机等非安全上下文环境下跨域直连受限时，由本机转发请求给模型服务商。
// 用法：node server.js [端口]     （默认 7778）

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 7778;

// 仅允许转发到这两个固定的模型服务商接口
const PROXY_ROUTES = {
  "/proxy/deepseek": "https://api.deepseek.com/chat/completions",
  "/proxy/volcano": "https://visual.volcengineapi.com",
};
const FORWARD_HEADERS = ["content-type", "authorization", "x-date", "x-content-sha256"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function relay(res, status, data, contentType) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  res.writeHead(status, {
    "Content-Type": contentType || "application/json",
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(buf);
}

// ── 代理转发 ──
function proxy(req, res) {
  const u = new URL(req.url, "http://localhost");
  const target = PROXY_ROUTES[u.pathname];
  if (!target) return relay(res, 404, JSON.stringify({ error: "unknown proxy route" }));

  const upstream = new URL(target);
  upstream.search = u.search;

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    console.log("[proxy] ->", upstream.href.slice(0, 90), `(${body.length} bytes)`);
    const headers = { "Accept": "application/json", "Content-Length": body.length };
    for (const name of FORWARD_HEADERS) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const preq = https.request(upstream, { method: "POST", headers, timeout: 300000 }, (pres) => {
      const out = [];
      pres.on("data", (c) => out.push(c));
      pres.on("end", () => relay(res, pres.statusCode, Buffer.concat(out), pres.headers["content-type"]));
    });
    preq.on("timeout", () => preq.destroy(new Error("upstream timeout")));
    preq.on("error", (e) => relay(res, 502, JSON.stringify({ proxy_error: String(e.message || e) })));
    preq.end(body);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Date, X-Content-Sha256",
    });
    return res.end();
  }
  if (req.method === "POST" && req.url.startsWith("/proxy/")) return proxy(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("405 Method Not Allowed");
  }

  // ── 静态文件 ──
  let urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (urlPath.endsWith("/")) urlPath += "index.html";
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("403 Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    relay(res, 200, data, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`采色生活 · http://localhost:${PORT}  （手机请访问 http://<电脑IP>:${PORT}）`);
});
