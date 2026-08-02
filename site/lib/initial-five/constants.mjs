export const INITIAL_FIVE_SCHEMA_VERSION = "agendaframe.initial-five.public.v1";

export const ANALYSIS_STATES = Object.freeze([
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "review_needed",
  "dead_letter",
]);

export const FIXED_EVENT_TITLES = Object.freeze({
  "bigkinds-2026-07-26-top-1": "정점식 의원의 특검 보완수사권 주장",
  "bigkinds-2026-07-26-top-2": "권영진 의원의 정점식 의원 멱살 논란",
  "bigkinds-2026-07-26-top-3": "경산 아파트 방화·보복범죄 수사",
  "bigkinds-2026-07-26-top-4": "권경애 재판 불출석 손해배상 조정",
  "bigkinds-2026-07-26-top-5": "음성 외국인 집단 난투 사건",
});

export const RULE_ENGINE_LABEL = "rules_local";
export const AI_ENGINE_LABEL = "ai_semantic";
export const UNAVAILABLE_ENGINE_LABEL = "unavailable";

export const SEMANTIC_DIMENSIONS = Object.freeze([
  "problem_definition",
  "causal_interpretation",
  "responsibility_attribution",
  "moral_evaluation",
  "treatment_recommendation",
]);

export function isAnalysisState(value) {
  return ANALYSIS_STATES.includes(value);
}

export function assertAnalysisState(value, label = "analysis state") {
  if (!isAnalysisState(value)) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return value;
}

export function fixedEventTitle(issueId, fallback = issueId) {
  return FIXED_EVENT_TITLES[issueId] ?? fallback;
}
