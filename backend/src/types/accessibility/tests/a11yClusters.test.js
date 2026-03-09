import test from "node:test";
import assert from "node:assert/strict";

import {
  buildA11yClusterKey,
  buildA11yIssueClusters,
  upsertA11yIssueClusters
} from "../clustering.js";

function makeIssue(overrides = {}) {
  return {
    ruleId: "MISSING_FORM_LABEL",
    severity: "P1",
    title: "Form label missing",
    actual: "Input is unlabeled",
    affectedUrl: "https://example.com/store?utm_source=x",
    affectedSelector: "input[name='email']",
    step: 3,
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/step-3.png" }],
    ...overrides
  };
}

test("buildA11yClusterKey groups by rule and normalized path", () => {
  const key = buildA11yClusterKey(makeIssue());
  assert.equal(key, "MISSING_FORM_LABEL|/store");
});

test("upsertA11yIssueClusters aggregates counts and worst severity", () => {
  const first = makeIssue({ severity: "P2" });
  const second = makeIssue({ severity: "P1", step: 4 });

  const clusters = upsertA11yIssueClusters(upsertA11yIssueClusters([], first), second);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters[0].worstSeverity, "P1");
  assert.equal(clusters[0].occurrences.length, 2);
});

test("buildA11yIssueClusters dedupes by rule + path and keeps separate paths", () => {
  const issues = [
    makeIssue({ affectedUrl: "https://example.com/store" }),
    makeIssue({ affectedUrl: "https://example.com/store?x=1" }),
    makeIssue({ affectedUrl: "https://example.com/checkout", ruleId: "BUTTON_NAME_MISSING" })
  ];

  const clusters = buildA11yIssueClusters(issues);
  assert.equal(clusters.length, 2);
  assert.equal(clusters.some((cluster) => cluster.clusterKey === "MISSING_FORM_LABEL|/store"), true);
  assert.equal(clusters.some((cluster) => cluster.clusterKey === "BUTTON_NAME_MISSING|/checkout"), true);
});
