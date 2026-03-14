import test from "node:test";
import assert from "node:assert/strict";

import { Gatekeeper } from "../../../services/gatekeeper.js";

function buildGateContext(overrides = {}) {
  const snapshot = {
    bodyText: "Welcome to dashboard",
    url: "https://example.com/dashboard",
    semanticMap: [{ text: "Dashboard", zone: "Primary Content", landmark: "main", center: [200, 120] }],
    overlays: [],
    consoleErrors: [],
    networkSummary: {
      failedRequests: 0,
      status4xx: 0,
      status429: 0,
      status5xx: 0,
      lastFailures: []
    },
    spinnerVisible: false,
    ...overrides.snapshot
  };

  return {
    goal: overrides.goal ?? "Validate authenticated dashboard flow",
    snapshot,
    unchangedSteps: overrides.unchangedSteps ?? 0
  };
}

test("gatekeeper ignores request-aborted noise for rate-limit detection", () => {
  const gatekeeper = new Gatekeeper({});
  const result = gatekeeper.classifyDeterministically(
    buildGateContext({
      snapshot: {
        networkSummary: {
          failedRequests: 6,
          status4xx: 0,
          status429: 0,
          status5xx: 0,
          lastFailures: [
            { failureText: "net::ERR_ABORTED", status: null, url: "https://example.com/_rsc" },
            { failureText: "net::ERR_ABORTED", status: null, url: "https://example.com/_rsc" },
            { failureText: "net::ERR_ABORTED", status: null, url: "https://example.com/_rsc" }
          ]
        }
      }
    })
  );

  assert.equal(result.some((blocker) => blocker.type === "RATE_LIMITED"), false);
});

test("gatekeeper marks rate-limited when HTTP 429 signals exist", () => {
  const gatekeeper = new Gatekeeper({});
  const result = gatekeeper.classifyDeterministically(
    buildGateContext({
      snapshot: {
        networkSummary: {
          failedRequests: 1,
          status4xx: 1,
          status429: 1,
          status5xx: 0,
          lastFailures: [{ status: 429, url: "https://example.com/api/session", failureText: "" }]
        }
      }
    })
  );

  assert.equal(result.some((blocker) => blocker.type === "RATE_LIMITED"), true);
});

test("gatekeeper marks rate-limited when page text indicates throttling", () => {
  const gatekeeper = new Gatekeeper({});
  const result = gatekeeper.classifyDeterministically(
    buildGateContext({
      snapshot: {
        bodyText: "Too many requests. Please try again later.",
        semanticMap: [{ text: "Too many requests", zone: "Overlay", landmark: "dialog", center: [300, 200] }]
      }
    })
  );

  assert.equal(result.some((blocker) => blocker.type === "RATE_LIMITED"), true);
});

test("gatekeeper can still classify severe repeated 4xx network throttling", () => {
  const gatekeeper = new Gatekeeper({});
  const result = gatekeeper.classifyDeterministically(
    buildGateContext({
      snapshot: {
        networkSummary: {
          failedRequests: 9,
          status4xx: 4,
          status429: 0,
          status5xx: 0,
          lastFailures: [
            { status: 403, url: "https://example.com/api", failureText: "request failed" },
            { status: 403, url: "https://example.com/api", failureText: "request failed" }
          ]
        }
      }
    })
  );

  assert.equal(result.some((blocker) => blocker.type === "RATE_LIMITED"), true);
});
