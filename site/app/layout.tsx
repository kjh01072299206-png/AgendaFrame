import type { Metadata } from "next";
import "./globals.css";
import "./admin.css";

export const metadata: Metadata = {
  title: "AgendaFrame | 오늘의 의제·프레임 분석",
  description: "5개 언론사의 실제 기사 메타데이터를 바탕으로 의제 점수와 보도 프레임을 비교하는 뉴스 분석 대시보드",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
