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

export function buildAccessibilityRepro(issue = {}) {
  const url = issue.affectedUrl ?? issue.url ?? null;
  return {
    ruleId: issue.ruleId ?? issue.issueType ?? "A11Y_RULE",
    finalSeverity: issue.finalSeverity ?? issue.severity ?? "P2",
    step: issue.step ?? null,
    viewportLabel: issue.viewportLabel ?? "default",
    url,
    canonicalUrl: safeCanonical(url),
    selector: issue.affectedSelector ?? null,
    expected: issue.expected ?? "",
    actual: issue.actual ?? "",
    evidenceRefs: issue.evidenceRefs ?? []
  };
}

export function buildAccessibilityReproBundles(issues = []) {
  return issues.map((issue) => ({
    ruleId: issue.ruleId ?? issue.issueType ?? "A11Y_RULE",
    clusterKey: issue.clusterKey ?? null,
    rawSeverity: issue.rawSeverity ?? issue.severity ?? "P2",
    finalSeverity: issue.finalSeverity ?? issue.severity ?? "P2",
    rawConfidence: issue.rawConfidence ?? issue.confidence ?? 0.78,
    finalConfidence: issue.finalConfidence ?? issue.confidence ?? 0.78,
    repro: buildAccessibilityRepro(issue)
  }));
}

export function attachTopReproToAccessibilityClusters(clusters = [], reproBundles = []) {
  const grouped = reproBundles.reduce((map, bundle) => {
    const key = bundle.clusterKey ?? `${bundle.ruleId}|unknown`;
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

