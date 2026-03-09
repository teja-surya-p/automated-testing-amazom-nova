import test from "node:test";
import assert from "node:assert/strict";

import {
  consistentContentType,
  excessiveThirdPartyFailures,
  graphqlErrorsDetected,
  noApi5xx,
  no5xxSpike,
  noConsoleErrors,
  noStuckLoading,
  safeRedirectAllowed,
  urlChanged
} from "../src/types/functional/assertions/dsl.js";
import { evaluateCoreFunctionalRules } from "../src/types/functional/assertions/coreRules.js";

function makeSnapshot(overrides = {}) {
  return {
    url: "https://example.com/store",
    hash: "hash-a",
    bodyText: "Store page",
    interactive: [],
    spinnerVisible: false,
    uiReadyState: { timedOut: false },
    layoutSample: { persistentBlockerCount: 0 },
    networkSummary: {
      status5xx: 0,
      downloads: [],
      mainDocumentStatus: 200,
      mainDocumentContentType: "text/html",
      apiCalls: [],
      apiErrorCounts: {
        "4xx": 0,
        "5xx": 0,
        timeouts: 0
      },
      graphqlErrorsDetected: 0,
      topFailingEndpoints: []
    },
    consoleEntries: [],
    ...overrides
  };
}

test("dsl urlChanged detects URL transition", () => {
  const result = urlChanged({
    beforeSnapshot: makeSnapshot({ url: "https://example.com/store" }),
    afterSnapshot: makeSnapshot({ url: "https://example.com/products" })
  });
  assert.equal(result.pass, true);
});

test("dsl noConsoleErrors fails on error entries", () => {
  const result = noConsoleErrors({
    snapshot: makeSnapshot({
      consoleEntries: [{ type: "error", text: "boom" }]
    })
  });
  assert.equal(result.pass, false);
});

test("dsl no5xxSpike fails on 5xx increase", () => {
  const result = no5xxSpike({
    beforeSnapshot: makeSnapshot({ networkSummary: { status5xx: 0 } }),
    afterSnapshot: makeSnapshot({ networkSummary: { status5xx: 2 } })
  });
  assert.equal(result.pass, false);
});

test("dsl noApi5xx fails when API telemetry includes server errors", () => {
  const result = noApi5xx({
    apiCalls: [
      { urlPath: "/api/search", status: 200 },
      { urlPath: "/api/orders", status: 503 }
    ]
  });
  assert.equal(result.pass, false);
});

test("dsl consistentContentType fails on non-html main document", () => {
  const result = consistentContentType({
    snapshot: makeSnapshot({
      networkSummary: {
        mainDocumentStatus: 200,
        mainDocumentContentType: "application/json"
      }
    })
  });
  assert.equal(result.pass, false);
});

test("dsl graphqlErrorsDetected returns null when telemetry is unavailable", () => {
  const result = graphqlErrorsDetected({
    telemetryAvailable: false
  });
  assert.equal(result, null);
});

test("dsl excessiveThirdPartyFailures fails when threshold is exceeded", () => {
  const result = excessiveThirdPartyFailures({
    apiCalls: [
      { isThirdParty: true, status: 500 },
      { isThirdParty: true, status: 502 },
      { isThirdParty: true, status: 504 },
      { isThirdParty: true, status: 503 }
    ],
    threshold: 3
  });
  assert.equal(result.pass, false);
});

test("dsl noStuckLoading fails when readiness timed out", () => {
  const result = noStuckLoading({
    snapshot: makeSnapshot({
      uiReadyState: { timedOut: true }
    })
  });
  assert.equal(result.pass, false);
});

test("dsl safeRedirectAllowed fails on looping history", () => {
  const result = safeRedirectAllowed({
    runHistory: [
      { url: "https://example.com/a" },
      { url: "https://example.com/a" },
      { url: "https://example.com/a" },
      { url: "https://example.com/a" }
    ],
    maxLoopRepeats: 3
  });
  assert.equal(result.pass, false);
});

test("core rules enforce navigation and system invariants", () => {
  const before = makeSnapshot({
    url: "https://example.com/store",
    hash: "h1"
  });
  const after = makeSnapshot({
    url: "https://example.com/products",
    hash: "h2",
    interactive: [
      {
        tag: "a",
        zone: "Primary Content",
        inViewport: true,
        disabled: false
      }
    ]
  });
  const results = evaluateCoreFunctionalRules({
    beforeSnapshot: before,
    afterSnapshot: after,
    action: {
      type: "click",
      functionalKind: "navigation",
      elementId: "el-nav"
    },
    runHistory: [{ url: before.url }, { url: after.url }],
    assertionsConfig: {
      failOnConsoleError: true,
      failOn5xx: true
    }
  });

  assert.equal(results.length >= 4, true);
  assert.equal(results.every((item) => typeof item.pass === "boolean"), true);
});

test("core rules include phase-4 download/new-tab/upload/spa checks", () => {
  const before = makeSnapshot({
    url: "https://example.com/store",
    hash: "a",
    interactive: [
      {
        elementId: "upload-input",
        value: ""
      }
    ]
  });
  const after = makeSnapshot({
    url: "https://example.com/store?page=2",
    hash: "b",
    uiReadyState: { timedOut: false },
    layoutSample: { persistentBlockerCount: 0 },
    networkSummary: {
      status5xx: 0,
      downloads: [{ fileName: "report.csv", exists: true }],
      mainDocumentStatus: 200,
      mainDocumentContentType: "text/html",
      apiCalls: [
        { method: "GET", urlPath: "/api/search", status: 200, isThirdParty: false, isGraphql: false, contentType: "application/json" },
        { method: "POST", urlPath: "/api/orders", status: 503, isThirdParty: false, isGraphql: false, contentType: "application/json" },
        { method: "POST", urlPath: "/graphql", status: 200, isThirdParty: false, isGraphql: true, contentType: "application/json" }
      ],
      apiErrorCounts: {
        "4xx": 0,
        "5xx": 1,
        timeouts: 0
      },
      graphqlErrorsDetected: 1,
      topFailingEndpoints: [
        { urlPath: "/api/orders", count: 1, statusCodes: ["503"] }
      ]
    },
    interactive: [
      {
        elementId: "upload-input",
        value: "C:\\fakepath\\upload.txt"
      }
    ]
  });

  const rules = evaluateCoreFunctionalRules({
    beforeSnapshot: before,
    afterSnapshot: after,
    action: {
      type: "click",
      functionalKind: "navigation",
      elementId: "upload-input"
    },
    actionResult: {
      progressSignals: ["download-triggered:report.csv", "new-tab-opened:https://example.com/store?page=2", "upload-attached"]
    },
    runHistory: [{ url: before.url }, { url: after.url }],
    assertionsConfig: {
      failOnConsoleError: true,
      failOn5xx: true
    },
    contractsConfig: {
      failOnApi5xx: true,
      warnOnThirdPartyFailures: true,
      endpointAllowlistPatterns: ["/api/*", "/graphql"],
      endpointBlocklistPatterns: []
    }
  });

  const ruleIds = new Set(rules.map((rule) => rule.ruleId));
  assert.equal(ruleIds.has("DOWNLOAD_EXISTS_AFTER_ACTION"), true);
  assert.equal(ruleIds.has("NEW_TAB_NAVIGATION_VALID"), true);
  assert.equal(ruleIds.has("UPLOAD_ACCEPTED"), true);
  assert.equal(ruleIds.has("SPA_READY_AFTER_NAV"), true);
  assert.equal(ruleIds.has("NO_API_5XX"), true);
  assert.equal(ruleIds.has("GRAPHQL_ERRORS_DETECTED"), true);
  assert.equal(ruleIds.has("CONSISTENT_CONTENT_TYPE"), true);
  assert.equal(ruleIds.has("EXCESSIVE_THIRD_PARTY_FAILURES"), true);
  assert.equal(rules.some((rule) => rule.ruleId === "NO_API_5XX" && rule.pass === false), true);
});
