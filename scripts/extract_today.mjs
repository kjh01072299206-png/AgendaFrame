process.env.AGENDAFRAME_LIVE_TESTS = "1";
import { readFileSync, writeFileSync } from "node:fs";
import {
  discoverArticlesFromDocument,
  resolveDiscoveryEndpointUrl,
  validateDiscoveryPolicy,
} from "../site/worker/article-discovery.mjs";

const policy = JSON.parse(readFileSync(new URL("../site/data/discovery-sources.json", import.meta.url), "utf8"));
validateDiscoveryPolicy(policy);

const allArticles = [];
const observedAt = new Date().toISOString();
const USER_AGENT = "AgendaFrame-Academic-Research/1.0 (+https://agendaframe-capstone.vercel.app/)";

for (const source of policy.sources) {
  for (const endpoint of source.endpoints) {
    if (!endpoint.enabled) continue;
    try {
      const resolvedEndpointUrl = resolveDiscoveryEndpointUrl({
        policy,
        source,
        endpoint,
        discoveredAt: observedAt,
      });
      const res = await fetch(resolvedEndpointUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const discovered = discoverArticlesFromDocument({
        policy,
        source,
        endpoint,
        document: text,
        contentType: res.headers.get("content-type") ?? "text/html",
        discoveredAt: observedAt,
      });
      for (const d of discovered) {
        allArticles.push({
          sourceId: source.id,
          sourceName: source.label ?? source.id,
          title: d.title,
          canonicalUrl: d.canonicalUrl,
          publishedAt: d.publishedAt ?? observedAt,
          topic: d.topic ?? endpoint.topic,
        });
      }
    } catch (err) {
      // ignore
    }
  }
}

writeFileSync(new URL("../site/data/today-articles-2026-08-15.json", import.meta.url), JSON.stringify(allArticles, null, 2), "utf8");
console.log(JSON.stringify({ totalDiscovered: allArticles.length, sample: allArticles.slice(0, 5) }, null, 2));
