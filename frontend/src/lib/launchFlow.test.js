import assert from "node:assert/strict";
import test from "node:test";
import {
  FUNCTIONAL_CHECK_IDS,
  RECOMMENDED_FUNCTIONAL_CHECK_IDS,
  RECOMMENDED_UIUX_CHECK_IDS,
  UIUX_CHECK_IDS,
  buildLaunchRunConfig,
  collectFunctionalStepClientIssues,
  collectStepOneClientIssues,
  collectUiuxStepClientIssues,
  getAllFunctionalChecks,
  getAllUiuxChecks,
  getRecommendedFunctionalChecks,
  getRecommendedUiuxChecks,
  getStepOneAction,
  isGoalRequired,
  listFunctionalCheckGroups,
  listUiuxCheckGroups,
  normalizeUiuxCheckSelection
} from "./launchFlow.js";

test("step one primary action labels match supported mode flow", () => {
  assert.equal(getStepOneAction("default").label, "Launch");
  assert.equal(getStepOneAction("uiux").label, "Next");
  assert.equal(getStepOneAction("functional").label, "Next");
  assert.equal(getStepOneAction("performance").label, "Launch");
});

test("unsupported modes stay unavailable from step one", () => {
  const action = getStepOneAction("security");
  assert.equal(action.disabled, true);
  assert.equal(action.type, "unavailable");
});

test("goal is required only for default mode", () => {
  assert.equal(isGoalRequired("default"), true);
  assert.equal(isGoalRequired("uiux"), false);
  assert.equal(isGoalRequired("functional"), false);
  assert.equal(isGoalRequired("performance"), false);

  const defaultIssues = collectStepOneClientIssues({
    startUrl: "https://example.com",
    goal: "",
    testMode: "default"
  });
  assert.equal(defaultIssues.some((issue) => issue.path?.join(".") === "runConfig.goal"), true);

  const uiuxIssues = collectStepOneClientIssues({
    startUrl: "https://example.com",
    goal: "",
    testMode: "uiux"
  });
  assert.equal(uiuxIssues.some((issue) => issue.path?.join(".") === "runConfig.goal"), false);

  const performanceIssues = collectStepOneClientIssues({
    startUrl: "https://example.com",
    goal: "",
    testMode: "performance"
  });
  assert.equal(performanceIssues.some((issue) => issue.path?.join(".") === "runConfig.goal"), false);
  assert.equal(performanceIssues.some((issue) => issue.path?.join(".") === "runConfig.testMode"), false);
});

test("uiux check sources expose full checklist and deterministic recommended subset", () => {
  const allChecks = getAllUiuxChecks();
  const recommended = getRecommendedUiuxChecks();

  assert.deepEqual(allChecks, UIUX_CHECK_IDS);
  assert.deepEqual(recommended, RECOMMENDED_UIUX_CHECK_IDS);
  assert.equal(recommended.every((checkId) => allChecks.includes(checkId)), true);
});

test("uiux grouped checklist includes document-aligned categories and runtime-selectable expansion checks", () => {
  const groups = listUiuxCheckGroups();
  assert.equal(groups.length, 12);
  assert.deepEqual(
    groups.map((group) => group.title),
    [
      "Layout, spacing, and structure",
      "Responsive and mobile-specific behavior",
      "Navigation clarity and wayfinding",
      "Buttons, controls, and interaction affordance",
      "Form UX and data entry",
      "Search, filter, sort, and dense data",
      "Tables, charts, and data visualization",
      "States, system feedback, and recovery",
      "Content clarity, hierarchy, and readability",
      "Modals, drawers, sheets, and overlays",
      "Commerce and critical conversion flows",
      "Accessibility-adjacent UX checks"
    ]
  );

  const implemented = groups
    .flatMap((group) => group.checks)
    .find((check) => check.id === "OVERLAY_BLOCKING");
  assert.equal(implemented?.implementationStatus, "implemented");
  assert.equal(implemented?.selectable, true);

  const expanded = groups
    .flatMap((group) => group.checks)
    .find((check) => check.id === "TABLE_SCROLL_ONLY_NO_MOBILE_RESTRUCTURE");
  assert.equal(expanded?.implementationStatus, "implemented");
  assert.equal(expanded?.selectable, true);
});

test("check labels are human-readable and not raw underscore ids", () => {
  const uiuxCheck = listUiuxCheckGroups()
    .flatMap((group) => group.checks)
    .find((entry) => entry.id === "HORIZONTAL_SCROLL");
  assert.equal(uiuxCheck?.label, "Horizontal Scroll");
  assert.equal(uiuxCheck?.label.includes("_"), false);

  const functionalCheck = listFunctionalCheckGroups()
    .flatMap((group) => group.checks)
    .find((entry) => entry.id === "INPUT_EMAIL_VALIDATION");
  assert.equal(functionalCheck?.label, "Input Email Validation");
  assert.equal(functionalCheck?.label.includes("_"), false);
});

test("uiux check normalization includes expansion checklist ids", () => {
  assert.deepEqual(
    normalizeUiuxCheckSelection(["TABLE_SCROLL_ONLY_NO_MOBILE_RESTRUCTURE", "BROKEN_LINK"]),
    ["BROKEN_LINK", "TABLE_SCROLL_ONLY_NO_MOBILE_RESTRUCTURE"]
  );
});

test("functionality check sources expose full checklist and deterministic recommended subset", () => {
  const allChecks = getAllFunctionalChecks();
  const recommended = getRecommendedFunctionalChecks();

  assert.deepEqual(allChecks, FUNCTIONAL_CHECK_IDS);
  assert.deepEqual(recommended, RECOMMENDED_FUNCTIONAL_CHECK_IDS);
  assert.equal(recommended.every((checkId) => allChecks.includes(checkId)), true);
});

test("functionality grouped checklist includes document-aligned categories and runtime-selectable expansion checks", () => {
  const groups = listFunctionalCheckGroups();
  assert.equal(groups.length, 18);
  assert.deepEqual(
    groups.map((group) => group.title),
    [
      "Authentication, session, and account flow",
      "Signup, onboarding, and account creation",
      "Form submission, validation, and data processing",
      "CRUD and data lifecycle",
      "Search, filter, sort, and pagination",
      "Tables, lists, dashboards, and data views",
      "File upload, export, import, and download",
      "External integrations and third-party flows",
      "Roles, permissions, tenant, and workspace behavior",
      "Workflow, process, and state machine behavior",
      "Notifications, messaging, and asynchronous behavior",
      "Error handling, recovery, and resilience",
      "Localization, formatting, and regional logic",
      "Browser, device, and platform behavior",
      "Commerce, booking, and transaction flows",
      "Admin, configuration, and settings",
      "Blocked and unverifiable handling",
      "Evidence, bug reporting, and quality of failure capture"
    ]
  );

  const implemented = groups
    .flatMap((group) => group.checks)
    .find((check) => check.id === "FORM_VALID_SUBMIT");
  assert.equal(implemented?.implementationStatus, "implemented");
  assert.equal(implemented?.selectable, true);

  const expansionCheck = groups
    .flatMap((group) => group.checks)
    .find((check) => check.id === "SERVER_VALIDATION_MATCHES_CLIENT_VALIDATION");
  assert.equal(expansionCheck?.implementationStatus, "implemented");
  assert.equal(expansionCheck?.selectable, true);

  const legacyCheck = groups
    .flatMap((group) => group.checks)
    .find((check) => check.id === "INPUT_EMAIL_VALIDATION");
  assert.equal(legacyCheck?.implementationStatus, "implemented");
  assert.equal(legacyCheck?.source, "legacy");
});

test("functionality launch payload supports check-all sized selections above 300", () => {
  const runConfig = buildLaunchRunConfig({
    startUrl: "https://example.com",
    testMode: "functional",
    profileTag: "functional-local",
    selectedFunctionalChecks: [...FUNCTIONAL_CHECK_IDS]
  });

  assert.equal(Array.isArray(runConfig.functional?.checkIds), true);
  assert.equal(runConfig.functional.checkIds.length, FUNCTIONAL_CHECK_IDS.length);
  assert.equal(runConfig.functional.checkIds.length > 300, true);
});

test("uiux launch validation requires at least one selected check", () => {
  const noCheckIssues = collectUiuxStepClientIssues({
    selectedChecks: []
  });
  assert.equal(noCheckIssues.some((issue) => issue.path?.join(".") === "runConfig.uiux.checkIds"), true);

  const withCheckIssues = collectUiuxStepClientIssues({
    selectedChecks: ["BROKEN_LINK"]
  });
  assert.equal(withCheckIssues.some((issue) => issue.path?.join(".") === "runConfig.uiux.checkIds"), false);
});

test("uiux launch payload omits responsive tuning knobs for dashboard flow", () => {
  const runConfig = buildLaunchRunConfig({
    startUrl: "https://example.com",
    testMode: "uiux",
    selectedUiuxChecks: ["BROKEN_LINK", "NOT_A_REAL_CHECK", "STUCK_LOADING"]
  });

  assert.deepEqual(runConfig.uiux?.checkIds, ["STUCK_LOADING", "BROKEN_LINK"]);
  assert.equal(runConfig.uiux?.checkIds.includes("NOT_A_REAL_CHECK"), false);
  assert.equal(runConfig.uiux?.breakpoints, undefined);
  assert.equal(runConfig.uiux?.devices, undefined);
  assert.equal(runConfig.uiux?.maxPages, undefined);
});

test("uiux launch payload keeps backward-compatible breakpoint support for stale callers", () => {
  const runConfig = buildLaunchRunConfig({
    startUrl: "https://example.com",
    testMode: "uiux",
    uiuxBreakpointSettings: {
      minWidth: 360,
      maxWidth: 1200,
      coarseStep: 32,
      fineStep: 8,
      maxConcurrentWorkers: 5,
      representativeWidthsPerRange: 3
    },
    selectedUiuxChecks: ["BROKEN_LINK"]
  });

  assert.equal(runConfig.uiux?.breakpoints?.minWidth, 360);
  assert.equal(runConfig.uiux?.breakpoints?.coarseStep, 32);
});

test("functionality step validation requires profile tag and at least one selected check", () => {
  const issues = collectFunctionalStepClientIssues({
    profileTag: "",
    selectedChecks: []
  });

  assert.equal(issues.some((issue) => issue.path?.join(".") === "runConfig.profileTag"), true);
  assert.equal(issues.some((issue) => issue.path?.join(".") === "runConfig.functional.checkIds"), true);

  const validIssues = collectFunctionalStepClientIssues({
    profileTag: "functional-local",
    selectedChecks: ["FORM_VALID_SUBMIT"]
  });
  assert.equal(validIssues.length, 0);
});

test("functionality launch payload carries only selected checks", () => {
  const runConfig = buildLaunchRunConfig({
    startUrl: "https://example.com",
    testMode: "functional",
    profileTag: "functional-local",
    selectedFunctionalChecks: ["FORM_VALID_SUBMIT", "NOT_REAL_CHECK", "LOGIN_VISIBLE_VALIDATION_ONLY"]
  });

  assert.equal(runConfig.profileTag, "functional-local");
  assert.deepEqual(new Set(runConfig.functional?.checkIds ?? []), new Set(["FORM_VALID_SUBMIT", "LOGIN_VISIBLE_VALIDATION_ONLY"]));
  assert.equal(runConfig.functional?.checkIds.includes("NOT_REAL_CHECK"), false);
});

test("default launch payload keeps compatibility shape", () => {
  const runConfig = buildLaunchRunConfig({
    startUrl: "https://example.com",
    testMode: "default",
    goal: "Verify checkout confirmation"
  });

  assert.deepEqual(runConfig, {
    startUrl: "https://example.com",
    testMode: "default",
    goal: "Verify checkout confirmation"
  });
});

test("performance launch payload keeps compact compatibility shape", () => {
  const runConfig = buildLaunchRunConfig({
    startUrl: "https://example.com",
    testMode: "performance",
    goal: "Validate baseline page performance budgets"
  });

  assert.deepEqual(runConfig, {
    startUrl: "https://example.com",
    testMode: "performance",
    goal: "Validate baseline page performance budgets"
  });
});
