const SEVERITY_ORDER = ["P0", "P1", "P2", "P3"];

const P0_REPEAT_ELIGIBLE_RULES = new Set([
  "FOCUSABLE_HIDDEN",
  "REQUIRED_NOT_ANNOUNCED",
  "ERROR_NOT_ASSOCIATED",
  "DESCRIBEDBY_MISSING_TARGET"
]);

function severityIndex(level = "P2") {
  const index = SEVERITY_ORDER.indexOf(level);
  return index >= 0 ? index : 2;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampConfidence(value) {
  return clamp(Number(value ?? 0.78), 0.2, 0.99);
}

export function bumpSeverity(level = "P2", maxLevel = "P1") {
  const current = severityIndex(level);
  const max = severityIndex(maxLevel);
  const next = Math.max(current - 1, max);
  return SEVERITY_ORDER[next] ?? level;
}

function severityCapForIssue(issue = {}, clusterStats = {}) {
  const ruleId = issue.ruleId ?? issue.issueType ?? "A11Y_RULE";
  const repeats = Number(clusterStats.occurrenceCount ?? 1) >= 3;
  if (repeats && P0_REPEAT_ELIGIBLE_RULES.has(ruleId)) {
    return "P0";
  }
  return "P1";
}

export function calibrateAccessibilityIssue({
  issue,
  clusterStats = {}
}) {
  const rawSeverity = issue?.severity ?? "P2";
  const rawConfidence = clampConfidence(issue?.confidence ?? 0.78);
  const cap = severityCapForIssue(issue, clusterStats);

  let finalSeverity = rawSeverity;
  let finalConfidence = rawConfidence;
  const reasons = [];

  const viewportCount = Number(clusterStats.viewportCount ?? 1);
  const occurrenceCount = Number(clusterStats.occurrenceCount ?? 1);

  if (viewportCount >= 2) {
    finalSeverity = bumpSeverity(finalSeverity, cap);
    finalConfidence = clampConfidence(finalConfidence + 0.08);
    reasons.push("multi-viewport-cluster");
  }

  if (occurrenceCount >= 3) {
    finalSeverity = bumpSeverity(finalSeverity, cap);
    finalConfidence = clampConfidence(finalConfidence + 0.06);
    reasons.push("repeated-cluster");
  }

  return {
    ...issue,
    rawSeverity,
    rawConfidence,
    finalSeverity,
    finalConfidence,
    calibrationReasons: reasons
  };
}

export function calibrateAccessibilityClusters(clusters = [], issues = []) {
  const byCluster = issues.reduce((map, issue) => {
    const key = issue.clusterKey ?? issue.ruleId ?? issue.issueType ?? "A11Y_RULE";
    const current = map.get(key) ?? [];
    map.set(key, [...current, issue]);
    return map;
  }, new Map());

  return clusters.map((cluster) => {
    const matched = byCluster.get(cluster.clusterKey) ?? [];
    const finalWorstSeverity =
      matched
        .map((issue) => issue.finalSeverity ?? issue.severity ?? "P2")
        .sort((left, right) => severityIndex(left) - severityIndex(right))[0] ??
      cluster.worstSeverity ??
      "P2";

    const finalConfidence =
      matched.length > 0
        ? clampConfidence(
            matched.reduce((sum, issue) => sum + (issue.finalConfidence ?? issue.confidence ?? 0.78), 0) /
              matched.length
          )
        : 0.78;

    return {
      ...cluster,
      rawWorstSeverity: cluster.worstSeverity ?? "P2",
      finalWorstSeverity,
      finalConfidence
    };
  });
}
