import assert from "node:assert/strict";
import test from "node:test";

import { baselineUiuxChecks } from "../checks/index.js";
import {
  UIUX_CHECK_GROUPS,
  UIUX_CHECK_IDS,
  UIUX_EXPANSION_CHECK_IDS,
  UIUX_PLANNED_CHECK_IDS,
  getUiuxChecklistCategoryCounts
} from "../handbook/taxonomy.js";

test("uiux taxonomy exposes 12 checklist-expansion categories in stable order", () => {
  assert.equal(UIUX_CHECK_GROUPS.length, 12);
  assert.deepEqual(
    UIUX_CHECK_GROUPS.map((group) => group.title),
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
});

test("implemented uiux checklist ids stay aligned with runtime baseline detectors", () => {
  const runtimeIds = baselineUiuxChecks.map((check) => check.id);
  assert.deepEqual(UIUX_CHECK_IDS, runtimeIds);
});

test("expansion taxonomy entries are present and explicitly marked planned", () => {
  assert.equal(UIUX_EXPANSION_CHECK_IDS.length, 152);
  assert.equal(UIUX_PLANNED_CHECK_IDS.length, 0);

  const firstWave = UIUX_CHECK_GROUPS.flatMap((group) => group.checks).find(
    (check) => check.id === "TABLE_SCROLL_ONLY_NO_MOBILE_RESTRUCTURE"
  );
  assert.equal(firstWave?.implementationStatus, "implemented");
  assert.equal(firstWave?.firstWavePriority, true);
});

test("category counts include both implemented and planned checklist coverage", () => {
  const counts = getUiuxChecklistCategoryCounts();
  assert.equal(counts.length, 12);
  assert.equal(counts.every((entry) => entry.total === entry.implemented + entry.planned), true);
  assert.equal(counts.reduce((sum, entry) => sum + entry.total, 0), 203);
  assert.equal(counts.every((entry) => entry.planned === 0), true);
});
