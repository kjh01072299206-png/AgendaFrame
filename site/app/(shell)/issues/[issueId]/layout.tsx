import Link from "next/link";
import { deriveIssue, safeDecode } from "../../../../lib/initial-five/derive";
import { IssueSubject } from "../../issue-subject";
import { loadIssueBundle } from "./load";

export const dynamic = "force-dynamic";

export default async function IssueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ issueId: string }>;
}) {
  const { issueId } = await params;
  let bundle = null;
  try {
    bundle = await loadIssueBundle(params);
  } catch {
    bundle = null;
  }

  if (!bundle) {
    return (
      <div className="afs-card afs-card-lead" style={{ padding: "32px 24px", textAlign: "center" }}>
        <h2>의제 정보를 찾을 수 없습니다</h2>
        <p className="afs-prose" style={{ margin: "16px 0", color: "var(--afs-muted, #64748b)" }}>
          요청하신 의제(<code>{safeDecode(issueId)}</code>)는 현재 활성 스냅샷에 존재하지 않거나 만료되었습니다.
        </p>
        <Link className="afs-pill afs-pill-go" href="/" style={{ display: "inline-block", marginTop: "8px" }}>
          오늘의 상위 5개 의제로 돌아가기
        </Link>
      </div>
    );
  }

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

