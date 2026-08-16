"use client";

import { useState } from "react";
import type {
  EventSynthesisCamp,
  EventSynthesisClaim,
  EventSynthesisData,
  EventSynthesisEvidence,
  EventSynthesisProofRow,
} from "../../lib/initial-five/types";
import type { IssueView } from "../../lib/initial-five/derive";
import { stripEvidenceTokens } from "../../lib/initial-five/public-text.mjs";

type ArticleRef = IssueView["articles"][number];

function textOf(claim?: EventSynthesisClaim | null) {
  if (!claim || claim.status === "explicit_not_stated" || claim.status === "insufficient_evidence") return null;
  if (typeof claim.text !== "string" || !claim.text.trim()) return null;
  return stripEvidenceTokens(claim.text).trim() || null;
}

function refsOf(value: unknown): EventSynthesisEvidence[] {
  return Array.isArray(value)
    ? value.filter((ref): ref is EventSynthesisEvidence => Boolean(ref && typeof ref === "object"))
    : [];
}

function validRef(ref: EventSynthesisEvidence) {
  const locator = ref.locator;
  return typeof ref.article_id === "string"
    && typeof locator?.paragraph === "number"
    && typeof locator?.sentence === "number"
    && typeof ref.sentence_sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(ref.sentence_sha256);
}

function evidenceLabel(ref: EventSynthesisEvidence) {
  const locator = ref.locator ?? {};
  const place = [
    typeof locator.paragraph === "number" ? `문단 ${locator.paragraph}` : null,
    typeof locator.sentence === "number" ? `문장 ${locator.sentence}` : null,
  ].filter(Boolean).join(" · ");
  return `${ref.article_id ?? "기사"} · ${place || "위치 미상"}${ref.sentence_sha256 ? ` · hash ${ref.sentence_sha256.slice(0, 12)}…` : ""}`;
}

function EvidenceDisclosure({ refs, label }: { refs: unknown; label: string }) {
  const valid = refsOf(refs).filter(validRef).slice(0, 6);
  if (!valid.length) return <small className="afp-state">{label} 연결 대기</small>;
  return (
    <details className="afp-evidence afp-evidence-compact afp-v2-evidence">
      <summary>{label} {valid.length}개</summary>
      <div className="afp-evidence-body">
        {valid.map((ref, index) => <small key={`${evidenceLabel(ref)}-${index}`}>{evidenceLabel(ref)}</small>)}
      </div>
    </details>
  );
}

function voiceLabel(kind?: string) {
  if (kind === "journalist_narration") return "기자 서술 중심";
  if (kind === "source_attributed") return "취재원 발언 중심";
  if (kind === "mixed") return "기자 서술·취재원 혼합";
  return "발화 범위 미관측";
}

function campHeadline(camp: EventSynthesisCamp) {
  return camp.headline ?? camp.summary ?? camp.gist ?? camp.name ?? "관측된 보도 갈래";
}

function campSummary(camp: EventSynthesisCamp) {
  return camp.summary ?? camp.gist ?? "공개 근거가 연결된 보도 선택을 묶었습니다.";
}

function campProofRows(camp: EventSynthesisCamp, synthesis: EventSynthesisData | null): EventSynthesisProofRow[] {
  const direct = Array.isArray(camp.proof_rows) ? camp.proof_rows : [];
  if (direct.length) return direct;
  const ids = new Set(camp.article_ids ?? []);
  return (synthesis?.proof_rows ?? []).filter((row) => row.article_id && ids.has(row.article_id));
}

function ArticleProof({ row, article }: { row: EventSynthesisProofRow; article?: ArticleRef }) {
  const paraphrase = stripEvidenceTokens(row.public_paraphrase ?? row.text ?? "").trim();
  return (
    <article className="afp-proof-row-v2">
      <div className="afp-proof-row-head">
        <strong>{article?.outlet ?? row.outlet ?? "매체 미상"}</strong>
        <span>{article?.title ?? row.article_id ?? "기사 제목 미상"}</span>
      </div>
      {row.dimension ? <small className="afp-proof-dimension">{row.dimension}</small> : null}
      {paraphrase ? <p>{paraphrase}</p> : <p className="afp-state">공개 의역이 연결되지 않았습니다.</p>}
      <EvidenceDisclosure refs={row.evidence} label="이 기사 근거" />
      {article?.url ? <a href={article.url} target="_blank" rel="noreferrer">원문 링크 열기 ↗</a> : null}
    </article>
  );
}

function EventExplanation({ issue, synthesis }: { issue: IssueView; synthesis: EventSynthesisData | null }) {
  const paragraphs = (synthesis?.event_paragraphs ?? []).map(textOf).filter((text): text is string => Boolean(text));
  const fallback = paragraphs.length ? paragraphs : [issue.lead].filter((text): text is string => Boolean(text));
  const first = fallback[0] ?? "공개 근거가 연결된 사건 설명을 아직 표시할 수 없습니다.";
  const more = fallback.slice(1, 4);
  const terms = (synthesis?.terms ?? []).filter((term) => term.term && term.gloss);
  return (
    <section className="afs-card afp-event-card-v2" id="sec-event-summary">
      <div className="afs-in afs-prose">
        <div className="afp-v2-section-kicker">사건 설명</div>
        <p className="afp-event-note">이 의제의 기사들이 공통으로 다룬 사건을 먼저 설명한 뒤, 어디서 강조가 갈렸는지 이어서 보여줍니다.</p>
        <p className="afp-event-first">{first}</p>
        <EvidenceDisclosure refs={synthesis?.event_paragraphs?.[0]?.evidence} label="첫 사건 설명 근거" />
        {more.length || terms.length ? (
          <details className="afp-event-more">
            <summary>사건 경위와 용어 더 보기</summary>
            {more.map((paragraph, index) => (
              <div className="afp-event-more-row" key={`${paragraph}-${index}`}>
                <p>{paragraph}</p>
                <EvidenceDisclosure refs={synthesis?.event_paragraphs?.[index + 1]?.evidence} label="사건 경위 근거" />
              </div>
            ))}
            {terms.length ? (
              <div className="afp-terms-v2">
                <strong>기사에서 확인한 용어</strong>
                {terms.map((term, index) => (
                  <div className="afp-term-v2" key={`${term.term}-${index}`}>
                    <b>{term.term}</b><span>{stripEvidenceTokens(term.gloss ?? "")}</span>
                    <EvidenceDisclosure refs={term.evidence} label="용어 근거" />
                  </div>
                ))}
              </div>
            ) : null}
          </details>
        ) : null}
      </div>
    </section>
  );
}

function AxisExplanation({ issue, synthesis }: { issue: IssueView; synthesis: EventSynthesisData | null }) {
  const axis = synthesis?.comparison_axis;
  const common = textOf(synthesis?.common_ground) ?? issue.commonGround;
  const points = (axis?.points ?? []).map(textOf).filter((text): text is string => Boolean(text));
  const question = axis?.question ?? textOf(synthesis?.split_line) ?? issue.mainDifference;
  return (
    <section className="afs-card afp-axis-v2" id="sec-comparison-axis">
      <div className="afs-in">
        <div className="afp-v2-section-kicker">논조 갈래 축</div>
        {axis?.label ? <h2>{axis.label}</h2> : <h2>같은 사건을 어디에 초점을 두고 설명했나</h2>}
        {points.length ? <div className="afp-axis-points" aria-label="기사에서 관측된 비교 축">{points.map((point, index) => <span key={`${point}-${index}`}>{point}</span>)}</div> : null}
        <p className="afp-axis-question-v2">{question ?? "현재 공개 근거에서는 서로 다른 설명 축을 확정하지 않았습니다."}</p>
        <EvidenceDisclosure refs={axis?.evidence ?? synthesis?.split_line?.evidence} label="갈린 질문 근거" />
        {common ? (
          <div className="afp-common-ground-v2">
            <strong>공통으로 본 것</strong>
            <p>{common}</p>
            <EvidenceDisclosure refs={synthesis?.common_ground?.evidence} label="공통 사실 근거" />
          </div>
        ) : <p className="afp-state">공통 설명으로 묶을 공개 근거가 아직 확인되지 않았습니다.</p>}
      </div>
    </section>
  );
}

function CampProofPanel({ camp, index, issue, synthesis }: { camp: EventSynthesisCamp; index: number; issue: IssueView; synthesis: EventSynthesisData | null }) {
  const articles = new Map(issue.articles.map((article) => [article.articleId, article]));
  const rows = campProofRows(camp, synthesis);
  const campArticles = (camp.article_ids ?? []).map((id) => articles.get(id)).filter((article): article is ArticleRef => Boolean(article));
  return (
    <div className="afp-camp-proof-panel-v2" id={`camp-proof-${index}`}>
      <div className="afp-proof-panel-heading">
        <div>
          <span className="afp-v2-section-kicker">선택한 갈래의 기사 근거</span>
          <h3>{campHeadline(camp)}</h3>
        </div>
        <span>{campArticles.length || camp.article_ids?.length || 0}건 연결</span>
      </div>
      {rows.length ? (
        <div className="afp-proof-list-v2">{rows.slice(0, 12).map((row, rowIndex) => <ArticleProof key={`${row.article_id}-${rowIndex}`} row={row} article={row.article_id ? articles.get(row.article_id) : undefined} />)}</div>
      ) : (
        <div className="afp-proof-missing">
          <p>이 갈래의 기사별 공개 의역과 위치 해시가 연결되지 않았습니다.</p>
          <div>{campArticles.map((article) => <span key={article.articleId}>{article.outlet} · {article.title}</span>)}</div>
          <EvidenceDisclosure refs={camp.evidence} label="갈래 종합 근거" />
        </div>
      )}
    </div>
  );
}

function CampsExplanation({ issue, synthesis }: { issue: IssueView; synthesis: EventSynthesisData | null }) {
  const camps = (synthesis?.camps ?? []).filter((camp) => camp.name && (camp.article_ids?.length || camp.outlets?.length));
  const [selected, setSelected] = useState<number | null>(camps.length ? 0 : null);
  const selectedCamp = selected == null ? null : camps[selected] ?? null;
  return (
    <section className="afs-card afp-camps-v2" id="sec-camps">
      <div className="afs-in">
        <div className="afp-camp-heading">
          <div>
            <div className="afp-v2-section-kicker">보도 갈래</div>
            <h2>{camps.length ? `${camps.length}개의 강조 묶음` : "공통 보도"}</h2>
          </div>
          <p>{camps.length ? "카드를 선택하면 해당 묶음을 만든 기사 근거가 아래에 열립니다." : "서로 다른 근거 그룹이 충분히 확인되지 않아 억지로 대립 구도를 만들지 않았습니다."}</p>
        </div>
        {camps.length ? (
          <>
            <div className="afp-camp-grid-v2">
              {camps.slice(0, 4).map((camp, index) => {
                const articleCount = camp.article_ids?.length ?? 0;
                const outletCount = camp.outlets?.length ?? new Set((camp.article_ids ?? []).map((id) => issue.articles.find((article) => article.articleId === id)?.outlet).filter(Boolean)).size;
                const active = selected === index;
                return (
                  <button
                    type="button"
                    className={`afp-camp-card-v2${active ? " is-selected" : ""}`}
                    key={`${camp.name}-${index}`}
                    aria-expanded={active}
                    aria-controls={`camp-proof-${index}`}
                    onClick={() => setSelected(active ? null : index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(active ? null : index);
                      }
                    }}
                  >
                    <span className="afp-camp-letter">갈래 {String.fromCharCode(65 + index)}</span>
                    <span className="afp-camp-headline" role="heading" aria-level={3}>{campHeadline(camp)}</span>
                    <span className="afp-camp-meta">{camp.outlets?.slice(0, 4).join(" · ") || "매체 미상"}</span>
                    <span className="afp-camp-meta">매체 {outletCount}곳 · 기사 {articleCount}건 · {voiceLabel(camp.voice_basis?.kind)}</span>
                    <span className="afp-camp-summary">{campSummary(camp)}</span>
                    <span className="afp-camp-decisive"><b>결정적 차이</b>{camp.decisive_difference ?? "이 갈래를 다른 묶음과 가른 관측 문장이 연결되지 않았습니다."}</span>
                    <span className="afp-proof-trigger">{active ? "기사 근거 닫기 ↑" : "기사 근거 보기 →"}</span>
                  </button>
                );
              })}
            </div>
            {selectedCamp && selected != null ? <CampProofPanel camp={selectedCamp} index={selected} issue={issue} synthesis={synthesis} /> : null}
          </>
        ) : <p className="afp-state">이번 기사 묶음에서 두 개 이상의 실제 강조 갈래를 확인하지 못했습니다. 공통 설명과 기사별 판정 근거를 아래에서 확인할 수 있습니다.</p>}
      </div>
    </section>
  );
}

export function ComparisonLead({ issue, synthesis }: { issue: IssueView; synthesis: EventSynthesisData | null }) {
  return (
    <div className="afp-comparison-lead-v2">
      <EventExplanation issue={issue} synthesis={synthesis} />
      <AxisExplanation issue={issue} synthesis={synthesis} />
      <CampsExplanation issue={issue} synthesis={synthesis} />
    </div>
  );
}
