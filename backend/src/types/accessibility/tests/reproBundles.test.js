import test from "node:test";
import assert from "node:assert/strict";

import {
  attachTopReproToAccessibilityClusters,
  buildAccessibilityRepro,
  buildAccessibilityReproBundles
} from "../reproBundles.js";

test("buildAccessibilityRepro creates deterministic repro payload", () => {
  const repro = buildAccessibilityRepro({
    ruleId: "MISSING_FORM_LABEL",
    finalSeverity: "P1",
    step: 6,
    viewportLabel: "mobile",
    affectedUrl: "https://example.com/search?utm_source=test",
    affectedSelector: "input[name='q']",
    expected: "Visible inputs should have labels.",
    actual: "Search input has no label.",
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/step-006.png" }]
  });

  assert.equal(repro.ruleId, "MISSING_FORM_LABEL");
  assert.equal(repro.finalSeverity, "P1");
  assert.equal(repro.step, 6);
  assert.equal(repro.viewportLabel, "mobile");
  assert.equal(repro.canonicalUrl, "https://example.com/search");
  assert.equal(repro.selector, "input[name='q']");
});

test("buildAccessibilityReproBundles creates flat issue bundles", () => {
  const bundles = buildAccessibilityReproBundles([
    {
      ruleId: "ERROR_NOT_ASSOCIATED",
      clusterKey: "ERROR_NOT_ASSOCIATED|/checkout",
      severity: "P2",
      finalSeverity: "P1",
      confidence: 0.8,
      finalConfidence: 0.9,
      step: 4,
      viewportLabel: "desktop",
      affectedUrl: "https://example.com/checkout",
      affectedSelector: ".field-error",
      expected: "Errors should map to fields.",
      actual: "Error block not mapped.",
      evidenceRefs: [{ type: "screenshot", ref: "/artifacts/s4.png" }]
    }
  ]);

  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].ruleId, "ERROR_NOT_ASSOCIATED");
  assert.equal(bundles[0].finalSeverity, "P1");
  assert.equal(bundles[0].repro.step, 4);
});

test("attachTopReproToAccessibilityClusters picks worst severity then confidence", () => {
  const clusters = [
    {
      clusterKey: "ERROR_NOT_ASSOCIATED|/checkout",
      ruleId: "ERROR_NOT_ASSOCIATED",
      worstSeverity: "P2"
    }
  ];
  const bundles = [
    {
      clusterKey: "ERROR_NOT_ASSOCIATED|/checkout",
      ruleId: "ERROR_NOT_ASSOCIATED",
      finalSeverity: "P2",
      finalConfidence: 0.92,
      repro: { step: 8, viewportLabel: "desktop" }
    },
    {
      clusterKey: "ERROR_NOT_ASSOCIATED|/checkout",
      ruleId: "ERROR_NOT_ASSOCIATED",
      finalSeverity: "P1",
      finalConfidence: 0.84,
      repro: { step: 5, viewportLabel: "mobile" }
    }
  ];

  const withTopRepro = attachTopReproToAccessibilityClusters(clusters, bundles);
  assert.equal(withTopRepro[0].topRepro.step, 5);
});

