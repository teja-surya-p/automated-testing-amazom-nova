import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUiuxGroupedCaseKey,
  buildUiuxClusterKey,
  buildUiuxIssueClusters,
  normalizePathFromUrl,
  upsertUiuxIssueClusters
} from "../../../library/reporting/clustering.js";

test("normalizePathFromUrl strips query/hash and normalizes root", () => {
  assert.equal(normalizePathFromUrl("https://example.com/search?q=abc#top"), "/search");
  assert.equal(normalizePathFromUrl("https://example.com/"), "/");
});

test("buildUiuxClusterKey uses issueType + normalized path + viewport + selector", () => {
  const key = buildUiuxClusterKey({
    issueType: "HORIZONTAL_SCROLL",
    affectedUrl: "https://example.com/store?page=2",
    viewportLabel: "desktop",
    affectedSelector: ".content"
  });

  assert.equal(key, "HORIZONTAL_SCROLL|/store|desktop|.content");
});

test("buildUiuxGroupedCaseKey collapses same issue across viewports/devices", () => {
  const first = buildUiuxGroupedCaseKey({
    issueType: "TEXT_OVERFLOW_CLIP",
    testcaseId: "TEXT_OVERFLOW_CLIP",
    affectedUrl: "https://example.com/pricing?ref=top",
    viewportLabel: "mobile",
    deviceLabel: "iPhone 12",
    affectedSelector: "button.primary-cta",
    explanation: {
      whatHappened: "Primary CTA text is clipped."
    }
  });
  const second = buildUiuxGroupedCaseKey({
    issueType: "TEXT_OVERFLOW_CLIP",
    testcaseId: "TEXT_OVERFLOW_CLIP",
    affectedUrl: "https://example.com/pricing",
    viewportLabel: "desktop",
    deviceLabel: "desktop",
    affectedSelector: "button.primary-cta",
    explanation: {
      whatHappened: "Primary CTA text is clipped."
    }
  });

  assert.equal(first, second);
});

test("upsertUiuxIssueClusters aggregates count/pages/worst severity", () => {
  let clusters = [];
  clusters = upsertUiuxIssueClusters(clusters, {
    issueType: "BROKEN_LINK",
    severity: "P2",
    step: 2,
    affectedUrl: "https://example.com/a",
    viewportLabel: "desktop",
    affectedSelector: "a.nav",
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/1.png" }]
  });
  clusters = upsertUiuxIssueClusters(clusters, {
    issueType: "BROKEN_LINK",
    severity: "P1",
    step: 4,
    affectedUrl: "https://example.com/a?x=1",
    viewportLabel: "desktop",
    affectedSelector: "a.nav",
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/2.png" }]
  });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters[0].worstSeverity, "P1");
  assert.equal(clusters[0].firstSeenStep, 2);
  assert.equal(clusters[0].pagesAffected.length, 2);
});

test("buildUiuxIssueClusters groups occurrences by cluster key", () => {
  const clusters = buildUiuxIssueClusters([
    {
      issueType: "MISSING_PAGE_HEADING",
      severity: "P2",
      step: 1,
      affectedUrl: "https://example.com/docs/getting-started",
      viewportLabel: "mobile"
    },
    {
      issueType: "MISSING_PAGE_HEADING",
      severity: "P2",
      step: 3,
      affectedUrl: "https://example.com/docs/install",
      viewportLabel: "mobile"
    }
  ]);

  assert.equal(clusters.length, 2);
});
