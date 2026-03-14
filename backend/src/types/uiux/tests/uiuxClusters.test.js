import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUiuxComponentFingerprint,
  buildUiuxGroupedCaseKey,
  buildUiuxClusterKey,
  buildUiuxIssueClusters,
  normalizePathFromUrl,
  resolveUiuxIssueFamily,
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

test("buildUiuxGroupedCaseKey merges related issue types for same component family", () => {
  const clipped = buildUiuxGroupedCaseKey({
    issueType: "CLIPPED_PRIMARY_CTA",
    affectedUrl: "https://example.com/pricing?viewport=mobile",
    affectedSelector: "button.primary-cta",
    highlight: {
      box: { x: 24, y: 500, width: 170, height: 40 }
    },
    title: "Primary CTA clipped"
  });
  const overflow = buildUiuxGroupedCaseKey({
    issueType: "TEXT_OVERFLOW_CLIP",
    affectedUrl: "https://example.com/pricing",
    affectedSelector: "button.primary-cta",
    highlight: {
      box: { x: 26, y: 498, width: 172, height: 40 }
    },
    title: "CTA text overflows"
  });

  assert.equal(clipped, overflow);
});

test("buildUiuxGroupedCaseKey separates same component family by breakpoint range", () => {
  const mobileRange = buildUiuxGroupedCaseKey({
    issueType: "TEXT_OVERFLOW_CLIP",
    affectedUrl: "https://example.com/pricing",
    affectedSelector: "button.primary-cta",
    breakpointRange: {
      minWidth: 320,
      maxWidth: 430
    }
  });
  const tabletRange = buildUiuxGroupedCaseKey({
    issueType: "TEXT_OVERFLOW_CLIP",
    affectedUrl: "https://example.com/pricing",
    affectedSelector: "button.primary-cta",
    breakpointRange: {
      minWidth: 720,
      maxWidth: 860
    }
  });

  assert.notEqual(mobileRange, tabletRange);
});

test("buildUiuxGroupedCaseKey does not force cross-type merge when component fingerprint is weak", () => {
  const first = buildUiuxGroupedCaseKey({
    issueType: "CLIPPED_PRIMARY_CTA",
    affectedUrl: "https://example.com/pricing",
    summary: "CTA appears partially clipped."
  });
  const second = buildUiuxGroupedCaseKey({
    issueType: "TEXT_OVERFLOW_CLIP",
    affectedUrl: "https://example.com/pricing",
    summary: "CTA text is clipped."
  });

  assert.notEqual(first, second);
});

test("buildUiuxComponentFingerprint preserves stable selector + region identity", () => {
  const fingerprint = buildUiuxComponentFingerprint({
    affectedSelector: "main .hero .cta:nth-child(2) > button.primary",
    exactVisibleText: "Start free trial",
    highlight: {
      box: { x: 11, y: 231, width: 192, height: 42 }
    }
  });
  assert.ok(fingerprint.key.includes("sel:main .hero .cta:nth-child(#)>button.primary"));
  assert.ok(fingerprint.key.includes("lbl:start free trial"));
  assert.equal(fingerprint.confidence, "strong");
});

test("resolveUiuxIssueFamily maps overlapping issue types deterministically", () => {
  assert.equal(resolveUiuxIssueFamily("TEXT_OVERFLOW_CLIP"), "RESPONSIVE_OVERFLOW");
  assert.equal(resolveUiuxIssueFamily("BROKEN_LINK"), "BROKEN_LINK");
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
