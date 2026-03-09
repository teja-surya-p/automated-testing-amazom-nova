import test from "node:test";
import assert from "node:assert/strict";

import {
  attachTopReproToClusters,
  buildIssueRepro,
  buildUiuxReproBundles
} from "../reproBundles.js";

test("buildIssueRepro creates deterministic repro object", () => {
  const repro = buildIssueRepro({
    viewportLabel: "mobile",
    step: 7,
    affectedUrl: "https://example.com/store?utm_source=x",
    affectedSelector: "button.checkout",
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/frame.png" }]
  });

  assert.equal(repro.viewportLabel, "mobile");
  assert.equal(repro.step, 7);
  assert.equal(repro.url, "https://example.com/store?utm_source=x");
  assert.equal(repro.canonicalUrl, "https://example.com/store");
  assert.equal(repro.targetSelector, "button.checkout");
});

test("buildUiuxReproBundles creates flat reproducibility bundles", () => {
  const bundles = buildUiuxReproBundles([
    {
      issueType: "BROKEN_LINK",
      clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
      severity: "P2",
      finalSeverity: "P1",
      confidence: 0.8,
      finalConfidence: 0.9,
      viewportLabel: "desktop",
      step: 3,
      affectedUrl: "https://example.com/store",
      affectedSelector: "a.nav",
      evidenceRefs: [{ type: "screenshot", ref: "/artifacts/s1.png" }]
    }
  ]);

  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].issueType, "BROKEN_LINK");
  assert.equal(bundles[0].finalSeverity, "P1");
  assert.equal(bundles[0].repro.step, 3);
});

test("attachTopReproToClusters picks highest-priority repro occurrence", () => {
  const clusters = [
    {
      clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
      issueType: "BROKEN_LINK",
      worstSeverity: "P2"
    }
  ];
  const bundles = [
    {
      issueType: "BROKEN_LINK",
      clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
      finalSeverity: "P2",
      finalConfidence: 0.84,
      repro: { step: 5, viewportLabel: "desktop" }
    },
    {
      issueType: "BROKEN_LINK",
      clusterKey: "BROKEN_LINK|/store|desktop|a.nav",
      finalSeverity: "P1",
      finalConfidence: 0.8,
      repro: { step: 4, viewportLabel: "desktop" }
    }
  ];

  const withTopRepro = attachTopReproToClusters(clusters, bundles);
  assert.equal(withTopRepro[0].topRepro.step, 4);
});

