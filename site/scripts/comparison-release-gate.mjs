// Release readiness is separate from the valid rendering of a held state.
export function comparisonReleaseFailures(rows) {
  const failures = [];
  if (rows.length !== 5 || new Set(rows.map((row) => row.route)).size !== 5) {
    failures.push("다섯 이슈의 비교 결과를 모두 확인해야 합니다.");
  }
  for (const row of rows) {
    if (!row.publishable) failures.push(`${row.route}: 현재 비교 계약과 근거를 통과한 실제 분석 결과가 없습니다.`);
    if (row.status === "analysis_failed") failures.push(`${row.route}: 분석이 실패했습니다.`);
  }
  if (!rows.some((row) => row.publishable && ["difference_confirmed", "no_clear_difference"].includes(row.status))) {
    failures.push("모든 비교가 보류·실패 상태입니다. 화면 검사 통과만으로 분석 개선을 배포할 수 없습니다.");
  }
  return failures;
}
