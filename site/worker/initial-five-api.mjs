import manifest from "../public/initial-five/manifest.json" with { type: "json" };
import issueOne from "../public/initial-five/issues/bigkinds-2026-07-26-top-1.json" with { type: "json" };
import issueTwo from "../public/initial-five/issues/bigkinds-2026-07-26-top-2.json" with { type: "json" };
import issueThree from "../public/initial-five/issues/bigkinds-2026-07-26-top-3.json" with { type: "json" };
import issueFour from "../public/initial-five/issues/bigkinds-2026-07-26-top-4.json" with { type: "json" };
import issueFive from "../public/initial-five/issues/bigkinds-2026-07-26-top-5.json" with { type: "json" };

const MAX_QUESTION_LENGTH = 500;
const MAX_BODY_BYTES = 20_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const requestsByClient = new Map();
const issues = new Map(
  [issueOne, issueTwo, issueThree, issueFour, issueFive].map((bundle) => [bundle.issue.issueId, bundle]),
);

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": status === 200 ? "public, max-age=300, must-revalidate" : "no-store",
      ...headers,
    },
  });
}

function normalizedQuestion(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_QUESTION_LENGTH) : "";
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function clientKey(request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "anonymous";
}

function rateLimited(request) {
  const now = Date.now();
  const key = clientKey(request);
  const recent = (requestsByClient.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  requestsByClient.set(key, recent);
  return false;
}

function successfulProfiles(bundle) {
  return bundle.semanticProfiles.filter((entry) => entry.status === "succeeded" && entry.profile);
}

function articleFor(bundle, articleId) {
  return bundle.articles.find((article) => article.articleId === articleId) ?? null;
}

function publicEvidence(article, evidence) {
  if (!article?.canonicalUrl) return null;
  const paragraph = evidence?.locator?.paragraph;
  const sentence = evidence?.locator?.sentence;
  return {
    articleId: article.articleId,
    source: article.outlet ?? "매체 미상",
    sourceUrl: article.canonicalUrl,
    title: article.title ?? "제목 없음",
    evidenceLocator: paragraph === undefined && sentence === undefined
      ? null
      : `${paragraph ?? "-"}문단 ${sentence ?? "-"}문장`,
    evidenceHash: evidence?.sentenceSha256 ?? null,
  };
}

function semanticClaims(bundle) {
  return successfulProfiles(bundle).flatMap((entry) =>
    Object.entries(entry.profile.dimensions ?? {}).flatMap(([dimension, value]) =>
      (value.items ?? []).flatMap((item) => {
        const text = item.public_paraphrase?.trim();
        if (!text) return [];
        const evidence = item.evidence ? {
          articleId: entry.articleId,
          ...(item.evidence.locator ? { locator: item.evidence.locator } : {}),
          ...(item.evidence.sentence_sha256 ? { sentenceSha256: item.evidence.sentence_sha256 } : {}),
        } : undefined;
        return [{ dimension, text, articleId: entry.articleId, evidence }];
      }),
    ),
  );
}

function tokens(value) {
  const stopwords = new Set(["무엇", "어떤", "왜", "어떻게", "기사", "보도", "알려", "주세요", "에서", "으로", "있는", "하는"]);
  return [...new Set(value.toLowerCase().match(/[0-9a-z가-힣]{2,}/g) ?? [])]
    .filter((token) => !stopwords.has(token));
}

function groundedAnswer(bundle, question) {
  const profiles = successfulProfiles(bundle);
  if (!profiles.length) {
    return { status: "withheld", answer: "이 의제에는 성공한 AI 본문 분석이 없어 답변을 보류합니다.", evidence: [] };
  }

  if (/취재원|화자|인용|누가|누구/.test(question)) {
    const actors = new Map();
    for (const entry of profiles) {
      for (const actor of entry.profile.actors_and_sources ?? []) {
        const label = actor.role_label ?? actor.role ?? "기타 취재원";
        const current = actors.get(label) ?? { count: 0, articleId: entry.articleId };
        current.count += (actor.direct_quote_count ?? 0) + (actor.indirect_attribution_count ?? 0);
        if (!current.evidence && actor.evidence?.[0]) {
          current.evidence = {
            articleId: entry.articleId,
            ...(actor.evidence[0].locator ? { locator: actor.evidence[0].locator } : {}),
            ...(actor.evidence[0].sentence_sha256 ? { sentenceSha256: actor.evidence[0].sentence_sha256 } : {}),
          };
        }
        actors.set(label, current);
      }
    }
    const ranked = [...actors.entries()].sort((left, right) => right[1].count - left[1].count).slice(0, 5);
    if (!ranked.length) {
      return { status: "withheld", answer: "AI 분석에서 근거가 연결된 취재원·화자 정보를 찾지 못했습니다.", evidence: [] };
    }
    return {
      status: "answered",
      answer: `근거가 연결된 취재원·화자 범주는 ${ranked.map(([label, item]) => `${label} ${item.count}회`).join(", ")}입니다. 횟수는 인용·귀속 관찰 수이며 영향력이나 신뢰도 점수가 아닙니다.`,
      evidence: ranked
        .map(([, item]) => publicEvidence(articleFor(bundle, item.articleId), item.evidence))
        .filter(Boolean),
    };
  }

  const claims = semanticClaims(bundle);
  const questionTokens = tokens(question);
  const ranked = claims.map((claim) => {
    const claimTokens = new Set(tokens(claim.text));
    return { ...claim, overlap: questionTokens.filter((token) => claimTokens.has(token)).length };
  }).sort((left, right) => right.overlap - left.overlap);
  const asksForDifference = /차이|다른|갈린|비교|초점/.test(question);
  const selected = asksForDifference
    ? ranked.reduce((items, claim) => {
        if (items.length >= 2) return items;
        if (!items.some((candidate) => candidate.articleId === claim.articleId || candidate.text === claim.text)) {
          items.push(claim);
        }
        return items;
      }, [])
    : ranked.filter((claim) => claim.overlap > 0).slice(0, 3);
  if (!selected.length || (asksForDifference && selected.length < 2)) {
    return { status: "withheld", answer: "연결된 AI 본문 근거만으로는 이 질문에 답할 수 없습니다.", evidence: [] };
  }
  return {
    status: "answered",
    answer: asksForDifference
      ? `AI 자동 초안에서 확인된 서로 다른 설명은 “${selected[0].text}”과 “${selected[1].text}”입니다.`
      : selected.map((claim) => claim.text).join(" "),
    evidence: selected
      .map((claim) => publicEvidence(articleFor(bundle, claim.articleId), claim.evidence))
      .filter(Boolean),
  };
}

async function handleAsk(request) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  if (rateLimited(request)) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const issueId = typeof payload?.issueId === "string" ? payload.issueId.trim() : "";
  const question = normalizedQuestion(payload?.question);
  if (!issueId || !question) return json({ error: "issue_and_question_required" }, 400);
  const bundle = issues.get(issueId);
  if (!bundle) return json({ error: "issue_not_found" }, 404);
  return json({
    ...groundedAnswer(bundle, question),
    issueId,
    provider: "gemini_analysis_grounded_retrieval_v1",
    limitations: [
      "새 사실을 생성하지 않고 성공한 Gemini 본문 분석의 공개 paraphrase만 검색합니다.",
      "기사 전문·원문 문장은 답변에 포함하지 않습니다.",
    ],
  }, 200, { "Cache-Control": "no-store" });
}

export async function handleInitialFiveRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/initial-five") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
    return json(manifest);
  }
  if (url.pathname === "/api/initial-five/ask") return handleAsk(request);
  const issueMatch = url.pathname.match(/^\/api\/initial-five\/issues\/([^/]+)$/);
  if (issueMatch) {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
    const bundle = issues.get(decodeURIComponent(issueMatch[1]));
    return bundle ? json(bundle) : json({ error: "issue_not_found" }, 404);
  }
  return null;
}
