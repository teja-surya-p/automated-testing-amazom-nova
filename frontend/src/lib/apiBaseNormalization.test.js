import assert from "node:assert/strict";
import test from "node:test";

import { normalizeApiBaseUrl } from "../services/constants.js";

test("normalizeApiBaseUrl strips trailing /api segment to avoid duplicated /api prefix", () => {
  assert.equal(normalizeApiBaseUrl("http://localhost:3000/api"), "http://localhost:3000");
  assert.equal(normalizeApiBaseUrl("http://localhost:3000/api/"), "http://localhost:3000");
  assert.equal(normalizeApiBaseUrl("https://example.com/backend/api"), "https://example.com/backend");
});

test("normalizeApiBaseUrl preserves base when /api segment is not present", () => {
  assert.equal(normalizeApiBaseUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeApiBaseUrl("https://example.com/backend"), "https://example.com/backend");
});

