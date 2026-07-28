/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import sourcePanel from "../data/sources.json";
import { configureSourcePanel, handleApiRequest, withDocumentSecurityHeaders, withSecurityHeaders } from "./runtime.mjs";

configureSourcePanel(sourcePanel);

interface ContentBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: Record<string, unknown>): Promise<unknown>;
}

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CONTENT: ContentBucket;
  ARTICLE_FETCHER?: Fetcher;
  IMPORT_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      const apiResponse = await handleApiRequest(request, env);
      if (apiResponse) return withSecurityHeaders(apiResponse);
    } catch (error) {
      console.error("AgendaFrame API request failed", error);
      return withSecurityHeaders(Response.json({ error: { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." } }, { status: 500 }));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return withSecurityHeaders(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    return withDocumentSecurityHeaders(await handler.fetch(request, env, ctx));
  },
};

export default worker;
