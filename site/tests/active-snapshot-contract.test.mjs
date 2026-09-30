import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("active snapshot loader is fail-closed and demo mode is explicit", async () => {
  const source = await readFile(path.join(siteRoot, "lib", "active-snapshot.ts"), "utf8");
  assert.match(source, /AGENDAFRAME_DATA_MODE/);
  assert.match(source, /AGENDAFRAME_ACTIVE_SNAPSHOT_URL/);
  assert.match(source, /mode: "live"/);
  assert.match(source, /mode: "demo"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /getIssueBundle/);
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /export const getActiveSnapshot = cache/);
  assert.match(source, /withEventSynthesis/);
  assert.match(source, /공개 금지 필드/);
  assert.match(source, /throw new Error/);
  assert.match(source, /exactly five issues/);
  assert.match(source, /bundles do not match/);
  assert.match(source, /ACTIVE_SNAPSHOT_SCHEMA/);
  assert.match(source, /qualityGate/);
  assert.match(source, /bundle issue IDs do not match/);
  assert.match(source, /article_content/);
  assert.match(source, /title-fallback/);
  assert.match(source, /is not publishable/);
  assert.match(source, /publicationStatus/);
  assert.match(source, /fewer than 3 articles or 2 outlets/);
  const publicationContract = await readFile(path.join(siteRoot, "lib", "initial-five", "publication-contract.ts"), "utf8");
  assert.match(source, /isPublishableEventSynthesis/);
  assert.match(publicationContract, /event-synthesis-v2\.2\.0/);
  assert.match(publicationContract, /comparison_result/);
  assert.match(publicationContract, /held_for_analysis/);
  assert.match(source, /lacks an evidence-bound v2\.2 comparison result/);
  assert.match(publicationContract, /event_paragraphs/);
  assert.match(publicationContract, /common_ground/);
  assert.match(source, /live reader failure must never turn into a hard-coded demo response/);
  assert.doesNotMatch(source, /return demoSource\("pending"\)/);
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
  assert.match(home, /ActiveSnapshotHome/);
  assert.doesNotMatch(home, /LiveHome/);
  assert.match(homeView, /ActiveSnapshotHome/);
  assert.match(homeView, /publicationStatus/);
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

test("AI dialogue issue list and bundle API use the active snapshot boundary", async () => {
  const askPage = await readFile(path.join(siteRoot, "app", "(shell)", "tools", "ask", "page.tsx"), "utf8");
  const askRoute = await readFile(path.join(siteRoot, "app", "api", "initial-five", "ask", "route.ts"), "utf8");
  const issueRoute = await readFile(path.join(siteRoot, "app", "api", "initial-five", "issues", "[issueId]", "route.ts"), "utf8");
  assert.match(askPage, /getActiveSnapshot/);
  assert.match(askRoute, /getActiveSnapshot/);
  assert.match(issueRoute, /getActiveSnapshot/);
  assert.match(issueRoute, /Cache-Control.*no-store/);
  assert.doesNotMatch(askPage, /initialFiveManifest/);
  assert.doesNotMatch(askRoute, /getInitialFiveIssueBundle/);
  assert.doesNotMatch(issueRoute, /getInitialFiveIssueBundle/);
});

test("the browser initial-five reader does not hide live reader failures with static data", async () => {
  const source = await readFile(path.join(siteRoot, "app", "initial-five.tsx"), "utf8");
  assert.match(source, /response\.status === 404/);
  assert.match(source, /Only an explicit 404 is eligible/);
  assert.match(source, /Static data is a compatibility route/);
  assert.match(source, /throw error instanceof Error/);
  assert.match(source, /agenda\.frame\.active-snapshot\.v1/);
});
