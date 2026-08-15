/** Fail-closed check for public framing/comparison prose. */

const REAL_SOURCE = /gcp:vertex|vertex-evidence|vertex-configured/i;
const TITLE_HASH_SUFFIX = /^-[1-5]$/;

export function isVerifiedSemanticBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  const semantic = bundle.analysisStatus?.semantic ?? {};
  const lineage = bundle.lineage ?? {};
  const runId = String(lineage.runId ?? bundle.runId ?? "").trim();
  const source = String(semantic.source ?? lineage.source ?? bundle.clusterAi?.source ?? "");
  const model = String(semantic.model ?? "").trim();
  const promptVersion = String(semantic.promptVersion ?? "").trim();
  if (!runId || !model || !promptVersion) return false;
  if (!REAL_SOURCE.test(source)) return false;
  if (semantic.status === "review_needed" || semantic.fallbackReason) return false;
  const profiles = Array.isArray(bundle.semanticProfiles) ? bundle.semanticProfiles : [];
  if (!profiles.length) return false;
  for (const entry of profiles) {
    const evidence = entry?.evidence ?? [];
    if (!evidence.length) return false;
    for (const row of evidence) {
      const digest = String(row.sentenceSha256 ?? row.sentence_sha256 ?? "");
      if (!/^[0-9a-f]{64}$/i.test(digest)) return false;
    }
  }
  return true;
}

export function looksLikeTitleDerivedHash(title, digest) {
  if (!title || !digest) return false;
  return TITLE_HASH_SUFFIX.test(String(digest));
}
