export type AnalysisState =
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "review_needed"
  | "dead_letter";

export type EngineLabel = "ai_semantic" | "rules_local" | "unavailable";

export interface PublicEngine {
  label?: EngineLabel;
  engineLabel: EngineLabel;
  semanticAi: boolean;
  status: AnalysisState;
  model: string | null;
  promptVersion: string | null;
  schemaVersion: string | number | null;
  source?: string;
}

export interface InitialFiveManifestIssue {
  issueId: string;
  rank: number;
  title: string;
  category: string | null;
  articleCount: number;
  outletCount: number;
  agendaScore?: number | null;
  scoreBreakdown?: Record<string, unknown> | null;
  rankScoreVersion?: string | null;
  status: AnalysisState;
  payloadKey: string;
  clusterAi: {
    status: AnalysisState;
    engineLabel: EngineLabel;
    semanticAi: boolean;
    model: string | null;
    promptVersion: string | null;
    schemaVersion: string | number | null;
  };
  semantic: {
    status: AnalysisState;
    engineLabel: EngineLabel;
    semanticAi: boolean;
    model: string | null;
    promptVersion: string | null;
    schemaVersion: string | number | null;
    succeededArticleCount: number;
    reviewNeededArticleCount: number;
  };
}

export interface InitialFiveManifest {
  schemaVersion: string;
  basisDate: string;
  generatedAt: string | null;
  issueCount: number;
  articleCount: number;
  issues: InitialFiveManifestIssue[];
  coderAgreement: { method: CoderAgreementMethod; summary: CoderAgreementSummary } | null;
  lineage: {
    top5SchemaVersion: string | null;
    metadataSchemaVersion: string | null;
    metadataGeneratedAt: string | null;
    coderAgreementSchemaVersion?: string | null;
  };
}

/** 판정 전 두 코더의 계열 일치. 내용분석 신뢰도 공개용. */
export interface CoderAgreementMethod {
  schemaVersion: string | null;
  design: string | null;
  coderCount: number | null;
  coderKind: string | null;
  coderNote: string | null;
  coderLimit: string | null;
  measuredOn: string | null;
  adjudication: string | null;
  statistic: string | null;
  dimensions: string[];
}

export interface CoderAgreementSummary {
  articleCount: number | null;
  validProfileCount: number | null;
  failureCount: number | null;
  meanDimensionAgreement: number | null;
  perDimensionAgreement: Record<string, number | null>;
  dominantPolicyFrameAgreement: number | null;
  scopeAgreement: number | null;
}

export interface IssueCoderAgreement {
  method: CoderAgreementMethod;
  articleCount: number;
  dimensionCount: number;
  meanDimensionAgreement: number | null;
  perDimensionAgreement: Record<string, number | null>;
  fullAgreementArticleCount: number;
  articles: Array<{
    articleId: string;
    agreedDimensions: number | null;
    perDimension: Record<string, boolean>;
    policyFrameAgree: boolean | null;
    scopeAgree: boolean | null;
  }>;
}

export interface PublicEvidence {
  articleId?: string;
  sourceId?: string;
  locator?: {
    paragraph?: number;
    sentence?: number;
  };
  sentenceSha256?: string;
}

export interface SemanticEvidenceSource {
  locator?: {
    paragraph?: number;
    sentence?: number;
  };
  sentence_sha256?: string;
}

export interface SemanticDimensionItem {
  claim_id?: string;
  variant_key?: string;
  public_paraphrase?: string;
  frame_family?: string;
  voice?: {
    kind?: string;
    speaker_role?: string | null | Record<string, unknown>;
  };
  evidence?: SemanticEvidenceSource;
}

export interface SemanticDimension {
  status?: string;
  model_status?: string;
  outlet_narration_observed?: boolean;
  items?: SemanticDimensionItem[];
}

export interface SemanticPublicProfile {
  article?: {
    article_id?: string;
    body_sha256?: string;
    published_at?: string;
  };
  engine?: {
    semantic_ai?: boolean;
    version?: string;
    prompt_version?: string;
    analysis_schema_version?: number;
    status?: string;
  };
  dimensions?: Record<string, SemanticDimension>;
  actors_and_sources?: Array<{
    actor_id?: string;
    role?: string;
    role_label?: string;
    direct_quote_count?: number;
    indirect_attribution_count?: number;
    evidence?: SemanticEvidenceSource[];
  }>;
  genre?: {
    code?: string;
    label?: string;
    evidence?: SemanticEvidenceSource[];
    reason?: string;
  };
  scope?: {
    code?: string;
    label?: string;
    level?: string;
    evidence?: SemanticEvidenceSource[];
    caution?: string;
    reason?: string;
  };
  context_depth?: {
    code?: string;
    level?: string;
    label?: string;
    evidence?: SemanticEvidenceSource[];
    caution?: string;
    reason?: string;
  };
  secondary_descriptors?: {
    generic_frames?: Array<{ code?: string; label?: string; evidence?: SemanticEvidenceSource[] }>;
    policy_frames?: Array<{ code?: string; label?: string; evidence?: SemanticEvidenceSource[] }>;
    controlled_associations?: Array<{ code?: string; label?: string; evidence?: SemanticEvidenceSource[] }>;
  };
  framing_devices?: Array<{
    code?: string;
    label?: string;
    count?: number;
    appears_in_lead?: boolean;
    evidence?: SemanticEvidenceSource[];
  }>;
  review?: {
    analysis_decision?: string;
    fallback_reason?: string | null;
    requires_human_review?: boolean;
    status?: string;
  };
  extraction?: {
    text_scope?: string;
    analyzed_character_count?: number;
    input_truncated?: boolean;
  };
  lineage?: Record<string, unknown>;
}

export interface SemanticProfileEntry {
  articleId: string;
  status: AnalysisState;
  engine: PublicEngine & {
    articleId: string;
    evidenceCount: number;
    bodySha256: string | null;
    reviewRequired: boolean;
    fallbackReason: string | null;
  };
  evidence: PublicEvidence[];
  profile: SemanticPublicProfile | null;
}

export interface RuleProfileEntry {
  articleId: string;
  status: AnalysisState;
  engine: PublicEngine & {
    articleId: string;
    evidenceCount: number;
    bodySha256: string | null;
  };
  evidence: PublicEvidence[];
  profile: Record<string, unknown> | null;
}

export interface InitialFiveArticle {
  articleId: string;
  id: string;
  title: string | null;
  titleSource?: string | null;
  outlet: string | null;
  sourceId: string | null;
  mediaGroupId: string | null;
  publishedAt: string | null;
  section: string | null;
  canonicalUrl: string | null;
  bodySha256: string | null;
  issueId: string;
}

export interface RuleComparisonAxis {
  dimension?: string;
  label?: string;
  observed_article_count?: number;
  not_observed_article_count?: number;
  patterns?: Array<{
    public_paraphrase?: string;
    article_count?: number;
    voice_scope?: string;
    article_ids?: string[];
    evidence?: Array<{
      article_id?: string;
      source_id?: string;
      locator?: { paragraph?: number; sentence?: number };
      sentence_sha256?: string;
    }>;
  }>;
}

export interface RuleComparisonData {
  summary_30_seconds?: {
    sample?: string;
    common_ground?: string;
    main_difference?: string;
    source_context?: string;
    limit?: string;
  };
  comparison_axes?: RuleComparisonAxis[];
  source_lens?: {
    by_outlet?: Array<{
      outlet: string;
      roles: Array<{ role?: string; role_label?: string; count: number }>;
    }>;
    caution?: string;
  };
  not_observed_statements?: string[];
  synthesis?: EventSynthesisData;
  [key: string]: unknown;
}

export interface EventSynthesisEvidence {
  article_id?: string;
  locator?: { paragraph?: number; sentence?: number };
  sentence_sha256?: string;
}

export interface EventSynthesisClaim {
  text?: string | null;
  status?: string;
  evidence?: EventSynthesisEvidence[];
  reason?: string;
}

export interface EventSynthesisCamp {
  name?: string;
  gist?: string;
  outlets?: string[];
  article_ids?: string[];
  evidence?: EventSynthesisEvidence[];
  index?: number;
}

export interface EventSynthesisRow {
  question?: string;
  common?: string | null;
  cells?: Array<string | null>;
  status?: string;
  evidence?: EventSynthesisEvidence[];
}

export interface EventSynthesisData {
  schemaVersion?: string;
  promptVersion?: string;
  usable?: boolean;
  opposition?: boolean;
  what_happened?: EventSynthesisClaim | null;
  agreed_line?: EventSynthesisClaim | null;
  split_line?: EventSynthesisClaim | null;
  so_what?: EventSynthesisClaim | null;
  camps?: EventSynthesisCamp[];
  terms?: Array<{ term?: string; gloss?: string; evidence?: EventSynthesisEvidence[] }>;
  fact_rows?: EventSynthesisRow[];
  split_rows?: EventSynthesisRow[];
  frame_functions?: Array<{
    dimension?: string;
    summary?: string | null;
    status?: string;
    evidence?: EventSynthesisEvidence[];
  }>;
  proof_rows?: Array<{
    article_id?: string;
    outlet?: string;
    dimension?: string;
    text?: string;
    evidence?: EventSynthesisEvidence[];
  }>;
}

export interface IssueAnalysisBundle {
  schemaVersion: string;
  basisDate: string;
  status: AnalysisState;
  issue: {
    issueId: string;
    rank: number;
    title: string;
    category: string | null;
    articleCount: number;
    outletCount: number;
    agendaScore?: number | null;
    scoreBreakdown?: Record<string, unknown> | null;
    rankScoreVersion?: string | null;
  };
  analysisStatus: {
    state: AnalysisState;
    cluster: PublicEngine & {
      decision?: string | null;
      coherence?: string | null;
      requiresHumanReview?: boolean;
    };
    semantic: PublicEngine & {
      articleCount: number;
      succeededArticleCount: number;
      reviewNeededArticleCount: number;
      requiresHumanReview: boolean;
    };
  };
  clusterAi: PublicEngine & {
    decision: string | null;
    coherence: string | null;
    textScope: string | null;
    fallbackReason: string | null;
    requiresHumanReview: boolean;
    summary: string | null;
    commonSubjects: string[];
    narrativeVariants: Array<{
      label?: string;
      description?: string;
      article_ids?: string[];
    }>;
    outlierArticleIds: string[];
    articleIds: string[];
  };
  articles: InitialFiveArticle[];
  semanticProfiles: SemanticProfileEntry[];
  ruleProfiles: RuleProfileEntry[];
  comparison: {
    engine: PublicEngine;
    data: RuleComparisonData;
    evidence: PublicEvidence[];
  };
  coderAgreement: IssueCoderAgreement | null;
  lineage: {
    contractVersion: string;
    basisDate: string | null;
    source: {
      top5SchemaVersion: string | null;
      top5GeneratedAt: string | null;
      metadataSchemaVersion: string | null;
      metadataGeneratedAt: string | null;
      semanticDirectory: string;
      semanticFileCount: number;
    };
    issueId: string;
  };
}
