import { getActiveSnapshot } from "../../../lib/active-snapshot";

export const dynamic = "force-dynamic";

const cacheHeaders = {
  "Cache-Control": "no-store",
};

export async function GET() {
  const active = await getActiveSnapshot();
  return Response.json(active.manifest, { headers: cacheHeaders });
}
