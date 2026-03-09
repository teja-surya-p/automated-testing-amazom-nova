const SEVERITY_ORDER = ["P0", "P1", "P2", "P3"];

const BLOCKER_ISSUE_TYPES = new Set([
  "STUCK_LOADING",
  "NON_DISMISSABLE_MODAL",
  "OVERLAY_BLOCKING"
]);

function severityIndex(level = "P2") {
  const index = SEVERITY_ORDER.indexOf(level);
  return index >= 0 ? index : 2;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampConfidence(value) {
  return clamp(Number(value ?? 0.75), 0.2, 0.99);
}

export function bumpSeverity(level = "P2", maxLevel = "P1") {
  const current = severityIndex(level);
  const max = severityIndex(maxLevel);
  const next = Math.max(Math.min(current - 1, max), 0);
  return SEVERITY_ORDER[next] ?? level;
}

export function calibrateUiuxIssue({
  issue,
  clusterStats = {}
}) {
  const rawSeverity = issue?.severity ?? "P2";
  const rawConfidence = clampConfidence(issue?.confidence ?? 0.75);
  const blocker = BLOCKER_ISSUE_TYPES.has(issue?.issueType ?? "");
  const severityCap = blocker ? "P0" : "P1";

  let finalSeverity = rawSeverity;
  let finalConfidence = rawConfidence;
  const reasons = [];

  const viewportCount = Number(clusterStats.viewportCount ?? 1);
  const pageCount = Number(clusterStats.pageCount ?? 1);
  const occurrenceCount = Number(clusterStats.occurrenceCount ?? 1);

  if (viewportCount >= 2) {
    finalSeverity = bumpSeverity(finalSeverity, severityCap);
    finalConfidence = clampConfidence(finalConfidence + 0.08);
    reasons.push("multi-viewport-occurrence");
  }

  if (pageCount >= 3 || occurrenceCount >= 3) {
    finalSeverity = bumpSeverity(finalSeverity, severityCap);
    finalConfidence = clampConfidence(finalConfidence + 0.05);
    reasons.push("high-frequency-cluster");
  }

  if (occurrenceCount === 1 && finalSeverity === "P2" && finalConfidence < 0.72) {
    finalConfidence = clampConfidence(finalConfidence - 0.08);
    reasons.push("single-low-confidence-occurrence");
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

export function calibrateUiuxClusters(clusters = [], issues = []) {
  const issueByCluster = issues.reduce((map, issue) => {
    const key = issue.clusterKey ?? issue.issueType;
    const current = map.get(key) ?? [];
    map.set(key, [...current, issue]);
    return map;
  }, new Map());

  return clusters.map((cluster) => {
    const matched = issueByCluster.get(cluster.clusterKey) ?? [];
    const finalWorstSeverity =
      matched
        .map((issue) => issue.finalSeverity ?? issue.severity ?? "P2")
        .sort((left, right) => severityIndex(left) - severityIndex(right))[0] ??
      cluster.worstSeverity ??
      "P2";
    const finalConfidence =
      matched.length > 0
        ? clampConfidence(
            matched.reduce((sum, issue) => sum + (issue.finalConfidence ?? issue.confidence ?? 0.75), 0) /
              matched.length
          )
        : 0.75;

    return {
      ...cluster,
      rawWorstSeverity: cluster.worstSeverity ?? "P2",
      finalWorstSeverity,
      finalConfidence
    };
  });
}

