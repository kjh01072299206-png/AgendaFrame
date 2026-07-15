interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1Database {
  prepare(query: string): unknown;
}

declare module "cloudflare:workers" {
  import type { AnyD1Database } from "drizzle-orm/d1";

  export const env: { DB?: AnyD1Database };
}
