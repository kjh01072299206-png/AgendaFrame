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

/** comparison_axes 의 voice_scope 코드. 화면에 영문 코드가 새지 않게 여기서 옮긴다. */
export const SCOPE_LABEL: Record<string, string> = {
  attributed_source: "취재원 발언 기반",
  outlet_narration: "매체 서술 기반",
  mixed: "혼합",
};

/** Iyengar 시야 */
export const SCOPE_KIND_LABEL: Record<string, string> = {
  episodic: "일화적",
  thematic: "주제적",
  mixed: "혼합",
  not_observed: "미관측",
  unknown: "미분류",
};

export const DEPTH_LABEL: Record<string, string> = {
  deep: "깊음",
  moderate: "보통",
  shallow: "얕음",
  unknown: "미분류",
};

export const GENRE_LABEL: Record<string, string> = {
  straight_news: "스트레이트",
  editorial: "사설",
  analysis: "해설·분석",
  interview: "인터뷰",
  unknown: "미분류",
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

/** 종성 유무로 조사를 고른다. 하드코딩하면 '취재원 구성가'처럼 깨진다. */
export function particle(word: string, withFinal: string, withoutFinal: string) {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return withoutFinal;
  return (code - 0xac00) % 28 === 0 ? withoutFinal : withFinal;
}

/** 잘못된 이스케이프(`/issues/%`)에서 URIError 를 던지지 않게 감싼다 — 던지면 notFound() 에 못 가고 500 이 된다. */
export function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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
  /** 차원별 지배 프레임 계열 = 그 층위 첫 항목 (없으면 undefined) */
  families: Record<string, string | undefined>;
  /** 관측된 모든 항목의 계열 — 층위별 첫 항목만 세는 families 와 분모가 다르다 */
  familyItems: string[];
  /** 차원별 관측 상태 */
  statuses: Record<string, string | undefined>;
  voices: Counter;
  roles: Counter;
  directQuotes: number;
  indirectQuotes: number;
}

function articleViews(bundle: IssueAnalysisBundle): ArticleView[] {
  const byId = new Map((bundle.semanticProfiles ?? []).map((entry) => [entry.articleId, entry]));
  return (bundle.articles ?? []).map((article) => {
    const entry = byId.get(article.articleId);
    const profile = entry?.profile ?? null;
    const dims = profile?.dimensions ?? {};
    const families: Record<string, string | undefined> = {};
    const statuses: Record<string, string | undefined> = {};
    const voiceKinds: Array<string | undefined> = [];
    const familyItems: string[] = [];
    for (const dim of DIM_ORDER) {
      const node = dims[dim];
      statuses[dim] = node?.status;
      families[dim] = node?.items?.[0]?.frame_family;
      for (const item of node?.items ?? []) {
        voiceKinds.push(item.voice?.kind);
        if (item.frame_family) familyItems.push(item.frame_family);
      }
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
      familyItems,
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
  /** 차원별 최빈 계열. 기사가 1건이면 그 값이고, 동률이면 tied 가 참이다. */
  lead: Record<string, { family?: string; tied: boolean }>;
  roles: Counter;
  voices: Counter;
  directQuotes: number;
  indirectQuotes: number;
  sourceCount: number;
}

/** 최빈 계열. 동률이면 null 을 함께 돌려 화면이 '동률'로 표시할 수 있게 한다. */
function modeFamily(values: Array<string | undefined>): { family?: string; tied: boolean } {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (!counts.size) return { tied: false };
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { family: sorted[0][0], tied: sorted.length > 1 && sorted[1][1] === sorted[0][1] };
}

function outletViews(articles: ArticleView[], bundle: IssueAnalysisBundle): OutletView[] {
  const lens = new Map<string, Counter>();
  for (const row of bundle.comparison.data.source_lens?.by_outlet ?? []) {
    lens.set(
      row.outlet,
      (row.roles ?? []).map((r) => ({ key: r.role ?? "other", label: r.role_label ?? r.role ?? "기타", count: Number(r.count) || 0 })),
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
      const lead: Record<string, { family?: string; tied: boolean }> = {};
      for (const dim of DIM_ORDER) {
        families[dim] = [...new Set(list.map((a) => a.families[dim]).filter(Boolean) as string[])];
        lead[dim] = modeFamily(list.map((a) => a.families[dim]));
      }
      const roles = lens.get(outlet) ?? tally(list.flatMap((a) => a.roles.map((r) => r.key)), {});
      return {
        outlet,
        articles: list,
        articleCount: list.length,
        families,
        lead,
        roles: roles.slice().sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
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
  /** 한쪽 극이 모든 매체를 포함한다 = 대립이 아니라 포함 관계 */
  nested: boolean;
  scopes: string[];
}

/** 규칙 기반 축의 패턴 행. code 는 타입 선언에 없어 여기서 좁힌다. */
interface RawPattern {
  code?: string;
  public_paraphrase?: string;
  article_count?: number;
  article_ids?: string[];
  voice_scope?: string;
}

function spectrum(bundle: IssueAnalysisBundle, articles: ArticleView[], dimension: string): SpectrumView | null {
  const axis = (bundle.comparison.data.comparison_axes ?? []).find((a) => a.dimension === dimension);
  const raw = ((axis?.patterns ?? []) as RawPattern[]).filter((p) => (p.article_ids ?? []).length > 0);

  // 같은 code 가 voice_scope 만 달라 여러 행으로 들어온다. 병합하지 않으면
  //  · 동일 프레임이 축의 양 끝에 놓이고,
  //  · 상위 2행만 극으로 쓰는 탓에 3번째 행의 매체가 반대편에 그려진다.
  const merged = new Map<string, { code: string; label: string; ids: Set<string>; scopes: Set<string> }>();
  for (const p of raw) {
    const code = p.code ?? p.public_paraphrase ?? "";
    const slot = merged.get(code) ?? { code, label: p.public_paraphrase ?? "설명", ids: new Set<string>(), scopes: new Set<string>() };
    for (const id of p.article_ids ?? []) slot.ids.add(id);
    if (p.voice_scope) slot.scopes.add(p.voice_scope);
    if ((p.article_count ?? 0) > 0 && slot.label.length < (p.public_paraphrase ?? "").length) slot.label = p.public_paraphrase ?? slot.label;
    merged.set(code, slot);
  }
  // code 가 한 종류면 대립이 아니라 공통점이다 — 축을 세우지 않는다.
  if (merged.size < 2) return null;

  const outletOf = new Map(articles.map((a) => [a.articleId, a.outlet]));
  const ranked = [...merged.values()].sort((a, b) => b.ids.size - a.ids.size);
  const [a, b] = ranked;
  const outletsOf = (ids: Set<string>) => [...new Set([...ids].map((id) => outletOf.get(id)).filter(Boolean) as string[])];
  const leftOutlets = outletsOf(a.ids);
  const rightOutlets = outletsOf(b.ids);
  const allOutlets = [...new Set(articles.map((x) => x.outlet))];

  const marks: SpectrumView["marks"] = [];
  for (const outlet of allOutlets) {
    const own = articles.filter((x) => x.outlet === outlet).map((x) => x.articleId);
    const l = own.filter((id) => a.ids.has(id)).length;
    const r = own.filter((id) => b.ids.has(id)).length;
    if (!l && !r) continue;
    marks.push({
      outlet,
      // 실제 기사 배분으로 위치를 낸다 — 고정 3지점은 없는 정도를 암시한다
      position: l + r === 0 ? 0.5 : r / (l + r),
      articleCount: l + r,
      both: l > 0 && r > 0,
    });
  }
  const covered = new Set(marks.map((m) => m.outlet));

  return {
    dimension,
    question: DIM_QUESTION[dimension] ?? DIM_LABEL[dimension] ?? dimension,
    left: { label: a.label, articleCount: a.ids.size, outlets: leftOutlets },
    right: { label: b.label, articleCount: b.ids.size, outlets: rightOutlets },
    marks: marks.sort((x, y) => x.position - y.position || x.outlet.localeCompare(y.outlet)),
    unobserved: allOutlets.filter((o) => !covered.has(o)),
    patternCount: merged.size,
    // 한쪽 극이 매체 전부를 포함하면 대립이 아니라 포함 관계다
    nested: leftOutlets.length === allOutlets.length || rightOutlets.length === allOutlets.length,
    scopes: [...new Set([...a.scopes, ...b.scopes])],
  };
}

// ── 층위 단위 ──────────────────────────────────────────────────────────────

export interface LayerItem {
  paraphrase: string;
  family?: string;
  voiceKind?: string;
  outlet: string;
  articleId: string;
  locator: string | null;
  hash: string | null;
}

export interface LayerView {
  dimension: string;
  label: string;
  question: string;
  /** status = observed. 기자가 직접 쓴 문장. */
  narrated: LayerItem[];
  /** status = source_attributed. 취재원의 말로 실린 설명 — 매체의 서술로 합산하지 않는다. */
  attributed: LayerItem[];
  /** status = not_observed 인 기사 수 */
  notObserved: number;
  /** 매체별 대표 계열 종류 수. 2 이상이면 이 층위에서 매체가 갈렸다. */
  outletKinds: number;
  /** 규칙 기반 비교축이 잡은 패턴 (매체 서술만 집계하므로 위 두 묶음과 수가 다르다) */
  patterns: AxisView["patterns"];
}

function layerViews(bundle: IssueAnalysisBundle, articles: ArticleView[], axes: AxisView[]): LayerView[] {
  const outletOf = new Map(articles.map((a) => [a.articleId, a.outlet]));
  const outletList = [...new Set(articles.map((a) => a.outlet))];

  return DIM_ORDER.map((dim) => {
    const narrated: LayerItem[] = [];
    const attributed: LayerItem[] = [];
    let notObserved = 0;
    for (const entry of bundle.semanticProfiles) {
      const node = entry.profile?.dimensions?.[dim];
      if (!node) continue;
      if (node.status === "not_observed" || !(node.items ?? []).length) {
        notObserved += 1;
        continue;
      }
      const bucket = node.status === "source_attributed" ? attributed : narrated;
      for (const item of node.items ?? []) {
        const locator = item.evidence?.locator;
        bucket.push({
          paraphrase: item.public_paraphrase ?? "",
          family: item.frame_family,
          voiceKind: item.voice?.kind,
          outlet: outletOf.get(entry.articleId) ?? "미상",
          articleId: entry.articleId,
          locator:
            locator?.paragraph !== undefined
              ? `문단 ${locator.paragraph}${locator.sentence !== undefined ? ` · 문장 ${locator.sentence}` : ""}`
              : null,
          hash: item.evidence?.sentence_sha256 ?? null,
        });
      }
    }
    const kinds = new Set(
      outletList
        .map((outlet) => modeFamily([...narrated, ...attributed].filter((i) => i.outlet === outlet).map((i) => i.family)).family)
        .filter(Boolean) as string[],
    );
    return {
      dimension: dim,
      label: DIM_LABEL[dim],
      question: DIM_QUESTION[dim],
      narrated,
      attributed,
      notObserved,
      outletKinds: kinds.size,
      patterns: axes.find((axis) => axis.dimension === dim)?.patterns ?? [],
    };
  });
}

// ── 귀납 프레임 군집 (Matthes & Kohring 2008) ───────────────────────────────
//
// 프레임을 통째로 코딩하지 않고 요소(문제·원인·책임·평가·해법)를 따로 코딩한 뒤,
// 요소 조합이 같은 기사를 묶어 프레임을 귀납적으로 도출한다. 여기서는 기사마다
// 다섯 층위의 지배 계열을 5-튜플로 만들어 그대로 묶는다 — 별도 요약 모델이 아니라
// 코딩 결과 자체에서 나온 군집이다.

export interface FrameCluster {
  key: string;
  /** 층위 → 계열 코드 (미관측이면 undefined) */
  signature: Record<string, string | undefined>;
  articleIds: string[];
  outlets: string[];
  count: number;
  /** 가장 큰 군집과 값이 다른 층위 */
  differsAt: string[];
}

function frameClusters(articles: ArticleView[]): FrameCluster[] {
  const groups = new Map<string, FrameCluster>();
  for (const article of articles) {
    const signature: Record<string, string | undefined> = {};
    for (const dim of DIM_ORDER) signature[dim] = article.families[dim];
    const key = DIM_ORDER.map((dim) => signature[dim] ?? "-").join("|");
    const slot = groups.get(key) ?? { key, signature, articleIds: [], outlets: [], count: 0, differsAt: [] };
    slot.articleIds.push(article.articleId);
    if (!slot.outlets.includes(article.outlet)) slot.outlets.push(article.outlet);
    slot.count += 1;
    groups.set(key, slot);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const base = sorted[0];
  for (const cluster of sorted) {
    cluster.differsAt = base
      ? DIM_ORDER.filter((dim) => cluster.signature[dim] !== base.signature[dim])
      : [];
  }
  return sorted;
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
  /** 5-튜플로 귀납 도출한 프레임 군집. clusters(별도 요약)와 출처가 다르다. */
  frameClusters: FrameCluster[];
  articles: ArticleView[];
  outlets: OutletView[];
  axes: AxisView[];
  layers: LayerView[];
  /** 실제로 매체가 가장 많이 갈린 층위. 없으면 null — 이때 '가장 갈린 층위'라고 말할 수 없다. */
  mostSplit: { dimension: string; kinds: number } | null;
  /** 의제 단위 비교(쟁점 축·패턴)의 엔진. 기사 단위와 다르다 — 화면에 구분해 표시한다. */
  comparisonEngine: {
    label: string | null;
    semanticAi: boolean;
    /** 아티팩트가 스스로 붙인 판정. false 면 "갈렸다"고 말할 수 없다. */
    divergenceDetected: boolean | null;
    attributedShare: number | null;
    secondaryDescriptiveOnly: boolean;
    limitNote: string | null;
    caution: string | null;
  };
  /** 표본 성질 — Iyengar 시야, 맥락 깊이, 장르, 독립 매체군 */
  sample: {
    scope: Counter;
    contextDepth: Counter;
    genres: Counter;
    independentGroupCount: number | null;
  };
  /** 분석 출처 — 모델, 발췌 길이, 검토 상태. 화면에 그대로 표시한다. */
  provenance: {
    model: string | null;
    promptVersion: string | null;
    reviewStatus: string | null;
    requiresHumanReview: boolean;
    analyzedCharacters: number | null;
    textScope: string | null;
    evidenceStorage: string | null;
    limitations: string[];
  };
  spectrum: SpectrumView | null;
  /** 다섯 층위 각각의 쟁점 축. 패턴이 하나뿐이면 축이 서지 않으므로 빠진다. */
  spectra: SpectrumView[];
  voices: Counter;
  families: Counter;
  policyFrames: Counter;
  /** 정책 프레임 전 코드가 기사 전수에 부여됐다 = 이 표본에서 변별하지 못한다 */
  policySaturated: boolean;
  genericFrames: Counter;
  statuses: Counter;
  /** 항목 전수 기준 계열 분포 — 캡션에 분모를 밝혀 families 와 섞이지 않게 한다 */
  familyItems: Counter;
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
  const brief = (data.summary_30_seconds ?? {}) as {
    common_ground?: string;
    main_difference?: string;
    source_context?: string;
    divergence_detected?: boolean;
    limit?: string;
  };
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

  const layers = layerViews(bundle, articles, axes);
  const clusters = frameClusters(articles);
  const method = (data.method ?? {}) as Record<string, unknown>;
  const dominance = (method.source_dominance_check ?? {}) as Record<string, unknown>;
  const sampleRaw = (data.sample ?? {}) as Record<string, unknown>;
  const countsOf = (obj: unknown, labels: Record<string, string>): Counter =>
    Object.entries((obj ?? {}) as Record<string, number>)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(([key, count]) => ({ key, label: labels[key] ?? key, count }))
      .sort((a, b) => b.count - a.count);
  const comparisonEngine = {
    label: (method.engine_label as string) ?? null,
    semanticAi: Boolean(method.semantic_ai),
    divergenceDetected: typeof brief.divergence_detected === "boolean" ? brief.divergence_detected : null,
    attributedShare: typeof dominance.attributed_share === "number" ? dominance.attributed_share : null,
    secondaryDescriptiveOnly: Boolean(method.secondary_taxonomies_are_descriptive_only),
    limitNote: brief.limit ?? null,
    caution: (method.caution as string) ?? null,
  };
  const sample = {
    scope: countsOf(sampleRaw.scope, SCOPE_KIND_LABEL),
    contextDepth: countsOf(sampleRaw.context_depth, DEPTH_LABEL),
    genres: countsOf(sampleRaw.genres, GENRE_LABEL),
    independentGroupCount:
      typeof sampleRaw.independent_media_group_count === "number" ? sampleRaw.independent_media_group_count : null,
  };
  const firstProfile = bundle.semanticProfiles[0]?.profile ?? null;
  const engine = (firstProfile?.engine ?? {}) as Record<string, unknown>;
  const provenance = {
    model: bundle.analysisStatus.semantic.model ?? (engine.version as string) ?? null,
    promptVersion: bundle.analysisStatus.semantic.promptVersion ?? null,
    reviewStatus: firstProfile?.review?.status ?? null,
    requiresHumanReview: Boolean(firstProfile?.review?.requires_human_review),
    analyzedCharacters: firstProfile?.extraction?.analyzed_character_count ?? null,
    textScope: firstProfile?.extraction?.text_scope ?? null,
    evidenceStorage: (engine.evidence_storage as string) ?? null,
    limitations: Array.isArray(engine.limitations) ? (engine.limitations as string[]) : [],
  };

  const spectra = DIM_ORDER.map((dim) => spectrum(bundle, articles, dim)).filter(Boolean) as SpectrumView[];
  const kindsPerDim = DIM_ORDER.map((dim) => ({
    dimension: dim,
    kinds: new Set(outlets.map((o) => o.lead[dim]?.family).filter(Boolean)).size,
  })).sort((a, b) => b.kinds - a.kinds);
  const mostSplit = kindsPerDim[0]?.kinds >= 2 ? kindsPerDim[0] : null;

  let splitDimensions = 0;
  for (const dim of DIM_ORDER) {
    const seen = new Set(outlets.map((o) => o.lead[dim]?.family).filter(Boolean));
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
    frameClusters: clusters,
    axes,
    layers,
    mostSplit,
    comparisonEngine,
    sample,
    provenance,
    spectrum: spectra.find((s) => s.dimension === "problem_definition") ?? spectra[0] ?? null,
    spectra,
    voices: tally(articles.flatMap((a) => a.voices.flatMap((v) => Array(v.count).fill(v.key) as string[])), VOICE_LABEL),
    families: tally(articles.flatMap((a) => DIM_ORDER.map((d) => a.families[d])), FAMILY_LABEL),
    familyItems: tally(articles.flatMap((a) => a.familyItems), FAMILY_LABEL),
    policyFrames: descriptorCounter(secondary.policy_frames),
    policySaturated: (() => {
      const rows = descriptorCounter(secondary.policy_frames);
      return rows.length >= 2 && rows.every((r) => r.count === bundle.issue.articleCount);
    })(),
    genericFrames: descriptorCounter(secondary.generic_frames),
    statuses: tally(articles.flatMap((a) => DIM_ORDER.map((d) => a.statuses[d])), STATUS_LABEL),
    sourceCaution: data.source_lens?.caution ?? null,
    notObservedStatements: data.not_observed_statements ?? [],
    splitDimensions,
    sections: tally(articles.map((a) => a.section ?? undefined), {}),
    evidenceTotal: articles.reduce((s, a) => s + a.evidenceCount, 0),
    succeeded: bundle.analysisStatus?.semantic?.succeededArticleCount ?? 0,
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
  /** 프레이밍 층위가 아닌 지표 (범주 수가 달라 층위와 같은 자로 재지 않는다) */
  sideLayers: LayerPower[];
  /** 의제별 매체 확산도 = 매체 수 / 기사 수 */
  spread: Array<{ rank: number; title: string; issueId: string; outletCount: number; articleCount: number; ratio: number }>;
  evidenceTotal: number;
  sourceRoles: Counter;
  scope: Counter;
  genres: Counter;
}

export function deriveDay(): DayView {
  const issues = initialFiveManifest.issues
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((meta) => {
      const bundle = getInitialFiveIssueBundle(meta.issueId);
      // 번들 하나가 빠져도 셸(도구 화면 포함)은 살린다 — 던지면 전 라우트가 죽는다
      return bundle ? deriveIssue(bundle) : null;
    })
    .filter(Boolean) as IssueView[];

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
  ];

  // 프레이밍 층위가 아닌 지표는 따로 센다 (범주 수가 달라 같은 자로 재면 안 된다)
  const sideDefs: Array<{ key: string; label: string; note: string; pick: (issue: IssueView) => Set<string> }> = [
    {
      key: "source_roles",
      label: "취재원 구성",
      note: "역할 7종 · 누구를 인용했는가",
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.roles[0]?.label).filter(Boolean) as string[]),
    },
    {
      key: "voice_mix",
      label: "인용 방식",
      note: "방식 4종 · 직접 인용인가 기자 서술인가",
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.voices[0]?.key).filter(Boolean) as string[]),
    },
  ];

  const power = (defs: typeof layerDefs): LayerPower[] => defs
    .map((def) => ({
      key: def.key,
      label: def.label,
      note: def.note,
      total: issues.length,
      split: issues.filter((issue) => def.pick(issue).size >= 2).length,
    }))
    .sort((a, b) => b.split - a.split || a.label.localeCompare(b.label));
  const layers = power(layerDefs);
  const sideLayers = power(sideDefs);

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
    sideLayers,
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
    scope: merge(issues.map((i) => i.sample.scope)),
    genres: merge(issues.map((i) => i.sample.genres)),
  };
}
