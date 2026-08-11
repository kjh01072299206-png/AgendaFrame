import bundle from "../../public/proto/framing-2026-07-26.json";

/* 2026-07-26 상위 5개 의제의 확장 분석 산출물. 라이브 계약(site/public/initial-five)은
   Entman 6층위와 화자 레코드만 담는다 — 군집·정책 프레임·보편 프레임·의미 연결망·형태소는
   그 계약에 없는 값이라 별도 산출물로 싣는다.

   원문 문장은 이 파일에 없다. 관측 여부·의역·지칭어·근거 문장 수만 있다. */

export interface ProtoTerm {
  term: string;
  gloss: string;
}
export interface ProtoCamp {
  name: string;
  gist: string;
  outlets: string[];
  index: number;
}
export interface ProtoRow {
  question: string;
  common: string | null;
  cells: string[] | null;
}
export interface ProtoCluster {
  members: string[];
  shared: string[];
  only: string[];
}
export interface ProtoGraphNode {
  term: string;
  count: number;
  fs: number;
  shared: boolean;
  x: number;
  y: number;
  bw: number;
  bh: number;
}
export interface ProtoFrameGroup {
  members: string[];
  articleCount: number;
  only: string[];
  graph: {
    nodes: ProtoGraphNode[];
    edges: Array<{ a: number; b: number; w: number; n: number }>;
    box: [number, number];
  };
}
export interface ProtoMorphology {
  outlet: string;
  tokens: number;
  pos: Array<{ tag: string; n: number }>;
  distinctive: Array<{ term: string; count: number; score: number }>;
}
export interface ProtoSourcing {
  outlet: string;
  roles: Array<{ label: string; n: number }>;
}
export interface ProtoDevice {
  outlet: string;
  scope: string;
  headline: string;
  terms: Array<{ concept: string; used: string }>;
}
export interface ProtoFrameCoding {
  article_id: string;
  outlet: string;
  boydstun: { present: Array<{ code: string; label: string }>; dominant: string };
  semetko: Array<{ code: string; label: string; present: boolean }>;
}
export interface ProtoEvidence {
  outlet: string;
  title: string;
  url: string | null;
  policy: string | null;
  scope: string;
  agree: [number, number];
  rows: Array<{
    label: string;
    family: string;
    voice: string;
    said: string;
    n: number;
    stated: boolean;
  }>;
}
export interface ProtoVoices {
  outlet: string;
  mix: Array<{ label: string; n: number }>;
  silent: number;
}
export interface ProtoIssue {
  rank: number;
  headline: string;
  whatHappened: string;
  terms: ProtoTerm[];
  agreedLine: string;
  splitLine: string;
  soWhat: string;
  camps: ProtoCamp[];
  factRows: ProtoRow[];
  splitRows: ProtoRow[];
  outletCount: number;
  articleCount: number;
  sourceCount: number;
  tokenCount: number;
  mk: { cut: number; merges: number[]; clusters: ProtoCluster[] };
  frameGroups: ProtoFrameGroup[];
  morphology: ProtoMorphology[];
  sourcing: ProtoSourcing[];
  devices: ProtoDevice[];
  frames: ProtoFrameCoding[] | null;
  evidence: ProtoEvidence[];
  counts: Array<{ layer: string; distinct: number; of: number }>;
  splitLayers: [number, number];
  spread: [number, number];
  agreeSum: [number, number];
  voices: ProtoVoices[];
  policyMix: Array<{ label: string; n: number }>;
  scopeMix: Array<{ label: string; n: number }>;
  roleMix: Array<{ label: string; n: number }>;
  topTerms: string[];
  quiz: Array<{
    q: string;
    many: boolean;
    hint: string | null;
    options: Array<{ label: string; sub: string | null; outlets: string[] }>;
  }>;
}

export interface ProtoBundle {
  scope: { date: string; articles: number; outlets: number; issues: number; sources: number };
  agreement: { agreed: number; total: number };
  outlets: Array<{ name: string; n: number }>;
  summary: Array<{ layer: string; split: number; seen: number }>;
  issues: ProtoIssue[];
}

export const proto = bundle as unknown as ProtoBundle;

/** 라이브 의제 id 는 bigkinds-2026-07-26-top-N 이고 이 산출물은 rank 로 매긴다. */
export function protoIssue(issueId: string): ProtoIssue | null {
  const rank = Number(/-top-(\d+)$/.exec(issueId)?.[1]);
  if (!Number.isFinite(rank)) return null;
  return proto.issues.find((issue) => issue.rank === rank) ?? null;
}

/** 같은 매체가 두 건을 쓴 사안이 있다. 표에서 두 줄이 같은 이름이면 구분이 안 된다. */
export function labelOutlets(rows: Array<{ outlet: string }>): string[] {
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const row of rows) total.set(row.outlet, (total.get(row.outlet) ?? 0) + 1);
  return rows.map((row) => {
    const nth = (seen.get(row.outlet) ?? 0) + 1;
    seen.set(row.outlet, nth);
    return (total.get(row.outlet) ?? 0) > 1 ? `${row.outlet} ${nth}` : row.outlet;
  });
}
