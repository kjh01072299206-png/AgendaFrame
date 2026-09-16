"use client";

import { useState } from "react";
import type {
  EventSynthesisClaim,
  EventSynthesisData,
  EventSynthesisEvidence,
  IssueAnalysisBundle,
} from "../../lib/initial-five/types";
import type { IssueView } from "../../lib/initial-five/derive";
import {
  comparisonSummary,
  comparisonVoiceLabel,
  type ComparisonGroup,
  type ComparisonObservation,
  type ComparisonSummary,
} from "../../lib/initial-five/analysis-summary";
import { stripEvidenceTokens } from "../../lib/initial-five/public-text.mjs";

type ArticleRef = IssueView["articles"][number];

function textOf(claim?: EventSynthesisClaim | null, expectedArticleCount = 0) {
  if (!claim || claim.status === "explicit_not_stated" || claim.status === "insufficient_evidence") return null;
  if (typeof claim.text !== "string" || !claim.text.trim()) return null;
  const refs = refsOf(claim.evidence).filter(validRef);
  if (!refs.length) return null;
  const text = stripEvidenceTokens(claim.text).trim();
  if (expectedArticleCount > 0 && /모든\s*(?:매체|기사)|전\s*매체|공통으로/.test(text)) {
    const articleCount = new Set(refs.map((ref) => ref.article_id)).size;
    if (articleCount < expectedArticleCount) return null;
  }
  return text || null;
}

function refsOf(value: unknown): EventSynthesisEvidence[] {
  return Array.isArray(value)
    ? value.filter((ref): ref is EventSynthesisEvidence => Boolean(ref && typeof ref === "object"))
    : [];
}

function validRef(ref: EventSynthesisEvidence) {
  const locator = ref.locator;
  return typeof ref.article_id === "string"
    && (typeof locator?.paragraph === "number" || typeof locator?.sentence === "number")
    && typeof ref.sentence_sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(ref.sentence_sha256);
}

function articleLabel(article?: ArticleRef, articleId?: string) {
  if (article) return `${article.outlet} · ${article.title}`;
  return articleId ? "기사 정보 미상" : "기사 근거";
}

function evidencePlace(ref: EventSynthesisEvidence) {
  const locator = ref.locator ?? {};
  return [
    typeof locator.paragraph === "number" ? `문단 ${locator.paragraph}` : null,
    typeof locator.sentence === "number" ? `문장 ${locator.sentence}` : null,
  ].filter(Boolean).join(" · ") || "위치 미상";
}

function EvidenceDisclosure({
  refs,
  label,
  articles,
}: {
  refs: unknown;
  label: string;
  articles?: Map<string, ArticleRef>;
}) {
  const valid = refsOf(refs).filter(validRef).slice(0, 6);
  if (!valid.length) return <small className="afp-state">{label} 연결 대기</small>;
  return (
    <details className="afp-evidence afp-evidence-compact afp-v2-evidence">
      <summary>{label} {valid.length}개</summary>
      <div className="afp-evidence-body">
        {valid.map((ref, index) => (
          <div className="afp-evidence-ref" key={`${ref.article_id}-${ref.sentence_sha256}-${index}`}>
            <strong>{articleLabel(ref.article_id ? articles?.get(ref.article_id) : undefined, ref.article_id)}</strong>
            <small>{evidencePlace(ref)}</small>
            <small className="afp-evidence-technical">
              article_id {ref.article_id ?? "미상"} · SHA-256 {ref.sentence_sha256?.slice(0, 16)}…
            </small>
          </div>
        ))}
      </div>
    </details>
  );
}

function EventExplanation({ issue, synthesis }: { issue: IssueView; synthesis: EventSynthesisData | null }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const paragraphs = (synthesis?.event_paragraphs ?? [])
    .map((claim) => ({ claim, text: textOf(claim, issue.articleCount) }))
    .filter((entry): entry is { claim: EventSynthesisClaim; text: string } => Boolean(entry.text));
  const fallback = paragraphs.length
    ? paragraphs
    : issue.lead
      ? [{ claim: null, text: issue.lead }]
      : [];
  const first = fallback[0]?.text ?? "공개 근거가 연결된 사건 설명을 아직 표시할 수 없습니다.";
  const more = fallback.slice(1, 4);
  const terms = (synthesis?.terms ?? []).filter((term) => term.term && term.gloss);
  return (
    <section className="afs-card afp-event-card-v2" id="sec-event-summary">
      <div className="afs-in afs-prose">
        <div className="afp-event-copy">
          <div className="afp-v2-section-kicker">사건 설명</div>
          <h2>무슨 일이 있었나</h2>
          <p className="afp-event-note">기사 묶음에서 근거가 연결된 경위입니다. 아래 비교는 이 사건을 각 매체가 어떤 설명으로 풀었는지 보여 줍니다.</p>
          <p className="afp-event-first">{first}</p>
        </div>
        <div className="afp-event-context">
          <div className="afp-v2-section-kicker">근거와 추가 경위</div>
          <p className="afp-event-context-note">첫 문장을 먼저 읽고, 필요한 경우 기사·문장 위치를 펼쳐 확인하세요.</p>
          <EvidenceDisclosure refs={fallback[0]?.claim?.evidence} label="첫 사건 설명 근거" articles={articles} />
          {more.length || terms.length ? (
            <details className="afp-event-more">
              <summary>사건 경위와 용어 더 보기</summary>
              {more.map((paragraph, index) => (
                <div className="afp-event-more-row" key={`${paragraph.text}-${index}`}>
                  <p>{paragraph.text}</p>
                  <EvidenceDisclosure refs={paragraph.claim?.evidence} label="사건 경위 근거" articles={articles} />
                </div>
              ))}
              {terms.length ? (
                <div className="afp-terms-v2">
                  <strong>기사에서 확인한 용어</strong>
                  {terms.map((term, index) => (
                    <div className="afp-term-v2" key={`${term.term}-${index}`}>
                      <b>{term.term}</b><span>{stripEvidenceTokens(term.gloss ?? "")}</span>
                      <EvidenceDisclosure refs={term.evidence} label="용어 근거" articles={articles} />
                    </div>
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AxisExplanation({ issue, summary, synthesis }: { issue: IssueView; summary: ComparisonSummary; synthesis: EventSynthesisData | null }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const observedCommonEvidence: EventSynthesisEvidence[] = summary.commonObservations.map((row) => ({
    article_id: row.articleId,
    locator: row.evidence.locator,
    sentence_sha256: row.evidence.sentence_sha256,
  }));
  const commonEvidence = observedCommonEvidence.length
    ? observedCommonEvidence
    : synthesis?.common_ground?.evidence ?? synthesis?.agreed_line?.evidence;
  const axisEvidence = synthesis?.comparison_axis?.evidence;
  return (
    <section className="afs-card afp-axis-v2" id="sec-comparison-axis">
      <div className="afs-in">
        <div className="afp-axis-copy">
          <div className="afp-v2-section-kicker">실제 근거로 만든 비교 질문</div>
          <h2>{summary.dimensionLabel ?? "매체 간 설명 차이"}</h2>
          <p className="afp-axis-question-v2">{summary.question}</p>
          <p className="afp-axis-status-reason">{summary.statusReason}</p>
        </div>
        <div className="afp-axis-context">
          <span className={`afp-comparison-status afp-status-${summary.status}`}>{summary.statusLabel}</span>
          {summary.commonText ? (
            <div className="afp-common-ground-v2">
              <strong>{summary.commonScope ? `여러 매체에서 함께 확인된 설명 · ${summary.commonScope}` : "공통으로 확인한 설명"}</strong>
              <p>{summary.commonText}</p>
              <EvidenceDisclosure refs={commonEvidence} label="공통 설명 근거" articles={articles} />
            </div>
          ) : <p className="afp-state">공통 설명으로 묶을 공개 근거가 아직 확인되지 않았습니다.</p>}
          <div className="afp-comparison-difference">
            <strong>{summary.status === "difference_confirmed" ? "관측된 차이" : "현재 비교 결과"}</strong>
            <p>{summary.differenceText}</p>
          </div>
          {axisEvidence?.length ? <EvidenceDisclosure refs={axisEvidence} label="비교 질문 근거" articles={articles} /> : null}
        </div>
      </div>
    </section>
  );
}

function observationEvidence(row: ComparisonObservation): EventSynthesisEvidence[] {
  return [{
    article_id: row.articleId,
    locator: row.evidence.locator,
    sentence_sha256: row.evidence.sentence_sha256,
  }];
}

function GroupProofPanel({
  group,
  index,
  issue,
}: {
  group: ComparisonGroup;
  index: number;
  issue: IssueView;
}) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  return (
    <div className="afp-camp-proof-panel-v2 afp-group-proof-panel" id={`comparison-proof-${index}`}>
      <div className="afp-proof-panel-heading">
        <div>
          <span className="afp-v2-section-kicker">이 묶음을 만든 기사 근거</span>
          <h3>{group.title}</h3>
        </div>
        <span>{group.articleCount}건 · {group.outlets.length}개 매체</span>
      </div>
      {group.observations.length ? (
        <div className="afp-proof-list-v2">
          {group.observations.slice(0, 12).map((row, rowIndex) => {
            const article = articles.get(row.articleId);
            return (
              <article className="afp-proof-row-v2" key={`${row.articleId}-${row.evidence.sentence_sha256}-${rowIndex}`}>
                <div className="afp-proof-row-head">
                  <strong>{row.outlet}</strong>
                  <span>{row.title}</span>
                </div>
                <small className="afp-proof-dimension">{row.valueLabel} · {row.voiceKind === "journalist_narration" ? "기자 서술" : comparisonVoiceLabel(row.voiceKind)}</small>
                {row.publicParaphrase ? <p>{row.publicParaphrase}</p> : <p className="afp-state">공개 의역이 연결되지 않았습니다.</p>}
                <EvidenceDisclosure refs={observationEvidence(row)} label="이 기사 판단 근거" articles={articles} />
                {article?.url ? <a href={article.url} target="_blank" rel="noreferrer">원문 링크 열기 ↗</a> : null}
              </article>
            );
          })}
        </div>
      ) : <p className="afp-state">이 묶음에 연결된 공개 근거가 없습니다.</p>}
    </div>
  );
}

function groupDifference(group: ComparisonGroup, groups: ComparisonGroup[], summary: ComparisonSummary) {
  if (groups.length < 2) return summary.statusReason;
  const other = groups.find((candidate) => candidate.key !== group.key);
  const emphasis = group.emphasis.replace(/\s+/g, " ").trim();
  const shortEmphasis = emphasis.length > 84 ? `${emphasis.slice(0, 83)}…` : emphasis;
  return `${group.outlets.join("·")} 기사에서는 ${summary.dimensionLabel ?? "설명"}에 “${shortEmphasis}”를 앞세워, ${other?.outlets.join("·") ?? "다른 기사"} 기사와 초점이 갈립니다.`;
}

function ComparisonGroups({ issue, summary }: { issue: IssueView; summary: ComparisonSummary }) {
  const sourceOnly = summary.status === "held_for_analysis";
  const groups = sourceOnly ? summary.sourceGroups : summary.groups;
  const [selected, setSelected] = useState<number | null>(groups.length ? 0 : null);
  const selectedGroup = selected == null ? null : groups[selected] ?? null;
  return (
    <section className="afs-card afp-camps-v2" id="sec-camps">
      <div className="afs-in">
        <div className="afp-camp-heading">
          <div>
            <div className="afp-v2-section-kicker">기사 설명 묶음</div>
            <h2>{groups.length >= 2 ? `${groups.length}개의 실제 강조 묶음` : groups.length === 1 ? "확인된 설명 묶음 1개" : "기사별 판정 상태"}</h2>
          </div>
          <p>
            {sourceOnly
              ? "현재 차이는 취재원 발언에서만 확인되어 매체 자체의 차이로 표시하지 않습니다."
              : groups.length >= 2
                ? "카드를 선택하면 그 묶음을 만든 기사와 문장 근거를 확인할 수 있습니다."
                : "두 개 이상의 매체 서술 묶음이 없어 갈라진 구도를 만들지 않았습니다."}
          </p>
        </div>
        {groups.length ? (
          <>
            {sourceOnly ? <p className="afp-source-only-note">취재원 발언 기반 관측 · 언론사 자체 입장으로 환원하지 않음</p> : null}
            <div className="afp-camp-grid-v2">
              {groups.slice(0, 3).map((group, index) => {
                const active = selected === index;
                return (
                  <button
                    type="button"
                    className={`afp-camp-card-v2${active ? " is-selected" : ""}`}
                    key={`${group.key}-${index}`}
                    aria-expanded={active}
                    aria-controls={`comparison-proof-${index}`}
                    onClick={() => setSelected(active ? null : index)}
                  >
                    <span className="afp-camp-letter">묶음 {String.fromCharCode(65 + index)}</span>
                    <span className="afp-camp-headline" role="heading" aria-level={3}>{group.title}</span>
                    <span className="afp-camp-meta">{group.outlets.join(" · ")} · 기사 {group.articleCount}건</span>
                    <span className="afp-camp-meta">{group.voiceLabel}</span>
                    <span className="afp-camp-summary"><b>앞세운 설명</b>{group.emphasis}</span>
                    {group.details.length ? (
                      <span className="afp-camp-details">
                        <small>대표 기사에서 함께 관측된 보조 설명</small>
                        {group.details.slice(0, 3).map((detail) => <span key={`${detail.label}-${detail.text}`}><b>{detail.label}</b>{detail.text}<small>{detail.outlet} · {detail.title}</small></span>)}
                      </span>
                    ) : null}
                    <span className="afp-camp-decisive"><b>관측된 차이</b>{groupDifference(group, groups, summary)}</span>
                    <span className="afp-proof-trigger">{active ? "기사 근거 닫기 ↑" : "기사 근거 보기 →"}</span>
                  </button>
                );
              })}
            </div>
            {selectedGroup && selected != null ? <GroupProofPanel group={selectedGroup} index={selected} issue={issue} /> : null}
          </>
        ) : (
          <div className="afp-no-groups">
            <strong>{summary.statusLabel}</strong>
            <p>{summary.statusReason}</p>
            <p>기사별 공개 근거와 분석 상태는 아래 기사 목록에서 확인하세요. 빈 묶음을 공통 보도로 해석하지 않았습니다.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function ComparisonLead({
  bundle,
  issue,
  synthesis,
}: {
  bundle: IssueAnalysisBundle;
  issue: IssueView;
  synthesis: EventSynthesisData | null;
}) {
  const summary = comparisonSummary(bundle, issue);
  return (
    <div className="afp-comparison-lead-v2">
      <EventExplanation issue={issue} synthesis={synthesis} />
      <AxisExplanation issue={issue} summary={summary} synthesis={synthesis} />
      <ComparisonGroups issue={issue} summary={summary} />
    </div>
  );
}
