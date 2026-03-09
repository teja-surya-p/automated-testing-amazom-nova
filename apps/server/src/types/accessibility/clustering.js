import {
  compareSeverity,
  normalizePathFromUrl,
  pickWorstSeverity
} from "../uiux/clustering.js";

export function buildA11yClusterKey(issue = {}) {
  const ruleId = issue.ruleId ?? issue.issueType ?? "A11Y_RULE";
  const normalizedPath = normalizePathFromUrl(issue.affectedUrl ?? issue.url ?? "");
  return `${ruleId}|${normalizedPath}`;
}

function buildOccurrence(issue = {}) {
  return {
    step: issue.step ?? null,
    url: issue.affectedUrl ?? null,
    severity: issue.severity ?? "P2",
    title: issue.title ?? issue.ruleId ?? issue.issueType ?? "Accessibility issue",
    evidenceRefs: issue.evidenceRefs ?? []
  };
}

function sortClusters(clusters = []) {
  return [...clusters].sort((left, right) => {
    const severityDiff = compareSeverity(left.worstSeverity, right.worstSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    if ((right.count ?? 0) !== (left.count ?? 0)) {
      return (right.count ?? 0) - (left.count ?? 0);
    }
    return String(left.clusterKey).localeCompare(String(right.clusterKey));
  });
}

export function upsertA11yIssueClusters(clusters = [], issue = {}) {
  const clusterKey = buildA11yClusterKey(issue);
  const pages = new Set();

  const next = clusters.map((cluster) => {
    if (cluster.clusterKey !== clusterKey) {
      return cluster;
    }

    for (const page of cluster.pagesAffected ?? []) {
      pages.add(page);
    }
    if (issue.affectedUrl) {
      pages.add(issue.affectedUrl);
    }

    return {
      ...cluster,
      count: (cluster.count ?? 0) + 1,
      worstSeverity: pickWorstSeverity(cluster.worstSeverity, issue.severity ?? "P2"),
      pagesAffected: [...pages].slice(0, 40),
      occurrences: [...(cluster.occurrences ?? []), buildOccurrence(issue)].slice(-30),
      sampleEvidenceRefs:
        (cluster.sampleEvidenceRefs ?? []).length > 0
          ? cluster.sampleEvidenceRefs
          : (issue.evidenceRefs ?? []).slice(0, 4)
    };
  });

  if (next.some((cluster) => cluster.clusterKey === clusterKey)) {
    return sortClusters(next);
  }

  const normalizedPath = normalizePathFromUrl(issue.affectedUrl ?? issue.url ?? "");
  return sortClusters([
    ...next,
    {
      clusterKey,
      ruleId: issue.ruleId ?? issue.issueType ?? "A11Y_RULE",
      normalizedPath,
      count: 1,
      firstSeenStep: issue.step ?? null,
      worstSeverity: issue.severity ?? "P2",
      pagesAffected: issue.affectedUrl ? [issue.affectedUrl] : [],
      sampleEvidenceRefs: (issue.evidenceRefs ?? []).slice(0, 4),
      occurrences: [buildOccurrence(issue)]
    }
  ]);
}

export function buildA11yIssueClusters(issues = []) {
  return issues.reduce((accumulator, issue) => upsertA11yIssueClusters(accumulator, issue), []);
}
