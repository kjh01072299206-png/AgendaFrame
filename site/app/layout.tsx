import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgendaFrame | 오늘의 의제·프레임 분석",
  description: "언론사 홈페이지 배치와 보도 프레임을 근거와 함께 비교하는 뉴스 분석 대시보드",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
