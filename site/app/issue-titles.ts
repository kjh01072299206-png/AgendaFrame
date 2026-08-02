export const INITIAL_FIVE_TITLES: Record<number, string> = {
  1: "정점식 의원의 특검 보완수사권 주장",
  2: "권영진 의원의 정점식 의원 멱살 논란",
  3: "경산 아파트 방화·보복범죄 수사",
  4: "권경애 재판 불출석 손해배상 조정",
  5: "음성 외국인 집단 난투 사건",
};

export function initialFiveTitle(rank: number, fallback: string) {
  return INITIAL_FIVE_TITLES[rank] ?? fallback;
}
