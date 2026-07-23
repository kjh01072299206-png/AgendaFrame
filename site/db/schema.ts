import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = integer("created_at", { mode: "timestamp_ms" })
  .notNull()
  .default(sql`(unixepoch() * 1000)`);

export const mediaSources = sqliteTable(
  "media_sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    providerOutletName: text("provider_outlet_name").notNull(),
    samplePosition: text("sample_position", {
      enum: ["progressive", "center", "conservative", "unclassified"],
    }).notNull(),
    sampleOrder: integer("sample_order").notNull(),
    sourceType: text("source_type").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    activationState: text("activation_state").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("media_sources_name_uq").on(table.name),
    uniqueIndex("media_sources_provider_name_uq").on(table.provider, table.providerOutletName),
    index("media_sources_sample_order_idx").on(table.sampleOrder),
  ],
);

export const collectionRuns = sqliteTable(
  "collection_runs",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    status: text("status", { enum: ["running", "success", "partial", "failed"] }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    articleCount: integer("article_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    createdAt,
  },
  (table) => [index("collection_runs_started_at_idx").on(table.startedAt)],
);

export const collectionSourceResults = sqliteTable(
  "collection_source_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => mediaSources.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["success", "skipped", "failed"] }).notNull(),
    articleCount: integer("article_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt,
  },
  (table) => [
    uniqueIndex("collection_source_results_run_source_uq").on(table.runId, table.sourceId),
    index("collection_source_results_source_idx").on(table.sourceId),
  ],
);

export const articles = sqliteTable(
  "articles",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => mediaSources.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    section: text("section"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    collectedAt: integer("collected_at", { mode: "timestamp_ms" }).notNull(),
    homepagePlacement: text("homepage_placement", {
      enum: ["top", "main", "section", "list"],
    }),
    homepageRank: integer("homepage_rank"),
    createdAt,
  },
  (table) => [
    uniqueIndex("articles_provider_external_id_uq").on(table.provider, table.externalId),
    uniqueIndex("articles_canonical_url_uq").on(table.canonicalUrl),
    index("articles_source_published_at_idx").on(table.sourceId, table.publishedAt),
    index("articles_collected_at_idx").on(table.collectedAt),
  ],
);

export const homepageSnapshots = sqliteTable(
  "homepage_snapshots",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => mediaSources.id, { onDelete: "restrict" }),
    homepageUrl: text("homepage_url").notNull(),
    observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
    viewportWidth: integer("viewport_width").notNull(),
    viewportHeight: integer("viewport_height").notNull(),
    collectorVersion: text("collector_version").notNull(),
    captureHash: text("capture_hash"),
    screenshotObjectKey: text("screenshot_object_key"),
    status: text("status", { enum: ["success", "partial", "failed"] }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("homepage_snapshots_source_observed_viewport_uq").on(
      table.sourceId,
      table.observedAt,
      table.viewportWidth,
      table.viewportHeight,
    ),
    index("homepage_snapshots_observed_at_idx").on(table.observedAt),
  ],
);

export const placementObservations = sqliteTable(
  "placement_observations",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => homepageSnapshots.id, { onDelete: "cascade" }),
    articleId: text("article_id").references(() => articles.id, { onDelete: "set null" }),
    canonicalUrl: text("canonical_url").notNull(),
    observedTitle: text("observed_title").notNull(),
    zone: text("zone", { enum: ["top", "main", "section", "list"] }).notNull(),
    pageRank: integer("page_rank").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    aboveFold: integer("above_fold", { mode: "boolean" }).notNull(),
    moduleName: text("module_name"),
    matchMethod: text("match_method", { enum: ["canonical_url", "unmatched"] }).notNull(),
    matchConfidence: real("match_confidence").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("placement_observations_snapshot_url_position_uq").on(
      table.snapshotId,
      table.canonicalUrl,
      table.x,
      table.y,
    ),
    index("placement_observations_article_idx").on(table.articleId),
    index("placement_observations_snapshot_rank_idx").on(table.snapshotId, table.pageRank),
  ],
);

export const articleContents = sqliteTable(
  "article_contents",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    bodyHash: text("body_hash").notNull(),
    bodyCharacters: integer("body_characters").notNull(),
    acquiredAt: integer("acquired_at", { mode: "timestamp_ms" }).notNull(),
    acquisitionMethod: text("acquisition_method", {
      enum: ["licensed_export", "publisher_api", "authorized_crawl", "manual_research"],
    }).notNull(),
    usageBasis: text("usage_basis").notNull(),
    usageExpiresAt: integer("usage_expires_at", { mode: "timestamp_ms" }),
    analysisAllowed: integer("analysis_allowed", { mode: "boolean" }).notNull().default(false),
    publicEvidenceAllowed: integer("public_evidence_allowed", { mode: "boolean" }).notNull().default(false),
    extractorVersion: text("extractor_version").notNull(),
    status: text("status", { enum: ["active", "revoked", "expired"] }).notNull().default("active"),
    createdAt,
  },
  (table) => [
    uniqueIndex("article_contents_article_hash_uq").on(table.articleId, table.bodyHash),
    uniqueIndex("article_contents_object_key_uq").on(table.objectKey),
    index("article_contents_article_status_idx").on(table.articleId, table.status, table.acquiredAt),
  ],
);

export const articleBodySignals = sqliteTable(
  "article_body_signals",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    bodyHash: text("body_hash"),
    bodyCharacters: integer("body_characters"),
    detectedFrames: text("detected_frames").notNull().default("[]"),
    status: text("status", { enum: ["analyzed", "failed"] }).notNull(),
    failureCode: text("failure_code"),
    extractorVersion: text("extractor_version").notNull(),
    taxonomyVersion: text("taxonomy_version").notNull(),
    analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("article_body_signals_article_versions_uq").on(
      table.articleId,
      table.extractorVersion,
      table.taxonomyVersion,
    ),
    index("article_body_signals_status_idx").on(table.status, table.analyzedAt),
  ],
);

export const collectionErrors = sqliteTable(
  "collection_errors",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => mediaSources.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    message: text("message").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    createdAt,
  },
  (table) => [index("collection_errors_run_idx").on(table.runId)],
);

export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    targetDate: text("target_date").notNull(),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    articleCount: integer("article_count").notNull().default(0),
    issueCount: integer("issue_count").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt,
  },
  (table) => [
    index("analysis_runs_target_date_idx").on(table.targetDate, table.finishedAt),
    index("analysis_runs_status_idx").on(table.status),
  ],
);

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    issueDate: text("issue_date").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull(),
    articleCount: integer("article_count").notNull(),
    sourceCount: integer("source_count").notNull(),
    agendaScore: real("agenda_score").notNull(),
    diversityScore: real("diversity_score").notNull(),
    placementScore: real("placement_score").notNull(),
    volumeScore: real("volume_score").notNull(),
    repetitionScore: real("repetition_score").notNull(),
    confidence: integer("confidence").notNull(),
    createdAt,
  },
  (table) => [
    index("issues_run_score_idx").on(table.runId, table.agendaScore),
    index("issues_date_category_idx").on(table.issueDate, table.category),
  ],
);

export const issueArticles = sqliteTable(
  "issue_articles",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    similarity: real("similarity").notNull(),
    representative: integer("representative", { mode: "boolean" }).notNull().default(false),
    createdAt,
  },
  (table) => [
    uniqueIndex("issue_articles_issue_article_uq").on(table.issueId, table.articleId),
    index("issue_articles_article_idx").on(table.articleId),
  ],
);

export const frameAnalyses = sqliteTable(
  "frame_analyses",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    frame: text("frame", {
      enum: ["conflict", "responsibility", "economy", "law", "policy", "citizen"],
    }).notNull(),
    score: real("score").notNull(),
    confidence: integer("confidence").notNull(),
    evidenceBasis: text("evidence_basis", {
      enum: ["headline", "body_private", "body_public", "body_transient"],
    }).notNull().default("headline"),
    evidenceText: text("evidence_text"),
    evidenceStart: integer("evidence_start"),
    evidenceEnd: integer("evidence_end"),
    contentVersionId: text("content_version_id").references(() => articleContents.id, { onDelete: "set null" }),
    articleId: text("article_id").references(() => articles.id, { onDelete: "set null" }),
    sourceId: text("source_id").references(() => mediaSources.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("frame_analyses_issue_frame_uq").on(table.issueId, table.frame),
    index("frame_analyses_article_idx").on(table.articleId),
  ],
);

export const aiReports = sqliteTable(
  "ai_reports",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    missingPerspective: text("missing_perspective").notNull(),
    caution: text("caution").notNull(),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("ai_reports_issue_uq").on(table.issueId)],
);

export const qualityReviews = sqliteTable(
  "quality_reviews",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    clusterVerdict: text("cluster_verdict", {
      enum: ["correct", "partial", "incorrect"],
    }).notNull(),
    agendaVerdict: text("agenda_verdict", {
      enum: ["appropriate", "overstated", "understated", "uncertain"],
    }).notNull(),
    frameVerdict: text("frame_verdict", {
      enum: ["appropriate", "partial", "inappropriate", "uncertain"],
    }).notNull(),
    notes: text("notes").notNull().default(""),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("quality_reviews_issue_uq").on(table.issueId),
    index("quality_reviews_reviewed_at_idx").on(table.reviewedAt),
  ],
);

export const qualityReviewArticleFlags = sqliteTable(
  "quality_review_article_flags",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => qualityReviews.id, { onDelete: "cascade" }),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    createdAt,
  },
  (table) => [
    uniqueIndex("quality_review_article_flags_review_article_uq").on(table.reviewId, table.articleId),
    index("quality_review_article_flags_article_idx").on(table.articleId),
  ],
);

export const qualityReviewMissingArticles = sqliteTable(
  "quality_review_missing_articles",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => qualityReviews.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => mediaSources.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    note: text("note").notNull().default(""),
    createdAt,
  },
  (table) => [
    uniqueIndex("quality_review_missing_articles_review_url_uq").on(table.reviewId, table.canonicalUrl),
    index("quality_review_missing_articles_source_idx").on(table.sourceId),
  ],
);
