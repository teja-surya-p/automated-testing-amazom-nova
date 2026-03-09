import test from "node:test";
import assert from "node:assert/strict";

import { FunctionalRunner, aggregateFunctionalRunnerResult } from "../functionalRunner.js";

function makeIssue(overrides = {}) {
  return {
    issueType: "FUNCTIONAL_ASSERTION_FAILED",
    severity: "P2",
    title: "Rule failure",
    expected: "Expected state",
    actual: "Actual state",
    confidence: 0.9,
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/step-1.png" }],
    affectedSelector: "a[href='/products']",
    affectedUrl: "https://example.com/products?utm_source=test",
    flowId: "flow-1",
    flowType: "HOME_NAV_SMOKE",
    assertionId: "NAVIGATION_URL_CHANGED",
    step: 3,
    viewportLabel: "desktop",
    repro: {
      viewportLabel: "desktop",
      step: 3,
      url: "https://example.com/products?utm_source=test",
      canonicalUrl: "https://example.com/products",
      targetSelector: "a[href='/products']",
      actionContext: {
        actionType: "click",
        functionalKind: "navigation",
        label: "Products"
      },
      evidenceRefs: [{ type: "screenshot", ref: "/artifacts/step-1.png" }]
    },
    ...overrides
  };
}

test("aggregateFunctionalRunnerResult returns stable pass summary and flow count", () => {
  const result = aggregateFunctionalRunnerResult({
    flows: [{ flowId: "f1", flowType: "NAVIGATION_SMOKE", blocked: false }],
    issues: [],
    blockers: []
  });

  assert.equal(result.flowsRun, 1);
  assert.equal(result.issues.length, 0);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.summary, "Functional: ran 1 flows, 0 assertions, passed 0, failed 0, blockers 0");
  assert.equal(result.deviceSummary.length, 1);
  assert.equal(result.deviceSummary[0].deviceLabel, "desktop");
  assert.deepEqual(result.reproBundles, []);
  assert.equal(result.contractSummary.apiCallsObserved, 0);
});

test("aggregateFunctionalRunnerResult sorts issues by severity then step", () => {
  const p2Step1 = makeIssue({ severity: "P2", step: 1, assertionId: "RULE_P2_1" });
  const p1Step4 = makeIssue({ severity: "P1", step: 4, assertionId: "RULE_P1_4" });
  const p1Step2 = makeIssue({ severity: "P1", step: 2, assertionId: "RULE_P1_2" });

  const result = aggregateFunctionalRunnerResult({
    flows: [],
    issues: [p2Step1, p1Step4, p1Step2],
    blockers: []
  });

  assert.equal(result.issues.length, 3);
  assert.equal(result.issues[0].assertionId, "RULE_P1_2");
  assert.equal(result.issues[1].assertionId, "RULE_P1_4");
  assert.equal(result.issues[2].assertionId, "RULE_P2_1");
  assert.equal(result.summary, "Functional: ran 0 flows, 0 assertions, passed 0, failed 0, blockers 0");
  assert.equal(result.reproBundles.length, 3);
  assert.equal(result.reproBundles[0].flowId, "flow-1");
  assert.equal(result.reproBundles[0].selector, "a[href='/products']");
  assert.equal(result.reproBundles[0].expected, "Expected state");
  assert.equal(result.reproBundles[0].actual, "Actual state");
});

test("aggregateFunctionalRunnerResult prioritizes blockers and soft-pass summary text", () => {
  const result = aggregateFunctionalRunnerResult({
    flows: [],
    issues: [makeIssue()],
    blockers: [
      { type: "CAPTCHA_BOT_DETECTED", step: 8 },
      { type: "LOGIN_REQUIRED", step: 4 }
    ],
    blockerTimeline: [
      {
        step: 4,
        blockerType: "LOGIN_REQUIRED",
        action: "click",
        url: "https://example.com/login",
        resolutionHint: "Use Login Assist.",
        timestamp: "2026-03-05T00:00:00.000Z"
      }
    ],
    loginAssist: {
      attempted: true,
      success: false,
      timeout: true,
      resumeStrategy: "restart-flow",
      profileTag: "functional-local"
    }
  });

  assert.equal(result.blockers[0].type, "LOGIN_REQUIRED");
  assert.equal(result.summary, "Functional: ran 0 flows, 0 assertions, passed 0, failed 0, blockers 2");
  assert.equal(result.blockerTimeline.length, 1);
  assert.equal(result.loginAssist.attempted, true);
});

test("aggregateFunctionalRunnerResult repro bundle preserves submit action context", () => {
  const submitIssue = makeIssue({
    flowId: "flow-search",
    flowType: "SEARCH_SMOKE",
    assertionId: "SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE",
    affectedSelector: "input[name='q']",
    repro: {
      viewportLabel: "desktop",
      step: 5,
      url: "https://example.com/search?q=test",
      canonicalUrl: "https://example.com/search?q=test",
      targetSelector: "input[name='q']",
      actionContext: {
        actionType: "type",
        functionalKind: "search",
        label: "Search products"
      },
      evidenceRefs: [{ type: "screenshot", ref: "/artifacts/step-5.png" }]
    }
  });

  const result = aggregateFunctionalRunnerResult({
    flows: [],
    issues: [submitIssue],
    blockers: []
  });

  assert.equal(result.reproBundles.length, 1);
  assert.equal(result.reproBundles[0].flowType, "SEARCH_SMOKE");
  assert.equal(result.reproBundles[0].action, "type");
  assert.equal(result.reproBundles[0].functionalKind, "search");
  assert.equal(result.reproBundles[0].selector, "input[name='q']");
});

test("waitForManualLoginAssist exits cleanly when stop is requested", async () => {
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {}
  });

  const state = {
    session: {
      status: "login-assist",
      currentUrl: "https://example.com/login",
      loginAssist: null,
      authAssist: null
    }
  };

  const sessionStore = {
    getSession() {
      return state.session;
    },
    patchSession(_sessionId, patch) {
      state.session = {
        ...state.session,
        ...patch
      };
      return state.session;
    },
    appendTimeline() {
      return null;
    }
  };

  const browserSession = {
    async collectAuthFormProbe() {
      return {
        site: "example.com",
        pageUrl: "https://example.com/login",
        usernameFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        loginWallDetected: true
      };
    },
    async isAuthenticated() {
      return false;
    },
    async persistStorageState() {
      return null;
    }
  };

  await assert.rejects(
    () =>
      runner.waitForManualLoginAssist({
        session: {
          profile: {
            domain: "example.com"
          },
          startUrl: "https://example.com/login"
        },
        sessionId: "qa-stop",
        browserSession,
        sessionStore,
        emitSessionUpdate: () => {},
        runConfig: {
          profileTag: "functional-local",
          functional: {
            loginAssist: {
              enabled: true,
              timeoutMs: 180000,
              resumeStrategy: "restart-flow"
            }
          }
        },
        step: 1,
        flow: null,
        action: null,
        shouldStop: () => true
      }),
    (error) => {
      assert.equal(error?.code, "RUN_STOPPED");
      return true;
    }
  );
});
