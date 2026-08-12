import assert from "node:assert/strict";
import test from "node:test";

import { createSerialRequestGate } from "../worker/request-limiter.mjs";

test("one request gate preserves spacing across discovery, redirects, and body collection", async () => {
  const sleeps = [];
  const beforeRequest = createSerialRequestGate({
    minimumDelayMilliseconds: 3000,
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
  });
  await beforeRequest();
  await beforeRequest();
  await beforeRequest();
  assert.deepEqual(sleeps, [3000, 3000]);
});
