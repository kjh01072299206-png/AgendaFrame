import { fineComparison, FINE_STATUS_LABEL } from "../../lib/initial-five/fine-grained-comparison";
import { articleIntegrityReason, evidenceIntegrityValid } from "../../lib/initial-five/evidence-integrity";
import { DIM_LABEL } from "../../lib/initial-five/derive";
import type { IssueAnalysisBundle } from "../../lib/initial-five/types";

export function FineComparisonSection({ bundle }: { bundle: IssueAnalysisBundle }) {
  const result = fineComparison(bundle);
  return <section className="afs-card afp-fine-comparison" id="sec-fine-comparison">
    <h2>공통 핵심과 세밀한 차이 <small>표현·배치·취재원·맥락</small></h2>
    <div className="afs-in afs-prose">
      <p className="afs-note">핵심 설명의 공통성과 세부 관측은 별도로 판단합니다. 취재원의 말, 발언을 선택한 방식, 기자의 설명은 구분합니다.</p>
      {result.observations.map((item) => <article className="afp-fine-item" key={item.observation_id}>
        <header><h3>{item.headline}</h3><span className="afs-chip">{FINE_STATUS_LABEL[item.status]}</span></header>
        <p><strong>공통 내용</strong> {item.common}</p>
        <div className="afp-fine-pair">{item.articles.map((row, index) => {
          const article = bundle.articles.find((candidate) => candidate.articleId === row.article_id);
          return <section key={row.article_id} className="afp-fine-article">
            <h4>{String.fromCharCode(65 + index)} · {article?.outlet}</h4>
            <a href={article?.canonicalUrl ?? undefined} target="_blank" rel="noreferrer">{article?.title}</a>
            <p>{row.description}</p>
            <p className="afs-note">발화·확인 범위: {row.voice === "title_selection" ? "제목 선택" : row.voice === "journalist_narration" ? "기자 서술" : "취재원 발언"} · {row.scope}</p>
            <details className="afp-evidence"><summary>근거 위치·식별 정보</summary><p>기사 ID {row.article_id}</p>
              {row.title_basis ? <p>위치: 기사 제목 · SHA-256 {row.title_basis.title_sha256}</p> : row.evidence.map((ref, i) => <p key={i}>문단 {ref.locator?.paragraph} · 문장 {ref.locator?.sentence} · SHA-256 {ref.sentence_sha256}</p>)}
            </details>
          </section>;
        })}</div>
        <div className="afp-fine-commentary">
          <p><strong>구체적인 차이</strong> {item.difference}</p>
          <p><strong>중요도와 이유</strong> {({ low: "낮음", medium: "중간", high: "높음" })[item.importance.level]} · {item.importance.reason}</p>
          <p><strong>해석 가능한 범위</strong> {item.interpretation}</p>
          <p><strong>근거와 제한</strong> {item.limitations}</p>
        </div>
      </article>)}
      {result.pending ? <p className="afp-state">세밀한 관측 분석 대기: 기존 프로필에는 제목·본문 배치와 주변 문맥 비교가 저장되어 있지 않습니다. 원문과 새 관측 계약으로 재분석해야 하며, 이전 결과를 새 분석으로 표시하지 않습니다.</p> : null}
      {result.rejected.map((row, i) => <p className="afp-state" key={i}>{row.headline} · 보류: {row.reason}. 이 항목만 제외하며 다른 유효한 관측은 유지합니다.</p>)}
      {result.producer ? <p className="afs-note">관측 작성 방식: {result.producer === "editorial-title-review" ? "저장 제목을 직접 대조한 편집 검토 · AI 재분석 아님" : "근거 연결 분석 초안"}</p> : null}
    </div>
  </section>;
}

export function ArticleExplanations({ bundle }: { bundle: IssueAnalysisBundle }) {
  return <section className="afs-card afp-article-explanations" id="sec-article-explanations"><h2>기사별 설명과 확인 범위</h2><div className="afs-in">
    {bundle.articles.map((article) => {
      const entry = bundle.semanticProfiles.find((row) => row.articleId === article.articleId);
      const reason = articleIntegrityReason(bundle, article.articleId);
      return <article className="afp-article-prose" key={article.articleId}><h3>{article.outlet}</h3><a href={article.canonicalUrl ?? undefined} target="_blank" rel="noreferrer">{article.title}</a>
        {reason ? <p className="afp-state">보류: {reason}. 유효한 문장 분석으로 노출하지 않습니다.</p> : <>
          {Object.entries(entry?.profile?.dimensions ?? {}).map(([dimension, node]) => {
            const unique = (node.items ?? []).filter((item, i, rows) => rows.findIndex((other) => other.claim_id === item.claim_id && other.public_paraphrase === item.public_paraphrase) === i
              && evidenceIntegrityValid(bundle, { ...item.evidence, article_id: article.articleId }, item.voice?.kind));
            return unique.length ? <section key={dimension}><h4>{DIM_LABEL[dimension] ?? dimension}</h4>{unique.map((item, i) => <p key={i}><strong>{item.voice?.kind === "journalist_narration" ? "기자 설명" : "취재원에게 귀속된 내용"}</strong> {item.public_paraphrase}</p>)}</section> : null;
          })}
          <p className="afs-note">저장된 문장 단위 의역입니다. {entry?.profile?.extraction?.input_truncated ? "입력이 잘렸으므로 부재·배제 여부를 판단할 수 없습니다." : "공개 의역에 없는 설명이 원문에도 없다고 단정하지 않습니다."} 공통점과 이 기사만의 차이는 위 비교 항목의 검증 범위에서만 읽어야 합니다.</p>
        </>}
      </article>;
    })}
  </div></section>;
}
