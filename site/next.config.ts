import type { NextConfig } from "next";

// Fallback rewrites only fire when no page, static file, or route handler
// matches. On the Workers deployment /api/* is handled by the worker before
// the framework, so these only take effect on Node hosts (e.g. Vercel),
// where legacy D1-backed APIs are proxied to the existing data origin.
const LEGACY_API_ORIGIN = "https://agendaframe-capstone.kjh01072299206.chatgpt.site";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${LEGACY_API_ORIGIN}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
