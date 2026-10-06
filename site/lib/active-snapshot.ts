import { cache } from "react";
import { initialFiveManifest, getInitialFiveIssueBundle } from "./initial-five/artifacts";
import { withEventSynthesis } from "./initial-five/compose-synthesis.mjs";
import { isPublishableEventSynthesis } from "./initial-five/publication-contract";
import type { InitialFiveManifest, IssueAnalysisBundle } from "./initial-five/types";

type SnapshotEnvelope = {
  schemaVersion: string;
  snapshotId: string;
  basisDate: string;
  runId?: string;
  generatedAt?: string | null;
  qualityGate?: Record<string, unknown>;
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
const AUTHORIZED_OCT5_REPLAY_RUN_ID = "oct5-public-override-20261007";
const AUTHORIZED_OCT5_REPLAY_MARKER = "user_authorized_2026-10-05_replay";

function isAuthorizedOct5Replay(envelope: SnapshotEnvelope): boolean {
  return envelope.basisDate === "2026-10-05"
    && envelope.runId === AUTHORIZED_OCT5_REPLAY_RUN_ID
    && envelope.qualityGate?.operatorOverride === AUTHORIZED_OCT5_REPLAY_MARKER;
}

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
  const allowAuthorizedOct5Replay = isAuthorizedOct5Replay(envelope);
  for (const [index, issue] of envelope.manifest.issues.entries()) {
    const issueId = String(issue.issueId ?? "");
    if (TITLE_FALLBACK_ISSUE.test(issueId)) {
      throw unpublishable(`issue ${index + 1} uses a title-fallback id`);
    }
    if (allowAuthorizedOct5Replay) continue;
    if ((issue.articleCount ?? 0) < 3 || (issue.outletCount ?? 0) < 2) {
      throw unpublishable(`issue ${issueId} has fewer than 3 articles or 2 outlets`);
    }
    const bundle = envelope.bundles[issueId];
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
    if (!isPublishableEventSynthesis(bundle)) {
      throw unpublishable(`issue ${issueId} lacks an evidence-bound v2.2 comparison result`);
    }
  }
}

export function validateLiveActiveSnapshotEnvelope(value: unknown): SnapshotEnvelope {
  const envelope = validateEnvelope(value);
  assertLivePublishable(envelope);
  return envelope;
}

export async function readLiveActiveSnapshot(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<SnapshotEnvelope> {
  const normalizedUrl = url.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error("AGENDAFRAME_ACTIVE_SNAPSHOT_URL must be an absolute URL.");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("AGENDAFRAME_ACTIVE_SNAPSHOT_URL must use HTTP(S).");
  }
  const response = await fetcher(normalizedUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`활성 스냅샷을 읽지 못했습니다 (${response.status}).`);
  return validateLiveActiveSnapshotEnvelope(await response.json());
}

function defaultDemoPublicationStatus(): "published" | "pending" {
  const isCurrentDisplay = initialFiveManifest.basisDate === "2026-08-15";
  const hasAllIssueResults = isCurrentDisplay
    && initialFiveManifest.issueCount === 5
    && initialFiveManifest.issues.length === 5
    && initialFiveManifest.issues.every((issue) => isPublishableEventSynthesis(
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
async function resolveActiveSnapshot(fetcher: typeof fetch = fetch): Promise<ActiveSnapshotSource> {
  const mode = process.env.AGENDAFRAME_DATA_MODE ?? "demo";
  if (mode !== "live") return demoSource();
  const url = process.env.AGENDAFRAME_ACTIVE_SNAPSHOT_URL?.trim();
  if (!url) throw new Error("AGENDAFRAME_DATA_MODE=live requires AGENDAFRAME_ACTIVE_SNAPSHOT_URL.");
  // A live reader failure must never turn into a hard-coded demo response.
  // The GCP publisher keeps the previous current pointer when a run fails;
  // this boundary therefore either serves that validated pointer or fails
  // closed when the reader itself is unavailable or invalid.
  const envelope = await readLiveActiveSnapshot(url, fetcher);
  const bundles = envelope.bundles;

  return {
    mode: "live",
    publicationStatus: "published",
    snapshotId: envelope.snapshotId,
    manifest: envelope.manifest,
    getIssueBundle: (issueId) => withEventSynthesis(bundles[issueId] ?? null),
  };
}

// React cache is request-scoped in the server component renderer. It keeps
// layout, page, and nested issue loaders on one pointer during a render while
// avoiding a process-wide stale snapshot between requests.
export const getActiveSnapshot = cache(resolveActiveSnapshot);

export function validateActiveSnapshotEnvelope(value: unknown): SnapshotEnvelope {
  return validateEnvelope(value);
}
