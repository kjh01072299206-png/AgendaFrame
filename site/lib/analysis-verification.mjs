/** Fail-closed check for public framing/comparison prose. */

const REAL_SOURCE = /gcp:vertex|vertex-evidence|vertex-configured/i;
const TITLE_HASH_SUFFIX = /^-[1-5]$/;

function validReceipt(receipt, model, promptVersion) {
  if (!receipt || typeof receipt !== "object") return false;
  if (receipt.provider !== "vertex_ai") return false;
  if (String(receipt.model ?? "").trim() !== model) return false;
  if (String(receipt.prompt_version ?? "").trim() !== promptVersion) return false;
  if (!Number.isInteger(receipt.attempt) || receipt.attempt < 1) return false;
  if (!String(receipt.completed_at ?? "").trim()) return false;
  return /^[0-9a-f]{64}$/i.test(String(receipt.request_sha256 ?? ""))
    && /^[0-9a-f]{64}$/i.test(String(receipt.response_sha256 ?? ""));
}

function validEvidence(row, articleId) {
  if (!row || typeof row !== "object") return false;
  if (String(row.articleId ?? "") !== articleId) return false;
  const locator = row.locator;
  return Number.isInteger(locator?.paragraph) && locator.paragraph >= 1
    && Number.isInteger(locator?.sentence) && locator.sentence >= 1
    && /^[0-9a-f]{64}$/i.test(String(row.sentenceSha256 ?? row.sentence_sha256 ?? ""));
}

export function isVerifiedSemanticBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  const semantic = bundle.analysisStatus?.semantic ?? {};
  const cluster = bundle.analysisStatus?.cluster ?? bundle.clusterAi ?? {};
  const lineage = bundle.lineage ?? {};
  const runId = String(lineage.runId ?? bundle.runId ?? "").trim();
  const source = String(semantic.source ?? lineage.source ?? bundle.clusterAi?.source ?? "");
  const model = String(semantic.model ?? "").trim();
  const promptVersion = String(semantic.promptVersion ?? "").trim();
  const clusterModel = String(cluster.model ?? "").trim();
  const clusterPromptVersion = String(cluster.promptVersion ?? "").trim();
  if (!runId || !model || !promptVersion || !clusterModel || !clusterPromptVersion) return false;
  if (!REAL_SOURCE.test(source)) return false;
  if (semantic.semanticAi !== true || cluster.semanticAi !== true) return false;
  if (semantic.status !== "succeeded" || cluster.status !== "succeeded" || semantic.fallbackReason) return false;
  if (String(semantic.runId ?? runId).trim() !== runId || String(cluster.runId ?? runId).trim() !== runId) return false;
  if (!validReceipt(cluster.invocation, clusterModel, clusterPromptVersion)) return false;
  if (!Array.isArray(semantic.invocations) || !semantic.invocations.length) return false;
  if (!semantic.invocations.every((receipt) => validReceipt(receipt, model, promptVersion))) return false;
  const profiles = Array.isArray(bundle.semanticProfiles) ? bundle.semanticProfiles : [];
  if (!profiles.length) return false;
  for (const entry of profiles) {
    const evidence = entry?.evidence ?? [];
    const articleId = String(entry?.articleId ?? "").trim();
    if (!articleId || entry.status !== "succeeded" || !evidence.length) return false;
    if (!evidence.every((row) => validEvidence(row, articleId))) return false;
    const engine = entry.engine ?? {};
    if (engine.semanticAi !== true || engine.status !== "succeeded") return false;
    if (!validReceipt(engine.invocation, model, promptVersion)) return false;
    if (entry.profile?.lineage?.invocation && !validReceipt(entry.profile.lineage.invocation, model, promptVersion)) return false;
  }
  const issue = bundle.issue ?? {};
  if (!Number.isFinite(Number(issue.agendaScore)) || Number(issue.agendaScore) <= 0) return false;
  if (Number(issue.outletCount) < 2) return false;
  return true;
}

export function looksLikeTitleDerivedHash(title, digest) {
  if (!title || !digest) return false;
  return TITLE_HASH_SUFFIX.test(String(digest));
}
