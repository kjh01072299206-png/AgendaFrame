import { notFound } from "next/navigation";
import { getActiveSnapshot } from "../../../../lib/active-snapshot";
import { getInitialFiveIssueBundle } from "../../../../lib/initial-five/artifacts";
import { deriveIssue, safeDecode } from "../../../../lib/initial-five/derive";
import { IssueSubject } from "../../issue-subject";

export const dynamic = "force-dynamic";

export default async function IssueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ issueId: string }>;
}) {
  const { issueId } = await params;
  const active = await getActiveSnapshot();
  const decodedIssueId = safeDecode(issueId);
  const bundle = active.getIssueBundle(decodedIssueId) ?? (active.mode === "demo" ? getInitialFiveIssueBundle(decodedIssueId) : null);
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
        splitDimensions={issue.splitDimensions}
      />
      {/* 아티팩트의 publication_rule 이 요구하는 표시는 이 한 줄이다. 모델 이름·분석 글자 수·
          지문 저장 방식은 방법론 화면에 한 번만 둔다 — 의제마다 다시 읽을 값이 아니다. */}
      <p className="afs-prov">
        {issue.provenance.requiresHumanReview ? <b>자동 분석 초안 · 사람 검토 전</b> : <b>검토 완료</b>}
        {issue.agreement?.mean != null ? (
          <a className="afs-link" href="/tools/method#일치율">
            <span className="afs-num">코더 일치 {Math.round(issue.agreement.mean * 100)}%</span>
          </a>
        ) : null}
      </p>
      {children}
    </>
  );
}
