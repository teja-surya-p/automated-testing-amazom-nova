import { config } from "../../lib/config.js";
import { baselineUiuxChecks } from "./checks/index.js";
import {
  buildCoarseHeightSweep,
  buildCoarseWidthSweep,
  resolveUiuxBreakpointSettings
} from "./componentBreakpointAnalysis.js";

export const MIN_UIUX_TIME_BUDGET_MS = 10_000;
export const MAX_UIUX_TIME_BUDGET_MS = 7_200_000;
export const UIUX_ALL_SELECTION_SAFE_CAP = 250;

const QUICK_DEFAULT_UIUX_TIME_BUDGET_MS = clampInteger(
  config.uiuxQuickTimeBudgetMs,
  MIN_UIUX_TIME_BUDGET_MS,
  MAX_UIUX_TIME_BUDGET_MS,
  2_400_000
);
const FULL_DEFAULT_UIUX_TIME_BUDGET_MS = clampInteger(
  config.uiuxFullTimeBudgetMs,
  MIN_UIUX_TIME_BUDGET_MS,
  MAX_UIUX_TIME_BUDGET_MS,
  3_600_000
);
const FULL_ALL_DEFAULT_UIUX_TIME_BUDGET_MS = clampInteger(
  config.uiuxFullAllTimeBudgetMs,
  MIN_UIUX_TIME_BUDGET_MS,
  MAX_UIUX_TIME_BUDGET_MS,
  5_400_000
);
export const UIUX_ALL_SELECTION_MIN_TIME_BUDGET_MS = clampInteger(
  config.uiuxAllSelectionMinBudgetMs,
  MIN_UIUX_TIME_BUDGET_MS,
  MAX_UIUX_TIME_BUDGET_MS,
  FULL_DEFAULT_UIUX_TIME_BUDGET_MS
);

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return Math.min(Math.max(rounded, min), max);
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function hasRawContext(rawInput = {}) {
  return (
    rawInput &&
    typeof rawInput === "object" &&
    Object.keys(rawInput).length > 0
  );
}

function resolveUiuxDeviceMode(runConfig = {}, rawInput = {}) {
  const rawMode = rawInput?.uiux?.devices?.mode;
  const parsedMode = runConfig?.uiux?.devices?.mode;
  return rawMode === "full" || parsedMode === "full" ? "full" : "quick";
}

function resolveUiuxDeviceSelection(runConfig = {}, rawInput = {}) {
  const rawSelection = rawInput?.uiux?.devices?.selection;
  const parsedSelection = runConfig?.uiux?.devices?.selection;
  if (rawSelection === "all" || parsedSelection === "all") {
    return "all";
  }
  return "cap";
}

function resolveUiuxMaxDevices(runConfig = {}, rawInput = {}) {
  const rawMaxDevices = rawInput?.uiux?.devices?.maxDevices;
  const parsedMaxDevices = runConfig?.uiux?.devices?.maxDevices;
  const candidate = rawMaxDevices ?? parsedMaxDevices;
  if (candidate === null || candidate === undefined || candidate === "") {
    return null;
  }
  const parsed = Number(candidate);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
}

export function resolveUiuxModeAwareDefaultTimeBudgetMs({
  runConfig = {},
  rawInput = {}
} = {}) {
  const mode = resolveUiuxDeviceMode(runConfig, rawInput);
  const selection = resolveUiuxDeviceSelection(runConfig, rawInput);
  const maxDevices = resolveUiuxMaxDevices(runConfig, rawInput);
  if (mode === "full" && selection === "all" && maxDevices === 0) {
    return FULL_ALL_DEFAULT_UIUX_TIME_BUDGET_MS;
  }
  if (mode === "full") {
    return FULL_DEFAULT_UIUX_TIME_BUDGET_MS;
  }
  return QUICK_DEFAULT_UIUX_TIME_BUDGET_MS;
}

export function resolveUiuxTimeBudgetMs(runConfig = {}, rawInput = {}) {
  const rawUiuxBudgetProvided =
    hasOwn(rawInput, "uiux") &&
    rawInput.uiux &&
    hasOwn(rawInput.uiux, "timeBudgetMs");
  const rawBudgetProvided =
    hasOwn(rawInput, "budgets") &&
    rawInput.budgets &&
    hasOwn(rawInput.budgets, "timeBudgetMs");

  let candidate;
  if (rawUiuxBudgetProvided) {
    candidate = rawInput.uiux.timeBudgetMs;
  } else if (rawBudgetProvided) {
    candidate = rawInput.budgets.timeBudgetMs;
  } else if (!hasRawContext(rawInput)) {
    candidate = runConfig?.uiux?.timeBudgetMs ?? runConfig?.budgets?.timeBudgetMs;
  }

  if (candidate !== null && candidate !== undefined && candidate !== "") {
    return clampInteger(
      candidate,
      MIN_UIUX_TIME_BUDGET_MS,
      MAX_UIUX_TIME_BUDGET_MS,
      resolveUiuxModeAwareDefaultTimeBudgetMs({
        runConfig,
        rawInput
      })
    );
  }

  return resolveUiuxModeAwareDefaultTimeBudgetMs({
    runConfig,
    rawInput
  });
}

export function shouldCapUiuxAllDeviceSelection({
  runConfig = {},
  timeBudgetMs = 0
} = {}) {
  const mode = runConfig?.uiux?.devices?.mode === "full" ? "full" : "quick";
  const selection = runConfig?.uiux?.devices?.selection === "all" ? "all" : "cap";
  const maxDevices = Number(runConfig?.uiux?.devices?.maxDevices ?? 0);
  if (mode !== "full" || selection !== "all" || maxDevices !== 0) {
    return false;
  }
  return Number(timeBudgetMs) < UIUX_ALL_SELECTION_MIN_TIME_BUDGET_MS;
}

export function resolveUiuxAllDeviceCap({
  runConfig = {}
} = {}) {
  const mode = runConfig?.uiux?.devices?.mode === "full" ? "full" : "quick";
  if (mode !== "full") {
    return 3;
  }
  const parsedMax = Number(runConfig?.uiux?.devices?.maxDevices ?? UIUX_ALL_SELECTION_SAFE_CAP);
  if (!Number.isFinite(parsedMax) || parsedMax <= 0) {
    return UIUX_ALL_SELECTION_SAFE_CAP;
  }
  return Math.max(1, Math.floor(parsedMax));
}

export function buildUiuxEffectiveBudget({ runConfig = {}, rawInput = {} } = {}) {
  const timeBudgetMs = resolveUiuxTimeBudgetMs(runConfig, rawInput);
  const maxPagesCap = Math.max(50, Number(config.uiuxMaxPagesCap ?? 2000) || 2000);
  const maxPagesDefault = clampInteger(
    config.uiuxDefaultMaxPages,
    1,
    maxPagesCap,
    Math.min(120, maxPagesCap)
  );
  const maxPages = clampInteger(runConfig?.uiux?.maxPages, 1, maxPagesCap, maxPagesDefault);
  const maxInteractionsPerPage = clampInteger(runConfig?.uiux?.maxInteractionsPerPage, 0, 20, 6);
  const checkCount = Math.max(1, baselineUiuxChecks.length);
  const deviceMode = resolveUiuxDeviceMode(runConfig, rawInput);
  const deviceSelection = resolveUiuxDeviceSelection(runConfig, rawInput);
  const breakpointSettings = resolveUiuxBreakpointSettings(runConfig);
  const sampledWidths = buildCoarseWidthSweep(breakpointSettings);
  const sampledHeights = buildCoarseHeightSweep(
    breakpointSettings,
    runConfig?.uiux?.__runtimeContext?.viewportHeight ?? 900
  );

  return {
    mode: "uiux",
    strategy: "component-breakpoint",
    timeBudgetMs,
    maxPages,
    maxInteractionsPerPage,
    checkCount,
    deviceMode,
    deviceSelection,
    breakpointSettings,
    sampledWidthEstimate: sampledWidths.length,
    sampledHeightEstimate: sampledHeights.length,
    sampledViewportEstimate: sampledWidths.length * sampledHeights.length,
    representativeWidthCountPerRange: breakpointSettings.representativeWidthsPerRange
  };
}

export function resolveUiuxLaunchBudgetDefaults() {
  return {
    quick: QUICK_DEFAULT_UIUX_TIME_BUDGET_MS,
    full: FULL_DEFAULT_UIUX_TIME_BUDGET_MS,
    fullAll: FULL_ALL_DEFAULT_UIUX_TIME_BUDGET_MS
  };
}

export function resolveUiuxTimeBudgetForLaunch({
  deviceMode = "quick",
  selection = "cap"
} = {}) {
  const defaults = resolveUiuxLaunchBudgetDefaults();
  if (deviceMode === "full" && selection === "all") {
    return defaults.fullAll;
  }
  if (deviceMode === "full") {
    return defaults.full;
  }
  return defaults.quick;
}

export function resolveUiuxAllSelectionSafeCap() {
  return UIUX_ALL_SELECTION_SAFE_CAP;
}

export function resolveUiuxAllSelectionMinTimeBudgetMs() {
  return UIUX_ALL_SELECTION_MIN_TIME_BUDGET_MS;
}

export function resolveUiuxDefaultTimeBudgetMs() {
  return clampInteger(
    config.uiuxDefaultTimeBudgetMs,
    MIN_UIUX_TIME_BUDGET_MS,
    MAX_UIUX_TIME_BUDGET_MS,
    QUICK_DEFAULT_UIUX_TIME_BUDGET_MS
  );
}
