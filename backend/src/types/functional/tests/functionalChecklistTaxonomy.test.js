import assert from "node:assert/strict";
import test from "node:test";

import {
  FUNCTIONAL_CHECK_GROUPS,
  FUNCTIONAL_CHECK_IDS,
  FUNCTIONAL_EXPANSION_CHECK_IDS,
  FUNCTIONAL_PLANNED_CHECK_IDS,
  getFunctionalChecklistCategoryCounts
} from "../handbook/taxonomy.js";

test("functionality taxonomy exposes 18 checklist-expansion categories in stable order", () => {
  assert.equal(FUNCTIONAL_CHECK_GROUPS.length, 18);
  assert.deepEqual(
    FUNCTIONAL_CHECK_GROUPS.map((group) => group.title),
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
});

test("expansion taxonomy entries are present and explicitly marked planned", () => {
  assert.equal(FUNCTIONAL_EXPANSION_CHECK_IDS.length, 228);
  assert.equal(FUNCTIONAL_PLANNED_CHECK_IDS.length, 0);

  const expandedCheck = FUNCTIONAL_CHECK_GROUPS.flatMap((group) => group.checks).find(
    (check) => check.id === "SEARCH_DEBOUNCE_RESULT_CORRECTNESS"
  );
  assert.equal(expandedCheck?.implementationStatus, "implemented");
  assert.equal(expandedCheck?.source, "expansion");
});

test("legacy and expansion checks remain selectable in runtime catalog", () => {
  const implemented = FUNCTIONAL_CHECK_GROUPS.flatMap((group) => group.checks).find(
    (check) => check.id === "FORM_VALID_SUBMIT"
  );
  assert.equal(implemented?.implementationStatus, "implemented");
  assert.equal(implemented?.selectable, true);

  const legacySelectable = FUNCTIONAL_CHECK_GROUPS.flatMap((group) => group.checks).find(
    (check) => check.id === "INPUT_EMAIL_VALIDATION"
  );
  assert.equal(legacySelectable?.implementationStatus, "implemented");
  assert.equal(legacySelectable?.source, "legacy");
  assert.equal(legacySelectable?.selectable, true);

  const implementedSet = new Set(FUNCTIONAL_CHECK_IDS);
  assert.equal(implementedSet.has("FORM_VALID_SUBMIT"), true);
  assert.equal(implementedSet.has("INPUT_EMAIL_VALIDATION"), true);
});

test("category counts include implemented and planned functionality coverage", () => {
  const counts = getFunctionalChecklistCategoryCounts();
  assert.equal(counts.length, 18);
  assert.equal(counts.every((entry) => entry.total === entry.implemented + entry.planned), true);
  assert.equal(counts.reduce((sum, entry) => sum + entry.total, 0), 318);
  assert.equal(counts.every((entry) => entry.planned === 0), true);
});
