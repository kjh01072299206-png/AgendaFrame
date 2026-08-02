import { initialFiveManifest } from "../../../lib/initial-five/artifacts";

const cacheHeaders = {
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
};

export function GET() {
  return Response.json(initialFiveManifest, { headers: cacheHeaders });
}
