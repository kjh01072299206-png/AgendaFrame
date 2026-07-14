import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";

const port = 4321;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ status: "ok", mode: "demo", dataAsOf: null, collection: { method: "manual_csv", directCrawling: false, configuredSources: 5, articleCount: 0, latestSourceCount: 0, latestStatus: "awaiting_import" } }));
      return;
    }
    if (pathname === "/api/import") {
      response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "로컬 미리보기에서는 D1 가져오기를 사용할 수 없습니다." }));
      return;
    }
    const requested = pathname === "/" ? "index.html" : pathname === "/admin" || pathname === "/admin/" ? "admin.html" : pathname.slice(1);
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const files = {
      "index.html": new URL("../src/index.html", import.meta.url),
      "admin.html": new URL("../src/admin.html", import.meta.url),
      "styles.css": new URL("../app/globals.css", import.meta.url),
      "admin.css": new URL("../app/admin.css", import.meta.url),
      "app.js": new URL("../public/app.js", import.meta.url),
      "admin.js": new URL("../public/admin.js", import.meta.url),
      "templates/agendaframe-import.csv": new URL("../templates/agendaframe-import.csv", import.meta.url),
    };
    const source = files[safePath];
    if (!source) throw new Error("Not found");
    const body = await readFile(source);
    response.writeHead(200, {
      "content-type": types[extname(safePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local: http://127.0.0.1:${port}/`);
});
