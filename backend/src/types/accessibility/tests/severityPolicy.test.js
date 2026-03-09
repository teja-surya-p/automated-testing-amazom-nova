import test from "node:test";
import assert from "node:assert/strict";

import {
  calibrateAccessibilityClusters,
  calibrateAccessibilityIssue
} from "../severityPolicy.js";

test("accessibility severity policy bumps severity/confidence for multi-viewport clusters", () => {
  const calibrated = calibrateAccessibilityIssue({
    issue: {
      ruleId: "LANDMARKS_MISSING",
      severity: "P2",
      confidence: 0.74
    },
    clusterStats: {
      viewportCount: 2,
      occurrenceCount: 2
    }
  });

  assert.equal(calibrated.finalSeverity, "P1");
  assert.equal(Number(calibrated.finalConfidence.toFixed(2)), 0.82);
});

test("accessibility severity policy allows P0 only for repeated eligible rules", () => {
  const eligible = calibrateAccessibilityIssue({
    issue: {
      ruleId: "FOCUSABLE_HIDDEN",
      severity: "P1",
      confidence: 0.86
    },
    clusterStats: {
      viewportCount: 2,
      occurrenceCount: 3
    }
  });
  const nonEligible = calibrateAccessibilityIssue({
    issue: {
      ruleId: "LANDMARKS_MISSING",
      severity: "P2",
      confidence: 0.8
    },
    clusterStats: {
      viewportCount: 2,
      occurrenceCount: 3
    }
  });

  assert.equal(eligible.finalSeverity, "P0");
  assert.equal(nonEligible.finalSeverity, "P1");
});

test("accessibility cluster calibration computes final worst severity and confidence", () => {
  const clusters = [
    {
      clusterKey: "LANDMARKS_MISSING|/store",
      ruleId: "LANDMARKS_MISSING",
      worstSeverity: "P2"
    }
  ];
  const issues = [
    {
      clusterKey: "LANDMARKS_MISSING|/store",
      severity: "P2",
      finalSeverity: "P1",
      confidence: 0.76,
      finalConfidence: 0.84
    },
    {
      clusterKey: "LANDMARKS_MISSING|/store",
      severity: "P2",
      finalSeverity: "P2",
      confidence: 0.74,
      finalConfidence: 0.8
    }
  ];

  const calibratedClusters = calibrateAccessibilityClusters(clusters, issues);
  assert.equal(calibratedClusters[0].finalWorstSeverity, "P1");
  assert.equal(Number(calibratedClusters[0].finalConfidence.toFixed(2)), 0.82);
});

