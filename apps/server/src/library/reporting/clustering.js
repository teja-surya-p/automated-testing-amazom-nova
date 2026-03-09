const SEVERITY_ORDER = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

function safeUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function normalizePathFromUrl(url) {
  const parsed = safeUrl(url);
  if (!parsed) {
    return "/";
  }

  const normalized = parsed.pathname.replace(/\/+$/, "");
  return normalized || "/";
}

export function compareSeverity(left = "P2", right = "P2") {
  return (SEVERITY_ORDER[left] ?? 9) - (SEVERITY_ORDER[right] ?? 9);
}

export function pickWorstSeverity(...levels) {
  return [...levels]
    .filter(Boolean)
    .sort((left, right) => compareSeverity(left, right))[0] ?? "P2";
}

export function buildUiuxClusterKey(issue = {}) {
  const issueType = issue.issueType ?? "UNKNOWN";
  const viewportLabel = issue.viewportLabel ?? "default";
  const normalizedPath = normalizePathFromUrl(issue.affectedUrl ?? issue.url ?? "");
  const selector = issue.affectedSelector ?? "";
  return `${issueType}|${normalizedPath}|${viewportLabel}|${selector}`;
}

function buildOccurrence(issue = {}) {
  return {
    step: issue.step ?? null,
    url: issue.affectedUrl ?? null,
    severity: issue.severity ?? "P2",
    title: issue.title ?? issue.issueType ?? "Issue",
    evidenceRefs: issue.evidenceRefs ?? []
  };
}

function sortClusters(clusters = []) {
  return [...clusters].sort((left, right) => {
    const severityDiff = compareSeverity(left.worstSeverity, right.worstSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.clusterKey.localeCompare(right.clusterKey);
  });
}

export function upsertUiuxIssueClusters(clusters = [], issue = {}) {
  const clusterKey = buildUiuxClusterKey(issue);
  const pages = new Set();
  const nextClusters = clusters.map((entry) => {
    if (entry.clusterKey !== clusterKey) {
      return entry;
    }

    for (const page of entry.pagesAffected ?? []) {
      pages.add(page);
    }
    if (issue.affectedUrl) {
      pages.add(issue.affectedUrl);
    }

    return {
      ...entry,
      count: (entry.count ?? 0) + 1,
      worstSeverity: pickWorstSeverity(entry.worstSeverity, issue.severity ?? "P2"),
      pagesAffected: [...pages].slice(0, 40),
      occurrences: [...(entry.occurrences ?? []), buildOccurrence(issue)].slice(-30),
      sampleEvidenceRefs:
        (entry.sampleEvidenceRefs ?? []).length > 0
          ? entry.sampleEvidenceRefs
          : (issue.evidenceRefs ?? []).slice(0, 4)
    };
  });

  if (nextClusters.some((entry) => entry.clusterKey === clusterKey)) {
    return sortClusters(nextClusters);
  }

  const seededPages = issue.affectedUrl ? [issue.affectedUrl] : [];
  return sortClusters([
    ...nextClusters,
    {
      clusterKey,
      issueType: issue.issueType ?? "UNKNOWN",
      viewportLabel: issue.viewportLabel ?? "default",
      normalizedPath: normalizePathFromUrl(issue.affectedUrl ?? issue.url ?? ""),
      affectedSelector: issue.affectedSelector ?? null,
      count: 1,
      firstSeenStep: issue.step ?? null,
      worstSeverity: issue.severity ?? "P2",
      pagesAffected: seededPages,
      sampleEvidenceRefs: (issue.evidenceRefs ?? []).slice(0, 4),
      occurrences: [buildOccurrence(issue)]
    }
  ]);
}

export function buildUiuxIssueClusters(issues = []) {
  return issues.reduce((accumulator, issue) => upsertUiuxIssueClusters(accumulator, issue), []);
}

