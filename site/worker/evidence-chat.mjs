const MAX_QUESTION_LENGTH = 500;
const STOPWORDS = new Set(["무엇", "어떤", "왜", "어떻게", "언론", "기사", "보도", "알려", "주세요", "이번", "대해", "에서", "으로", "있는", "하는"]);

function tokens(value) {
  return [...new Set(String(value ?? "").toLowerCase().match(/[0-9a-z가-힣]{2,}/g) ?? [])]
    .map((token) => token.replace(/(들이|으로|에서|에게|부터|까지|이|가|은|는|을|를|과|와|에|도|만|의)$/u, ""))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function evidenceOf(value) {
  const evidence = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.sourceUrl === "string") {
      evidence.push({
        claimId: node.claimId ?? `article:${node.articleId ?? node.sourceUrl}`,
        articleId: node.articleId ?? null,
        source: node.source ?? "출처 미상",
        sourceUrl: node.sourceUrl,
        evidenceLocator: node.evidenceLocator ?? node.evidence_locator ?? null,
        evidenceHash: node.evidenceHash ?? node.evidence_hash ?? null,
      });
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  const seen = new Set();
  return evidence.filter((item) => {
    const key = `${item.claimId}:${item.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textCandidates(comparison) {
  const result = [];
  const add = (text, evidence) => {
    if (typeof text === "string" && text.trim()) result.push({ text: text.trim(), evidence: evidenceOf(evidence ?? comparison) });
  };
  add(comparison?.summary?.commonGround, comparison?.commonFacts);
  add(comparison?.summary?.mainDifference, comparison?.axes);
  add(comparison?.summary?.whyItMatters, comparison?.narratives);
  add(comparison?.summary?.sourceContext, comparison?.sourceLens);
  for (const axis of comparison?.axes ?? []) for (const variant of axis.variants ?? []) add(`${axis.label ?? axis.dimension}: ${variant.summary}`, variant.outlets);
  for (const narrative of comparison?.narratives ?? []) add(narrative.summary, narrative.evidence);
  return result;
}

export function normalizeChatQuestion(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_QUESTION_LENGTH);
}

export function answerFromEvidence(question, comparison) {
  const normalized = normalizeChatQuestion(question);
  if (!normalized) return { status: "withheld", answer: "질문을 입력해 주세요.", evidence: [], limitations: ["질문이 비어 있습니다."] };
  if (normalized.length > MAX_QUESTION_LENGTH) return { status: "withheld", answer: "질문이 너무 깁니다.", evidence: [], limitations: [`질문은 ${MAX_QUESTION_LENGTH}자 이내여야 합니다.`] };
  const questionTokens = tokens(normalized);
  const candidates = textCandidates(comparison);
  const ranked = candidates.map((candidate) => {
    const candidateTokens = new Set(tokens(candidate.text));
    const overlap = questionTokens.filter((token) => candidateTokens.has(token)).length;
    return { ...candidate, overlap };
  }).sort((left, right) => right.overlap - left.overlap);
  const best = ranked.find((candidate) => candidate.overlap > 0 && candidate.evidence.length > 0);
  if (!best) {
    return {
      status: "withheld",
      answer: "현재 이슈에 연결된 근거만으로는 이 질문에 답할 수 없습니다.",
      evidence: [],
      limitations: ["근거가 연결된 비교 결과에서 질문과 직접 맞닿는 설명을 찾지 못했습니다.", "원문 전체를 추정하거나 보충하지 않았습니다."],
    };
  }
  return {
    status: "answered",
    answer: best.text,
    evidence: best.evidence.slice(0, 8),
    limitations: ["이 답변은 선택한 이슈의 구조화 비교 결과에 한정됩니다.", "원문 전체의 사실성이나 언론사의 의도를 판정하지 않습니다."],
  };
}

async function readJson(request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 20_000) return null;
    return await request.json();
  } catch {
    return null;
  }
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function safeId(value) {
  const id = decodeURIComponent(String(value ?? "")).trim();
  return id && id.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function handleEvidenceChat(request, env = {}) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/chat") return null;
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST만 허용됩니다." } }, 405);
  if (!sameOrigin(request)) return json({ error: { code: "FORBIDDEN", message: "허용된 사이트에서 보낸 요청만 처리합니다." } }, 403);
  if (!env?.DB || typeof env.DB.prepare !== "function") return json({ error: { code: "UNAVAILABLE", message: "근거 저장소가 아직 준비되지 않았습니다." } }, 503);
  const payload = await readJson(request);
  const issueId = safeId(payload?.issueId);
  const question = normalizeChatQuestion(payload?.question);
  if (!issueId || !question) return json({ error: { code: "INVALID_REQUEST", message: "이슈와 질문을 함께 입력해 주세요." } }, 400);
  const row = await env.DB.prepare("SELECT comparison_json AS comparisonJson FROM issue_frame_comparisons WHERE issue_id = ? LIMIT 1").bind(issueId).first();
  if (!row?.comparisonJson) return json({ status: "withheld", provider: "grounded_rules_v1", answer: "이 이슈에는 연결된 비교 근거가 아직 없습니다.", evidence: [], limitations: ["비교 분석이 공개된 이슈만 질문할 수 있습니다."] });
  let comparison;
  try { comparison = JSON.parse(String(row.comparisonJson)); } catch { return json({ status: "withheld", provider: "grounded_rules_v1", answer: "비교 근거를 읽지 못해 답변을 보류합니다.", evidence: [], limitations: ["저장된 비교 결과의 형식이 올바르지 않습니다."] }, 503); }
  return json({ ...answerFromEvidence(question, comparison), provider: "grounded_rules_v1", issueId, question });
}
