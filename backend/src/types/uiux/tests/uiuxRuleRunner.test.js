import test from "node:test";
import assert from "node:assert/strict";

import { UiuxRuleRunner } from "../runner/ruleRunner.js";
import { defineUiuxTestCase } from "../testcases/model.js";

test("uiux rule runner attaches testcase metadata and explanation payload", () => {
  const runner = new UiuxRuleRunner([
    defineUiuxTestCase({
      id: "CUSTOM_UI_CHECK",
      title: "Custom UI check",
      category: "visual-layout",
      severity: "P2",
      judgmentPolicy: "hard-fail",
      pageScope: "element",
      deviceScope: "single-viewport",
      explanationTemplate: {
        whatHappened: "Something objective happened.",
        whyItFailed: "A deterministic rule condition was violated.",
        whyItMatters: "It harms usability.",
        recommendedFix: ["Apply deterministic fix."]
      },
      detector: () => ({
        issueType: "CUSTOM_UI_CHECK",
        severity: "P2",
        title: "Custom issue",
        expected: "Expected behavior",
        actual: "Actual behavior",
        confidence: 0.8,
        evidenceRefs: []
      })
    })
  ]);

  const issues = runner.runAll({
    snapshot: {
      url: "https://example.com"
    }
  });

  assert.equal(issues.length, 1);
  const [issue] = issues;
  assert.equal(issue.testcaseId, "CUSTOM_UI_CHECK");
  assert.equal(issue.testcaseCategory, "visual-layout");
  assert.equal(issue.testcaseScope.pageScope, "element");
  assert.equal(issue.testcaseScope.deviceScope, "single-viewport");
  assert.deepEqual(issue.explanation, {
    whatHappened: "Something objective happened.",
    whyItFailed: "Actual behavior",
    whyItMatters: "It harms usability.",
    recommendedFix: ["Apply deterministic fix."]
  });
  assert.equal(issue.judgmentPolicy, "hard-fail");
  assert.equal(issue.rawDetectorResult?.verdict, "FAIL");
  assert.equal(issue.calibratedJudgment?.verdict, "FAIL");
  assert.equal(issue.isDefect, true);
});
