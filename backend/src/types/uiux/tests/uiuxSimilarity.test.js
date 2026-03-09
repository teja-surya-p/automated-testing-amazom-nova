import test from "node:test";
import assert from "node:assert/strict";

import {
  jaccardSimilarity,
  normalizeNavLabels,
  resolvePrimaryPageType
} from "../../../library/metrics/similarity.js";

test("normalizeNavLabels removes duplicates and normalizes casing/punctuation", () => {
  const labels = normalizeNavLabels([" Home ", "home", "Pricing!", "PRICING"]);
  assert.deepEqual(labels, ["home", "pricing"]);
});

test("jaccardSimilarity returns deterministic overlap score", () => {
  const score = jaccardSimilarity(
    ["Home", "Pricing", "Docs"],
    ["home", "pricing", "blog"]
  );

  assert.equal(Number(score.toFixed(2)), 0.5);
});

test("resolvePrimaryPageType follows deterministic precedence", () => {
  assert.equal(resolvePrimaryPageType({ isCheckout: true, isSearch: true }), "checkout");
  assert.equal(resolvePrimaryPageType({ isAuth: true }), "auth");
  assert.equal(resolvePrimaryPageType({ isProduct: true }), "product");
  assert.equal(resolvePrimaryPageType({ isSearch: true }), "search");
  assert.equal(resolvePrimaryPageType({ isDocs: true }), "docs");
  assert.equal(resolvePrimaryPageType({ isHome: true }), "home");
  assert.equal(resolvePrimaryPageType({}), "generic");
});
