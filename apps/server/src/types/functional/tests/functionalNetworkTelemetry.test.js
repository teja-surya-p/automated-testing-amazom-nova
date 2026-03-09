import test from "node:test";
import assert from "node:assert/strict";

import {
  filterApiCallsByContracts,
  groupFailingEndpoints,
  normalizeEndpointPath,
  summarizeApiErrorCounts
} from "../src/types/functional/networkTelemetry.js";

test("normalizeEndpointPath strips query and trailing slash deterministically", () => {
  assert.equal(normalizeEndpointPath("https://example.com/api/v1/users/?page=2&utm_source=x"), "/api/v1/users");
  assert.equal(normalizeEndpointPath("/checkout/"), "/checkout");
  assert.equal(normalizeEndpointPath(""), "/");
});

test("groupFailingEndpoints groups by normalized path and keeps deterministic ordering", () => {
  const grouped = groupFailingEndpoints([
    { url: "https://example.com/api/search?q=test", status: 500, isThirdParty: false },
    { url: "https://example.com/api/search?q=other", status: 502, isThirdParty: false },
    { url: "https://cdn.example.net/pixel", status: 404, isThirdParty: true },
    { url: "https://cdn.example.net/pixel", status: null, timedOut: true, isThirdParty: true },
    { url: "https://example.com/api/ok", status: 200, isThirdParty: false }
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].urlPath, "/api/search");
  assert.equal(grouped[0].count, 2);
  assert.deepEqual(grouped[0].statusCodes, ["500", "502"]);
  assert.equal(grouped[1].urlPath, "/pixel");
  assert.equal(grouped[1].isThirdParty, true);
  assert.deepEqual(grouped[1].statusCodes, ["404", "timeout"]);
});

test("filterApiCallsByContracts applies allowlist and blocklist patterns", () => {
  const apiCalls = [
    { urlPath: "/api/search", status: 200 },
    { urlPath: "/api/orders", status: 500 },
    { urlPath: "/analytics/collect", status: 503 }
  ];

  const filtered = filterApiCallsByContracts(apiCalls, {
    endpointAllowlistPatterns: ["/api/*"],
    endpointBlocklistPatterns: ["/api/orders"]
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].urlPath, "/api/search");
});

test("summarizeApiErrorCounts counts 4xx and 5xx without noise", () => {
  const counts = summarizeApiErrorCounts([
    { status: 200 },
    { status: 404 },
    { status: 429 },
    { status: 503 },
    { status: null }
  ]);

  assert.equal(counts["4xx"], 2);
  assert.equal(counts["5xx"], 1);
  assert.equal(counts.timeouts, 0);
});
