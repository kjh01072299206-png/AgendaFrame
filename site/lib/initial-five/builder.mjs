import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_ENGINE_LABEL,
  INITIAL_FIVE_SCHEMA_VERSION,
  RULE_ENGINE_LABEL,
  UNAVAILABLE_ENGINE_LABEL,
  assertAnalysisState,
  fixedEventTitle,
} from "./constants.mjs";
import {
  assertNoForbiddenPublicKeys,
  collectPublicEvidence,
  compactEngine,
  hasPublicEvidence,
  projectPublicValue,
} from "./public.mjs";

const LIBRARY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_SITE_ROOT = LIBRARY_ROOT;
export const TOP5_FILE_NAME = "top5-2026-07-26.json";
export const METADATA_CLUSTER_FILE_NAME = "metadata-clusters-2026-07-26.json";

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function readJsonSync(filePath, label) {
  try {
    return assertObject(JSON.parse(readFileSync(filePath, "utf8")), label);
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`, { cause: error });
  }
}

function rankDirectory(siteRoot, rank) {
  return path.join(siteRoot, "data", `semantic-rank${rank}-2026-07-26`);
}

function articleIdFromFileName(fileName) {
  return fileName.endsWith(".json") ? fileName.slice(0, -5) : fileName;
}

function semanticWrapperArticleId(wrapper, fallbackArticleId) {
  return wrapper?.articleId ?? wrapper?.profile?.article?.article_id ?? fallbackArticleId;
}

function semanticEngineParts(profile) {
  const engine = profile?.engine ?? {};
  const lineage = profile?.lineage ?? {};
  return {
    model: engine.version ?? lineage.model_id ?? null,
    promptVersion: engine.prompt_version ?? lineage.prompt_version ?? null,
    schemaVersion: lineage.analysis_schema_version ?? engine.analysis_schema_version ?? null,
  };
}

function fallbackReason(profile) {
  return profile?.review?.fallback_reason ?? profile?.fallback_reason ?? null;
}

/**
 * A semantic profile is successful only when it is an AI decision with
 * evidence. A deterministic rules profile or an empty AI response is never
 * promoted to semantic success.
 */
export function isSemanticProfileSuccess(wrapper) {
  const profile = wrapper?.profile ?? wrapper;
  if (!profile || typeof profile !== "object") return false;
  if (profile.engine?.semantic_ai !== true) return false;
  if (profile.review?.analysis_decision !== "analyze") return false;
  if (fallbackReason(profile)) return false;
  if (!profile.article?.body_sha256) return false;
  return hasPublicEvidence(profile);
}

function semanticFailureReason(wrapper) {
  const profile = wrapper?.profile ?? wrapper;
  if (!profile) return "semantic_profile_missing";
  if (fallbackReason(profile)) return "semantic_fallback";
  if (profile.engine?.semantic_ai !== true) return "semantic_engine_not_ai";
  if (profile.review?.analysis_decision !== "analyze") return "semantic_decision_not_analyze";
  if (!profile.article?.body_sha256) return "semantic_article_fingerprint_missing";
  if (!hasPublicEvidence(profile)) return "semantic_evidence_missing";
  return "semantic_profile_invalid";
}

function semanticStatus(wrapper) {
  return isSemanticProfileSuccess(wrapper) ? "succeeded" : "review_needed";
}

function clusterSuccess(cluster) {
  return Boolean(
    cluster &&
      cluster.decision === "analyze" &&
      cluster.engine?.semantic_ai === true &&
      !cluster.fallback_reason,
  );
}

function clusterDescriptor(cluster) {
  const engine = cluster?.engine ?? {};
  const status = clusterSuccess(cluster) ? "succeeded" : "review_needed";
  assertAnalysisState(status, "cluster status");
  return {
    ...compactEngine({
      label: clusterSuccess(cluster) ? AI_ENGINE_LABEL : UNAVAILABLE_ENGINE_LABEL,
      semanticAi: clusterSuccess(cluster),
      status,
      model: engine.version ?? null,
      promptVersion: engine.prompt_version ?? null,
      schemaVersion: engine.schema_version ?? null,
      source: "metadata-clusters-2026-07-26.json",
    }),
    decision: cluster?.decision ?? null,
    coherence: cluster?.coherence ?? null,
    textScope: engine.text_scope ?? null,
    fallbackReason: cluster?.fallback_reason ?? null,
    requiresHumanReview: true,
  };
}

function semanticDescriptor(wrapper, articleId) {
  const profile = wrapper?.profile ?? null;
  const status = semanticStatus(wrapper);
  const success = status === "succeeded";
  const parts = semanticEngineParts(profile);
  const evidence = success ? collectPublicEvidence(profile, articleId) : [];
  return {
    ...compactEngine({
      label: success ? AI_ENGINE_LABEL : UNAVAILABLE_ENGINE_LABEL,
      semanticAi: success,
      status,
      model: parts.model,
      promptVersion: parts.promptVersion,
      schemaVersion: parts.schemaVersion,
      source: wrapper ? "semantic-rank*-2026-07-26" : null,
    }),
    articleId,
    evidenceCount: evidence.length,
    bodySha256: profile?.article?.body_sha256 ?? null,
    reviewRequired: profile?.review?.requires_human_review ?? true,
    fallbackReason: success ? null : semanticFailureReason(wrapper),
  };
}

function ruleDescriptor(profile, articleId, top5) {
  const engine = profile?.engine ?? {};
  const evidence = collectPublicEvidence(profile, articleId);
  return {
    ...compactEngine({
      label: RULE_ENGINE_LABEL,
      semanticAi: false,
      status: "succeeded",
      model: engine.version ?? top5.modelVersion ?? null,
      promptVersion: null,
      schemaVersion: profile?.schema_version ?? null,
      source: "top5-2026-07-26.json",
    }),
    articleId,
    evidenceCount: evidence.length,
    bodySha256: profile?.article?.body_sha256 ?? null,
  };
}

function publicCluster(cluster, articleIds) {
  const descriptor = clusterDescriptor(cluster);
  return {
    ...descriptor,
    summary: cluster?.summary ?? null,
    commonSubjects: Array.isArray(cluster?.common_subjects) ? projectPublicValue(cluster.common_subjects) : [],
    narrativeVariants: Array.isArray(cluster?.narrative_variants)
      ? projectPublicValue(cluster.narrative_variants)
      : [],
    outlierArticleIds: Array.isArray(cluster?.outlier_article_ids)
      ? projectPublicValue(cluster.outlier_article_ids)
      : [],
    articleIds,
  };
}

function publicArticleMetadata(article, semanticProfile, ruleProfile, issueId) {
  const articleId = article.articleId ?? article.id;
  const semantic = semanticDescriptor(semanticProfile, articleId);
  const rules = ruleDescriptor(ruleProfile, articleId, { modelVersion: "korean-evidence-rules-v2" });
  const bodySha256 = semantic.bodySha256 ?? rules.bodySha256 ?? null;
  return {
    articleId,
    id: article.id ?? articleId,
    title: article.title ?? null,
    outlet: article.source ?? null,
    sourceId: article.sourceId ?? null,
    mediaGroupId: article.mediaGroupId ?? null,
    publishedAt: article.publishedAt ?? null,
    section: article.section ?? null,
    canonicalUrl: article.canonicalUrl ?? null,
    bodySha256,
    analysis: {
      semantic,
      rules,
    },
    issueId,
  };
}

function issueState({ cluster, semanticProfiles, articleCount }) {
  const clusterState = clusterDescriptor(cluster).status;
  const semanticSuccesses = semanticProfiles.filter((profile) => isSemanticProfileSuccess(profile)).length;
  if (clusterState === "succeeded" && semanticSuccesses === articleCount) return "succeeded";
  if (semanticSuccesses > 0 || clusterState === "review_needed") return "review_needed";
  return "review_needed";
}

function semanticSummary(semanticProfiles, articleCount) {
  const succeeded = semanticProfiles.filter((profile) => isSemanticProfileSuccess(profile)).length;
  const reviewNeeded = Math.max(articleCount - succeeded, 0);
  const engineParts = semanticProfiles.find((profile) => isSemanticProfileSuccess(profile))?.profile;
  const parts = semanticEngineParts(engineParts);
  const status = succeeded === articleCount && articleCount > 0 ? "succeeded" : "review_needed";
  assertAnalysisState(status, "semantic status");
  return {
    ...compactEngine({
      label: succeeded > 0 ? AI_ENGINE_LABEL : UNAVAILABLE_ENGINE_LABEL,
      semanticAi: succeeded > 0,
      status,
      model: parts.model,
      promptVersion: parts.promptVersion,
      schemaVersion: parts.schemaVersion,
      source: "semantic-rank*-2026-07-26",
    }),
    articleCount,
    succeededArticleCount: succeeded,
    reviewNeededArticleCount: reviewNeeded,
    requiresHumanReview: true,
  };
}

function sourceLineage({ top5, metadata, semanticByRank, issueId, rank }) {
  return {
    contractVersion: INITIAL_FIVE_SCHEMA_VERSION,
    basisDate: top5.basisDate ?? metadata.basis_date ?? null,
    source: {
      top5SchemaVersion: top5.schemaVersion ?? null,
      top5GeneratedAt: top5.generatedAt ?? null,
      metadataSchemaVersion: metadata.schema_version ?? null,
      metadataGeneratedAt: metadata.generated_at ?? null,
      semanticDirectory: `semantic-rank${rank}-2026-07-26`,
      semanticFileCount: semanticByRank.length,
    },
    issueId,
  };
}

function issueMetadata(top5Issue) {
  return {
    issueId: top5Issue.issueId,
    rank: top5Issue.rank,
    title: fixedEventTitle(top5Issue.issueId, top5Issue.title),
    category: top5Issue.category ?? null,
    articleCount: top5Issue.articleCount ?? top5Issue.articleMetadata?.length ?? 0,
    outletCount: top5Issue.sourceCount ?? new Set((top5Issue.articleMetadata ?? []).map((article) => article.sourceId)).size,
  };
}

function mapSemanticProfiles(semanticProfiles) {
  return new Map(
    semanticProfiles.map((wrapper) => [
      semanticWrapperArticleId(wrapper, null),
      wrapper,
    ]),
  );
}

function mapRuleProfiles(top5Issue) {
  return new Map(
    (top5Issue.profiles ?? []).map((profile) => [profile?.article?.article_id, profile]),
  );
}

function publicComparison(top5Issue) {
  const projected = projectPublicValue(top5Issue.comparison ?? {});
  if (projected.method && typeof projected.method === "object") {
    projected.method.semantic_ai = false;
    projected.method.engine_label = RULE_ENGINE_LABEL;
  }
  return {
    engine: compactEngine({
      label: RULE_ENGINE_LABEL,
      semanticAi: false,
      status: "succeeded",
      model: top5Issue.profiles?.[0]?.engine?.version ?? null,
      promptVersion: null,
      schemaVersion: top5Issue.comparison?.schema_version ?? null,
      source: "top5-2026-07-26.json",
    }),
    data: projected,
    evidence: collectPublicEvidence(top5Issue.comparison ?? {}),
  };
}

export function buildIssueAnalysisBundle({ top5, metadata, top5Issue, semanticProfiles = [] }) {
  assertObject(top5, "top5 source");
  assertObject(metadata, "metadata source");
  assertObject(top5Issue, "top5 issue");
  const rank = top5Issue.rank;
  const issueId = top5Issue.issueId;
  const cluster = metadata.clusters?.find((entry) => entry.issue_id === issueId) ?? null;
  const semanticMap = mapSemanticProfiles(semanticProfiles);
  const ruleMap = mapRuleProfiles(top5Issue);
  const articles = (top5Issue.articleMetadata ?? []).map((article) => {
    const articleId = article.articleId ?? article.id;
    return publicArticleMetadata(article, semanticMap.get(articleId), ruleMap.get(articleId), issueId);
  });
  const articleIds = articles.map((article) => article.articleId);
  const semanticEntries = articles.map((article) => {
    const wrapper = semanticMap.get(article.articleId);
    const profile = wrapper?.profile ?? null;
    const success = isSemanticProfileSuccess(wrapper);
    return {
      articleId: article.articleId,
      status: semanticStatus(wrapper),
      engine: semanticDescriptor(wrapper, article.articleId),
      evidence: success ? collectPublicEvidence(profile, article.articleId) : [],
      profile: success ? projectPublicValue(profile) : null,
    };
  });
  const ruleEntries = articles.map((article) => {
    const profile = ruleMap.get(article.articleId) ?? null;
    const engine = ruleDescriptor(profile, article.articleId, top5);
    return {
      articleId: article.articleId,
      status: "succeeded",
      engine,
      evidence: collectPublicEvidence(profile, article.articleId),
      profile: projectPublicValue(profile),
    };
  });
  const state = issueState({ cluster, semanticProfiles, articleCount: articles.length });
  assertAnalysisState(state, "issue status");
  const clusterAi = publicCluster(cluster, articleIds);
  const semantic = semanticSummary(semanticProfiles, articles.length);

  const bundle = {
    schemaVersion: INITIAL_FIVE_SCHEMA_VERSION,
    basisDate: top5.basisDate ?? metadata.basis_date ?? null,
    status: state,
    issue: issueMetadata(top5Issue),
    analysisStatus: {
      state,
      cluster: clusterAi,
      semantic,
    },
    clusterAi,
    articles,
    semanticProfiles: semanticEntries,
    ruleProfiles: ruleEntries,
    comparison: publicComparison(top5Issue),
    lineage: sourceLineage({
      top5,
      metadata,
      semanticByRank: semanticProfiles,
      issueId,
      rank,
    }),
  };
  assertNoForbiddenPublicKeys(bundle);
  return bundle;
}

function validateTop5(top5) {
  if (top5.basisDate !== "2026-07-26") {
    throw new Error(`Unexpected top-five basis date: ${String(top5.basisDate)}`);
  }
  if (!Array.isArray(top5.issues) || top5.issues.length < 5) {
    throw new Error("top5 source must contain at least five issues");
  }
}

function validateMetadata(metadata) {
  if (!Array.isArray(metadata.clusters)) throw new Error("metadata source must contain clusters");
}

export function readSemanticProfilesSync(siteRoot, rank) {
  const directory = rankDirectory(siteRoot, rank);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => {
      const filePath = path.join(directory, fileName);
      const fallbackArticleId = articleIdFromFileName(fileName);
      try {
        const wrapper = readJsonSync(filePath, `semantic profile ${fileName}`);
        if (!wrapper.profile || typeof wrapper.profile !== "object") {
          return { articleId: fallbackArticleId, profile: null, invalidReason: "profile_missing" };
        }
        return {
          ...wrapper,
          articleId: semanticWrapperArticleId(wrapper, fallbackArticleId),
        };
      } catch (error) {
        return {
          articleId: fallbackArticleId,
          profile: null,
          invalidReason: "invalid_json",
          errorMessage: error.message,
        };
      }
    });
}

export function readInitialFiveSourcesSync({ siteRoot = DEFAULT_SITE_ROOT } = {}) {
  const dataRoot = path.join(siteRoot, "data");
  return {
    siteRoot,
    top5: readJsonSync(path.join(dataRoot, TOP5_FILE_NAME), TOP5_FILE_NAME),
    metadata: readJsonSync(path.join(dataRoot, METADATA_CLUSTER_FILE_NAME), METADATA_CLUSTER_FILE_NAME),
  };
}

function buildManifestFromSources({ top5, metadata, semanticByRank }) {
  validateTop5(top5);
  validateMetadata(metadata);
  const issues = top5.issues
    .slice()
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 5)
    .map((top5Issue) => {
      const semanticProfiles = semanticByRank.get(top5Issue.rank) ?? [];
      const articleCount = top5Issue.articleCount ?? top5Issue.articleMetadata?.length ?? 0;
      const cluster = metadata.clusters?.find((entry) => entry.issue_id === top5Issue.issueId) ?? null;
      const clusterAi = clusterDescriptor(cluster);
      const semantic = semanticSummary(semanticProfiles, articleCount);
      const status = issueState({ cluster, semanticProfiles, articleCount });
      assertAnalysisState(status, "manifest issue status");
      return {
        issueId: top5Issue.issueId,
        rank: top5Issue.rank,
        title: fixedEventTitle(top5Issue.issueId, top5Issue.title),
        category: top5Issue.category ?? null,
        articleCount,
        outletCount: top5Issue.sourceCount ?? new Set((top5Issue.articleMetadata ?? []).map((article) => article.sourceId)).size,
        status,
        payloadKey: `issues/${top5Issue.issueId}.json`,
        clusterAi: {
          status: clusterAi.status,
          engineLabel: clusterAi.label,
          semanticAi: clusterAi.semanticAi,
          model: clusterAi.model,
          promptVersion: clusterAi.promptVersion,
          schemaVersion: clusterAi.schemaVersion,
        },
        semantic: {
          status: semantic.status,
          engineLabel: semantic.label,
          semanticAi: semantic.semanticAi,
          model: semantic.model,
          promptVersion: semantic.promptVersion,
          schemaVersion: semantic.schemaVersion,
          succeededArticleCount: semantic.succeededArticleCount,
          reviewNeededArticleCount: semantic.reviewNeededArticleCount,
        },
      };
    });

  return {
    schemaVersion: INITIAL_FIVE_SCHEMA_VERSION,
    basisDate: top5.basisDate ?? metadata.basis_date ?? null,
    generatedAt: top5.generatedAt ?? metadata.generated_at ?? null,
    issueCount: issues.length,
    articleCount: issues.reduce((sum, issue) => sum + issue.articleCount, 0),
    issues,
    lineage: {
      top5SchemaVersion: top5.schemaVersion ?? null,
      metadataSchemaVersion: metadata.schema_version ?? null,
      metadataGeneratedAt: metadata.generated_at ?? null,
    },
  };
}

export function buildInitialFiveManifest({ top5, metadata, semanticByRank = new Map() }) {
  const manifest = buildManifestFromSources({ top5, metadata, semanticByRank });
  assertNoForbiddenPublicKeys(manifest);
  return manifest;
}

export function buildInitialFive({ siteRoot = DEFAULT_SITE_ROOT } = {}) {
  const sources = readInitialFiveSourcesSync({ siteRoot });
  validateTop5(sources.top5);
  validateMetadata(sources.metadata);
  const semanticByRank = new Map();
  for (const issue of sources.top5.issues.slice(0, 5)) {
    semanticByRank.set(issue.rank, readSemanticProfilesSync(siteRoot, issue.rank));
  }
  const manifest = buildInitialFiveManifest({
    top5: sources.top5,
    metadata: sources.metadata,
    semanticByRank,
  });
  const issuesById = new Map(sources.top5.issues.map((issue) => [issue.issueId, issue]));
  const getIssue = (issueId) => {
    const top5Issue = issuesById.get(issueId);
    if (!top5Issue || top5Issue.rank > 5) return null;
    return buildIssueAnalysisBundle({
      top5: sources.top5,
      metadata: sources.metadata,
      top5Issue,
      semanticProfiles: semanticByRank.get(top5Issue.rank) ?? [],
    });
  };
  return {
    manifest,
    getIssue,
    getIssueByRank(rank) {
      const issue = sources.top5.issues.find((entry) => entry.rank === rank);
      return issue ? getIssue(issue.issueId) : null;
    },
  };
}

export function createInitialFiveReader({ siteRoot = DEFAULT_SITE_ROOT } = {}) {
  const sources = readInitialFiveSourcesSync({ siteRoot });
  validateTop5(sources.top5);
  validateMetadata(sources.metadata);
  const semanticCache = new Map();
  const getSemanticProfiles = (rank) => {
    if (!semanticCache.has(rank)) semanticCache.set(rank, readSemanticProfilesSync(siteRoot, rank));
    return semanticCache.get(rank);
  };
  const manifest = buildInitialFiveManifest({
    top5: sources.top5,
    metadata: sources.metadata,
    semanticByRank: new Map(sources.top5.issues.slice(0, 5).map((issue) => [issue.rank, getSemanticProfiles(issue.rank)])),
  });
  const issuesById = new Map(sources.top5.issues.map((issue) => [issue.issueId, issue]));
  const getIssue = (issueId) => {
    const top5Issue = issuesById.get(issueId);
    if (!top5Issue || top5Issue.rank > 5) return null;
    return buildIssueAnalysisBundle({
      top5: sources.top5,
      metadata: sources.metadata,
      top5Issue,
      semanticProfiles: getSemanticProfiles(top5Issue.rank),
    });
  };

  return {
    manifest,
    getManifest() {
      return structuredClone(manifest);
    },
    getIssue,
    getIssueByRank(rank) {
      const issue = sources.top5.issues.find((entry) => entry.rank === rank);
      return issue ? getIssue(issue.issueId) : null;
    },
  };
}

export async function writeInitialFiveArtifacts({ siteRoot = DEFAULT_SITE_ROOT, outputRoot }) {
  if (!outputRoot) throw new Error("outputRoot is required to write public artifacts");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const reader = createInitialFiveReader({ siteRoot });
  await mkdir(path.join(outputRoot, "issues"), { recursive: true });
  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(reader.manifest, null, 2)}\n`, "utf8");
  for (const issue of reader.manifest.issues) {
    const bundle = reader.getIssue(issue.issueId);
    await writeFile(path.join(outputRoot, issue.payloadKey), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  }
  return reader.manifest;
}
