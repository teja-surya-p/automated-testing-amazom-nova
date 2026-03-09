import test from "node:test";
import assert from "node:assert/strict";

import { buildUiuxBaselinePayload, diffUiuxBaseline } from "../src/types/uiux/baselineStore.js";

test("baseline payload stores metadata-only cluster fields", () => {
  const payload = buildUiuxBaselinePayload({
    baselineId: "Smoke-Baseline",
    clusters: [
      {
        clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
        issueType: "BROKEN_LINK",
        viewportLabel: "desktop",
        normalizedPath: "/store",
        finalWorstSeverity: "P1",
        count: 3
      }
    ]
  });

  assert.equal(payload.baselineId, "smoke-baseline");
  assert.equal(payload.clusters[0].issueType, "BROKEN_LINK");
  assert.equal(payload.clusters[0].worstSeverity, "P1");
  assert.equal(payload.clusters[0].count, 3);
});

test("baseline diff reports new/resolved and severity changes", () => {
  const baseline = {
    baselineId: "smoke",
    generatedAt: "2026-03-01T00:00:00.000Z",
    clusters: [
      {
        clusterKey: "A|/store|desktop|",
        issueType: "A",
        worstSeverity: "P2",
        count: 2
      },
      {
        clusterKey: "B|/search|desktop|",
        issueType: "B",
        worstSeverity: "P1",
        count: 1
      }
    ]
  };

  const current = [
    {
      clusterKey: "A|/store|desktop|",
      issueType: "A",
      viewportLabel: "desktop",
      normalizedPath: "/store",
      finalWorstSeverity: "P1",
      count: 4
    },
    {
      clusterKey: "C|/checkout|desktop|",
      issueType: "C",
      viewportLabel: "desktop",
      normalizedPath: "/checkout",
      finalWorstSeverity: "P2",
      count: 1
    }
  ];

  const diff = diffUiuxBaseline({
    baseline,
    currentClusters: current
  });

  assert.equal(diff.newClusters.length, 1);
  assert.equal(diff.newClusters[0].clusterKey, "C|/checkout|desktop|");
  assert.equal(diff.resolvedClusters.length, 1);
  assert.equal(diff.resolvedClusters[0].clusterKey, "B|/search|desktop|");
  assert.equal(diff.severityIncreases.length, 1);
  assert.equal(diff.severityIncreases[0].clusterKey, "A|/store|desktop|");
  assert.equal(diff.severityDecreases.length, 0);
});

