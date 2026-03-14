const SEVERITY_ORDER = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

const UIUX_ISSUE_FAMILY = Object.freeze({
  HORIZONTAL_SCROLL: "RESPONSIVE_OVERFLOW",
  TEXT_OVERFLOW_CLIP: "RESPONSIVE_OVERFLOW",
  LOCALIZATION_OVERFLOW_HINT: "RESPONSIVE_OVERFLOW",
  MEDIA_SCALING_BROKEN: "RESPONSIVE_OVERFLOW",
  CLIPPED_PRIMARY_CTA: "RESPONSIVE_OVERFLOW",
  CTA_PRIORITY_CONFLICT: "CTA_PRESENTATION",
  DUPLICATE_PRIMARY_CTA_LABELS: "CTA_PRESENTATION",
  OVERLAPPING_INTERACTIVE_CONTROLS: "LAYOUT_COLLISION",
  STICKY_OVERLAY_HIDES_CONTENT: "LAYOUT_COLLISION",
  SEVERE_ALIGNMENT_BREAK: "LAYOUT_COLLISION",
  OFFSCREEN_PRIMARY_NAV: "NAV_VISIBILITY",
  BROKEN_PRIMARY_NAV: "NAV_VISIBILITY",
  INCONSISTENT_PRIMARY_NAV: "NAV_VISIBILITY"
});

const UIUX_MERGEABLE_FAMILIES = new Set([
  "RESPONSIVE_OVERFLOW",
  "CTA_PRESENTATION",
  "LAYOUT_COLLISION",
  "NAV_VISIBILITY"
]);

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

function normalizeGroupCause(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quantizedRegionKey(issue = {}) {
  const box = issue?.highlight?.box ?? null;
  if (!box) {
    return "region:none";
  }
  const step = 48;
  const qx = Math.round(Number(box.x ?? 0) / step) * step;
  const qy = Math.round(Number(box.y ?? 0) / step) * step;
  const qw = Math.round(Number(box.width ?? 0) / step) * step;
  const qh = Math.round(Number(box.height ?? 0) / step) * step;
  return `region:${qx}:${qy}:${qw}:${qh}`;
}

function normalizeSelectorForFingerprint(selector = "") {
  return String(selector ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*>\s*/g, ">")
    .replace(/:nth-(child|of-type)\(\d+\)/g, `:nth-$1(#)`)
    .replace(/:eq\(\d+\)/g, ":eq(#)")
    .replace(/\[(data-testid|data-test|data-qa)=\"[^\"]+\"\]/g, "[$1]")
    .slice(0, 220);
}

function normalizeComponentLabel(issue = {}) {
  const raw = [
    issue.exactVisibleText,
    issue.repro?.actionContext?.label
  ]
    .find((value) => String(value ?? "").trim().length > 0) ?? "";
  return normalizeGroupCause(raw).slice(0, 80);
}

export function resolveUiuxIssueFamily(issueType = "") {
  const key = String(issueType ?? "").trim().toUpperCase();
  return UIUX_ISSUE_FAMILY[key] ?? (key || "UNKNOWN");
}

function normalizeBreakpointKey(issue = {}) {
  const range = issue?.breakpointRange ?? null;
  if (range && Number.isFinite(Number(range.minWidth)) && Number.isFinite(Number(range.maxWidth))) {
    return `bp:${Math.round(Number(range.minWidth))}-${Math.round(Number(range.maxWidth))}`;
  }
  const ranges = Array.isArray(issue?.breakpointRanges) ? issue.breakpointRanges : [];
  const first = ranges[0];
  if (first && Number.isFinite(Number(first.minWidth)) && Number.isFinite(Number(first.maxWidth))) {
    return `bp:${Math.round(Number(first.minWidth))}-${Math.round(Number(first.maxWidth))}`;
  }
  return "bp:any";
}

export function buildUiuxComponentFingerprint(issue = {}) {
  const selectorKey = normalizeSelectorForFingerprint(issue.affectedSelector ?? "");
  const regionKey = quantizedRegionKey(issue);
  const labelKey = normalizeComponentLabel(issue);

  const parts = [];
  if (selectorKey) {
    parts.push(`sel:${selectorKey}`);
  } else if (regionKey !== "region:none") {
    parts.push(regionKey);
  }
  if (labelKey) {
    parts.push(`lbl:${labelKey}`);
  }

  if (!parts.length) {
    parts.push(
      `fallback:${normalizeGroupCause(
        issue.summary ??
          issue.explanation?.whatHappened ??
          issue.actual ??
          issue.title ??
          issue.issueType ??
          "uiux-issue"
      ).slice(0, 120)}`
    );
  }

  return {
    key: parts.join("|"),
    selectorKey,
    regionKey,
    labelKey,
    confidence: selectorKey || regionKey !== "region:none" ? "strong" : "weak"
  };
}

export function buildUiuxGroupedCaseKey(issue = {}) {
  const issueType = issue.issueType ?? "UNKNOWN";
  const issueFamily = resolveUiuxIssueFamily(issueType);
  const normalizedPath = normalizePathFromUrl(issue.affectedUrl ?? issue.url ?? "");
  const componentFingerprint = buildUiuxComponentFingerprint(issue);
  const breakpointKey = normalizeBreakpointKey(issue);
  const mergeEligible =
    componentFingerprint.confidence === "strong" &&
    UIUX_MERGEABLE_FAMILIES.has(issueFamily);
  const canonicalFamily = mergeEligible ? issueFamily : issueType;
  return `${canonicalFamily}|${normalizedPath}|${componentFingerprint.key}|${breakpointKey}`;
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
