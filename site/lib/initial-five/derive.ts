// 공개 아티팩트 → 화면이 바로 쓸 수 있는 뷰 모델.
//
// 화면 컴포넌트가 JSON 구조를 직접 헤집지 않게 여기서 한 번만 정리한다. 모든 값은
// 빌드 시점에 계산되고(공개 아티팩트가 정적 import 이므로), 원문 문장은 어디에도
// 담지 않는다 — 의역·건수·근거 위치만 지난다.

import { getInitialFiveIssueBundle, initialFiveManifest } from "./artifacts";
// 취재원 역할 좁히기 규칙은 워커 API 와 공유한다 (lib/initial-five/subjects.mjs)
import { actorParaphrases, narrowSubject, paraphrasesByLocator, subjectsIn } from "./subjects.mjs";
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

/** 분석의 단위는 '주장(claim)'이고, 한 주장에는 근거 문장이 여러 개 붙을 수 있다.
 *  원본 JSON 은 그것을 문장마다 한 행으로 펼쳐 담기 때문에, 행을 그대로 세면
 *  '설명 N건'이 근거 문장 수만큼 부풀어 오른다(이 표본에서 171행 → 실제 주장 115개).
 *  주장 단위로 접고, 근거 문장 수와 문장 번호를 그 주장에 딸린 정보로 남긴다.
 *  같은 주장이 같은 문장까지 그대로 중복된 완전 중복(9.5%)도 여기서 함께 사라진다. */
type ClaimSource = {
  claim_id?: string;
  public_paraphrase?: string;
  evidence?: { locator?: { paragraph?: number; sentence?: number }; sentence_sha256?: string };
};
type ClaimItem<T> = T & { evidenceSentences: number; sentences: number[] };

function claimItems<T extends ClaimSource>(items: T[]): Array<ClaimItem<T>> {
  const order: string[] = [];
  const map = new Map<string, ClaimItem<T>>();
  for (const item of items) {
    const key = item.claim_id ?? `paraphrase:${item.public_paraphrase ?? ""}`;
    const sentence = item.evidence?.locator?.sentence;
    const slot = map.get(key);
    if (!slot) {
      order.push(key);
      map.set(key, {
        ...item,
        evidenceSentences: 1,
        sentences: typeof sentence === "number" ? [sentence] : [],
      });
      continue;
    }
    slot.evidenceSentences += 1;
    if (typeof sentence === "number" && !slot.sentences.includes(sentence)) slot.sentences.push(sentence);
  }
  return order.map((key) => map.get(key) as ClaimItem<T>);
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
  /** voice.kind = journalist_narration 항목만으로 뽑은 계열. 매체가 직접 쓴 설명이다. */
  narratedFamilies: Record<string, string | undefined>;
  /** 층위별 기자 서술 항목 수와 취재원 발언 항목 수 */
  voiceBasis: Record<string, { narrated: number; attributed: number }>;
  /** 차원별 관측 상태 */
  statuses: Record<string, string | undefined>;
  /** 층위별로 의역문에 등장한 주체 — "공동책임" 이 누구와 누구인지 */
  subjects: Record<string, string[]>;
  voices: Counter;
  /** 이중코딩이 낸 취재원 역할 — 화자가 누구인지에 대한 유일한 코딩 값이다 */
  roles: Counter;
  /** 그 발언 문장이 다루는 주체(단어 규칙). 화자가 아니라 대상이다 */
  passageSubjects: Counter;
  narrowedActorCount: number;
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
    const narratedFamilies: Record<string, string | undefined> = {};
    const voiceBasis: Record<string, { narrated: number; attributed: number }> = {};
    for (const dim of DIM_ORDER) {
      const node = dims[dim];
      const items = claimItems(node?.items ?? []);
      statuses[dim] = node?.status;
      families[dim] = items[0]?.frame_family;
      // 취재원의 말로 실린 설명을 매체의 서술로 합산하지 않는다 — 프레이밍 화면과 같은 규칙을
      // 대표 계열에도 적용한다. 이 분리 없이 세면 인용을 매체 입장으로 귀속시키게 된다.
      const narrated = items.filter((item) => item.voice?.kind === "journalist_narration");
      narratedFamilies[dim] = narrated[0]?.frame_family;
      voiceBasis[dim] = { narrated: narrated.length, attributed: items.length - narrated.length };
      for (const item of items) {
        voiceKinds.push(item.voice?.kind);
        if (item.frame_family) familyItems.push(item.frame_family);
      }
    }
    const actors = profile?.actors_and_sources ?? [];
    /* 근거 위치(문단·문장)를 열쇠로 화자 레코드와 프레임 의역문을 붙인다. 같은 문장에서 뽑힌
       것이므로 그 의역문이 그 화자를 서술한다. */
    const paraAt = paraphrasesByLocator(dims);
    const actorTexts = (actor: (typeof actors)[number]) => actorParaphrases(actor, paraAt);
    /** 층위별 주체 — 계열 이름만으로는 "누구의 공동책임"인지 알 수 없다. */
    const subjects: Record<string, string[]> = {};
    for (const dim of DIM_ORDER) {
      subjects[dim] = subjectsIn(
        claimItems(dims[dim]?.items ?? [])
          .map((item) => item.public_paraphrase ?? "")
          .filter(Boolean),
      );
    }
    return {
      articleId: article.articleId,
      subjects,
      title: article.title ?? "제목 없음",
      outlet: article.outlet ?? "미상",
      section: article.section,
      publishedAt: article.publishedAt,
      url: article.canonicalUrl,
      evidenceCount: entry?.engine.evidenceCount ?? 0,
      families,
      familyItems,
      narratedFamilies,
      voiceBasis,
      statuses,
      voices: tally(voiceKinds, VOICE_LABEL),
      /* 화자는 역할 코드로만 말할 수 있다. 의역문에서 좁힌 값은 그 문장이 다루는 대상이라
         화자와 다르다 — "법치를 흔드는 사안 앞에서 책임을 피한다" 는 대통령을 평가하는 문장이지
         대통령이 한 말이 아니다. 그래서 두 값을 다른 이름으로 나눠 싣는다. */
      roles: (() => {
        const byRole = new Map<string, number>();
        for (const actor of actors) {
          const label = actor.role_label ?? (typeof actor.role === "string" ? actor.role : "기타 취재원");
          byRole.set(label, (byRole.get(label) ?? 0) + (actor.direct_quote_count ?? 0) + (actor.indirect_attribution_count ?? 0));
        }
        return [...byRole]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([label, count]) => ({ key: label, label, count }));
      })(),
      passageSubjects: (() => {
        const bySubject = new Map<string, number>();
        for (const actor of actors) {
          const label = narrowSubject(actorTexts(actor));
          if (!label) continue;
          bySubject.set(label, (bySubject.get(label) ?? 0) + (actor.direct_quote_count ?? 0) + (actor.indirect_attribution_count ?? 0));
        }
        return [...bySubject]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([label, count]) => ({ key: label, label, count }));
      })(),
      narrowedActorCount: actors.filter((actor) => narrowSubject(actorTexts(actor)) !== null).length,
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
  /** 매체 서술만으로 본 대표 계열 — 매체 간 비교에 쓰는 값이다 */
  leadNarrated: Record<string, { family?: string; tied: boolean }>;
  /** 층위별로 이 매체 기사들의 의역문에 등장한 주체 — 계열 이름 아래에 붙인다 */
  subjects: Record<string, string[]>;
  roles: Counter;
  passageSubjects: Counter;
  narrowedActorCount: number;
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

// 취재원 집계는 semanticProfiles 한 세대에서만 파생한다. comparison.data.source_lens 는
// 다른 세대 산출물이라(조선일보 행 누락 등) 같은 줄 안에서 총횟수 < 직접 인용 같은
// 모순을 만들었다.
function outletViews(articles: ArticleView[]): OutletView[] {
  const groups = new Map<string, ArticleView[]>();
  for (const article of articles) {
    const list = groups.get(article.outlet) ?? [];
    list.push(article);
    groups.set(article.outlet, list);
  }
  return [...groups]
    .map(([outlet, list]) => {
      const families: Record<string, string[]> = {};
      const subjects: Record<string, string[]> = {};
      for (const dim of DIM_ORDER) {
        subjects[dim] = [...new Set(list.flatMap((article) => article.subjects?.[dim] ?? []))].slice(0, 3);
      }
      const lead: Record<string, { family?: string; tied: boolean }> = {};
      const leadNarrated: Record<string, { family?: string; tied: boolean }> = {};
      for (const dim of DIM_ORDER) {
        families[dim] = [...new Set(list.map((a) => a.families[dim]).filter(Boolean) as string[])];
        lead[dim] = modeFamily(list.map((a) => a.families[dim]));
        leadNarrated[dim] = modeFamily(list.map((a) => a.narratedFamilies[dim]));
      }
      const byRole = new Map<string, number>();
      for (const a of list) for (const r of a.roles) byRole.set(r.label, (byRole.get(r.label) ?? 0) + r.count);
      const roles: Counter = [...byRole]
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .map(([label, count]) => ({ key: label, label, count }));
      return {
        outlet,
        articles: list,
        articleCount: list.length,
        families,
        lead,
        leadNarrated,
        roles,
        subjects,
        passageSubjects: (() => {
          const m = new Map<string, number>();
          for (const a of list) for (const r of a.passageSubjects) m.set(r.label, (m.get(r.label) ?? 0) + r.count);
          return [...m].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([label, count]) => ({ key: label, label, count }));
        })(),
        narrowedActorCount: list.reduce((sum, a) => sum + a.narrowedActorCount, 0),
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
  marks: Array<{ outlet: string; position: number; articleCount: number; both: boolean; narrated: boolean }>;
  unobserved: string[];
  patternCount: number;
  /** 한쪽 극이 모든 매체를 포함한다 = 대립이 아니라 포함 관계 */
  nested: boolean;
  scopes: string[];
  /** 이 축에서 매체가 직접 쓴 서술이 있는 매체 수 / 전체 매체 수 */
  narratedOutlets: number;
}

function spectrum(bundle: IssueAnalysisBundle, articles: ArticleView[], dimension: string): SpectrumView | null {
  /* 축은 이 분석(claude 판정본)에서만 만든다. 공개 JSON 의 comparison_axes 는 다른 세대라
     라벨('기타 취재원의 발언·설명에서…')이 이 분석의 취재원 표와 어긋나고, 한 기사가 양쪽
     패턴에 동시에 들어가 극별 기사 수 합이 기사 수를 넘는 문제가 있었다.
     여기서는 기사마다 지배 계열이 하나이므로 두 극이 겹치지 않는다. */
  const byFamily = new Map<string, { articles: ArticleView[]; paraphrase: string | null }>();
  const paraphraseOf = new Map<string, string>();
  for (const entry of bundle.semanticProfiles) {
    for (const item of claimItems(entry.profile?.dimensions?.[dimension]?.items ?? [])) {
      const family = item.frame_family;
      if (!family || paraphraseOf.has(family)) continue;
      if (item.public_paraphrase) paraphraseOf.set(family, item.public_paraphrase);
    }
  }
  for (const article of articles) {
    const family = article.families[dimension];
    if (!family) continue;
    const slot = byFamily.get(family) ?? { articles: [], paraphrase: paraphraseOf.get(family) ?? null };
    slot.articles.push(article);
    byFamily.set(family, slot);
  }
  // 계열이 한 종류면 대립이 아니라 공통점이다 — 축을 세우지 않는다.
  if (byFamily.size < 2) return null;

  const ranked = [...byFamily].sort((x, y) => y[1].articles.length - x[1].articles.length || x[0].localeCompare(y[0]));
  const [[leftFamily, leftSlot], [rightFamily, rightSlot]] = ranked;
  const label = (family: string, slot: { paraphrase: string | null }) =>
    slot.paraphrase ? `${familyLabel(family)} — ${slot.paraphrase}` : familyLabel(family);
  const outletsOf = (rows: ArticleView[]) => [...new Set(rows.map((row) => row.outlet))];
  const allOutlets = [...new Set(articles.map((row) => row.outlet))];

  const marks: SpectrumView["marks"] = [];
  for (const outlet of allOutlets) {
    const own = articles.filter((row) => row.outlet === outlet);
    const l = own.filter((row) => row.families[dimension] === leftFamily).length;
    const r = own.filter((row) => row.families[dimension] === rightFamily).length;
    if (!l && !r) continue;
    marks.push({
      outlet,
      position: r / (l + r),
      articleCount: l + r,
      both: l > 0 && r > 0,
      narrated: own.some((row) => (row.voiceBasis[dimension]?.narrated ?? 0) > 0),
    });
  }
  const covered = new Set(marks.map((mark) => mark.outlet));

  return {
    dimension,
    question: DIM_QUESTION[dimension] ?? DIM_LABEL[dimension] ?? dimension,
    left: { label: label(leftFamily, leftSlot), articleCount: leftSlot.articles.length, outlets: outletsOf(leftSlot.articles) },
    right: { label: label(rightFamily, rightSlot), articleCount: rightSlot.articles.length, outlets: outletsOf(rightSlot.articles) },
    marks: marks.sort((x, y) => x.position - y.position || x.outlet.localeCompare(y.outlet)),
    unobserved: allOutlets.filter((outlet) => !covered.has(outlet)),
    patternCount: byFamily.size,
    // 기사마다 지배 계열이 하나이므로 두 극은 겹치지 않는다
    nested: false,
    scopes: [],
    narratedOutlets: marks.filter((mark) => mark.narrated).length,
  };
}


export interface LayerItem {
  paraphrase: string;
  /** 이 주장에 붙은 근거 문장 수 */
  evidenceSentences?: number;
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
  /** 매체 서술만으로 본 매체별 대표 계열 종류 수. 2 이상이면 이 층위에서 매체가 갈렸다. */
  outletKinds: number;
  /** 취재원 발언까지 합쳐 세면 몇 종인지 */
  outletKindsWithSources: number;
  /** 이 층위에서 매체 자체 서술이 확인된 매체 수 */
  narratedOutletCount: number;
  /** 이 의제 참여 매체 수 (분모) */
  outletCount: number;
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
      for (const item of claimItems(node.items ?? [])) {
        bucket.push({
          paraphrase: item.public_paraphrase ?? "",
          family: item.frame_family,
          voiceKind: item.voice?.kind,
          outlet: outletOf.get(entry.articleId) ?? "미상",
          articleId: entry.articleId,
          // 문단 번호는 이 세대 산출물에서 전 항목 1이라 싣지 않는다. 문장 번호만 근거가 된다.
          locator: item.sentences.length
            ? `문장 ${item.sentences.join("·")}`
            : null,
          evidenceSentences: item.evidenceSentences,
          hash: item.evidence?.sentence_sha256 ?? null,
        });
      }
    }
    /* 대표 지표는 매체가 직접 쓴 서술만으로 센다. 혼합 기준으로 세면 취재원 인용이
       매체의 입장으로 귀속돼, 같은 빌드의 개요·리포트와 반대되는 배지가 붙는다. */
    const kinds = new Set(
      outletList
        .map((outlet) => modeFamily(narrated.filter((i) => i.outlet === outlet).map((i) => i.family)).family)
        .filter(Boolean) as string[],
    );
    const kindsWithSources = new Set(
      outletList
        .map((outlet) => modeFamily([...narrated, ...attributed].filter((i) => i.outlet === outlet).map((i) => i.family)).family)
        .filter(Boolean) as string[],
    );
    const narratedOutletCount = outletList.filter((outlet) => narrated.some((i) => i.outlet === outlet)).length;
    return {
      dimension: dim,
      label: DIM_LABEL[dim],
      question: DIM_QUESTION[dim],
      narrated,
      attributed,
      notObserved,
      outletKinds: kinds.size,
      outletKindsWithSources: kindsWithSources.size,
      narratedOutletCount,
      outletCount: outletList.length,
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
  /** 가장 큰 군집과 값이 다른 층위 (양쪽 모두 관측된 경우만) */
  differsAt: string[];
  /** 한쪽만 관측된 층위 — 판단 차이가 아니라 관측 차이다 */
  partialAt: string[];
}

function frameClusters(articles: ArticleView[], basis: "all" | "narrated" = "all"): FrameCluster[] {
  const groups = new Map<string, FrameCluster>();
  for (const article of articles) {
    const signature: Record<string, string | undefined> = {};
    for (const dim of DIM_ORDER)
      signature[dim] = basis === "narrated" ? article.narratedFamilies[dim] : article.families[dim];
    const key = DIM_ORDER.map((dim) => signature[dim] ?? "-").join("|");
    const slot = groups.get(key) ?? { key, signature, articleIds: [], outlets: [], count: 0, differsAt: [], partialAt: [] };
    slot.articleIds.push(article.articleId);
    if (!slot.outlets.includes(article.outlet)) slot.outlets.push(article.outlet);
    slot.count += 1;
    groups.set(key, slot);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const base = sorted[0];
  for (const cluster of sorted) {
    // 양쪽 모두 관측된 층위에서만 '다르다'고 센다. 한쪽이 미관측인 칸은 판단이 달랐다는
    // 증거가 아니라 근거를 찾지 못한 칸이므로, 별도로 partialAt 에 모은다.
    cluster.differsAt = base
      ? DIM_ORDER.filter(
          (dim) =>
            base.signature[dim] !== undefined &&
            cluster.signature[dim] !== undefined &&
            cluster.signature[dim] !== base.signature[dim],
        )
      : [];
    cluster.partialAt = base
      ? DIM_ORDER.filter(
          (dim) =>
            (base.signature[dim] === undefined) !== (cluster.signature[dim] === undefined),
        )
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
  /** 5-튜플로 귀납 도출한 조합. 취재원 발언까지 포함한 지배 계열 기준. */
  frameClusters: FrameCluster[];
  /** 매체가 직접 쓴 서술만으로 다시 묶은 조합 — 매체 간 비교에 쓸 수 있는 기준 */
  narratedClusters: FrameCluster[];
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
    analyzedChars: { mean: number; min: number; max: number } | null;
    textScope: string | null;
    evidenceStorage: string | null;
    limitations: string[];
  };
  /** 판정 전 두 코더의 계열 일치율. 이 의제 기사에서 다시 센 값이다. */
  agreement: {
    articleCount: number;
    dimensionCount: number;
    mean: number | null;
    perDimension: Array<{ dimension: string; rate: number | null }>;
    fullAgreementArticleCount: number;
    coderKind: string | null;
    coderLimit: string | null;
    statistic: string | null;
  } | null;
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
  /** 매체 서술 기준으로 갈린 층위 수. 화면의 대표 지표. */
  splitDimensions: number;
  /** 취재원 발언까지 합쳐 세면 몇 곳인지 — 분리해서 함께 보여 준다 */
  splitDimensionsWithSources: number;
  /** 층위별 근거 성질: 기자 서술 항목 수 / 취재원 발언 항목 수 / 매체 대표 계열 종류 */
  dimensionBasis: Array<{
    dimension: string;
    narratedItems: number;
    attributedItems: number;
    narratedKinds: number;
    allKinds: number;
  }>;
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
  const outlets = outletViews(articles);
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
  const narratedClusters = frameClusters(articles, "narrated");
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
  // 첫 기사 하나의 값을 '기사당' 대표값처럼 쓰지 않는다 — 발췌 길이는 423~2,672자로 산포된다
  const charCounts = bundle.semanticProfiles
    .map((entry) => entry.profile?.extraction?.analyzed_character_count)
    .filter((n): n is number => typeof n === "number");
  const reviewStatuses = new Set(
    bundle.semanticProfiles.map((entry) => entry.profile?.review?.status).filter(Boolean) as string[],
  );
  const provenance = {
    model: bundle.analysisStatus.semantic.model ?? (engine.version as string) ?? null,
    promptVersion: bundle.analysisStatus.semantic.promptVersion ?? null,
    reviewStatus: reviewStatuses.size === 1 ? [...reviewStatuses][0] : reviewStatuses.size ? "mixed" : null,
    requiresHumanReview:
      bundle.analysisStatus?.semantic?.requiresHumanReview ??
      bundle.semanticProfiles.some((entry) => Boolean(entry.profile?.review?.requires_human_review)),
    analyzedChars: charCounts.length
      ? {
          mean: Math.round(charCounts.reduce((sum, n) => sum + n, 0) / charCounts.length),
          min: Math.min(...charCounts),
          max: Math.max(...charCounts),
        }
      : null,
    textScope: firstProfile?.extraction?.text_scope ?? null,
    evidenceStorage: (engine.evidence_storage as string) ?? null,
    limitations: Array.isArray(engine.limitations) ? (engine.limitations as string[]) : [],
  };

  const rawAgreement = bundle.coderAgreement ?? null;
  const agreement = rawAgreement
    ? {
        articleCount: rawAgreement.articleCount ?? 0,
        dimensionCount: rawAgreement.dimensionCount ?? 0,
        mean: rawAgreement.meanDimensionAgreement ?? null,
        perDimension: Object.entries(rawAgreement.perDimensionAgreement ?? {}).map(([dimension, rate]) => ({
          dimension,
          rate: typeof rate === "number" ? rate : null,
        })),
        fullAgreementArticleCount: rawAgreement.fullAgreementArticleCount ?? 0,
        coderKind: rawAgreement.method?.coderKind ?? null,
        coderLimit: rawAgreement.method?.coderLimit ?? null,
        statistic: rawAgreement.method?.statistic ?? null,
      }
    : null;

  const spectra = DIM_ORDER.map((dim) => spectrum(bundle, articles, dim)).filter(Boolean) as SpectrumView[];
  const dimensionBasis = DIM_ORDER.map((dim) => ({
    dimension: dim,
    narratedItems: articles.reduce((sum, a) => sum + (a.voiceBasis[dim]?.narrated ?? 0), 0),
    attributedItems: articles.reduce((sum, a) => sum + (a.voiceBasis[dim]?.attributed ?? 0), 0),
    narratedKinds: new Set(outlets.map((o) => o.leadNarrated[dim]?.family).filter(Boolean)).size,
    allKinds: new Set(outlets.map((o) => o.lead[dim]?.family).filter(Boolean)).size,
  }));
  // 대표 지표는 매체 서술 기준이다. 취재원 발언만 있는 층위는 매체를 갈랐다고 말할 수 없다.
  const kindsPerDim = dimensionBasis
    .map((row) => ({ dimension: row.dimension, kinds: row.narratedKinds }))
    .sort((a, b) => b.kinds - a.kinds);
  const mostSplit = kindsPerDim[0]?.kinds >= 2 ? kindsPerDim[0] : null;

  const splitDimensions = dimensionBasis.filter((row) => row.narratedKinds >= 2).length;
  const splitDimensionsWithSources = dimensionBasis.filter((row) => row.allKinds >= 2).length;

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
    narratedClusters,
    axes,
    layers,
    mostSplit,
    comparisonEngine,
    sample,
    provenance,
    agreement,
    spectrum:
      spectra.find((s) => s.dimension === mostSplit?.dimension) ??
      spectra.find((s) => s.dimension === "problem_definition") ??
      spectra[0] ??
      null,
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
    splitDimensionsWithSources,
    dimensionBasis,
    sections: tally(articles.map((a) => a.section ?? undefined), {}),
    evidenceTotal: articles.reduce((s, a) => s + a.evidenceCount, 0),
    succeeded: bundle.analysisStatus?.semantic?.succeededArticleCount ?? 0,
  };
}

// ── 하루 단위 (홈) ─────────────────────────────────────────────────────────

export interface LayerPower {
  key: string;
  label: string;
  /** 매체 서술 기준으로 값이 갈린 의제 수 (0~5) — 대표 지표 */
  split: number;
  /** 취재원 발언까지 합쳐 세면 몇 개 의제인지 */
  splitWithSources: number;
  total: number;
  note: string;
  /** 이 층위에서 매체가 직접 쓴 항목 수 (하루 전체) */
  narratedItems: number;
  /** 이 층위에서 취재원의 말로 실린 항목 수 (하루 전체) */
  attributedItems: number;
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
  type LayerDef = {
    key: string;
    label: string;
    note: string;
    /** 대표 지표 — 매체가 직접 쓴 서술만 */
    pick: (issue: IssueView) => Set<string>;
    /** 취재원 발언까지 합친 값 */
    pickAll: (issue: IssueView) => Set<string>;
    basis?: (issue: IssueView) => { narrated: number; attributed: number };
  };
  const layerDefs: LayerDef[] = [
    ...DIM_ORDER.map((dim) => ({
      key: dim,
      label: DIM_LABEL[dim],
      note: DIM_QUESTION[dim],
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.leadNarrated[dim]?.family).filter(Boolean) as string[]),
      pickAll: (issue: IssueView) => new Set(issue.outlets.map((o) => o.lead[dim]?.family).filter(Boolean) as string[]),
      basis: (issue: IssueView) => {
        const row = issue.dimensionBasis.find((entry) => entry.dimension === dim);
        return { narrated: row?.narratedItems ?? 0, attributed: row?.attributedItems ?? 0 };
      },
    })),
  ];

  // 프레이밍 층위가 아닌 지표는 따로 센다 (범주 수가 달라 같은 자로 재면 안 된다)
  const sideDefs: LayerDef[] = [
    {
      key: "source_roles",
      label: "취재원 구성",
      note: "역할 7종 · 누구를 인용했는가",
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.roles[0]?.label).filter(Boolean) as string[]),
      pickAll: (issue: IssueView) => new Set(issue.outlets.map((o) => o.roles[0]?.label).filter(Boolean) as string[]),
    },
    {
      key: "voice_mix",
      label: "인용 방식",
      note: "방식 4종 · 직접 인용인가 기자 서술인가",
      pick: (issue: IssueView) => new Set(issue.outlets.map((o) => o.voices[0]?.key).filter(Boolean) as string[]),
      pickAll: (issue: IssueView) => new Set(issue.outlets.map((o) => o.voices[0]?.key).filter(Boolean) as string[]),
    },
  ];

  const power = (defs: LayerDef[]): LayerPower[] => defs
    .map((def) => ({
      key: def.key,
      label: def.label,
      note: def.note,
      total: issues.length,
      split: issues.filter((issue) => def.pick(issue).size >= 2).length,
      splitWithSources: issues.filter((issue) => def.pickAll(issue).size >= 2).length,
      narratedItems: def.basis ? issues.reduce((sum, issue) => sum + def.basis!(issue).narrated, 0) : 0,
      attributedItems: def.basis ? issues.reduce((sum, issue) => sum + def.basis!(issue).attributed, 0) : 0,
    }))
    .sort((a, b) => b.split - a.split || b.splitWithSources - a.splitWithSources || a.label.localeCompare(b.label));
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
