import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./admin.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://agendaframe-capstone.kjh01072299206.chatgpt.site";
const title = "AgendaFrame | 같은 사건, 다른 설명을 근거로 비교";
const description = "22개 주요 종합일간지·경제매체·뉴스통신사의 온라인 보도를 사건별로 묶고, 공통 사실과 설명 차이를 원문 근거와 분석 한계까지 함께 보여주는 뉴스 비교 도구입니다.";
const websiteStructuredData = JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: "AgendaFrame", url: siteUrl, description, inLanguage: "ko-KR" });

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
  themeColor: "#121826",
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
