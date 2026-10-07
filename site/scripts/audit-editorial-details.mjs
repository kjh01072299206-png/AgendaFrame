import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const option = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : process.argv[i + 1];
};
const base = (option("url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const shots = option("shots");
if (shots) fs.mkdirSync(shots, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AF_PW ?? "playwright-core");
const browser = await chromium.launch({ headless: true, ...(process.env.AF_CHROME ? { executablePath: process.env.AF_CHROME } : {}) });
const data = JSON.parse(fs.readFileSync(new URL("../data/editorial-2026-10-05.json", import.meta.url), "utf8"));
const errors = [];
let checked = 0;
try {
  for (const [width, colorScheme] of [[1440, "light"], [1280, "dark"], [390, "light"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
    // This is an offline UI gate: never follow an original-article hyperlink.
    await page.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    for (const issue of data.issues) {
      for (const suffix of ["", "/outlets"]) {
        assert.ok((await page.goto(`${base}/issues/${issue.issueId}${suffix}`)).ok());
        const story = page.locator(".event-story");
        assert.equal(await story.locator(".what:visible").count(), 1);
        await story.locator("summary").click();
        assert.equal(await story.locator(".what:visible").count(), issue.eventParagraphs.length);
        assert.deepEqual(await story.locator(".what").allTextContents(), issue.eventParagraphs.map(p => p.text));
        assert.doesNotMatch(await page.locator(".af-bodyreview").innerText(), /fallback|SHA-256|gemini-|prompt \d|근거 문자|hash [a-f0-9]/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (shots && width === 1440 && issue.rank === 1) await story.screenshot({ path: path.join(shots, suffix ? "comparison-story.png" : "overview-story.png") });
        await story.locator("summary").click();
        assert.equal(await story.locator(".what:visible").count(), 1);
        if (suffix) {
          const cards = page.locator(".debate-box");
          assert.equal(await cards.count(), issue.groups.length);
          for (const [i, group] of issue.groups.entries()) assert.equal(await cards.nth(i).locator(".debate-summary").innerText(), group.explanationParagraphs.map(p => p.text).join("\n"));
          if (shots && issue.rank === 1) await page.locator(".debate-boxes").screenshot({ path: path.join(shots, `comparison-groups-${width}-${colorScheme}.png`) });
        }
        checked++;
      }
      assert.ok((await page.goto(`${base}/issues/${issue.issueId}/framing`)).ok());
      const outlets = [...new Set(issue.articles.map(a => a.outlet))];
      for (const name of ["functions", "scope", "sources"]) {
        const table = page.locator(`[data-outlet-table="${name}"]`);
        assert.equal(await table.locator("tbody tr").count(), outlets.length);
        for (const outlet of outlets) {
          const row = table.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: outlet, exact: true }) });
          const articles = issue.articles.filter(a => a.outlet === outlet);
          const values = name === "functions" ? Object.keys(articles[0].fourFunctions).map(k => articles.map(a => a.fourFunctions[k]))
            : name === "scope" ? [articles.map(a => a.scope), articles.map(a => a.reading)]
              : [articles.map(a => a.sources.join(" · ")), articles.map(a => a.reading)];
          for (const [column, expected] of values.entries()) {
            const lines = row.locator("td").nth(column).locator("[data-article-id]");
            assert.deepEqual(await lines.allTextContents(), expected);
            assert.deepEqual(await lines.evaluateAll(nodes => nodes.map(n => n.dataset.articleId)), articles.map(a => a.articleId));
            assert.deepEqual(await lines.evaluateAll(nodes => nodes.map(n => n.title)), articles.map(a => a.title));
          }
        }
      }
      // Locate by the explicit section number, preserving 04's existing counts.
      const emphasisRows = page.locator(".card").filter({ has: page.locator(".lay-n", { hasText: /^04$/ }) }).locator("tbody tr");
      assert.equal(await emphasisRows.count(), outlets.length);
      for (const [i, outlet] of outlets.entries()) {
        assert.deepEqual((await emphasisRows.nth(i).locator("td").allTextContents()).map(Number), ["갈등", "인간적 흥미", "경제적 결과", "도덕성", "책임"].map(k => issue.articles.filter(a => a.outlet === outlet && a.genericFrames.includes(k)).length));
      }
      const graphs = page.locator(".wnet");
      assert.equal(await graphs.count(), issue.groups.length);
      for (const [i, group] of issue.groups.entries()) {
        assert.equal(await graphs.nth(i).locator("line").count(), group.network.edges.length);
        assert.deepEqual(await graphs.nth(i).locator("text").allTextContents(), group.network.nodes.map(n => n.term));
      }
      if (shots && issue.rank === 1) {
        await page.locator('[data-outlet-table="functions"]').screenshot({ path: path.join(shots, `outlet-functions-${width}-${colorScheme}.png`) });
        await graphs.first().locator("..").screenshot({ path: path.join(shots, `network-${width}-${colorScheme}.png`) });
      }
      checked++;
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Editorial detail gate: ${checked} pages passed; expanded prose, outlet columns, 04 counts and network values verified.`);
} finally {
  await browser.close();
}
