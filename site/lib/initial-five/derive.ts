// 공개 아티팩트 → 화면이 바로 쓸 수 있는 뷰 모델.
//
// 화면 컴포넌트가 JSON 구조를 직접 헤집지 않게 여기서 한 번만 정리한다. 모든 값은
// 빌드 시점에 계산되고(공개 아티팩트가 정적 import 이므로), 원문 문장은 어디에도
// 담지 않는다 — 의역·건수·근거 위치만 지난다.

import { getInitialFiveIssueBundle, initialFiveManifest } from "./artifacts";
import type { IssueAnalysisBundle } from "./types";

export const DIM_ORDER = [
  "problem_definition",
  "causal_interpretation",
  "responsibility_attribution",
  "moral_evaluation",
  "treatment_recommendation",
] as const;

export const DIM_LABEL: Record<string, string> = {
  problem_definition: "문제 정의",
  causal_interpretation: "원인 해석",
  responsibility_attribution: "책임 귀속",
  moral_evaluation: "규범적 평가",
  treatment_recommendation: "해법·처방",
};

export const DIM_QUESTION: Record<string, string> = {
  problem_definition: "무엇이 문제인가",
  causal_interpretation: "왜 그렇게 됐는가",
  responsibility_attribution: "누구의 책임인가",
  moral_evaluation: "옳고 그름을 어떻게 봤는가",
  treatment_recommendation: "무엇을 해야 하는가",
};

export const VOICE_LABEL: Record<string, string> = {
  direct_quote: "직접 인용",
  indirect_source: "간접 전언",
  journalist_narration: "기자 서술",
  uncertain_quote: "불확실 인용",
};

export const STATUS_LABEL: Record<string, string> = {
  source_attributed: "취재원 발언",
  observed: "매체 서술",
  not_observed: "미관측",
};

export const FAMILY_LABEL: Record<string, string> = {
  investigation_accountability: "수사·책임 규명",
  legitimacy_negative: "정당성 훼손",
  individual_action: "개인 행위",
  individual_actor: "개인 책임",
  political_conflict: "정치적 갈등",
  shared_responsibility: "공동 책임",
  political_incentive: "정치적 이해",
  institutional_check: "제도적 견제",
  legal_institutional: "법·제도",
  safety_harm: "안전·피해",
  safety_negative: "안전 실패",
  fairness_negative: "공정성 훼손",
};

export const familyLabel = (code?: string) => (code ? FAMILY_LABEL[code] ?? code : "미상");

type Counter = Array<{ key: string; label: string; count: number }>;

function tally(source: Iterable<string | undefined>, labels: Record<string, string>): Counter {
  const map = new Map<string, number>();
  for (const raw of source) {
    if (!raw) continue;
    map.set(raw, (map.get(raw) ?? 0) + 1);
  }
  return [...map]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, label: labels[key] ?? key, count }));
}

// ── 기사 단위 ──────────────────────────────────────────────────────────────

export interface ArticleView {
  articleId: string;
  title: string;
  outlet: string;
  section: string | null;
  publishedAt: string | null;
  url: string | null;
  evidenceCount: number;
  /** 차원별 지배 프레임 계열 (없으면 undefined) */
  families: Record<string, string | undefined>;
  /** 차원별 관측 상태 */
  statuses: Record<string, string | undefined>;
  voices: Counter;
  roles: Counter;
  directQuotes: number;
  indirectQuotes: number;
}

function articleViews(bundle: IssueAnalysisBundle): ArticleView[] {
  const byId = new Map(bundle.semanticProfiles.map((entry) => [entry.articleId, entry]));
  return bundle.articles.map((article) => {
    const entry = byId.get(article.articleId);
    const profile = entry?.profile ?? null;
    const dims = profile?.dimensions ?? {};
    const families: Record<string, string | undefined> = {};
    const statuses: Record<string, string | undefined> = {};
    const voiceKinds: Array<string | undefined> = [];
    for (const dim of DIM_ORDER) {
      const node = dims[dim];
      statuses[dim] = node?.status;
      families[dim] = node?.items?.[0]?.frame_family;
      for (const item of node?.items ?? []) voiceKinds.push(item.voice?.kind);
    }
    const actors = profile?.actors_and_sources ?? [];
    return {
      articleId: article.articleId,
      title: article.title ?? "제목 없음",
      outlet: article.outlet ?? "미상",
      section: article.section,
      publishedAt: article.publishedAt,
      url: article.canonicalUrl,
      evidenceCount: entry?.engine.evidenceCount ?? 0,
      families,
      statuses,
      voices: tally(voiceKinds, VOICE_LABEL),
      roles: tally(actors.map((a) => a.role_label ?? a.role), {}),
      directQuotes: actors.reduce((sum, a) => sum + (a.direct_quote_count ?? 0), 0),
      indirectQuotes: actors.reduce((sum, a) => sum + (a.indirect_attribution_count ?? 0), 0),
    };
  });
}

// ── 매체 단위 ──────────────────────────────────────────────────────────────

export interface OutletView {
  outlet: string;
  articles: ArticleView[];
  articleCount: number;
  /** 차원별로 이 매체가 쓴 프레임 계열 (중복 제거) */
  families: Record<string, string[]>;
  roles: Counter;
  voices: Counter;
  directQuotes: number;
  indirectQuotes: number;
  sourceCount: number;
}

function outletViews(articles: ArticleView[], bundle: IssueAnalysisBundle): OutletView[] {
  const lens = new Map<string, Counter>();
  for (const row of bundle.comparison.data.source_lens?.by_outlet ?? []) {
    lens.set(
      row.outlet,
      (row.roles ?? []).map((r) => ({ key: r.role ?? "other", label: r.role_label ?? r.role ?? "기타", count: r.count })),
    );
  }
  const groups = new Map<string, ArticleView[]>();
  for (const article of articles) {
    const list = groups.get(article.outlet) ?? [];
    list.push(article);
    groups.set(article.outlet, list);
  }
  return [...groups]
    .map(([outlet, list]) => {
      const families: Record<string, string[]> = {};
      for (const dim of DIM_ORDER) {
        families[dim] = [...new Set(list.map((a) => a.families[dim]).filter(Boolean) as string[])];
      }
      const roles = lens.get(outlet) ?? tally(list.flatMap((a) => a.roles.map((r) => r.key)), {});
      return {
        outlet,
        articles: list,
        articleCount: list.length,
        families,
        roles: roles.slice().sort((a, b) => b.count - a.count),
        voices: tally(list.flatMap((a) => a.voices.flatMap((v) => Array(v.count).fill(v.key) as string[])), VOICE_LABEL),
        directQuotes: list.reduce((s, a) => s + a.directQuotes, 0),
        indirectQuotes: list.reduce((s, a) => s + a.indirectQuotes, 0),
        sourceCount: roles.reduce((s, r) => s + r.count, 0),
      };
    })
    .sort((a, b) => b.articleCount - a.articleCount || a.outlet.localeCompare(b.outlet));
}

// ── 쟁점 축 (수평 수직선) ───────────────────────────────────────────────────

export interface SpectrumPole {
  label: string;
  articleCount: number;
  outlets: string[];
}

export interface SpectrumView {
  dimension: string;
  question: string;
  left: SpectrumPole;
  right: SpectrumPole;
  /** 0(왼쪽 극) ~ 1(오른쪽 극) */
  marks: Array<{ outlet: string; position: number; articleCount: number; both: boolean }>;
  unobserved: string[];
  patternCount: number;
}

function spectrum(bundle: IssueAnalysisBundle, articles: ArticleView[], dimension: string): SpectrumView | null {
  const axis = (bundle.comparison.data.comparison_axes ?? []).find((a) => a.dimension === dimension);
  const patterns = (axis?.patterns ?? []).filter((p) => (p.article_ids ?? []).length > 0);
  if (patterns.length < 2) return null;
  const outletOf = new Map(articles.map((a) => [a.articleId, a.outlet]));
  const ranked = patterns.slice().sort((a, b) => (b.article_count ?? 0) - (a.article_count ?? 0));
  const [a, b] = ranked;
  const side = (p: typeof a) => [...new Set((p.article_ids ?? []).map((id) => outletOf.get(id)).filter(Boolean) as string[])];
  const leftOutlets = side(a);
  const rightOutlets = side(b);
  const marks: SpectrumView["marks"] = [];
  for (const outlet of new Set([...leftOutlets, ...rightOutlets])) {
    const inLeft = leftOutlets.includes(outlet);
    const inRight = rightOutlets.includes(outlet);
    marks.push({
      outlet,
      position: inLeft && inRight ? 0.5 : inLeft ? 0.12 : 0.88,
      articleCount: articles.filter((x) => x.outlet === outlet).length,
      both: inLeft && inRight,
    });
  }
  const covered = new Set(marks.map((m) => m.outlet));
  return {
    dimension,
    question: DIM_QUESTION[dimension] ?? DIM_LABEL[dimension] ?? dimension,
    left: { label: a.public_paraphrase ?? "설명 A", articleCount: a.article_count ?? 0, outlets: leftOutlets },
    right: { label: b.public_paraphrase ?? "설명 B", articleCount: b.article_count ?? 0, outlets: rightOutlets },
    marks: marks.sort((x, y) => x.position - y.position || x.outlet.localeCompare(y.outlet)),
    unobserved: [...new Set(articles.map((x) => x.outlet))].filter((o) => !covered.has(o)),
    patternCount: patterns.length,
  };
}

// ── 의제 단위 ──────────────────────────────────────────────────────────────

export interface AxisView {
  dimension: string;
  label: string;
  question: string;
  observed: number;
  notObserved: number;
  patterns: Array<{ label: string; articleCount: number; outlets: string[]; voiceScope: string | null }>;
}

export interface IssueView {
  issueId: string;
  rank: number;
  title: string;
  category: string | null;
  articleCount: number;
  outletCount: number;
  /** 한 줄 정의 — 무슨 일이 있었나 */
  lead: string | null;
  commonGround: string | null;
  mainDifference: string | null;
  sourceContext: string | null;
  commonSubjects: string[];
  clusters: Array<{ label: string; description: string; articleCount: number; outlets: string[] }>;
  articles: ArticleView[];
  outlets: OutletView[];
  axes: AxisView[];
  spectrum: SpectrumView | null;
  /** 다섯 층위 각각의 쟁점 축. 패턴이 하나뿐이면 축이 서지 않으므로 빠진다. */
  spectra: SpectrumView[];
  voices: Counter;
  families: Counter;
  policyFrames: Counter;
  genericFrames: Counter;
  statuses: Counter;
  sourceCaution: string | null;
  notObservedStatements: string[];
  /** 매체 간 값이 갈린 차원 수 */
  splitDimensions: number;
  sections: Counter;
  evidenceTotal: number;
  succeeded: number;
}

interface SecondaryDescriptors {
  generic_frames?: Array<{ code?: string; label?: string; article_count?: number }>;
  policy_frames?: Array<{ code?: string; label?: string; article_count?: number }>;
}

function descriptorCounter(list?: Array<{ code?: string; label?: string; article_count?: number }>): Counter {
  return (list ?? [])
    .map((row) => ({ key: row.code ?? "", label: row.label ?? row.code ?? "미상", count: row.article_count ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function deriveIssue(bundle: IssueAnalysisBundle): IssueView {
  const articles = articleViews(bundle);
  const outlets = outletViews(articles, bundle);
  const data = bundle.comparison.data;
  const brief = data.summary_30_seconds ?? {};
  const secondary = (data.secondary_descriptors ?? {}) as SecondaryDescriptors;
  const outletOf = new Map(articles.map((a) => [a.articleId, a.outlet]));

  const axes: AxisView[] = (data.comparison_axes ?? []).map((axis) => ({
    dimension: axis.dimension ?? "",
    label: axis.label ?? DIM_LABEL[axis.dimension ?? ""] ?? "축",
    question: DIM_QUESTION[axis.dimension ?? ""] ?? "",
    observed: axis.observed_article_count ?? 0,
    notObserved: axis.not_observed_article_count ?? 0,
    patterns: (axis.patterns ?? []).map((p) => ({
      label: p.public_paraphrase ?? "패턴",
      articleCount: p.article_count ?? 0,
      outlets: [...new Set((p.article_ids ?? []).map((id) => outletOf.get(id)).filter(Boolean) as string[])],
      voiceScope: p.voice_scope ?? null,
    })),
  }));

  const spectra = DIM_ORDER.map((dim) => spectrum(bundle, articles, dim)).filter(Boolean) as SpectrumView[];

  let splitDimensions = 0;
  for (const dim of DIM_ORDER) {
    const seen = new Set(outlets.map((o) => o.families[dim]?.[0]).filter(Boolean));
    if (seen.size >= 2) splitDimensions += 1;
  }

  return {
    issueId: bundle.issue.issueId,
    rank: bundle.issue.rank,
    title: bundle.issue.title,
    category: bundle.issue.category,
    articleCount: bundle.issue.articleCount,
    outletCount: bundle.issue.outletCount,
    lead: bundle.clusterAi.summary ?? null,
    commonGround: brief.common_ground ?? null,
    mainDifference: brief.main_difference ?? null,
    sourceContext: brief.source_context ?? null,
    commonSubjects: bundle.clusterAi.commonSubjects ?? [],
    clusters: (bundle.clusterAi.narrativeVariants ?? []).map((variant) => ({
      label: variant.label ?? "서사",
      description: variant.description ?? "",
      articleCount: (variant.article_ids ?? []).length,
      outlets: [...new Set((variant.article_ids ?? []).map((id) => outletOf.get(id)).filter(Boolean) as string[])],
    })),
    articles,
    outlets,
    axes,
    spectrum: spectra.find((s) => s.dimension === "problem_definition") ?? spectra[0] ?? null,
    spectra,
    voices: tally(articles.flatMap((a) => a.voices.flatMap((v) => Array(v.count).fill(v.key) as string[])), VOICE_LABEL),
    families: tally(articles.flatMap((a) => DIM_ORDER.map((d) => a.families[d])), FAMILY_LABEL),
    policyFrames: descriptorCounter(secondary.policy_frames),
    genericFrames: descriptorCounter(secondary.generic_frames),
    statuses: tally(articles.flatMap((a) => DIM_ORDER.map((d) => a.statuses[d])), STATUS_LABEL),
    sourceCaution: data.source_lens?.caution ?? null,
    notObservedStatements: data.not_observed_statements ?? [],
    splitDimensions,
    sections: tally(articles.map((a) => a.section ?? undefined), {}),
    evidenceTotal: articles.reduce((s, a) => s + a.evidenceCount, 0),
    succeeded: bundle.analysisStatus.semantic.succeededArticleCount,
  };
}

// ── 하루 단위 (홈) ─────────────────────────────────────────────────────────

export interface LayerPower {
  key: string;
  label: string;
  /** 매체 간 값이 갈린 의제 수 (0~5) */
  split: number;
  total: number;
  note: string;
}

export interface DayView {
  basisDate: string;
  issueCount: number;
  articleCount: number;
  outletCount: number;
  generatedAt: string | null;
  issues: IssueView[];
  categories: Counter;
  outlets: Array<{ outlet: string; articleCount: number; issueCount: number }>;
  voices: Counter;
  statuses: Counter;
  families: Counter;
  layers: LayerPower[];
  /** 의제별 매체 확산도 = 매체 수 / 기사 수 */
  spread: Array<{ rank: number; title: string; issueId: string; outletCount: number; articleCount: number; ratio: number }>;
  evidenceTotal: number;
  sourceRoles: Counter;
}

export function deriveDay(): DayView {
  const issues = initialFiveManifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((meta) => {
      const bundle = getInitialFiveIssueBundle(meta.issueId);
      if (!bundle) throw new Error(`Missing bundle for ${meta.issueId}`);
      return deriveIssue(bundle);
    });

  const outletMap = new Map<string, { articleCount: number; issues: Set<string> }>();
  for (const issue of issues) {
    for (const article of issue.articles) {
      const slot = outletMap.get(article.outlet) ?? { articleCount: 0, issues: new Set<string>() };
      slot.articleCount += 1;
      slot.issues.add(issue.issueId);
      outletMap.set(article.outlet, slot);
    }
  }

  // 층위별 변별력 — 각 층위가 5개 의제 중 몇 개에서 매체를 갈랐는가.
  // "갈랐다" = 그 층위에서 매체별 대표값이 2종 이상 관측됐다.
  const layerDefs: Array<{ key: string; label: string; note: string; pick: (issue: IssueView) => Set<string> }> = [
    ...DIM_ORDER.map((dim) => ({
      key: dim,
      label: DIM_LABEL[dim],
      note: DIM_QUESTION[dim],
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.families[dim]?.[0]).filter(Boolean) as string[]),
    })),
    {
      key: "source_roles",
      label: "취재원 구성",
      note: "누구를 인용했는가",
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.roles[0]?.label).filter(Boolean) as string[]),
    },
    {
      key: "voice_mix",
      label: "인용 방식",
      note: "직접 인용인가 기자 서술인가",
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.voices[0]?.key).filter(Boolean) as string[]),
    },
  ];

  const layers: LayerPower[] = layerDefs
    .map((def) => ({
      key: def.key,
      label: def.label,
      note: def.note,
      total: issues.length,
      split: issues.filter((issue) => def.pick(issue).size >= 2).length,
    }))
    .sort((a, b) => b.split - a.split || a.label.localeCompare(b.label));

  const merge = (lists: Counter[]): Counter => {
    const map = new Map<string, { label: string; count: number }>();
    for (const list of lists)
      for (const row of list) {
        const slot = map.get(row.key) ?? { label: row.label, count: 0 };
        slot.count += row.count;
        map.set(row.key, slot);
      }
    return [...map].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
  };

  return {
    basisDate: initialFiveManifest.basisDate,
    issueCount: initialFiveManifest.issueCount,
    articleCount: initialFiveManifest.articleCount,
    outletCount: outletMap.size,
    generatedAt: initialFiveManifest.generatedAt,
    issues,
    categories: tally(issues.flatMap((i) => Array(i.articleCount).fill(i.category ?? "미분류") as string[]), {}),
    outlets: [...outletMap]
      .map(([outlet, v]) => ({ outlet, articleCount: v.articleCount, issueCount: v.issues.size }))
      .sort((a, b) => b.articleCount - a.articleCount || a.outlet.localeCompare(b.outlet)),
    voices: merge(issues.map((i) => i.voices)),
    statuses: merge(issues.map((i) => i.statuses)),
    families: merge(issues.map((i) => i.families)),
    layers,
    spread: issues.map((i) => ({
      rank: i.rank,
      title: i.title,
      issueId: i.issueId,
      outletCount: i.outletCount,
      articleCount: i.articleCount,
      ratio: i.articleCount ? i.outletCount / i.articleCount : 0,
    })),
    evidenceTotal: issues.reduce((s, i) => s + i.evidenceTotal, 0),
    sourceRoles: merge(issues.map((i) => merge(i.outlets.map((o) => o.roles)))),
  };
}
