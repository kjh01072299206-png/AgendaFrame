import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? null : process.argv[i + 1]; };
const base = (option("url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const shots = option("shots");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AF_PW ?? "playwright-core");
const browser = await chromium.launch({ headless: true, ...(process.env.AF_CHROME ? { executablePath: process.env.AF_CHROME } : {}) });
const issues = JSON.parse(fs.readFileSync(new URL("../tests/fixtures/editorial-oct5-snapshot.json", import.meta.url), "utf8")).manifest.issues.slice().sort((a, b) => a.rank - b.rank);
const errors = [];
try {
  for (const [width, colorScheme] of [[1440, "light"], [390, "light"], [1280, "dark"]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme });
    // Isolated browser storage only. Never send a post, reaction or report to a public service.
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(base)) return route.abort();
      if (route.request().method() !== "GET") return route.fulfill({ status: 503, json: { error: { message: "offline test" } } });
      return route.continue();
    });
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${base}/tools/community`);
    const composer = page.getByRole("region", { name: "의견 쓰기" });
    await page.locator(".community-storage", { hasText: "나에게만 저장" }).waitFor();
    assert.ok((await composer.boundingBox()).height < (width < 600 ? 290 : 250));
    const picker = page.getByRole("combobox", { name: "글 의제", exact: true });
    assert.deepEqual(await picker.locator("option").evaluateAll(nodes => nodes.filter(n => n.value).map(n => n.value)), issues.map(i => i.issueId));
    assert.deepEqual(await picker.locator("option").evaluateAll(nodes => nodes.filter(n => n.value).map(n => n.textContent)), issues.map(i => `${i.rank}위 · ${i.title}`));
    assert.equal(await page.getByRole("textbox", { name: "표시 이름" }).isVisible(), false);
    await page.locator(".community-name summary").click();
    await page.getByRole("textbox", { name: "표시 이름" }).fill("테스트 독자");
    await page.locator(".community-name summary").click();
    assert.ok(await page.locator(".community-inline-reply:visible").count() > 0);
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `community-${width}-${colorScheme}.png`), fullPage: true });
    }
    await picker.selectOption(issues[4].issueId);
    await page.getByRole("textbox", { name: "글 내용", exact: true }).fill("선택한 의제에 관한 테스트 의견입니다.");
    await page.getByRole("button", { name: "의견 남기기", exact: true }).click();
    let own = page.locator(".afs-feed > li", { hasText: "선택한 의제에 관한 테스트 의견입니다." });
    await own.waitFor();
    assert.equal(await own.locator(".community-post-context a").getAttribute("href"), `/issues/${issues[4].issueId}`);
    const like = own.getByRole("button", { name: /^공감/ });
    await like.click(); assert.equal(await like.getAttribute("aria-pressed"), "true");
    await like.click(); assert.equal(await like.getAttribute("aria-pressed"), "false");
    await own.getByRole("button", { name: /^답글/ }).click();
    await own.locator("textarea").fill("첫 번째 글에 쓴 답글 초안");
    const other = page.locator('.afs-feed > li[data-post-id="demo-0"]');
    await other.locator("textarea").fill("다른 글의 답글 초안");
    assert.equal(await own.locator("textarea").inputValue(), "첫 번째 글에 쓴 답글 초안");
    await own.getByRole("button", { name: "등록", exact: true }).click();
    assert.ok((await own.locator(".afs-feed-replies").innerText()).includes("첫 번째 글에 쓴 답글 초안"));
    await own.locator(".community-more summary").click();
    await own.getByRole("button", { name: "신고", exact: true }).click();
    assert.ok((await page.getByRole("status").innerText()).includes("나에게만"));
    await page.reload();
    own = page.locator(".afs-feed > li", { hasText: "선택한 의제에 관한 테스트 의견입니다." });
    await own.waitFor();
    assert.ok((await own.locator(".afs-feed-replies").innerText()).includes("첫 번째 글에 쓴 답글 초안"));
    await page.getByRole("button", { name: "공감순", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "공감순", exact: true }).getAttribute("aria-pressed"), "true");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.doesNotMatch(await page.locator(".community-participation").innerText(), /BDCP|BDOP|HMOR|HMCR/);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("Community participation: active October 5 issues, compact composer, isolated reply drafts, reactions, report menu and storage reload passed at desktop/mobile/dark sizes.");
} finally { await browser.close(); }
