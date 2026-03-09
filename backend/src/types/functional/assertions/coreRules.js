import {
  consistentContentType,
  excessiveThirdPartyFailures,
  graphqlErrorsDetected,
  noApi5xx,
  no5xxSpike,
  noConsoleErrors,
  noStuckLoading,
  safeRedirectAllowed,
  urlChanged
} from "./dsl.js";
import { filterApiCallsByContracts } from "../networkTelemetry.js";

function normalizeText(value = "") {
  return String(value ?? "").toLowerCase();
}

function buildResult({
  ruleId,
  pass,
  expected,
  actual,
  confidence = 0.9,
  severity = "P2",
  evidenceRefs = []
}) {
  return {
    ruleId,
    pass,
    expected,
    actual,
    confidence,
    severity,
    evidenceRefs
  };
}

function isErrorPage(snapshot = {}) {
  const status = snapshot?.networkSummary?.mainDocumentStatus ?? 0;
  if (status >= 400) {
    return true;
  }

  const body = normalizeText(snapshot?.bodyText);
  return /404|not found|500|server error|something went wrong|application error/.test(body);
}

function hasNoResultsMessage(snapshot = {}) {
  return /no results|no items|no matches|nothing found|0 results/.test(
    normalizeText(snapshot?.bodyText)
  );
}

function hasVisiblePrimaryLinks(snapshot = {}) {
  return (snapshot?.interactive ?? []).some(
    (item) => item.inViewport && !item.disabled && item.tag === "a" && item.zone === "Primary Content"
  );
}

function pageIndexFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    const page = parsed.searchParams.get("page") ?? parsed.searchParams.get("p");
    return page ? Number.parseInt(page, 10) : null;
  } catch {
    return null;
  }
}

function changedState(beforeSnapshot = {}, afterSnapshot = {}) {
  return beforeSnapshot.url !== afterSnapshot.url || beforeSnapshot.hash !== afterSnapshot.hash;
}

function knownNoopReason({ beforeSnapshot, action }) {
  const target = (beforeSnapshot?.interactive ?? []).find(
    (item) => item.elementId === action?.elementId
  );
  if (!target) {
    return "target element not found in baseline snapshot";
  }
  if (target.disabled) {
    return "target control is disabled";
  }
  if (!target.inViewport) {
    return "target control left the viewport";
  }
  return null;
}

function evaluateNavigationRule({
  beforeSnapshot,
  afterSnapshot,
  action,
  evidenceRefs = []
}) {
  if (action?.type !== "click" || action?.functionalKind !== "navigation") {
    return null;
  }

  if (isErrorPage(afterSnapshot)) {
    return buildResult({
      ruleId: "NAVIGATION_NOT_ERROR_PAGE",
      pass: false,
      expected: "Navigation should not land on 4xx/5xx or obvious error page.",
      actual: `Navigation landed on ${afterSnapshot?.networkSummary?.mainDocumentStatus ?? "error-like page"}.`,
      confidence: 0.93,
      severity: "P1",
      evidenceRefs
    });
  }

  const changed = changedState(beforeSnapshot, afterSnapshot);
  const noopReason = knownNoopReason({ beforeSnapshot, action });
  return buildResult({
    ruleId: "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
    pass: changed || Boolean(noopReason),
    expected: "Navigation click should change state unless a deterministic no-op reason exists.",
    actual: changed
      ? "State changed after navigation click."
      : `No state change; reason: ${noopReason ?? "none"}.`,
    confidence: changed ? 0.94 : noopReason ? 0.88 : 0.76,
    severity: changed || noopReason ? "P2" : "P1",
    evidenceRefs
  });
}

function evaluateSearchRule({
  afterSnapshot,
  action,
  evidenceRefs = []
}) {
  if (action?.functionalKind !== "search") {
    return null;
  }

  const hasResults = hasVisiblePrimaryLinks(afterSnapshot);
  const hasNoResults = hasNoResultsMessage(afterSnapshot);
  const pass = hasResults || hasNoResults;
  return buildResult({
    ruleId: "SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE",
    pass,
    expected: "Search should produce visible results or an explicit no-results message.",
    actual: pass
      ? hasResults
        ? "Search returned visible results."
        : "Search returned explicit no-results feedback."
      : "Search response appears blank without result or no-results feedback.",
    confidence: pass ? 0.9 : 0.86,
    severity: pass ? "P2" : "P1",
    evidenceRefs
  });
}

function evaluatePaginationRule({
  beforeSnapshot,
  afterSnapshot,
  action,
  evidenceRefs = []
}) {
  if (action?.functionalKind !== "pagination") {
    return null;
  }

  const stateChanged = changedState(beforeSnapshot, afterSnapshot);
  const beforePage = pageIndexFromUrl(beforeSnapshot?.url);
  const afterPage = pageIndexFromUrl(afterSnapshot?.url);
  const pageChanged = beforePage !== null && afterPage !== null && beforePage !== afterPage;
  const pass = stateChanged || pageChanged;
  return buildResult({
    ruleId: "PAGINATION_CHANGES_CONTENT_OR_PAGE_INDEX",
    pass,
    expected: "Pagination should change content state or page index.",
    actual: pass
      ? "Pagination changed page content/index."
      : "Pagination did not change content or page index.",
    confidence: pass ? 0.9 : 0.84,
    severity: pass ? "P2" : "P1",
    evidenceRefs
  });
}

function evaluateFilterRule({
  beforeSnapshot,
  afterSnapshot,
  action,
  flowBaselineSnapshot,
  evidenceRefs = []
}) {
  if (!["filter", "filter-clear"].includes(action?.functionalKind)) {
    return null;
  }

  if (action.functionalKind === "filter") {
    const pass = changedState(beforeSnapshot, afterSnapshot) || hasNoResultsMessage(afterSnapshot);
    return buildResult({
      ruleId: "FILTER_CHANGES_RESULTS_OR_NO_RESULTS",
      pass,
      expected: "Applying a filter should change results or show explicit no-results feedback.",
      actual: pass
        ? changedState(beforeSnapshot, afterSnapshot)
          ? "Filter changed result state."
          : "Filter led to no-results feedback."
        : "Filter action did not change state or provide no-results feedback.",
      confidence: pass ? 0.88 : 0.82,
      severity: pass ? "P2" : "P1",
      evidenceRefs
    });
  }

  const baseline = flowBaselineSnapshot ?? beforeSnapshot;
  const restored =
    baseline?.hash === afterSnapshot?.hash ||
    baseline?.url === afterSnapshot?.url ||
    hasVisiblePrimaryLinks(afterSnapshot);
  return buildResult({
    ruleId: "CLEAR_FILTER_RESTORES_BASELINE",
    pass: restored,
    expected: "Clearing filters should restore baseline-like results state.",
    actual: restored
      ? "Clear filter restored baseline-like state."
      : "Clear filter did not restore baseline-like state.",
    confidence: restored ? 0.86 : 0.8,
    severity: restored ? "P2" : "P1",
    evidenceRefs
  });
}

function evaluateDownloadRule({
  afterSnapshot,
  actionResult,
  evidenceRefs = []
}) {
  const triggered = (actionResult?.progressSignals ?? []).some((signal) =>
    String(signal).startsWith("download-triggered:")
  );
  if (!triggered) {
    return null;
  }

  const downloads = afterSnapshot?.networkSummary?.downloads ?? [];
  const exists = downloads.some((entry) => entry?.exists);
  return buildResult({
    ruleId: "DOWNLOAD_EXISTS_AFTER_ACTION",
    pass: exists,
    expected: "A triggered download should be saved to artifacts and recorded in network summary.",
    actual: exists
      ? `Download captured (${downloads.length} recorded).`
      : "Download event triggered but no saved file was detected.",
    confidence: exists ? 0.93 : 0.85,
    severity: exists ? "P2" : "P1",
    evidenceRefs
  });
}

function evaluateNewTabRule({
  afterSnapshot,
  actionResult,
  evidenceRefs = []
}) {
  const opened = (actionResult?.progressSignals ?? []).some((signal) =>
    String(signal).startsWith("new-tab-opened:")
  );
  if (!opened) {
    return null;
  }
  const status = afterSnapshot?.networkSummary?.mainDocumentStatus ?? null;
  const pass = status === null || status < 400;
  return buildResult({
    ruleId: "NEW_TAB_NAVIGATION_VALID",
    pass,
    expected: "New tab navigation should not land on a 4xx/5xx main document.",
    actual: `New tab main document status: ${status ?? "unknown"}.`,
    confidence: pass ? 0.9 : 0.86,
    severity: pass ? "P2" : "P1",
    evidenceRefs
  });
}

function evaluateUploadRule({
  beforeSnapshot,
  afterSnapshot,
  actionResult,
  action,
  evidenceRefs = []
}) {
  const uploadSignal = (actionResult?.progressSignals ?? []).some((signal) => signal === "upload-attached");
  const isUploadAction = uploadSignal || String(action?.functionalKind ?? "") === "upload";
  if (!isUploadAction) {
    return null;
  }

  const targetId = action?.elementId ?? null;
  const beforeValue = (beforeSnapshot?.interactive ?? []).find((item) => item.elementId === targetId)?.value ?? "";
  const afterValue = (afterSnapshot?.interactive ?? []).find((item) => item.elementId === targetId)?.value ?? "";
  const attachedHint = /attached|uploaded|file selected|upload complete/i.test(
    normalizeText(afterSnapshot?.bodyText)
  );
  const pass = uploadSignal || beforeValue !== afterValue || attachedHint;
  return buildResult({
    ruleId: "UPLOAD_ACCEPTED",
    pass,
    expected: "Upload action should attach a file or show clear attachment confirmation.",
    actual: pass
      ? "Upload target reflected an attached file state."
      : "Upload action did not show an attached-file state.",
    confidence: pass ? 0.88 : 0.8,
    severity: pass ? "P2" : "P1",
    evidenceRefs
  });
}

function evaluateSpaReadyRule({
  afterSnapshot,
  action,
  evidenceRefs = []
}) {
  if (["wait", "scroll"].includes(action?.type)) {
    return null;
  }
  const timedOut = Boolean(afterSnapshot?.uiReadyState?.timedOut);
  const persistentBlockers = afterSnapshot?.layoutSample?.persistentBlockerCount ?? 0;
  const pass = !timedOut && persistentBlockers === 0;
  return buildResult({
    ruleId: "SPA_READY_AFTER_NAV",
    pass,
    expected: "After navigation/interactions, SPA should reach ready state without persistent full-screen blockers.",
    actual: pass
      ? "Ready state reached with stable layout."
      : `Ready timeout=${timedOut}, persistent blockers=${persistentBlockers}.`,
    confidence: pass ? 0.9 : 0.84,
    severity: pass ? "P2" : "P1",
    evidenceRefs
  });
}

function relevantApiCalls(afterSnapshot = {}, contractsConfig = {}) {
  const calls = afterSnapshot?.networkSummary?.apiCalls ?? [];
  return filterApiCallsByContracts(calls, contractsConfig);
}

function evaluateNoApi5xxRule({
  afterSnapshot,
  contractsConfig = {},
  evidenceRefs = []
}) {
  if (contractsConfig.failOnApi5xx === false) {
    return null;
  }

  const calls = relevantApiCalls(afterSnapshot, contractsConfig);
  return noApi5xx({
    apiCalls: calls,
    ruleId: "NO_API_5XX",
    evidenceRefs
  });
}

function evaluateGraphqlErrorsRule({
  afterSnapshot,
  evidenceRefs = []
}) {
  const rawCount = afterSnapshot?.networkSummary?.graphqlErrorsDetected;
  const telemetryAvailable = typeof rawCount === "number";
  return graphqlErrorsDetected({
    graphqlErrorCount: Number(rawCount ?? 0),
    telemetryAvailable,
    ruleId: "GRAPHQL_ERRORS_DETECTED",
    evidenceRefs
  });
}

function evaluateConsistentContentTypeRule({
  afterSnapshot,
  evidenceRefs = []
}) {
  return consistentContentType({
    snapshot: afterSnapshot,
    ruleId: "CONSISTENT_CONTENT_TYPE",
    evidenceRefs
  });
}

function evaluateThirdPartyFailureRule({
  afterSnapshot,
  contractsConfig = {},
  evidenceRefs = []
}) {
  if (contractsConfig.warnOnThirdPartyFailures === false) {
    return null;
  }

  const calls = relevantApiCalls(afterSnapshot, contractsConfig);
  return excessiveThirdPartyFailures({
    apiCalls: calls,
    threshold: 3,
    ruleId: "EXCESSIVE_THIRD_PARTY_FAILURES",
    evidenceRefs
  });
}

export function evaluateCoreFunctionalRules({
  beforeSnapshot,
  afterSnapshot,
  action,
  actionResult = null,
  runHistory = [],
  flowBaselineSnapshot = null,
  assertionsConfig = {},
  contractsConfig = {},
  evidenceRefs = []
}) {
  const rules = [];

  const navigationRule = evaluateNavigationRule({
    beforeSnapshot,
    afterSnapshot,
    action,
    evidenceRefs
  });
  if (navigationRule) {
    rules.push(navigationRule);
  }

  const searchRule = evaluateSearchRule({
    afterSnapshot,
    action,
    evidenceRefs
  });
  if (searchRule) {
    rules.push(searchRule);
  }

  const paginationRule = evaluatePaginationRule({
    beforeSnapshot,
    afterSnapshot,
    action,
    evidenceRefs
  });
  if (paginationRule) {
    rules.push(paginationRule);
  }

  const filterRule = evaluateFilterRule({
    beforeSnapshot,
    afterSnapshot,
    action,
    flowBaselineSnapshot,
    evidenceRefs
  });
  if (filterRule) {
    rules.push(filterRule);
  }

  if (assertionsConfig.failOnConsoleError !== false) {
    rules.push(
      noConsoleErrors({
        snapshot: afterSnapshot,
        severityThreshold: "error",
        ruleId: "NO_CONSOLE_ERRORS",
        evidenceRefs
      })
    );
  }

  if (assertionsConfig.failOn5xx !== false) {
    rules.push(
      no5xxSpike({
        beforeSnapshot,
        afterSnapshot,
        maxIncrease: 0,
        ruleId: "NO_5XX_SPIKE",
        evidenceRefs
      })
    );
  }

  rules.push(
    noStuckLoading({
      snapshot: afterSnapshot,
      ruleId: "NO_STUCK_LOADING",
      evidenceRefs
    })
  );

  rules.push(
    safeRedirectAllowed({
      runHistory,
      maxLoopRepeats: 3,
      ruleId: "SAFE_REDIRECT_ALLOWED",
      evidenceRefs
    })
  );

  if (action?.type === "click" && action?.functionalKind === "navigation") {
    rules.push(
      urlChanged({
        beforeSnapshot,
        afterSnapshot,
        ruleId: "NAVIGATION_URL_CHANGED",
        evidenceRefs
      })
    );
  }

  const downloadRule = evaluateDownloadRule({
    afterSnapshot,
    actionResult,
    evidenceRefs
  });
  if (downloadRule) {
    rules.push(downloadRule);
  }

  const newTabRule = evaluateNewTabRule({
    afterSnapshot,
    actionResult,
    evidenceRefs
  });
  if (newTabRule) {
    rules.push(newTabRule);
  }

  const uploadRule = evaluateUploadRule({
    beforeSnapshot,
    afterSnapshot,
    actionResult,
    action,
    evidenceRefs
  });
  if (uploadRule) {
    rules.push(uploadRule);
  }

  const spaReadyRule = evaluateSpaReadyRule({
    afterSnapshot,
    action,
    evidenceRefs
  });
  if (spaReadyRule) {
    rules.push(spaReadyRule);
  }

  const noApi5xxRule = evaluateNoApi5xxRule({
    afterSnapshot,
    contractsConfig,
    evidenceRefs
  });
  if (noApi5xxRule) {
    rules.push(noApi5xxRule);
  }

  const graphqlErrorsRule = evaluateGraphqlErrorsRule({
    afterSnapshot,
    evidenceRefs
  });
  if (graphqlErrorsRule) {
    rules.push(graphqlErrorsRule);
  }

  const contentTypeRule = evaluateConsistentContentTypeRule({
    afterSnapshot,
    evidenceRefs
  });
  if (contentTypeRule) {
    rules.push(contentTypeRule);
  }

  const thirdPartyFailuresRule = evaluateThirdPartyFailureRule({
    afterSnapshot,
    contractsConfig,
    evidenceRefs
  });
  if (thirdPartyFailuresRule) {
    rules.push(thirdPartyFailuresRule);
  }

  return rules;
}
