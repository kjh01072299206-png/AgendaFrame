import assert from "node:assert/strict";
import test from "node:test";

import { buildTrialAuthorization } from "../lib/bigkinds-trial.mjs";

test("prepares a hash-bound body-free authorization manifest for one reviewed issue", async () => {
  const authorization = buildTrialAuthorization({
    authorizationId: "fixture-authorization",
    clusterId: "fixture-cluster",
    reviewedBy: "fixture-reviewer",
    reviewedAt: "2026-07-31T00:00:00+09:00",
    validUntil: "2026-10-31",
    clusterReviewStatus: "approved_same_event",
    articles: [
      {
        article_id: "one",
        source_id: "hani",
        canonical_url: "https://www.hani.co.kr/arti/test/one",
        published_at: "2026-07-26T10:00:00+09:00",
        body_text: "첫 번째 기사의 충분히 긴 분석용 본문입니다.",
      },
      {
        article_id: "two",
        source_id: "khan",
        canonical_url: "https://www.khan.co.kr/test/two",
        published_at: "2026-07-26T10:10:00+09:00",
        body_text: "두 번째 기사의 충분히 긴 분석용 본문입니다.",
      },
    ],
  });
  assert.equal(authorization.schema_version, 3);
  assert.equal(authorization.cluster_id, "fixture-cluster");
  assert.equal(authorization.retain_body, false);
  assert.equal(authorization.cluster_review_status, "approved_same_event");
  assert.equal(Object.keys(authorization.approved_articles).length, 2);
  assert.doesNotMatch(JSON.stringify(authorization), /첫 번째 기사의/);
  assert.match(authorization.approved_articles.one.body_sha256, /^[a-f0-9]{64}$/);
  assert.equal(authorization.approved_articles.one.source_id, "hani");
  assert.equal(authorization.approved_articles.one.published_date, "2026-07-26");
});

test("refuses an unreviewed event cluster", () => {
  assert.throws(
    () => buildTrialAuthorization({
      authorizationId: "fixture-authorization",
      clusterId: "fixture-cluster",
      reviewedBy: "fixture-reviewer",
      reviewedAt: "2026-07-31T00:00:00+09:00",
      validUntil: "2026-10-31",
      clusterReviewStatus: "review_required",
      articles: [
        {
          article_id: "one",
          source_id: "hani",
          canonical_url: "https://www.hani.co.kr/arti/test/one",
          published_at: "2026-07-26T10:00:00+09:00",
          body_text: "첫 번째 본문",
        },
        {
          article_id: "two",
          source_id: "khan",
          canonical_url: "https://www.khan.co.kr/test/two",
          published_at: "2026-07-26T10:10:00+09:00",
          body_text: "두 번째 본문",
        },
      ],
    }),
    /동일 사건 검토/,
  );
});
