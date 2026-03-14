function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNonNegativeNumber(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return null;
  }
  return Math.max(numeric, 0);
}

function round(value, digits = 1) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function compactUrl(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "-";
  }
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return `${parsed.host}${path}`;
  } catch {
    return raw.replace(/^https?:\/\//i, "");
  }
}

function statusLabel(status = "warn") {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "passed") {
    return "Pass";
  }
  if (normalized === "fail" || normalized === "failed") {
    return "Fail";
  }
  return "Warn";
}

function statusTone(status = "warn") {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "passed") {
    return "pass";
  }
  if (normalized === "fail" || normalized === "failed") {
    return "fail";
  }
  return "warn";
}

function formatMetricValue(value, kind = "ms") {
  const numeric = toNumberOrNull(value);
  if (numeric === null) {
    return "n/a";
  }
  if (kind === "ratio") {
    return String(round(numeric, 3));
  }
  if (kind === "bytes-kb") {
    return `${round(numeric, 1)} KB`;
  }
  return `${round(numeric, 0)} ms`;
}

function metricThresholdStatus(metricKey, value, thresholds = {}) {
  const observed = toNonNegativeNumber(value);
  if (observed === null) {
    return "warn";
  }
  const thresholdMap = {
    lcpMs: "lcpMs",
    inpMs: null,
    cls: "cls",
    ttfbMs: "ttfbMs",
    totalLoadTimeMs: "loadEventMs",
    p95ApiMs: null
  };
  const thresholdKey = thresholdMap[metricKey] ?? null;
  if (!thresholdKey) {
    return "warn";
  }
  const threshold = toNonNegativeNumber(thresholds?.[thresholdKey]);
  if (threshold === null || threshold <= 0) {
    return "warn";
  }
  const ratio = observed / threshold;
  if (ratio > 1) {
    return "fail";
  }
  if (ratio >= 0.8) {
    return "warn";
  }
  return "pass";
}

function buildSummaryCards(summary = {}, failures = [], advisories = []) {
  const score = toNonNegativeNumber(summary?.score);
  return [
    {
      key: "overallStatus",
      label: "Overall status",
      value: statusLabel(summary?.overallStatus ?? "warn"),
      tone: statusTone(summary?.overallStatus ?? "warn")
    },
    {
      key: "score",
      label: "Score",
      value: score === null ? "n/a" : String(Math.round(score)),
      tone: score !== null && score < 60 ? "fail" : score !== null && score < 80 ? "warn" : "pass"
    },
    {
      key: "testedPages",
      label: "Tested pages",
      value: String(Math.max(Number(summary?.testedPages ?? 0), 0)),
      tone: "warn"
    },
    {
      key: "testedEndpoints",
      label: "Tested endpoints",
      value: String(Math.max(Number(summary?.testedEndpoints ?? 0), 0)),
      tone: "warn"
    },
    {
      key: "criticalFailures",
      label: "Critical failures",
      value: String(Math.max(Number(summary?.criticalFailures ?? 0), 0)),
      tone: Number(summary?.criticalFailures ?? 0) > 0 ? "fail" : "pass"
    },
    {
      key: "advisories",
      label: "Advisories",
      value: String(Math.max(Number(summary?.advisories ?? advisories.length ?? 0), 0)),
      tone: advisories.length > 0 ? "warn" : "pass"
    },
    {
      key: "failures",
      label: "Failures",
      value: String(failures.length),
      tone: failures.length > 0 ? "fail" : "pass"
    }
  ];
}

function deriveSlowPages(pages = []) {
  return [...pages]
    .sort((left, right) => Number(right?.worst?.lcpMs ?? right?.metrics?.lcpMs ?? 0) - Number(left?.worst?.lcpMs ?? left?.metrics?.lcpMs ?? 0))
    .slice(0, 8)
    .map((page) => ({
      url: page.url ?? "",
      label: compactUrl(page.url),
      lcpMs: toNonNegativeNumber(page?.worst?.lcpMs ?? page?.metrics?.lcpMs),
      loadEventMs: toNonNegativeNumber(page?.worst?.loadEventMs ?? page?.metrics?.loadEventMs),
      cls: toNumberOrNull(page?.worst?.cls ?? page?.metrics?.cls)
    }));
}

function deriveSlowEndpoints(endpoints = []) {
  return [...endpoints]
    .sort((left, right) => Number(right?.p95Ms ?? 0) - Number(left?.p95Ms ?? 0))
    .slice(0, 8)
    .map((endpoint) => ({
      endpointPath: endpoint.endpointPath ?? "",
      label: compactUrl(endpoint.endpointPath),
      p95Ms: toNonNegativeNumber(endpoint?.p95Ms),
      p99Ms: toNonNegativeNumber(endpoint?.p99Ms),
      maxMs: toNonNegativeNumber(endpoint?.maxMs),
      count: Math.max(Number(endpoint?.count ?? 0), 0)
    }));
}

function buildBars(items = [], valueKey = "value") {
  const values = items.map((entry) => Number(entry?.[valueKey] ?? 0)).filter((value) => Number.isFinite(value) && value > 0);
  const maxValue = values.length ? Math.max(...values) : 0;
  return items.map((entry) => {
    const raw = Number(entry?.[valueKey] ?? 0);
    const widthPercent = maxValue > 0 && Number.isFinite(raw) && raw > 0 ? Math.max(Math.min((raw / maxValue) * 100, 100), 4) : 0;
    return {
      ...entry,
      widthPercent: round(widthPercent, 1) ?? 0
    };
  });
}

function normalizeBaselineComparison(baselineComparison = null) {
  if (!baselineComparison || typeof baselineComparison !== "object") {
    return null;
  }

  const rawDeltas = baselineComparison.metricDeltas ?? baselineComparison.deltas ?? {};
  const entries = Object.entries(rawDeltas)
    .map(([key, value]) => {
      if (!value || typeof value !== "object") {
        return null;
      }
      const delta = toNumberOrNull(value.delta ?? value.change ?? value.value);
      if (delta === null) {
        return null;
      }
      return {
        key,
        before: toNumberOrNull(value.before),
        after: toNumberOrNull(value.after),
        delta,
        trend: delta > 0 ? "regression" : delta < 0 ? "improvement" : "flat",
        unit: String(value.unit ?? "").trim() || (key === "cls" ? "ratio" : "ms")
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  return {
    baselineId: baselineComparison.baselineId ?? null,
    summary: baselineComparison.summary ?? null,
    deltas: entries
  };
}

export function normalizePerformanceDashboardModel(performance = {}) {
  const source = performance && typeof performance === "object" ? performance : {};
  const failures = Array.isArray(source.failures ?? source.issues) ? source.failures ?? source.issues : [];
  const advisories = Array.isArray(source.advisories) ? source.advisories : [];
  const pages = Array.isArray(source.pages) ? source.pages : [];
  const endpoints = Array.isArray(source.endpoints) ? source.endpoints : [];
  const summary = source.summary && typeof source.summary === "object" ? source.summary : {};
  const keyMetrics = source.keyMetrics && typeof source.keyMetrics === "object" ? source.keyMetrics : {};
  const thresholds = source.thresholds && typeof source.thresholds === "object" ? source.thresholds : {};

  const keyMetricCards = [
    { key: "lcpMs", label: "LCP", kind: "ms" },
    { key: "inpMs", label: "INP", kind: "ms" },
    { key: "cls", label: "CLS", kind: "ratio" },
    { key: "ttfbMs", label: "TTFB", kind: "ms" },
    { key: "totalLoadTimeMs", label: "Total load", kind: "ms" },
    { key: "p95ApiMs", label: "API p95", kind: "ms" },
    { key: "pageWeightKb", label: "Page weight", kind: "bytes-kb" }
  ].map((metric) => {
    const value = toNumberOrNull(keyMetrics?.[metric.key]);
    return {
      ...metric,
      value,
      valueLabel: formatMetricValue(value, metric.kind),
      status: metricThresholdStatus(metric.key, value, thresholds),
      threshold: thresholds?.[metric.key] ?? null
    };
  });

  const slowPages = Array.isArray(source.slowPages) && source.slowPages.length ? source.slowPages : deriveSlowPages(pages);
  const slowEndpoints =
    Array.isArray(source.slowEndpoints) && source.slowEndpoints.length ? source.slowEndpoints : deriveSlowEndpoints(endpoints);

  const pageBars = buildBars(
    deriveSlowPages(pages).map((page) => ({
      label: page.label,
      value: page.lcpMs
    })),
    "value"
  );
  const endpointBars = buildBars(
    deriveSlowEndpoints(endpoints).map((endpoint) => ({
      label: endpoint.label,
      value: endpoint.p95Ms
    })),
    "value"
  );

  return {
    mode: "performance",
    enabled: Boolean(source.enabled),
    status: String(source.status ?? "queued"),
    overallStatus: String(summary?.overallStatus ?? source.overallStatus ?? "warn"),
    summaryText: String(source.summaryText ?? "").trim(),
    summaryCards: buildSummaryCards(summary, failures, advisories),
    keyMetricCards,
    slowPages,
    slowEndpoints,
    pageBars,
    endpointBars,
    failures,
    advisories,
    baselineComparison: normalizeBaselineComparison(source.baselineComparison),
    sampleCount: Math.max(Number(source.sampleCount ?? source.samples?.length ?? 0), 0),
    hasData:
      Math.max(Number(source.sampleCount ?? source.samples?.length ?? 0), 0) > 0 ||
      pages.length > 0 ||
      endpoints.length > 0 ||
      failures.length > 0 ||
      advisories.length > 0
  };
}

