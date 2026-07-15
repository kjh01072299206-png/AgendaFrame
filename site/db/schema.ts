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
      enum: ["progressive", "center", "conservative"],
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
    evidenceText: text("evidence_text"),
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
