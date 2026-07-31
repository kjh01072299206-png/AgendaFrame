import top5Data from "../../data/top5-2026-07-26.json";
import Link from "next/link";

const dimensionOrder = [
  "problem_definition",
  "causal_interpretation",
  "responsibility_attribution",
  "moral_evaluation",
  "treatment_recommendation",
];

const dimensionLabels: Record<string, string> = {
  problem_definition: "문제 정의",
  causal_interpretation: "원인 해석",
  responsibility_attribution: "책임 귀속",
  moral_evaluation: "평가",
  treatment_recommendation: "대응책·처방",
};

function formatScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function topPattern(axis: (typeof top5Data.issues)[number]["comparison"]["comparison_axes"][number]) {
  return axis.patterns?.slice().sort((left, right) => right.article_count - left.article_count)[0] ?? null;
}

export default function TopFiveFramingPage() {
  return (
    <main className="top5-pilot-page">
      <header className="top5-pilot-header">
        <Link className="top5-back-link" href="/">← AgendaFrame 홈</Link>
        <p className="top5-eyebrow">2026. 07. 26 · 본문 기반 파일럿</p>
        <h1>상위 5개 의제의 설명 차이</h1>
        <p className="top5-lede">
          7월 26일 수집 데이터 785건에서 의제집중도 상위 5개를 골라, 해당 25개 기사 본문을
          구조화된 프레임 코드북으로 분석했습니다.
        </p>
        <div className="top5-summary-strip">
          <span><b>5개</b> 상위 의제</span>
          <span><b>25건</b> 본문 분석</span>
          <span><b>10개</b> 종합일간지 표본</span>
          <span><b>본문 비저장</b> 위치·지문만 보관</span>
        </div>
        <div className="top5-method-note" role="note">
          <strong>분석 상태</strong>
          <span>코드북 기반 구조화 추출 초안입니다. Gemini 의미분석 결과가 아니며, 사건 묶음과 프레임 비교는 사람 검토 전입니다.</span>
        </div>
      </header>

      <section className="top5-issue-list" aria-label="상위 5개 의제">
        {top5Data.issues.map((issue) => (
          <article className="top5-issue-card" key={issue.issueId}>
            <header className="top5-issue-card-header">
              <div className="top5-rank">{String(issue.rank).padStart(2, "0")}</div>
              <div>
                <p className="top5-category">{issue.category} · {issue.clusterQuality === "review_required" ? "묶음 검토 필요" : "자동 묶음 초안"}</p>
                <h2>{issue.title}</h2>
                <p className="top5-issue-meta">의제집중도 {formatScore(issue.agendaScore)} · {issue.articleCount}건 · {issue.sourceCount}개 언론사</p>
              </div>
              <span className="top5-review-badge">사람 검토 전</span>
            </header>

            <div className="top5-axis-grid">
              {dimensionOrder.map((dimension) => {
                const axis = issue.comparison.comparison_axes?.find((candidate) => candidate.dimension === dimension);
                const pattern = axis ? topPattern(axis) : null;
                return (
                  <section className="top5-axis" key={dimension}>
                    <div className="top5-axis-title">
                      <h3>{dimensionLabels[dimension]}</h3>
                      <span>{axis?.observed_article_count ?? 0}/{issue.articleCount}건 관측</span>
                    </div>
                    {pattern ? (
                      <>
                        <p className="top5-pattern">{pattern.public_paraphrase}</p>
                        <div className="top5-outlets">
                          {pattern.outlets.map((outlet) => <span key={outlet}>{outlet}</span>)}
                        </div>
                        {pattern.evidence?.[0] && (
                          <p className="top5-evidence-locator">
                            근거 위치: {pattern.evidence[0].locator.paragraph}문단 {pattern.evidence[0].locator.sentence}문장 · 원문 비공개
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="top5-not-observed">분석 가능한 본문에서 확인되지 않음. 실제 부재나 의도적 누락을 뜻하지 않습니다.</p>
                    )}
                  </section>
                );
              })}
            </div>

            <details className="top5-article-details">
              <summary>연결된 기사 {issue.articleCount}건과 원문 링크 보기</summary>
              <div className="top5-article-list">
                {issue.articleMetadata.map((article) => (
                  <a href={article.canonicalUrl} target="_blank" rel="noreferrer" key={article.articleId}>
                    <span>{article.source}</span>
                    <strong>{article.title}</strong>
                    <small>원문 ↗</small>
                  </a>
                ))}
              </div>
            </details>
          </article>
        ))}
      </section>

      <footer className="top5-pilot-footer">
        <p>분석 근거는 기사 본문을 공개하거나 영구 저장하지 않고, 기사별 문단·문장 위치와 비복원 지문으로만 연결합니다.</p>
        <p>출처: BigKinds 내보내기 파일 · 2026년 7월 26일 · 결과 버전 {top5Data.schemaVersion}</p>
      </footer>
    </main>
  );
}
