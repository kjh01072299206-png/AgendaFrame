import { redirect } from "next/navigation";

/* 이슈 탐색은 첫 화면과 같은 일을 했다 — 의제 순위와 미리보기. 홈을 그 화면으로 만들었으므로
   여기는 주소만 남겨 넘긴다. */
export default function IssuesPage() {
  redirect("/");
}
