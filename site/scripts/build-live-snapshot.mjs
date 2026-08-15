/**
 * Operational 2026-08-15 snapshot builder.
 * Uses complete-link analyzeArticles(). Does not invent Vertex lineage,
 * ideology frames, or title-derived evidence hashes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPublicTitle } from "../lib/article-title.mjs";
import { analyzeArticles } from "../worker/analysis.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASIS_DATE = "2026-08-15";
const MIN_ARTICLES = 3;
const MIN_OUTLETS = 2;

const OUTLET_NAMES = {
  chosun: "조선일보",
  donga: "동아일보",
  joongang: "중앙일보",
  hani: "한겨레",
  khan: "경향신문",
  kmib: "국민일보",
  munhwa: "문화일보",
  seoul: "서울신문",
  segye: "세계일보",
  hankookilbo: "한국일보",
  kbs: "KBS 뉴스",
  sbs: "SBS 뉴스",
};

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function loadArticles() {
  const raw = JSON.parse(readFileSync(path.join(siteRoot, "data", "today-articles-2026-08-15.json"), "utf8"));
  const byUrl = new Map();
  for (const article of raw) {
    const url = String(article.canonicalUrl ?? "").trim();
    if (!url) continue;
    const inspected = inspectPublicTitle(article.title);
    const title = inspected.ok ? inspected.title : "";
    const id = sha256(url).slice(0, 32);
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        id,
        articleId: id,
        sourceId: article.sourceId,
        sourceName: article.sourceName ?? OUTLET_NAMES[article.sourceId] ?? article.sourceId,
        title,
        titleStatus: inspected.status,
        titleSource: inspected.ok ? "rss_or_crawl_title" : "unavailable",
        canonicalUrl: url,
        url,
        publishedAt: article.publishedAt,
        section: article.topic,
        mediaGroupId: `${article.sourceId}_group`,
        bodyText: "",
      });
    }
  }
  return [...byUrl.values()].filter((article) => article.title);
}

function publicArticle(article) {
  return {
    articleId: article.id,
    id: article.id,
    title: article.title,
    titleStatus: article.titleStatus ?? "headline",
    outlet: OUTLET_NAMES[article.sourceId] ?? article.sourceName ?? article.sourceId,
    sourceId: article.sourceId,
    mediaGroupId: article.mediaGroupId,
    canonicalUrl: article.canonicalUrl,
    publishedAt: article.publishedAt,
    section: article.section,
  };
}

function buildBundle(issue, rank) {
  const issueId = `live-${BASIS_DATE}-top-${rank}`;
  const articles = issue.articles.map(publicArticle);
  const outlets = [...new Set(articles.map((row) => row.sourceId))];
  return {
    schemaVersion: "agendaframe.initial-five.public.v1",
    basisDate: BASIS_DATE,
    status: "review_needed",
    issue: {
      issueId,
      rank,
      title: issue.title,
      category: issue.category,
      articleCount: articles.length,
      outletCount: outlets.length,
      agendaScore: issue.agendaScore,
      scoreBreakdown: {
        diversity: issue.diversityScore,
        volume: issue.volumeScore,
        cohesion: issue.cohesionScore,
        placement: issue.placementScore,
        repetition: issue.repetitionScore,
      },
    },
    analysisStatus: {
      state: "review_needed",
      cluster: {
        label: "complete_link",
        engineLabel: "complete_link",
        semanticAi: false,
        status: "succeeded",
        model: null,
        promptVersion: null,
        schemaVersion: 1,
        source: "analyzeArticles",
        decision: "cluster",
        coherence: issue.clusterQuality,
        requiresHumanReview: true,
        summary: issue.summary,
      },
      semantic: {
        status: "review_needed",
        engineLabel: "unverified",
        semanticAi: false,
        model: null,
        promptVersion: null,
        schemaVersion: "agendaframe.article-frame-profile.v2",
        source: "pending-vertex",
        succeededArticleCount: 0,
        reviewNeededArticleCount: articles.length,
        requiresHumanReview: true,
        fallbackReason: "no_private_body_for_locator_recheck",
      },
    },
    clusterAi: {
      decision: "cluster",
      coherence: issue.clusterQuality,
      summary: issue.summary,
      source: "analyzeArticles",
      fallbackReason: "framing_unverified",
    },
    articles,
    semanticProfiles: [],
    ruleProfiles: [],
    comparison: {
      engine: { semanticAi: false, version: null, status: "review_needed" },
      data: {
        summary_30_seconds: {
          what_happened: null,
          main_difference: null,
          common_ground: null,
          divergence_detected: false,
        },
        camps: [],
        terms: [],
      },
    },
    lineage: {
      contractVersion: "agendaframe.initial-five.public.v1",
      basisDate: BASIS_DATE,
      issueId,
      clusteringVersion: "agenda-content-aware-complete-link-v7",
      scoreVersion: "observed-agenda-v5",
      source: {
        top5SchemaVersion: "agendaframe.top5-framing-gcp.v1",
        top5GeneratedAt: null,
        metadataSchemaVersion: "agendaframe.metadata-issue-cluster.v1",
        metadataGeneratedAt: null,
        semanticDirectory: "pending-vertex",
        semanticFileCount: 0,
      },
    },
  };
}

export function buildLiveSnapshot() {
  const articles = loadArticles();
  const clustered = analyzeArticles(articles, {
    configuredSourceCount: 12,
    configuredSourceGroupCount: 12,
    maxIssues: 40,
  });
  const eligible = clustered.filter((issue) =>
    issue.articleCount >= MIN_ARTICLES
    && issue.sourceCount >= MIN_OUTLETS
    && issue.clusterQuality !== "insufficient_evidence"
  );
  const top = eligible.slice(0, 5);
  if (!top.length) {
    throw new Error("no eligible 2026-08-15 clusters");
  }
  const bundles = top.map((issue, index) => buildBundle(issue, index + 1));
  const manifest = {
    schemaVersion: "agendaframe.initial-five.public.v1",
    basisDate: BASIS_DATE,
    generatedAt: new Date().toISOString(),
    issueCount: bundles.length,
    articleCount: bundles.reduce((sum, bundle) => sum + bundle.articles.length, 0),
    issues: bundles.map((bundle) => ({
      issueId: bundle.issue.issueId,
      rank: bundle.issue.rank,
      title: bundle.issue.title,
      category: bundle.issue.category,
      articleCount: bundle.issue.articleCount,
      outletCount: bundle.issue.outletCount,
      status: "review_needed",
      payloadKey: `issues/${bundle.issue.issueId}.json`,
      agendaScore: bundle.issue.agendaScore,
      clusterAi: bundle.analysisStatus.cluster,
      semantic: bundle.analysisStatus.semantic,
    })),
  };
  return { manifest, bundles, eligibleCount: eligible.length, scanned: articles.length };
}

function writeSnapshot(result) {
  const issueDir = path.join(siteRoot, "public", "initial-five", "issues");
  mkdirSync(issueDir, { recursive: true });
  writeFileSync(
    path.join(siteRoot, "public", "initial-five", "manifest.json"),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
  );
  for (const bundle of result.bundles) {
    writeFileSync(
      path.join(issueDir, `${bundle.issue.issueId}.json`),
      `${JSON.stringify(bundle, null, 2)}\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}` || process.argv[1]?.endsWith("build-live-snapshot.mjs")) {
  const result = buildLiveSnapshot();
  writeSnapshot(result);
  process.stdout.write(`${JSON.stringify({
    scanned: result.scanned,
    eligible: result.eligibleCount,
    published: result.manifest.issueCount,
    issues: result.manifest.issues.map((issue) => ({
      rank: issue.rank,
      title: issue.title,
      articles: issue.articleCount,
      outlets: issue.outletCount,
      score: issue.agendaScore,
    })),
  }, null, 2)}\n`);
}
