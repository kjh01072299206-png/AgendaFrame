export function createSerialRequestGate(options = {}) {
  const minimumDelayMilliseconds = Number(options.minimumDelayMilliseconds);
  if (!Number.isSafeInteger(minimumDelayMilliseconds) || minimumDelayMilliseconds < 0) {
    throw new TypeError("minimumDelayMilliseconds must be a non-negative integer.");
  }
  const sleep = typeof options.sleepImpl === "function"
    ? options.sleepImpl
    : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let requestCount = 0;
  return async function beforeRequest() {
    if (requestCount > 0) await sleep(minimumDelayMilliseconds);
    requestCount += 1;
  };
}
