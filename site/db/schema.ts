import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
