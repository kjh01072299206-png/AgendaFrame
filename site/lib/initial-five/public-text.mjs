// Public prose must stay readable. Evidence identity belongs in the disclosure
// below the claim, not inline in the sentence itself.
const EVIDENCE_LOCATOR_GROUP = /\(\s*[a-f0-9]{32,64}\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[a-f0-9]{32,64})?(?:\s*;\s*[a-f0-9]{32,64}\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[a-f0-9]{32,64})?)*\s*\)/gi;

/**
 * Remove machine-only article/locator tokens accidentally appended to a
 * generated public sentence. The evidence objects remain available for the
 * explicit evidence disclosure components.
 */
export function stripEvidenceTokens(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(EVIDENCE_LOCATOR_GROUP, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;])/g, "$1")
    .trim();
}
