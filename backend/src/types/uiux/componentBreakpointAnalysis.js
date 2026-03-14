import { hashText } from "../../lib/utils.js";
import { resolveUiuxIssueFamily } from "../../library/reporting/clustering.js";

export const DEFAULT_UIUX_BREAKPOINT_SETTINGS = Object.freeze({
  enabled: true,
  autonomous: true,
  minWidth: 320,
  maxWidth: 1440,
  coarseStep: 40,
  fineStep: 12,
  refineTransitions: true,
  representativeWidthsPerRange: 3,
  maxConcurrentWorkers: 4,
  maxComponentsPerPage: 24,
  maxWidthsPerPage: 42,
  minHeight: 568,
  maxHeight: 1366,
  heightFineStep: 84,
  maxHeightsPerPage: 5,
  maxViewportsPerPage: 120,
  nearbyValidationRadius: 56,
  maxNearbyViewportProbes: 16
});

const WIDTH_DEVICE_HINTS = Object.freeze([
  { label: "iPhone SE", width: 320 },
  { label: "Galaxy S8", width: 360 },
  { label: "iPhone 12", width: 390 },
  { label: "Pixel 7", width: 412 },
  { label: "iPhone 14 Plus", width: 428 },
  { label: "iPad Mini", width: 744 },
  { label: "iPad", width: 768 },
  { label: "iPad Air", width: 820 },
  { label: "Tablet Landscape", width: 1024 },
  { label: "Laptop", width: 1280 },
  { label: "Desktop", width: 1440 }
]);

const HEIGHT_DEVICE_HINTS = Object.freeze([
  { label: "Small phone", height: 568 },
  { label: "Phone", height: 667 },
  { label: "Tall phone", height: 844 },
  { label: "Large phone", height: 915 },
  { label: "Tablet portrait", height: 1024 },
  { label: "Tablet tall", height: 1180 },
  { label: "Desktop short", height: 768 },
  { label: "Desktop", height: 900 },
  { label: "Desktop tall", height: 1080 }
]);

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return Math.min(Math.max(rounded, min), max);
}

function normalizeSelector(selector = "") {
  return String(selector ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

function normalizeLabel(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function buildRegionKey(bounds = null) {
  if (!bounds) {
    return "none";
  }
  const quantize = (value, step = 24) => Math.round(Number(value ?? 0) / step) * step;
  return [
    quantize(bounds.x),
    quantize(bounds.y),
    quantize(bounds.width),
    quantize(bounds.height)
  ].join(":");
}

function stableComponentId({ pageId = "/", type = "component", selector = "", bounds = null, label = "" }) {
  const selectorKey = normalizeSelector(selector);
  const labelKey = normalizeLabel(label).toLowerCase();
  const regionKey = buildRegionKey(bounds);
  return `cmp_${hashText(`${pageId}|${type}|${selectorKey}|${regionKey}|${labelKey}`).slice(0, 14)}`;
}

function normalizePath(url = "") {
  try {
    const parsed = new URL(String(url ?? ""));
    const normalized = parsed.pathname.replace(/\/+$/, "");
    return normalized || "/";
  } catch {
    return "/";
  }
}

function summarizeIssueSet(issues = []) {
  return [...new Set(
    issues.map((issue) =>
      `${resolveUiuxIssueFamily(issue.issueType ?? "UNKNOWN")}:${normalizeSelector(issue.affectedSelector ?? "")}`
    )
  )]
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function sortByWidth(entries = []) {
  return [...entries].sort((left, right) => Number(left.width ?? 0) - Number(right.width ?? 0));
}

function sortByHeight(entries = []) {
  return [...entries].sort((left, right) => Number(left.height ?? 0) - Number(right.height ?? 0));
}

function sortByViewport(entries = []) {
  return [...entries].sort((left, right) => {
    const widthDiff = Number(left.width ?? 0) - Number(right.width ?? 0);
    if (widthDiff !== 0) {
      return widthDiff;
    }
    return Number(left.height ?? 0) - Number(right.height ?? 0);
  });
}

function sortNumbers(values = []) {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value)))]
    .sort((left, right) => left - right);
}

function pickDistributedNumbers(values = [], maxCount = 12, requiredValues = []) {
  const sorted = sortNumbers(values);
  if (!sorted.length) {
    return [];
  }
  const targetCount = Math.max(1, Number(maxCount) || 1);
  if (sorted.length <= targetCount) {
    return sorted;
  }

  const picks = new Set();
  for (const value of requiredValues) {
    if (Number.isFinite(Number(value)) && sorted.includes(Number(value))) {
      picks.add(Number(value));
    }
  }
  picks.add(sorted[0]);
  picks.add(sorted[sorted.length - 1]);

  for (let slot = 1; slot < targetCount - 1 && picks.size < targetCount; slot += 1) {
    const index = Math.round((slot * (sorted.length - 1)) / Math.max(targetCount - 1, 1));
    picks.add(sorted[index]);
  }

  if (picks.size < targetCount) {
    for (const value of sorted) {
      picks.add(value);
      if (picks.size >= targetCount) {
        break;
      }
    }
  }

  return sortNumbers([...picks.values()]).slice(0, targetCount);
}

function viewportKey(width, height) {
  return `${Math.round(Number(width ?? 0))}x${Math.round(Number(height ?? 0))}`;
}

function resolveViewportLabel(width, height) {
  return `w-${Math.round(Number(width ?? 0))}-h-${Math.round(Number(height ?? 0))}`;
}

function resolveDeviceLabelForWidth(width) {
  const normalizedWidth = Number(width);
  const closest = [...WIDTH_DEVICE_HINTS].sort(
    (left, right) =>
      Math.abs(left.width - normalizedWidth) - Math.abs(right.width - normalizedWidth)
  )[0];
  if (!closest) {
    return `w${Math.round(normalizedWidth)}`;
  }
  return `${closest.label} (${Math.round(normalizedWidth)}px)`;
}

function resolveDeviceLabelForViewport(width, height) {
  return `${resolveDeviceLabelForWidth(width)} × h${Math.round(Number(height ?? 0))}`;
}

function pickRepresentativeWidthsForRange({ start, end }, count = 3) {
  const safeStart = Number(start);
  const safeEnd = Number(end);
  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd)) {
    return [];
  }
  if (safeStart >= safeEnd) {
    return [safeStart];
  }
  const maxCount = Math.max(1, Math.floor(Number(count) || 1));
  if (maxCount === 1) {
    return [Math.round((safeStart + safeEnd) / 2)];
  }
  const candidates = [
    safeStart,
    Math.round((safeStart + safeEnd) / 2),
    safeEnd
  ];
  if (maxCount > 3) {
    const extraSpan = safeEnd - safeStart;
    for (let index = 1; index <= maxCount - 3; index += 1) {
      candidates.push(Math.round(safeStart + (extraSpan * index) / (maxCount - 1)));
    }
  }
  return sortNumbers(candidates).slice(0, maxCount);
}

export function resolveUiuxBreakpointSettings(runConfig = {}) {
  const raw = runConfig?.uiux?.breakpoints ?? {};
  const currentViewportWidth = clampInt(
    runConfig?.uiux?.__runtimeContext?.viewportWidth,
    240,
    2560,
    DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxWidth
  );
  const currentViewportHeight = clampInt(
    runConfig?.uiux?.__runtimeContext?.viewportHeight,
    320,
    1600,
    900
  );
  const componentCountHint = clampInt(
    runConfig?.uiux?.__runtimeContext?.componentCount,
    1,
    80,
    16
  );
  const dynamicMinWidthFallback = Math.min(360, Math.max(240, Math.round(currentViewportWidth * 0.45)));
  const dynamicMaxWidthFallback = Math.max(
    1366,
    Math.min(2560, Math.round(currentViewportWidth * 1.6))
  );
  const minWidth = clampInt(
    raw.minWidth,
    240,
    2200,
    dynamicMinWidthFallback
  );
  const maxWidth = clampInt(
    raw.maxWidth,
    minWidth + 32,
    2560,
    dynamicMaxWidthFallback
  );
  const widthSpan = Math.max(maxWidth - minWidth, 240);
  const targetSampleCount = clampInt(
    Math.round(18 + componentCountHint * 1.15),
    16,
    60,
    30
  );
  const dynamicCoarseStep = clampInt(Math.round(widthSpan / targetSampleCount), 16, 96, 40);
  const dynamicFineStep = clampInt(Math.round(dynamicCoarseStep / 3), 6, 36, 12);
  const coarseStep = clampInt(
    raw.coarseStep,
    8,
    220,
    dynamicCoarseStep
  );
  const fineStep = clampInt(
    raw.fineStep,
    4,
    120,
    dynamicFineStep
  );
  const minHeight = clampInt(
    raw.minHeight,
    320,
    1400,
    Math.min(
      DEFAULT_UIUX_BREAKPOINT_SETTINGS.minHeight,
      Math.max(320, Math.round(currentViewportHeight * 0.7))
    )
  );
  const maxHeight = clampInt(
    raw.maxHeight,
    minHeight + 80,
    2200,
    Math.max(
      DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxHeight,
      Math.round(currentViewportHeight * 1.35)
    )
  );
  const dynamicConcurrency = clampInt(
    Math.ceil(componentCountHint / 5),
    2,
    6,
    DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxConcurrentWorkers
  );
  const dynamicRepresentativeWidths = componentCountHint >= 18 ? 4 : 3;
  const dynamicMaxWidthsPerPage = clampInt(
    targetSampleCount + 18,
    24,
    96,
    DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxWidthsPerPage
  );
  const dynamicMaxHeightsPerPage = componentCountHint >= 18 ? 6 : 5;
  const dynamicMaxViewportsPerPage = clampInt(
    dynamicMaxWidthsPerPage * dynamicMaxHeightsPerPage,
    48,
    240,
    DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxViewportsPerPage
  );
  const dynamicNearbyRadius = clampInt(
    Math.round(Math.max(Math.min(coarseStep, 72), fineStep * 2.5)),
    20,
    96,
    DEFAULT_UIUX_BREAKPOINT_SETTINGS.nearbyValidationRadius
  );
  const dynamicNearbyProbes = clampInt(
    dynamicRepresentativeWidths * dynamicMaxHeightsPerPage,
    8,
    30,
    DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxNearbyViewportProbes
  );

  return {
    enabled: raw.enabled !== false,
    autonomous: raw.autonomous !== false,
    minWidth,
    maxWidth,
    coarseStep,
    fineStep: Math.min(fineStep, coarseStep),
    refineTransitions: raw.refineTransitions !== false,
    representativeWidthsPerRange: clampInt(
      raw.representativeWidthsPerRange,
      1,
      5,
      dynamicRepresentativeWidths
    ),
    maxConcurrentWorkers: clampInt(
      raw.maxConcurrentWorkers,
      1,
      8,
      dynamicConcurrency
    ),
    maxComponentsPerPage: clampInt(
      raw.maxComponentsPerPage,
      4,
      60,
      DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxComponentsPerPage
    ),
    maxWidthsPerPage: clampInt(
      raw.maxWidthsPerPage,
      4,
      96,
      dynamicMaxWidthsPerPage
    ),
    minHeight,
    maxHeight,
    heightFineStep: clampInt(
      raw.heightFineStep,
      24,
      180,
      DEFAULT_UIUX_BREAKPOINT_SETTINGS.heightFineStep
    ),
    maxHeightsPerPage: clampInt(
      raw.maxHeightsPerPage,
      2,
      8,
      dynamicMaxHeightsPerPage
    ),
    maxViewportsPerPage: clampInt(
      raw.maxViewportsPerPage,
      24,
      300,
      dynamicMaxViewportsPerPage
    ),
    nearbyValidationRadius: clampInt(
      raw.nearbyValidationRadius,
      12,
      120,
      dynamicNearbyRadius
    ),
    maxNearbyViewportProbes: clampInt(
      raw.maxNearbyViewportProbes,
      4,
      32,
      dynamicNearbyProbes
    )
  };
}

export function buildCoarseWidthSweep(settings = DEFAULT_UIUX_BREAKPOINT_SETTINGS) {
  const widths = new Set();
  for (
    let width = settings.minWidth;
    width <= settings.maxWidth;
    width += settings.coarseStep
  ) {
    widths.add(width);
  }
  widths.add(settings.maxWidth);
  for (const profile of WIDTH_DEVICE_HINTS) {
    if (profile.width >= settings.minWidth && profile.width <= settings.maxWidth) {
      widths.add(profile.width);
    }
  }
  return pickDistributedNumbers(
    [...widths.values()],
    settings.maxWidthsPerPage,
    [settings.minWidth, settings.maxWidth]
  );
}

export function buildCoarseHeightSweep(settings = DEFAULT_UIUX_BREAKPOINT_SETTINGS, baseHeight = 900) {
  const normalizedBaseHeight = clampInt(baseHeight, settings.minHeight, settings.maxHeight, baseHeight);
  const heights = new Set([normalizedBaseHeight, settings.minHeight, settings.maxHeight]);
  for (const profile of HEIGHT_DEVICE_HINTS) {
    if (profile.height >= settings.minHeight && profile.height <= settings.maxHeight) {
      heights.add(profile.height);
    }
  }
  const rangeSpan = Math.max(settings.maxHeight - settings.minHeight, 120);
  const linearStep = clampInt(Math.round(rangeSpan / 4), 80, 280, 180);
  for (
    let height = settings.minHeight;
    height <= settings.maxHeight;
    height += linearStep
  ) {
    heights.add(height);
  }
  return pickDistributedNumbers(
    [...heights.values()],
    settings.maxHeightsPerPage,
    [settings.minHeight, normalizedBaseHeight, settings.maxHeight]
  );
}

function buildViewportGrid({
  widths = [],
  heights = [],
  maxViewports = DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxViewportsPerPage
} = {}) {
  const normalizedWidths = sortNumbers(widths);
  const normalizedHeights = sortNumbers(heights);
  const grid = [];
  for (const width of normalizedWidths) {
    for (const height of normalizedHeights) {
      grid.push({ width, height });
      if (grid.length >= maxViewports) {
        return grid;
      }
    }
  }
  return grid;
}

function aggregateAxisSignatures(entries = [], axis = "width") {
  const axisKey = axis === "height" ? "height" : "width";
  const peerKey = axisKey === "width" ? "height" : "width";
  const grouped = new Map();
  for (const entry of entries) {
    const axisValue = Number(entry?.[axisKey]);
    const peerValue = Number(entry?.[peerKey]);
    if (!Number.isFinite(axisValue) || !Number.isFinite(peerValue)) {
      continue;
    }
    const bucket = grouped.get(axisValue) ?? [];
    bucket.push(`${Math.round(peerValue)}:${buildWidthProbeSignature(entry.issues ?? [])}`);
    grouped.set(axisValue, bucket);
  }
  return sortNumbers([...grouped.keys()]).map((value) => ({
    value,
    signature: (grouped.get(value) ?? [])
      .sort((left, right) => left.localeCompare(right))
      .join("|")
  }));
}

function collectTransitionAxisValues({
  entries = [],
  minValue = 0,
  maxValue = 0,
  fineStep = 8,
  maxAxisCount = 32,
  refineTransitions = true
} = {}) {
  const sorted = [...entries]
    .map((entry) => ({
      value: Number(entry?.value),
      signature: String(entry?.signature ?? "")
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => left.value - right.value);
  const transitions = new Set();
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous.signature !== current.signature) {
      transitions.add(previous.value);
      transitions.add(current.value);
    }
  }
  if (!refineTransitions) {
    return [];
  }
  const refined = new Set();
  const sortedTransitionValues = sortNumbers([...transitions.values()]);
  for (let index = 1; index < sortedTransitionValues.length; index += 1) {
    const left = sortedTransitionValues[index - 1];
    const right = sortedTransitionValues[index];
    if (right - left <= fineStep) {
      continue;
    }
    for (let value = left + fineStep; value < right; value += fineStep) {
      refined.add(value);
      if (refined.size >= maxAxisCount) {
        break;
      }
    }
    if (refined.size >= maxAxisCount) {
      break;
    }
  }

  return sortNumbers(
    [...refined.values()].filter(
      (value) => value > minValue && value < maxValue
    )
  ).slice(0, Math.max(maxAxisCount - sorted.length, 0));
}

function collectTransitionWidths(entries = [], settings = DEFAULT_UIUX_BREAKPOINT_SETTINGS) {
  return collectTransitionAxisValues({
    entries: entries.map((entry) => ({
      value: Number(entry?.width),
      signature: entry?.signature ?? ""
    })),
    minValue: settings.minWidth,
    maxValue: settings.maxWidth,
    fineStep: settings.fineStep,
    maxAxisCount: settings.maxWidthsPerPage,
    refineTransitions: settings.refineTransitions
  });
}

function collectTransitionHeights(entries = [], settings = DEFAULT_UIUX_BREAKPOINT_SETTINGS) {
  return collectTransitionAxisValues({
    entries: entries.map((entry) => ({
      value: Number(entry?.height),
      signature: entry?.signature ?? ""
    })),
    minValue: settings.minHeight,
    maxValue: settings.maxHeight,
    fineStep: settings.heightFineStep,
    maxAxisCount: settings.maxHeightsPerPage,
    refineTransitions: settings.refineTransitions
  });
}

function buildNearbyViewportCandidates({
  failingEvaluations = [],
  existingViewportKeys = new Set(),
  settings = DEFAULT_UIUX_BREAKPOINT_SETTINGS
} = {}) {
  const candidates = new Map();
  const maxProbes = Math.max(1, Number(settings.maxNearbyViewportProbes) || 1);
  const widthDelta = Math.max(settings.fineStep, Math.round(settings.nearbyValidationRadius / 2));
  const heightDelta = Math.max(Math.round(settings.heightFineStep / 2), 32);

  for (const evaluation of sortByViewport(failingEvaluations)) {
    const width = Number(evaluation.width);
    const height = Number(evaluation.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      continue;
    }
    const candidateWidths = new Set([
      width - widthDelta,
      width,
      width + widthDelta
    ]);
    for (const profile of WIDTH_DEVICE_HINTS) {
      if (Math.abs(profile.width - width) <= settings.nearbyValidationRadius) {
        candidateWidths.add(profile.width);
      }
    }
    const candidateHeights = new Set([
      height - heightDelta,
      height,
      height + heightDelta
    ]);
    for (const profile of HEIGHT_DEVICE_HINTS) {
      if (Math.abs(profile.height - height) <= Math.max(heightDelta * 3, 180)) {
        candidateHeights.add(profile.height);
      }
    }

    for (const candidateWidth of sortNumbers([...candidateWidths.values()])) {
      if (candidateWidth < settings.minWidth || candidateWidth > settings.maxWidth) {
        continue;
      }
      for (const candidateHeight of sortNumbers([...candidateHeights.values()])) {
        if (candidateHeight < settings.minHeight || candidateHeight > settings.maxHeight) {
          continue;
        }
        const key = viewportKey(candidateWidth, candidateHeight);
        if (existingViewportKeys.has(key) || candidates.has(key)) {
          continue;
        }
        candidates.set(key, {
          width: candidateWidth,
          height: candidateHeight
        });
        if (candidates.size >= maxProbes) {
          return sortByViewport([...candidates.values()]);
        }
      }
    }
  }

  return sortByViewport([...candidates.values()]);
}

function selectBestLabel(candidates = []) {
  for (const value of candidates) {
    const normalized = normalizeLabel(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function pushComponent(components, component) {
  if (!component?.selector && !component?.bounds) {
    return;
  }
  const duplicate = components.some((entry) => {
    const sameSelector = entry.selector && component.selector && entry.selector === component.selector;
    const sameType = entry.type === component.type;
    const sameRegion =
      buildRegionKey(entry.bounds) === buildRegionKey(component.bounds) &&
      normalizeLabel(entry.label).toLowerCase() === normalizeLabel(component.label).toLowerCase();
    return (sameSelector && sameType) || (sameType && sameRegion);
  });
  if (!duplicate) {
    components.push(component);
  }
}

export function discoverUiuxComponents(snapshot = {}, options = {}) {
  const maxComponents = Math.max(
    4,
    Number(options.maxComponents ?? DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxComponentsPerPage) || 24
  );
  const pageId = normalizePath(snapshot.url ?? "");
  const components = [];

  const rootBounds = {
    x: 0,
    y: 0,
    width: Number(snapshot.viewportWidth ?? 0),
    height: Number(snapshot.viewportHeight ?? 0)
  };

  pushComponent(components, {
    id: stableComponentId({
      pageId,
      type: "page-shell",
      selector: "body",
      bounds: rootBounds,
      label: "Page shell"
    }),
    type: "page-shell",
    selector: "body",
    label: "Page shell",
    bounds: rootBounds
  });

  for (const landmark of snapshot.headerLandmarks ?? []) {
    pushComponent(components, {
      id: stableComponentId({
        pageId,
        type: "primary-nav",
        selector: landmark.selector,
        bounds: landmark.bounds,
        label: landmark.text
      }),
      type: "primary-nav",
      selector: landmark.selector,
      label: selectBestLabel([landmark.text, "Primary navigation"]),
      bounds: landmark.bounds
    });
  }

  if (snapshot.primaryCta?.selector || snapshot.primaryCta?.bounds) {
    pushComponent(components, {
      id: stableComponentId({
        pageId,
        type: "primary-cta",
        selector: snapshot.primaryCta.selector,
        bounds: snapshot.primaryCta.bounds,
        label: snapshot.primaryCta.text
      }),
      type: "primary-cta",
      selector: snapshot.primaryCta.selector,
      label: selectBestLabel([snapshot.primaryCta.text, "Primary CTA"]),
      bounds: snapshot.primaryCta.bounds
    });
  }

  for (const region of snapshot.dataDisplaySignals?.problematicRegions ?? []) {
    pushComponent(components, {
      id: stableComponentId({
        pageId,
        type: region.kind === "chart" ? "chart" : "table",
        selector: region.selector,
        bounds: region.bounds,
        label: `${region.kind === "chart" ? "Chart" : "Table"} region`
      }),
      type: region.kind === "chart" ? "chart" : "table",
      selector: region.selector,
      label: `${region.kind === "chart" ? "Chart" : "Table"} region`,
      bounds: region.bounds
    });
  }

  for (const entry of snapshot.responsiveSignals?.majorOverflowContainers ?? []) {
    pushComponent(components, {
      id: stableComponentId({
        pageId,
        type: "content-container",
        selector: entry.selector,
        bounds: entry.bounds,
        label: "Responsive container"
      }),
      type: "content-container",
      selector: entry.selector,
      label: "Responsive container",
      bounds: entry.bounds
    });
  }

  for (const media of snapshot.responsiveSignals?.mediaOverflowItems ?? []) {
    pushComponent(components, {
      id: stableComponentId({
        pageId,
        type: "media",
        selector: media.selector,
        bounds: media.bounds,
        label: "Media block"
      }),
      type: "media",
      selector: media.selector,
      label: "Media block",
      bounds: media.bounds
    });
  }

  for (const control of snapshot.formControlDescriptors ?? []) {
    if (!control?.selector || !control?.visible) {
      continue;
    }
    pushComponent(components, {
      id: stableComponentId({
        pageId,
        type: "form-section",
        selector: control.selector,
        bounds: control.bounds ?? null,
        label: selectBestLabel([control.label, control.placeholder, control.name, "Form control"])
      }),
      type: "form-section",
      selector: control.selector,
      label: selectBestLabel([control.label, control.placeholder, control.name, "Form control"]),
      bounds: control.bounds ?? null
    });
  }

  for (const overlay of snapshot.overlays ?? []) {
    pushComponent(components, {
      id: stableComponentId({
        pageId,
        type: "overlay",
        selector: overlay.selector,
        bounds: overlay.bounds,
        label: overlay.text
      }),
      type: "overlay",
      selector: overlay.selector,
      label: selectBestLabel([overlay.text, "Overlay"]),
      bounds: overlay.bounds
    });
  }

  return components.slice(0, maxComponents);
}

function componentScoreForIssue(component = {}, issue = {}) {
  if (!component) {
    return 0;
  }
  let score = 0;
  const issueSelector = normalizeSelector(issue.affectedSelector ?? "");
  if (issueSelector && issueSelector === normalizeSelector(component.selector)) {
    score += 10;
  } else if (issueSelector && normalizeSelector(component.selector).includes(issueSelector)) {
    score += 6;
  }

  const family = resolveUiuxIssueFamily(issue.issueType ?? "UNKNOWN");
  if (family === "NAV_VISIBILITY" && component.type === "primary-nav") {
    score += 5;
  }
  if (family === "CTA_PRESENTATION" && component.type === "primary-cta") {
    score += 5;
  }
  if (family === "RESPONSIVE_OVERFLOW" && ["content-container", "table", "chart", "media"].includes(component.type)) {
    score += 4;
  }
  if (family === "LAYOUT_COLLISION" && ["content-container", "form-section", "overlay"].includes(component.type)) {
    score += 4;
  }
  if (issue.issueType === "TABLE_CHART_MOBILE_USABILITY" && ["table", "chart"].includes(component.type)) {
    score += 8;
  }
  return score;
}

function assignIssueToComponent(issue = {}, components = []) {
  const ranked = components
    .map((component) => ({
      component,
      score: componentScoreForIssue(component, issue)
    }))
    .sort((left, right) => right.score - left.score);
  if (ranked[0]?.score > 0) {
    return ranked[0].component;
  }
  return components[0] ?? null;
}

function collapseWidthsToRanges(widths = [], gap = 40) {
  const sorted = sortNumbers(widths);
  if (!sorted.length) {
    return [];
  }
  const ranges = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const width = sorted[index];
    if (width - previous <= gap) {
      previous = width;
      continue;
    }
    ranges.push({ start, end: previous });
    start = width;
    previous = width;
  }
  ranges.push({ start, end: previous });
  return ranges;
}

function mergeIssueIntoGroup(group, issue, evaluation, component) {
  const viewportWidth = Math.round(Number(evaluation?.width ?? issue?.viewportWidth ?? 0));
  const viewportHeight = Math.round(Number(evaluation?.height ?? issue?.viewportHeight ?? 0));
  const key = viewportKey(viewportWidth, viewportHeight);
  group.issues.push(issue);
  group.widths.add(viewportWidth);
  group.heights.add(viewportHeight);
  if (!group.viewports.has(key)) {
    group.viewports.set(key, {
      width: viewportWidth,
      height: viewportHeight,
      viewportLabel: issue.viewportLabel ?? resolveViewportLabel(viewportWidth, viewportHeight),
      deviceLabel: issue.deviceLabel ?? resolveDeviceLabelForViewport(viewportWidth, viewportHeight),
      screenshotRef:
        issue.screenshotRef ??
        evaluation?.snapshot?.screenshotUrl ??
        evaluation?.snapshot?.screenshotPath ??
        null,
      pageUrl: issue.affectedUrl ?? evaluation?.snapshot?.url ?? null,
      canonicalUrl:
        evaluation?.snapshot?.canonicalUrl ??
        evaluation?.snapshot?.url ??
        null
    });
  }
  group.sourceIssueTypes.add(issue.issueType ?? "UNKNOWN");
  group.worstSeverity = group.worstSeverity ?? issue.severity ?? "P2";
  const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  if ((severityOrder[issue.severity ?? "P2"] ?? 9) < (severityOrder[group.worstSeverity] ?? 9)) {
    group.worstSeverity = issue.severity ?? "P2";
  }
  if (!group.component && component) {
    group.component = component;
  }
}

export async function runWithBoundedConcurrency(items = [], worker, maxConcurrency = 4) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.min(Number(maxConcurrency) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= list.length) {
        return;
      }
      results[current] = await worker(list[current], current);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

function buildWidthProbeSignature(issues = []) {
  return summarizeIssueSet(issues);
}

function summarizeFailuresByWidth(widthEvaluations = []) {
  return sortByViewport(widthEvaluations).map((entry) => {
    const failedChecks = [...new Set(
      entry.issues
        .filter((issue) => (issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL") === "FAIL")
        .map((issue) => issue.issueType)
    )].sort((left, right) => left.localeCompare(right));
    const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const worstSeverity = entry.issues.reduce((worst, issue) => {
      const next = issue.severity ?? "P2";
      if (!worst) {
        return next;
      }
      return (severityOrder[next] ?? 9) < (severityOrder[worst] ?? 9) ? next : worst;
    }, null);
    return {
      width: entry.width,
      height: entry.height,
      failedChecks,
      worstSeverity: worstSeverity ?? "P3",
      status: failedChecks.length ? "failed" : "passed",
      viewportLabel: resolveViewportLabel(entry.width, entry.height),
      deviceLabel: resolveDeviceLabelForViewport(entry.width, entry.height),
      screenshotRef: entry.snapshot?.screenshotUrl ?? entry.snapshot?.screenshotPath ?? null,
      pageUrl: entry.snapshot?.url ?? null,
      canonicalUrl: entry.snapshot?.canonicalUrl ?? entry.snapshot?.url ?? null
    };
  });
}

function buildBreakpointRangesForGroup(group, settings) {
  const ranges = collapseWidthsToRanges([...group.widths.values()], Math.max(settings.fineStep * 2, 24));
  return ranges.map((range) => ({
    minWidth: range.start,
    maxWidth: range.end,
    representativeWidths: pickRepresentativeWidthsForRange(
      { start: range.start, end: range.end },
      settings.representativeWidthsPerRange
    )
  }));
}

function buildHeightRangesForGroup(group, settings) {
  const ranges = collapseWidthsToRanges([...group.heights.values()], Math.max(settings.heightFineStep, 40));
  return ranges.map((range) => ({
    minHeight: range.start,
    maxHeight: range.end
  }));
}

function pickRepresentativeViewports(group, settings) {
  const entries = sortByViewport([...group.viewports.values()]);
  if (!entries.length) {
    return [];
  }
  const targetCount = Math.max(1, Math.min(
    entries.length,
    Math.max(settings.representativeWidthsPerRange * 2, 3)
  ));
  if (entries.length <= targetCount) {
    return entries;
  }
  const picked = new Map();
  const indices = [0, Math.floor((entries.length - 1) / 2), entries.length - 1];
  for (const index of indices) {
    const entry = entries[index];
    picked.set(viewportKey(entry.width, entry.height), entry);
  }
  let cursor = 1;
  while (picked.size < targetCount && cursor < entries.length - 1) {
    const proportionalIndex = Math.floor((cursor * (entries.length - 1)) / (targetCount - 1));
    const entry = entries[proportionalIndex];
    picked.set(viewportKey(entry.width, entry.height), entry);
    cursor += 1;
  }
  return sortByViewport([...picked.values()]).slice(0, targetCount);
}

function composeGroupedIssue(group, settings) {
  const sortedIssues = [...group.issues].sort((left, right) => {
    const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const leftRank = severityOrder[left.severity ?? "P2"] ?? 9;
    const rightRank = severityOrder[right.severity ?? "P2"] ?? 9;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const leftStep = Number(left.step ?? Number.MAX_SAFE_INTEGER);
    const rightStep = Number(right.step ?? Number.MAX_SAFE_INTEGER);
    return leftStep - rightStep;
  });
  const primaryIssue = sortedIssues[0] ?? {};
  const breakpointRanges = buildBreakpointRangesForGroup(group, settings);
  const heightRanges = buildHeightRangesForGroup(group, settings);
  const representativeViewports = pickRepresentativeViewports(group, settings);
  const representativeWidths = sortNumbers(representativeViewports.map((entry) => entry.width));
  const representativeHeights = sortNumbers(representativeViewports.map((entry) => entry.height));
  const representativeDevices = representativeViewports.map((entry) => ({
    width: entry.width,
    height: entry.height,
    viewportLabel: entry.viewportLabel,
    screenshotRef: entry.screenshotRef,
    label: entry.deviceLabel
  }));
  const fallbackRepresentativeWidths = sortNumbers(
    breakpointRanges.flatMap((range) => range.representativeWidths ?? [])
  );
  const normalizedRepresentativeWidths = representativeWidths.length
    ? representativeWidths
    : fallbackRepresentativeWidths;
  const normalizedRepresentativeDevices = representativeDevices.length
    ? representativeDevices
    : normalizedRepresentativeWidths.map((width) => ({
    width,
    height: representativeHeights[0] ?? null,
    viewportLabel: representativeHeights[0] ? resolveViewportLabel(width, representativeHeights[0]) : `w-${width}`,
    screenshotRef: null,
    label: resolveDeviceLabelForWidth(width)
  }));
  const primaryRange = breakpointRanges[0] ?? null;
  const primaryHeightRange = heightRanges[0] ?? null;
  const primaryViewport = representativeViewports[0] ?? null;
  const component = group.component ?? null;

  return {
    ...primaryIssue,
    issueType: primaryIssue.issueType ?? "UNKNOWN",
    severity: group.worstSeverity ?? primaryIssue.severity ?? "P2",
    sourceIssueTypes: [...group.sourceIssueTypes.values()].sort((left, right) =>
      String(left).localeCompare(String(right))
    ),
    canonicalIssueFamily: group.issueFamily,
    componentId: component?.id ?? null,
    componentType: component?.type ?? null,
    componentLabel: component?.label ?? null,
    affectedSelector: primaryIssue.affectedSelector ?? component?.selector ?? null,
    highlight: primaryIssue.highlight ?? (component?.bounds
      ? {
          selector: component.selector ?? null,
          label: component.label ?? null,
          box: component.bounds
        }
      : null),
    breakpointRange: primaryRange
      ? {
          minWidth: primaryRange.minWidth,
          maxWidth: primaryRange.maxWidth
        }
      : null,
    heightRange: primaryHeightRange
      ? {
          minHeight: primaryHeightRange.minHeight,
          maxHeight: primaryHeightRange.maxHeight
        }
      : null,
    breakpointRanges,
    heightRanges,
    representativeWidths: normalizedRepresentativeWidths,
    representativeHeights,
    representativeViewports: representativeViewports.map((entry) => ({
      width: entry.width,
      height: entry.height,
      viewportLabel: entry.viewportLabel,
      deviceLabel: entry.deviceLabel,
      screenshotRef: entry.screenshotRef
    })),
    representativeDevices: normalizedRepresentativeDevices,
    confirmedFailingViewport: primaryViewport
      ? {
          width: primaryViewport.width,
          height: primaryViewport.height,
          viewportLabel: primaryViewport.viewportLabel,
          deviceLabel: primaryViewport.deviceLabel,
          screenshotRef: primaryViewport.screenshotRef
        }
      : null,
    screenshotRef: primaryIssue.screenshotRef ?? primaryViewport?.screenshotRef ?? null,
    breakpointOccurrenceCount: sortedIssues.length,
    deviceLabel: primaryViewport?.deviceLabel ?? (primaryRange
      ? `${resolveDeviceLabelForWidth(primaryRange.minWidth)} -> ${resolveDeviceLabelForWidth(primaryRange.maxWidth)}`
      : resolveDeviceLabelForWidth(primaryIssue.viewportWidth ?? 0)),
    viewportLabel: primaryViewport?.viewportLabel ?? (primaryRange
      ? `bp-${primaryRange.minWidth}-${primaryRange.maxWidth}`
      : primaryIssue.viewportLabel ?? "default")
  };
}

async function captureSnapshotAtViewport({
  browserSession,
  width,
  height,
  runConfig,
  stepSeed,
  stage
}) {
  await browserSession.setViewportSize({
    width: Math.max(240, Math.round(width)),
    height: Math.max(320, Math.round(height))
  });
  await browserSession.waitForUIReady(
    runConfig.readiness.uiReadyStrategy,
    runConfig.readiness.readyTimeoutMs
  );
  return browserSession.capture(`${stepSeed}-${Math.round(width)}x${Math.round(height)}`, {
    artifactLabel: `uiux-bp-${stage}-${Math.round(width)}x${Math.round(height)}`,
    viewportLabel: resolveViewportLabel(width, height),
    deviceLabel: resolveDeviceLabelForViewport(width, height),
    deviceId: `viewport-${Math.round(width)}x${Math.round(height)}`,
    includeFocusProbe: true,
    includeUiuxSignals: true
  });
}

function pickInteractionSnapshot(evaluations = [], fallbackSnapshot = null) {
  const sorted = sortByViewport(
    evaluations
      .filter((entry) => entry?.snapshot)
      .map((entry) => ({
        width: entry.width,
        height: entry.height,
        snapshot: entry.snapshot,
        issueCount: entry.issues.length
      }))
  );
  if (!sorted.length) {
    return fallbackSnapshot;
  }
  const desktopCandidates = sorted.filter((entry) => entry.width >= 1024);
  const preferred = (desktopCandidates.length ? desktopCandidates : sorted)
    .sort((left, right) => {
      if (left.issueCount !== right.issueCount) {
        return left.issueCount - right.issueCount;
      }
      if (right.width !== left.width) {
        return right.width - left.width;
      }
      return right.height - left.height;
    })[0];
  return preferred?.snapshot ?? fallbackSnapshot;
}

export async function analyzeUiuxComponentBreakpoints({
  browserSession,
  uiuxRunner,
  runConfig,
  baseSnapshot,
  stage = "navigation",
  actionResult = null,
  actionContext = null,
  activeCheckIds = null,
  sessionStartAt = Date.now(),
  shouldStop = () => false,
  onProgress = null
}) {
  const emitProgress = (payload = {}) => {
    if (typeof onProgress !== "function") {
      return;
    }
    try {
      onProgress(payload);
    } catch {
      // Progress callbacks are best-effort and should never break analysis.
    }
  };
  const settings = resolveUiuxBreakpointSettings(runConfig);
  const baseWidth = clampInt(
    baseSnapshot?.viewportWidth,
    settings.minWidth,
    settings.maxWidth,
    Math.min(Math.max(settings.minWidth, 390), settings.maxWidth)
  );
  const baseHeight = clampInt(
    baseSnapshot?.viewportHeight,
    settings.minHeight,
    settings.maxHeight,
    Math.min(Math.max(settings.minHeight, 900), settings.maxHeight)
  );
  const coarseWidths = buildCoarseWidthSweep(settings);
  const coarseHeights = buildCoarseHeightSweep(settings, baseHeight);
  const snapshotsByViewport = new Map();

  function storeSnapshotForViewport(width, height, snapshot) {
    if (!snapshot) {
      return;
    }
    const normalizedWidth = Math.round(Number(width));
    const normalizedHeight = Math.round(Number(height));
    if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight)) {
      return;
    }
    snapshotsByViewport.set(viewportKey(normalizedWidth, normalizedHeight), {
      width: normalizedWidth,
      height: normalizedHeight,
      snapshot
    });
  }

  storeSnapshotForViewport(baseWidth, baseHeight, baseSnapshot);

  async function captureViewportIfMissing({ width, height }) {
    const normalizedWidth = clampInt(width, settings.minWidth, settings.maxWidth, baseWidth);
    const normalizedHeight = clampInt(height, settings.minHeight, settings.maxHeight, baseHeight);
    const key = viewportKey(normalizedWidth, normalizedHeight);
    if (snapshotsByViewport.has(key)) {
      return snapshotsByViewport.get(key)?.snapshot ?? null;
    }
    const snapshot = await captureSnapshotAtViewport({
      browserSession,
      width: normalizedWidth,
      height: normalizedHeight,
      runConfig,
      stepSeed: baseSnapshot?.step ?? "bp",
      stage
    });
    storeSnapshotForViewport(normalizedWidth, normalizedHeight, snapshot);
    return snapshot;
  }

  async function evaluateViewports(viewports = []) {
    const normalizedViewports = sortByViewport(viewports)
      .map((viewport) => ({
        width: clampInt(viewport?.width, settings.minWidth, settings.maxWidth, baseWidth),
        height: clampInt(viewport?.height, settings.minHeight, settings.maxHeight, baseHeight)
      }))
      .filter((viewport, index, list) => {
        const key = viewportKey(viewport.width, viewport.height);
        return list.findIndex((entry) => viewportKey(entry.width, entry.height) === key) === index;
      });
    const snapshottedViewports = normalizedViewports
      .map((viewport) => ({
        ...viewport,
        snapshot: snapshotsByViewport.get(viewportKey(viewport.width, viewport.height))?.snapshot ?? null
      }))
      .filter((viewport) => Boolean(viewport.snapshot));
    return runWithBoundedConcurrency(
      snapshottedViewports,
      async ({ width, height, snapshot }) => ({
        width,
        height,
        snapshot,
        issues: uiuxRunner.run({
          snapshot,
          stage,
          actionResult,
          actionContext,
          activeCheckIds
        })
      }),
      settings.maxConcurrentWorkers
    );
  }

  const coarseViewportGrid = buildViewportGrid({
    widths: [...coarseWidths, baseWidth],
    heights: [...coarseHeights, baseHeight],
    maxViewports: settings.maxViewportsPerPage
  });

  let coarseCaptured = 0;
  for (const viewport of coarseViewportGrid) {
    if (shouldStop()) {
      break;
    }
    const snapshot = await captureViewportIfMissing(viewport);
    coarseCaptured += 1;
    emitProgress({
      phase: "coarse-capture",
      captured: coarseCaptured,
      total: coarseViewportGrid.length,
      viewport: {
        width: viewport.width,
        height: viewport.height
      },
      snapshot
    });
  }

  emitProgress({
    phase: "coarse-evaluate",
    captured: coarseCaptured,
    total: coarseViewportGrid.length
  });
  const coarseEvaluations = await evaluateViewports(coarseViewportGrid);
  const widthTransitionEntries = aggregateAxisSignatures(coarseEvaluations, "width").map((entry) => ({
    width: entry.value,
    signature: entry.signature
  }));
  const heightTransitionEntries = aggregateAxisSignatures(coarseEvaluations, "height").map((entry) => ({
    height: entry.value,
    signature: entry.signature
  }));
  const refinedWidths = collectTransitionWidths(widthTransitionEntries, settings);
  const refinedHeights = collectTransitionHeights(heightTransitionEntries, settings);

  const allWidths = sortNumbers([...coarseWidths, ...refinedWidths, baseWidth]).slice(
    0,
    settings.maxWidthsPerPage
  );
  const allHeights = sortNumbers([...coarseHeights, ...refinedHeights, baseHeight]).slice(
    0,
    settings.maxHeightsPerPage
  );
  const refinedViewportGrid = buildViewportGrid({
    widths: allWidths,
    heights: allHeights,
    maxViewports: settings.maxViewportsPerPage
  });

  let refinedCaptured = 0;
  for (const viewport of refinedViewportGrid) {
    if (shouldStop()) {
      break;
    }
    const snapshot = await captureViewportIfMissing(viewport);
    refinedCaptured += 1;
    emitProgress({
      phase: "refined-capture",
      captured: refinedCaptured,
      total: refinedViewportGrid.length,
      viewport: {
        width: viewport.width,
        height: viewport.height
      },
      snapshot
    });
  }

  emitProgress({
    phase: "refined-evaluate",
    captured: refinedCaptured,
    total: refinedViewportGrid.length
  });
  const refinedEvaluations = await evaluateViewports(refinedViewportGrid);
  const failingRefinedEvaluations = refinedEvaluations.filter((entry) =>
    (entry.issues ?? []).some((issue) => {
      const verdict = issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL";
      return verdict === "FAIL";
    })
  );
  const nearbyViewports = buildNearbyViewportCandidates({
    failingEvaluations: failingRefinedEvaluations,
    existingViewportKeys: new Set([...snapshotsByViewport.keys()]),
    settings
  });
  let nearbyCaptured = 0;
  for (const viewport of nearbyViewports) {
    if (shouldStop()) {
      break;
    }
    const snapshot = await captureViewportIfMissing(viewport);
    nearbyCaptured += 1;
    emitProgress({
      phase: "nearby-capture",
      captured: nearbyCaptured,
      total: nearbyViewports.length,
      viewport: {
        width: viewport.width,
        height: viewport.height
      },
      snapshot
    });
  }
  emitProgress({
    phase: "nearby-evaluate",
    captured: nearbyCaptured,
    total: nearbyViewports.length
  });
  const nearbyEvaluations = nearbyViewports.length
    ? await evaluateViewports(nearbyViewports)
    : [];
  const evaluationMap = new Map();
  for (const evaluation of [...refinedEvaluations, ...nearbyEvaluations]) {
    evaluationMap.set(viewportKey(evaluation.width, evaluation.height), evaluation);
  }
  const allEvaluations = sortByViewport([...evaluationMap.values()]);

  const components = discoverUiuxComponents(baseSnapshot, {
    maxComponents: settings.maxComponentsPerPage
  });

  const groupMap = new Map();
  for (const evaluation of allEvaluations) {
    for (const issue of evaluation.issues) {
      const verdict = issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL";
      if (verdict !== "FAIL") {
        continue;
      }
      const normalizedIssue = {
        ...issue,
        viewportWidth: issue.viewportWidth ?? evaluation.width,
        viewportHeight: issue.viewportHeight ?? evaluation.height,
        viewportLabel: issue.viewportLabel ?? resolveViewportLabel(evaluation.width, evaluation.height),
        deviceLabel: issue.deviceLabel ?? resolveDeviceLabelForViewport(evaluation.width, evaluation.height),
        affectedUrl: issue.affectedUrl ?? evaluation.snapshot?.url ?? baseSnapshot?.url ?? null,
        screenshotRef:
          issue.screenshotRef ??
          evaluation.snapshot?.screenshotUrl ??
          evaluation.snapshot?.screenshotPath ??
          null
      };
      const component = assignIssueToComponent(normalizedIssue, components);
      const family = resolveUiuxIssueFamily(normalizedIssue.issueType ?? "UNKNOWN");
      const key = `${component?.id ?? "page-shell"}|${family}`;
      const group = groupMap.get(key) ?? {
        key,
        issueFamily: family,
        component,
        issues: [],
        widths: new Set(),
        heights: new Set(),
        viewports: new Map(),
        sourceIssueTypes: new Set(),
        worstSeverity: null
      };
      mergeIssueIntoGroup(group, normalizedIssue, evaluation, component);
      groupMap.set(key, group);
    }
  }

  const groupedIssues = [...groupMap.values()]
    .map((group) => composeGroupedIssue(group, settings))
    .sort((left, right) => {
      const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
      const severityDiff = (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      const leftRange = left.breakpointRange?.minWidth ?? Number.MAX_SAFE_INTEGER;
      const rightRange = right.breakpointRange?.minWidth ?? Number.MAX_SAFE_INTEGER;
      if (leftRange !== rightRange) {
        return leftRange - rightRange;
      }
      const leftHeight = left.heightRange?.minHeight ?? Number.MAX_SAFE_INTEGER;
      const rightHeight = right.heightRange?.minHeight ?? Number.MAX_SAFE_INTEGER;
      if (leftHeight !== rightHeight) {
        return leftHeight - rightHeight;
      }
      return String(left.issueType ?? "").localeCompare(String(right.issueType ?? ""));
    });

  const viewportFailures = summarizeFailuresByWidth(allEvaluations);
  const representativeViewportMap = new Map();
  for (const issue of groupedIssues) {
    for (const viewport of issue.representativeViewports ?? []) {
      representativeViewportMap.set(
        viewportKey(viewport.width, viewport.height),
        { width: viewport.width, height: viewport.height }
      );
    }
  }
  if (!representativeViewportMap.size && viewportFailures.length) {
    representativeViewportMap.set(
      viewportKey(viewportFailures[0].width, viewportFailures[0].height),
      { width: viewportFailures[0].width, height: viewportFailures[0].height }
    );
  }
  const representativeViewports = sortByViewport([...representativeViewportMap.values()]);
  const pageMatrixEntries = representativeViewports
    .map((viewport) =>
      viewportFailures.find(
        (entry) =>
          Number(entry.width) === Number(viewport.width) &&
          Number(entry.height) === Number(viewport.height)
      )
    )
    .filter(Boolean)
    .map((entry) => ({
      pageUrl: entry.pageUrl ?? baseSnapshot?.url ?? "",
      canonicalUrl: entry.canonicalUrl ?? entry.pageUrl ?? baseSnapshot?.url ?? "",
      viewportWidth: entry.width,
      viewportHeight: entry.height,
      viewportLabel: entry.viewportLabel,
      deviceLabel: entry.deviceLabel ?? resolveDeviceLabelForViewport(entry.width, entry.height),
      status: entry.status,
      failedChecks: entry.failedChecks,
      worstSeverity: entry.worstSeverity,
      screenshotRef: entry.screenshotRef
    }));

  const interactionSnapshot = pickInteractionSnapshot(allEvaluations, baseSnapshot);
  const sampledWidths = sortNumbers(allEvaluations.map((entry) => entry.width));
  const sampledHeights = sortNumbers(allEvaluations.map((entry) => entry.height));
  const safeRange = sampledWidths.length
    ? { minWidth: sampledWidths[0], maxWidth: sampledWidths[sampledWidths.length - 1] }
    : null;
  const safeHeightRange = sampledHeights.length
    ? { minHeight: sampledHeights[0], maxHeight: sampledHeights[sampledHeights.length - 1] }
    : null;
  const representativeWidths = sortNumbers(representativeViewports.map((entry) => entry.width));
  const representativeHeights = sortNumbers(representativeViewports.map((entry) => entry.height));

  emitProgress({
    phase: "done",
    groupedIssueCount: groupedIssues.length,
    sampledViewportCount: allEvaluations.length
  });
  return {
    settings,
    components,
    sampledWidths,
    sampledHeights,
    sampledViewports: allEvaluations.map((entry) => ({
      width: entry.width,
      height: entry.height
    })),
    groupedIssues,
    pageMatrixEntries,
    interactionSnapshot,
    issueCount: groupedIssues.length,
    hasFailures: groupedIssues.length > 0,
    breakpointSummary: {
      sampledWidthCount: sampledWidths.length,
      sampledWidths,
      sampledHeightCount: sampledHeights.length,
      sampledHeights,
      sampledViewportCount: allEvaluations.length,
      representativeViewports,
      representativeWidths,
      representativeHeights,
      componentCount: components.length,
      failingComponentCount: [...new Set(groupedIssues.map((issue) => issue.componentId).filter(Boolean))].length,
      groupedIssueCount: groupedIssues.length,
      safeRange,
      safeHeightRange,
      nearbyValidationCount: nearbyEvaluations.length,
      generatedAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Date.now() - Number(sessionStartAt || Date.now()))
    }
  };
}
