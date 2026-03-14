import {
  UIUX_CHECK_IDS as SHARED_UIUX_CHECK_IDS,
  UIUX_RECOMMENDED_CHECK_IDS as SHARED_RECOMMENDED_UIUX_CHECK_IDS,
  formatUiuxCheckTitle,
  getRecommendedUiuxChecks as getSharedRecommendedUiuxChecks,
  getUiuxCheckById,
  listUiuxCheckGroups as listSharedUiuxCheckGroups,
  normalizeUiuxCheckSelection as normalizeSharedUiuxCheckSelection
} from "../../../shared/uiuxChecklistCatalog.js";
import {
  FUNCTIONAL_CHECK_IDS as SHARED_FUNCTIONAL_CHECK_IDS,
  FUNCTIONAL_RECOMMENDED_CHECK_IDS as SHARED_RECOMMENDED_FUNCTIONAL_CHECK_IDS,
  formatFunctionalCheckTitle as formatSharedFunctionalCheckTitle,
  getFunctionalCheckById,
  getRecommendedFunctionalChecks as getSharedRecommendedFunctionalChecks,
  listFunctionalCheckGroups as listSharedFunctionalCheckGroups,
  normalizeFunctionalCheckSelection as normalizeSharedFunctionalCheckSelection
} from "../../../shared/functionalChecklistCatalog.js";

export const TEST_MODE_ORDER = Object.freeze([
  "default",
  "uiux",
  "functional",
  "accessibility",
  "performance",
  "security",
  "api",
  "dataReliability",
  "compatIntl",
  "compliance"
]);

export const SUPPORTED_TEST_MODES = Object.freeze(["default", "uiux", "functional", "performance"]);

export const UIUX_LAUNCH_BUDGET_DEFAULTS = Object.freeze({
  breakpointSweep: 1_200_000
});

export const UIUX_BREAKPOINT_DEFAULTS = Object.freeze({
  minWidth: 320,
  maxWidth: 1440,
  coarseStep: 40,
  fineStep: 12,
  refineTransitions: true,
  maxConcurrentWorkers: 4,
  representativeWidthsPerRange: 3
});

export const UIUX_CHECK_IDS = SHARED_UIUX_CHECK_IDS;
export const RECOMMENDED_UIUX_CHECK_IDS = SHARED_RECOMMENDED_UIUX_CHECK_IDS;
export const FUNCTIONAL_CHECK_IDS = SHARED_FUNCTIONAL_CHECK_IDS;
export const RECOMMENDED_FUNCTIONAL_CHECK_IDS = SHARED_RECOMMENDED_FUNCTIONAL_CHECK_IDS;

const MODE_METADATA = Object.freeze({
  default: Object.freeze({
    label: "Default",
    description: "Goal-driven end-to-end run",
    supported: true,
    icon: "rocket"
  }),
  uiux: Object.freeze({
    label: "UI/UX",
    description: "Visual and usability checks",
    supported: true,
    icon: "layout"
  }),
  functional: Object.freeze({
    label: "Functionality",
    description: "Behavior and flow correctness",
    supported: true,
    icon: "checklist"
  }),
  accessibility: Object.freeze({
    label: "Accessibility",
    description: "Roadmap mode",
    supported: false,
    icon: "accessibility"
  }),
  performance: Object.freeze({
    label: "Performance",
    description: "Core web-vitals and page-speed budgets",
    supported: true,
    icon: "gauge"
  }),
  security: Object.freeze({
    label: "Security",
    description: "Roadmap mode",
    supported: false,
    icon: "shield"
  }),
  api: Object.freeze({
    label: "API",
    description: "Roadmap mode",
    supported: false,
    icon: "server"
  }),
  dataReliability: Object.freeze({
    label: "Data Reliability",
    description: "Roadmap mode",
    supported: false,
    icon: "database"
  }),
  compatIntl: Object.freeze({
    label: "Compat Intl",
    description: "Roadmap mode",
    supported: false,
    icon: "globe"
  }),
  compliance: Object.freeze({
    label: "Compliance",
    description: "Roadmap mode",
    supported: false,
    icon: "badge"
  })
});

const SUPPORTED_MODE_SET = new Set(SUPPORTED_TEST_MODES);
const UIUX_CHECK_SET = new Set(UIUX_CHECK_IDS);
const FUNCTIONAL_CHECK_SET = new Set(FUNCTIONAL_CHECK_IDS);

export function listModeCards() {
  return TEST_MODE_ORDER.map((mode) => {
    const metadata = MODE_METADATA[mode] ?? {
      label: mode,
      description: "Roadmap mode",
      supported: false,
      icon: "badge"
    };
    return {
      mode,
      label: metadata.label,
      description: metadata.description,
      supported: metadata.supported,
      icon: metadata.icon
    };
  });
}

export function formatModeLabel(mode = "") {
  return MODE_METADATA[mode]?.label ?? String(mode || "Unknown");
}

export function isSupportedMode(mode = "") {
  return SUPPORTED_MODE_SET.has(mode);
}

export function isGoalRequired(mode = "") {
  return mode === "default";
}

export function requiresStepTwo(mode = "") {
  return mode === "uiux" || mode === "functional";
}

export function getStepOneAction(mode = "") {
  if (!isSupportedMode(mode)) {
    return {
      type: "unavailable",
      label: "Unavailable",
      disabled: true
    };
  }

  if (mode === "default") {
    return {
      type: "launch",
      label: "Launch",
      disabled: false
    };
  }
  if (requiresStepTwo(mode)) {
    return {
      type: "next",
      label: "Next",
      disabled: false
    };
  }

  if (mode === "performance") {
    return {
      type: "launch",
      label: "Launch",
      disabled: false
    };
  }

  return {
    type: "launch",
    label: "Launch",
    disabled: false
  };
}

export function formatUiuxCheckLabel(checkId = "") {
  return getUiuxCheckById(checkId)?.title ?? formatUiuxCheckTitle(checkId);
}

export function formatFunctionalCheckLabel(checkId = "") {
  return getFunctionalCheckById(checkId)?.title ?? formatSharedFunctionalCheckTitle(checkId);
}

export function isAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseLineList(value = "") {
  return String(value)
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeUiuxBreakpointSettings(settings = {}) {
  const minWidth = Math.max(240, Number(settings.minWidth ?? UIUX_BREAKPOINT_DEFAULTS.minWidth) || UIUX_BREAKPOINT_DEFAULTS.minWidth);
  const maxWidthRaw = Number(settings.maxWidth ?? UIUX_BREAKPOINT_DEFAULTS.maxWidth) || UIUX_BREAKPOINT_DEFAULTS.maxWidth;
  const maxWidth = Math.max(minWidth + 32, maxWidthRaw);
  const coarseStep = Math.max(8, Number(settings.coarseStep ?? UIUX_BREAKPOINT_DEFAULTS.coarseStep) || UIUX_BREAKPOINT_DEFAULTS.coarseStep);
  const fineStepRaw = Math.max(4, Number(settings.fineStep ?? UIUX_BREAKPOINT_DEFAULTS.fineStep) || UIUX_BREAKPOINT_DEFAULTS.fineStep);
  const fineStep = Math.min(coarseStep, fineStepRaw);
  return {
    enabled: settings.enabled !== false,
    minWidth,
    maxWidth,
    coarseStep,
    fineStep,
    refineTransitions: settings.refineTransitions !== false,
    maxConcurrentWorkers: Math.min(Math.max(Number(settings.maxConcurrentWorkers ?? UIUX_BREAKPOINT_DEFAULTS.maxConcurrentWorkers) || UIUX_BREAKPOINT_DEFAULTS.maxConcurrentWorkers, 1), 8),
    representativeWidthsPerRange: Math.min(
      Math.max(
        Number(settings.representativeWidthsPerRange ?? UIUX_BREAKPOINT_DEFAULTS.representativeWidthsPerRange) ||
          UIUX_BREAKPOINT_DEFAULTS.representativeWidthsPerRange,
        1
      ),
      5
    )
  };
}

export function resolveUiuxLaunchTimeBudgetMs() {
  return UIUX_LAUNCH_BUDGET_DEFAULTS.breakpointSweep;
}

export function normalizeUiuxCheckSelection(selectedChecks = []) {
  return normalizeSharedUiuxCheckSelection(selectedChecks);
}

export function getRecommendedUiuxChecks() {
  return getSharedRecommendedUiuxChecks().filter((checkId) => UIUX_CHECK_SET.has(checkId));
}

export function getAllUiuxChecks() {
  return [...UIUX_CHECK_IDS];
}

export function listUiuxCheckGroups({ includePlanned = true } = {}) {
  return listSharedUiuxCheckGroups({ includePlanned }).map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    checks: group.checks.map((check) => ({
      id: check.id,
      label: check.title,
      implementationStatus: check.implementationStatus,
      selectable: check.selectable,
      recommended: check.recommended,
      firstWavePriority: check.firstWavePriority,
      plannedReason: check.plannedReason,
      source: check.source
    }))
  }));
}

export function normalizeFunctionalCheckSelection(selectedChecks = []) {
  return normalizeSharedFunctionalCheckSelection(selectedChecks);
}

export function getRecommendedFunctionalChecks() {
  return getSharedRecommendedFunctionalChecks().filter((checkId) => FUNCTIONAL_CHECK_SET.has(checkId));
}

export function getAllFunctionalChecks() {
  return [...FUNCTIONAL_CHECK_IDS];
}

export function listFunctionalCheckGroups({ includePlanned = true } = {}) {
  return listSharedFunctionalCheckGroups({ includePlanned }).map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    checks: group.checks.map((check) => ({
      id: check.id,
      label: check.title,
      implementationStatus: check.implementationStatus,
      selectable: check.selectable,
      recommended: check.recommended,
      plannedReason: check.plannedReason,
      source: check.source
    }))
  }));
}

export function collectStepOneClientIssues({ startUrl = "", goal = "", testMode = "default" } = {}) {
  const issues = [];
  if (!isAbsoluteHttpUrl(startUrl)) {
    issues.push({
      path: ["runConfig", "startUrl"],
      message: "Target URL must be an absolute http(s) URL.",
      code: "invalid_string"
    });
  }
  if (isGoalRequired(testMode) && !String(goal).trim()) {
    issues.push({
      path: ["runConfig", "goal"],
      message: "Goal is required when mode is default.",
      code: "too_small"
    });
  }
  if (!isSupportedMode(testMode)) {
    issues.push({
      path: ["runConfig", "testMode"],
      message: `Mode "${testMode}" is currently unavailable from dashboard launch.`,
      code: "custom"
    });
  }
  return issues;
}

export function collectUiuxStepClientIssues({
  selectedChecks = []
} = {}) {
  const issues = [];
  if (normalizeUiuxCheckSelection(selectedChecks).length === 0) {
    issues.push({
      path: ["runConfig", "uiux", "checkIds"],
      message: "Select at least one UI/UX check before launch.",
      code: "too_small"
    });
  }
  return issues;
}

export function collectFunctionalStepClientIssues({ profileTag = "", selectedChecks = [] } = {}) {
  const issues = [];
  if (normalizeFunctionalCheckSelection(selectedChecks).length === 0) {
    issues.push({
      path: ["runConfig", "functional", "checkIds"],
      message: "Select at least one functionality check before launch.",
      code: "too_small"
    });
  }
  if (String(profileTag).trim()) {
    return issues;
  }
  issues.push({
      path: ["runConfig", "profileTag"],
      message: "Functional mode requires a profile tag.",
      code: "custom"
    });
  return issues;
}

export function buildLaunchRunConfig({
  startUrl = "",
  goal = "",
  testMode = "default",
  profileTag = "functional-local",
  uiuxBreakpointSettings = undefined,
  selectedUiuxChecks = [],
  selectedFunctionalChecks = [],
  // Legacy args kept for compatibility with stale callers.
  uiuxDeviceMode = "quick",
  uiuxSelection = "cap",
  uiuxMaxDevices = "250",
  uiuxMaxPages = "120",
  uiuxAllowlist = "",
  uiuxBlocklist = "",
  uiuxViewports = undefined
} = {}) {
  const trimmedGoal = String(goal).trim();
  const normalizedTestMode = String(testMode || "").trim() || "default";
  const runConfig = {
    startUrl: String(startUrl).trim(),
    testMode: normalizedTestMode,
    ...(trimmedGoal ? { goal: trimmedGoal } : {})
  };

  if (normalizedTestMode === "functional") {
    runConfig.profileTag = String(profileTag).trim();
    runConfig.functional = {
      ...(runConfig.functional ?? {}),
      checkIds: normalizeFunctionalCheckSelection(selectedFunctionalChecks)
    };
  }

  if (normalizedTestMode === "uiux") {
    const uiuxTimeBudgetMs = resolveUiuxLaunchTimeBudgetMs();
    runConfig.budgets = {
      ...(runConfig.budgets ?? {}),
      timeBudgetMs: uiuxTimeBudgetMs
    };
    const normalizedUiuxChecks = normalizeUiuxCheckSelection(selectedUiuxChecks);
    runConfig.uiux = {
      timeBudgetMs: uiuxTimeBudgetMs,
      checkIds: normalizedUiuxChecks
    };

    // Backward-compatible handling for stale callers that still send explicit responsive internals.
    if (uiuxBreakpointSettings && typeof uiuxBreakpointSettings === "object") {
      runConfig.uiux.breakpoints = normalizeUiuxBreakpointSettings(uiuxBreakpointSettings);
    }
    if (Array.isArray(uiuxViewports) && uiuxViewports.length > 0) {
      runConfig.uiux.viewports = uiuxViewports;
    }
    const legacyAllowlist = parseLineList(uiuxAllowlist);
    const legacyBlocklist = parseLineList(uiuxBlocklist);
    const parsedLegacyMaxPages = Number(uiuxMaxPages);
    const parsedLegacyMaxDevices = Number(uiuxMaxDevices);
    const hasLegacyDeviceInput =
      uiuxDeviceMode !== "quick" ||
      uiuxSelection !== "cap" ||
      legacyAllowlist.length > 0 ||
      legacyBlocklist.length > 0 ||
      (Number.isFinite(parsedLegacyMaxDevices) && parsedLegacyMaxDevices !== 250);
    if (hasLegacyDeviceInput) {
      runConfig.uiux.devices = {
        mode: String(uiuxDeviceMode || "quick"),
        selection: String(uiuxSelection || "cap"),
        maxDevices: Number.isFinite(parsedLegacyMaxDevices) ? parsedLegacyMaxDevices : 3,
        allowlist: legacyAllowlist,
        blocklist: legacyBlocklist
      };
    }
    if (Number.isFinite(parsedLegacyMaxPages) && parsedLegacyMaxPages !== 120) {
      runConfig.uiux.maxPages = Math.max(1, parsedLegacyMaxPages);
    }
  }

  return runConfig;
}
