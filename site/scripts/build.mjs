import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const [html, css, javascript] = await Promise.all([
  readFile(new URL("src/index.html", root), "utf8"),
  readFile(new URL("app/globals.css", root), "utf8"),
  readFile(new URL("public/app.js", root), "utf8"),
]);

await rm(dist, { recursive: true, force: true });
await mkdir(new URL("server/", dist), { recursive: true });
await mkdir(new URL("client/", dist), { recursive: true });
await mkdir(new URL(".openai/", dist), { recursive: true });

const assets = {
  "/": { body: html, type: "text/html; charset=utf-8", cache: "no-store" },
  "/index.html": { body: html, type: "text/html; charset=utf-8", cache: "no-store" },
  "/styles.css": { body: css, type: "text/css; charset=utf-8", cache: "public, max-age=3600" },
  "/app.js": { body: javascript, type: "text/javascript; charset=utf-8", cache: "public, max-age=3600" },
};

const worker = `const assets = ${JSON.stringify(assets)};
const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok", mode: "demo", dataAsOf: "2026-07-13T18:00:00+09:00" }, {
        headers: { ...securityHeaders, "cache-control": "no-store" }
      });
    }
    const asset = assets[url.pathname];
    if (!asset) {
      return new Response("Not found", { status: 404, headers: { ...securityHeaders, "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response(asset.body, {
      status: 200,
      headers: { ...securityHeaders, "content-type": asset.type, "cache-control": asset.cache }
    });
  }
};
`;

await Promise.all([
  writeFile(new URL("server/index.js", dist), worker, "utf8"),
  writeFile(new URL("client/index.html", dist), html, "utf8"),
  writeFile(new URL("client/styles.css", dist), css, "utf8"),
  writeFile(new URL("client/app.js", dist), javascript, "utf8"),
  cp(new URL(".openai/hosting.json", root), new URL(".openai/hosting.json", dist)),
]);

console.log("AgendaFrame MVP build complete");
