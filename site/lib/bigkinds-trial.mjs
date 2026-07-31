import { createHash } from "node:crypto";

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildTrialAuthorization({
  authorizationId,
  clusterId,
  reviewedBy,
  reviewedAt,
  textScope = "provider_export",
  validUntil,
  clusterReviewStatus,
  articles,
}) {
  if (clusterReviewStatus !== "approved_same_event") {
    throw new Error("동일 사건 검토가 승인된 군집만 분석 권한 명세를 만들 수 있습니다.");
  }
  if (!Array.isArray(articles) || articles.length < 2) {
    throw new Error("다매체 비교 기사 두 건 이상이 필요합니다.");
  }
  if (!authorizationId || !clusterId || !reviewedBy || Number.isNaN(Date.parse(reviewedAt))) {
    throw new Error("승인 ID, 사건 군집 ID, 검토자, ISO-8601 검토 시각이 필요합니다.");
  }
  return {
    schema_version: 3,
    authorization_id: authorizationId,
    cluster_id: clusterId,
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
    purpose: "transient_framing_analysis",
    text_scope: textScope,
    valid_until: validUntil,
    retain_body: false,
    cluster_review_status: clusterReviewStatus,
    approved_articles: Object.fromEntries(
      articles.map((article) => [
        article.article_id,
        {
          source_id: article.source_id,
          canonical_url: article.canonical_url,
          published_date: article.published_at.slice(0, 10),
          body_sha256: sha256Text(article.body_text),
        },
      ]),
    ),
  };
}
