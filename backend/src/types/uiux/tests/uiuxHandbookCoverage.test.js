import test from "node:test";
import assert from "node:assert/strict";

import { buildUiuxHandbookCoverage } from "../handbook/coverage.js";
import { uiuxHandbookChecks } from "../handbook/checklist.js";

test("UI/UX handbook checklist includes all UI-001..UI-085 checks", () => {
  assert.equal(uiuxHandbookChecks.length, 85);
  const ids = uiuxHandbookChecks.map((entry) => entry.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 85);
  assert.equal(ids[0], "UI-001");
  assert.equal(ids[84], "UI-085");
});

test("handbook coverage marks checks as NOT_RUN when uiux mode is disabled", () => {
  const coverage = buildUiuxHandbookCoverage({
    issues: [],
    enabled: false
  });

  assert.equal(coverage.summary.total, 85);
  assert.equal(coverage.summary.notRun, 85);
  assert.equal(coverage.summary.fail, 0);
  assert.equal(coverage.checks.every((entry) => entry.status === "NOT_RUN"), true);
});

test("handbook coverage maps detector failures to the relevant checklist IDs", () => {
  const coverage = buildUiuxHandbookCoverage({
    enabled: true,
    issues: [
      {
        issueType: "TOUCH_TARGET_TOO_SMALL",
        severity: "P1",
        confidence: 0.9,
        calibratedJudgment: { verdict: "FAIL" },
        affectedUrl: "https://example.com/mobile",
        viewportLabel: "mobile",
        deviceLabel: "mobile",
        evidenceRefs: [{ type: "screenshot", ref: "/artifacts/mobile.png" }]
      }
    ]
  });

  const touchTargetCheck = coverage.checks.find((entry) => entry.id === "UI-039");
  assert.equal(touchTargetCheck?.status, "FAIL");
  assert.equal(touchTargetCheck?.matchedIssueCount, 1);

  assert.equal(coverage.summary.fail >= 1, true);
});
