import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./admin.css";

const siteUrl = "https://agendaframe-capstone.kjh01072299206.chatgpt.site";
const title = "AgendaFrame | 근거로 비교하는 뉴스 의제 분석";
const description = "5개 종합일간지 표본에서 같은 사건의 공통 사실과 설명 차이를 근거·불확실성과 함께 비교하는 뉴스 분석 서비스입니다.";
const websiteStructuredData = "{\"@context\":\"https://schema.org\",\"@type\":\"WebSite\",\"name\":\"AgendaFrame\",\"url\":\"https://agendaframe-capstone.kjh01072299206.chatgpt.site\",\"description\":\"5개 종합일간지 표본에서 같은 사건의 공통 사실과 설명 차이를 근거·불확실성과 함께 비교하는 뉴스 분석 서비스입니다.\",\"inLanguage\":\"ko-KR\"}";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: siteUrl,
    siteName: "AgendaFrame",
    title,
    description,
    images: [{ url: "/og-card.png", width: 1735, height: 909, alt: "여러 보도의 근거가 하나의 검증 원장으로 연결되는 추상 일러스트레이션" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-card.png"] },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#172033",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: websiteStructuredData }} />
      </body>
    </html>
  );
}
