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
  comparisonRelationLabel,
  comparisonVoiceLabel,
  distinctComparisonSummary,
  synthesisRunMatches,
  type ComparisonGroup,
  type ComparisonObservation,
  type ComparisonSummary,
} from "../../lib/initial-five/analysis-summary";
import { isPublishableEventSynthesis } from "../../lib/initial-five/publication-contract";
import { stripEvidenceTokens } from "../../lib/initial-five/public-text.mjs";

type ArticleRef = IssueView["articles"][number];

function textOf(claim: EventSynthesisClaim | null | undefined, expectedArticleCount: number, bundle: IssueAnalysisBundle) {
  if (!claim || claim.status === "explicit_not_stated" || claim.status === "insufficient_evidence") return null;
  if (typeof claim.text !== "string" || !claim.text.trim()) return null;
  const refs = refsOf(claim.evidence).filter((ref) => validRef(ref, bundle));
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

function validRef(ref: EventSynthesisEvidence, bundle: IssueAnalysisBundle) {
  const locator = ref.locator;
  const shapeValid = typeof ref.article_id === "string"
    && typeof locator?.paragraph === "number"
    && typeof locator?.sentence === "number"
    && typeof ref.sentence_sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(ref.sentence_sha256);
  if (!shapeValid) return false;
  const articleExists = bundle.articles.some((article) => article.articleId === ref.article_id);
  if (!articleExists) return false;
  const entry = bundle.semanticProfiles.find((candidate) => candidate.articleId === ref.article_id);
  return Boolean(entry && entry.evidence.some((candidate) => (
    candidate.locator?.paragraph === locator?.paragraph
    && candidate.locator?.sentence === locator?.sentence
    && candidate.sentenceSha256?.toLowerCase() === ref.sentence_sha256?.toLowerCase()
  )));
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
  bundle,
}: {
  refs: unknown;
  label: string;
  articles?: Map<string, ArticleRef>;
  bundle: IssueAnalysisBundle;
}) {
  const valid = refsOf(refs).filter((ref) => validRef(ref, bundle)).slice(0, 6);
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

function EventExplanation({ bundle, issue, synthesis }: { bundle: IssueAnalysisBundle; issue: IssueView; synthesis: EventSynthesisData | null }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const currentSynthesis = synthesisRunMatches(bundle, synthesis) ? synthesis : null;
  const paragraphs = (currentSynthesis?.event_paragraphs ?? [])
    .map((claim) => ({ claim, text: textOf(claim, issue.articleCount, bundle) }))
    .filter((entry): entry is { claim: EventSynthesisClaim; text: string } => Boolean(entry.text));
  const fallback = paragraphs;
  const first = fallback[0]?.text ?? "공개 근거가 연결된 사건 설명을 아직 표시할 수 없습니다.";
  const more = fallback.slice(1, 4);
  const terms = (currentSynthesis?.terms ?? []).filter((term) => (
    term.term
    && term.gloss
    && refsOf(term.evidence).some((ref) => validRef(ref, bundle))
  ));
  return (
    <section className="afs-card afp-event-card-v2" id="sec-event-summary">
      <div className="afs-in afs-prose">
        <div className="afp-event-copy">
          <div className="afp-v2-section-kicker">사건 설명</div>
          <h2>무슨 일이 있었나</h2>
          <p className="afp-event-note">현재 분석 실행과 문장 근거가 연결된 사건 경위입니다.</p>
          <p className="afp-event-first">{first}</p>
        </div>
        <div className="afp-event-context">
          <div className="afp-v2-section-kicker">근거와 추가 경위</div>
          <p className="afp-event-context-note">첫 문장을 먼저 읽고, 필요한 경우 기사·문장 위치를 펼쳐 확인하세요.</p>
          <EvidenceDisclosure refs={fallback[0]?.claim?.evidence} label="첫 사건 설명 근거" articles={articles} bundle={bundle} />
          {more.length || terms.length ? (
            <details className="afp-event-more">
              <summary>사건 경위와 용어 더 보기</summary>
              {more.map((paragraph, index) => (
                <div className="afp-event-more-row" key={`${paragraph.text}-${index}`}>
                  <p>{paragraph.text}</p>
                  <EvidenceDisclosure refs={paragraph.claim?.evidence} label="사건 경위 근거" articles={articles} bundle={bundle} />
                </div>
              ))}
              {terms.length ? (
                <div className="afp-terms-v2">
                  <strong>기사에서 확인한 용어</strong>
                  {terms.map((term, index) => (
                    <div className="afp-term-v2" key={`${term.term}-${index}`}>
                      <b>{term.term}</b><span>{stripEvidenceTokens(term.gloss ?? "")}</span>
                      <EvidenceDisclosure refs={term.evidence} label="용어 근거" articles={articles} bundle={bundle} />
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

function AxisExplanation({ bundle, issue, summary, synthesis }: { bundle: IssueAnalysisBundle; issue: IssueView; summary: ComparisonSummary; synthesis: EventSynthesisData | null }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const commonOutletCount = new Set(summary.commonObservations.map((row) => row.outlet)).size;
  const observedCommonEvidence: EventSynthesisEvidence[] = summary.commonObservations.map((row) => ({
    article_id: row.articleId,
    locator: row.evidence.locator,
    sentence_sha256: row.evidence.sentence_sha256,
  }));
  const commonEvidence = observedCommonEvidence.length
    ? observedCommonEvidence
    : synthesis?.common_ground?.evidence ?? synthesis?.agreed_line?.evidence;
  const axisEvidence = refsOf(synthesis?.comparison_axis?.evidence).filter((ref) => validRef(ref, bundle));
  return (
    <section className="afs-card afp-axis-v2" id="sec-comparison-axis">
      <div className="afs-in">
        <div className="afp-axis-copy">
          <div className="afp-v2-section-kicker">
            {summary.status === "difference_confirmed" || summary.status === "no_clear_difference" ? "근거 연결된 비교" : "비교 분석 상태"}
          </div>
          <h2>
            {summary.status === "difference_confirmed" || summary.status === "no_clear_difference"
              ? summary.dimensionLabel ?? "매체 간 설명 비교"
              : "비교 분석 상태"}
          </h2>
          <p className="afp-axis-question-v2">{summary.question}</p>
        </div>
        <div className="afp-axis-context">
          <span className={`afp-comparison-status afp-status-${summary.status}`}>{summary.statusLabel}</span>
          {summary.commonText ? (
            <div className="afp-common-ground-v2">
              <strong>{summary.commonScope
                ? `${commonOutletCount > 1 ? "여러 매체" : "여러 기사"}에서 함께 확인한 설명 · ${summary.commonScope}`
                : "공통으로 확인한 설명"}</strong>
              <p>{summary.commonText}</p>
              <EvidenceDisclosure refs={commonEvidence} label="공통 설명 근거" articles={articles} bundle={bundle} />
            </div>
          ) : <p className="afp-state">공통 설명으로 묶을 공개 근거가 아직 확인되지 않았습니다.</p>}
          <div className="afp-comparison-difference">
            <strong>
              {summary.status === "difference_confirmed"
                ? "관측된 차이"
                : summary.status === "no_clear_difference"
                  ? "비교 결론"
                  : summary.status === "analysis_failed" ? "실패 사유" : "보류 사유"}
            </strong>
            <p>{summary.differenceText}</p>
          </div>
          {isPublishableEventSynthesis(bundle)
            && (summary.status === "difference_confirmed" || summary.status === "no_clear_difference")
            && axisEvidence.length
            ? <EvidenceDisclosure refs={axisEvidence} label="비교 질문 근거" articles={articles} bundle={bundle} />
            : null}
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
  bundle,
}: {
  group: ComparisonGroup;
  index: number;
  issue: IssueView;
  bundle: IssueAnalysisBundle;
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
          {group.observations.map((row, rowIndex) => {
            const article = articles.get(row.articleId);
            return (
              <article className="afp-proof-row-v2" key={`${row.articleId}-${row.evidence.sentence_sha256}-${rowIndex}`}>
                <div className="afp-proof-row-head">
                  <strong>{row.outlet}</strong>
                  <span>{row.title}</span>
                </div>
                <small className="afp-proof-dimension">{row.valueLabel} · {row.voiceKind === "journalist_narration" ? "기자 서술" : comparisonVoiceLabel(row.voiceKind)}</small>
                {row.publicParaphrase ? <p>{row.publicParaphrase}</p> : <p className="afp-state">공개 의역이 연결되지 않았습니다.</p>}
                <EvidenceDisclosure refs={observationEvidence(row)} label="이 기사 판단 근거" articles={articles} bundle={bundle} />
                {article?.url ? <a href={article.url} target="_blank" rel="noreferrer">원문 링크 열기 ↗</a> : null}
              </article>
            );
          })}
        </div>
      ) : <p className="afp-state">이 묶음에 연결된 공개 근거가 없습니다.</p>}
    </div>
  );
}

function groupDifference(group: ComparisonGroup, groups: ComparisonGroup[]) {
  const relationLabel = comparisonRelationLabel(group.relation);
  if (group.relation === "same_core" || group.relation === "same_core_with_detail") {
    return `${relationLabel}. 세부가 추가되어도 별도 매체 차이로 확정하지 않습니다.`;
  }
  if (group.relation === "insufficient_evidence") return "근거가 부족해 이 묶음의 관계를 확정하지 않습니다.";
  const others = groups
    .filter((candidate) => candidate.key !== group.key)
    .flatMap((candidate) => candidate.outlets)
    .filter((outlet, index, all) => all.indexOf(outlet) === index);
  return `${relationLabel}. ${group.outlets.join("·") || "확인된 매체"}의 기사 근거와 ${others.join("·") || "다른 근거"}를 함께 확인하세요.`;
}

function ComparisonGroups({ bundle, issue, summary }: { bundle: IssueAnalysisBundle; issue: IssueView; summary: ComparisonSummary }) {
  const allGroups = summary.allGroups;
  const visibleGroups = summary.representativeGroups;
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const [selectedKey, setSelectedKey] = useState<string | null>(visibleGroups[0]?.key ?? null);
  const selectedGroup = selectedKey ? allGroups.find((group) => group.key === selectedKey) ?? null : null;
  const selectedIndex = selectedGroup ? allGroups.findIndex((group) => group.key === selectedGroup.key) : -1;
  const remainingGroups = allGroups.filter((group) => !visibleGroups.some((visible) => visible.key === group.key));
  return (
    <section className="afs-card afp-camps-v2" id="sec-camps">
      <div className="afs-in">
        <div className="afp-camp-heading">
          <div>
            <div className="afp-v2-section-kicker">언론사 비교</div>
          <h2>{allGroups.length >= 2 ? `${allGroups.length}개의 근거 연결 비교` : allGroups.length === 1 ? "근거 연결 비교 1개" : "기사별 판정 상태"}</h2>
          </div>
          <p>
            {allGroups.length >= 2
              ? "대표 카드는 매체가 겹치지 않도록 고르고, 나머지 비교도 아래에서 확인할 수 있습니다."
              : "확인된 비교 근거만 표시하며, 취재원 발언은 언론사 입장과 분리합니다."}
          </p>
        </div>
        {allGroups.length ? (
          <>
            <div className="afp-camp-grid-v2">
              {visibleGroups.map((group, index) => {
                const active = selectedKey === group.key;
                const proofIndex = allGroups.findIndex((candidate) => candidate.key === group.key);
                return (
                  <button
                    type="button"
                    className={`afp-camp-card-v2${active ? " is-selected" : ""}`}
                    key={`${group.key}-${index}`}
                    aria-expanded={active}
                    aria-controls={`comparison-proof-${proofIndex}`}
                    onClick={() => setSelectedKey(active ? null : group.key)}
                  >
                    <span className="afp-camp-letter">묶음 {String.fromCharCode(65 + index)}</span>
                    <span className="afp-camp-headline" role="heading" aria-level={3}>{group.title}</span>
                    <span className="afp-camp-meta">{group.outlets.join(" · ")} · 기사 {group.articleCount}건</span>
                    <span className="afp-camp-meta">{group.voiceLabel}</span>
                    {distinctComparisonSummary(group)
                      ? <span className="afp-camp-summary"><b>요약</b>{distinctComparisonSummary(group)}</span>
                      : null}
                    {group.details.length ? (
                      <span className="afp-camp-details">
                        <small>대표 기사에서 함께 관측된 보조 설명</small>
                        {group.details.slice(0, 3).map((detail, detailIndex) => <span key={`${detail.label}-${detail.text}-${detail.outlet}-${detail.title}-${detailIndex}`}><b>{detail.label}</b>{detail.text}<small>{detail.outlet} · {detail.title}</small></span>)}
                      </span>
                    ) : null}
                    <span className="afp-camp-decisive"><b>비교 관계</b>{groupDifference(group, allGroups)}</span>
                    <span className="afp-proof-trigger">{active ? "기사 근거 닫기 ↑" : "기사 근거 보기 →"}</span>
                  </button>
                );
              })}
            </div>
            {remainingGroups.length ? (
              <details className="afp-remaining-groups">
                <summary>나머지 근거 묶음 {remainingGroups.length}개 보기</summary>
                <div className="afp-remaining-group-list">
                  {remainingGroups.map((group) => {
                    const active = selectedKey === group.key;
                    const proofIndex = allGroups.findIndex((candidate) => candidate.key === group.key);
                    return (
                      <button type="button" className={`afp-camp-card-v2 afp-camp-card-secondary${active ? " is-selected" : ""}`} key={group.key} aria-expanded={active} aria-controls={`comparison-proof-${proofIndex}`} onClick={() => setSelectedKey(active ? null : group.key)}>
                        <span className="afp-camp-letter">추가 묶음</span>
                        <span className="afp-camp-headline" role="heading" aria-level={3}>{group.title}</span>
                        <span className="afp-camp-meta">{group.outlets.join(" · ")} · 기사 {group.articleCount}건 · {group.voiceLabel}</span>
                        <span className="afp-proof-trigger">{active ? "기사 근거 닫기 ↑" : "기사 근거 보기 →"}</span>
                      </button>
                    );
                  })}
                </div>
              </details>
            ) : null}
            {selectedGroup && selectedIndex >= 0 ? <GroupProofPanel group={selectedGroup} index={selectedIndex} issue={issue} bundle={bundle} /> : null}
          </>
        ) : (
          <div className="afp-no-groups">
            <strong>{summary.statusLabel}</strong>
            <p>
              {summary.status === "analysis_failed"
                ? "비교 분석이 실패해 근거 묶음을 표시하지 않습니다."
                : summary.status === "no_clear_difference"
                  ? "공통 핵심은 확인했지만 별도 강조 차이를 카드로 나누지 않았습니다."
                  : "관계를 판단할 근거 연결이 충분하지 않아 비교 카드를 만들지 않았습니다."}
            </p>
            <p>기사별 공개 근거와 분석 상태는 아래 목록에서 확인할 수 있습니다. 비교 묶음이 없다는 사실만으로 모든 매체가 같은 입장이라고 결론 내리지는 않습니다.</p>
          </div>
        )}
        {summary.sourceGroups.length ? (
          <details className="afp-source-only-details">
            <summary>취재원 발언에서 관측된 내용 {summary.sourceGroups.length}개 · 언론사 비교에 사용하지 않음</summary>
            <p className="afp-source-only-note">인용·전언은 발화 주체의 말입니다. 근거가 있어도 해당 매체의 입장이나 기자 서술 차이로 바꾸지 않았습니다.</p>
            <div className="afp-source-only-list">
              {summary.sourceGroups.map((group) => (
                <article className="afp-source-only-item" key={group.key}>
                  <strong>{group.title}</strong>
                  <small>{group.outlets.join(" · ")} · 기사 {group.articleCount}건 · {group.voiceLabel}</small>
                  {group.observations.map((row) => {
                    return (
                      <div className="afp-source-only-observation" key={row.observationId}>
                        <span>{row.outlet} · {row.title}</span>
                        {row.publicParaphrase ? <p>{row.publicParaphrase}</p> : null}
                        <EvidenceDisclosure refs={observationEvidence(row)} label="발언 근거" articles={articles} bundle={bundle} />
                      </div>
                    );
                  })}
                </article>
              ))}
            </div>
          </details>
        ) : null}
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
  const summary = comparisonSummary(bundle);
  return (
    <div className="afp-comparison-lead-v2" data-comparison-status={summary.status} data-comparison-publishable={isPublishableEventSynthesis(bundle)}>
      <EventExplanation bundle={bundle} issue={issue} synthesis={synthesis} />
      <AxisExplanation bundle={bundle} issue={issue} summary={summary} synthesis={synthesis} />
      <ComparisonGroups bundle={bundle} issue={issue} summary={summary} />
    </div>
  );
}
