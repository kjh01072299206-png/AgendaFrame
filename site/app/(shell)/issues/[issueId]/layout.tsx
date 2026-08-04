import { notFound } from "next/navigation";
import { getInitialFiveIssueBundle, initialFiveManifest } from "../../../../lib/initial-five/artifacts";
import { deriveIssue, safeDecode } from "../../../../lib/initial-five/derive";
import { IssueSubject } from "../../issue-subject";

export function generateStaticParams() {
  return initialFiveManifest.issues.map((issue) => ({ issueId: issue.issueId }));
}

export default async function IssueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ issueId: string }>;
}) {
  const { issueId } = await params;
  const bundle = getInitialFiveIssueBundle(safeDecode(issueId));
  if (!bundle) notFound();
  const issue = deriveIssue(bundle);

  return (
    <>
      <IssueSubject
        issueId={issue.issueId}
        rank={issue.rank}
        title={issue.title}
        lead={issue.lead}
        category={issue.category}
        articleCount={issue.articleCount}
        outletCount={issue.outletCount}
        evidenceCount={issue.evidenceTotal}
        splitDimensions={issue.splitDimensions}
      />
      {/* 데이터가 요구하는 표시 규칙을 화면이 지킨다 — 아티팩트의 publication_rule 은
          "사람 검토 전에는 자동 분석 초안으로만 표시합니다" 이다. */}
      <p className="afs-prov">
        {issue.provenance.requiresHumanReview ? <b>자동 분석 초안 · 사람 검토 전</b> : <b>검토 완료</b>}
        {issue.provenance.model ? <span>코딩 {issue.provenance.model}</span> : null}
        {issue.provenance.analyzedChars ? (
          <span className="afs-num">
            분석 본문 기사당 평균 {issue.provenance.analyzedChars.mean.toLocaleString("ko-KR")}자 (
            {issue.provenance.analyzedChars.min.toLocaleString("ko-KR")}–
            {issue.provenance.analyzedChars.max.toLocaleString("ko-KR")}자)
          </span>
        ) : null}
        {issue.agreement?.mean != null ? (
          <a className="afs-link" href="/tools/method#일치율">
            <span className="afs-num">
              두 코더 일치율 {Math.round(issue.agreement.mean * 100)}% ({issue.agreement.articleCount}건 기준)
            </span>
          </a>
        ) : null}
        <span>근거는 문장 위치와 지문만 저장</span>
      </p>
      {children}
    </>
  );
}
