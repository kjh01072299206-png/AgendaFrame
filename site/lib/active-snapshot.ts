import { initialFiveManifest, getInitialFiveIssueBundle } from "./initial-five/artifacts";
import { withEventSynthesis } from "./initial-five/compose-synthesis.mjs";
import type { InitialFiveManifest, IssueAnalysisBundle } from "./initial-five/types";

type SnapshotEnvelope = {
  schemaVersion: string;
  snapshotId: string;
  basisDate: string;
  generatedAt?: string | null;
  manifest: InitialFiveManifest;
  bundles: Record<string, IssueAnalysisBundle>;
};

export type ActiveSnapshotSource = {
  mode: "demo" | "live";
  publicationStatus: "published" | "pending";
  snapshotId: string;
  manifest: InitialFiveManifest;
  getIssueBundle: (issueId: string) => IssueAnalysisBundle | null;
};

const TITLE_FALLBACK_ISSUE = /^title-fallback-/i;
const UNPUBLISHABLE_PREFIX = "active snapshot is not publishable";

const FORBIDDEN_PUBLIC_KEYS = new Set([
  "body_text",
  "bodytext",
  "raw_body",
  "rawbody",
  "html",
  "sentence_text",
  "sentencetext",
  "full_article",
  "fullarticle",
  "article_content",
  "articlecontent",
  "articlebody",
  "content",
  "full_content",
  "fullcontent",
  "prompt_payload",
  "promptpayload",
  "evidence_text",
  "evidencetext",
]);

const ACTIVE_SNAPSHOT_SCHEMA = "agenda.frame.active-snapshot.v1";
const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{32}$/;

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_PUBLIC_KEYS.has(key.toLowerCase()) || containsForbiddenKey(child));
}

function validateEnvelope(value: unknown): SnapshotEnvelope {
  if (!value || typeof value !== "object") throw new Error("활성 스냅샷 형식이 객체가 아닙니다.");
  if (containsForbiddenKey(value)) throw new Error("활성 스냅샷에 공개 금지 필드가 포함되어 있습니다.");
  const envelope = value as Partial<SnapshotEnvelope>;
  if (envelope.schemaVersion !== ACTIVE_SNAPSHOT_SCHEMA || typeof envelope.snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(envelope.snapshotId)) {
    throw new Error("활성 스냅샷의 schemaVersion/snapshotId가 없습니다.");
  }
  if (!envelope.manifest || typeof envelope.manifest !== "object" || !Array.isArray(envelope.manifest.issues)) {
    throw new Error("활성 스냅샷 manifest가 없습니다.");
  }
  if (!envelope.bundles || typeof envelope.bundles !== "object") throw new Error("활성 스냅샷 bundle이 없습니다.");
  const manifest = envelope.manifest as InitialFiveManifest & {
    snapshotId?: unknown;
    qualityGate?: Record<string, unknown>;
  };
  if (manifest.schemaVersion !== ACTIVE_SNAPSHOT_SCHEMA || manifest.snapshotId !== envelope.snapshotId) {
    throw new Error("활성 스냅샷 manifest의 identity가 envelope와 일치하지 않습니다.");
  }
  if (
    manifest.qualityGate?.status !== "pass" ||
    manifest.qualityGate.rawBodyAbsent !== true ||
    manifest.qualityGate.evidenceLineageComplete !== true
  ) {
    throw new Error("활성 스냅샷 quality gate가 통과되지 않았습니다.");
  }
  const envelopeQuality = (envelope as SnapshotEnvelope & { qualityGate?: Record<string, unknown> }).qualityGate;
  if (envelopeQuality?.status !== "pass") {
    throw new Error("active snapshot quality gate is not pass.");
  }
  if (envelope.manifest.issueCount !== 5 || envelope.manifest.issues.length !== 5) {
    throw new Error("active snapshot manifest must contain exactly five issues.");
  }
  const issueIds = new Set<string>();
  for (const [index, issue] of envelope.manifest.issues.entries()) {
    if (!issue || typeof issue !== "object") throw new Error(`active snapshot issue ${index + 1} is invalid.`);
    const candidate = issue as Partial<InitialFiveManifest["issues"][number]>;
    if (typeof candidate.issueId !== "string" || !candidate.issueId.trim() || issueIds.has(candidate.issueId)) {
      throw new Error("active snapshot issue IDs must be unique and non-empty.");
    }
    if (candidate.payloadKey !== `issues/${candidate.issueId}.json`) {
      throw new Error("active snapshot issue payloadKey is inconsistent.");
    }
    issueIds.add(candidate.issueId);
  }
  const bundleIds = new Set(Object.keys(envelope.bundles));
  if (bundleIds.size !== issueIds.size || [...issueIds].some((issueId) => !bundleIds.has(issueId))) {
    throw new Error("active snapshot bundles do not match the manifest issues.");
  }
  for (const issueId of issueIds) {
    const bundle = envelope.bundles[issueId] as { issue?: { issueId?: unknown } } | undefined;
    if (bundle?.issue?.issueId !== issueId) {
      throw new Error("active snapshot bundle issue IDs do not match the manifest.");
    }
  }
  return envelope as SnapshotEnvelope;
}

function unpublishable(message: string): Error {
  return new Error(`${UNPUBLISHABLE_PREFIX}: ${message}`);
}

function assertLivePublishable(envelope: SnapshotEnvelope): void {
  for (const [index, issue] of envelope.manifest.issues.entries()) {
    const issueId = String(issue.issueId ?? "");
    if (TITLE_FALLBACK_ISSUE.test(issueId)) {
      throw unpublishable(`issue ${index + 1} uses a title-fallback id`);
    }
    if ((issue.articleCount ?? 0) < 3 || (issue.outletCount ?? 0) < 2) {
      throw unpublishable(`issue ${issueId} has fewer than 3 articles or 2 outlets`);
    }
    const bundle = envelope.bundles[issueId] as
      | { articles?: Array<{ outlet?: unknown; sourceId?: unknown }>; clusterAi?: { coherence?: unknown } }
      | undefined;
    const articles = Array.isArray(bundle?.articles) ? bundle.articles : [];
    const outlets = new Set(
      articles
        .map((article) => String(article.outlet ?? article.sourceId ?? "").trim())
        .filter(Boolean),
    );
    if (articles.length < 3 || outlets.size < 2) {
      throw unpublishable(`issue ${issueId} bundle coverage is below the live publish bar`);
    }
    const coherence = String(bundle?.clusterAi?.coherence ?? "").toLowerCase();
    if (coherence === "title_fallback") {
      throw unpublishable(`issue ${issueId} still has title-fallback coherence`);
    }
  }
}

function hasDirectEventSynthesis(bundle: IssueAnalysisBundle | null): boolean {
  const synthesis = bundle?.comparison?.data?.synthesis;
  const runId = String((bundle?.lineage as { runId?: unknown } | undefined)?.runId ?? "").trim();
  return Boolean(
    synthesis?.usable === true
    && synthesis.source === "gcp:event-synthesis"
    && runId
    && String(synthesis.run_id ?? "").trim() === runId
    && synthesis.invocation?.provider === "vertex_ai",
  );
}

function defaultDemoPublicationStatus(): "published" | "pending" {
  const isCurrentDisplay = initialFiveManifest.basisDate === "2026-08-15";
  const hasAllIssueResults = isCurrentDisplay
    && initialFiveManifest.issueCount === 5
    && initialFiveManifest.issues.length === 5
    && initialFiveManifest.issues.every((issue) => hasDirectEventSynthesis(
      withEventSynthesis(getInitialFiveIssueBundle(issue.issueId)),
    ));
  return hasAllIssueResults ? "published" : "pending";
}

function demoSource(publicationStatus: "published" | "pending" = defaultDemoPublicationStatus()): ActiveSnapshotSource {
  return {
    mode: "demo",
    publicationStatus,
    snapshotId: `demo:${initialFiveManifest.generatedAt ?? initialFiveManifest.basisDate}`,
    manifest: initialFiveManifest,
    getIssueBundle: (issueId) => withEventSynthesis(getInitialFiveIssueBundle(issueId)),
  };
}

/**
 * Resolve the published snapshot without making a network call in demo mode.
 * Live mode is deliberately fail-closed: a missing or invalid active pointer
 * must not silently render yesterday's demo data.
 */
export async function getActiveSnapshot(fetcher: typeof fetch = fetch): Promise<ActiveSnapshotSource> {
  const mode = process.env.AGENDAFRAME_DATA_MODE ?? "demo";
  if (mode !== "live") return demoSource();
  const url = process.env.AGENDAFRAME_ACTIVE_SNAPSHOT_URL?.trim();
  if (!url) throw new Error("AGENDAFRAME_DATA_MODE=live requires AGENDAFRAME_ACTIVE_SNAPSHOT_URL.");
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`활성 스냅샷을 읽지 못했습니다 (${response.status}).`);
  let envelope: SnapshotEnvelope;
  try {
    envelope = validateEnvelope(await response.json());
    assertLivePublishable(envelope);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(UNPUBLISHABLE_PREFIX)) {
      return demoSource("pending");
    }
    throw error;
  }
  const bundles = envelope.bundles;

  return {
    mode: "live",
    publicationStatus: "published",
    snapshotId: envelope.snapshotId,
    manifest: envelope.manifest,
    getIssueBundle: (issueId) => withEventSynthesis(bundles[issueId] ?? null),
  };
}

export function validateActiveSnapshotEnvelope(value: unknown): SnapshotEnvelope {
  return validateEnvelope(value);
}
