const KST_OFFSET_HOURS = 9;

function scheduledHours(policy) {
  const hours = policy?.polling?.scheduledHoursKst;
  if (!Array.isArray(hours) || !hours.length) {
    throw new TypeError("polling.scheduledHoursKst must contain at least one hour.");
  }
  const normalized = hours.map(Number);
  if (normalized.some((hour) => !Number.isSafeInteger(hour) || hour < 0 || hour > 23)) {
    throw new TypeError("polling.scheduledHoursKst must contain hours from 0 to 23.");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("polling.scheduledHoursKst must not contain duplicates.");
  }
  return [...normalized].sort((left, right) => left - right);
}

function kstHour(timestamp) {
  const instant = Number(timestamp);
  if (!Number.isSafeInteger(instant) || instant < 0) {
    throw new TypeError("scheduledTime must be a non-negative integer timestamp.");
  }
  return new Date(instant + KST_OFFSET_HOURS * 60 * 60_000).getUTCHours();
}

function slotForHour(hours, hour) {
  let slot = hours.length - 1;
  for (let index = 0; index < hours.length; index += 1) {
    if (hours[index] > hour) break;
    slot = index;
  }
  return slot;
}

export function selectScheduledDiscoverySlice(policy, scheduledTime) {
  if (!policy || !Array.isArray(policy.sources)) {
    throw new TypeError("A discovery policy with sources is required.");
  }
  const hours = scheduledHours(policy);
  const hour = kstHour(scheduledTime);
  const slot = slotForHour(hours, hour);
  const endpointIds = [];
  const sources = policy.sources.map((source) => {
    const enabled = Array.isArray(source.endpoints)
      ? source.endpoints.filter((endpoint) => endpoint.enabled)
      : [];
    const selected = enabled.length ? [enabled[slot % enabled.length]] : [];
    for (const endpoint of selected) endpointIds.push(`${source.id}:${endpoint.id}`);
    return { ...source, endpoints: selected };
  });
  return {
    policy: { ...policy, sources },
    summary: {
      slot,
      slotCount: hours.length,
      scheduledHourKst: hours[slot],
      observedHourKst: hour,
      sourceCount: sources.length,
      endpointCount: endpointIds.length,
      endpointIds,
    },
  };
}
