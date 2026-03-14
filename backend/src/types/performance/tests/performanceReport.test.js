import test from "node:test";
import assert from "node:assert/strict";

import { buildRunReport } from "../../../services/reportBuilder.js";

function makePerformanceSession(overrides = {}) {
  return {
    id: "qa_performance_report",
    status: "soft-passed",
    goal: "Performance scan",
    startUrl: "https://example.com",
    currentUrl: "https://example.com",
    primaryBlocker: {
      type: "PERFORMANCE_BUDGET_EXCEEDED",
      confidence: 0.9,
      rationale: "Performance budgets exceeded."
    },
    outcome: {
      targetAchieved: false,
      blockers: [
        {
          type: "PERFORMANCE_BUDGET_EXCEEDED",
          confidence: 0.9,
          rationale: "Performance budgets exceeded."
        }
      ],
      nextBestAction: "REVIEW_PERFORMANCE_REPORT",
      evidenceQualityScore: 0.86
    },
    runConfig: {
      testMode: "performance"
    },
    timeline: [],
    incidents: [],
    observations: [],
    steps: [],
    artifactIndex: {
      frames: []
    },
    uiux: {
      enabled: false,
      pagesVisited: [],
      uniqueStateHashes: [],
      interactionsAttempted: 0,
      interactionsSkippedBySafety: 0,
      pageDeviceMatrix: [],
      deviceSummary: [],
      issues: [],
      clusters: []
    },
    accessibility: {
      enabled: false,
      pagesScanned: [],
      issues: [],
      clusters: []
    },
    functional: {
      enabled: false,
      flowsRun: 0,
      issues: [],
      blockers: [],
      assertionCounts: {
        evaluated: 0,
        passed: 0,
        failed: 0
      },
      deviceSummary: []
    },
    performance: {
      enabled: true,
      sampleCount: 3,
      settings: {
        sampleCount: 3,
        warmupDelayMs: 600
      },
      thresholds: {
        lcpMs: 4000
      },
      metrics: {
        average: {
          lcpMs: 3920.5
        },
        worst: {
          ttfbMs: 2200,
          lcpMs: 5100,
          cls: 0.14
        }
      },
      network: {
        totalRequests: 60,
        failedRequests: 4,
        status4xx: 2,
        status5xx: 2,
        status429: 0
      },
      issues: [
        {
          id: "perf-perf_lcp_slow",
          issueType: "PERF_LCP_SLOW",
          severity: "P2",
          title: "Slow largest contentful paint",
          summary: "Observed worst LCP 5100 ms.",
          actual: "Observed worst LCP 5100 ms.",
          affectedUrl: "https://example.com",
          evidenceRefs: []
        }
      ],
      status: "soft-passed",
      summary: "Performance scan found 1 budget issue.",
      completedAt: "2026-03-14T00:00:00.000Z"
    },
    ...overrides
  };
}

test("buildRunReport includes structured performance payload and deterministic summary", () => {
  const report = buildRunReport(makePerformanceSession());

  assert.equal(report.performance?.enabled, true);
  assert.equal(report.performance?.sampleCount, 3);
  assert.equal(report.performance?.issues?.[0]?.issueType, "PERF_LCP_SLOW");
  assert.equal(report.summaryText?.deterministic.includes("Performance:"), true);
  assert.equal(report.markdown.includes("## Performance Summary"), true);
});
