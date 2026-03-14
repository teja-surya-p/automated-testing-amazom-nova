import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PERFORMANCE_BUDGETS,
  buildPerformanceRunResult,
  evaluatePerformanceSummary,
  resolvePerformanceSettings,
  summarizePerformanceSamples
} from "../index.js";

test("resolvePerformanceSettings clamps out-of-range values", () => {
  const settings = resolvePerformanceSettings({
    performance: {
      sampleCount: 42,
      warmupDelayMs: -100,
      budgets: {
        ttfbMs: 50,
        cls: 2,
        failedRequests: -1
      }
    }
  });

  assert.equal(settings.sampleCount, 8);
  assert.equal(settings.warmupDelayMs, 0);
  assert.equal(settings.budgets.ttfbMs, 250);
  assert.equal(settings.budgets.cls, 1);
  assert.equal(settings.budgets.failedRequests, 0);
});

test("summarizePerformanceSamples computes average and worst metrics", () => {
  const summary = summarizePerformanceSamples(
    [
      {
        step: 1,
        metrics: {
          ttfbMs: 500,
          domContentLoadedMs: 900,
          loadEventMs: 1200,
          fcpMs: 700,
          fpMs: 400,
          lcpMs: 1300,
          cls: 0.02
        }
      },
      {
        step: 2,
        metrics: {
          ttfbMs: 900,
          domContentLoadedMs: 1400,
          loadEventMs: 1800,
          fcpMs: 1100,
          fpMs: 600,
          lcpMs: 2100,
          cls: 0.08
        }
      }
    ],
    {
      totalRequests: 32,
      failedRequests: 1,
      status4xx: 1,
      status5xx: 0,
      status429: 0
    }
  );

  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.metrics.average.ttfbMs, 700);
  assert.equal(summary.metrics.worst.lcpMs, 2100);
  assert.equal(summary.metrics.worst.cls, 0.08);
  assert.equal(summary.network.totalRequests, 32);
  assert.equal(summary.network.failedRequests, 1);
});

test("evaluatePerformanceSummary flags budget regressions", () => {
  const summary = {
    sampleCount: 2,
    samples: [{ url: "https://example.com" }],
    metrics: {
      worst: {
        ttfbMs: 2400,
        fcpMs: 3000,
        lcpMs: 5200,
        domContentLoadedMs: 4800,
        loadEventMs: 9100,
        cls: 0.22
      }
    },
    network: {
      failedRequests: 6
    }
  };

  const result = evaluatePerformanceSummary(summary, {
    budgets: {
      ...DEFAULT_PERFORMANCE_BUDGETS,
      failedRequests: 2
    }
  });

  assert.equal(result.status, "soft-passed");
  assert.equal(result.issues.length >= 6, true);
  assert.equal(result.issues.some((issue) => issue.issueType === "PERF_LCP_SLOW"), true);
  assert.equal(result.issues.some((issue) => issue.issueType === "PERF_CLS_HIGH"), true);
  assert.equal(result.issues.some((issue) => issue.issueType === "PERF_NETWORK_FAILURE_RATE"), true);
});

test("buildPerformanceRunResult reports pass when budgets hold", () => {
  const settings = resolvePerformanceSettings({
    performance: {
      sampleCount: 2,
      budgets: {
        ttfbMs: 2000,
        fcpMs: 3000,
        lcpMs: 4500,
        cls: 0.15,
        domContentLoadedMs: 4500,
        loadEventMs: 8000,
        failedRequests: 3
      }
    }
  });

  const report = buildPerformanceRunResult({
    settings,
    samples: [
      {
        step: 1,
        url: "https://example.com",
        metrics: {
          ttfbMs: 750,
          domContentLoadedMs: 1200,
          loadEventMs: 1600,
          fcpMs: 900,
          fpMs: 500,
          lcpMs: 1800,
          cls: 0.02
        }
      },
      {
        step: 2,
        url: "https://example.com",
        metrics: {
          ttfbMs: 980,
          domContentLoadedMs: 1500,
          loadEventMs: 2000,
          fcpMs: 1200,
          fpMs: 600,
          lcpMs: 2300,
          cls: 0.04
        }
      }
    ],
    networkSummary: {
      totalRequests: 40,
      failedRequests: 1,
      status4xx: 1,
      status5xx: 0,
      status429: 0
    }
  });

  assert.equal(report.status, "passed");
  assert.equal(report.issues.length, 0);
  assert.equal(report.sampleCount, 2);
  assert.equal(report.metrics.worst.ttfbMs, 980);
  assert.equal(report.network.failedRequests, 1);
});
