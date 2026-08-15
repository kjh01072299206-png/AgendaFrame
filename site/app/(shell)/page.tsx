import { LiveHome } from "./live-home";
import { ActiveSnapshotHome } from "./active-home";
import { getActiveSnapshot } from "../../lib/active-snapshot";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const active = await getActiveSnapshot();
  return active.mode === "live" ? <ActiveSnapshotHome active={active} /> : <ActiveSnapshotHome active={active} />;
}


