import { getInitialFiveIssueBundle } from "../../../../lib/initial-five/artifacts";
import type {
  IssueAnalysisBundle,
  InitialFiveArticle,
  PublicEvidence,
  SemanticProfileEntry,
} from "../../../../lib/initial-five/types";

const MAX_QUESTION_LENGTH = 500;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const requestsByClient = new Map<string, number[]>();

type AnswerEvidence = {
  articleId: string;
  source: string;
  sourceUrl: string;
  title: string;
  evidenceLocator: string | null;
  evidenceHash: string | null;
};

function normalizedQuestion(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_QUESTION_LENGTH) : "";
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "anonymous";
}

function rateLimited(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const recent = (requestsByClient.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  requestsByClient.set(key, recent);
  return false;
}

function successfulProfiles(bundle: IssueAnalysisBundle) {
  return bundle.semanticProfiles.filter(
    (entry): entry is SemanticProfileEntry & { profile: NonNullable<SemanticProfileEntry["profile"]> } =>
      entry.status === "succeeded" && Boolean(entry.profile),
  );
}

function articleFor(bundle: IssueAnalysisBundle, articleId: string) {
  return bundle.articles.find((article) => article.articleId === articleId) ?? null;
}

function evidenceLabel(evidence?: PublicEvidence) {
  if (!evidence) return null;
  const paragraph = evidence.locator?.paragraph;
  const sentence = evidence.locator?.sentence;
  if (paragraph === undefined && sentence === undefined) return null;
  return `${paragraph ?? "-"}문단 ${sentence ?? "-"}문장`;
}

function answerEvidence(article: InitialFiveArticle | null, evidence?: PublicEvidence): AnswerEvidence | null {
  if (!article?.canonicalUrl) return null;
  return {
    articleId: article.articleId,
    source: article.outlet ?? "매체 미상",
    sourceUrl: article.canonicalUrl,
    title: article.title ?? "제목 없음",
    evidenceLocator: evidenceLabel(evidence),
    evidenceHash: evidence?.sentenceSha256 ?? null,
  };
}

function semanticClaims(bundle: IssueAnalysisBundle) {
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

function tokens(value: string) {
  const stopwords = new Set(["무엇", "어떤", "왜", "어떻게", "기사", "보도", "알려", "주세요", "에서", "으로", "있는", "하는"]);
  return [...new Set(value.toLowerCase().match(/[0-9a-z가-힣]{2,}/g) ?? [])].filter((token) => !stopwords.has(token));
}

function groundedAnswer(bundle: IssueAnalysisBundle, question: string) {
  const profiles = successfulProfiles(bundle);
  if (!profiles.length) {
    return { status: "withheld", answer: "이 의제에는 성공한 AI 본문 분석이 없어 답변을 보류합니다.", evidence: [] as AnswerEvidence[] };
  }

  if (/취재원|화자|인용|누가|누구/.test(question)) {
    const actors = new Map<string, { count: number; articleId: string; evidence?: PublicEvidence }>();
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
    if (!ranked.length) return { status: "withheld", answer: "AI 분석에서 근거가 연결된 취재원·화자 정보를 찾지 못했습니다.", evidence: [] as AnswerEvidence[] };
    return {
      status: "answered",
      answer: `근거가 연결된 취재원·화자 범주는 ${ranked.map(([label, item]) => `${label} ${item.count}회`).join(", ")}입니다. 횟수는 인용·귀속 관찰 수이며 영향력이나 신뢰도 점수가 아닙니다.`,
      evidence: ranked.map(([, item]) => answerEvidence(articleFor(bundle, item.articleId), item.evidence)).filter((item): item is AnswerEvidence => Boolean(item)),
    };
  }

  const claims = semanticClaims(bundle);
  const questionTokens = tokens(question);
  const ranked = claims.map((claim) => {
    const claimTokens = new Set(tokens(claim.text));
    const overlap = questionTokens.filter((token) => claimTokens.has(token)).length;
    return { ...claim, overlap };
  }).sort((left, right) => right.overlap - left.overlap);
  const differenceQuestion = /차이|다르|갈린|비교|초점/.test(question);
  const selected = differenceQuestion
    ? ranked.reduce<typeof ranked>((items, claim) => {
        if (items.length >= 2) return items;
        if (!items.some((candidate) => candidate.articleId === claim.articleId || candidate.text === claim.text)) items.push(claim);
        return items;
      }, [])
    : ranked.filter((claim) => claim.overlap > 0).slice(0, 3);
  if (!selected.length || (differenceQuestion && selected.length < 2)) {
    return { status: "withheld", answer: "연결된 AI 본문 근거만으로는 이 질문에 답할 수 없습니다.", evidence: [] as AnswerEvidence[] };
  }
  return {
    status: "answered",
    answer: differenceQuestion
      ? `AI 자동 초안에서 확인된 서로 다른 설명은 “${selected[0].text}”와 “${selected[1].text}”입니다.`
      : selected.map((claim) => claim.text).join(" "),
    evidence: selected.map((claim) => answerEvidence(articleFor(bundle, claim.articleId), claim.evidence)).filter((item): item is AnswerEvidence => Boolean(item)),
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 20_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
  if (rateLimited(request)) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const issueId = typeof payload.issueId === "string" ? payload.issueId.trim() : "";
  const question = normalizedQuestion(payload.question);
  if (!issueId || !question) return Response.json({ error: "issue_and_question_required" }, { status: 400 });
  const bundle = getInitialFiveIssueBundle(issueId);
  if (!bundle) return Response.json({ error: "issue_not_found" }, { status: 404 });
  const result = groundedAnswer(bundle, question);
  return Response.json({
    ...result,
    issueId,
    provider: "claude_analysis_grounded_retrieval_v1",
    limitations: [
      "새 사실을 생성하지 않고 성공한 Claude 본문 분석의 공개 paraphrase만 검색합니다.",
      "기사 전문·원문 문장은 답변에 포함하지 않습니다.",
    ],
  }, { headers: { "Cache-Control": "no-store" } });
}
