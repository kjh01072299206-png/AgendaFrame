import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
