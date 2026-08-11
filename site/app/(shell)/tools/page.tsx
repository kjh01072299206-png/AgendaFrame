import { redirect } from "next/navigation";

/** 도구는 사이드바에서 바로 고르므로 목록 화면을 따로 두지 않는다. */
export default function ToolsIndexPage() {
  redirect("/tools/ask");
}
