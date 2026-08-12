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

export const articleFrameProfiles = sqliteTable(
  "article_frame_profiles",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    bodyHash: text("body_hash"),
    bodyCharacters: integer("body_characters"),
    profileJson: text("profile_json").notNull().default("{}"),
    status: text("status", { enum: ["analyzed", "partial", "failed"] }).notNull(),
    failureCode: text("failure_code"),
    extractorVersion: text("extractor_version").notNull(),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    reviewStatus: text("review_status", {
      enum: ["automatic_draft", "human_reviewed", "rejected"],
    }).notNull().default("automatic_draft"),
    analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("article_frame_profiles_article_versions_uq").on(
      table.articleId,
      table.extractorVersion,
      table.modelVersion,
      table.schemaVersion,
    ),
    index("article_frame_profiles_status_idx").on(table.status, table.analyzedAt),
    index("article_frame_profiles_article_idx").on(table.articleId, table.analyzedAt),
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
    status: text("status", { enum: ["running", "success", "failed", "rolled_back"] }).notNull(),
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

export const issueFrameComparisons = sqliteTable(
  "issue_frame_comparisons",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    comparisonJson: text("comparison_json").notNull(),
    profileCount: integer("profile_count").notNull().default(0),
    analyzedArticleCount: integer("analyzed_article_count").notNull().default(0),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("issue_frame_comparisons_issue_uq").on(table.issueId),
    index("issue_frame_comparisons_generated_at_idx").on(table.generatedAt),
  ],
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


export const durableJobs = sqliteTable(
  "durable_jobs",
  {
    id: text("id").primaryKey(),
    queue: text("queue").notNull(),
    jobType: text("job_type").notNull(),
    uniqueKey: text("unique_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", {
      enum: ["queued", "running", "retry_wait", "succeeded", "dead_lettered", "cancelled"],
    }).notNull(),
    priority: integer("priority").notNull().default(0),
    availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
    checkpointJson: text("checkpoint_json"),
    checkpointVersion: integer("checkpoint_version").notNull().default(0),
    failureCode: text("failure_code"),
    deadLetterId: text("dead_letter_id"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("durable_jobs_queue_type_key_uq").on(table.queue, table.jobType, table.uniqueKey),
    index("durable_jobs_due_idx").on(table.queue, table.status, table.availableAt, table.priority),
    index("durable_jobs_expired_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

export const articleCollectionAttempts = sqliteTable(
  "article_collection_attempts",
  {
    articleId: text("article_id")
      .primaryKey()
      .references(() => articles.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => mediaSources.id, { onDelete: "restrict" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).notNull(),
    lastFailureCode: text("last_failure_code").notNull(),
    lastHttpStatus: integer("last_http_status"),
    status: text("status", { enum: ["retry_wait", "terminal"] }).notNull(),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("article_collection_attempts_due_idx").on(table.status, table.nextAttemptAt, table.sourceId),
  ],
);

export const collectionExecutionLocks = sqliteTable("collection_execution_locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  leaseToken: text("lease_token").notNull(),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }).notNull(),
  acquiredAt: integer("acquired_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const durableJobDeadLetters = sqliteTable(
  "durable_job_dead_letters",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => durableJobs.id, { onDelete: "restrict" }),
    queue: text("queue").notNull(),
    jobType: text("job_type").notNull(),
    reasonCode: text("reason_code").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    checkpointVersion: integer("checkpoint_version").notNull(),
    deadLetteredAt: integer("dead_lettered_at", { mode: "timestamp_ms" }).notNull(),
    redrivenAt: integer("redriven_at", { mode: "timestamp_ms" }),
    redrivenBy: text("redriven_by"),
  },
  (table) => [
    index("durable_job_dead_letters_job_idx").on(table.jobId, table.deadLetteredAt),
    index("durable_job_dead_letters_open_idx").on(table.deadLetteredAt, table.redrivenAt),
  ],
);

export const publicationOutboxEvents = sqliteTable(
  "publication_outbox_events",
  {
    id: text("id").primaryKey(),
    destination: text("destination").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateVersion: integer("aggregate_version").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: ["pending", "claimed", "delivered", "terminal"] })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull(),
    claimToken: text("claim_token"),
    claimedBy: text("claimed_by"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: integer("last_error_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("publication_outbox_destination_idempotency_uq").on(table.destination, table.idempotencyKey),
    uniqueIndex("publication_outbox_aggregate_version_uq").on(
      table.destination,
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
    ),
    index("publication_outbox_due_idx").on(
      table.destination,
      table.status,
      table.availableAt,
      table.createdAt,
      table.id,
    ),
    index("publication_outbox_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

export const publicationDeliveryReceipts = sqliteTable(
  "publication_delivery_receipts",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => publicationOutboxEvents.id, { onDelete: "restrict" }),
    destination: text("destination").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    claimToken: text("claim_token"),
    claimedBy: text("claimed_by"),
    destinationReceiptId: text("destination_receipt_id"),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }).notNull(),
    createdAt,
    source: text("source", { enum: ["delivery", "reconciled"] }).notNull(),
  },
  (table) => [
    uniqueIndex("publication_receipts_destination_idempotency_uq").on(table.destination, table.idempotencyKey),
    uniqueIndex("publication_receipts_event_uq").on(table.eventId),
    index("publication_receipts_event_idx").on(table.eventId),
  ],
);

export const communityComments = sqliteTable(
  "community_comments",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    actorHash: text("actor_hash").notNull(),
    displayName: text("display_name").notNull(),
    body: text("body").notNull(),
    readerType: text("reader_type"),
    screen: text("screen"),
    status: text("status", { enum: ["published", "pending", "hidden"] }).notNull().default("published"),
    reportCount: integer("report_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("community_comments_issue_status_created_idx").on(table.issueId, table.status, table.createdAt)],
);

export const communityReports = sqliteTable(
  "community_reports",
  {
    id: text("id").primaryKey(),
    commentId: text("comment_id").notNull().references(() => communityComments.id, { onDelete: "cascade" }),
    reporterHash: text("reporter_hash").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "reviewed", "dismissed"] }).notNull().default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("community_reports_comment_reporter_uq").on(table.commentId, table.reporterHash),
    index("community_reports_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const communityRateLimits = sqliteTable(
  "community_rate_limits",
  {
    actorHash: text("actor_hash").notNull(),
    windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
    commentCount: integer("comment_count").notNull().default(0),
    reportCount: integer("report_count").notNull().default(0),
    reactionCount: integer("reaction_count").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("community_rate_limits_actor_window_uq").on(table.actorHash, table.windowStart), index("community_rate_limits_updated_idx").on(table.updatedAt)],
);

export const communityReactions = sqliteTable(
  "community_reactions",
  {
    commentId: text("comment_id").notNull().references(() => communityComments.id, { onDelete: "cascade" }),
    actorHash: text("actor_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("community_reactions_comment_actor_uq").on(table.commentId, table.actorHash),
    index("community_reactions_comment_idx").on(table.commentId),
  ],
);

export const selfCheckResults = sqliteTable(
  "self_check_results",
  {
    actorHash: text("actor_hash").primaryKey(),
    answersJson: text("answers_json").notNull(),
    typeCode: text("type_code").notNull(),
    scoresJson: text("scores_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("self_check_results_updated_idx").on(table.updatedAt)],
);
