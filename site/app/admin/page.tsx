import AdminClient from "./admin-client";

export const metadata = {
  title: "AgendaFrame | 데이터 관리",
  description: "BigKinds 기사 메타데이터를 가져오고 AgendaFrame 무료 분석을 실행합니다.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminClient />;
}
