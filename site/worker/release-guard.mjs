const OPERATORS = new Set(["gte", "lte", "gt", "lt", "eq"]);

export const DEFAULT_RELEASE_THRESHOLDS = {
  human_review: { minimum_independent_annotators: 2 },
  clustering: {
    pairwise_f1: { operator: "gte", value: 0.90 },
    overmerge_rate: { operator: "lte", value: 0.05 },
    undermerge_rate: { operator: "lte", value: 0.10 },
  },
  framing: {
    macro_f1: { operator: "gte", value: 0.80 },
    evidence_exact_substring_rate: { operator: "gte", value: 0.90 },
  },
  report: {
    citation_coverage: { operator: "gte", value: 0.95 },
    unsupported_claim_rate: { operator: "lte", value: 0.02 },
  },
  calibration: { required_before_numeric_confidence: true },
};

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function checkMetric(name, actual, rule) {
  if (!rule || !OPERATORS.has(rule.operator) || !finite(rule.value)) {
    return { name, passed: false, reason: "threshold_rule_invalid" };
  }
  if (!finite(actual)) return { name, passed: false, reason: "metric_missing", expected: rule };
  const passed = rule.operator === "gte" ? actual >= rule.value
    : rule.operator === "lte" ? actual <= rule.value
      : rule.operator === "gt" ? actual > rule.value
        : rule.operator === "lt" ? actual < rule.value
          : actual === rule.value;
  return { name, passed, actual, expected: rule };
}

function metricRules(section) {
  return Object.entries(section ?? {}).flatMap(([name, rule]) => {
    if (rule && typeof rule === "object" && "operator" in rule) return [[name, rule]];
    if (typeof rule === "number") return [[name, { operator: name.endsWith("_max") ? "lte" : "gte", value: rule }]];
    return [];
  });
}

export function evaluateReleaseGate({ thresholds = {}, metrics = {}, dataset = {}, holdout = {} } = {}) {
  const reasons = [];
  const failedChecks = [];
  const human = thresholds.human_review ?? {};
  const datasetReady = dataset.kind === "real"
    && dataset.status === "labeled"
    && dataset.annotators >= Number(human.minimum_independent_annotators ?? 2)
    && dataset.adjudicated === true
    && dataset.agreementReport === true
    && dataset.lockedHoldout === true
    && holdout.licensed === true;
  if (!datasetReady) reasons.push("real_double_annotated_licensed_locked_holdout_required");
  const policy = thresholds.release_policy ?? {};
  const operationalChecks = [
    ["require_semantic_review", "semantic_review_required"],
    ["require_staging_health_check", "staging_health_check_required"],
    ["require_canary_observation", "canary_observation_required"],
    ["require_rollback_drill", "rollback_drill_required"],
  ];
  for (const [flag, reason] of operationalChecks) {
    if (policy[flag] === true && holdout[flag.replace(/^require_/, "")] !== true) reasons.push(reason);
  }
  for (const [sectionName, rules] of Object.entries(thresholds)) {
    if (!["clustering", "framing", "report", "calibration"].includes(sectionName)) continue;
    for (const [name, rule] of metricRules(rules)) {
      const result = checkMetric(`${sectionName}.${name}`, metrics?.[sectionName]?.[name], rule);
      if (!result.passed) failedChecks.push(result);
    }
  }
  if (thresholds.calibration?.required_before_numeric_confidence && holdout.calibrationReady !== true) {
    reasons.push("calibration_required_before_numeric_confidence");
  }
  if (failedChecks.length) reasons.push("metric_threshold_failed");
  return {
    release_eligible: reasons.length === 0,
    status: reasons.length === 0 ? "pass" : "blocked",
    reasons,
    failedChecks,
    dataset: { ...dataset, ready: datasetReady },
  };
}

export function selectCanary({ candidates = [], trafficPercent = 5, now = 0 } = {}) {
  const percent = Math.max(0, Math.min(100, Number(trafficPercent)));
  const ordered = [...candidates].filter((candidate) => candidate?.version).sort((a, b) => String(a.version).localeCompare(String(b.version)));
  if (!ordered.length || percent <= 0) return { version: null, trafficPercent: 0, candidates: [] };
  const index = Math.abs(Number(now) || 0) % ordered.length;
  return { version: ordered[index].version, trafficPercent: percent, candidates: ordered.map(({ version }) => version) };
}

export function evaluateSlo({ metrics = {}, budgets = {} } = {}) {
  const failed = [];
  for (const [name, maximum] of Object.entries(budgets)) {
    const actual = Number(metrics[name]);
    if (!finite(actual) || !finite(Number(maximum)) || actual > Number(maximum)) failed.push({ name, actual: finite(actual) ? actual : null, maximum: Number(maximum) });
  }
  return { healthy: failed.length === 0, failed };
}

export function chooseRollback({ current = null, previous = null, releaseGate = null, slo = null } = {}) {
  if (!current || !previous) return { rollback: false, target: null, reason: "previous_version_missing" };
  if (releaseGate?.release_eligible === false) return { rollback: true, target: previous, reason: "release_gate_failed" };
  if (slo?.healthy === false) return { rollback: true, target: previous, reason: "slo_breached" };
  return { rollback: false, target: current, reason: "healthy" };
}
