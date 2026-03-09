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

export function urlMatches({
  snapshot,
  pattern,
  ruleId = "urlMatches",
  evidenceRefs = []
}) {
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  const pass = matcher.test(snapshot?.url ?? "");
  return buildResult({
    ruleId,
    pass,
    expected: `URL should match ${matcher.toString()}`,
    actual: snapshot?.url ?? "",
    confidence: pass ? 0.96 : 0.88,
    severity: "P2",
    evidenceRefs
  });
}

export function urlChanged({
  beforeSnapshot,
  afterSnapshot,
  allowHashChange = false,
  ruleId = "urlChanged",
  evidenceRefs = []
}) {
  const beforeUrl = beforeSnapshot?.url ?? "";
  const afterUrl = afterSnapshot?.url ?? "";
  const normalizedBefore = allowHashChange ? beforeUrl : beforeUrl.replace(/#.*$/, "");
  const normalizedAfter = allowHashChange ? afterUrl : afterUrl.replace(/#.*$/, "");
  const pass = normalizedBefore !== normalizedAfter;
  return buildResult({
    ruleId,
    pass,
    expected: "URL should change after navigation action.",
    actual: `${beforeUrl} -> ${afterUrl}`,
    confidence: pass ? 0.95 : 0.82,
    severity: "P2",
    evidenceRefs
  });
}

export function elementVisible({
  snapshot,
  selector,
  ruleId = "elementVisible",
  evidenceRefs = []
}) {
  const exists = (snapshot?.interactive ?? []).some((item) => item.selector === selector && item.inViewport);
  return buildResult({
    ruleId,
    pass: exists,
    expected: `Element ${selector} should be visible.`,
    actual: exists ? `Element ${selector} is visible.` : `Element ${selector} not visible.`,
    confidence: exists ? 0.92 : 0.86,
    severity: "P2",
    evidenceRefs
  });
}

export function elementNotVisible({
  snapshot,
  selector,
  ruleId = "elementNotVisible",
  evidenceRefs = []
}) {
  const exists = (snapshot?.interactive ?? []).some((item) => item.selector === selector && item.inViewport);
  return buildResult({
    ruleId,
    pass: !exists,
    expected: `Element ${selector} should not be visible.`,
    actual: exists ? `Element ${selector} is still visible.` : `Element ${selector} is hidden.`,
    confidence: exists ? 0.88 : 0.94,
    severity: "P2",
    evidenceRefs
  });
}

export function textPresent({
  snapshot,
  text,
  ruleId = "textPresent",
  evidenceRefs = []
}) {
  const haystack = normalizeText(snapshot?.bodyText);
  const target = normalizeText(text);
  const pass = target.length > 0 && haystack.includes(target);
  return buildResult({
    ruleId,
    pass,
    expected: `Text "${text}" should be present.`,
    actual: pass ? `Text "${text}" present.` : `Text "${text}" not found.`,
    confidence: pass ? 0.9 : 0.8,
    severity: "P2",
    evidenceRefs
  });
}

export function textAbsent({
  snapshot,
  text,
  ruleId = "textAbsent",
  evidenceRefs = []
}) {
  const haystack = normalizeText(snapshot?.bodyText);
  const target = normalizeText(text);
  const pass = target.length > 0 && !haystack.includes(target);
  return buildResult({
    ruleId,
    pass,
    expected: `Text "${text}" should be absent.`,
    actual: pass ? `Text "${text}" absent.` : `Text "${text}" is present.`,
    confidence: pass ? 0.91 : 0.82,
    severity: "P2",
    evidenceRefs
  });
}

export function noConsoleErrors({
  snapshot,
  severityThreshold = "error",
  ruleId = "noConsoleErrors",
  evidenceRefs = []
}) {
  const levels = severityThreshold === "warning" ? ["error", "warning"] : ["error"];
  const hits = (snapshot?.consoleEntries ?? []).filter((entry) => levels.includes(entry.type));
  return buildResult({
    ruleId,
    pass: hits.length === 0,
    expected: "No console errors should be emitted during functional flow execution.",
    actual: hits.length
      ? `${hits.length} console ${severityThreshold}+ entries detected.`
      : "No console errors detected.",
    confidence: hits.length ? 0.9 : 0.95,
    severity: "P1",
    evidenceRefs
  });
}

export function no5xxSpike({
  beforeSnapshot,
  afterSnapshot,
  maxIncrease = 0,
  ruleId = "no5xxSpike",
  evidenceRefs = []
}) {
  const before = beforeSnapshot?.networkSummary?.status5xx ?? 0;
  const after = afterSnapshot?.networkSummary?.status5xx ?? 0;
  const delta = after - before;
  return buildResult({
    ruleId,
    pass: delta <= maxIncrease,
    expected: `5xx count increase should be <= ${maxIncrease}.`,
    actual: `5xx count changed by ${delta}.`,
    confidence: delta <= maxIncrease ? 0.94 : 0.9,
    severity: "P1",
    evidenceRefs
  });
}

export function noApi5xx({
  apiCalls = [],
  ruleId = "noApi5xx",
  evidenceRefs = []
}) {
  const count = apiCalls.filter((call) => Number(call?.status) >= 500).length;
  return buildResult({
    ruleId,
    pass: count === 0,
    expected: "Observed API calls should not include 5xx responses.",
    actual: count === 0 ? "No API 5xx responses detected." : `${count} API 5xx responses detected.`,
    confidence: count === 0 ? 0.93 : 0.9,
    severity: count === 0 ? "P2" : "P1",
    evidenceRefs
  });
}

export function graphqlErrorsDetected({
  graphqlErrorCount = 0,
  telemetryAvailable = true,
  ruleId = "graphqlErrorsDetected",
  evidenceRefs = []
}) {
  if (!telemetryAvailable) {
    return null;
  }

  const count = Number(graphqlErrorCount ?? 0);
  return buildResult({
    ruleId,
    pass: count === 0,
    expected: "GraphQL responses should not include protocol-level errors.",
    actual: count === 0 ? "No GraphQL errors detected." : `${count} GraphQL errors detected in response envelopes.`,
    confidence: count === 0 ? 0.87 : 0.82,
    severity: "P2",
    evidenceRefs
  });
}

export function consistentContentType({
  snapshot,
  ruleId = "consistentContentType",
  evidenceRefs = []
}) {
  const contentType = String(snapshot?.networkSummary?.mainDocumentContentType ?? "").toLowerCase();
  const status = Number(snapshot?.networkSummary?.mainDocumentStatus ?? 0);
  if (!contentType && status === 0) {
    return buildResult({
      ruleId,
      pass: true,
      expected: "Main document should resolve with text/html content type.",
      actual: "Main document content type unavailable for this step.",
      confidence: 0.62,
      severity: "P2",
      evidenceRefs
    });
  }

  const pass = contentType.includes("text/html");
  return buildResult({
    ruleId,
    pass,
    expected: "Main document should resolve with text/html content type.",
    actual: contentType
      ? `Main document content type was ${contentType}.`
      : "Main document content type was missing.",
    confidence: pass ? 0.91 : 0.86,
    severity: "P2",
    evidenceRefs
  });
}

export function excessiveThirdPartyFailures({
  apiCalls = [],
  threshold = 3,
  ruleId = "excessiveThirdPartyFailures",
  evidenceRefs = []
}) {
  const thirdPartyFailures = apiCalls.filter((call) => {
    const status = Number(call?.status);
    return Boolean(call?.isThirdParty) && !Number.isNaN(status) && status >= 400;
  }).length;

  return buildResult({
    ruleId,
    pass: thirdPartyFailures <= threshold,
    expected: `Third-party API failures should stay <= ${threshold} per step.`,
    actual: `${thirdPartyFailures} third-party API failures observed.`,
    confidence: thirdPartyFailures <= threshold ? 0.82 : 0.78,
    severity: "P2",
    evidenceRefs
  });
}

export function noStuckLoading({
  snapshot,
  ruleId = "noStuckLoading",
  evidenceRefs = []
}) {
  const stuck = Boolean(snapshot?.spinnerVisible || snapshot?.uiReadyState?.timedOut);
  return buildResult({
    ruleId,
    pass: !stuck,
    expected: "Page should not remain in a stuck loading state.",
    actual: stuck
      ? "Loading indicator persisted or UI readiness timed out."
      : "No stuck loading detected.",
    confidence: stuck ? 0.93 : 0.95,
    severity: "P0",
    evidenceRefs
  });
}

export function safeRedirectAllowed({
  runHistory = [],
  maxLoopRepeats = 3,
  ruleId = "safeRedirectAllowed",
  evidenceRefs = []
}) {
  const urls = runHistory.map((entry) => entry.url).filter(Boolean);
  const frequency = urls.reduce((map, url) => {
    map.set(url, (map.get(url) ?? 0) + 1);
    return map;
  }, new Map());
  const worst = [...frequency.values()].sort((a, b) => b - a)[0] ?? 0;
  return buildResult({
    ruleId,
    pass: worst <= maxLoopRepeats,
    expected: `Redirect loop frequency should be <= ${maxLoopRepeats}.`,
    actual: `Most repeated URL observed ${worst} times.`,
    confidence: worst <= maxLoopRepeats ? 0.92 : 0.85,
    severity: "P1",
    evidenceRefs
  });
}
