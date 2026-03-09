import test from "node:test";
import assert from "node:assert/strict";

import { UrlFrontier, canonicalizeUrl } from "../../../library/url/urlFrontier.js";

test("canonicalizeUrl strips fragments and tracking params while preserving query semantics", () => {
  const canonical = canonicalizeUrl(
    "https://example.com/products/?utm_source=ads&q=chair&fbclid=123#details"
  );

  assert.equal(canonical, "https://example.com/products?q=chair");
});

test("frontier dedupes canonical URLs", () => {
  const frontier = new UrlFrontier({
    startUrl: "https://example.com/",
    canonicalizeUrls: true
  });

  frontier.markVisited("https://example.com/");
  const first = frontier.push("https://example.com/about/");
  const second = frontier.push("https://example.com/about#team");

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(frontier.getQueuedCount(), 1);
});

test("frontier preserves FIFO queue order", () => {
  const frontier = new UrlFrontier({
    startUrl: "https://example.com/"
  });

  frontier.markVisited("https://example.com/");
  frontier.push("https://example.com/a");
  frontier.push("https://example.com/b");
  frontier.push("https://example.com/c");

  assert.equal(frontier.next().canonicalUrl, "https://example.com/a");
  assert.equal(frontier.next().canonicalUrl, "https://example.com/b");
  assert.equal(frontier.next().canonicalUrl, "https://example.com/c");
});
