import { articleIntegrityReason, evidenceIntegrityValid } from "./evidence-integrity";
import type { EventSynthesisEvidence, IssueAnalysisBundle } from "./types";

export const FINE_VERSION = "fine-comparison-v1.0.0";
export const OBSERVATION_AXES = ["title_lead", "certainty", "agency", "evaluative_language", "sources_countervoices", "placement", "context_depth", "additional_context"] as const;
export type ObservationState = "verified_detail" | "expression_only" | "not_observed" | "source_incomplete" | "comparison_insufficient" | "pending" | "failed";
export interface ArticleExplanation {
  article_id: string;
  outlet: string;
  description: string;
  voice: string;
  evidence: EventSynthesisEvidence[];
  title_basis?: { title: string; title_sha256: string };
  scope: string;
}
export interface FineObservation {
  observation_id: string;
  axis: typeof OBSERVATION_AXES[number];
  status: ObservationState;
  headline: string;
  common: string;
  articles: ArticleExplanation[];
  difference: string;
  importance: { level: "low" | "medium" | "high"; reason: string };
  interpretation: string;
  limitations: string;
}
export interface FineComparison {
  version: string;
  producer: string;
  run_id: string;
  observations: FineObservation[];
  rejected?: Array<{ headline: string; reason: string }>;
}
export const FINE_STATUS_LABEL: Record<ObservationState, string> = {
  verified_detail: "공통 핵심·세부 차이 확인",
  expression_only: "표현 관측 확인·프레임 해석 보류",
  not_observed: "확인 범위에서 미관측",
  source_incomplete: "원문 확보 부족",
  comparison_insufficient: "비교 대상 부족",
  pending: "분석 대기",
  failed: "분석 실패",
};
const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const SERVER_REJECTION_COPY: Record<string, string> = {
  invalid_article_rows: "비교 기사 구조를 확인할 수 없음",
  invalid_observation_contract: "관측 항목·상태 계약 불일치",
  invalid_importance: "차이의 중요도와 이유를 확인할 수 없음",
  missing_comparison_explanation: "기사별 설명·공통점·차이·해석 범위가 부족함",
  article_analysis_unavailable: "기사 분석이 대기·실패·충돌·검토 필요 상태임",
  article_body_generation_mismatch: "비교한 원문과 저장 프로필의 본문 해시 불일치",
  article_prompt_generation_mismatch: "비교한 기사 분석 프롬프트 버전 불일치",
  article_identity_schema_mismatch: "기사 ID 또는 기사 분석 스키마 불일치",
  incomplete_body_cannot_support_absence: "확인한 본문이 불완전하여 부재 판단 불가",
  article_outlet_mismatch: "기사 ID와 실제 발행 매체명이 일치하지 않음",
  missing_independent_article_explanation: "기사별 독립 설명 또는 확인 범위가 부족함",
  invalid_voice: "발화 주체를 확인할 수 없음",
  missing_article_evidence: "기사별 근거 위치가 없음",
  invalid_evidence: "근거 식별 정보 구조 불일치",
  unbound_article_evidence: "기사 ID·문장 위치·해시 연결 불일치",
  evidence_voice_mismatch: "취재원 발언과 기자 서술의 구분 불일치",
  title_evidence_mismatch: "제목 내용·기사 ID·제목 해시 연결 불일치",
};
export function fineComparison(bundle: IssueAnalysisBundle) {
  const raw = bundle.comparison?.data?.fine_grained as FineComparison | undefined;
  const valid: FineObservation[] = [];
  const rejected: Array<{ headline: string; reason: string }> = [];
  if (!raw) return { observations: valid, rejected, pending: true, producer: null };
  if (!Array.isArray(raw.observations)) return { observations: valid, rejected: [{ headline: "세밀한 관측", reason: "관측 목록 형식 불일치" }], pending: false, producer: raw.producer };
  if (raw.version !== FINE_VERSION || !raw.run_id || raw.run_id !== bundle.lineage?.runId) return { observations: valid, rejected: [{ headline: "세밀한 관측", reason: "분석 계약 버전 또는 실행 ID 불일치" }], pending: false, producer: raw.producer };
  if (Array.isArray(raw.rejected)) for (const row of raw.rejected) {
    if (!row || !nonempty(row.reason)) continue;
    rejected.push({ headline: nonempty(row.headline) ? row.headline.slice(0, 100) : "세밀한 관측", reason: SERVER_REJECTION_COPY[row.reason] ?? "서버의 근거 검증을 통과하지 못함" });
  }
  for (const observation of raw.observations ?? []) {
    if (!observation || !Array.isArray(observation.articles) || observation.articles.some((row) => !row || typeof row !== "object") || !observation.importance || typeof observation.headline !== "string") {
      rejected.push({ headline: "세밀한 관측", reason: "관측 구조 불일치" });
      continue;
    }
    let reason: string | null = null;
    if (!observation.observation_id || !OBSERVATION_AXES.includes(observation.axis) || !Object.hasOwn(FINE_STATUS_LABEL, observation.status)) reason = "관측 계약 불일치";
    const observed = ["verified_detail", "expression_only"].includes(observation.status);
    if (!["low", "medium", "high"].includes(observation.importance.level)) reason = "중요도 계약 불일치";
    if (observed && (new Set(observation.articles.map((row) => row.article_id)).size < 2 || ![observation.common, observation.difference, observation.importance.reason, observation.interpretation, observation.limitations].every(nonempty))) reason = "독립 기사 설명·차이·해석 범위가 부족함";
    const descriptions = new Set<string>();
    for (const row of observation.articles ?? []) {
      const article = bundle.articles.find((item) => item.articleId === row.article_id);
      const entry = bundle.semanticProfiles.find((item) => item.articleId === row.article_id);
      reason ??= articleIntegrityReason(bundle, row.article_id);
      if (!article || row.outlet !== article.outlet) reason ??= "기사 ID와 발행 매체명이 일치하지 않음";
      if (!nonempty(row.description) || !nonempty(row.scope) || descriptions.has(row.description.trim())) reason ??= "기사별 독립 설명 또는 확인 범위가 없음";
      if (nonempty(row.description)) descriptions.add(row.description.trim());
      if (row.title_basis) {
        if (observation.axis !== "title_lead" || row.voice !== "title_selection" || row.title_basis.title !== article?.title || row.title_basis.title_sha256 !== entry?.profile?.article?.title_sha256) reason ??= "제목 근거와 원본 메타데이터 불일치";
      } else if (!["journalist_narration", "direct_quote", "indirect_source", "uncertain_quote"].includes(row.voice) || !Array.isArray(row.evidence) || !row.evidence.length || row.evidence.some((ref) => !ref || ref.article_id !== row.article_id || !evidenceIntegrityValid(bundle, ref, row.voice))) reason ??= "문장 근거·발화 주체 연결 불일치";
      if (observation.status === "not_observed" && entry?.profile?.extraction?.input_truncated) reason ??= "불완전한 본문으로 부재 판단 불가";
    }
    if (reason) rejected.push({ headline: observation.headline, reason }); else valid.push(observation);
  }
  return { observations: valid, rejected, pending: false, producer: raw.producer };
}
