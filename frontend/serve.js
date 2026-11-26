// Tiny static file server for the frontend (no dependencies):  node frontend/serve.js  -> http://127.0.0.1:5173
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = __dirname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(root, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(root + path.sep) || file.endsWith("serve.js")) { res.writeHead(403); return res.end("forbidden"); } // no path traversal
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    res.end(data);
  });
}).listen(Number(process.env.PORT || 5173), "127.0.0.1", () => console.log("frontend on http://127.0.0.1:" + (process.env.PORT || 5173)));
