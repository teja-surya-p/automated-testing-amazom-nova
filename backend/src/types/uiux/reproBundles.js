import { canonicalizeUrl } from "../../library/url/urlFrontier.js";

function safeCanonical(url) {
  if (!url) {
    return null;
  }

  try {
    return canonicalizeUrl(url, {
      stripTrackingParams: true,
      preserveMeaningfulParamsOnly: false
    });
  } catch {
    return url;
  }
}

function severityRank(level = "P2") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

export function buildIssueRepro(issue = {}) {
  const url = issue.affectedUrl ?? issue.url ?? null;
  return {
    deviceId: issue.deviceId ?? null,
    deviceLabel: issue.deviceLabel ?? issue.viewportLabel ?? "default",
    viewportLabel: issue.viewportLabel ?? "default",
    step: issue.step ?? null,
    url,
    canonicalUrl: safeCanonical(url),
    targetSelector: issue.affectedSelector ?? null,
    actionContext: issue.actionContext ?? null,
    evidenceRefs: issue.evidenceRefs ?? []
  };
}

export function buildUiuxReproBundles(issues = []) {
  return issues.map((issue) => ({
    issueType: issue.issueType ?? "UNKNOWN",
    clusterKey: issue.clusterKey ?? null,
    rawSeverity: issue.rawSeverity ?? issue.severity ?? "P2",
    finalSeverity: issue.finalSeverity ?? issue.severity ?? "P2",
    rawConfidence: issue.rawConfidence ?? issue.confidence ?? 0.75,
    finalConfidence: issue.finalConfidence ?? issue.confidence ?? 0.75,
    repro: buildIssueRepro(issue)
  }));
}

export function attachTopReproToClusters(clusters = [], reproBundles = []) {
  const grouped = reproBundles.reduce((map, bundle) => {
    const key = bundle.clusterKey ?? `${bundle.issueType}|unknown`;
    const current = map.get(key) ?? [];
    map.set(key, [...current, bundle]);
    return map;
  }, new Map());

  return clusters.map((cluster) => {
    const bundles = grouped.get(cluster.clusterKey) ?? [];
    const topBundle = [...bundles].sort((left, right) => {
      const severityDiff = severityRank(left.finalSeverity) - severityRank(right.finalSeverity);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      if ((right.finalConfidence ?? 0) !== (left.finalConfidence ?? 0)) {
        return (right.finalConfidence ?? 0) - (left.finalConfidence ?? 0);
      }
      return (left.repro?.step ?? 9999) - (right.repro?.step ?? 9999);
    })[0];

    return {
      ...cluster,
      topRepro: topBundle?.repro ?? null
    };
  });
}
