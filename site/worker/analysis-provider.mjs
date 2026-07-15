import { ANALYSIS_MODEL_VERSION, ANALYSIS_PROVIDER, analyzeArticles } from "./analysis.mjs";

/**
 * @typedef {Object} AnalysisProvider
 * @property {string} provider
 * @property {string} modelVersion
 * @property {(articles: Array<Record<string, unknown>>, options?: { configuredSourceCount?: number, maxIssues?: number }) => Array<Record<string, unknown>>} analyze
 */

/** @type {AnalysisProvider} */
export const ruleAnalysisProvider = Object.freeze({
  provider: ANALYSIS_PROVIDER,
  modelVersion: ANALYSIS_MODEL_VERSION,
  analyze: analyzeArticles,
});

const providers = new Map([[ruleAnalysisProvider.provider, ruleAnalysisProvider]]);

export function getAnalysisProvider(provider = ANALYSIS_PROVIDER) {
  const selected = providers.get(provider);
  if (!selected) throw new Error(`지원하지 않는 분석 공급자입니다: ${provider}`);
  return selected;
}
