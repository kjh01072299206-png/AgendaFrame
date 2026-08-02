import Link from "next/link";
import { SelfCheck } from "../../self-check";

export default function SelfCheckPage() {
  return (
    <main className="standalone-tool-page">
      <header className="standalone-tool-header">
        <Link href="/">← 의제 비교로 돌아가기</Link>
        <span>READING TOOL</span>
        <h1>내 읽기 점검</h1>
        <p>정답 점수가 아니라, 여러 기사를 비교할 때 놓치기 쉬운 질문을 스스로 확인합니다.</p>
      </header>
      <div className="standalone-tool-content"><SelfCheck /></div>
    </main>
  );
}
