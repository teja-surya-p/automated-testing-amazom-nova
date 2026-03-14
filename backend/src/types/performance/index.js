const MS_ROUND_DIGITS = 1;

export const DEFAULT_PERFORMANCE_BUDGETS = Object.freeze({
  ttfbMs: 1800,
  fcpMs: 2500,
  lcpMs: 4000,
  cls: 0.1,
  domContentLoadedMs: 3500,
  loadEventMs: 7000,
  failedRequests: 2
});

export const DEFAULT_PERFORMANCE_SETTINGS = Object.freeze({
  sampleCount: 3,
  warmupDelayMs: 600,
  budgets: DEFAULT_PERFORMANCE_BUDGETS
});

function clampNumber(value, { min, max, fallback }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(numeric, min), max);
}

function roundMetric(value, digits = MS_ROUND_DIGITS) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toMetricNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

function avgMetric(samples = []) {
  const values = samples.filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxMetric(samples = []) {
  const values = samples.filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}

function percentile(values = [], percentileValue = 0.95) {
  const numericValues = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (numericValues.length === 0) {
    return null;
  }
  const position = Math.min(
    numericValues.length - 1,
    Math.max(0, Math.ceil(percentileValue * numericValues.length) - 1)
  );
  return numericValues[position];
}

function worstSeverityForRatio(ratio = 1) {
  if (!Number.isFinite(ratio) || ratio <= 1) {
    return "P2";
  }
  if (ratio >= 2) {
    return "P1";
  }
  return "P2";
}

function normalizePathFromUrl(url = "") {
  const raw = String(url ?? "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw;
  }
}

function createFailure({ issueType, title, expected, actual, budget, observed, affectedUrl, severity = null, confidence = 0.9 }) {
  const ratio = Number.isFinite(Number(budget)) && Number(budget) > 0 ? Number(observed) / Number(budget) : 1;
  return {
    id: `perf-${String(issueType).toLowerCase()}`,
    issueType,
    mode: "performance",
    severity: severity ?? worstSeverityForRatio(ratio),
    confidence,
    title,
    summary: actual,
    expected,
    actual,
    affectedUrl: affectedUrl ?? null,
    evidenceRefs: []
  };
}

function createAdvisory({ issueType, title, message, affectedUrl = null, confidence = 0.76 }) {
  return {
    id: `perf-adv-${String(issueType).toLowerCase()}`,
    issueType,
    mode: "performance",
    severity: "P3",
    confidence,
    title,
    summary: message,
    expected: "Monitor and optimize before this becomes a hard failure.",
    actual: message,
    affectedUrl,
    evidenceRefs: []
  };
}

function toPageKey(url = "") {
  return String(url ?? "").trim() || "unknown-page";
}

function aggregatePageRows(samples = []) {
  const pages = new Map();

  for (const sample of samples) {
    const key = toPageKey(sample?.url);
    const current = pages.get(key) ?? {
      url: sample?.url ?? "",
      title: sample?.title ?? "",
      sampleCount: 0,
      ttfbValues: [],
      fcpValues: [],
      lcpValues: [],
      clsValues: [],
      loadValues: [],
      transferSizeValues: []
    };

    current.sampleCount += 1;
    current.ttfbValues.push(toMetricNumber(sample?.metrics?.ttfbMs));
    current.fcpValues.push(toMetricNumber(sample?.metrics?.fcpMs));
    current.lcpValues.push(toMetricNumber(sample?.metrics?.lcpMs));
    current.clsValues.push(toMetricNumber(sample?.metrics?.cls));
    current.loadValues.push(toMetricNumber(sample?.metrics?.loadEventMs));
    current.transferSizeValues.push(toMetricNumber(sample?.resourceSummary?.transferSize));

    pages.set(key, current);
  }

  return [...pages.values()].map((page) => ({
    url: page.url,
    title: page.title,
    sampleCount: page.sampleCount,
    metrics: {
      ttfbMs: roundMetric(avgMetric(page.ttfbValues)),
      fcpMs: roundMetric(avgMetric(page.fcpValues)),
      lcpMs: roundMetric(avgMetric(page.lcpValues)),
      cls: roundMetric(avgMetric(page.clsValues), 3),
      loadEventMs: roundMetric(avgMetric(page.loadValues)),
      transferSizeKb: roundMetric(avgMetric(page.transferSizeValues) / 1024)
    },
    worst: {
      ttfbMs: roundMetric(maxMetric(page.ttfbValues)),
      fcpMs: roundMetric(maxMetric(page.fcpValues)),
      lcpMs: roundMetric(maxMetric(page.lcpValues)),
      cls: roundMetric(maxMetric(page.clsValues), 3),
      loadEventMs: roundMetric(maxMetric(page.loadValues))
    }
  }));
}

function aggregateEndpointRows(samples = []) {
  const endpoints = new Map();

  for (const sample of samples) {
    const endpointTimings = Array.isArray(sample?.resourceSummary?.endpointTimings)
      ? sample.resourceSummary.endpointTimings
      : [];

    for (const timing of endpointTimings) {
      const endpointPath = normalizePathFromUrl(timing?.url);
      if (!endpointPath) {
        continue;
      }
      const key = `${endpointPath}|${String(timing?.initiatorType ?? "fetch").toLowerCase()}`;
      const current = endpoints.get(key) ?? {
        endpointPath,
        initiatorType: String(timing?.initiatorType ?? "fetch").toLowerCase(),
        durations: [],
        transferSizes: [],
        count: 0
      };

      current.count += 1;
      current.durations.push(toMetricNumber(timing?.durationMs));
      current.transferSizes.push(toMetricNumber(timing?.transferSize));
      endpoints.set(key, current);
    }
  }

  return [...endpoints.values()].map((endpoint) => {
    const avgDuration = avgMetric(endpoint.durations);
    const p95 = percentile(endpoint.durations, 0.95);
    const p99 = percentile(endpoint.durations, 0.99);
    const p50 = percentile(endpoint.durations, 0.5);
    const maxDuration = maxMetric(endpoint.durations);

    return {
      endpointPath: endpoint.endpointPath,
      initiatorType: endpoint.initiatorType,
      count: endpoint.count,
      avgMs: roundMetric(avgDuration),
      p50Ms: roundMetric(p50),
      p95Ms: roundMetric(p95),
      p99Ms: roundMetric(p99),
      maxMs: roundMetric(maxDuration),
      transferSizeKb: roundMetric((avgMetric(endpoint.transferSizes) ?? 0) / 1024)
    };
  });
}

function deriveSlowPages(pages = []) {
  return [...pages]
    .sort((left, right) => {
      const lcpDiff = Number(right.worst?.lcpMs ?? 0) - Number(left.worst?.lcpMs ?? 0);
      if (lcpDiff !== 0) {
        return lcpDiff;
      }
      return Number(right.worst?.loadEventMs ?? 0) - Number(left.worst?.loadEventMs ?? 0);
    })
    .slice(0, 12)
    .map((page) => ({
      url: page.url,
      title: page.title,
      sampleCount: page.sampleCount,
      lcpMs: page.worst?.lcpMs ?? page.metrics?.lcpMs ?? null,
      loadEventMs: page.worst?.loadEventMs ?? page.metrics?.loadEventMs ?? null,
      cls: page.worst?.cls ?? page.metrics?.cls ?? null
    }));
}

function deriveSlowEndpoints(endpoints = []) {
  return [...endpoints]
    .sort((left, right) => {
      const p95Diff = Number(right.p95Ms ?? 0) - Number(left.p95Ms ?? 0);
      if (p95Diff !== 0) {
        return p95Diff;
      }
      return Number(right.maxMs ?? 0) - Number(left.maxMs ?? 0);
    })
    .slice(0, 12);
}

export function resolvePerformanceSettings(runConfig = {}) {
  const source = runConfig?.performance && typeof runConfig.performance === "object" ? runConfig.performance : {};
  const sourceBudgets = source.budgets && typeof source.budgets === "object" ? source.budgets : {};

  return {
    sampleCount: Math.floor(
      clampNumber(source.sampleCount, {
        min: 1,
        max: 8,
        fallback: DEFAULT_PERFORMANCE_SETTINGS.sampleCount
      })
    ),
    warmupDelayMs: Math.floor(
      clampNumber(source.warmupDelayMs, {
        min: 0,
        max: 5_000,
        fallback: DEFAULT_PERFORMANCE_SETTINGS.warmupDelayMs
      })
    ),
    budgets: {
      ttfbMs: clampNumber(sourceBudgets.ttfbMs, {
        min: 250,
        max: 20_000,
        fallback: DEFAULT_PERFORMANCE_BUDGETS.ttfbMs
      }),
      fcpMs: clampNumber(sourceBudgets.fcpMs, {
        min: 300,
        max: 20_000,
        fallback: DEFAULT_PERFORMANCE_BUDGETS.fcpMs
      }),
      lcpMs: clampNumber(sourceBudgets.lcpMs, {
        min: 500,
        max: 30_000,
        fallback: DEFAULT_PERFORMANCE_BUDGETS.lcpMs
      }),
      cls: clampNumber(sourceBudgets.cls, {
        min: 0.01,
        max: 1,
        fallback: DEFAULT_PERFORMANCE_BUDGETS.cls
      }),
      domContentLoadedMs: clampNumber(sourceBudgets.domContentLoadedMs, {
        min: 500,
        max: 30_000,
        fallback: DEFAULT_PERFORMANCE_BUDGETS.domContentLoadedMs
      }),
      loadEventMs: clampNumber(sourceBudgets.loadEventMs, {
        min: 800,
        max: 60_000,
        fallback: DEFAULT_PERFORMANCE_BUDGETS.loadEventMs
      }),
      failedRequests: Math.floor(
        clampNumber(sourceBudgets.failedRequests, {
          min: 0,
          max: 200,
          fallback: DEFAULT_PERFORMANCE_BUDGETS.failedRequests
        })
      )
    }
  };
}

export async function collectPerformanceProbe(page, { step = null, targetUrl = "" } = {}) {
  if (!page || typeof page.evaluate !== "function") {
    return null;
  }

  const collected = await page
    .evaluate(() => {
      const nav = performance.getEntriesByType("navigation")?.[0] ?? null;
      const paints = performance.getEntriesByType("paint") ?? [];
      const resources = performance.getEntriesByType("resource") ?? [];
      const eventTimings = performance.getEntriesByType("event") ?? [];
      const lcpEntries = performance.getEntriesByType("largest-contentful-paint") ?? [];
      const clsEntries = performance.getEntriesByType("layout-shift") ?? [];
      const longTasks = performance.getEntriesByType("longtask") ?? [];

      const firstPaint = paints.find((entry) => entry.name === "first-paint")?.startTime ?? null;
      const firstContentfulPaint =
        paints.find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null;
      const largestContentfulPaint = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : null;

      const cumulativeLayoutShift = clsEntries.reduce((sum, entry) => {
        if (!entry || entry.hadRecentInput) {
          return sum;
        }
        const value = Number(entry.value);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0);

      const interactionLatencyMs = eventTimings
        .map((entry) => Number(entry.duration))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => right - left)[0] ?? null;

      const longTaskBlockingMs = longTasks.reduce((sum, entry) => {
        const duration = Number(entry?.duration ?? 0);
        if (!Number.isFinite(duration) || duration <= 50) {
          return sum;
        }
        return sum + (duration - 50);
      }, 0);

      const endpointTimings = resources
        .map((resource) => {
          const initiatorType = String(resource?.initiatorType ?? "").toLowerCase();
          const isEndpointLike = ["fetch", "xmlhttprequest", "beacon"].includes(initiatorType);
          if (!isEndpointLike) {
            return null;
          }
          const durationMs = Number(resource?.duration ?? 0);
          return {
            url: String(resource?.name ?? ""),
            initiatorType,
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            transferSize: Number(resource?.transferSize ?? 0)
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, 60);

      const resourceCount = resources.length;
      const transferSize = resources.reduce((sum, resource) => {
        const value = Number(resource?.transferSize ?? 0);
        return Number.isFinite(value) ? sum + Math.max(0, value) : sum;
      }, 0);

      return {
        url: location.href,
        title: document.title,
        capturedAt: new Date().toISOString(),
        metrics: {
          ttfbMs: nav?.responseStart ?? null,
          domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null,
          loadEventMs: nav?.loadEventEnd ?? null,
          fcpMs: firstContentfulPaint,
          fpMs: firstPaint,
          lcpMs: largestContentfulPaint,
          cls: cumulativeLayoutShift,
          interactionLatencyMs,
          longTaskBlockingMs
        },
        resourceSummary: {
          resourceCount,
          transferSize,
          endpointTimings
        }
      };
    })
    .catch(() => null);

  if (!collected) {
    return null;
  }

  return {
    step,
    url: String(collected.url ?? targetUrl ?? "").trim(),
    title: String(collected.title ?? "").trim(),
    capturedAt: collected.capturedAt,
    metrics: {
      ttfbMs: toMetricNumber(collected.metrics?.ttfbMs),
      domContentLoadedMs: toMetricNumber(collected.metrics?.domContentLoadedMs),
      loadEventMs: toMetricNumber(collected.metrics?.loadEventMs),
      fcpMs: toMetricNumber(collected.metrics?.fcpMs),
      fpMs: toMetricNumber(collected.metrics?.fpMs),
      lcpMs: toMetricNumber(collected.metrics?.lcpMs),
      cls: toMetricNumber(collected.metrics?.cls),
      interactionLatencyMs: toMetricNumber(collected.metrics?.interactionLatencyMs),
      longTaskBlockingMs: toMetricNumber(collected.metrics?.longTaskBlockingMs)
    },
    resourceSummary: {
      resourceCount: Math.max(Number(collected.resourceSummary?.resourceCount ?? 0), 0),
      transferSize: Math.max(Number(collected.resourceSummary?.transferSize ?? 0), 0),
      endpointTimings: Array.isArray(collected.resourceSummary?.endpointTimings)
        ? collected.resourceSummary.endpointTimings
            .map((entry) => ({
              url: String(entry?.url ?? "").trim(),
              initiatorType: String(entry?.initiatorType ?? "fetch").trim().toLowerCase() || "fetch",
              durationMs: toMetricNumber(entry?.durationMs) ?? 0,
              transferSize: Math.max(Number(entry?.transferSize ?? 0), 0)
            }))
            .filter((entry) => entry.url.length > 0)
        : []
    }
  };
}

export function summarizePerformanceSamples(samples = [], networkSummary = {}) {
  const normalizedSamples = (Array.isArray(samples) ? samples : []).filter(Boolean);
  const metricBuckets = {
    ttfbMs: [],
    domContentLoadedMs: [],
    loadEventMs: [],
    fcpMs: [],
    fpMs: [],
    lcpMs: [],
    cls: [],
    interactionLatencyMs: [],
    longTaskBlockingMs: []
  };

  for (const sample of normalizedSamples) {
    for (const key of Object.keys(metricBuckets)) {
      const value = Number(sample?.metrics?.[key]);
      if (Number.isFinite(value) && value >= 0) {
        metricBuckets[key].push(value);
      }
    }
  }

  const aggregate = {
    average: {
      ttfbMs: roundMetric(avgMetric(metricBuckets.ttfbMs)),
      domContentLoadedMs: roundMetric(avgMetric(metricBuckets.domContentLoadedMs)),
      loadEventMs: roundMetric(avgMetric(metricBuckets.loadEventMs)),
      fcpMs: roundMetric(avgMetric(metricBuckets.fcpMs)),
      fpMs: roundMetric(avgMetric(metricBuckets.fpMs)),
      lcpMs: roundMetric(avgMetric(metricBuckets.lcpMs)),
      cls: roundMetric(avgMetric(metricBuckets.cls), 3),
      interactionLatencyMs: roundMetric(avgMetric(metricBuckets.interactionLatencyMs)),
      longTaskBlockingMs: roundMetric(avgMetric(metricBuckets.longTaskBlockingMs))
    },
    worst: {
      ttfbMs: roundMetric(maxMetric(metricBuckets.ttfbMs)),
      domContentLoadedMs: roundMetric(maxMetric(metricBuckets.domContentLoadedMs)),
      loadEventMs: roundMetric(maxMetric(metricBuckets.loadEventMs)),
      fcpMs: roundMetric(maxMetric(metricBuckets.fcpMs)),
      fpMs: roundMetric(maxMetric(metricBuckets.fpMs)),
      lcpMs: roundMetric(maxMetric(metricBuckets.lcpMs)),
      cls: roundMetric(maxMetric(metricBuckets.cls), 3),
      interactionLatencyMs: roundMetric(maxMetric(metricBuckets.interactionLatencyMs)),
      longTaskBlockingMs: roundMetric(maxMetric(metricBuckets.longTaskBlockingMs))
    }
  };

  const pages = aggregatePageRows(normalizedSamples);
  const endpoints = aggregateEndpointRows(normalizedSamples);
  const slowPages = deriveSlowPages(pages);
  const slowEndpoints = deriveSlowEndpoints(endpoints);
  const p95ApiMs = percentile(endpoints.map((entry) => Number(entry.p95Ms)), 0.95);

  return {
    sampleCount: normalizedSamples.length,
    samples: normalizedSamples,
    metrics: aggregate,
    pages,
    endpoints,
    slowPages,
    slowEndpoints,
    keyMetrics: {
      lcpMs: aggregate.worst.lcpMs,
      inpMs: aggregate.worst.interactionLatencyMs,
      interactionLatencyMs: aggregate.worst.interactionLatencyMs,
      cls: aggregate.worst.cls,
      ttfbMs: aggregate.worst.ttfbMs,
      totalLoadTimeMs: aggregate.worst.loadEventMs,
      jsBlockingTimeMs: aggregate.worst.longTaskBlockingMs,
      pageWeightKb: roundMetric(
        avgMetric(normalizedSamples.map((sample) => Number(sample?.resourceSummary?.transferSize ?? 0))) / 1024
      ),
      p95ApiMs: roundMetric(p95ApiMs)
    },
    network: {
      totalRequests: Number(networkSummary?.totalRequests ?? 0),
      failedRequests: Number(networkSummary?.failedRequests ?? 0),
      status4xx: Number(networkSummary?.status4xx ?? 0),
      status5xx: Number(networkSummary?.status5xx ?? 0),
      status429: Number(networkSummary?.status429 ?? 0)
    }
  };
}

export function evaluatePerformanceSummary(summary = {}, settings = DEFAULT_PERFORMANCE_SETTINGS) {
  const budgets = settings?.budgets ?? DEFAULT_PERFORMANCE_BUDGETS;
  const failures = [];
  const advisories = [];
  const worst = summary?.metrics?.worst ?? {};
  const network = summary?.network ?? {};
  const keyMetrics = summary?.keyMetrics ?? {};
  const affectedUrl = summary?.samples?.[summary.samples.length - 1]?.url ?? null;

  const registerMetric = ({
    key,
    issueType,
    advisoryType,
    title,
    expectedLabel,
    valueFormatter = (value) => `${roundMetric(value)}`
  }) => {
    const observed = Number(worst?.[key]);
    const budget = Number(budgets?.[key]);
    if (!Number.isFinite(observed) || !Number.isFinite(budget) || budget <= 0) {
      return;
    }
    if (observed > budget) {
      failures.push(
        createFailure({
          issueType,
          title,
          expected: `${expectedLabel} <= ${valueFormatter(budget)}`,
          actual: `Observed ${expectedLabel} ${valueFormatter(observed)}.`,
          budget,
          observed,
          affectedUrl
        })
      );
      return;
    }

    const ratio = observed / budget;
    if (ratio >= 0.8) {
      advisories.push(
        createAdvisory({
          issueType: advisoryType,
          title: `${title} nearing threshold`,
          message: `Observed ${expectedLabel} ${valueFormatter(observed)} is close to threshold ${valueFormatter(budget)}.`,
          affectedUrl
        })
      );
    }
  };

  registerMetric({
    key: "ttfbMs",
    issueType: "PERF_TTFB_SLOW",
    advisoryType: "PERF_TTFB_ADVISORY",
    title: "Slow server response time",
    expectedLabel: "TTFB",
    valueFormatter: (value) => `${roundMetric(value)} ms`
  });
  registerMetric({
    key: "fcpMs",
    issueType: "PERF_FCP_SLOW",
    advisoryType: "PERF_FCP_ADVISORY",
    title: "Slow first contentful paint",
    expectedLabel: "FCP",
    valueFormatter: (value) => `${roundMetric(value)} ms`
  });
  registerMetric({
    key: "lcpMs",
    issueType: "PERF_LCP_SLOW",
    advisoryType: "PERF_LCP_ADVISORY",
    title: "Slow largest contentful paint",
    expectedLabel: "LCP",
    valueFormatter: (value) => `${roundMetric(value)} ms`
  });
  registerMetric({
    key: "domContentLoadedMs",
    issueType: "PERF_DOM_CONTENT_LOADED_SLOW",
    advisoryType: "PERF_DOM_CONTENT_LOADED_ADVISORY",
    title: "Slow DOM content loaded",
    expectedLabel: "DOMContentLoaded",
    valueFormatter: (value) => `${roundMetric(value)} ms`
  });
  registerMetric({
    key: "loadEventMs",
    issueType: "PERF_LOAD_EVENT_SLOW",
    advisoryType: "PERF_LOAD_EVENT_ADVISORY",
    title: "Slow page load completion",
    expectedLabel: "Load event",
    valueFormatter: (value) => `${roundMetric(value)} ms`
  });
  registerMetric({
    key: "cls",
    issueType: "PERF_CLS_HIGH",
    advisoryType: "PERF_CLS_ADVISORY",
    title: "High cumulative layout shift",
    expectedLabel: "CLS",
    valueFormatter: (value) => `${roundMetric(value, 3)}`
  });

  if (Number.isFinite(network.failedRequests) && network.failedRequests > budgets.failedRequests) {
    failures.push(
      createFailure({
        issueType: "PERF_NETWORK_FAILURE_RATE",
        title: "Too many failed network requests",
        expected: `Failed requests <= ${budgets.failedRequests}`,
        actual: `Observed ${network.failedRequests} failed requests.`,
        budget: budgets.failedRequests,
        observed: network.failedRequests,
        affectedUrl
      })
    );
  } else if (Number.isFinite(network.failedRequests) && budgets.failedRequests > 0) {
    const ratio = network.failedRequests / budgets.failedRequests;
    if (ratio >= 0.8) {
      advisories.push(
        createAdvisory({
          issueType: "PERF_NETWORK_FAILURE_RATE_ADVISORY",
          title: "Network failures nearing threshold",
          message: `Observed ${network.failedRequests} failed requests near threshold ${budgets.failedRequests}.`,
          affectedUrl
        })
      );
    }
  }

  const slowEndpoints = Array.isArray(summary?.slowEndpoints) ? summary.slowEndpoints : [];
  const verySlowEndpoint = slowEndpoints[0];
  if (Number(verySlowEndpoint?.p95Ms ?? 0) >= 1500) {
    advisories.push(
      createAdvisory({
        issueType: "PERF_ENDPOINT_P95_ADVISORY",
        title: "Slow API endpoint latency detected",
        message: `Endpoint ${verySlowEndpoint.endpointPath} has p95 latency ${roundMetric(verySlowEndpoint.p95Ms)} ms.`,
        affectedUrl
      })
    );
  }

  if (Number(keyMetrics?.pageWeightKb ?? 0) >= 2500) {
    advisories.push(
      createAdvisory({
        issueType: "PERF_PAGE_WEIGHT_ADVISORY",
        title: "High page transfer size",
        message: `Average transfer size is ${roundMetric(keyMetrics.pageWeightKb)} KB, which can impact loading on slower networks.`,
        affectedUrl
      })
    );
  }

  const runStatus = summary.sampleCount <= 0 ? "failed" : failures.length > 0 ? "soft-passed" : "passed";
  const overallStatus = runStatus === "failed" ? "fail" : failures.length > 0 ? "fail" : advisories.length > 0 ? "warn" : "pass";
  const criticalFailures = failures.filter((issue) => issue.severity === "P1" || issue.severity === "P0").length;
  const score = Math.max(0, Math.min(100, 100 - failures.length * 14 - advisories.length * 4));
  const summaryText =
    runStatus === "failed"
      ? "Performance scan did not collect valid metrics."
      : failures.length > 0
        ? `Performance scan found ${failures.length} threshold failure${failures.length === 1 ? "" : "s"} and ${advisories.length} advisory item${advisories.length === 1 ? "" : "s"}.`
        : advisories.length > 0
          ? `Performance scan passed thresholds with ${advisories.length} advisory item${advisories.length === 1 ? "" : "s"}.`
          : `Performance scan passed across ${summary.sampleCount} sample${summary.sampleCount === 1 ? "" : "s"}.`;

  const summaryCards = {
    overallStatus,
    score,
    testedPages: (summary?.pages ?? []).length,
    testedEndpoints: (summary?.endpoints ?? []).length,
    criticalFailures,
    advisories: advisories.length
  };

  return {
    runStatus,
    overallStatus,
    failures,
    advisories,
    summary: summaryCards,
    summaryText
  };
}

export function buildPerformanceRunResult({ samples = [], networkSummary = {}, settings, baselineComparison = null }) {
  const resolvedSettings = settings ?? DEFAULT_PERFORMANCE_SETTINGS;
  const summary = summarizePerformanceSamples(samples, networkSummary);
  const evaluation = evaluatePerformanceSummary(summary, resolvedSettings);

  return {
    enabled: true,
    mode: "performance",
    sampleCount: summary.sampleCount,
    settings: {
      sampleCount: resolvedSettings.sampleCount,
      warmupDelayMs: resolvedSettings.warmupDelayMs
    },
    thresholds: resolvedSettings.budgets,
    status: evaluation.runStatus,
    overallStatus: evaluation.overallStatus,
    summary: evaluation.summary,
    summaryText: evaluation.summaryText,
    keyMetrics: summary.keyMetrics,
    samples: summary.samples,
    metrics: summary.metrics,
    network: summary.network,
    pages: summary.pages,
    endpoints: summary.endpoints,
    slowPages: summary.slowPages,
    slowEndpoints: summary.slowEndpoints,
    failures: evaluation.failures,
    advisories: evaluation.advisories,
    issues: evaluation.failures,
    baselineComparison: baselineComparison && typeof baselineComparison === "object" ? baselineComparison : null,
    completedAt: new Date().toISOString()
  };
}
