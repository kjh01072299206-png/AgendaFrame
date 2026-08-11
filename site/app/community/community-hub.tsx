"use client";

import { useState } from "react";
import top5Data from "../../data/top5-2026-07-26.json";
import { initialFiveTitle } from "../issue-titles";
import { CommunityPanel } from "../community-panel";

export default function CommunityHub() {
  const [issueId, setIssueId] = useState(top5Data.issues[0]?.issueId ?? "");
  return (
    <>
      <label className="community-issue-picker">대화할 의제<select value={issueId} onChange={(event) => setIssueId(event.target.value)}>{top5Data.issues.map((issue) => <option value={issue.issueId} key={issue.issueId}>{issue.rank}. {initialFiveTitle(issue.rank, issue.title)}</option>)}</select></label>
      {issueId && <CommunityPanel issueId={issueId} />}
    </>
  );
}
