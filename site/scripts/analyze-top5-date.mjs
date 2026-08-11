import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";
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

function parseJsonBuffer(buffer) {
  const utf8 = buffer.toString("utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(utf8);
  } catch {
    return JSON.parse(buffer.toString("utf16le").replace(/^\uFEFF/, ""));
  }
}

function publishedAtFromNewsId(newsId, date) {
  const match = String(newsId ?? "").match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return `${date}T00:00:00+09:00`;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
}

function bodyFingerprint(body) {
  return createHash("sha256")
    .update(`${process.env.AGENDAFRAME_EVIDENCE_SALT ?? "top5-2026-07-26-evidence-v1"}:${body}`)
    .digest("hex");
}

const sourceConfig = new Map([
  ["경향신문", ["khan", "khan_group"]],
  ["국민일보", ["kmib", "kmib_group"]],
  ["동아일보", ["donga", "donga_group"]],
  ["문화일보", ["munhwa", "munhwa_group"]],
  ["서울신문", ["seoul", "seoul_group"]],
  ["세계일보", ["segye", "segye_group"]],
  ["조선일보", ["chosun", "chosun_group"]],
  ["중앙일보", ["joongang", "joongang_group"]],
  ["한겨레", ["hani", "hani_group"]],
  ["한국일보", ["hankookilbo", "hankookilbo_group"]],
]);

const inputPath = path.resolve(repositoryRoot, argument("--workbook", "NewsResult_20260426-20260726_with_full_bodies.xlsx"));
const rankingPath = path.resolve(repositoryRoot, argument("--ranking", ".codex-tmp/top5.txt"));
const outputPath = path.resolve(repositoryRoot, argument("--output", "site/data/top5-2026-07-26.json"));
const date = argument("--date", "2026-07-26");

const ranking = parseJsonBuffer(await readFile(rankingPath));
const topIssues = ranking.topIssues.slice(0, 5);
const rows = parseBigKindsXlsx(await readFile(inputPath));
const headers = rows[0].map((value) => String(value ?? "").trim());
const column = Object.fromEntries(headers.map((header, index) => [header, index]));
const requiredColumns = ["뉴스 식별자", "언론사", "제목", "본문", "URL", "통합 분류1"];
for (const name of requiredColumns) {
  if (!(name in column)) throw new Error(`필수 열이 없습니다: ${name}`);
}

const rowById = new Map(rows.slice(1).map((row) => [String(row[column["뉴스 식별자"]] ?? "").trim(), row]));
const allArticleMetadata = [];
const issues = [];

for (const issue of topIssues) {
  const profiles = [];
  const articleMetadata = [];
  for (const rankedArticle of issue.articles) {
    const row = rowById.get(String(rankedArticle.id));
    if (!row) throw new Error(`원본 행을 찾지 못했습니다: ${rankedArticle.id}`);
    const body = String(row[column["본문"]] ?? "").trim();
    if (body.length < 40) throw new Error(`본문이 충분하지 않습니다: ${rankedArticle.id}`);
    const publishedAt = publishedAtFromNewsId(rankedArticle.id, date);
    const metadata = {
      id: rankedArticle.id,
      articleId: rankedArticle.id,
      title: String(row[column["제목"]] ?? rankedArticle.title).trim(),
      source: String(row[column["언론사"]] ?? rankedArticle.source).trim(),
      sourceId: sourceConfig.get(String(row[column["언론사"]] ?? rankedArticle.source))?.[0] ?? "unknown",
      mediaGroupId: sourceConfig.get(String(row[column["언론사"]] ?? rankedArticle.source))?.[1] ?? "unknown_group",
      canonicalUrl: String(row[column["URL"]] ?? rankedArticle.url).trim(),
      publishedAt,
      section: String(row[column["통합 분류1"]] ?? "").trim(),
    };
    const profile = await analyzeArticleFraming({
      articleId: rankedArticle.id,
      title: metadata.title,
      bodyText: body,
      publishedAt,
    });
    const validation = validateArticleFrameProfile(profile);
    if (!validation.valid) throw new Error(`${rankedArticle.id} 분석 검증 실패: ${validation.errors.join("; ")}`);
    profile.extraction = {
      strategy: "bigkinds_workbook_body",
      quality: 1,
      extractor_version: "workbook-body-v1",
      text_scope: "article_body",
      body_character_count: body.length,
      body_fingerprint: bodyFingerprint(body),
    };
    profiles.push(profile);
    articleMetadata.push(metadata);
    allArticleMetadata.push(metadata);
  }

  const comparison = buildIssueFrameComparison(profiles, articleMetadata, {
    issueId: `bigkinds-${date}-top-${issue.rank}`,
    issueTitle: issue.title,
  });
  comparison.review = {
    ...comparison.review,
    cluster_status: issue.clusterQuality === "cohesive" ? "not_reviewed" : "review_required",
    cluster_reviewed_at: null,
  };
  issues.push({
    rank: issue.rank,
    issueId: `bigkinds-${date}-top-${issue.rank}`,
    title: issue.title,
    category: issue.category,
    agendaScore: issue.agendaScore,
    scoreStatus: issue.scoreStatus,
    clusterQuality: issue.clusterQuality,
    articleCount: articleMetadata.length,
    sourceCount: new Set(articleMetadata.map((article) => article.sourceId)).size,
    articleMetadata,
    profiles,
    comparison,
  });
}

await writeFile(outputPath, JSON.stringify({
  schemaVersion: "agendaframe.top5-framing-pilot.v1",
  generatedAt: new Date().toISOString(),
  basisDate: date,
  source: {
    workbook: path.basename(inputPath),
    acceptedRows: ranking.articleCount,
    rankedIssueCount: ranking.issueCount,
  },
  provider: "structured_extractive",
  modelVersion: "korean-evidence-rules-v2",
  semanticAi: false,
  rawBodiesIncluded: false,
  humanReviewRequired: true,
  articleCount: allArticleMetadata.length,
  issueCount: issues.length,
  issues,
}, null, 2), "utf8");

console.log(JSON.stringify({ outputPath, date, issueCount: issues.length, articleCount: allArticleMetadata.length, provider: "structured_extractive" }, null, 2));
