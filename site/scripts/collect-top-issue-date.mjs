import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";
import { analyzeArticles, extractBodyFrameSignals } from "../worker/analysis.mjs";
import { extractArticleBody } from "../worker/article-extractor.mjs";
import {
  analyzeArticleFraming,
  buildIssueFrameComparison,
} from "../worker/framing-engine.mjs";

const [file, targetDate = "2026-07-26", outputRoot = "../private/top-issue-analysis"] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/collect-top-issue-date.mjs <xlsx> [YYYY-MM-DD] [output-dir]");

const REQUEST_INTERVAL_MS = 3_000;
const USER_AGENT = "AgendaFrame-Research/1.0 (+https://agendaframe.com)";
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const SOURCE_IDS = new Map([
  ["경향신문", ["khan", "khan_group", ["khan.co.kr"]]],
  ["국민일보", ["kmib", "kmib_group", ["kmib.co.kr"]]],
  ["동아일보", ["donga", "donga_group", ["donga.com"]]],
  ["문화일보", ["munhwa", "munhwa_group", ["munhwa.com"]]],
  ["서울신문", ["seoul", "seoul_group", ["seoul.co.kr"]]],
  ["세계일보", ["segye", "segye_group", ["segye.com"]]],
  ["조선일보", ["chosun", "chosun_group", ["chosun.com"]]],
  ["중앙일보", ["joongang", "joongang_group", ["joongang.co.kr"]]],
  ["한겨레", ["hani", "hani_group", ["hani.co.kr"]]],
  ["한국일보", ["hankookilbo", "hankookilbo_group", ["hankookilbo.com"]]],
  ["매일경제", ["mk", "maekyung_group", ["mk.co.kr"]]],
  ["한국경제", ["hankyung", "hankyung_group", ["hankyung.com"]]],
  ["머니투데이", ["moneytoday", "moneytoday_group", ["mt.co.kr"]]],
  ["서울경제", ["sedaily", "sedaily_group", ["sedaily.com"]]],
  ["아시아경제", ["asiae", "asiae_group", ["asiae.co.kr"]]],
  ["이데일리", ["edaily", "edaily_group", ["edaily.co.kr"]]],
  ["파이낸셜뉴스", ["fnnews", "fnnews_group", ["fnnews.com"]]],
  ["헤럴드경제", ["herald", "herald_group", ["heraldcorp.com"]]],
  ["조선비즈", ["chosunbiz", "chosun_group", ["chosun.com"]]],
  ["연합뉴스", ["yonhap", "yonhap_group", ["yna.co.kr"]]],
  ["뉴시스", ["newsis", "newsis_group", ["newsis.com"]]],
  ["뉴스1", ["news1", "news1_group", ["news1.kr"]]],
]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUrl(value) {
  const url = new URL(String(value ?? "").trim());
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new Error("HTTPS 기사만 수집할 수 있습니다.");
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function hostnameAllowed(hostname, allowedDomains) {
  const normalized = hostname.toLowerCase();
  return allowedDomains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

async function fetchArticle(initialUrl, allowedDomains) {
  let currentUrl = normalizeUrl(initialUrl);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const current = new URL(currentUrl);
    if (!hostnameAllowed(current.hostname, allowedDomains)) {
      throw new Error(`허용되지 않은 리디렉션 도메인: ${current.hostname}`);
    }
    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "user-agent": USER_AGENT,
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) throw new Error("기사 리디렉션을 확인하지 못했습니다.");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if ([403, 429].includes(response.status)) throw new Error(`접근 제한 HTTP ${response.status}`);
    if (!response.ok) throw new Error(`기사 페이지 HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("HTML 기사 페이지가 아닙니다.");
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) throw new Error("기사 페이지가 허용 크기를 초과했습니다.");
    if (/captcha|접근이 제한|비정상적인 접근/i.test(html)) throw new Error("접근 제한 또는 CAPTCHA가 확인됐습니다.");
    return { html, finalUrl: currentUrl };
  }
  throw new Error("기사 리디렉션 한도를 초과했습니다.");
}

const rows = parseBigKindsXlsx(await readFile(file));
const headers = rows[0].map((value) => String(value ?? "").trim());
const column = Object.fromEntries(headers.map((header, index) => [header, index]));
const dateKey = targetDate.replaceAll("-", "");
const inputArticles = rows.slice(1)
  .filter((row) => String(row[column["일자"]] ?? "").replace(/\D/g, "") === dateKey)
  .filter((row) => !String(row[column["분석제외 여부"]] ?? "").trim())
  .flatMap((row) => {
    const source = String(row[column["언론사"]] ?? "").trim();
    const sourceConfig = SOURCE_IDS.get(source);
    const title = String(row[column["제목"]] ?? "").trim();
    const url = String(row[column["URL"]] ?? "").trim();
    if (!sourceConfig || !title || !url) return [];
    const bodyText = String(row[column["본문"]] ?? "").trim();
    const id = String(row[column["뉴스 식별자"]] ?? "").trim() || sha256(url);
    return [{
      id,
      sourceId: sourceConfig[0],
      mediaGroupId: sourceConfig[1],
      allowedDomains: sourceConfig[2],
      source,
      title,
      section: String(row[column["통합 분류1"]] ?? "").trim(),
      url: normalizeUrl(url),
      publishedAt: `${targetDate}T00:00:00+09:00`,
      providerBody: bodyText,
      bodyText,
      transientContent: Boolean(bodyText),
      bodyAnalysisAvailable: bodyText.length >= 40,
      bodyFrameSignals: extractBodyFrameSignals(bodyText),
      textScope: "provider_excerpt",
    }];
  });

const issues = analyzeArticles(inputArticles, {
  configuredSourceCount: SOURCE_IDS.size,
  configuredSourceGroupCount: new Set([...SOURCE_IDS.values()].map((value) => value[1])).size,
  maxIssues: 120,
});
const topIssue = issues[0];
if (!topIssue) throw new Error(`${targetDate} 분석 대상 이슈가 없습니다.`);
const byId = new Map(inputArticles.map((article) => [article.id, article]));
const targetArticles = topIssue.articles.map((article) => byId.get(article.id)).filter(Boolean);
const outputDir = path.resolve(outputRoot, targetDate, sha256(topIssue.title).slice(0, 12));
await mkdir(outputDir, { recursive: true });

const collectedAt = new Date().toISOString();
const collectionResults = [];
const profiles = [];
for (let index = 0; index < targetArticles.length; index += 1) {
  const article = targetArticles[index];
  if (index) await wait(REQUEST_INTERVAL_MS);
  let bodyText = article.providerBody;
  let textScope = "provider_excerpt";
  let extraction = { strategy: "bigkinds-provider-body", quality: null };
  let finalUrl = article.url;
  let fetchStatus = "fallback_provider_excerpt";
  let failureReason = null;
  try {
    const fetched = await fetchArticle(article.url, article.allowedDomains);
    const extracted = extractArticleBody(fetched.html, {
      hostname: new URL(fetched.finalUrl).hostname,
      sourceId: article.sourceId,
    });
    bodyText = extracted.bodyText;
    textScope = "article_body";
    extraction = { strategy: extracted.strategy, quality: extracted.quality };
    finalUrl = fetched.finalUrl;
    fetchStatus = "fetched";
  } catch (error) {
    failureReason = String(error instanceof Error ? error.message : error).slice(0, 240);
    if (!bodyText || bodyText.length < 280) fetchStatus = "failed";
  }

  if (fetchStatus !== "failed") {
    const bodyFile = `${article.id}.txt`;
    await writeFile(path.join(outputDir, bodyFile), bodyText, "utf8");
    const profile = await analyzeArticleFraming({
      articleId: article.id,
      title: article.title,
      bodyText,
      publishedAt: article.publishedAt,
    });
    profile.extraction = {
      strategy: extraction.strategy,
      quality: extraction.quality,
      extractor_version: "public-news-body-v2",
      text_scope: textScope,
    };
    profiles.push(profile);
    collectionResults.push({
      articleId: article.id,
      source: article.source,
      sourceId: article.sourceId,
      mediaGroupId: article.mediaGroupId,
      title: article.title,
      canonicalUrl: article.url,
      finalUrl,
      publishedAt: article.publishedAt,
      collectedAt,
      fetchStatus,
      failureReason,
      bodyFile,
      bodySha256: sha256(bodyText),
      bodyCharacters: bodyText.length,
      textScope,
      extraction,
    });
  } else {
    collectionResults.push({
      articleId: article.id,
      source: article.source,
      sourceId: article.sourceId,
      mediaGroupId: article.mediaGroupId,
      title: article.title,
      canonicalUrl: article.url,
      finalUrl,
      publishedAt: article.publishedAt,
      collectedAt,
      fetchStatus,
      failureReason,
      bodyFile: null,
      bodySha256: null,
      bodyCharacters: 0,
      textScope: null,
      extraction: null,
    });
  }
  console.log(`${index + 1}/${targetArticles.length} ${article.source}: ${fetchStatus}`);
}

const metadata = collectionResults.map((article) => ({
  articleId: article.articleId,
  sourceId: article.sourceId,
  sourceName: article.source,
  mediaGroupId: article.mediaGroupId,
  title: article.title,
  url: article.canonicalUrl,
}));
const comparison = profiles.length
  ? buildIssueFrameComparison(profiles, metadata, {
      issueId: sha256(`${targetDate}:${topIssue.title}`),
      issueTitle: topIssue.title,
    })
  : null;
const manifest = {
  targetDate,
  issue: {
    title: topIssue.title,
    category: topIssue.category,
    agendaScore: topIssue.agendaScore,
    scoreStatus: topIssue.scoreStatus,
    articleCount: topIssue.articleCount,
    sourceCount: topIssue.sourceCount,
    diversityScore: topIssue.diversityScore,
    volumeScore: topIssue.volumeScore,
    repetitionScore: topIssue.repetitionScore,
    clusterQuality: topIssue.clusterQuality,
    humanClusterReview: "confirmed_same_event",
  },
  collection: {
    collectedAt,
    requestIntervalMs: REQUEST_INTERVAL_MS,
    rawBodiesPrivate: true,
    publicBodies: false,
    fetchedArticleBodies: collectionResults.filter((article) => article.textScope === "article_body").length,
    providerExcerptFallbacks: collectionResults.filter((article) => article.textScope === "provider_excerpt").length,
    failed: collectionResults.filter((article) => article.fetchStatus === "failed").length,
  },
  articles: collectionResults,
};

await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
await writeFile(path.join(outputDir, "profiles.json"), JSON.stringify(profiles, null, 2), "utf8");
await writeFile(path.join(outputDir, "comparison.json"), JSON.stringify(comparison, null, 2), "utf8");
console.log(JSON.stringify({
  outputDir,
  issue: manifest.issue,
  collection: manifest.collection,
}, null, 2));
