import { createId, nowIso } from "../../lib/utils.js";

export const TEST_CASE_BUFFER_LIMIT = 5000;

const TERMINAL_STATUSES = new Set(["passed", "failed", "skipped"]);

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function sanitizeEvidenceRefs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      type: String(entry.type ?? "artifact"),
      ref: String(entry.ref ?? "")
    }))
    .filter((entry) => entry.ref.length > 0);
}

function sanitizeExplanation(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const normalizeText = (entry) => String(entry ?? "").trim();
  const whatHappened = normalizeText(value.whatHappened || value.whatsWrong);
  const whyItFailed = normalizeText(value.whyItFailed);
  const whyItMatters = normalizeText(value.whyItMatters);
  const recommendedFix = Array.isArray(value.recommendedFix)
    ? value.recommendedFix
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  if (!whatHappened && !whyItFailed && !whyItMatters && recommendedFix.length === 0) {
    return null;
  }

  return {
    whatHappened: whatHappened || "",
    whyItFailed: whyItFailed || "",
    whyItMatters: whyItMatters || "",
    recommendedFix
  };
}

export function createEmptyTestCaseStats(existing = {}) {
  const timestamp = nowIso();
  return {
    planned: clampCount(existing.planned),
    discovered: clampCount(existing.discovered),
    completed: clampCount(existing.completed),
    failed: clampCount(existing.failed),
    passed: clampCount(existing.passed),
    startedAt: existing.startedAt ?? timestamp,
    updatedAt: existing.updatedAt ?? timestamp
  };
}

function sanitizeTestCase(session, testCase) {
  return {
    id: testCase.id ?? createId("tc"),
    type: testCase.type ?? session?.runConfig?.testMode ?? "default",
    pageUrl: testCase.pageUrl ?? session?.currentUrl ?? session?.startUrl ?? "",
    canonicalUrl: testCase.canonicalUrl ?? null,
    deviceLabel: testCase.deviceLabel ?? null,
    deviceId: testCase.deviceId ?? null,
    caseKind: testCase.caseKind ?? "GENERIC_CHECK",
    selector: testCase.selector ?? null,
    ruleId: testCase.ruleId ?? null,
    status: testCase.status ?? "queued",
    severity: testCase.severity ?? null,
    expected: testCase.expected ?? "",
    actual: testCase.actual ?? "",
    explanation: sanitizeExplanation(testCase.explanation),
    evidenceRefs: sanitizeEvidenceRefs(testCase.evidenceRefs),
    startedAt: testCase.startedAt ?? nowIso(),
    endedAt: testCase.endedAt ?? null
  };
}

function summarizeTestCase(testCase = {}) {
  return {
    id: testCase.id,
    type: testCase.type,
    caseKind: testCase.caseKind,
    selector: testCase.selector ?? null,
    ruleId: testCase.ruleId ?? null,
    status: testCase.status,
    severity: testCase.severity ?? null,
    pageUrl: testCase.pageUrl ?? null,
    canonicalUrl: testCase.canonicalUrl ?? null,
    deviceLabel: testCase.deviceLabel ?? null,
    deviceId: testCase.deviceId ?? null,
    expected: testCase.expected ?? "",
    actual: testCase.actual ?? "",
    explanation: sanitizeExplanation(testCase.explanation),
    evidenceRefs: sanitizeEvidenceRefs(testCase.evidenceRefs),
    startedAt: testCase.startedAt ?? null,
    endedAt: testCase.endedAt ?? null
  };
}

export class TestCaseTracker {
  constructor({ sessionId, sessionStore, emit = null, maxCases = TEST_CASE_BUFFER_LIMIT }) {
    this.sessionId = sessionId;
    this.sessionStore = sessionStore;
    this.emit = typeof emit === "function" ? emit : null;
    this.maxCases = Math.max(1, Number.parseInt(maxCases, 10) || TEST_CASE_BUFFER_LIMIT);
  }

  ensureSession() {
    const session = this.sessionStore.getSession(this.sessionId);
    if (!session) {
      return null;
    }

    return {
      ...session,
      testCaseStats: createEmptyTestCaseStats(session.testCaseStats ?? {}),
      testCases: Array.isArray(session.testCases) ? session.testCases.slice(-this.maxCases) : []
    };
  }

  persist({ stats, testCases }) {
    const nextStats = {
      ...createEmptyTestCaseStats(stats),
      updatedAt: nowIso()
    };
    const nextCases = Array.isArray(testCases) ? testCases.slice(-this.maxCases) : [];
    this.sessionStore.patchSession(this.sessionId, {
      testCaseStats: nextStats,
      testCases: nextCases
    });
    this.emitStats(nextStats);
    return {
      stats: nextStats,
      testCases: nextCases
    };
  }

  emitStats(stats) {
    if (!this.emit) {
      return;
    }
    this.emit("testcase.stats", {
      sessionId: this.sessionId,
      stats: {
        ...stats
      }
    });
  }

  emitCaseEvent(event, testCase, stats) {
    if (!this.emit) {
      return;
    }
    this.emit("testcase.event", {
      sessionId: this.sessionId,
      event,
      testCase: summarizeTestCase(testCase),
      stats: {
        ...stats
      }
    });
  }

  planCases(countDelta = 0) {
    const session = this.ensureSession();
    if (!session) {
      return this.snapshotStats();
    }

    const stats = {
      ...session.testCaseStats,
      planned: Math.max(0, session.testCaseStats.planned + clampCount(countDelta))
    };
    return this.persist({
      stats,
      testCases: session.testCases
    }).stats;
  }

  discoverCases(countDelta = 0) {
    const session = this.ensureSession();
    if (!session) {
      return this.snapshotStats();
    }

    const stats = {
      ...session.testCaseStats,
      discovered: Math.max(0, session.testCaseStats.discovered + clampCount(countDelta))
    };
    return this.persist({
      stats,
      testCases: session.testCases
    }).stats;
  }

  startCase(testCaseInput = {}) {
    const session = this.ensureSession();
    if (!session) {
      return null;
    }

    const testCase = sanitizeTestCase(session, {
      ...testCaseInput,
      status: "running",
      startedAt: testCaseInput.startedAt ?? nowIso(),
      endedAt: null
    });
    const testCases = [...session.testCases, testCase].slice(-this.maxCases);
    const persisted = this.persist({
      stats: session.testCaseStats,
      testCases
    });
    this.emitCaseEvent("started", testCase, persisted.stats);
    return testCase;
  }

  completeCase(caseId, result = {}) {
    const session = this.ensureSession();
    if (!session) {
      return null;
    }

    const testCases = [...session.testCases];
    const index = testCases.findIndex((entry) => entry.id === caseId);
    if (index < 0) {
      return null;
    }

    const current = testCases[index];
    if (TERMINAL_STATUSES.has(current.status)) {
      return current;
    }

    const status = result.status === "failed" ? "failed" : result.status === "skipped" ? "skipped" : "passed";
    const nextCase = {
      ...current,
      status,
      severity: result.severity ?? current.severity ?? null,
      expected: result.expected ?? current.expected ?? "",
      actual: result.actual ?? current.actual ?? "",
      explanation: sanitizeExplanation(result.explanation ?? current.explanation),
      selector: result.selector ?? current.selector ?? null,
      ruleId: result.ruleId ?? current.ruleId ?? null,
      pageUrl: result.pageUrl ?? current.pageUrl ?? "",
      canonicalUrl: result.canonicalUrl ?? current.canonicalUrl ?? null,
      deviceLabel: result.deviceLabel ?? current.deviceLabel ?? null,
      deviceId: result.deviceId ?? current.deviceId ?? null,
      evidenceRefs: sanitizeEvidenceRefs(result.evidenceRefs ?? current.evidenceRefs),
      endedAt: result.endedAt ?? nowIso()
    };
    testCases[index] = nextCase;

    const stats = {
      ...session.testCaseStats,
      completed: session.testCaseStats.completed + 1,
      passed: session.testCaseStats.passed + (status === "passed" ? 1 : 0),
      failed: session.testCaseStats.failed + (status === "failed" ? 1 : 0)
    };

    const persisted = this.persist({
      stats,
      testCases
    });
    this.emitCaseEvent(status === "failed" ? "failed" : "completed", nextCase, persisted.stats);
    return nextCase;
  }

  failCase(caseId, result = {}) {
    return this.completeCase(caseId, {
      ...result,
      status: "failed"
    });
  }

  snapshotStats() {
    const session = this.sessionStore.getSession(this.sessionId);
    return createEmptyTestCaseStats(session?.testCaseStats ?? {});
  }
}
