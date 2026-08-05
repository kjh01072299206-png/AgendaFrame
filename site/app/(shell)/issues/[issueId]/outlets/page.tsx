import { redirect } from "next/navigation";

/* 언론사 비교는 프레이밍 분석에 흡수했다. 같은 행렬을 매체별로 한 번, 조합별로 한 번 그리고 있었고
   '누구를 인용했나' 표와 '취재원의 말을 몇 번 실었나' 막대는 같은 숫자(행 합계)였다.
   기존 링크·북마크가 죽지 않게 주소만 남겨 넘긴다. */
export default async function OutletsPage({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = await params;
  redirect(`/issues/${encodeURIComponent(issueId)}/framing`);
}
