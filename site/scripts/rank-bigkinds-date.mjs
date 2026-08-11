import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isBigKindsExcludedValue, parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";
import { analyzeArticles, extractBodyFrameSignals } from "../worker/analysis.mjs";

const [file, targetDate = "2026-07-26"] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/rank-bigkinds-date.mjs <xlsx> [YYYY-MM-DD]");

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

const rows = parseBigKindsXlsx(await readFile(file));
const headers = rows[0].map((value) => String(value ?? "").trim());
const column = Object.fromEntries(headers.map((header, index) => [header, index]));
for (const required of ["뉴스 식별자", "일자", "언론사", "제목", "통합 분류1", "본문", "URL"]) {
  if (!(required in column)) throw new Error(`Missing column: ${required}`);
}

const dateKey = targetDate.replaceAll("-", "");
const articles = rows.slice(1)
  .filter((row) => String(row[column["일자"]] ?? "").replace(/\D/g, "") === dateKey)
  .filter((row) => !isBigKindsExcludedValue(row[column["분석제외 여부"]]))
  .flatMap((row) => {
    const source = String(row[column["언론사"]] ?? "").trim();
    const sourceConfig = SOURCE_IDS.get(source);
    const title = String(row[column["제목"]] ?? "").trim();
    const url = String(row[column["URL"]] ?? "").trim();
    if (!sourceConfig || !title || !url) return [];
    const bodyText = String(row[column["본문"]] ?? "").trim();
    const id = String(row[column["뉴스 식별자"]] ?? "").trim()
      || createHash("sha256").update(url).digest("hex");
    return [{
      id,
      sourceId: sourceConfig[0],
      mediaGroupId: sourceConfig[1],
      source,
      title,
      section: String(row[column["통합 분류1"]] ?? "").trim(),
      url,
      publishedAt: `${targetDate}T00:00:00+09:00`,
      bodyText,
      transientContent: Boolean(bodyText),
      bodyAnalysisAvailable: bodyText.length >= 40,
      bodyFrameSignals: extractBodyFrameSignals(bodyText),
      textScope: "provider_excerpt",
    }];
  });

const issues = analyzeArticles(articles, {
  configuredSourceCount: SOURCE_IDS.size,
  configuredSourceGroupCount: new Set([...SOURCE_IDS.values()].map((value) => value[1])).size,
  maxIssues: 120,
});

console.log(JSON.stringify({
  targetDate,
  articleCount: articles.length,
  issueCount: issues.length,
  topIssues: issues.slice(0, 15).map((issue, index) => ({
    rank: index + 1,
    title: issue.title,
    category: issue.category,
    agendaScore: issue.agendaScore,
    scoreStatus: issue.scoreStatus,
    articleCount: issue.articleCount,
    sourceCount: issue.sourceCount,
    diversityScore: issue.diversityScore,
    volumeScore: issue.volumeScore,
    repetitionScore: issue.repetitionScore,
    clusterQuality: issue.clusterQuality,
    articles: issue.articles.map((article) => ({
      id: article.id,
      source: article.source,
      title: article.title,
      url: article.url,
      similarity: article.similarity,
    })),
  })),
}, null, 2));
