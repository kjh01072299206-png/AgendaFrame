import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const [html, adminHtml, css, adminCss, javascript, adminJavascript, importTemplate, sourcePanel, runtime] = await Promise.all([
  readFile(new URL("src/index.html", root), "utf8"),
  readFile(new URL("src/admin.html", root), "utf8"),
  readFile(new URL("app/globals.css", root), "utf8"),
  readFile(new URL("app/admin.css", root), "utf8"),
  readFile(new URL("public/app.js", root), "utf8"),
  readFile(new URL("public/admin.js", root), "utf8"),
  readFile(new URL("templates/agendaframe-import.csv", root), "utf8"),
  readFile(new URL("data/sources.json", root), "utf8").then(JSON.parse),
  readFile(new URL("worker/runtime.mjs", root), "utf8"),
]);

await rm(dist, { recursive: true, force: true });
await mkdir(new URL("server/", dist), { recursive: true });
await mkdir(new URL("client/", dist), { recursive: true });
await mkdir(new URL(".openai/", dist), { recursive: true });

const assets = {
  "/": { body: html, type: "text/html; charset=utf-8", cache: "no-store" },
  "/index.html": { body: html, type: "text/html; charset=utf-8", cache: "no-store" },
  "/admin": { body: adminHtml, type: "text/html; charset=utf-8", cache: "no-store" },
  "/admin/": { body: adminHtml, type: "text/html; charset=utf-8", cache: "no-store" },
  "/admin.html": { body: adminHtml, type: "text/html; charset=utf-8", cache: "no-store" },
  "/styles.css": { body: css, type: "text/css; charset=utf-8", cache: "public, max-age=3600" },
  "/admin.css": { body: adminCss, type: "text/css; charset=utf-8", cache: "public, max-age=3600" },
  "/app.js": { body: javascript, type: "text/javascript; charset=utf-8", cache: "public, max-age=3600" },
  "/admin.js": { body: adminJavascript, type: "text/javascript; charset=utf-8", cache: "public, max-age=3600" },
  "/templates/agendaframe-import.csv": { body: importTemplate, type: "text/csv; charset=utf-8", cache: "public, max-age=3600" },
};

const worker = `globalThis.__AGENDAFRAME_ASSETS__ = ${JSON.stringify(assets)};
globalThis.__AGENDAFRAME_SOURCE_PANEL__ = ${JSON.stringify(sourcePanel)};
${runtime}`;

await Promise.all([
  writeFile(new URL("server/index.js", dist), worker, "utf8"),
  writeFile(new URL("client/index.html", dist), html, "utf8"),
  writeFile(new URL("client/admin.html", dist), adminHtml, "utf8"),
  writeFile(new URL("client/styles.css", dist), css, "utf8"),
  writeFile(new URL("client/admin.css", dist), adminCss, "utf8"),
  writeFile(new URL("client/app.js", dist), javascript, "utf8"),
  writeFile(new URL("client/admin.js", dist), adminJavascript, "utf8"),
  mkdir(new URL("client/templates/", dist), { recursive: true }).then(() => writeFile(new URL("client/templates/agendaframe-import.csv", dist), importTemplate, "utf8")),
  cp(new URL(".openai/hosting.json", root), new URL(".openai/hosting.json", dist)),
  cp(new URL("drizzle/", root), new URL(".openai/drizzle/", dist), { recursive: true }),
]);

console.log("AgendaFrame manual import build complete");
