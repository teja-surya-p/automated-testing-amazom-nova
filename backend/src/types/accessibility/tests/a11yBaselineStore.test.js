import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAccessibilityBaselinePayload,
  diffAccessibilityBaseline
} from "../baselineStore.js";

test("accessibility baseline payload stores metadata-only cluster fields", () => {
  const payload = buildAccessibilityBaselinePayload({
    baselineId: "A11Y Smoke",
    clusters: [
      {
        clusterKey: "MISSING_FORM_LABEL|/store",
        ruleId: "MISSING_FORM_LABEL",
        normalizedPath: "/store",
        worstSeverity: "P1",
        finalWorstSeverity: "P0",
        count: 2
      }
    ]
  });

  assert.equal(payload.baselineId, "a11y-smoke");
  assert.equal(payload.clusters.length, 1);
  assert.equal(payload.clusters[0].ruleId, "MISSING_FORM_LABEL");
  assert.equal(payload.clusters[0].count, 2);
  assert.equal(payload.clusters[0].worstSeverity, "P0");
});

test("accessibility baseline diff reports new/resolved and severity changes", () => {
  const baseline = {
    baselineId: "a11y-smoke",
    generatedAt: "2026-03-01T00:00:00.000Z",
    clusters: [
      {
        clusterKey: "MISSING_FORM_LABEL|/store",
        ruleId: "MISSING_FORM_LABEL",
        normalizedPath: "/store",
        worstSeverity: "P2",
        count: 2
      },
      {
        clusterKey: "LANDMARKS_MISSING|/help",
        ruleId: "LANDMARKS_MISSING",
        normalizedPath: "/help",
        worstSeverity: "P2",
        count: 1
      }
    ]
  };

  const currentClusters = [
    {
      clusterKey: "MISSING_FORM_LABEL|/store",
      ruleId: "MISSING_FORM_LABEL",
      normalizedPath: "/store",
      worstSeverity: "P1",
      count: 3
    },
    {
      clusterKey: "BUTTON_NAME_MISSING|/checkout",
      ruleId: "BUTTON_NAME_MISSING",
      normalizedPath: "/checkout",
      worstSeverity: "P1",
      count: 1
    }
  ];

  const diff = diffAccessibilityBaseline({ baseline, currentClusters });
  assert.equal(diff.newClusters.length, 1);
  assert.equal(diff.resolvedClusters.length, 1);
  assert.equal(diff.severityIncreases.length, 1);
  assert.equal(diff.severityIncreases[0].clusterKey, "MISSING_FORM_LABEL|/store");
});
