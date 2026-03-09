import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFunctionalBaselinePayload,
  diffFunctionalBaseline
} from "../baselineStore.js";

test("functional baseline payload keeps metadata-only fields", () => {
  const payload = buildFunctionalBaselinePayload({
    baselineId: "Functional Smoke",
    functional: {
      flows: [
        {
          flowType: "HOME_NAV_SMOKE",
          label: "Home navigation",
          blocked: false,
          assertionFailures: 0
        }
      ],
      issues: [
        {
          assertionId: "NO_API_5XX",
          severity: "P1"
        }
      ],
      blockers: [
        { type: "LOGIN_REQUIRED" }
      ],
      contractSummary: {
        topFailingEndpoints: [
          { urlPath: "/api/orders", count: 3 }
        ]
      }
    }
  });

  assert.equal(payload.baselineId, "functional-smoke");
  assert.equal(payload.flows[0].signature, "HOME_NAV_SMOKE:Home navigation");
  assert.equal(payload.flows[0].outcome, "passed");
  assert.equal(payload.failingAssertionTypes[0].assertionId, "NO_API_5XX");
  assert.equal(payload.topFailingEndpoints[0].urlPath, "/api/orders");
  assert.equal(payload.blockerTypes[0].blockerType, "LOGIN_REQUIRED");
  assert.equal(payload.worstSeverity, "P1");
});

test("functional baseline diff reports new/resolved failures and endpoint/blocker deltas", () => {
  const baseline = {
    baselineId: "functional-smoke",
    generatedAt: "2026-03-01T00:00:00.000Z",
    failingAssertionTypes: [
      { assertionId: "NO_API_5XX", count: 2 },
      { assertionId: "NO_STUCK_LOADING", count: 1 }
    ],
    topFailingEndpoints: [
      { urlPath: "/api/orders", count: 3 }
    ],
    blockerTypes: [
      { blockerType: "LOGIN_REQUIRED", count: 1 }
    ]
  };

  const current = {
    baselineId: "functional-smoke",
    generatedAt: "2026-03-05T00:00:00.000Z",
    failingAssertionTypes: [
      { assertionId: "NO_API_5XX", count: 4 },
      { assertionId: "CONSISTENT_CONTENT_TYPE", count: 1 }
    ],
    topFailingEndpoints: [
      { urlPath: "/api/orders", count: 1 },
      { urlPath: "/graphql", count: 2 }
    ],
    blockerTypes: [
      { blockerType: "CAPTCHA_BOT_DETECTED", count: 1 }
    ]
  };

  const diff = diffFunctionalBaseline({ baseline, current });

  assert.equal(diff.newFailures.length, 1);
  assert.equal(diff.newFailures[0].assertionId, "CONSISTENT_CONTENT_TYPE");
  assert.equal(diff.resolvedFailures.length, 1);
  assert.equal(diff.resolvedFailures[0].assertionId, "NO_STUCK_LOADING");
  assert.equal(diff.endpointFailureDeltas.some((item) => item.urlPath === "/graphql" && item.delta === 2), true);
  assert.equal(diff.blockerDeltas.some((item) => item.blockerType === "LOGIN_REQUIRED" && item.delta === -1), true);
});
