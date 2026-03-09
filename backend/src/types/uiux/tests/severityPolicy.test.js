import test from "node:test";
import assert from "node:assert/strict";

import { calibrateUiuxIssue, calibrateUiuxClusters } from "../severityPolicy.js";

test("severity policy bumps severity/confidence for multi-viewport clusters", () => {
  const calibrated = calibrateUiuxIssue({
    issue: {
      issueType: "HORIZONTAL_SCROLL",
      severity: "P2",
      confidence: 0.74
    },
    clusterStats: {
      viewportCount: 2,
      pageCount: 1,
      occurrenceCount: 2
    }
  });

  assert.equal(calibrated.finalSeverity, "P1");
  assert.equal(Number(calibrated.finalConfidence.toFixed(2)), 0.82);
});

test("severity policy bumps severity for high-frequency cluster", () => {
  const calibrated = calibrateUiuxIssue({
    issue: {
      issueType: "MISSING_PAGE_HEADING",
      severity: "P2",
      confidence: 0.76
    },
    clusterStats: {
      viewportCount: 1,
      pageCount: 3,
      occurrenceCount: 3
    }
  });

  assert.equal(calibrated.finalSeverity, "P1");
  assert.equal(Number(calibrated.finalConfidence.toFixed(2)), 0.81);
});

test("severity policy reduces confidence for single low-confidence p2 issues", () => {
  const calibrated = calibrateUiuxIssue({
    issue: {
      issueType: "CTA_PRIORITY_CONFLICT",
      severity: "P2",
      confidence: 0.61
    },
    clusterStats: {
      viewportCount: 1,
      pageCount: 1,
      occurrenceCount: 1
    }
  });

  assert.equal(calibrated.finalSeverity, "P2");
  assert.equal(Number(calibrated.finalConfidence.toFixed(2)), 0.53);
});

test("cluster calibration computes final worst severity and confidence", () => {
  const clusters = [
    {
      clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
      issueType: "BROKEN_LINK",
      worstSeverity: "P2"
    }
  ];
  const issues = [
    {
      clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
      severity: "P2",
      finalSeverity: "P1",
      confidence: 0.82,
      finalConfidence: 0.9
    },
    {
      clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
      severity: "P2",
      finalSeverity: "P2",
      confidence: 0.75,
      finalConfidence: 0.8
    }
  ];

  const calibratedClusters = calibrateUiuxClusters(clusters, issues);
  assert.equal(calibratedClusters[0].finalWorstSeverity, "P1");
  assert.equal(Number(calibratedClusters[0].finalConfidence.toFixed(2)), 0.85);
});

