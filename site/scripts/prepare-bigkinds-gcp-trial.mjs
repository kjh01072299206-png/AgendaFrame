import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildTrialAuthorization, sha256Text } from "../lib/bigkinds-trial.mjs";
import { parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";
import { analyzeArticles, extractBodyFrameSignals } from "../worker/analysis.mjs";

const SOURCE_IDS = new Map([
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
  ["매일경제", ["mk", "maekyung_group"]],
  ["한국경제", ["hankyung", "hankyung_group"]],
  ["머니투데이", ["moneytoday", "moneytoday_group"]],
  ["서울경제", ["sedaily", "sedaily_group"]],
  ["아시아경제", ["asiae", "asiae_group"]],
  ["이데일리", ["edaily", "edaily_group"]],
  ["파이낸셜뉴스", ["fnnews", "fnnews_group"]],
  ["헤럴드경제", ["herald", "herald_group"]],
  ["조선비즈", ["chosunbiz", "chosun_group"]],
  ["연합뉴스", ["yonhap", "yonhap_group"]],
  ["뉴시스", ["newsis", "newsis_group"]],
  ["뉴스1", ["news1", "news1_group"]],
]);

function parseArgs(argv) {
  const args = {
    file: "",
    date: "2026-07-26",
    rank: 1,
    outputDirectory: "",
    clusterReview: "",
    clusterId: "",
    reviewedBy: "",
    reviewedAt: "",
    validUntil: "2026-10-31",
    bodyJsonl: "",
    requireFullBodies: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!args.file && !value.startsWith("--")) args.file = value;
    else if (value === "--date") args.date = argv[++index] ?? "";
    else if (value === "--rank") args.rank = Number(argv[++index] ?? 0);
    else if (value === "--output-directory") args.outputDirectory = argv[++index] ?? "";
    else if (value === "--cluster-review") args.clusterReview = argv[++index] ?? "";
    else if (value === "--cluster-id") args.clusterId = argv[++index] ?? "";
    else if (value === "--reviewed-by") args.reviewedBy = argv[++index] ?? "";
    else if (value === "--reviewed-at") args.reviewedAt = argv[++index] ?? "";
    else if (value === "--valid-until") args.validUntil = argv[++index] ?? "";
    else if (value === "--body-jsonl") args.bodyJsonl = argv[++index] ?? "";
    else if (value === "--require-full-bodies") args.requireFullBodies = true;
    else throw new Error(`지원하지 않는 인수입니다: ${value}`);
  }
  if (!args.file) throw new Error("BigKinds .xlsx 파일 경로가 필요합니다.");
  if (!args.outputDirectory) throw new Error("--output-directory가 필요합니다.");
  if (!Number.isInteger(args.rank) || args.rank < 1) throw new Error("--rank는 1 이상의 정수여야 합니다.");
  if (args.clusterReview !== "approved_same_event") {
    throw new Error("사건 동일성 검토가 완료된 뒤 --cluster-review approved_same_event를 지정해야 합니다.");
  }
  if (!args.clusterId || !args.reviewedBy || Number.isNaN(Date.parse(args.reviewedAt))) {
    throw new Error("--cluster-id, --reviewed-by, ISO-8601 --reviewed-at이 필요합니다.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || !/^\d{4}-\d{2}-\d{2}$/.test(args.validUntil)) {
    throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }
  return args;
}

function normalizedUrl(value) {
  const url = new URL(String(value ?? "").trim());
  url.protocol = "https:";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ["ref", "source", "fbclid", "gclid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function loadBodyMap(file) {
  if (!file) return new Map();
  const rows = (await readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const bodies = new Map();
  for (const row of rows) {
    const body = String(row.body ?? "").trim();
    if (!row.url || body.length < 300) continue;
    const key = normalizedUrl(row.url);
    if (body.length > String(bodies.get(key) ?? "").length) bodies.set(key, body);
  }
  return bodies;
}

function publishedAt(value, newsId, targetDate) {
  const idMatch = String(newsId ?? "").match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (idMatch) {
    const [, year, month, day, hour, minute, second] = idMatch;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
  }
  return `${targetDate}T00:00:00+09:00`;
}

const args = parseArgs(process.argv.slice(2));
const table = parseBigKindsXlsx(await readFile(args.file));
const fullBodies = await loadBodyMap(args.bodyJsonl);
const headers = table[0].map((value) => String(value ?? "").trim());
const column = Object.fromEntries(headers.map((header, index) => [header, index]));
for (const required of ["뉴스 식별자", "일자", "언론사", "제목", "통합 분류1", "본문", "URL"]) {
  if (!(required in column)) throw new Error(`필수 열을 찾지 못했습니다: ${required}`);
}

const targetKey = args.date.replaceAll("-", "");
const collectedAt = new Date().toISOString();
const candidates = table.slice(1).flatMap((row) => {
  if (String(row[column["일자"]] ?? "").replace(/\D/g, "") !== targetKey) return [];
  if (String(row[column["분석제외 여부"]] ?? "").trim()) return [];
  const source = String(row[column["언론사"]] ?? "").trim();
  const sourceConfig = SOURCE_IDS.get(source);
  const title = String(row[column["제목"]] ?? "").trim();
  const canonicalUrl = String(row[column["URL"]] ?? "").trim();
  const providerExcerpt = String(row[column["본문"]] ?? "").trim();
  const fullBody = fullBodies.get(normalizedUrl(canonicalUrl));
  const bodyText = fullBody || providerExcerpt;
  if (!sourceConfig || !title || !canonicalUrl || bodyText.length < 40) return [];
  const articleId = String(row[column["뉴스 식별자"]] ?? "").trim() || sha256Text(canonicalUrl);
  return [{
    id: articleId,
    sourceId: sourceConfig[0],
    mediaGroupId: sourceConfig[1],
    source,
    title,
    section: String(row[column["통합 분류1"]] ?? "").trim(),
    url: canonicalUrl,
    publishedAt: publishedAt(row[column["일자"]], articleId, args.date),
    bodyText,
    transientContent: true,
    bodyAnalysisAvailable: true,
    bodyFrameSignals: extractBodyFrameSignals(bodyText),
    textScope: fullBody ? "transient_public_page_extract" : "provider_excerpt",
  }];
});

const issues = analyzeArticles(candidates, {
  configuredSourceCount: SOURCE_IDS.size,
  configuredSourceGroupCount: new Set([...SOURCE_IDS.values()].map((value) => value[1])).size,
  maxIssues: Math.max(120, args.rank),
});
const issue = issues[args.rank - 1];
if (!issue) throw new Error(`${args.rank}위 이슈를 찾지 못했습니다.`);
if (issue.sourceCount < 2 || issue.articles.length < 2) {
  throw new Error("다매체 비교가 가능한 사건 군집이 아닙니다.");
}

const articleIds = new Set(issue.articles.map((article) => article.id));
const selected = candidates.filter((article) => articleIds.has(article.id));
if (args.requireFullBodies && selected.some((article) => article.textScope !== "transient_public_page_extract")) {
  const missing = selected
    .filter((article) => article.textScope !== "transient_public_page_extract")
    .map((article) => article.url);
  throw new Error(`전체 본문을 찾지 못한 기사가 있습니다: ${missing.join(", ")}`);
}
const textScopes = new Set(selected.map((article) => article.textScope));
if (textScopes.size !== 1) {
  throw new Error("한 번의 GCP 분석에는 동일한 본문 제공 범위만 사용할 수 있습니다.");
}
const [textScope] = textScopes;
const inputRows = selected.map((article) => ({
  article_id: article.id,
  source_id: article.sourceId,
  canonical_url: normalizedUrl(article.url),
  title: article.title,
  published_at: article.publishedAt,
  collected_at: collectedAt,
  section: article.section,
  body_text: article.bodyText,
  text_scope: article.textScope,
}));
const authorizationId = `bigkinds-${args.date}-rank-${args.rank}-${sha256Text(
  [...articleIds].sort().join("|"),
).slice(0, 12)}`;
const authorization = buildTrialAuthorization({
  authorizationId,
  clusterId: args.clusterId,
  reviewedBy: args.reviewedBy,
  reviewedAt: args.reviewedAt,
  textScope,
  validUntil: args.validUntil,
  clusterReviewStatus: args.clusterReview,
  articles: inputRows,
});
const approvedArticles = authorization.approved_articles;
const manifest = {
  schema_version: 1,
  generated_at: collectedAt,
  dataset: path.basename(args.file),
  date: args.date,
  rank: args.rank,
  issue: {
    title: issue.title,
    category: issue.category,
    agenda_score: issue.agendaScore,
    score_status: issue.scoreStatus,
    cluster_quality_before_review: issue.clusterQuality,
    cluster_review_status: args.clusterReview,
  },
  sample: {
    article_count: selected.length,
    outlet_count: new Set(selected.map((article) => article.sourceId)).size,
    independent_media_group_count: new Set(
      selected.map((article) => article.mediaGroupId),
    ).size,
    body_character_count: selected.reduce((sum, article) => sum + article.bodyText.length, 0),
    text_scope: textScope,
  },
  article_metadata: selected.map((article) => ({
    article_id: article.id,
    source_id: article.sourceId,
    source: article.source,
    media_group_id: article.mediaGroupId,
    title: article.title,
    canonical_url: article.url,
    published_at: article.publishedAt,
    body_sha256: approvedArticles[article.id].body_sha256,
    body_character_count: article.bodyText.length,
  })),
  raw_article_text_included: false,
  authorization_id: authorizationId,
};

await mkdir(args.outputDirectory, { recursive: true });
const inputPath = path.join(args.outputDirectory, "articles.jsonl");
const authorizationPath = path.join(args.outputDirectory, "authorization.json");
const manifestPath = path.join(args.outputDirectory, "manifest.json");
await writeFile(inputPath, `${inputRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
await writeFile(authorizationPath, JSON.stringify(authorization, null, 2), "utf8");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

console.log(JSON.stringify({
  inputPath,
  authorizationPath,
  manifestPath,
  issue: manifest.issue,
  sample: manifest.sample,
  authorizationId,
}, null, 2));
