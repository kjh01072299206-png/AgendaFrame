import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("active snapshot loader is fail-closed and demo fallback is explicit", async () => {
  const source = await readFile(path.join(siteRoot, "lib", "active-snapshot.ts"), "utf8");
  assert.match(source, /AGENDAFRAME_DATA_MODE/);
  assert.match(source, /AGENDAFRAME_ACTIVE_SNAPSHOT_URL/);
  assert.match(source, /mode: "live"/);
  assert.match(source, /mode: "demo"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /getIssueBundle/);
  assert.match(source, /공개 금지 필드/);
  assert.match(source, /throw new Error/);
  assert.match(source, /exactly five issues/);
  assert.match(source, /bundles do not match/);
  assert.match(source, /ACTIVE_SNAPSHOT_SCHEMA/);
  assert.match(source, /qualityGate/);
  assert.match(source, /bundle issue IDs do not match/);
  assert.match(source, /article_content/);
});

test("shell issue routes resolve through the active snapshot boundary", async () => {
  const loadSource = await readFile(path.join(siteRoot, "app", "(shell)", "issues", "[issueId]", "load.ts"), "utf8");
  const shellSource = await readFile(path.join(siteRoot, "app", "(shell)", "layout.tsx"), "utf8");
  assert.match(loadSource, /getActiveSnapshot/);
  assert.match(shellSource, /getActiveSnapshot/);
  assert.match(shellSource, /dynamic = "force-dynamic"/);
});

test("live active snapshot is the shared source for the main and two analysis routes", async () => {
  const home = await readFile(path.join(siteRoot, "app", "(shell)", "page.tsx"), "utf8");
  const homeView = await readFile(path.join(siteRoot, "app", "(shell)", "active-home.tsx"), "utf8");
  const outlets = await readFile(path.join(siteRoot, "app", "(shell)", "issues", "[issueId]", "outlets", "page.tsx"), "utf8");
  const framing = await readFile(path.join(siteRoot, "app", "(shell)", "issues", "[issueId]", "framing", "page.tsx"), "utf8");
  assert.match(home, /getActiveSnapshot/);
  assert.match(home, /active\.mode === "live"/);
  assert.match(homeView, /ActiveSnapshotHome/);
  assert.match(outlets, /OutletsSemanticPage/);
  assert.match(framing, /FramingSemanticPage/);
  assert.match(outlets, /active\.mode === "live"/);
  assert.match(framing, /active\.mode === "live"/);
  assert.match(outlets, /if \(!activeBundle\) notFound\(\)/);
  assert.match(framing, /if \(!activeBundle\) notFound\(\)/);
  assert.doesNotMatch(outlets, /active\.mode === "live" && activeBundle/);
  assert.doesNotMatch(framing, /active\.mode === "live" && activeBundle/);
  assert.doesNotMatch(homeView, /raw_body|body_text|sentence_text/i);
});
