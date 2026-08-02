import Link from "next/link";
import SiteHeader from "../site-header";

const tools = [
  { href: "/tools/ask", label: "AI에게 묻기", description: "초기 5개 의제의 근거 기사로 확인할 수 있는 질문 도구" },
  { href: "/tools/self-check", label: "읽기 자기점검", description: "제목과 본문, 인용과 서술을 나눠 읽는 체크리스트" },
  { href: "/tools/method", label: "방법론", description: "AI 본문 분석과 규칙 기반 보조 지표의 범위" },
  { href: "/tools/community", label: "커뮤니티", description: "기사 근거를 바탕으로 의견을 나누는 공간" },
];

export default function ToolsPage() {
  return (
    <main className="af-page af-tool-page">
      <SiteHeader active="tools" />
      <div className="af-tool-shell">
        <header className="af-tool-intro"><span className="af-section-label">TOOLS</span><h1>분석 옆에 두는 도구</h1><p>읽고, 확인하고, 근거를 나누는 기능을 한곳에 모았습니다.</p></header>
        <div className="af-tool-list">
          {tools.map((tool) => <Link className="af-tool-link" href={tool.href} key={tool.href}><span><strong>{tool.label}</strong><small>{tool.description}</small></span><span aria-hidden="true">→</span></Link>)}
        </div>
      </div>
    </main>
  );
}
