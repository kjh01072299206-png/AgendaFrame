import { readFile, stat } from "node:fs/promises";
import process from "node:process";
import { parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";
import { analyzeArticles } from "../worker/analysis.mjs";
import { analyzeArticleFraming, buildIssueFrameComparison, validateArticleFrameProfile } from "../worker/framing-engine.mjs";
import sourcePanel from "../data/sources.json" with { type: "json" };

const EXCLUDED_LIKE = new Set(["1", "true", "y", "yes", "예", "제외", "분석제외", "예외", "중복", "유효url없음"]);

function parseArgs(argv) {
  const args = { file: "", date: "", concurrency: 8 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!args.file && !value.startsWith("--")) args.file = value;
    else if (value === "--date") args.date = String(argv[++index] ?? "").trim();
    else if (value === "--concurrency") args.concurrency = Number(argv[++index] ?? 8);
    else throw new Error(`지원하지 않는 인수입니다: ${value}`);
  }
  if (!args.file) throw new Error("BigKinds .xlsx 파일 경로가 필요합니다.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("--date YYYY-MM-DD가 필요합니다.");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 32) {
    throw new Error("--concurrency는 1~32 사이 정수여야 합니다.");
  }
  return args;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function findColumn(headers, aliases, required = true) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const index = headers.findIndex((header) => normalizedAliases.includes(normalizeHeader(header)));
  if (required && index < 0) throw new Error(`필수 열을 찾지 못했습니다: ${aliases[0]}`);
  return index;
}

function isExcludedStatus(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim().replace(/\s+/g, ""))
    .filter(Boolean)
    .some((status) => EXCLUDED_LIKE.has(status));
}

function compactDate(value, newsId) {
  const fromId = String(newsId ?? "").match(/\.(\d{4})(\d{2})(\d{2})/);
  if (fromId) return `${fromId[1]}-${fromId[2]}-${fromId[3]}`;
  const match = String(value ?? "").match(/^(\d{4})[./-]?(\d{2})[./-]?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function forbiddenRawFieldCount(value) {
  let count = 0;
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (/^(?:bodyText|body_text|rawBody|raw_body|sentenceText|sentence_text|quote|quotation|excerpt|html|content|tokens|token_sequence|morpheme_sequence)$/i.test(key)) count += 1;
      visit(child);
    }
  };
  visit(value);
  return count;
}

function evidenceStats(profile) {
  let total = 0;
  let invalid = 0;
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Object.hasOwn(node, "sentence_sha256")) {
      total += 1;
      if (!/^[a-f0-9]{64}$/.test(String(node.sentence_sha256))
        || !Number.isInteger(node.locator?.paragraph)
        || !Number.isInteger(node.locator?.sentence)) invalid += 1;
    }
    Object.values(node).forEach(visit);
  };
  visit(profile);
  return { total, invalid };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await stat(args.file);
  const table = parseBigKindsXlsx(await readFile(args.file));
  if (table.length < 2) throw new Error("분석할 데이터 행이 없습니다.");
  const headers = table[0];
  const columns = {
    newsId: findColumn(headers, ["뉴스 식별자", "news_id"]),
    date: findColumn(headers, ["일자", "날짜", "published_at"]),
    source: findColumn(headers, ["언론사", "source"]),
    title: findColumn(headers, ["제목", "title"]),
    section: findColumn(headers, ["통합 분류1", "분야", "section"], false),
    body: findColumn(headers, ["본문", "body_excerpt", "excerpt"]),
    url: findColumn(headers, ["URL", "원문 URL", "링크"], false),
    excluded: findColumn(headers, ["분석제외 여부", "analysis_excluded"], false),
  };
  let dateRows = 0;
  let excludedRows = 0;
  let missingBodyRows = 0;
  let unsupportedSourceRows = 0;
  let invalidOfficialUrlRows = 0;
  const articles = [];
  const sourcePolicyByName = new Map(sourcePanel.sources.map((source) => [source.name, source]));
  for (const row of table.slice(1)) {
    const newsId = String(row[columns.newsId] ?? "").trim();
    if (compactDate(row[columns.date], newsId) !== args.date) continue;
    dateRows += 1;
    if (columns.excluded >= 0 && isExcludedStatus(row[columns.excluded])) {
      excludedRows += 1;
      continue;
    }
    const bodyText = String(row[columns.body] ?? "").trim();
    if (bodyText.length < 40) {
      missingBodyRows += 1;
      continue;
    }
    const source = String(row[columns.source] ?? "출처 미상").trim() || "출처 미상";
    const sourcePolicy = sourcePolicyByName.get(source);
    if (!sourcePolicy?.active) unsupportedSourceRows += 1;
    const url = columns.url >= 0 ? String(row[columns.url] ?? "").trim() : "";
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (!sourcePolicy?.domains?.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) invalidOfficialUrlRows += 1;
    } catch {
      invalidOfficialUrlRows += 1;
    }
    articles.push({
      id: newsId,
      sourceId: sourcePolicy?.id ?? source,
      mediaGroupId: sourcePolicy?.mediaGroupId ?? source,
      sourceName: source,
      title: String(row[columns.title] ?? "").trim(),
      section: columns.section >= 0 ? String(row[columns.section] ?? "").trim() : "",
      url,
      publishedAt: `${args.date}T00:00:00+09:00`,
      bodyText,
    });
  }
  if (!articles.length) throw new Error(`${args.date}에 분석 가능한 본문이 없습니다.`);

  let completed = 0;
  const profiles = await mapLimit(articles, args.concurrency, async (article) => {
    const profile = await analyzeArticleFraming({
      articleId: article.id,
      title: article.title,
      bodyText: article.bodyText,
      publishedAt: article.publishedAt,
    });
    completed += 1;
    if (completed % 100 === 0 || completed === articles.length) {
      console.error(`기사 프로필 검증 ${completed}/${articles.length}`);
    }
    return profile;
  });

  const profileById = new Map(profiles.map((profile) => [profile.article.article_id, profile]));
  const publicIssues = analyzeArticles(articles, {
    configuredSourceCount: new Set(articles.map((article) => article.sourceId)).size,
    configuredSourceGroupCount: new Set(articles.map((article) => article.mediaGroupId)).size,
    maxIssues: articles.length,
  });
  const comparableIssues = publicIssues.filter((issue) => issue.articleCount >= 2 && issue.sourceCount >= 2);
  const comparisons = comparableIssues.map((issue, index) => {
    const issueProfiles = issue.articles.map((article) => profileById.get(article.id)).filter(Boolean);
    const metadata = issue.articles.map((article) => ({
      id: article.id,
      sourceId: article.sourceId,
      mediaGroupId: article.mediaGroupId,
      sourceName: article.sourceName,
      url: article.url,
    }));
    return {
      issue,
      comparison: buildIssueFrameComparison(issueProfiles, metadata, {
        issueId: `validation-${args.date}-${index + 1}`,
        issueTitle: issue.title,
      }),
    };
  });

  const profileValidationFailures = profiles.filter((profile) => !validateArticleFrameProfile(profile).valid).length;
  const evidence = profiles.map(evidenceStats).reduce((sum, item) => ({
    total: sum.total + item.total,
    invalid: sum.invalid + item.invalid,
  }), { total: 0, invalid: 0 });
  const moduleOutlets = comparisons.flatMap(({ comparison }) => comparison.analysis_modules.reporting_style.by_outlet);
  const morphologyOutlets = comparisons.flatMap(({ comparison }) => comparison.analysis_modules.morphology.by_outlet);
  const output = {
    validationDate: args.date,
    dataset: {
      workbookRows: table.length - 1,
      dateRows,
      explicitlyExcludedRows: excludedRows,
      missingOrShortBodyRows: missingBodyRows,
      unsupportedSourceRows,
      invalidOfficialUrlRows,
      analyzedArticles: articles.length,
      outlets: new Set(articles.map((article) => article.sourceId)).size,
    },
    articleProfiles: {
      generated: profiles.length,
      validationFailures: profileValidationFailures,
      articlesWithAttributedSources: profiles.filter((profile) => profile.actors_and_sources.length > 0).length,
      articlesWithPolicyDescriptors: profiles.filter((profile) => profile.secondary_descriptors.policy_frames.length > 0).length,
      articlesWithMorphologyTerms: profiles.filter((profile) => profile.morphology.term_frequencies.length > 0).length,
      totalTokens: profiles.reduce((sum, profile) => sum + profile.morphology.token_count, 0),
      contentTokens: profiles.reduce((sum, profile) => sum + profile.morphology.content_token_count, 0),
      negationMarkers: profiles.reduce((sum, profile) => sum + profile.morphology.negation_count, 0),
    },
    clustering: {
      publicAgendaIssues: publicIssues.length,
      comparableMultiOutletIssues: comparableIssues.length,
      comparedArticles: comparableIssues.reduce((sum, issue) => sum + issue.articleCount, 0),
      largestComparableIssues: comparableIssues.slice(0, 8).map((issue) => ({
        title: issue.title,
        articles: issue.articleCount,
        outlets: issue.sourceCount,
        clusterQuality: issue.clusterQuality,
      })),
    },
    analysisModules: {
      comparisonsGenerated: comparisons.length,
      frameCompositionAvailable: comparisons.filter(({ comparison }) => comparison.analysis_modules.frame_composition.status === "available").length,
      reportingStyleOutlets: moduleOutlets.length,
      evaluationObservedOutlets: moduleOutlets.filter((outlet) => outlet.evaluation.status === "observed").length,
      evaluationAbstainedOutlets: moduleOutlets.filter((outlet) => outlet.evaluation.status === "abstained").length,
      scopeObservedOutlets: moduleOutlets.filter((outlet) => outlet.scope.status === "observed").length,
      morphologyAvailable: comparisons.filter(({ comparison }) => comparison.analysis_modules.morphology.status === "available").length,
      morphologyPublicTerms: morphologyOutlets.reduce((sum, outlet) => sum + outlet.terms.length, 0),
      morphologyTermsWithoutEvidence: morphologyOutlets.reduce(
        (sum, outlet) => sum + outlet.terms.filter((term) => term.evidence.length === 0).length,
        0,
      ),
    },
    privacyAndEvidence: {
      rawArticleTextFieldsPersisted: profiles.reduce((sum, profile) => sum + forbiddenRawFieldCount(profile), 0),
      rawTokenSequencesPersisted: profiles.filter((profile) => profile.morphology.raw_tokens_retained !== false).length,
      evidenceReferences: evidence.total,
      invalidEvidenceReferences: evidence.invalid,
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
