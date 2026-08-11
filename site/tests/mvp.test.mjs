import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sourcePanel from "../data/sources.json" with { type: "json" };
import { ANALYSIS_MODEL_VERSION, ANALYSIS_PROVIDER, PUBLIC_AGENDA_CATEGORIES, analyzeArticles, classifyAgendaCategory, cleanHeadlineToIssueTitle, titleTokens } from "../worker/analysis.mjs";
import { getAnalysisProvider } from "../worker/analysis-provider.mjs";
import { approvedClusterApprovals, calculateQualityMetrics, canonicalizeArticleUrl, classifySnapshotStatus, clusterArticleSetSha256, clusterArticleSignature, configureSourcePanel, enumerateKstDates, extractArticleBodyFromHtml, handleApiRequest, resolveArticleFetchSource, resolveClusterApproval, resolveContentEvidenceCount, validateAnalyzedImportRows, validateImportRows, validateStructuredImportRows, withDocumentSecurityHeaders, withSecurityHeaders } from "../worker/runtime.mjs";

configureSourcePanel(sourcePanel);

test("resolves broadcaster article fetches through the approved research panel", () => {
  const kbs = resolveArticleFetchSource({ sourceId: "kbs", source: "KBS" });
  const sbs = resolveArticleFetchSource({ sourceId: "sbs", source: "SBS" });
  assert.equal(kbs?.active, true);
  assert.deepEqual(kbs?.domains, ["kbs.co.kr"]);
  assert.equal(sbs?.active, true);
  assert.deepEqual(sbs?.domains, ["sbs.co.kr"]);
});

test("counts every structured article profile as available body evidence", () => {
  assert.equal(resolveContentEvidenceCount({ contentAvailableCount: 3, structuredProfileCount: 6 }), 6);
  assert.equal(resolveContentEvidenceCount({ contentAvailableCount: 5, structuredProfileCount: 2 }), 5);
});

test("builds the real React dashboard and admin application", async () => {
  const manifest = JSON.parse(await readFile(new URL("../dist/client/.vite/manifest.json", import.meta.url), "utf8"));
  const builtFiles = Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? [])]).join("\n");
  assert.match(builtFiles, /agenda-dashboard/);
  assert.match(builtFiles, /admin-client/);

  const worker = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(worker, /\/api\/analyze/);
  assert.match(worker, /structured_extractive/);
  assert.match(worker, /agenda-structure-v6/);
  assert.match(worker, /\/api\/quality/);
  assert.match(worker, /\/api\/analysis\/runs/);
  assert.match(worker, /\/api\/analyze\/transient/);
  assert.match(worker, /profiles\.review_status != 'rejected'/);
  assert.match(worker, /'automatic_draft'/);
  assert.match(worker, /\/api\/chat/);
  assert.match(worker, /\/api\/admin\/release\/evaluate/);
  assert.match(worker, /community_comments/);
});

test("binds a same-event approval to the exact canonical URL set", () => {
  const first = clusterArticleSignature([
    "https://www.hani.co.kr/arti/politics/a.html?utm_source=trial",
    "https://www.khan.co.kr/article/b",
  ]);
  const reordered = clusterArticleSignature([
    "https://www.khan.co.kr/article/b",
    "https://www.hani.co.kr/arti/politics/a.html",
  ]);
  const changed = clusterArticleSignature([
    "https://www.khan.co.kr/article/c",
    "https://www.hani.co.kr/arti/politics/a.html",
  ]);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("requires approval identity and fingerprint for the exact semantic cluster URL set", async () => {
  const urls = [
    "https://www.hani.co.kr/arti/politics/a.html?utm_source=trial",
    "https://www.khan.co.kr/article/b",
  ];
  const approvedUrlsSha256 = await clusterArticleSetSha256(urls);
  const inputApproval = {
    authorization_id: "authorization-2026-07-26",
    fingerprint: "a".repeat(64),
    cluster_id: "cluster-rank-1",
    reviewer: "reviewer-1",
    reviewed_at: "2026-07-30T12:00:00+09:00",
    approved_urls_sha256: approvedUrlsSha256,
    approved_urls: urls,
  };
  const approvals = await approvedClusterApprovals({
    approved_same_event_clusters: [inputApproval],
  });
  const profile = {
    schema_version: "agendaframe.article-frame-profile.v2",
    engine: {
      semantic_ai: true,
      version: "gemini-fixture",
      prompt_version: "2.1.0",
    },
    lineage: {
      model_id: "gemini-fixture",
      prompt_version: "2.1.0",
      analysis_schema_version: "agendaframe.article-frame-profile.v2",
      comparison_engine_version: "korean-evidence-rules-v2",
      approval: {
        authorization_id: inputApproval.authorization_id,
        fingerprint: inputApproval.fingerprint,
        cluster_id: inputApproval.cluster_id,
        reviewer: inputApproval.reviewer,
        reviewed_at: inputApproval.reviewed_at,
        approved_urls_sha256: inputApproval.approved_urls_sha256,
      },
    },
  };

  const matched = resolveClusterApproval([...urls].reverse(), [profile], approvals);
  assert.equal(matched.authorizationId, inputApproval.authorization_id);
  assert.equal(matched.clusterId, inputApproval.cluster_id);
  assert.equal(matched.reviewedAt, "2026-07-30T03:00:00.000Z");
  assert.throws(
    () => resolveClusterApproval([urls[0], "https://www.khan.co.kr/article/changed"], [profile], approvals),
    /exact issue URL set/,
  );

  const mismatchedProfile = structuredClone(profile);
  mismatchedProfile.lineage.approval.fingerprint = "b".repeat(64);
  assert.throws(
    () => resolveClusterApproval(urls, [mismatchedProfile], approvals),
    /does not match/,
  );
  await assert.rejects(
    approvedClusterApprovals({
      approved_same_event_clusters: [{ ...inputApproval, approved_urls_sha256: "c".repeat(64) }],
    }),
    /정확한 URL 집합/,
  );
  await assert.rejects(
    approvedClusterApprovals({ approved_same_event_clusters: [urls] }),
    /URL 배열만으로는 승인할 수 없습니다/,
  );
});

test("keeps the public dashboard focused on date, issue, and outlet exploration", async () => {
  const dashboard = await readFile(new URL("../app/agenda-dashboard.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  for (const copy of ["전체 데이터", "날짜·의제·매체로 기사 찾기", "분석 기준일과 의제를 고른 뒤", "중요도·사실성·여론을 뜻하지 않습니다"]) {
    assert.match(dashboard, new RegExp(copy));
  }
  for (const reportCopy of ["근거가 부족한 분석은", "현재 본문 근거 없음", "사람 검토</dt>"]) {
    assert.doesNotMatch(dashboard, new RegExp(reportCopy));
  }
  for (const copy of ["어디서 갈렸나", "쟁점 지도", "기사들이 연결한 서사", "근거로 만든 독자 질문"]) {
    assert.match(dashboard, new RegExp(copy));
  }
  assert.match(dashboard, /학술연구 12개 매체/);
  assert.match(dashboard, /fetch\(`\/api\/sources\?scope=\$\{scope\}`/);
  assert.match(dashboard, /fetch\(`\/api\/issues\/dates\?limit=31&scope=\$\{resolvedScope\}`/);
  assert.match(dashboard, /분석 기준일/);
  assert.match(dashboard, /archive-disclosure/);
  assert.doesNotMatch(dashboard, /핵심 의제 우선 · 스포츠·생활·IT 후순위/);
  const topNavigation = dashboard.match(/<nav className="topnav"[\s\S]*?<\/nav>/)?.[0] ?? "";
  for (const copy of ["의제 비교", "전체 데이터", "도구"]) assert.match(topNavigation, new RegExp(copy));
  assert.doesNotMatch(topNavigation, /기사 검색/);
  assert.doesNotMatch(dashboard, /\["한겨레","경향신문","한국일보","중앙일보","조선일보"\]/);
  assert.match(dashboard, /<details className="score-details">/);
  assert.match(dashboard, /분석 이력과 승인 근거/);
  assert.match(dashboard, /approvedUrlsSha256/);
  assert.match(dashboard, /role="tab"/);
  assert.match(dashboard, /aria-controls={`analysis-panel-/);
  assert.match(dashboard, /academic_panel_12/);
  assert.match(dashboard, /LEGACY_ISSUE_SCOPE = "general_daily_10"/);
  assert.match(dashboard, /if \(!nextDates\.length\)/);
  assert.match(dashboard, /FramingEditorialView/);
  assert.doesNotMatch(dashboard, /\["chat", "AI 대화"\]/u);
  assert.doesNotMatch(dashboard, /\["selfcheck", "자기점검"\]/u);
  assert.doesNotMatch(dashboard, /\["community", "커뮤니티"\]/u);
  assert.doesNotMatch(dashboard, /신뢰도 \{/);
  assert.doesNotMatch(dashboard, /agenda-list" aria-live/);
  assert.match(dashboard, /그날 언론이 가장 많이 다룬 분야/);
  assert.match(dashboard, /DAY_CATEGORY_DIST/);
  assert.match(dashboard, /DAY_CATEGORY_TOTAL/);
  assert.match(dashboard, /DAY_CATEGORY_OUTLET_TOTAL = 10/);
  assert.match(dashboard, /기존 수집본\(\{DAY_CATEGORY_OUTLET_TOTAL\}개 언론사\)/);
  assert.doesNotMatch(dashboard, /22개 언론사 온라인 수집분/);
  assert.match(styles, /\.day-category-dist/);

  assert.match(styles, /\.hero-copy, \.snapshot \{ min-width: 0; \}/);
  assert.match(styles, /@media \(max-width: 780px\)/);
  assert.match(styles, /\.live-filter-form input, \.live-filter-form select \{ font-size: 16px; \}/);
  assert.match(styles, /min-height: 44px/);
});

test("keeps the app shell font CSS local so CSP needs no remote stylesheet exception", async () => {
  const styles = await readFile(new URL("../app/app-shell.css", import.meta.url), "utf8");

  assert.doesNotMatch(styles, /@import\s+url\([\"']https?:\/\//i);
});

/* 화면 구성은 (shell) 라우트 그룹으로 옮겼다(홈 = 하루 단위 지형, 도구 = /tools/*).
   단일 페이지 리더(InitialFiveExperience)는 /top5-2026-07-26 에 그대로 남아 있다.
   이 테스트가 지키려는 것은 파일 경로가 아니라 그 분리다. */
test("keeps the initial-five reader surface separate from site-wide tools", async () => {
  const home = await readFile(new URL("../app/(shell)/page.tsx", import.meta.url), "utf8");
  const reader = await readFile(new URL("../app/initial-five.tsx", import.meta.url), "utf8");
  const legacyReaderRoute = await readFile(new URL("../app/top5-2026-07-26/page.tsx", import.meta.url), "utf8");
  const method = await readFile(new URL("../app/(shell)/tools/method/page.tsx", import.meta.url), "utf8");
  const selfCheck = await readFile(new URL("../app/(shell)/tools/self-check/page.tsx", import.meta.url), "utf8");
  const community = await readFile(new URL("../app/(shell)/tools/community/page.tsx", import.meta.url), "utf8");

  // 홈은 최신 12개 매체 수집·분석 화면으로 곧바로 이동한다.
  assert.match(home, /redirect\("\/dashboard"\)/);
  assert.doesNotMatch(home, /InitialFiveExperience/);
  // 단일 페이지 리더는 /initial-five로 이동하고 옛 경로 /top5-2026-07-26는 리다이렉트한다
  assert.match(legacyReaderRoute, /redirect\("\/initial-five"\)/);
  assert.match(reader, /role="tablist"/);
  assert.match(reader, /role="tabpanel"/);
  // 도구 화면은 각자의 컴포넌트를 쓴다
  assert.match(selfCheck, /ReaderTypeQuiz/);
  assert.match(community, /CommunityFeed/);
  // 방법론 화면은 코더 간 일치율을 공개한다 (내용분석 공개 계약)
  assert.match(method, /두 코더가 얼마나 같게 판정했나/);
  assert.match(method, /coderAgreement/);
});

test("packages Sites hosting metadata and database migrations", async () => {
  const hosting = JSON.parse(await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"));
  assert.equal(hosting.project_id, "appgprj_6a54eb02c21c819199c3369cc67c6857");
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "CONTENT");
  const migration = await readFile(new URL("../dist/.openai/drizzle/0001_easy_dexter_bennett.sql", import.meta.url), "utf8");
  for (const table of ["analysis_runs", "issues", "issue_articles", "frame_analyses", "ai_reports"]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
  }
  const qualityMigration = await readFile(new URL("../dist/.openai/drizzle/0002_colorful_master_mold.sql", import.meta.url), "utf8");
  for (const table of ["quality_reviews", "quality_review_article_flags", "quality_review_missing_articles"]) {
    assert.ok(qualityMigration.includes(`CREATE TABLE \`${table}\``));
  }
  const evidenceMigration = await readFile(new URL("../dist/.openai/drizzle/0003_complex_mikhail_rasputin.sql", import.meta.url), "utf8");
  for (const table of ["homepage_snapshots", "placement_observations", "article_contents"]) {
    assert.ok(evidenceMigration.includes(`CREATE TABLE \`${table}\``));
  }
  const bodySignalMigration = await readFile(new URL("../dist/.openai/drizzle/0004_colossal_kylun.sql", import.meta.url), "utf8");
  assert.ok(bodySignalMigration.includes("CREATE TABLE `article_body_signals`"));
  const structuredFrameMigration = await readFile(new URL("../dist/.openai/drizzle/0005_structured_frame_profiles.sql", import.meta.url), "utf8");
  for (const table of ["article_frame_profiles", "issue_frame_comparisons"]) {
    assert.ok(structuredFrameMigration.includes(`CREATE TABLE \`${table}\``));
  }
});

test("calculates transparent human-review quality estimates", () => {
  const metrics = calculateQualityMetrics([
    { reviewId: "r1", articleCount: 10, misplacedCount: 2, missingCount: 1, sourceCount: 5, clusterVerdict: "correct", agendaVerdict: "appropriate", frameVerdict: "appropriate" },
    { reviewId: "r2", articleCount: 5, misplacedCount: 0, missingCount: 4, sourceCount: 3, clusterVerdict: "partial", agendaVerdict: "overstated", frameVerdict: "partial" },
    { reviewId: null, articleCount: 20, misplacedCount: 0, missingCount: 0, sourceCount: 5 },
  ]);
  assert.equal(metrics.reviewedIssueCount, 2);
  assert.equal(metrics.reviewedArticleCount, 15);
  assert.equal(metrics.misplacedArticleCount, 2);
  assert.equal(metrics.missingArticleCount, 5);
  assert.equal(metrics.estimatedPrecision, 86.7);
  assert.equal(metrics.estimatedRecall, 72.2);
  assert.equal(metrics.overmergeRate, 13.3);
  assert.equal(metrics.undermergeRate, 27.8);
  assert.equal(metrics.pairwiseF1, null);
  assert.equal(metrics.hardNegativeAccuracy, null);
  assert.equal(metrics.clusterAgreement, 75);
  assert.equal(metrics.agendaAgreement, 50);
  assert.equal(metrics.frameAgreement, 75);
  assert.equal(metrics.sourceDiversityCoverage, 80);
  assert.equal(metrics.progressPercent, 4);
  assert.equal(metrics.sampleStatus, "collecting");
});

test("enumerates safe resumable KST analysis ranges", () => {
  assert.deepEqual(enumerateKstDates("2026-07-08", "2026-07-14", 7), [
    "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14",
  ]);
  assert.throws(() => enumerateKstDates("2026-07-14", "2026-07-08", 7), /종료일/);
  assert.throws(() => enumerateKstDates("2026-07-01", "2026-07-08", 7), /최대 7일/);
  assert.throws(() => enumerateKstDates("2026-02-30", "2026-03-01", 7), /유효한 분석 기간/);
});

test("clusters real-looking article titles and produces explainable scores", () => {
  const articles = [
    { id: "a1", sourceId: "hani", source: "한겨레", title: "정부 청년 주거 지원 정책 확대 발표", section: "정치>행정", homepagePlacement: "top" },
    { id: "a2", sourceId: "khan", source: "경향신문", title: "정부, 청년 주거 지원 정책 확대", section: "정치>행정", homepagePlacement: "main" },
    { id: "a3", sourceId: "chosun", source: "조선일보", title: "청년 주거 지원 확대…정부 정책 효과는", section: "정치>행정", homepagePlacement: "section" },
    { id: "a4", sourceId: "joongang", source: "중앙일보", title: "한국은행 기준금리 동결 결정", section: "경제>금융", homepagePlacement: "list" },
  ];
  const issues = analyzeArticles(articles, { configuredSourceCount: 5 });
  const housing = issues.find((issue) => issue.articleCount === 3);
  assert.ok(housing);
  assert.equal(housing.sourceCount, 3);
  assert.equal(housing.diversityScore, 60);
  assert.equal(housing.frames.length, 6);
  assert.equal(housing.articles.filter((article) => article.representative).length, 1);
  assert.match(housing.report.summary, /제목/);
  assert.match(housing.report.caution, /제목 표현/);
  assert.ok(housing.agendaScore > issues.find((issue) => issue.articleCount === 1).agendaScore);
  assert.deepEqual(titleTokens("[단독] 정부의 청년 주거지원 정책 발표"), ["청년", "주거지원", "정책", "발표"]);
  assert.equal(ANALYSIS_PROVIDER, "structured_extractive");
  assert.equal(ANALYSIS_MODEL_VERSION, "agenda-structure-v6");
  assert.equal(getAnalysisProvider().analyze, analyzeArticles);
  assert.throws(() => getAnalysisProvider("vertex_ai"), /지원하지 않는 분석 공급자/);
});

test("keeps issue names event-shaped instead of appending a generic issue suffix", () => {
  assert.equal(cleanHeadlineToIssueTitle("검경 수사팀 수사 수사 이슈"), "검경 수사팀 수사");
  assert.equal(cleanHeadlineToIssueTitle("중대재해처벌법 개정안 국회 통과 이슈"), "중대재해처벌법 개정안 국회 통과");
  assert.doesNotMatch(cleanHeadlineToIssueTitle("정부 정책 이슈"), /이슈$/u);
});

test("counts related outlets but deduplicates shared media groups in coverage", () => {
  const issues = analyzeArticles([
    { id: "c1", sourceId: "chosun", source: "조선일보", mediaGroupId: "chosun_group", title: "정부 청년 주거 지원 정책 확대 발표", section: "정치" },
    { id: "c2", sourceId: "chosunbiz", source: "조선비즈", mediaGroupId: "chosun_group", title: "정부 청년 주거 지원 정책 확대", section: "정치" },
  ], { configuredSourceCount: 2, configuredSourceGroupCount: 2 });
  assert.equal(issues[0].sourceCount, 2);
  assert.equal(issues[0].diversityScore, 50);
});

test("merges shared agenda concepts and keeps sports or lifestyle technology after core categories", () => {
  const issues = analyzeArticles([
    { id: "authority-1", sourceId: "hani", source: "한겨레", title: "검찰개혁 쟁점 보완수사권 유지 범위 논의", section: "정치" },
    { id: "authority-2", sourceId: "khan", source: "경향신문", title: "보완수사권 행사 범위 두고 여야 공방", section: "정치" },
    { id: "sports-1", sourceId: "chosun", source: "조선일보", title: "프로야구 감독 선임 발표", section: "스포츠" },
    { id: "tech-1", sourceId: "joongang", source: "중앙일보", title: "새 스마트폰 카메라 기술 공개", section: "IT_과학" },
    { id: "platform-1", sourceId: "hankook", source: "한국일보", title: "온라인 플랫폼 수수료 규제 법안 추진", section: "IT_과학" },
  ], { configuredSourceCount: 5 });

  const authority = issues.find((issue) => issue.title === "보완수사권 제도 논쟁");
  assert.ok(authority);
  assert.equal(authority.articleCount, 2);
  assert.deepEqual(authority.articles.map((article) => article.id).sort(), ["authority-1", "authority-2"]);
  assert.ok(issues.every((issue) => PUBLIC_AGENDA_CATEGORIES.includes(issue.category)));
  assert.equal(issues.find((issue) => issue.articles.some((article) => article.id === "sports-1"))?.category, "스포츠");
  assert.equal(issues.find((issue) => issue.articles.some((article) => article.id === "tech-1"))?.category, "생활·IT");
  assert.ok(issues.findIndex((issue) => issue.category === "스포츠") > issues.findIndex((issue) => issue.category === "경제"));
  assert.ok(issues.findIndex((issue) => issue.category === "생활·IT") > issues.findIndex((issue) => issue.category === "경제"));
  assert.equal(classifyAgendaCategory({ title: "온라인 플랫폼 수수료 규제 법안 추진", section: "IT_과학" }), "경제");
  assert.equal(classifyAgendaCategory({ title: "새 스마트폰 카메라 기술 공개", section: "IT_과학" }), "생활·IT");
});

test("proxies both the Vercel root and nested routes to the validated origin", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel-proxy/vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.rewrites, [
    {
      source: "/",
      destination: "https://agendaframe-capstone.kjh01072299206.chatgpt.site/",
    },
    {
      source: "/:path*",
      destination: "https://agendaframe-capstone.kjh01072299206.chatgpt.site/:path*",
    },
  ]);
});

test("uses repeated placement observations and keeps authorized body text private", () => {
  const privateBody = "정부 정책의 책임 소재를 두고 국회와 관계 부처가 서로 다른 설명을 내놓았다. 관계자는 후속 대책을 검토한다고 밝혔다.";
  const [issue] = analyzeArticles([
    {
      id: "body-1",
      sourceId: "hani",
      source: "한겨레",
      title: "정부 청년 주거 정책 확대 발표",
      section: "정치",
      bodyText: privateBody,
      contentVersionId: "content-1",
      publicEvidenceAllowed: false,
      placementObservations: [
        { zone: "top", pageRank: 1, aboveFold: true, observedAt: 1 },
        { zone: "main", pageRank: 3, aboveFold: true, observedAt: 2 },
      ],
    },
  ]);
  const responsibility = issue.frames.find((frame) => frame.frame === "responsibility");
  assert.equal(issue.placementObservedCount, 1);
  assert.equal(issue.placementObservationCount, 2);
  assert.equal(issue.placementScore, 91);
  assert.equal(responsibility.evidenceBasis, "body_private");
  assert.equal(responsibility.contentVersionId, "content-1");
  assert.match(responsibility.evidenceText, /공개 검토 전/);
  assert.equal(issue.articles[0].contentAvailable, true);
  assert.equal("bodyText" in issue.articles[0], false);
  assert.equal(JSON.stringify(issue).includes(privateBody), false);

  const [transientIssue] = analyzeArticles([{
    id: "body-transient-1",
    sourceId: "hani",
    source: "한겨레",
    title: "정부 청년 주거 정책 확대 발표",
    section: "정치",
    bodyText: privateBody,
    transientContent: true,
  }]);
  const transientResponsibility = transientIssue.frames.find((frame) => frame.frame === "responsibility");
  assert.equal(transientResponsibility.evidenceBasis, "body_transient");
  assert.equal(transientResponsibility.contentVersionId, null);
  assert.equal(transientResponsibility.evidenceStart, null);
  assert.equal(transientResponsibility.evidenceEnd, null);
  assert.match(transientResponsibility.evidenceText, /전문과 원문 문장은 저장하지 않았습니다/);
  assert.equal(JSON.stringify(transientIssue).includes(privateBody), false);
});

test("stores only attested article bodies in the private object binding", async () => {
  const statements = [];
  const objects = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          if (sql.includes("SELECT a.id, a.title")) return { first: async () => ({ id: "article-1", title: "검증 기사", source: "한겨레" }) };
          if (sql.includes("FROM article_contents") && sql.includes("body_hash")) return { first: async () => null };
          if (sql.includes("INSERT INTO article_contents")) return { run: async () => ({ success: true }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const CONTENT = { put: async (key, value, options) => objects.push({ key, value, options }) };
  const body = "정부 정책의 문제 정의와 책임 소재, 시민 영향, 제도 개선 대안을 여러 취재원의 발언과 함께 설명한다. ".repeat(8);
  const request = new Request("https://example.test/api/content", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://www.hani.co.kr/arti/politics/test.html",
      body,
      acquired_at: "2026-07-19T10:00:00+09:00",
      acquisition_method: "manual_research",
      usage_basis: "연구 프로젝트에서 분석이 허용된 내부 표본",
      analysis_allowed: true,
      public_evidence_allowed: false,
      rights_attested: true,
    }),
  });
  const response = await handleApiRequest(request, { DB, CONTENT, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 201);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].value, body.trim());
  assert.match(objects[0].key, /^article-content\/article-1\/[a-f0-9]{64}\.txt$/);
  const result = await response.json();
  assert.equal(result.publicEvidenceAllowed, false);
  assert.equal("body" in result, false);
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO article_contents")));

  const unattested = await handleApiRequest(new Request("https://example.test/api/content", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ url: "https://www.hani.co.kr/arti/politics/test.html", body, rights_attested: false }),
  }), { DB, CONTENT, IMPORT_TOKEN: "correct" });
  assert.equal(unattested.status, 400);
  assert.match((await unattested.json()).error.message, /권한/);
  assert.equal(objects.length, 1);
});

test("extracts a full article body from publisher JSON-LD and rejects explicit paywalls", () => {
  const body = "정부는 정책 변경의 배경과 시행 일정을 설명했고 국회와 시민단체는 책임 소재와 보완 대책을 각각 제시했다. ".repeat(12).trim();
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", isAccessibleForFree: true, articleBody: body })}</script></head><body><article>짧은 화면 요약</article></body></html>`;
  assert.equal(extractArticleBodyFromHtml(html), body);
  const paid = `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", isAccessibleForFree: false, articleBody: body })}</script>`;
  assert.throws(() => extractArticleBodyFromHtml(paid), /유료|구독/);
});

test("resumes public body analysis across batches and stores only derived signals", async () => {
  const statements = [];
  const requested = [];
  const signalRows = new Map();
  const profileRows = new Map();
  const articles = [
    {
      id: "article-fetch-1",
      sourceId: "hani",
      source: "한겨레",
      title: "정부 정책 변경 배경과 후속 대책",
      canonicalUrl: "https://www.hani.co.kr/arti/politics/fetch-test-1.html",
      url: "https://www.hani.co.kr/arti/politics/fetch-test-1.html",
      section: "정치",
      publishedAt: Date.parse("2026-07-19T10:00:00+09:00"),
      collectedAt: Date.parse("2026-07-19T10:05:00+09:00"),
      homepagePlacement: "main",
      homepageRank: 2,
    },
    {
      id: "article-fetch-2",
      sourceId: "khan",
      source: "경향신문",
      title: "정부 정책 변경 책임과 후속 대책",
      canonicalUrl: "https://www.khan.co.kr/politics/fetch-test-2.html",
      url: "https://www.khan.co.kr/politics/fetch-test-2.html",
      section: "정치",
      publishedAt: Date.parse("2026-07-19T09:30:00+09:00"),
      collectedAt: Date.parse("2026-07-19T10:06:00+09:00"),
      homepagePlacement: "main",
      homepageRank: 3,
    },
  ];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          const statement = {
            sql,
            parameters,
            all: async () => {
              if (sql.includes("a.canonical_url AS canonicalUrl")) {
                const limit = Number(parameters.at(-1));
                return { results: articles.filter((article) => !profileRows.has(article.id)).slice(0, limit) };
              }
              if (sql.includes("a.canonical_url AS url")) return { results: articles };
              if (sql.includes("FROM placement_observations")) return { results: [] };
              if (sql.includes("FROM article_body_signals signals")) {
                return { results: [...signalRows].filter(([, row]) => row.status === "analyzed").map(([articleId, row]) => ({ articleId, detectedFrames: row.detectedFrames })) };
              }
              if (sql.includes("FROM article_frame_profiles profiles")) {
                return { results: [...profileRows].filter(([, row]) => row.status === "analyzed").map(([articleId, row]) => ({ articleId, profileJson: row.profileJson })) };
              }
              throw new Error(`Unexpected all SQL: ${sql}`);
            },
            first: async () => {
              if (sql.includes("COUNT(*) AS total") && sql.includes("article_frame_profiles profiles")) {
                const analyzed = [...profileRows.values()].filter((row) => row.status === "analyzed").length;
                const failed = [...profileRows.values()].filter((row) => row.status === "failed").length;
                return { total: articles.length, analyzed, failed };
              }
              throw new Error(`Unexpected first SQL: ${sql}`);
            },
            run: async () => ({ success: true }),
          };
          statements.push(statement);
          return statement;
        },
      };
    },
    batch: async (batch) => {
      for (const statement of batch) {
        if (statement.sql.includes("INSERT INTO article_body_signals")) {
          signalRows.set(statement.parameters[1], {
            detectedFrames: statement.parameters[4],
            status: statement.parameters[5],
          });
        }
        if (statement.sql.includes("INSERT INTO article_frame_profiles")) {
          profileRows.set(statement.parameters[1], {
            profileJson: statement.parameters[4],
            status: statement.parameters[5],
          });
        }
      }
      return batch.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const body = "정부는 정책 변경의 배경과 시행 일정을 설명했다. 국회와 시민단체는 책임 소재와 보완 대책을 각각 제시했다. ".repeat(12).trim();
  const ARTICLE_FETCHER = {
    fetch: async (url, options) => {
      requested.push({ url, options });
      return new Response(`<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", isAccessibleForFree: true, articleBody: body })}</script>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  };
  const requestForBatch = () => new Request("https://example.test/api/analyze/transient", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({
      date: "2026-07-19",
      limit: 1,
      transient_analysis_acknowledged: true,
    }),
  });

  const firstResponse = await handleApiRequest(requestForBatch(), { DB, ARTICLE_FETCHER, IMPORT_TOKEN: "correct" });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.deepEqual(first.progress, { total: 2, processed: 1, analyzed: 1, failed: 0, remaining: 1 });
  assert.equal(first.complete, false);
  assert.equal(first.analysis, null);

  const secondResponse = await handleApiRequest(requestForBatch(), { DB, ARTICLE_FETCHER, IMPORT_TOKEN: "correct" });
  assert.equal(secondResponse.status, 201);
  const second = await secondResponse.json();
  assert.deepEqual(second.progress, { total: 2, processed: 2, analyzed: 2, failed: 0, remaining: 0 });
  assert.equal(second.complete, true);
  assert.equal(second.bodyStorageCount, 0);
  assert.equal(second.analysis.transientBodyCount, 2);
  assert.equal(second.analysis.authorizedBodyCount, 0);
  assert.equal(second.analysis.bodyEvidenceCount, 2);
  assert.equal("content" in second.results[0], false);
  assert.equal(JSON.stringify(second).includes(body), false);
  assert.deepEqual(requested.map((entry) => entry.url), articles.map((article) => article.canonicalUrl));
  assert.ok(requested.every((entry) => entry.options.redirect === "manual"));
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO article_body_signals")));
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO article_frame_profiles")));
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO issue_frame_comparisons")));
  const comparisonInsert = statements.find((statement) => statement.sql.includes("INSERT INTO issue_frame_comparisons"));
  const storedComparison = JSON.parse(comparisonInsert.parameters[2]);
  assert.ok(storedComparison.analysisModules?.frameComposition);
  assert.ok(storedComparison.analysisModules?.genericFrames);
  assert.ok(storedComparison.analysisModules?.compositionClusters);
  assert.ok(storedComparison.analysisModules?.semanticNetworks);
  assert.ok(storedComparison.analysisModules?.devices);
  assert.ok(storedComparison.analysisModules?.reportingStyle);
  assert.ok(storedComparison.analysisModules?.morphology);
  assert.ok(storedComparison.analysisModules.morphology.byOutlet.every((outlet) => Number.isInteger(outlet.negationCount)));
  assert.doesNotMatch(JSON.stringify(storedComparison), /"(?:raw_body|bodyText|sentenceText|tokens)"\s*:/i);
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO frame_analyses") && statement.parameters.includes("body_transient")));
  assert.ok(!statements.some((statement) => statement.sql.includes("INSERT INTO article_contents")));
  assert.equal(JSON.stringify(statements).includes(body), false);

  const statusResponse = await handleApiRequest(new Request("https://example.test/api/analyze/transient?date=2026-07-19", {
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin" },
  }), { DB, IMPORT_TOKEN: "correct" });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).complete, true);

  const unacknowledged = await handleApiRequest(new Request("https://example.test/api/analyze/transient", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ date: "2026-07-19", limit: 5, transient_analysis_acknowledged: false }),
  }), { DB, ARTICLE_FETCHER, IMPORT_TOKEN: "correct" });
  assert.equal(unacknowledged.status, 400);
  assert.match((await unacknowledged.json()).error.message, /조건/);
  assert.equal(requested.length, 2);
});

test("targets transient analysis to explicit canonical URLs and accepts the one-time operations token", async () => {
  const articles = [
    {
      id: "target-1",
      sourceId: "chosun",
      source: "조선일보",
      title: "첫 기사",
      canonicalUrl: "https://www.chosun.com/politics/target-1/",
      publishedAt: Date.parse("2026-07-26T10:00:00+09:00"),
    },
    {
      id: "target-2",
      sourceId: "donga",
      source: "동아일보",
      title: "둘째 기사",
      canonicalUrl: "https://www.donga.com/news/Politics/article/all/20260726/1/1",
      publishedAt: Date.parse("2026-07-26T11:00:00+09:00"),
    },
  ];
  const profileRows = new Map();
  const requested = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          return {
            sql,
            parameters,
            all: async () => {
              if (!sql.includes("a.canonical_url AS canonicalUrl")) throw new Error(`Unexpected all SQL: ${sql}`);
              assert.match(sql, /a\.canonical_url IN \(\?\)/);
              assert.ok(parameters.includes(articles[1].canonicalUrl));
              return { results: [articles[1]] };
            },
            first: async () => {
              if (!sql.includes("COUNT(*) AS total")) throw new Error(`Unexpected first SQL: ${sql}`);
              assert.match(sql, /a\.canonical_url IN \(\?\)/);
              assert.ok(parameters.includes(articles[1].canonicalUrl));
              const row = profileRows.get(articles[1].id);
              return {
                total: 1,
                analyzed: row?.status === "analyzed" ? 1 : 0,
                failed: row?.status === "failed" ? 1 : 0,
              };
            },
            run: async () => ({ success: true }),
          };
        },
      };
    },
    batch: async (batch) => {
      for (const statement of batch) {
        if (statement.sql.includes("INSERT INTO article_frame_profiles")) {
          profileRows.set(statement.parameters[1], { status: statement.parameters[5] });
        }
      }
      return batch.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const ARTICLE_FETCHER = {
    fetch: async (url) => {
      requested.push(url);
      return new Response("blocked", { status: 403 });
    },
  };
  const response = await handleApiRequest(new Request("https://example.test/api/analyze/transient", {
    method: "POST",
    headers: {
      authorization: "Bearer one-time",
      origin: "https://example.test",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      date: "2026-07-26",
      limit: 10,
      transient_analysis_acknowledged: true,
      canonical_urls: [articles[1].canonicalUrl],
    }),
  }), { DB, ARTICLE_FETCHER, CODEX_IMPORT_TOKEN: "one-time" });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.targeted, true);
  assert.equal(body.targetCount, 1);
  assert.equal(body.requested, 1);
  assert.equal(body.failed, 1);
  assert.deepEqual(body.progress, { total: 1, processed: 1, analyzed: 0, failed: 1, remaining: 0 });
  assert.deepEqual(requested, [articles[1].canonicalUrl]);
});

test("accepts authenticated homepage geometry as repeated observations", async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          const statement = { sql, parameters, run: async () => ({ success: true }), first: async () => ({ count: 1 }) };
          statements.push(statement);
          return statement;
        },
      };
    },
    batch: async (batch) => batch.map(() => ({ success: true, meta: { changes: 1 } })),
  };
  const response = await handleApiRequest(new Request("https://example.test/api/observations/homepage", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({
      source: "한겨레",
      homepage_url: "https://www.hani.co.kr/",
      observed_at: "2026-07-19T09:00:00+09:00",
      viewport: { width: 1440, height: 1200 },
      collector_version: "playwright-layout-v1",
      placements: [{
        url: "https://www.hani.co.kr/arti/politics/test.html",
        title: "홈페이지에 관측된 기사",
        zone: "top",
        rank: 1,
        x: 80,
        y: 140,
        width: 720,
        height: 360,
        above_fold: true,
        module_name: "주요뉴스",
      }],
    }),
  }), { DB, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.observed, 1);
  assert.equal(result.matched, 1);
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO homepage_snapshots")));
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO placement_observations")));
});

test("uses the checked-in JSON Schema as the public lineage contract", async () => {
  const schema = JSON.parse(await readFile(new URL("../docs/public-api.schema.json", import.meta.url), "utf8"));
  assert.equal(schema["x-api-version"], "agendaframe-public-v5");
  const required = schema.$defs.LineageMeta.required;
  for (const field of ["snapshotId", "runId", "sourcePolicyVersion", "clusteringVersion", "scoreVersion", "modelId", "promptVersion", "analysisSchemaVersion", "comparisonEngineVersion", "authorizationId", "approvalFingerprint", "clusterId", "reviewer", "approvalReviewedAt", "approvedUrlsSha256", "evaluationDatasetVersion", "publishedAt"]) {
    assert.ok(required.includes(field), `missing lineage field: ${field}`);
  }
  assert.ok(schema.$defs.IssueDetailResponse.required.includes("comparison"));
  assert.ok(schema.$defs.Comparison.oneOf.some((entry) => entry.$ref === "#/$defs/LegacyComparison"));
  assert.ok(schema.$defs.Comparison.oneOf.some((entry) => entry.$ref === "#/$defs/StructuredComparison"));
  assert.ok(schema.$defs.StructuredComparison.required.includes("axes"));
  for (const field of ["issueMap", "narratives", "readerQuestions"]) {
    assert.ok(schema.$defs.StructuredComparison.required.includes(field), `missing structured comparison field: ${field}`);
  }
  assert.equal(schema.$defs.StructuredComparison.properties.narratives.maxItems, 2);
  assert.equal(schema.$defs.StructuredComparison.properties.readerQuestions.maxItems, 3);
  assert.ok(schema.$defs.IssueMap.required.includes("selectionBasis"));
  assert.ok(schema.$defs.Narrative.required.includes("claimIds"));
  assert.ok(schema.$defs.ReaderQuestion.required.includes("evidence"));
  assert.ok(schema.$defs.StructuredComparison.required.includes("lineage"));
  assert.deepEqual(schema.$defs.AnalysisLineage.required, [
    "modelId", "promptVersion", "analysisSchemaVersion", "comparisonEngineVersion", "approval",
  ]);
  assert.ok(schema.$defs.ApprovalLineage.required.includes("fingerprint"));
  assert.ok(schema.$defs.ApprovalLineage.required.includes("reviewedAt"));
  assert.ok(schema.$defs.LegacyComparison.required.includes("availableHeadlineEvidence"));
});

test("keeps release thresholds blocked until a real labeled holdout exists", async () => {
  const thresholds = await readFile(new URL("../../evals/thresholds.yaml", import.meta.url), "utf8");
  assert.match(thresholds, /release_status: blocked_until_labeled_holdout/);
  assert.match(thresholds, /hard_negative_accuracy_min: 0\.95/);
  assert.match(thresholds, /required_before_numeric_confidence: true/);
  assert.match(thresholds, /production_release_requires_real_labeled_cases: true/);
});

test("separates the deployed overmerge hard negatives by actor and event action", () => {
  const issues = analyzeArticles([
    { id: "sim-1", sourceId: "hani", source: "한겨레", title: "심우정 검찰총장 사퇴 압박 거세져", section: "정치" },
    { id: "sim-2", sourceId: "khan", source: "경향신문", title: "심우정 검찰총장 사퇴 요구 확산", section: "정치" },
    { id: "yoo-1", sourceId: "chosun", source: "조선일보", title: "유병호 감사위원 구속영장 청구", section: "정치" },
    { id: "yoo-2", sourceId: "joongang", source: "중앙일보", title: "유병호 감사위원 구속영장 청구 논란", section: "정치" },
    { id: "kang-1", sourceId: "hankook", source: "한국일보", title: "강호필 육군총장 취임 후 첫 지휘관회의", section: "정치" },
  ]);
  assert.deepEqual(issues.map((issue) => issue.articles.map((article) => article.id).sort()).sort((a, b) => a[0].localeCompare(b[0])), [
    ["kang-1"], ["sim-1", "sim-2"], ["yoo-1", "yoo-2"],
  ]);
  assert.ok(issues.every((issue) => issue.confidence === null));
});

test("prevents transitive single-link merges across distinct actions", () => {
  const issues = analyzeArticles([
    { id: "a", sourceId: "hani", source: "한겨레", title: "홍길동 의원 구속영장 청구", section: "정치" },
    { id: "b", sourceId: "khan", source: "경향신문", title: "홍길동 의원 구속영장 청구 수사", section: "정치" },
    { id: "c", sourceId: "chosun", source: "조선일보", title: "홍길동 의원 수사 결과 무혐의 발표", section: "정치" },
  ]);
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((issue) => issue.articles.map((article) => article.id).sort()).sort((a, b) => a.length - b.length), [["c"], ["a", "b"]]);
});

test("withholds missing frame evidence and excludes unobserved placement", () => {
  const [issue] = analyzeArticles([
    { id: "only", sourceId: "hani", source: "한겨레", title: "도심 벚꽃 개화 소식", section: "사회", homepagePlacement: null },
  ]);
  assert.equal(issue.placementScore, null);
  assert.equal(issue.scoreStatus, "placement_excluded");
  assert.equal(issue.placementObservedCount, 0);
  assert.ok(issue.frames.every((frame) => frame.score === 0 && frame.evidenceText === null && frame.articleId === null && frame.confidence === null));
});

test("classifies freshness states with a deterministic KST clock", () => {
  const now = Date.parse("2026-07-19T12:00:00+09:00");
  assert.equal(classifySnapshotStatus({}, now).status, "analysis_pending");
  assert.equal(classifySnapshotStatus({ targetDate: "2026-07-19", collectionStatus: "partial", latestSourceCount: 3, configuredSources: 5 }, now).status, "partial_collection");
  assert.deepEqual(classifySnapshotStatus({ targetDate: "2026-07-14", dataAsOf: "2026-07-14T18:00:00+09:00", latestSourceCount: 5, configuredSources: 5 }, now), { status: "stale_snapshot", label: "오래된 스냅샷", staleDays: 5 });
  assert.equal(classifySnapshotStatus({ targetDate: "2026-07-19", dataAsOf: "2026-07-17T10:00:00+09:00", latestSourceCount: 5, configuredSources: 5 }, now).status, "collection_delayed");
  assert.equal(classifySnapshotStatus({ targetDate: "2026-07-19", dataAsOf: "2026-07-19T10:00:00+09:00", latestSourceCount: 5, configuredSources: 5 }, now).status, "normal");
});

test("validates metadata-only imports and canonicalizes duplicate URLs", () => {
  const [row] = validateImportRows([{
    source: "한겨레",
    title: "검증용 기사 제목",
    url: "https://www.hani.co.kr/arti/politics/test.html?utm_source=test&b=2#headline",
    published_at: "2026-07-14T09:30:00+09:00",
    collected_at: "2026-07-14T10:00:00+09:00",
    section: "정치",
    homepage_placement: "TOP",
    homepage_rank: "1",
  }]);
  assert.equal(row.source.id, "hani");
  assert.equal(row.canonicalUrl, "https://www.hani.co.kr/arti/politics/test.html?b=2");
  assert.equal(row.homepagePlacement, "top");
  assert.equal(row.homepageRank, 1);
  assert.equal(canonicalizeArticleUrl("https://example.com/a?utm_medium=x&b=2"), "https://example.com/a?b=2");

  assert.throws(() => validateImportRows([{ source: "한겨레", title: "다른 도메인", url: "https://example.com/article", published_at: "2026-07-14" }]), /공식 도메인/);
  assert.throws(() => validateImportRows([{ source: "한겨레", title: "본문 포함", url: "https://www.hani.co.kr/arti/test.html", published_at: "2026-07-14", content: "저장하면 안 되는 기사 본문" }]), /기사 본문/);
});

test("validates BigKinds excerpts for transient structured analysis without retaining raw text fields", () => {
  const rows = validateStructuredImportRows([{
    source: "한겨레",
    title: "같은 정책을 두고 문제 정의가 갈렸다",
    url: "https://www.hani.co.kr/arti/politics/test.html",
    published_at: "2026-07-26T12:30:00+09:00",
    collected_at: "2026-07-26T16:00:00+09:00",
    section: "정치",
    excerpt: "정부는 제도 개선이 필요하다고 설명했다. 시민단체는 피해자의 안전과 책임 규명이 우선이라고 주장했다.".repeat(2),
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].textScope, "provider_excerpt");
  assert.ok(rows[0].excerpt.length >= 40);
  const [fullBody] = validateStructuredImportRows([{
    source: "한겨레",
    title: "본문 전체 분석 검증",
    url: "https://www.hani.co.kr/arti/politics/full-body.html",
    published_at: "2026-07-26T13:00:00+09:00",
    textScope: "article_body",
    excerpt: "전체 기사 본문을 저장하지 않고 메모리에서만 구조화 분석한다. ".repeat(220),
  }]);
  assert.equal(fullBody.textScope, "article_body");
  assert.ok(fullBody.excerpt.length > 5_000);
  assert.throws(() => validateStructuredImportRows([{
    source: "한겨레",
    title: "짧은 발췌",
    url: "https://www.hani.co.kr/arti/politics/short.html",
    published_at: "2026-07-26T12:30:00+09:00",
    excerpt: "너무 짧음",
  }]), /40~5,000자/);
  assert.throws(() => validateStructuredImportRows([{
    source: "한겨레",
    title: "잘못된 범위",
    url: "https://www.hani.co.kr/arti/politics/bad-scope.html",
    published_at: "2026-07-26T12:30:00+09:00",
    textScope: "full_text",
    excerpt: "분석에 충분한 길이지만 허용되지 않은 범위 값이다. ".repeat(3),
  }]), /provider_excerpt 또는 article_body/);
});

test("validates body-free GCP semantic analysis imports", () => {
  const hash = "a".repeat(64);
  const profile = {
    schema_version: "agendaframe.article-frame-profile.v2",
    engine: {
      semantic_ai: true,
      version: "gemini-fixture",
      prompt_version: "2.0.0",
    },
    lineage: {
      model_id: "gemini-fixture",
      prompt_version: "2.0.0",
      analysis_schema_version: "agendaframe.article-frame-profile.v2",
      comparison_engine_version: "korean-evidence-rules-v2",
      approval: {
        authorization_id: "authorization-fixture",
        fingerprint: "b".repeat(64),
        cluster_id: "cluster-fixture",
        reviewer: "reviewer-fixture",
        reviewed_at: "2026-07-29T12:00:00+09:00",
        approved_urls_sha256: "c".repeat(64),
      },
    },
    article: {
      article_id: "gcp-article-1",
      upstream_article_id: "gcp-article-1",
      body_sha256: hash,
      body_character_count: 120,
      sentence_count: 1,
      raw_body_retained: false,
    },
    extraction: {
      text_scope: "transient_public_page_extract",
      analyzed_character_count: 120,
      input_truncated: false,
    },
    genre: { code: "unknown" },
    dimensions: Object.fromEntries(
      ["problem_definition", "causal_interpretation", "responsibility_attribution", "moral_evaluation", "treatment_recommendation"]
        .map((dimension) => [dimension, { status: "not_observed", outlet_narration_observed: false, items: [] }]),
    ),
    actors_and_sources: [],
    context_depth: { level: "unknown" },
    scope: { code: "unknown" },
    secondary_descriptors: { generic_frames: [], policy_frames: [], controlled_associations: [] },
    framing_devices: [],
    review: { status: "automatic_draft", requires_human_review: true },
  };
  const [row] = validateAnalyzedImportRows([{
    article: {
      article_id: "gcp-article-1",
      source_id: "hani",
      title: "검증용 GCP 분석 기사",
      canonical_url: "https://www.hani.co.kr/arti/politics/gcp-test.html",
      published_at: "2026-07-30T09:00:00+09:00",
      collected_at: "2026-07-30T09:10:00+09:00",
      section: "정치",
      body_hash: hash,
      body_characters: 120,
    },
    profile,
  }]);
  assert.equal(row.profile.engine.semantic_ai, true);
  assert.equal(row.profile.lineage.approval.authorization_id, "authorization-fixture");
  assert.equal(row.profile.extraction.input_truncated, false);
  assert.equal(row.bodyHash, hash);
  assert.doesNotMatch(JSON.stringify(row), /"body_text"|"raw_body"|"excerpt"/);
  const contradictoryExtraction = structuredClone(profile);
  contradictoryExtraction.extraction.input_truncated = true;
  assert.throws(
    () => validateAnalyzedImportRows([{
      article: {
        article_id: "gcp-article-1",
        source_id: "hani",
        title: "GCP extraction validation",
        canonical_url: "https://www.hani.co.kr/arti/politics/gcp-extraction.html",
        published_at: "2026-07-30T09:00:00+09:00",
        collected_at: "2026-07-30T09:10:00+09:00",
        section: "politics",
        body_hash: hash,
        body_characters: 120,
      },
      profile: contradictoryExtraction,
    }]),
    /절단 입력/,
  );
  assert.throws(
    () => validateAnalyzedImportRows([{
      article: {
        article_id: "different-upstream-id",
        source_id: "hani",
        title: "검증용 GCP 분석 기사",
        canonical_url: "https://www.hani.co.kr/arti/politics/gcp-test.html",
        published_at: "2026-07-30T09:00:00+09:00",
        collected_at: "2026-07-30T09:10:00+09:00",
        section: "정치",
        body_hash: hash,
        body_characters: 120,
      },
      profile,
    }]),
    /상류 기사 식별자/,
  );
});

test("rejects semantic imports without authenticated lineage", () => {
  const hash = "d".repeat(64);
  const profile = {
    schema_version: "agendaframe.article-frame-profile.v2",
    engine: { semantic_ai: true, version: "gemini-fixture", prompt_version: "2.1.0" },
    article: {
      article_id: "gcp-missing-lineage",
      upstream_article_id: "gcp-missing-lineage",
      body_sha256: hash,
      body_character_count: 120,
      sentence_count: 1,
      raw_body_retained: false,
    },
    genre: { code: "unknown" },
    dimensions: Object.fromEntries(
      ["problem_definition", "causal_interpretation", "responsibility_attribution", "moral_evaluation", "treatment_recommendation"]
        .map((dimension) => [dimension, { status: "not_observed", outlet_narration_observed: false, items: [] }]),
    ),
    actors_and_sources: [],
    context_depth: { level: "unknown" },
    scope: { code: "unknown" },
    secondary_descriptors: { generic_frames: [], policy_frames: [], controlled_associations: [] },
    framing_devices: [],
    review: { status: "automatic_draft", requires_human_review: true },
  };
  assert.throws(
    () => validateAnalyzedImportRows([{
      article: {
        article_id: "gcp-missing-lineage",
        source_id: "hani",
        title: "GCP lineage validation",
        canonical_url: "https://www.hani.co.kr/arti/politics/gcp-lineage.html",
        published_at: "2026-07-30T09:00:00+09:00",
        collected_at: "2026-07-30T09:10:00+09:00",
        section: "politics",
        body_hash: hash,
        body_characters: 120,
      },
      profile,
    }]),
    /lineage/,
  );
});

test("reports no-cost health and protects write endpoints", async () => {
  const health = await handleApiRequest(new Request("https://example.test/api/health"));
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.mode, "demo");
  assert.equal(healthBody.collection.method, "bigkinds_export");
  assert.equal(healthBody.collection.directCrawling, false);
  assert.equal(healthBody.collection.configuredSources, 22);
  assert.equal(healthBody.meta.clusteringVersion, "agenda-concepts-complete-link-v6");
  assert.equal(healthBody.meta.scoreVersion, "observed-agenda-v4");

  const sources = await handleApiRequest(new Request("https://example.test/api/sources"));
  const sourceBody = await sources.json();
  assert.equal(sourceBody.panelLabel, "22개 주요 중앙언론 온라인 뉴스 표본");
  assert.equal(sourceBody.sources.length, 22);
  assert.ok(sourceBody.sources.every((source) => !("domains" in source)));
  assert.ok(sourceBody.sources.every((source) => !("samplePosition" in source)));
  assert.deepEqual(Object.fromEntries(["general_daily", "business_media", "news_agency"].map((type) => [type, sourceBody.sources.filter((source) => source.sourceType === type).length])), {
    general_daily: 10,
    business_media: 9,
    news_agency: 3,
  });
  for (const broadcaster of ["KBS", "MBC", "SBS", "JTBC", "TV조선", "채널A", "MBN", "YTN", "연합뉴스TV"]) {
    assert.ok(!sourceBody.sources.some((source) => source.name === broadcaster));
  }
  assert.equal(sourceBody.sources.find((source) => source.name === "조선일보").mediaGroupId, sourceBody.sources.find((source) => source.name === "조선비즈").mediaGroupId);

  const researchSources = await handleApiRequest(new Request("https://example.test/api/sources?scope=academic_panel_12"));
  const researchBody = await researchSources.json();
  assert.equal(researchBody.panelLabel, "AgendaFrame 학술연구 12개 매체");
  assert.equal(researchBody.method, "authorized_crawl");
  assert.equal(researchBody.directCrawling, true);
  assert.equal(researchBody.sources.length, 12);
  assert.deepEqual(researchBody.sources.filter((source) => source.sourceType === "broadcaster").map((source) => source.name), ["KBS", "SBS"]);
  assert.ok(researchBody.sources.every((source) => !("endpoints" in source) && !("domains" in source)));

  const unavailable = await handleApiRequest(new Request("https://example.test/api/analyze", { method: "POST" }));
  assert.equal(unavailable.status, 503);
  const unauthorized = await handleApiRequest(new Request("https://example.test/api/import", {
    method: "POST",
    headers: { authorization: "Bearer wrong", "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ rows: [] }),
  }), { DB: {}, IMPORT_TOKEN: "correct" });
  assert.equal(unauthorized.status, 401);
  const rotatedToken = await handleApiRequest(new Request("https://example.test/api/import", {
    method: "POST",
    headers: { authorization: "Bearer new-token", "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ rows: [] }),
  }), { DB: {}, IMPORT_TOKEN: "old-token", CODEX_IMPORT_TOKEN: "new-token" });
  assert.equal(rotatedToken.status, 400);
  const qualityUnauthorized = await handleApiRequest(new Request("https://example.test/api/quality?date=2026-07-14", {
    headers: { authorization: "Bearer wrong", origin: "https://example.test" },
  }), { DB: {}, IMPORT_TOKEN: "correct" });
  assert.equal(qualityUnauthorized.status, 401);
  const runsUnauthorized = await handleApiRequest(new Request("https://example.test/api/analysis/runs?start=2026-07-08&end=2026-07-14", {
    headers: { authorization: "Bearer wrong", origin: "https://example.test" },
  }), { DB: {}, IMPORT_TOKEN: "correct" });
  assert.equal(runsUnauthorized.status, 401);
  const oneShotAnalysis = await handleApiRequest(new Request("https://example.test/api/analyze", {
    method: "POST",
    headers: { authorization: "Bearer refresh-only", "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ date: "not-a-date" }),
  }), { DB: {}, IMPORT_TOKEN: "admin-only", ANALYSIS_REFRESH_TOKEN: "refresh-only" });
  assert.equal(oneShotAnalysis.status, 400);
  const oneShotCannotImport = await handleApiRequest(new Request("https://example.test/api/import", {
    method: "POST",
    headers: { authorization: "Bearer refresh-only", "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ rows: [] }),
  }), { DB: {}, IMPORT_TOKEN: "admin-only", ANALYSIS_REFRESH_TOKEN: "refresh-only" });
  assert.equal(oneShotCannotImport.status, 401);

  const missing = await handleApiRequest(new Request("https://example.test/api/missing"));
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "NOT_FOUND");
  assert.equal(typeof missingBody.requestId, "string");
});

test("selects public research snapshots from authorized 12-source runs", async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          return { first: async () => null };
        },
      };
    },
  };

  const response = await handleApiRequest(new Request("https://example.test/api/issues?scope=academic_panel_12&date=2026-08-10"), { DB });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).issues, []);
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /scoped_run_i\.run_id = analysis_runs\.id/);
  assert.match(statements[0].sql, /scoped_run_a\.provider = \?/);
  assert.deepEqual(statements[0].parameters.slice(0, 2), ["2026-08-10", "authorized_crawl"]);
  assert.equal(statements[0].parameters.length, 14);
});

test("keeps demo and live health response contracts identical", async () => {
  const statementFor = (sql) => {
    const statement = {
      bind() { return statement; },
      async first() {
        if (sql.includes("configured_sources")) return { configured_sources: 5, article_count: 0 };
        if (sql.includes("FROM collection_runs")) return null;
        if (sql.includes("FROM analysis_runs")) return null;
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
    return statement;
  };
  const DB = { prepare: statementFor, batch: async () => [] };
  const demo = await (await handleApiRequest(new Request("https://example.test/api/health"))).json();
  const live = await (await handleApiRequest(new Request("https://example.test/api/health"), { DB })).json();
  assert.deepEqual(Object.keys(live).sort(), Object.keys(demo).sort());
  assert.deepEqual(Object.keys(live.collection).sort(), Object.keys(demo.collection).sort());
  assert.deepEqual(Object.keys(live.timestamps).sort(), Object.keys(demo.timestamps).sort());
  assert.deepEqual(Object.keys(live.meta).sort(), Object.keys(demo.meta).sort());
  assert.equal(demo.meta.runtimeMode, "demo");
  assert.equal(live.meta.runtimeMode, "live_metadata");
});

test("applies browser security headers to non-API responses", async () => {
  const response = withSecurityHeaders(new Response("ok", { headers: { "content-type": "text/plain" } }));
  assert.equal(await response.text(), "ok");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("adds exact CSP hashes for every server-rendered inline script", async () => {
  const response = await withDocumentSecurityHeaders(new Response("<html><body><script>self.boot=true</script><script type=\"application/ld+json\">{}</script></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } }));
  const html = await response.text();
  const policy = response.headers.get("content-security-policy");
  assert.equal(html.includes("nonce="), false);
  assert.equal((policy.match(/'sha256-[^']+'/g) ?? []).length, 2);
  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test("hides legacy scores and unsupported comparison claims in issue detail", async () => {
  const legacyIssue = {
    id: "legacy-issue", runId: "run-v1", targetDate: "2026-07-14", provider: "rules_local", modelVersion: "agenda-rules-v1", analyzedAt: Date.parse("2026-07-14T19:00:00+09:00"),
    issueDate: "2026-07-14", title: "legacy title", summary: "legacy summary", category: "정치", articleCount: 2, sourceCount: 2,
    agendaScore: 92, diversityScore: 40, placementScore: 25, volumeScore: 50, repetitionScore: 0, confidence: 92, placementObservedCount: 0, placementTotalCount: 2,
  };
  const article = { id: "article-1", source: "한겨레", title: "확인 가능한 제목", url: "https://www.hani.co.kr/arti/test.html", publishedAt: Date.parse("2026-07-14T10:00:00+09:00"), representative: 1, similarity: 1 };
  const DB = {
    prepare(sql) {
      return {
        bind() {
          if (sql.includes("FROM issues i")) return { first: async () => legacyIssue };
          if (sql.includes("FROM issue_articles ia") && sql.includes("ORDER BY ia.representative")) return { all: async () => ({ results: [article] }) };
          if (sql.includes("FROM frame_analyses")) return { all: async () => ({ results: [{ frame: "conflict", score: 100, confidence: 92, evidenceText: "placeholder" }] }) };
          if (sql.includes("FROM ai_reports")) return { first: async () => ({ summary: "legacy report" }) };
          if (sql.includes("GROUP BY s.id")) return { all: async () => ({ results: [{ source: "한겨레", articleCount: 1, placementWeight: 0 }] }) };
          if (sql.includes("FROM issue_frame_comparisons")) return { first: async () => null };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const response = await handleApiRequest(new Request("https://example.test/api/issues/legacy-issue"), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.issue.agendaScore, null);
  assert.equal(body.issue.placementScore, null);
  assert.equal(body.issue.scoreStatus, "legacy_reanalysis_required");
  assert.equal("confidence" in body.issue, false);
  assert.deepEqual(body.frames, []);
  assert.equal(body.report, null);
  assert.equal(body.comparison.status, "withheld_insufficient_evidence");
  assert.equal(body.comparison.recommendedPair, null);
  assert.deepEqual(body.comparison.commonFacts, []);
  assert.equal(body.comparison.availableHeadlineEvidence[0].articleId, "article-1");
  assert.equal(body.meta.snapshotId, "run-v1");
  assert.equal(body.meta.clusteringVersion, "legacy-v1-unverified");
  assert.equal(response.headers.has("etag"), true);
});

test("publishes the actual comparison and approval lineage in issue detail metadata", async () => {
  const reviewedAt = "2026-07-30T03:00:00.000Z";
  const lineage = {
    modelId: "gemini-2.5-flash-lite",
    promptVersion: "2.1.0",
    analysisSchemaVersion: "agendaframe.article-frame-profile.v2",
    comparisonEngineVersion: "korean-evidence-rules-v2",
    approval: {
      authorizationId: "authorization-2026-07-26",
      fingerprint: "a".repeat(64),
      clusterId: "cluster-rank-1",
      reviewer: "reviewer-1",
      reviewedAt,
      approvedUrlsSha256: "b".repeat(64),
    },
  };
  const comparison = {
    lineage,
    status: "partial",
    divergenceDetected: false,
    evidenceBasis: "evidence_spans",
    reason: "No supported divergence was observed.",
    methodologyLabel: "evidence-first",
    reviewStatus: "automatic_draft",
    summary: {
      commonGround: null,
      mainDifference: null,
      whyItMatters: null,
      sourceContext: null,
    },
    sample: {
      analyzedArticles: 2,
      textScope: "article_body",
      outlets: 2,
      independentMediaGroups: 2,
      excludedArticles: 0,
      inputTruncatedArticles: 0,
    },
    axes: [],
    issueMap: {
      status: "withheld_insufficient_evidence",
      reason: "Not enough evidence for an issue map.",
      axisId: null,
      dimension: "problem_definition",
      label: "문제 정의",
      leftAnchor: null,
      rightAnchor: null,
      selectionBasis: {
        minimumArticles: 4,
        minimumOutlets: 3,
        minimumIndependentMediaGroups: 2,
        minimumArticlesPerAnchor: 2,
        articleCount: 2,
        outletCount: 2,
        independentMediaGroups: 2,
        balancedCoverage: null,
        overlap: null,
        axisStrength: null,
        coveredArticleCount: 0,
        formula: null,
      },
      outlets: [],
    },
    narratives: [],
    readerQuestions: [],
    sourceLens: {
      sharedVoices: [],
      voicesPresentInSomeOutlets: [],
      byOutlet: [],
      caution: null,
    },
    contextGaps: [],
    limitations: ["Automatic draft."],
  };
  const issue = {
    id: "lineage-issue", runId: "run-lineage", targetDate: "2026-07-26", provider: "rules_local", modelVersion: ANALYSIS_MODEL_VERSION, analyzedAt: Date.parse("2026-07-26T19:00:00+09:00"),
    issueDate: "2026-07-26", title: "lineage title", summary: "lineage summary", category: "정치", articleCount: 2, sourceCount: 2,
    agendaScore: 70, diversityScore: 50, placementScore: 20, volumeScore: 40, repetitionScore: 0, confidence: 0, placementObservedCount: 0, placementTotalCount: 2,
  };
  const DB = {
    prepare(sql) {
      return {
        bind() {
          if (sql.includes("FROM issues i")) return { first: async () => issue };
          if (sql.includes("FROM issue_articles ia") && sql.includes("ORDER BY ia.representative")) return { all: async () => ({ results: [] }) };
          if (sql.includes("FROM frame_analyses")) return { all: async () => ({ results: [] }) };
          if (sql.includes("FROM ai_reports")) return { first: async () => null };
          if (sql.includes("GROUP BY s.id")) return { all: async () => ({ results: [] }) };
          if (sql.includes("FROM issue_frame_comparisons")) return { first: async () => ({ comparisonJson: JSON.stringify(comparison) }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };

  const response = await handleApiRequest(new Request("https://example.test/api/issues/lineage-issue"), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.comparison.lineage, lineage);
  assert.equal(body.meta.modelId, lineage.modelId);
  assert.equal(body.meta.promptVersion, lineage.promptVersion);
  assert.equal(body.meta.analysisSchemaVersion, lineage.analysisSchemaVersion);
  assert.equal(body.meta.comparisonEngineVersion, lineage.comparisonEngineVersion);
  assert.equal(body.meta.authorizationId, lineage.approval.authorizationId);
  assert.equal(body.meta.approvalFingerprint, lineage.approval.fingerprint);
  assert.equal(body.meta.clusterId, lineage.approval.clusterId);
  assert.equal(body.meta.reviewer, lineage.approval.reviewer);
  assert.equal(body.meta.approvalReviewedAt, reviewedAt);
  assert.equal(body.meta.approvedUrlsSha256, lineage.approval.approvedUrlsSha256);
});

test("filters and paginates the complete article collection", async () => {
  const statements = [];
  const article = { id: "article-1", sourceId: "hani", source: "한겨레", title: "주거 정책 기사", url: "https://www.hani.co.kr/arti/politics/test.html", section: "정치_국회", publishedAt: Date.parse("2026-07-14T17:44:48+09:00"), collectedAt: Date.parse("2026-07-14T18:00:00+09:00"), homepagePlacement: null, homepageRank: null };
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          return sql.includes("SELECT COUNT(*) AS total") ? { first: async () => ({ total: 123 }) } : { all: async () => ({ results: [article] }) };
        },
      };
    },
  };

  const response = await handleApiRequest(new Request("https://example.test/api/articles?limit=25&offset=50&source=%ED%95%9C%EA%B2%A8%EB%A0%88&section=%EC%A0%95%EC%B9%98&q=%EC%A3%BC%EA%B1%B0&date=2026-07-14"), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 123);
  assert.equal(body.limit, 25);
  assert.equal(body.offset, 50);
  assert.equal(body.hasMore, true);
  assert.equal(typeof body.nextCursor, "string");
  assert.equal(body.meta.runtimeMode, "live_metadata");
  assert.equal(body.meta.schemaVersion, "agendaframe-public-v5");
  assert.deepEqual(body.articles, [article]);
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /a\.source_id = \?/);
  assert.match(statements[0].sql, /a\.section LIKE \?/);
  assert.match(statements[0].sql, /a\.title LIKE \?/);
  assert.match(statements[0].sql, /a\.published_at >= \?/);
  assert.deepEqual(statements[1].parameters.slice(-2), [25, 50]);

  const invalidCursor = await handleApiRequest(new Request("https://example.test/api/articles?cursor=not-base64"), { DB });
  assert.equal(invalidCursor.status, 400);
  assert.equal((await invalidCursor.json()).error.code, "INVALID_REQUEST");
});

test("lists successful public agenda dates and rejects invalid issue dates", async () => {
  const DB = {
    prepare(sql) {
      assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY target_date/);
      return {
        bind(...parameters) {
          assert.deepEqual(parameters, ["정치", "경제", "사회", "국제", "스포츠", "생활·IT", 2]);
          return {
            all: async () => ({
              results: [
                { id: "run-14", targetDate: "2026-07-14", analyzedAt: 200, articleCount: 120, issueCount: 20 },
                { id: "run-13", targetDate: "2026-07-13", analyzedAt: 100, articleCount: 90, issueCount: 16 },
              ],
            }),
          };
        },
      };
    },
  };

  const response = await handleApiRequest(new Request("https://example.test/api/issues/dates?limit=2"), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.dates.map((entry) => [entry.date, entry.articleCount, entry.issueCount]), [
    ["2026-07-14", 120, 20],
    ["2026-07-13", 90, 16],
  ]);
  assert.equal(body.meta.schemaVersion, "agendaframe-public-v5");

  const invalidDate = await handleApiRequest(new Request("https://example.test/api/issues?date=2026-02-30"), { DB });
  assert.equal(invalidDate.status, 400);
  assert.equal((await invalidDate.json()).error.code, "INVALID_REQUEST");

  const excludedCategory = await handleApiRequest(new Request("https://example.test/api/issues?category=%EC%97%B0%EC%98%88"), { DB });
  assert.equal(excludedCategory.status, 400);
  assert.equal((await excludedCategory.json()).error.code, "INVALID_REQUEST");
});

test("binds scoped issue metrics in the same order as their SQL placeholders", async () => {
  const statements = [];
  const run = { id: "run-scope", targetDate: "2026-07-26", provider: "rules_local", modelVersion: ANALYSIS_MODEL_VERSION, finishedAt: 100, articleCount: 10, issueCount: 1 };
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          return {
            first: async () => {
              if (sql.includes("FROM analysis_runs")) return run;
              if (sql.includes("SELECT COUNT(*) AS total FROM issues i")) return { total: 1 };
              throw new Error(`Unexpected first query: ${sql}`);
            },
            all: async () => {
              if (sql.includes("WITH scoped_issue_metrics")) return { results: [{ id: "scope-issue", issueDate: "2026-07-26", title: "대표 기사 제목", summary: "요약", category: "정치", articleCount: 2, sourceCount: 2, agendaScore: 52, diversityScore: 20, placementScore: null, volumeScore: 20, repetitionScore: 0, confidence: null, placementObservedCount: 0, placementTotalCount: 2, contentAvailableCount: 0, structuredProfileCount: 0 }] };
              if (sql.includes("GROUP BY i.category")) return { results: [{ category: "정치", count: 1 }] };
              throw new Error(`Unexpected all query: ${sql}`);
            },
          };
        },
      };
    },
  };

  const response = await handleApiRequest(new Request("https://example.test/api/issues?date=2026-07-26&scope=general_daily_10&limit=5"), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.issues[0].agendaScore, 52);
  assert.equal(body.issues[0].scoreStatus, "scope_observed_components");
  const scopedMetrics = statements.find(({ sql }) => sql.includes("WITH scoped_issue_metrics"));
  assert.deepEqual(scopedMetrics.parameters.slice(0, 4), ["general_daily", "general_daily", 10, 10]);
  assert.equal(scopedMetrics.parameters.at(-1), 5);
});

test("reports resumable per-day analysis status", async () => {
  const DB = {
    prepare(sql) {
      return {
        bind() {
          if (sql.includes("ROW_NUMBER() OVER")) return { all: async () => ({ results: [{ id: "run-14", targetDate: "2026-07-14", status: "success", analyzedArticleCount: 120, issueCount: 20 }] }) };
          if (sql.includes("date(published_at / 1000")) return { all: async () => ({ results: [{ targetDate: "2026-07-13", articleCount: 100 }, { targetDate: "2026-07-14", articleCount: 120 }] }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const response = await handleApiRequest(new Request("https://example.test/api/analysis/runs?start=2026-07-12&end=2026-07-14", {
    headers: { authorization: "Bearer correct", origin: "https://example.test" },
  }), { DB, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.days.map((day) => [day.date, day.status, day.articleCount]), [
    ["2026-07-12", "empty", 0],
    ["2026-07-13", "pending", 100],
    ["2026-07-14", "success", 120],
  ]);
  assert.equal(body.maxBatchDays, 7);
  assert.equal(body.resumable, true);
});

test("rolls back only to an existing immutable successful snapshot", async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...parameters) {
          statements.push({ sql, parameters });
          if (sql.includes("WHERE id = ?") && sql.includes("SELECT id")) return { first: async () => ({ id: "run-new", targetDate: "2026-07-14", status: "success" }) };
          if (sql.includes("id != ?")) return { first: async () => ({ id: "run-old", targetDate: "2026-07-14", finishedAt: 1 }) };
          if (sql.includes("UPDATE analysis_runs")) return { run: async () => ({ success: true }) };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const response = await handleApiRequest(new Request("https://example.test/api/analysis/runs/run-new/rollback", {
    method: "POST",
    headers: { authorization: "Bearer correct", origin: "https://example.test" },
  }), { DB, IMPORT_TOKEN: "correct" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rolledBackRunId: "run-new", fallbackRunId: "run-old", targetDate: "2026-07-14" });
  assert.match(statements.at(-1).sql, /status = 'rolled_back'/);
});
