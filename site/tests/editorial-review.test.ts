import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getEditorialCoverage, getEditorialReview } from "../lib/editorial-review";
import data from "../data/editorial-2026-10-05.json";
import { editorialReviewIsPublishable } from "../lib/editorial-review-validation";

test("October 5 body readings retain source identity and count 62 distinct articles", () => {
  const ids = new Set<string>();
  for (const issue of data.issues) {
    assert.equal(issue.articleCount, issue.articles.length);
    assert.ok(editorialReviewIsPublishable(issue));
    assert.equal(issue.outletCount, new Set(issue.articles.map(a => a.outlet)).size);
    assert.equal(issue.scopeMix.reduce((n,s) => n+s.count,0), issue.articleCount);
    const assigned = new Set(issue.groups.flatMap(g => g.articleIds));
    assert.deepEqual(assigned, new Set(issue.articles.map(a => a.articleId)));
    for (const group of issue.groups) {
      assert.equal(group.articleCount, group.articleIds.length);
      assert.equal(Object.keys(group.sixFunctions).length, 6);
      assert.ok(group.network.edges.every(e => e.sentences > 0 && group.network.nodes.some(n => n.term === e.source) && group.network.nodes.some(n => n.term === e.target)));
    }
    for (const article of issue.articles) {
      ids.add(article.articleId);
      assert.match(article.articleId, /^[a-f0-9]{32}$/);
      assert.match(article.bodySha256, /^[a-f0-9]{64}$/);
      assert.match(article.url, /^https:\/\//);
      assert.equal(Object.keys(article.fourFunctions).length,4);
      assert.ok(article.evidence.every(e => e.end > e.start && /^[a-f0-9]{64}$/.test(e.sha256)));
    }
    for (const outlet of issue.morphology) assert.equal(outlet.tokens, outlet.pos.reduce((n,p) => n+p.count,0));
  }
  assert.equal(ids.size,62);
  assert.equal(data.analysisSource,"codex_body_reading");
  assert.equal(data.collection.hashVerifiedCount,146);
});

test("missing source identity or a group that double-counts an article fails publication validation", () => {
  const issue=structuredClone(data.issues[0]);
  issue.articles[0].bodySha256="";
  assert.equal(editorialReviewIsPublishable(issue),false);
  const duplicated=structuredClone(data.issues[0]);
  duplicated.groups[1].articleIds.push(duplicated.groups[0].articleIds[0]);
  duplicated.groups[1].articleCount++;
  assert.equal(editorialReviewIsPublishable(duplicated),false);
  const misplaced=structuredClone(data.issues[0]);
  misplaced.articles[0].groupId=misplaced.groups[1].id;
  assert.equal(editorialReviewIsPublishable(misplaced),false);
});

test("frozen day cannot replace another date or an unknown issue", () => {
  assert.equal(getEditorialReview("dmz-landmine-response","2026-10-06"),null);
  assert.equal(getEditorialReview("unknown","2026-10-05"),null);
  assert.ok(getEditorialReview("dmz-landmine-response","2026-10-05"));
  assert.deepEqual(getEditorialCoverage(data.issues.map(i => i.issueId), "2026-10-05"), { articleCount: 62, outletCount: 10 });
  assert.equal(getEditorialCoverage(data.issues.map(i => i.issueId), "2026-10-06"), null);
  assert.equal(getEditorialCoverage(["unknown"], "2026-10-05"), null);
});

test("body readings expose paraphrases and locators without full text or private storage addresses", () => {
  const serialized=JSON.stringify(data);
  assert.ok(!serialized.includes("gs://"));
  assert.ok(!serialized.includes("body_text"));
  assert.ok(!serialized.includes("raw_body"));
  assert.ok(!serialized.includes("@gmail.com"));
  assert.ok(!serialized.includes("gemini-2.5"));
});

test("reference styles are confined to the two-page component", () => {
  const css=readFileSync(new URL("../app/(shell)/editorial-analysis.css", import.meta.url),"utf8");
  assert.ok(!/(?:^|[{}])\s*\.(?:shell|side|body)\s*\{/.test(css));
  const layout=readFileSync(new URL("../app/layout.tsx",import.meta.url),"utf8");
  assert.ok(!layout.includes('import "./prototype-parity.css"'));
});

test("every locator remains verifiable against an optional local private archive", () => {
  const archive = process.env.AGENDAFRAME_EDITORIAL_ARCHIVE;
  if (!archive) return;
  for (const issue of data.issues) for (const a of issue.articles) {
    const raw: string=readFileSync(`${archive}/bodies/${a.articleId}.txt`,"utf8");
    assert.equal(createHash("sha256").update(raw).digest("hex"),a.bodySha256);
    for (const e of a.evidence) assert.equal(createHash("sha256").update([...raw].slice(e.start,e.end).join("")).digest("hex"),e.sha256);
  }
});
