import Link from "next/link";

type HeaderSection = "compare" | "dashboard" | "tools";

const items: Array<{ href: string; label: string; section: HeaderSection }> = [
  { href: "/", label: "의제 비교", section: "compare" },
  { href: "/dashboard", label: "전체 데이터", section: "dashboard" },
  { href: "/tools", label: "도구", section: "tools" },
];

export default function SiteHeader({ active }: { active: HeaderSection }) {
  return (
    <header className="af-site-header">
      <div className="af-header-inner">
        <Link className="af-brand" href="/" aria-label="AgendaFrame 홈"><span aria-hidden="true">AF</span><strong>AgendaFrame</strong></Link>
        <nav className="af-global-nav" aria-label="주요 메뉴">
          {items.map((item) => <Link href={item.href} aria-current={active === item.section ? "page" : undefined} className={active === item.section ? "active" : ""} key={item.section}>{item.label}</Link>)}
        </nav>
      </div>
    </header>
  );
}
