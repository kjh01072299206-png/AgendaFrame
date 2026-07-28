import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeArticleFraming,
  buildIssueFrameComparison,
  validateArticleFrameProfile,
} from "../worker/framing-engine.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const inputPath = path.resolve(
  repositoryRoot,
  argument(
    "--input",
    "private/top-issue-analysis/2026-07-26/44ee997b22b2/browser-bodies.json",
  ),
);
const outputPath = path.resolve(
  repositoryRoot,
  argument(
    "--output",
    "private/top-issue-analysis/2026-07-26/44ee997b22b2/derived-analysis.json",
  ),
);

const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(input.articles) || !input.articles.length) {
  throw new Error("본문 분석 대상 기사가 없습니다.");
}

const profiles = [];
for (const article of input.articles) {
  const profile = await analyzeArticleFraming({
    articleId: article.article_id,
    title: article.title,
    bodyText: article.body,
    publishedAt: article.published_at,
  });
  profile.extraction = {
    strategy: "interactive_browser_public_page",
    quality: 1,
    extractor_version: "public-news-body-v2",
    text_scope: "article_body",
  };
  const validation = validateArticleFrameProfile(profile);
  if (!validation.valid) {
    throw new Error(`${article.article_id} 분석 결과 검증 실패: ${validation.errors.join("; ")}`);
  }
  profiles.push(profile);
}

const articleMetadata = input.articles.map((article) => ({
  id: article.article_id,
  articleId: article.article_id,
  title: article.title,
  source: article.source,
  sourceId: article.source_id,
  mediaGroupId: article.media_group_id,
  canonicalUrl: article.url,
  publishedAt: article.published_at,
}));
const comparison = buildIssueFrameComparison(profiles, articleMetadata, {
  issueId: "44ee997b22b2",
  issueTitle: input.issue_title,
});
comparison.review = {
  ...comparison.review,
  cluster_status: input.human_cluster_review,
  cluster_reviewed_at: new Date().toISOString(),
};

const dimensionCoverage = Object.fromEntries(
  Object.keys(profiles[0].dimensions).map((dimension) => [
    dimension,
    profiles.filter((profile) => profile.dimensions[dimension].status !== "not_observed").length,
  ]),
);
const output = {
  generated_at: new Date().toISOString(),
  date: input.date,
  issue_id: "44ee997b22b2",
  issue_title: input.issue_title,
  human_cluster_review: input.human_cluster_review,
  raw_bodies_included: false,
  sample: {
    article_count: profiles.length,
    outlet_count: new Set(input.articles.map((article) => article.source_id)).size,
    independent_media_group_count: new Set(
      input.articles.map((article) => article.media_group_id),
    ).size,
    body_character_count: input.articles.reduce((sum, article) => sum + article.body.length, 0),
    dimension_coverage: dimensionCoverage,
  },
  article_metadata: articleMetadata,
  profiles,
  comparison,
};

await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({
  outputPath,
  issue: output.issue_title,
  sample: output.sample,
}, null, 2));
