import { SettingsClient } from "./settings-client";

export const metadata = { title: "설정 | AgendaFrame" };

export default function SettingsPage() {
  return (
    <>
      <header className="afs-head">
        <h1>설정</h1>
      </header>
      <SettingsClient />
    </>
  );
}
