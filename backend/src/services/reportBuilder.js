import {
  buildUiuxClusterKey,
  buildUiuxGroupedCaseKey,
  normalizePathFromUrl
} from "../library/reporting/clustering.js";
import {
  buildUiuxBaselinePayload,
  diffUiuxBaseline,
  readUiuxBaseline,
  resolveUiuxBaselineId,
  resolveUiuxBaselineMode,
  writeUiuxBaseline
} from "../types/uiux/baselineStore.js";
import {
  buildFunctionalBaselinePayload,
  diffFunctionalBaseline,
  readFunctionalBaseline,
  resolveFunctionalBaselineId,
  resolveFunctionalBaselineMode,
  writeFunctionalBaseline
} from "../types/functional/baselineStore.js";
import {
  attachTopReproToClusters,
  buildIssueRepro,
  buildUiuxReproBundles
} from "../types/uiux/reproBundles.js";
import {
  buildAccessibilityBaselinePayload,
  diffAccessibilityBaseline,
  readAccessibilityBaseline,
  resolveAccessibilityBaselineId,
  resolveAccessibilityBaselineMode,
  writeAccessibilityBaseline
} from "../types/accessibility/baselineStore.js";
import { buildA11yClusterKey } from "../types/accessibility/clustering.js";
import {
  attachTopReproToAccessibilityClusters,
  buildAccessibilityReproBundles
} from "../types/accessibility/reproBundles.js";
import {
  calibrateAccessibilityClusters,
  calibrateAccessibilityIssue
} from "../types/accessibility/severityPolicy.js";
import {
  calibrateUiuxClusters,
  calibrateUiuxIssue
} from "../types/uiux/severityPolicy.js";
import { calibrateUiuxJudgment } from "../types/uiux/judgment/calibration.js";

function outcomeLabel(status) {
  if (status === "passed") {
    return "PASS";
  }
  if (status === "soft-passed") {
    return "SOFT-PASS";
  }
  if (status === "cancelled") {
    return "STOPPED";
  }
  return "FAIL";
}

function flattenArtifacts(artifactIndex = {}) {
  return Object.entries(artifactIndex).flatMap(([kind, value]) => {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.map((entry) => ({ kind, ...entry }));
    }

    return [{ kind, ...value }];
  });
}

function isUiuxMode(session) {
  const mode = session?.runConfig?.testMode;
  const strategy = session?.runConfig?.exploration?.strategy;
  return mode === "uiux" || (mode === "default" && strategy === "coverage-driven");
}

function isAccessibilityMode(session) {
  return session?.runConfig?.testMode === "accessibility";
}

function buildIssueFamilyKey(issue = {}) {
  return [
    issue.issueType ?? "UNKNOWN",
    normalizePathFromUrl(issue.affectedUrl ?? issue.url ?? ""),
    issue.affectedSelector ?? ""
  ].join("|");
}

function buildClusterStats(issues = []) {
  return issues.reduce((map, issue) => {
    const familyKey = buildIssueFamilyKey(issue);
    const current = map.get(familyKey) ?? {
      viewportSet: new Set(),
      pageSet: new Set(),
      occurrenceCount: 0
    };
    current.occurrenceCount += 1;
    current.viewportSet.add(issue.viewportLabel ?? "default");
    if (issue.affectedUrl) {
      current.pageSet.add(issue.affectedUrl);
    }
    map.set(familyKey, current);
    return map;
  }, new Map());
}

function buildAccessibilityClusterStats(issues = []) {
  return issues.reduce((map, issue) => {
    const clusterKey = issue.clusterKey ?? buildA11yClusterKey(issue);
    const current = map.get(clusterKey) ?? {
      viewportSet: new Set(),
      pageSet: new Set(),
      occurrenceCount: 0
    };
    current.occurrenceCount += 1;
    current.viewportSet.add(issue.viewportLabel ?? "default");
    if (issue.affectedUrl) {
      current.pageSet.add(issue.affectedUrl);
    }
    map.set(clusterKey, current);
    return map;
  }, new Map());
}

function severityRank(level = "P3") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function sortUiuxDeviceSummary(entries = []) {
  return [...entries].sort((left, right) => {
    const severityDiff = severityRank(left.worstSeverity) - severityRank(right.worstSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    if ((right.totalChecksFailed ?? 0) !== (left.totalChecksFailed ?? 0)) {
      return (right.totalChecksFailed ?? 0) - (left.totalChecksFailed ?? 0);
    }
    return String(left.deviceLabel ?? "").localeCompare(String(right.deviceLabel ?? ""));
  });
}

function sortDeviceSummary(entries = []) {
  return [...entries].sort((left, right) => {
    const severityDiff = severityRank(left.worstSeverity) - severityRank(right.worstSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    if ((right.totalChecksFailed ?? 0) !== (left.totalChecksFailed ?? 0)) {
      return (right.totalChecksFailed ?? 0) - (left.totalChecksFailed ?? 0);
    }
    return String(left.deviceLabel ?? "").localeCompare(String(right.deviceLabel ?? ""));
  });
}

function normalizeBox(bounds, viewport) {
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const x = Number(bounds.x ?? 0);
  const y = Number(bounds.y ?? 0);
  const width = Number(bounds.width ?? 0);
  const height = Number(bounds.height ?? 0);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const clampedX = Math.max(0, Math.min(x, viewport.width - 1));
  const clampedY = Math.max(0, Math.min(y, viewport.height - 1));
  const maxWidth = Math.max(viewport.width - clampedX, 1);
  const maxHeight = Math.max(viewport.height - clampedY, 1);
  const clampedWidth = Math.max(1, Math.min(width, maxWidth));
  const clampedHeight = Math.max(1, Math.min(height, maxHeight));

  return {
    x: Math.round(clampedX),
    y: Math.round(clampedY),
    width: Math.round(clampedWidth),
    height: Math.round(clampedHeight)
  };
}

function buildUiuxIssueHighlight(issue = {}) {
  const sourceWidth = Number(issue.highlightSources?.viewport?.width ?? 0);
  const sourceHeight = Number(issue.highlightSources?.viewport?.height ?? 0);
  const viewport = {
    width: sourceWidth > 0 ? Math.round(sourceWidth) : 1280,
    height: sourceHeight > 0 ? Math.round(sourceHeight) : 720
  };

  const selectorBox = normalizeBox(issue.highlightSources?.selectorBounds, viewport);
  const overlayBox = normalizeBox(issue.highlightSources?.overlayBounds, viewport);
  const primaryCtaBox = normalizeBox(issue.highlightSources?.primaryCtaBounds, viewport);

  if (selectorBox) {
    return {
      kind: "box",
      box: selectorBox,
      viewport,
      confidence: 0.96,
      label: issue.title ?? issue.issueType ?? "UI issue"
    };
  }

  if (overlayBox) {
    return {
      kind: "box",
      box: overlayBox,
      viewport,
      confidence: 0.84,
      label: issue.title ?? issue.issueType ?? "UI issue"
    };
  }

  if (primaryCtaBox) {
    return {
      kind: "box",
      box: primaryCtaBox,
      viewport,
      confidence: 0.66,
      label: issue.title ?? issue.issueType ?? "UI issue"
    };
  }

  return {
    kind: "box",
    box: {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height
    },
    viewport,
    confidence: 0.35,
    label: issue.title ?? issue.issueType ?? "UI issue"
  };
}

function normalizeUiuxExplanation(issue = {}) {
  const explanation = issue.explanation ?? {};
  const whatHappened =
    String(explanation.whatHappened ?? explanation.whatsWrong ?? issue.title ?? issue.issueType ?? "").trim() ||
    "An objective UI/UX issue was detected.";
  const whyItFailed =
    String(explanation.whyItFailed ?? issue.actual ?? "").trim() ||
    "The visible UI state did not satisfy deterministic UI/UX checks.";
  const whyItMatters =
    String(explanation.whyItMatters ?? "").trim() ||
    "This can reduce usability and completion rates.";
  const recommendedFix = Array.isArray(explanation.recommendedFix)
    ? explanation.recommendedFix
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  return {
    whatHappened,
    whyItFailed,
    whyItMatters,
    recommendedFix
  };
}

function buildUiuxIssueSummary(issue = {}) {
  const explicitSummary = String(issue.summary ?? "").trim();
  if (explicitSummary) {
    return explicitSummary;
  }

  const explanation = normalizeUiuxExplanation(issue);
  return String(explanation.whatHappened || explanation.whyItFailed || issue.title || issue.issueType || "UI/UX issue detected").trim();
}

function pickUiuxPrimaryScreenshotEvidence(issue = {}) {
  const evidenceRefs = Array.isArray(issue.evidenceRefs) ? issue.evidenceRefs : [];
  const screenshot = evidenceRefs.find((entry) => {
    const type = String(entry?.type ?? "").toLowerCase();
    const ref = String(entry?.ref ?? "");
    return type === "screenshot" || /\.(png|jpe?g|webp)$/i.test(ref);
  });
  if (!screenshot?.ref) {
    return null;
  }
  const viewport = screenshot.viewport ?? issue.highlight?.viewport ?? null;
  return {
    type: "screenshot",
    ref: screenshot.ref,
    captureMode: screenshot.captureMode ?? "viewport",
    ...(viewport ? { viewport } : {})
  };
}

function uiuxRepresentativeViewportRank(issue = {}) {
  const label = String(issue.viewportLabel ?? issue.deviceLabel ?? "").toLowerCase();
  if (/desktop|laptop|macbook|thinkpad|xps/.test(label)) {
    return 0;
  }
  if (/tablet|ipad|tab/.test(label)) {
    return 1;
  }
  if (/mobile|iphone|pixel|galaxy|oneplus|xiaomi|oppo|vivo/.test(label)) {
    return 2;
  }
  return 3;
}

function compareUiuxPrimaryIssueCandidate(left = {}, right = {}) {
  const leftConfidence = Number(left.finalConfidence ?? left.confidence ?? 0);
  const rightConfidence = Number(right.finalConfidence ?? right.confidence ?? 0);
  if (rightConfidence !== leftConfidence) {
    return rightConfidence - leftConfidence;
  }

  const viewportRankDiff = uiuxRepresentativeViewportRank(left) - uiuxRepresentativeViewportRank(right);
  if (viewportRankDiff !== 0) {
    return viewportRankDiff;
  }

  const leftSeverity = left.finalSeverity ?? left.severity ?? "P2";
  const rightSeverity = right.finalSeverity ?? right.severity ?? "P2";
  const severityDiff = severityRank(leftSeverity) - severityRank(rightSeverity);
  if (severityDiff !== 0) {
    return severityDiff;
  }

  const leftStep = Number(left.step ?? Number.MAX_SAFE_INTEGER);
  const rightStep = Number(right.step ?? Number.MAX_SAFE_INTEGER);
  if (leftStep !== rightStep) {
    return leftStep - rightStep;
  }

  const leftDevice = String(left.deviceLabel ?? left.viewportLabel ?? "");
  const rightDevice = String(right.deviceLabel ?? right.viewportLabel ?? "");
  const deviceDiff = leftDevice.localeCompare(rightDevice);
  if (deviceDiff !== 0) {
    return deviceDiff;
  }

  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function worstSeverity(current = null, next = null) {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return severityRank(next) < severityRank(current) ? next : current;
}

function buildUiuxGroupedIssues(issues = []) {
  const groups = new Map();
  for (const issue of issues) {
    const groupId = buildUiuxGroupedCaseKey(issue);
    const current = groups.get(groupId) ?? {
      groupId,
      issues: [],
      deviceMap: new Map(),
      worstSeverity: null,
      worstFinalSeverity: null
    };
    current.issues.push(issue);
    current.worstSeverity = worstSeverity(current.worstSeverity, issue.severity ?? "P2");
    current.worstFinalSeverity = worstSeverity(
      current.worstFinalSeverity,
      issue.finalSeverity ?? issue.severity ?? "P2"
    );
    const deviceKey = String(issue.deviceId ?? issue.deviceLabel ?? issue.viewportLabel ?? "default");
    if (!current.deviceMap.has(deviceKey)) {
      current.deviceMap.set(deviceKey, {
        deviceId: issue.deviceId ?? null,
        deviceLabel: issue.deviceLabel ?? issue.viewportLabel ?? "default",
        viewportLabel: issue.viewportLabel ?? issue.deviceLabel ?? "default"
      });
    }
    groups.set(groupId, current);
  }

  return [...groups.values()]
    .map((entry) => {
      const sortedIssues = [...entry.issues].sort(compareUiuxPrimaryIssueCandidate);
      const primaryIssue = sortedIssues[0] ?? {};
      const primaryEvidence = pickUiuxPrimaryScreenshotEvidence(primaryIssue);
      const devices = [...entry.deviceMap.values()].sort((left, right) => {
        const labelDiff = String(left.deviceLabel ?? "").localeCompare(String(right.deviceLabel ?? ""));
        if (labelDiff !== 0) {
          return labelDiff;
        }
        return String(left.viewportLabel ?? "").localeCompare(String(right.viewportLabel ?? ""));
      });
      const explanation = normalizeUiuxExplanation(primaryIssue);

      return {
        groupId: entry.groupId,
        issueType: primaryIssue.issueType ?? "UNKNOWN",
        title: primaryIssue.title ?? primaryIssue.issueType ?? "UI/UX issue",
        summary: buildUiuxIssueSummary({
          ...primaryIssue,
          explanation
        }),
        severity: entry.worstFinalSeverity ?? entry.worstSeverity ?? "P2",
        finalSeverity: entry.worstFinalSeverity ?? entry.worstSeverity ?? "P2",
        rawSeverity: entry.worstSeverity ?? primaryIssue.severity ?? "P2",
        confidence: Number(primaryIssue.finalConfidence ?? primaryIssue.confidence ?? 0),
        affectedUrl: primaryIssue.affectedUrl ?? primaryIssue.url ?? null,
        canonicalUrl: primaryIssue.repro?.canonicalUrl ?? null,
        testcaseId: primaryIssue.testcaseId ?? null,
        testcaseTitle: primaryIssue.testcaseTitle ?? primaryIssue.testcaseId ?? null,
        affectedSelector: primaryIssue.affectedSelector ?? null,
        step: primaryIssue.step ?? null,
        expected: primaryIssue.expected ?? "",
        actual: primaryIssue.actual ?? "",
        whyItFailed: explanation.whyItFailed,
        explanation,
        judgmentPolicy: primaryIssue.judgmentPolicy ?? primaryIssue.testcaseJudgmentPolicy ?? "hard-fail",
        rawDetectorResult: primaryIssue.rawDetectorResult ?? null,
        llmJudgment: primaryIssue.llmJudgment ?? null,
        calibratedJudgment: primaryIssue.calibratedJudgment ?? null,
        calibratedVerdict:
          primaryIssue.calibratedJudgment?.verdict ??
          primaryIssue.calibratedVerdict ??
          "FAIL",
        downgradeReason: primaryIssue.downgradeReason ?? null,
        supportingSignalCounts: primaryIssue.supportingSignalCounts ?? null,
        highlight: primaryIssue.highlight ?? null,
        primaryEvidence: {
          screenshotRef: primaryEvidence?.ref ?? null,
          captureMode: primaryEvidence?.captureMode ?? "viewport",
          highlight: primaryIssue.highlight ?? null,
          viewport: primaryEvidence?.viewport ?? primaryIssue.highlight?.viewport ?? null
        },
        evidenceRefs: primaryEvidence ? [primaryEvidence] : [],
        devices,
        deviceLabel: devices[0]?.deviceLabel ?? primaryIssue.deviceLabel ?? "default",
        viewportLabel: devices[0]?.viewportLabel ?? primaryIssue.viewportLabel ?? "default",
        occurrenceCount: devices.length,
        secondaryOccurrences: sortedIssues
          .slice(0, 40)
          .map((issueOccurrence) => ({
            issueId: issueOccurrence.id ?? null,
            deviceId: issueOccurrence.deviceId ?? null,
            deviceLabel: issueOccurrence.deviceLabel ?? issueOccurrence.viewportLabel ?? "default",
            viewportLabel: issueOccurrence.viewportLabel ?? issueOccurrence.deviceLabel ?? "default",
            step: issueOccurrence.step ?? null,
            evidenceRefs: issueOccurrence.evidenceRefs ?? []
          }))
      };
    })
    .sort((left, right) => {
      const severityDiff = severityRank(left.severity) - severityRank(right.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      if ((right.occurrenceCount ?? 0) !== (left.occurrenceCount ?? 0)) {
        return (right.occurrenceCount ?? 0) - (left.occurrenceCount ?? 0);
      }
      const urlDiff = String(left.affectedUrl ?? "").localeCompare(String(right.affectedUrl ?? ""));
      if (urlDiff !== 0) {
        return urlDiff;
      }
      return String(left.groupId ?? "").localeCompare(String(right.groupId ?? ""));
    });
}

function buildAccessibilityDeviceSummary(session, issues = [], pagesScannedCount = 0) {
  const a11yCases = (session?.testCases ?? []).filter(
    (entry) => entry?.type === "accessibility" && entry?.caseKind === "A11Y_RULE"
  );
  const issueWorstByDevice = issues.reduce((map, issue) => {
    const label = issue.viewportLabel ?? "desktop";
    const current = map.get(label) ?? null;
    const next = issue.finalSeverity ?? issue.severity ?? "P2";
    if (!current || severityRank(next) < severityRank(current)) {
      map.set(label, next);
    }
    return map;
  }, new Map());

  const perDevice = new Map();
  for (const testCase of a11yCases) {
    const deviceLabel = testCase.deviceLabel ?? "desktop";
    const current = perDevice.get(deviceLabel) ?? {
      deviceLabel,
      pagesSeen: new Set(),
      pagesFailed: new Set(),
      totalChecksFailed: 0,
      worstSeverity: "P3"
    };
    if (testCase.pageUrl) {
      current.pagesSeen.add(testCase.pageUrl);
    }
    if (testCase.status === "failed") {
      if (testCase.pageUrl) {
        current.pagesFailed.add(testCase.pageUrl);
      }
      current.totalChecksFailed += 1;
      current.worstSeverity =
        severityRank(testCase.severity ?? "P2") < severityRank(current.worstSeverity)
          ? testCase.severity ?? "P2"
          : current.worstSeverity;
    }
    perDevice.set(deviceLabel, current);
  }

  if (!perDevice.size) {
    perDevice.set("desktop", {
      deviceLabel: "desktop",
      pagesSeen: new Set(),
      pagesFailed: new Set(),
      totalChecksFailed: 0,
      worstSeverity: issueWorstByDevice.get("desktop") ?? "P3"
    });
  }

  const summary = [...perDevice.values()].map((entry) => {
    const pagesSeenCount = entry.pagesSeen.size || pagesScannedCount;
    const pagesFailed = entry.pagesFailed.size;
    return {
      deviceLabel: entry.deviceLabel,
      pagesPassed: Math.max(pagesSeenCount - pagesFailed, 0),
      pagesFailed,
      totalChecksFailed: entry.totalChecksFailed,
      worstSeverity: issueWorstByDevice.get(entry.deviceLabel) ?? entry.worstSeverity
    };
  });

  return sortDeviceSummary(summary);
}

function buildFunctionalDeterministicSummary(functional = {}) {
  const flowsRun = functional.flowsRun ?? 0;
  const assertionsEvaluated = functional.assertionCounts?.evaluated ?? 0;
  const assertionsPassed = functional.assertionCounts?.passed ?? 0;
  const assertionsFailed = functional.assertionCounts?.failed ?? 0;
  const blockers = functional.blockers?.length ?? 0;
  return `Functional: ran ${flowsRun} flows, ${assertionsEvaluated} assertions, passed ${assertionsPassed}, failed ${assertionsFailed}, blockers ${blockers}`;
}

function attachAccessibilityDiffTopRepros(baselineDiff = null, clusters = []) {
  if (!baselineDiff) {
    return null;
  }

  const lookup = new Map(clusters.map((cluster) => [cluster.clusterKey, cluster.topRepro ?? null]));
  const decorate = (entries = []) =>
    entries.map((entry) => ({
      ...entry,
      topRepro: lookup.get(entry.clusterKey) ?? null
    }));

  return {
    ...baselineDiff,
    newClusters: decorate(baselineDiff.newClusters),
    severityIncreases: decorate(baselineDiff.severityIncreases),
    severityDecreases: decorate(baselineDiff.severityDecreases)
  };
}

function buildUiuxSummary({
  session,
  issues = [],
  groupedIssues = [],
  clusters = [],
  reproBundles = [],
  baselineDiff = null
}) {
  const uiux = session.uiux ?? {};
  const matrix = (uiux.pageDeviceMatrix ?? []).slice(-900);
  const deviceSummary = sortUiuxDeviceSummary(uiux.deviceSummary ?? []);
  const failingDevices = deviceSummary.filter((entry) => entry.pagesFailed > 0).map((entry) => entry.deviceLabel);
  const grouped = {};
  const byViewport = {};
  const stateQualityTypes = new Set([
    "EMPTY_STATE_WITHOUT_GUIDANCE",
    "ERROR_STATE_WITHOUT_ACTION",
    "SUCCESS_STATE_WITHOUT_NEXT_STEP",
    "PAGINATION_WITHOUT_CONTEXT",
    "SEARCH_RESULTS_WITHOUT_FEEDBACK"
  ]);
  const stateQuality = {};
  const judgmentCounts = {
    FAIL: 0,
    WARN: 0,
    INFO: 0,
    PASS: 0
  };
  for (const issue of issues) {
    const severity = issue.finalSeverity ?? issue.severity ?? "P2";
    const verdict = issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL";
    if (judgmentCounts[verdict] !== undefined) {
      judgmentCounts[verdict] += 1;
    }
    const key = `${issue.issueType}:${severity}`;
    grouped[key] = {
      issueType: issue.issueType,
      severity,
      count: (grouped[key]?.count ?? 0) + 1
    };

    const viewportLabel = issue.viewportLabel ?? "default";
    byViewport[viewportLabel] = {
      viewportLabel,
      p0: (byViewport[viewportLabel]?.p0 ?? 0) + (severity === "P0" ? 1 : 0),
      p1: (byViewport[viewportLabel]?.p1 ?? 0) + (severity === "P1" ? 1 : 0),
      p2: (byViewport[viewportLabel]?.p2 ?? 0) + (severity === "P2" ? 1 : 0)
    };

    if (stateQualityTypes.has(issue.issueType)) {
      const viewportState = stateQuality[viewportLabel] ?? {
        viewportLabel,
        empty: 0,
        error: 0,
        success: 0,
        pagination: 0,
        search: 0
      };
      if (issue.issueType === "EMPTY_STATE_WITHOUT_GUIDANCE") {
        viewportState.empty += 1;
      }
      if (issue.issueType === "ERROR_STATE_WITHOUT_ACTION") {
        viewportState.error += 1;
      }
      if (issue.issueType === "SUCCESS_STATE_WITHOUT_NEXT_STEP") {
        viewportState.success += 1;
      }
      if (issue.issueType === "PAGINATION_WITHOUT_CONTEXT") {
        viewportState.pagination += 1;
      }
      if (issue.issueType === "SEARCH_RESULTS_WITHOUT_FEEDBACK") {
        viewportState.search += 1;
      }
      stateQuality[viewportLabel] = viewportState;
    }
  }

  return {
    pagesVisited: (uiux.pagesVisited ?? []).length,
    uniqueStates: (uiux.uniqueStateHashes ?? []).length,
    topIssues: Object.values(grouped).sort((left, right) => right.count - left.count),
    byViewport: Object.values(byViewport).sort((left, right) => left.viewportLabel.localeCompare(right.viewportLabel)),
    stateQualityByViewport: Object.values(stateQuality).sort((left, right) =>
      left.viewportLabel.localeCompare(right.viewportLabel)
    ),
    coverage: {
      uniqueCanonicalUrls: (uiux.pagesVisited ?? []).length,
      interactionsAttempted: uiux.interactionsAttempted ?? 0,
      interactionsSkippedBySafety: uiux.interactionsSkippedBySafety ?? 0
    },
    effectiveBudget: uiux.effectiveBudget ?? {
      mode: "uiux",
      timeBudgetMs: session.runConfig?.budgets?.timeBudgetMs ?? null,
      maxPages: session.runConfig?.uiux?.maxPages ?? null,
      maxInteractionsPerPage: session.runConfig?.uiux?.maxInteractionsPerPage ?? null,
      checkCount: null,
      deviceCount: session.runConfig?.uiux?.devices?.maxDevices ?? null
    },
    deviceSummary,
    pageDeviceMatrix: matrix,
    failingDevices,
    artifacts: {
      artifactsPrunedCount: uiux.artifactsPrunedCount ?? 0,
      artifactsRetainedCount: uiux.artifactsRetainedCount ?? 0,
      issueOnlyArtifacts:
        Boolean(session.runConfig?.uiux?.artifactRetention?.keepOnlyFailedOrFlaggedSteps) ||
        Boolean(session.runConfig?.uiux?.artifactRetention?.keepDomForIssuesOnly)
    },
    clusters: {
      count: clusters.length
    },
    reproBundles: {
      count: reproBundles.length
    },
    groupedFailures: {
      count: groupedIssues.length
    },
    judgmentCounts,
    baseline: {
      mode: resolveUiuxBaselineMode(session.runConfig),
      enabled: resolveUiuxBaselineMode(session.runConfig) !== "off",
      hasDiff: Boolean(baselineDiff),
      newClusters: baselineDiff?.newClusters?.length ?? 0,
      resolvedClusters: baselineDiff?.resolvedClusters?.length ?? 0,
      severityIncreases: baselineDiff?.severityIncreases?.length ?? 0,
      severityDecreases: baselineDiff?.severityDecreases?.length ?? 0
    }
  };
}

function buildAccessibilitySummary({
  session,
  issues = [],
  clusters = [],
  baselineDiff = null,
  focusProbeFindings = []
}) {
  const contrastSummary = session?.accessibility?.contrastSummary ?? {
    enabled: false,
    pagesEvaluated: 0,
    sampleLimit: 40,
    minRatioNormalText: 4.5,
    minRatioLargeText: 3.0,
    sampledCount: 0,
    offenderCount: 0,
    worstRatio: null,
    worstOffenders: []
  };
  const textScaleSummary = session?.accessibility?.textScaleSummary ?? {
    enabled: false,
    scales: [1, 1.25, 1.5],
    pagesEvaluated: 0,
    pagesWithBreaks: 0,
    breakByScale: [],
    worstBreak: null
  };
  const reducedMotionSummary = session?.accessibility?.reducedMotionSummary ?? {
    enabled: false,
    pagesEvaluated: 0,
    pagesWithPersistentMotion: 0,
    maxLongAnimationCount: 0,
    worstCase: null
  };
  const formSummary = session?.accessibility?.formSummary ?? {
    enabled: false,
    mode: "observe-only",
    safeSubmitTypes: ["search"],
    pagesEvaluated: 0,
    controlsObserved: 0,
    visibleErrorsObserved: 0,
    requiredNotAnnouncedCount: 0,
    errorNotAssociatedCount: 0,
    errorNotAnnouncedCount: 0,
    describedByMissingTargetCount: 0,
    invalidFieldNotFocusedCount: 0,
    safeSubmitAttempts: 0,
    safeSubmitSkips: 0,
    sampleFieldSelectors: []
  };
  const ruleCounts = {};
  const ruleSeverityCounts = {};
  const severityCounts = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0
  };

  for (const issue of issues) {
    const ruleId = issue.ruleId ?? issue.issueType ?? "A11Y_RULE";
    const severity = issue.finalSeverity ?? issue.severity ?? "P2";
    ruleCounts[ruleId] = (ruleCounts[ruleId] ?? 0) + 1;
    severityCounts[severity] = (severityCounts[severity] ?? 0) + 1;
    const ruleSeverityKey = `${ruleId}|${severity}`;
    ruleSeverityCounts[ruleSeverityKey] = (ruleSeverityCounts[ruleSeverityKey] ?? 0) + 1;
  }

  const pagesScanned = (session.accessibility?.pagesScanned ?? []).length;
  const ruleCountsSorted = Object.entries(ruleCounts)
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.ruleId.localeCompare(right.ruleId);
    });
  const deviceSummary = buildAccessibilityDeviceSummary(session, issues, pagesScanned);
  const failedDevices = deviceSummary.filter((entry) => (entry.pagesFailed ?? 0) > 0);
  const topFailingRules = ruleCountsSorted.slice(0, 3).map((entry) => entry.ruleId);
  const summaryText = [
    `Accessibility: scanned ${pagesScanned} pages across ${deviceSummary.length} devices;`,
    `passed on ${Math.max(deviceSummary.length - failedDevices.length, 0)} device(s);`,
    `failed on ${failedDevices.length} device(s);`,
    `top failing rules ${topFailingRules.length ? topFailingRules.join(", ") : "none"}.`
  ].join(" ");

  return {
    pagesScanned,
    issuesCount: issues.length,
    clustersCount: clusters.length,
    severityCounts,
    ruleCounts: ruleCountsSorted,
    ruleSeverityCounts: Object.entries(ruleSeverityCounts)
      .map(([key, count]) => {
        const [ruleId, severity] = key.split("|");
        return {
          ruleId,
          severity,
          count
        };
      })
      .sort((left, right) => {
        if (left.ruleId !== right.ruleId) {
          return left.ruleId.localeCompare(right.ruleId);
        }
        if (left.severity !== right.severity) {
          return left.severity.localeCompare(right.severity);
        }
        return right.count - left.count;
      }),
    keyboardProbeFindingsCount: focusProbeFindings.length,
    deviceSummary,
    failedDevices: failedDevices.map((entry) => entry.deviceLabel),
    summaryText,
    contrastSummary,
    textScaleSummary,
    reducedMotionSummary,
    formSummary,
    baseline: {
      mode: resolveAccessibilityBaselineMode(session.runConfig),
      enabled: resolveAccessibilityBaselineMode(session.runConfig) !== "off",
      hasDiff: Boolean(baselineDiff),
      newClusters: baselineDiff?.newClusters?.length ?? 0,
      resolvedClusters: baselineDiff?.resolvedClusters?.length ?? 0,
      severityIncreases: baselineDiff?.severityIncreases?.length ?? 0,
      severityDecreases: baselineDiff?.severityDecreases?.length ?? 0
    }
  };
}

function extractAccessibilityFocusProbeFindings(issues = []) {
  const keyboardRuleSet = new Set(["KEYBOARD_FOCUS_NOT_VISIBLE", "FOCUS_TRAP_DETECTED"]);
  return issues
    .filter((issue) => keyboardRuleSet.has(issue.ruleId ?? issue.issueType))
    .map((issue) => {
      const probe = issue.focusProbe ?? {};
      return {
        ruleId: issue.ruleId ?? issue.issueType ?? "A11Y_RULE",
        severity: issue.severity ?? "P2",
        step: issue.step ?? null,
        url: issue.affectedUrl ?? null,
        viewportLabel: issue.viewportLabel ?? null,
        maxTabs: probe.maxTabs ?? null,
        totalFocusableCount: probe.totalFocusableCount ?? null,
        uniqueFocusedCount: probe.uniqueFocusedCount ?? null,
        anyVisibleIndicator: probe.anyVisibleIndicator ?? null,
        loopDetected: probe.loopDetected ?? null,
        potentialTrap: probe.potentialTrap ?? null,
        repeatedSelectors: probe.repeatedSelectors ?? [],
        sampleSteps: probe.sampleSteps ?? []
      };
    })
    .sort((left, right) => {
      if (left.step !== right.step) {
        return (left.step ?? 0) - (right.step ?? 0);
      }
      return String(left.ruleId).localeCompare(String(right.ruleId));
    });
}

function buildMarkdown(session, uiuxSummary, functional, accessibility) {
  const blocker = session.primaryBlocker;
  const timeline = (session.timeline ?? [])
    .map((entry) => `- ${entry.at}: [${entry.type}] ${entry.message}`)
    .join("\n");
  const incidents = (session.incidents ?? [])
    .map((incident) => `- ${incident.severity} ${incident.type}: ${incident.title}`)
    .join("\n");
  const artifacts = flattenArtifacts(session.artifactIndex)
    .map((artifact) => `- ${artifact.kind}: ${artifact.url ?? artifact.relativePath ?? artifact.path ?? "n/a"}`)
    .join("\n");
  const failingDevices = (uiuxSummary.deviceSummary ?? [])
    .filter((entry) => (entry.pagesFailed ?? 0) > 0)
    .map((entry) => entry.deviceLabel);

  return [
    `# Run Report`,
    ``,
    `- Session: ${session.id}`,
    `- Outcome: ${outcomeLabel(session.status)}`,
    `- Goal: ${session.goal}`,
    `- Mode: ${session.runConfig?.testMode ?? "default"}`,
    `- URL: ${session.currentUrl ?? session.startUrl}`,
    `- Primary blocker: ${blocker ? `${blocker.type} (${Math.round(blocker.confidence * 100)}%)` : "None"}`,
    ``,
    `## Timeline`,
    timeline || "- No timeline entries recorded.",
    ``,
    `## Incidents`,
    incidents || "- No incidents recorded.",
    ``,
    `## Artifacts`,
    artifacts || "- No indexed artifacts recorded.",
    ``,
    `## UI/UX Summary`,
    `- Pages visited: ${uiuxSummary.pagesVisited}`,
    `- Unique states: ${uiuxSummary.uniqueStates}`,
    `- Unique canonical URLs: ${uiuxSummary.coverage.uniqueCanonicalUrls}`,
    `- Effective time budget: ${uiuxSummary.effectiveBudget?.timeBudgetMs ?? "n/a"} ms`,
    `- Effective max pages: ${uiuxSummary.effectiveBudget?.maxPages ?? "n/a"}`,
    `- Effective max interactions/page: ${uiuxSummary.effectiveBudget?.maxInteractionsPerPage ?? "n/a"}`,
    `- Effective devices: ${uiuxSummary.effectiveBudget?.deviceCount ?? "n/a"}`,
    `- Interactions attempted: ${uiuxSummary.coverage.interactionsAttempted}`,
    `- Interactions skipped by safety: ${uiuxSummary.coverage.interactionsSkippedBySafety}`,
    `- Devices scanned: ${(uiuxSummary.deviceSummary ?? []).length}`,
    `- Devices with failures: ${failingDevices.length}${failingDevices.length ? ` (${failingDevices.join(", ")})` : ""}`,
    `- Artifacts retained: ${uiuxSummary.artifacts.artifactsRetainedCount}`,
    `- Artifacts pruned: ${uiuxSummary.artifacts.artifactsPrunedCount}`,
    `- Issue-only artifacts policy: ${uiuxSummary.artifacts.issueOnlyArtifacts ? "enabled" : "disabled"}`,
    `- Issue clusters: ${uiuxSummary.clusters.count}`,
    `- Grouped failures: ${uiuxSummary.groupedFailures?.count ?? 0}`,
    `- Repro bundles: ${uiuxSummary.reproBundles.count}`,
    ``,
    `## Accessibility Summary`,
    `- Pages scanned: ${accessibility?.summary?.pagesScanned ?? 0}`,
    `- Accessibility issues: ${(accessibility?.issues ?? []).length}`,
    `- Accessibility clusters: ${(accessibility?.clusters ?? []).length}`,
    `- P1 issues: ${accessibility?.summary?.severityCounts?.P1 ?? 0}`,
    `- P2 issues: ${accessibility?.summary?.severityCounts?.P2 ?? 0}`,
    `- Keyboard probe findings: ${accessibility?.summary?.keyboardProbeFindingsCount ?? 0}`,
    ``,
    `## Functional Summary`,
    `- Flows run: ${functional?.flowsRun ?? 0}`,
    `- Functional issues: ${(functional?.issues ?? []).length}`,
    `- Functional blockers: ${(functional?.blockers ?? []).length}`,
    `- Blocker timeline entries: ${(functional?.blockerTimeline ?? []).length}`,
    `- Resume points: ${(functional?.resumePoints ?? []).length}`,
    `- Login assist attempted: ${functional?.loginAssist?.attempted ? "yes" : "no"}`,
    `- API calls observed: ${functional?.contractSummary?.apiCallsObserved ?? 0}`,
    `- API 5xx count: ${functional?.contractSummary?.apiErrorCounts?.["5xx"] ?? 0}`,
    `- Functional summary: ${functional?.summary ?? "n/a"}`,
    ``
  ].join("\n");
}

function finalizeUiuxReport(session) {
  const rawIssues = session.uiux?.issues ?? [];
  const rawClusters = session.uiux?.clusters ?? [];
  if (!isUiuxMode(session)) {
    const summary = buildUiuxSummary({
      session,
      issues: rawIssues,
      groupedIssues: [],
      clusters: rawClusters,
      reproBundles: [],
      baselineDiff: null
    });
    return {
      uiuxSummary: summary,
      uiuxIssues: rawIssues,
      groupedIssues: [],
      uiuxClusters: rawClusters,
      reproBundles: [],
      baselineDiff: null
    };
  }

  const issuesWithCluster = rawIssues.map((issue) => ({
    ...issue,
    clusterKey: issue.clusterKey ?? buildUiuxClusterKey(issue)
  }));
  const clusterStatsMap = buildClusterStats(issuesWithCluster);

  const calibratedIssues = issuesWithCluster.map((issue) => {
    const stats = clusterStatsMap.get(buildIssueFamilyKey(issue));
    const normalizedExplanation = normalizeUiuxExplanation(issue);
    const severityCalibratedIssue = calibrateUiuxIssue({
      issue,
      clusterStats: {
        viewportCount: stats?.viewportSet?.size ?? 1,
        pageCount: stats?.pageSet?.size ?? 1,
        occurrenceCount: stats?.occurrenceCount ?? 1
      }
    });
    const judgment = calibrateUiuxJudgment({
      issue: {
        ...issue,
        ...severityCalibratedIssue,
        explanation: normalizedExplanation
      },
      clusterStats: {
        viewportCount: stats?.viewportSet?.size ?? 1,
        pageCount: stats?.pageSet?.size ?? 1,
        occurrenceCount: stats?.occurrenceCount ?? 1
      }
    });
    return {
      ...severityCalibratedIssue,
      ...judgment,
      explanation: normalizedExplanation,
      summary: buildUiuxIssueSummary({
        ...issue,
        explanation: normalizedExplanation
      }),
      highlight: buildUiuxIssueHighlight(issue),
      repro: buildIssueRepro(issue)
    };
  });

  const calibratedClusters = calibrateUiuxClusters(rawClusters, calibratedIssues);
  const reproBundles = buildUiuxReproBundles(calibratedIssues);
  const clustersWithTopRepro = attachTopReproToClusters(calibratedClusters, reproBundles);
  const defectIssues = calibratedIssues.filter(
    (issue) => (issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL") === "FAIL"
  );
  const groupedIssues = buildUiuxGroupedIssues(defectIssues);

  const baselineMode = resolveUiuxBaselineMode(session.runConfig);
  const baselineId = resolveUiuxBaselineId(session.runConfig);
  let baselineDiff = null;
  if (baselineMode === "write" && baselineId) {
    const payload = buildUiuxBaselinePayload({
      baselineId,
      clusters: clustersWithTopRepro
    });
    const baselinePath = writeUiuxBaseline(payload);
    baselineDiff = {
      mode: "write",
      baselineId,
      baselinePath,
      newClusters: [],
      resolvedClusters: [],
      severityIncreases: [],
      severityDecreases: []
    };
  } else if (baselineMode === "compare" && baselineId) {
    const baseline = readUiuxBaseline(baselineId);
    baselineDiff = {
      mode: "compare",
      baselineId,
      ...(diffUiuxBaseline({
        baseline,
        currentClusters: clustersWithTopRepro
      }))
    };
  }

  const uiuxSummary = buildUiuxSummary({
    session,
    issues: calibratedIssues,
    groupedIssues,
    clusters: clustersWithTopRepro,
    reproBundles,
    baselineDiff
  });

  return {
    uiuxSummary,
    uiuxIssues: calibratedIssues,
    groupedIssues,
    uiuxClusters: clustersWithTopRepro,
    reproBundles,
    baselineDiff
  };
}

function finalizeAccessibilityReport(session) {
  const base = session.accessibility ?? {
    enabled: false,
    pagesScanned: [],
    blockedForFurtherProgress: [],
    issues: [],
    clusters: [],
    interactionsAttempted: 0,
    interactionsSkippedBySafety: 0,
    artifactsPrunedCount: 0,
    artifactsRetainedCount: 0
  };

  const issues = base.issues ?? [];
  const clusters = base.clusters ?? [];
  const focusProbeFindings = extractAccessibilityFocusProbeFindings(issues);
  if (!isAccessibilityMode(session)) {
    const summary = buildAccessibilitySummary({
      session,
      issues,
      clusters,
      baselineDiff: null,
      focusProbeFindings
    });
    return {
      ...base,
      summary,
      deviceSummary: summary.deviceSummary ?? [],
      contrastSummary: summary.contrastSummary,
      textScaleSummary: summary.textScaleSummary,
      reducedMotionSummary: summary.reducedMotionSummary,
      formSummary: summary.formSummary,
      reproBundles: [],
      baselineDiff: null,
      focusProbeFindings
    };
  }

  const issuesWithCluster = issues.map((issue) => ({
    ...issue,
    clusterKey: issue.clusterKey ?? buildA11yClusterKey(issue)
  }));
  const statsByCluster = buildAccessibilityClusterStats(issuesWithCluster);
  const calibratedIssues = issuesWithCluster.map((issue) => {
    const stats = statsByCluster.get(issue.clusterKey);
    return calibrateAccessibilityIssue({
      issue,
      clusterStats: {
        viewportCount: stats?.viewportSet?.size ?? 1,
        pageCount: stats?.pageSet?.size ?? 1,
        occurrenceCount: stats?.occurrenceCount ?? 1
      }
    });
  });
  const calibratedClusters = calibrateAccessibilityClusters(clusters, calibratedIssues);
  const reproBundles = buildAccessibilityReproBundles(calibratedIssues);
  const clustersWithTopRepro = attachTopReproToAccessibilityClusters(calibratedClusters, reproBundles);
  const calibratedFocusProbeFindings = extractAccessibilityFocusProbeFindings(calibratedIssues);

  const baselineMode = resolveAccessibilityBaselineMode(session.runConfig);
  const baselineId = resolveAccessibilityBaselineId(session.runConfig);
  let baselineDiff = null;
  if (baselineMode === "write" && baselineId) {
    const payload = buildAccessibilityBaselinePayload({
      baselineId,
      clusters: clustersWithTopRepro
    });
    const baselinePath = writeAccessibilityBaseline(payload);
    baselineDiff = {
      mode: "write",
      baselineId,
      baselinePath,
      newClusters: [],
      resolvedClusters: [],
      severityIncreases: [],
      severityDecreases: []
    };
  } else if (baselineMode === "compare" && baselineId) {
    const baseline = readAccessibilityBaseline(baselineId);
    baselineDiff = {
      mode: "compare",
      baselineId,
      ...(diffAccessibilityBaseline({
        baseline,
        currentClusters: clustersWithTopRepro
      }))
    };
  }
  baselineDiff = attachAccessibilityDiffTopRepros(baselineDiff, clustersWithTopRepro);

  const summary = buildAccessibilitySummary({
    session,
    issues: calibratedIssues,
    clusters: clustersWithTopRepro,
    baselineDiff,
    focusProbeFindings: calibratedFocusProbeFindings
  });

  return {
    ...base,
    issues: calibratedIssues,
    clusters: clustersWithTopRepro,
    summary,
    deviceSummary: summary.deviceSummary ?? [],
    contrastSummary: summary.contrastSummary,
    textScaleSummary: summary.textScaleSummary,
    reducedMotionSummary: summary.reducedMotionSummary,
    formSummary: summary.formSummary,
    reproBundles,
    baselineDiff,
    focusProbeFindings: calibratedFocusProbeFindings
  };
}

function defaultFunctionalContractSummary() {
  return {
    snapshotsObserved: 0,
    apiCallsObserved: 0,
    apiErrorCounts: {
      "4xx": 0,
      "5xx": 0,
      timeouts: 0
    },
    topFailingEndpoints: [],
    stepsWithApi5xx: 0,
    stepsWithGraphqlErrors: 0,
    stepsWithThirdPartyFailures: 0,
    failingAssertionCounts: {},
    config: {
      failOnApi5xx: true,
      warnOnThirdPartyFailures: true,
      endpointAllowlistPatterns: [],
      endpointBlocklistPatterns: []
    }
  };
}

function finalizeFunctionalReport(session) {
  const baseFunctional = session.functional ?? {
    enabled: false,
    flowsRun: 0,
    flows: [],
    assertionCounts: {
      evaluated: 0,
      passed: 0,
      failed: 0
    },
    deviceSummary: [],
    issues: [],
    blockers: [],
    blockerTimeline: [],
    resumePoints: [],
    loginAssist: {
      attempted: false,
      success: false,
      timeout: false,
      resumeStrategy: "restart-flow",
      profileTag: ""
    },
    summary: "",
    reproBundles: [],
    graph: {
      nodes: [],
      edges: []
    }
  };

  const contractSummary = {
    ...defaultFunctionalContractSummary(),
    ...(baseFunctional.contractSummary ?? {})
  };

  const baselineMode = resolveFunctionalBaselineMode(session.runConfig);
  const baselineId = resolveFunctionalBaselineId(session.runConfig);
  let baselineDiff = null;

  if (baselineMode === "write" && baselineId) {
    const payload = buildFunctionalBaselinePayload({
      baselineId,
      functional: {
        ...baseFunctional,
        contractSummary
      }
    });
    const baselinePath = writeFunctionalBaseline(payload);
    baselineDiff = {
      mode: "write",
      baselineId,
      baselinePath,
      newFailures: [],
      resolvedFailures: [],
      endpointFailureDeltas: [],
      blockerDeltas: []
    };
  } else if (baselineMode === "compare" && baselineId) {
    const baseline = readFunctionalBaseline(baselineId);
    const currentPayload = buildFunctionalBaselinePayload({
      baselineId,
      functional: {
        ...baseFunctional,
        contractSummary
      }
    });
    baselineDiff = {
      mode: "compare",
      baselineId,
      ...diffFunctionalBaseline({
        baseline,
        current: currentPayload
      })
    };
  }

  return {
    ...baseFunctional,
    summary: baseFunctional.summary || buildFunctionalDeterministicSummary(baseFunctional),
    assertionCounts: {
      evaluated: baseFunctional.assertionCounts?.evaluated ?? 0,
      passed: baseFunctional.assertionCounts?.passed ?? 0,
      failed: baseFunctional.assertionCounts?.failed ?? 0
    },
    deviceSummary: sortDeviceSummary(
      (baseFunctional.deviceSummary ?? []).map((entry) => ({
        totalChecksFailed: entry.totalChecksFailed ?? entry.assertionsFailed ?? 0,
        worstSeverity: entry.worstSeverity ?? "P3",
        ...entry
      }))
    ),
    contractSummary,
    baselineDiff
  };
}

function buildDeterministicSummaryText({ session, uiuxSummary, functional, accessibility }) {
  const mode = session?.runConfig?.testMode ?? "default";
  if (mode === "functional") {
    return buildFunctionalDeterministicSummary(functional);
  }
  if (mode === "accessibility") {
    return accessibility?.summary?.summaryText ?? "Accessibility scan completed.";
  }
  if (mode === "uiux") {
    const failingDevices = uiuxSummary?.failingDevices ?? [];
    return [
      `UI/UX: scanned ${uiuxSummary?.pagesVisited ?? 0} pages across ${(uiuxSummary?.deviceSummary ?? []).length} devices;`,
      `failed devices ${failingDevices.length}${failingDevices.length ? ` (${failingDevices.join(", ")})` : ""}.`
    ].join(" ");
  }
  return session?.runSummary?.nextBestAction
    ? `Run outcome ${outcomeLabel(session.status)}; next action ${session.runSummary.nextBestAction}.`
    : `Run outcome ${outcomeLabel(session.status)}.`;
}

function buildAuthAssistReport(session = {}) {
  const authAssist = session?.authAssist ?? null;
  const legacyLoginAssist = session?.loginAssist ?? null;
  const state = authAssist?.state ?? null;
  const code = authAssist?.code ?? null;
  return {
    used: Boolean(authAssist || legacyLoginAssist),
    loginRequired:
      Boolean(authAssist?.loginRequired) ||
      ["WAIT_FOR_USER", "AWAITING_CREDENTIALS", "AWAITING_OTP", "AUTH_FAILED"].includes(
        String(legacyLoginAssist?.state ?? "")
      ),
    state,
    code,
    reason: authAssist?.reason ?? null,
    site: authAssist?.site ?? legacyLoginAssist?.domain ?? null,
    pageUrl: authAssist?.pageUrl ?? session?.currentUrl ?? null,
    visibleStep: authAssist?.form?.visibleStep ?? null,
    identifierFieldDetected: Boolean(authAssist?.form?.identifierFieldDetected),
    identifierFieldVisibleCount: Number(authAssist?.form?.identifierFieldVisibleCount ?? 0),
    identifierLabelCandidates: Array.isArray(authAssist?.form?.identifierLabelCandidates)
      ? authAssist.form.identifierLabelCandidates.slice(0, 5)
      : [],
    nextRecommendedAction: authAssist?.form?.nextRecommendedAction ?? null,
    submitAttempted: Boolean(authAssist?.submitAttempted),
    resumeTriggered: Boolean(authAssist?.resumeTriggered),
    submitTriggered: Boolean(authAssist?.runtime?.submitTriggered ?? authAssist?.form?.submitTriggered),
    submitControlType:
      authAssist?.runtime?.submitControlType ??
      authAssist?.form?.submitControlType ??
      "none",
    identifierFilled: Boolean(authAssist?.runtime?.identifierFilled ?? authAssist?.form?.identifierFilled),
    passwordFilled: Boolean(authAssist?.runtime?.passwordFilled ?? authAssist?.form?.passwordFilled),
    postSubmitUrlChanged: Boolean(
      authAssist?.runtime?.postSubmitUrlChanged ?? authAssist?.form?.postSubmitUrlChanged
    ),
    postSubmitProbeState:
      authAssist?.runtime?.postSubmitProbeState ??
      authAssist?.form?.postSubmitProbeState ??
      null,
    success: state === "authenticated" || state === "resumed",
    failure: state === "auth_failed",
    resumedFromLoginAssist: state === "resumed",
    authSuccessDetected: code === "AUTH_VALIDATED" || state === "authenticated" || state === "resumed",
    resumeTargetUrl: authAssist?.resumeTargetUrl ?? legacyLoginAssist?.resumeTargetUrl ?? null,
    resumeCheckpoint: authAssist?.resumeCheckpoint ?? legacyLoginAssist?.resumeCheckpoint ?? null,
    profileTag: authAssist?.profileTag ?? session?.runConfig?.profileTag ?? ""
  };
}

export function buildRunReport(session) {
  const uiuxReport = finalizeUiuxReport(session);
  const accessibility = finalizeAccessibilityReport(session);
  const functional = finalizeFunctionalReport(session);
  const authAssist = buildAuthAssistReport(session);
  const markdown = buildMarkdown(session, uiuxReport.uiuxSummary, functional, accessibility);
  const deterministicSummary = buildDeterministicSummaryText({
    session,
    uiuxSummary: uiuxReport.uiuxSummary,
    functional,
    accessibility
  });

  return {
    sessionId: session.id,
    summary: session.summary ?? session.success?.summary ?? session.bug?.summary ?? null,
    effectiveBudgets: session.effectiveBudgets ?? null,
    outcome: outcomeLabel(session.status),
    targetAchieved: Boolean(session.outcome?.targetAchieved),
    blockers: session.outcome?.blockers ?? [],
    primaryBlocker: session.primaryBlocker ?? null,
    nextBestAction: session.outcome?.nextBestAction ?? null,
    evidenceQualityScore: session.outcome?.evidenceQualityScore ?? 0,
    runConfig: session.runConfig ?? null,
    functional,
    accessibility,
    accessibilitySummary: accessibility.summary,
    uiuxSummary: uiuxReport.uiuxSummary,
    uiuxIssues: uiuxReport.uiuxIssues,
    uiuxGroupedIssues: uiuxReport.groupedIssues,
    uiuxClusters: uiuxReport.uiuxClusters,
    summaryText: {
      deterministic: deterministicSummary,
      llm: null,
      llmModel: null
    },
    authAssist,
    uiux: {
      summary: uiuxReport.uiuxSummary,
      issues: uiuxReport.uiuxIssues,
      groupedIssues: uiuxReport.groupedIssues,
      clusters: uiuxReport.uiuxClusters,
      reproBundles: uiuxReport.reproBundles,
      baselineDiff: uiuxReport.baselineDiff,
      deviceSummary: uiuxReport.uiuxSummary.deviceSummary ?? [],
      pageDeviceMatrix: uiuxReport.uiuxSummary.pageDeviceMatrix ?? [],
      failingDevices: uiuxReport.uiuxSummary.failingDevices ?? []
    },
    artifacts: session.artifactIndex ?? {},
    timeline: session.timeline ?? [],
    incidents: session.incidents ?? [],
    observations: session.observations ?? [],
    reproducibleSteps: (session.steps ?? []).map((step) => ({
      stepId: step.stepId,
      actionPlan: step.actionPlan,
      actionAttempted: step.actionAttempted,
      actionResult: step.actionResult ?? null,
      result: step.result
    })),
    markdown
  };
}
