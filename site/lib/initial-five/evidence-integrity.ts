import type { EventSynthesisEvidence, IssueAnalysisBundle, SemanticDimensionItem } from "./types";

const BLOCKED = new Set(["failed", "analysis_failed", "conflicting", "dead_letter", "pending", "review_needed", "insufficient_evidence"]);
const PROFILE_PROMPTS = new Set(["2.6.0:sentence-anchor-v1.2.0", "2.6.0:sentence-anchor-v1.3.0"]);
const HASH = /^[a-f0-9]{64}$/i;

/** Eligibility is per article. A held issue must not erase valid observations. */
export function articleIntegrityReason(bundle: IssueAnalysisBundle, articleId: string): string | null {
  const article = bundle.articles.find((row) => row.articleId === articleId);
  const entry = bundle.semanticProfiles.find((row) => row.articleId === articleId);
  const profile = entry?.profile;
  if (!article || !entry || !profile) return "원문 또는 기사 프로필 확보 부족";
  if (entry.status !== "succeeded" || [entry.engine.status, profile.engine?.status, profile.review?.analysis_decision, profile.review?.status].some((state) => BLOCKED.has(String(state)))) return "기사 분석 대기·실패·충돌 상태";
  if (entry.engine.articleId !== articleId || profile.article?.article_id !== articleId) return "기사 ID 매핑 불일치";
  if (!HASH.test(article.bodySha256 ?? "") || article.bodySha256 !== entry.engine.bodySha256 || article.bodySha256 !== profile.article?.body_sha256) return "원문 해시 불일치";
  if (!PROFILE_PROMPTS.has(entry.engine.promptVersion ?? "") || entry.engine.promptVersion !== profile.engine?.prompt_version || entry.engine.schemaVersion !== "agendaframe.article-frame-profile.v2" || profile.engine?.analysis_schema_version !== 3) return "기사 분석 버전 불일치";
  return null;
}

export function sameAnchor(left?: { locator?: { paragraph?: number; sentence?: number }; sentence_sha256?: string }, right?: { locator?: { paragraph?: number; sentence?: number }; sentence_sha256?: string }) {
  return Boolean(left && right && Number.isInteger(left.locator?.paragraph) && Number.isInteger(left.locator?.sentence)
    && HASH.test(left.sentence_sha256 ?? "") && left.locator?.paragraph === right.locator?.paragraph
    && left.locator?.sentence === right.locator?.sentence && left.sentence_sha256?.toLowerCase() === right.sentence_sha256?.toLowerCase());
}

export function matchingProfileItems(bundle: IssueAnalysisBundle, ref: EventSynthesisEvidence): SemanticDimensionItem[] {
  if (!ref.article_id || articleIntegrityReason(bundle, ref.article_id)) return [];
  const entry = bundle.semanticProfiles.find((row) => row.articleId === ref.article_id)!;
  if (!entry.evidence.some((row) => sameAnchor(ref, { locator: row.locator, sentence_sha256: row.sentenceSha256 }))) return [];
  return Object.values(entry.profile?.dimensions ?? {}).flatMap((dimension) => dimension.model_status === "supported" && !BLOCKED.has(String(dimension.status))
    ? (dimension.items ?? []).filter((item) => sameAnchor(ref, item.evidence)) : []);
}

export function evidenceIntegrityValid(bundle: IssueAnalysisBundle, ref: EventSynthesisEvidence, voice?: string): boolean {
  const items = matchingProfileItems(bundle, ref);
  if (!voice || voice === "mixed") return items.length > 0;
  return items.some((item) => voice === "source_attributed"
    ? ["direct_quote", "indirect_source", "uncertain_quote"].includes(item.voice?.kind ?? "")
    : item.voice?.kind === voice);
}
