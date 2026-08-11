import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectScheduledDiscoverySlice } from "../worker/collection-work-slice.mjs";

const schedule = JSON.parse(readFileSync(new URL("../data/collection-schedule.json", import.meta.url), "utf8"));
const policy = JSON.parse(readFileSync(new URL("../data/discovery-sources.json", import.meta.url), "utf8"));
const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

test("configures exactly four evenly spaced KST collection runs", () => {
  assert.deepEqual(schedule, {
    schemaVersion: 1,
    enabled: true,
    timezone: "Asia/Seoul",
    runsPerDay: 4,
    scheduledHoursKst: [0, 6, 12, 18],
    cronsUtc: ["0 3,9,15,21 * * *"],
  });
  assert.equal(policy.polling.intervalMinutes, 360);
  assert.equal(policy.polling.runsPerDay, schedule.runsPerDay);
  assert.deepEqual(policy.polling.scheduledHoursKst, schedule.scheduledHoursKst);
  assert.match(viteConfig, /triggers:\s*\{\s*crons:\s*collectionSchedule\.enabled\s*\?\s*collectionSchedule\.cronsUtc\s*:\s*\[\]/s);
});

test("the production build carries the four-times-daily cron trigger when present", () => {
  const wrangler = JSON.parse(readFileSync(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.deepEqual(wrangler.triggers?.crons, schedule.cronsUtc);
});

test("each KST run checks one endpoint per source and covers all four topic feeds in a day", () => {
  const instants = [
    "2026-08-09T15:00:00.000Z",
    "2026-08-09T21:00:00.000Z",
    "2026-08-10T03:00:00.000Z",
    "2026-08-10T09:00:00.000Z",
  ].map(Date.parse);
  const slices = instants.map((instant) => selectScheduledDiscoverySlice(policy, instant));
  assert.deepEqual(slices.map((entry) => entry.summary.scheduledHourKst), [0, 6, 12, 18]);
  for (const entry of slices) {
    assert.equal(entry.summary.sourceCount, 12);
    assert.equal(entry.summary.endpointCount, 12);
    assert.ok(entry.policy.sources.every((source) => source.endpoints.length === 1));
  }
  const khanEndpoints = slices.map((entry) => entry.policy.sources.find((source) => source.id === "khan").endpoints[0].id);
  assert.deepEqual(khanEndpoints, ["politics-rss", "economy-rss", "society-rss", "international-rss"]);
  const kbsEndpoints = slices.map((entry) => entry.policy.sources.find((source) => source.id === "kbs").endpoints[0].id);
  assert.deepEqual(kbsEndpoints, Array(4).fill("recent-news-sitemap"));
});

test("a manual run uses the most recent KST schedule slot", () => {
  const slice = selectScheduledDiscoverySlice(policy, Date.parse("2026-08-10T05:15:00.000Z"));
  assert.equal(slice.summary.observedHourKst, 14);
  assert.equal(slice.summary.scheduledHourKst, 12);
  assert.equal(slice.policy.sources.find((source) => source.id === "sbs").endpoints[0].id, "society-rss");
});
