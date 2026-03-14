import test from "node:test";
import assert from "node:assert/strict";

import { FunctionalRunner, aggregateFunctionalRunnerResult } from "../functionalRunner.js";
import { config } from "../../../lib/config.js";

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

test("waitForManualLoginAssist enters resumable auth-assist state in headless mode", async () => {
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {}
  });

  const originalHeadless = config.headless;
  const originalPollMs = config.loginAssistPollMs;
  config.headless = true;
  config.loginAssistPollMs = 1;

  const state = {
    session: {
      status: "running",
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
    page: {
      url() {
        return "https://example.com/login";
      }
    },
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

  let stopChecks = 0;
  const shouldStop = () => {
    stopChecks += 1;
    return stopChecks > 4;
  };

  try {
    await assert.rejects(
      () =>
        runner.waitForManualLoginAssist({
          session: {
            profile: {
              domain: "example.com"
            },
            startUrl: "https://example.com/login",
            currentUrl: "https://example.com/login"
          },
          sessionId: "qa-headless-login-assist",
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
          shouldStop
        }),
      (error) => {
        assert.equal(error?.code, "RUN_STOPPED");
        return true;
      }
    );

    assert.equal(state.session.status, "login-assist");
    assert.equal(state.session.authAssist?.state, "awaiting_credentials");
    assert.equal(state.session.authAssist?.code, "LOGIN_REQUIRED");
    assert.equal(state.session.authAssist?.form?.usernameFieldDetected, true);
    assert.equal(state.session.authAssist?.form?.passwordFieldDetected, true);
  } finally {
    config.headless = originalHeadless;
    config.loginAssistPollMs = originalPollMs;
  }
});

test("waitForManualLoginAssist bypasses when live probe has no credential wall evidence", async () => {
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
      status: "running",
      currentUrl: "https://www.w3schools.com/",
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
    },
    appendAgentActivity() {
      return null;
    }
  };

  const browserSession = {
    page: {
      url() {
        return "https://www.w3schools.com/";
      }
    },
    async collectAuthFormProbe() {
      return {
        site: "www.w3schools.com",
        pageUrl: "https://www.w3schools.com/",
        loginWallDetected: false,
        loginWallStrength: "none",
        authIntentDetected: false,
        otpChallengeDetected: false,
        captchaDetected: false,
        identifierFieldDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        otpFieldDetected: false,
        submitControlDetected: true,
        visibleStep: "unknown",
        reason: "No strong authentication wall detected."
      };
    }
  };

  const result = await runner.waitForManualLoginAssist({
    session: {
      profile: {
        domain: "www.w3schools.com"
      },
      startUrl: "https://www.w3schools.com/",
      currentUrl: "https://www.w3schools.com/"
    },
    sessionId: "qa-headless-login-assist-bypass",
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
    shouldStop: () => false
  });

  assert.equal(result.status, "resumed");
  assert.equal(result.code, "LOGIN_ASSIST_NOT_REQUIRED");
  assert.equal(state.session.status, "running");
  assert.equal(state.session.authAssist?.code, "AUTH_NOT_REQUIRED");
});

test("functional run enters login-assist when a visible credential form is detected", async () => {
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {
      async classify() {
        return {
          pageState: "READY",
          confidence: 0.88,
          rationale: "No blocking state detected."
        };
      }
    }
  });
  runner.waitForFormAssist = async () => ({
    status: "not_applicable",
    snapshot: null
  });

  const originalPollMs = config.loginAssistPollMs;
  config.loginAssistPollMs = 1;

  const runConfig = {
    testMode: "functional",
    startUrl: "https://example.com/login",
    goal: "Validate authenticated functionality flow",
    profileTag: "functional-local",
    functional: {
      strategy: "smoke-pack",
      maxFlows: 1,
      maxStepsPerFlow: 1,
      checkIds: ["LOGIN_VISIBLE_VALIDATION_ONLY"],
      loginAssist: {
        enabled: true,
        timeoutMs: 180000,
        resumeStrategy: "restart-flow"
      },
      assertions: {},
      contracts: {}
    },
    budgets: {
      timeBudgetMs: 60_000
    }
  };

  const state = {
    session: {
      id: "qa-functional-login",
      status: "running",
      goal: runConfig.goal,
      startUrl: runConfig.startUrl,
      currentUrl: runConfig.startUrl,
      currentStep: 0,
      frame: null,
      runConfig,
      profile: {
        domain: "example.com"
      },
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
    },
    appendObservation() {
      return null;
    }
  };

  const loginSnapshot = {
    url: "https://example.com/login",
    title: "Sign in",
    bodyText: "Sign in with your email and password to continue.",
    screenshotBase64: "YmFzZTY0",
    overlays: [],
    semanticMap: [],
    interactive: [
      {
        elementId: "login-submit",
        selector: "form#login button[type='submit']",
        tag: "button",
        text: "Sign in",
        inViewport: true,
        disabled: false
      }
    ],
    formControls: [
      {
        selector: "form#login input[name='email']",
        tag: "input",
        type: "email",
        name: "email",
        labelText: "Email address",
        inViewport: true
      },
      {
        selector: "form#login input[name='password']",
        tag: "input",
        type: "password",
        name: "password",
        labelText: "Password",
        inViewport: true
      }
    ],
    consoleErrors: [],
    networkSummary: {}
  };

  const browserSession = {
    async capture() {
      return loginSnapshot;
    },
    getArtifactIndex() {
      return {};
    },
    page: {
      url() {
        return "https://example.com/login";
      }
    },
    async collectAuthFormProbe() {
      return {
        site: "example.com",
        pageUrl: "https://example.com/login",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        reason: "Credential form visible."
      };
    },
    async isAuthenticated() {
      return false;
    },
    async persistStorageState() {
      return null;
    }
  };

  let stopChecks = 0;
  const shouldStop = () => {
    stopChecks += 1;
    return stopChecks > 6;
  };

  try {
    await assert.rejects(
      () =>
        runner.run({
          session: state.session,
          runConfig,
          browserSession,
          sessionStore,
          sessionId: state.session.id,
          testCaseTracker: null,
          emit: () => {},
          emitSessionUpdate: () => {},
          sessionStartAt: Date.now(),
          shouldStop
        }),
      (error) => {
        assert.equal(error?.code, "RUN_STOPPED");
        return true;
      }
    );

    assert.equal(state.session.status, "login-assist");
    assert.equal(state.session.runConfig?.testMode, "functional");
    assert.equal(state.session.authAssist?.state, "awaiting_credentials");
    assert.equal(state.session.authAssist?.code, "LOGIN_REQUIRED");
    assert.equal(state.session.authAssist?.form?.usernameFieldDetected, true);
    assert.equal(state.session.authAssist?.form?.passwordFieldDetected, true);
    assert.equal(
      ["passed", "failed", "soft-passed", "cancelled"].includes(state.session.status),
      false
    );
  } finally {
    config.loginAssistPollMs = originalPollMs;
  }
});

test("functional run does not re-enter login-assist for weak identifier-only probes after auth", async () => {
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {
      async classify() {
        return {
          pageState: "READY",
          confidence: 0.9,
          rationale: "No blocking state detected."
        };
      }
    }
  });

  let loginAssistInvoked = false;
  runner.waitForManualLoginAssist = async () => {
    loginAssistInvoked = true;
    throw new Error("waitForManualLoginAssist should not be called for weak identifier-only probes.");
  };
  runner.waitForFormAssist = async () => ({
    status: "not_applicable",
    snapshot: null
  });
  runner.waitForVerificationAssist = async () => ({
    status: "resolved",
    decisions: []
  });

  const runConfig = {
    testMode: "functional",
    startUrl: "https://example.com/dashboard",
    goal: "Run authenticated functionality checks",
    profileTag: "functional-local",
    functional: {
      strategy: "smoke-pack",
      maxFlows: 1,
      maxStepsPerFlow: 1,
      checkIds: ["NORMAL_FLOW_VERIFIED"],
      loginAssist: {
        enabled: true,
        timeoutMs: 120_000,
        resumeStrategy: "restart-flow"
      },
      assertions: {},
      contracts: {}
    },
    budgets: {
      timeBudgetMs: 60_000
    }
  };

  const state = {
    session: {
      id: "qa-functional-no-relogin",
      status: "running",
      goal: runConfig.goal,
      startUrl: runConfig.startUrl,
      currentUrl: runConfig.startUrl,
      currentStep: 0,
      frame: null,
      runConfig,
      profile: {
        domain: "example.com"
      },
      loginAssist: null,
      authAssist: {
        state: "authenticated",
        code: "AUTH_VALIDATED",
        source: "api"
      }
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
    },
    appendObservation() {
      return null;
    }
  };

  const authenticatedSnapshot = {
    url: "https://example.com/dashboard",
    title: "Dashboard",
    bodyText: "Welcome back. Search your account activity.",
    screenshotBase64: "ZGFzaGJvYXJk",
    overlays: [],
    semanticMap: [],
    interactive: [
      {
        elementId: "nav-orders",
        selector: "a[href='/orders']",
        tag: "a",
        text: "Orders",
        ariaLabel: "",
        placeholder: "",
        name: "",
        zone: "Header",
        inViewport: true,
        disabled: false,
        href: "https://example.com/orders",
        bounds: { y: 16, viewportY: 16 }
      }
    ],
    formControls: [
      {
        selector: "input[name='account_search']",
        tag: "input",
        type: "text",
        name: "account_search",
        labelText: "Account Search",
        placeholder: "Search account",
        inViewport: true
      }
    ],
    consoleErrors: [],
    networkSummary: {},
    viewportLabel: "desktop"
  };

  const browserSession = {
    async capture() {
      return authenticatedSnapshot;
    },
    async executeAction() {
      return { progressSignals: [] };
    },
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/dashboard",
        site: "example.com",
        loginWallDetected: false,
        loginWallStrength: "weak",
        authIntentDetected: false,
        otpChallengeDetected: false,
        captchaDetected: false,
        identifierFieldDetected: true,
        usernameFieldDetected: true,
        passwordFieldDetected: false,
        otpFieldDetected: false,
        submitControlDetected: false,
        visibleStep: "authenticated",
        authenticatedHint: true,
        authenticatedSignalStrength: "strong",
        reason: "Authenticated dashboard with a generic account search field."
      };
    },
    async isAuthenticated() {
      return true;
    },
    getArtifactIndex() {
      return {};
    }
  };

  const result = await runner.run({
    session: state.session,
    runConfig,
    browserSession,
    sessionStore,
    sessionId: state.session.id,
    testCaseTracker: null,
    emit: () => {},
    emitSessionUpdate: () => {},
    sessionStartAt: Date.now(),
    shouldStop: () => false
  });

  assert.equal(loginAssistInvoked, false);
  assert.equal(result.blockers.some((blocker) => blocker.type === "LOGIN_REQUIRED"), false);
});

test("functional run ignores gatekeeper login-required when probe has no credential evidence", async () => {
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {
      async classify() {
        return {
          pageState: "LOGIN_REQUIRED",
          confidence: 0.9,
          rationale: "Sign-in action detected in navigation."
        };
      }
    }
  });

  let loginAssistInvoked = false;
  runner.waitForManualLoginAssist = async () => {
    loginAssistInvoked = true;
    throw new Error("waitForManualLoginAssist should not run without credential evidence.");
  };
  runner.waitForFormAssist = async () => ({
    status: "not_applicable",
    snapshot: null
  });
  runner.waitForVerificationAssist = async () => ({
    status: "resolved",
    decisions: []
  });

  const runConfig = {
    testMode: "functional",
    startUrl: "https://www.w3schools.com/",
    goal: "Run functionality checks without auth wall.",
    profileTag: "functional-local",
    functional: {
      strategy: "smoke-pack",
      maxFlows: 0,
      maxStepsPerFlow: 1,
      checkIds: ["NORMAL_FLOW_VERIFIED"],
      loginAssist: {
        enabled: true,
        timeoutMs: 120_000,
        resumeStrategy: "restart-flow"
      },
      assertions: {},
      contracts: {}
    },
    budgets: {
      timeBudgetMs: 30_000
    }
  };

  const state = {
    session: {
      id: "qa-functional-no-false-login",
      status: "running",
      goal: runConfig.goal,
      startUrl: runConfig.startUrl,
      currentUrl: runConfig.startUrl,
      currentStep: 0,
      frame: null,
      runConfig,
      profile: {
        domain: "www.w3schools.com"
      },
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
    },
    appendObservation() {
      return null;
    }
  };

  const browserSession = {
    async capture() {
      return {
        url: "https://www.w3schools.com/",
        title: "W3Schools Online Web Tutorials",
        bodyText: "Learn to Code. Search our tutorials.",
        screenshotBase64: "d3NjaG9vbHM=",
        overlays: [],
        semanticMap: [],
        interactive: [
          {
            elementId: "nav-signin",
            selector: "button.signin",
            tag: "button",
            text: "Sign In",
            inViewport: true,
            disabled: false
          }
        ],
        formControls: [
          {
            selector: "input[name='q']",
            tag: "input",
            type: "search",
            name: "q",
            placeholder: "Search our tutorials",
            inViewport: true
          }
        ],
        consoleErrors: [],
        networkSummary: {},
        viewportLabel: "desktop"
      };
    },
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://www.w3schools.com/",
        site: "www.w3schools.com",
        loginWallDetected: false,
        loginWallStrength: "none",
        authIntentDetected: false,
        otpChallengeDetected: false,
        captchaDetected: false,
        identifierFieldDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        otpFieldDetected: false,
        submitControlDetected: true,
        visibleStep: "unknown",
        authenticatedHint: false,
        reason: "No strong authentication wall detected."
      };
    },
    async isAuthenticated() {
      return false;
    },
    getArtifactIndex() {
      return {};
    }
  };

  const result = await runner.run({
    session: state.session,
    runConfig,
    browserSession,
    sessionStore,
    sessionId: state.session.id,
    testCaseTracker: null,
    emit: () => {},
    emitSessionUpdate: () => {},
    sessionStartAt: Date.now(),
    shouldStop: () => false
  });

  assert.equal(loginAssistInvoked, false);
  assert.equal(result.blockers.some((blocker) => blocker.type === "LOGIN_REQUIRED"), false);
  assert.notEqual(state.session.status, "login-assist");
});

test("functional run resumes from non-auth target after login assist instead of looping back to login", async () => {
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {
      async classify() {
        return {
          pageState: "LOGIN_REQUIRED",
          confidence: 0.91,
          rationale: "Protected page requires authentication."
        };
      }
    }
  });

  runner.waitForManualLoginAssist = async () => ({
    status: "resumed",
    code: "LOGIN_ASSIST_AUTH_VALIDATED",
    rationale: "Authentication validated.",
    resumeStrategy: "restart-flow",
    snapshot: {
      url: "http://localhost:3113/dashboard",
      screenshotBase64: "ZGFzaGJvYXJk",
      viewportLabel: "desktop",
      bodyText: "Dashboard",
      interactive: [],
      formControls: [],
      networkSummary: {}
    }
  });

  const runConfig = {
    testMode: "functional",
    startUrl: "http://localhost:3113/login",
    goal: "Run authenticated checks before logout",
    profileTag: "functional-local",
    functional: {
      strategy: "smoke-pack",
      maxFlows: 1,
      maxStepsPerFlow: 1,
      checkIds: ["NORMAL_FLOW_VERIFIED", "LOGOUT_ENDS_SESSION"],
      loginAssist: {
        enabled: true,
        timeoutMs: 60_000,
        resumeStrategy: "restart-flow"
      },
      assertions: {},
      contracts: {}
    },
    budgets: {
      timeBudgetMs: 60_000
    }
  };

  const state = {
    session: {
      id: "qa-functional-auth-resume",
      status: "running",
      goal: runConfig.goal,
      startUrl: runConfig.startUrl,
      currentUrl: runConfig.startUrl,
      currentStep: 0,
      frame: null,
      runConfig,
      profile: {
        domain: "localhost"
      },
      loginAssist: null,
      authAssist: {
        state: "authenticated",
        code: "AUTH_VALIDATED",
        resumeTargetUrl: "http://localhost:3113/dashboard"
      }
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
    },
    appendObservation() {
      return null;
    }
  };

  const gotoUrls = [];
  let captureCount = 0;
  let authProbeCalls = 0;
  const browserSession = {
    async goto(url) {
      gotoUrls.push(url);
      return null;
    },
    async collectAuthFormProbe() {
      return {
        pageUrl: "http://localhost:3113/login",
        site: "localhost",
        loginWallDetected: true,
        loginWallStrength: "strong",
        authIntentDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        identifierFieldDetected: true,
        usernameFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        visibleStep: "credentials",
        reason: "Credential form visible."
      };
    },
    async capture() {
      captureCount += 1;
      if (captureCount === 1) {
        return {
          url: "http://localhost:3113/login",
          title: "Sign in",
          bodyText: "Sign in to continue",
          screenshotBase64: "bG9naW4=",
          overlays: [],
          semanticMap: [],
          interactive: [],
          formControls: [],
          consoleErrors: [],
          networkSummary: {},
          viewportLabel: "desktop"
        };
      }
      return {
        url: "http://localhost:3113/dashboard",
        title: "Dashboard",
        bodyText: "Welcome back",
        screenshotBase64: "ZGFzaGJvYXJk",
        overlays: [],
        semanticMap: [],
        interactive: [],
        formControls: [],
        consoleErrors: [],
        networkSummary: {},
        viewportLabel: "desktop"
      };
    },
    getArtifactIndex() {
      return {};
    }
  };

  const result = await runner.run({
    session: state.session,
    runConfig,
    browserSession,
    sessionStore,
    sessionId: state.session.id,
    testCaseTracker: null,
    emit: () => {},
    emitSessionUpdate: () => {},
    sessionStartAt: Date.now(),
    shouldStop: () => false
  });

  assert.equal(gotoUrls.includes("http://localhost:3113/dashboard"), true);
  assert.equal(gotoUrls.includes("http://localhost:3113/login"), false);
  assert.equal(result.status, "passed");
});

test("logout validation runs only as final stage when LOGOUT_ENDS_SESSION is selected", async () => {
  const actionKinds = [];
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {
      async classify() {
        return {
          pageState: "READY",
          confidence: 0.9,
          rationale: "Ready"
        };
      }
    }
  });
  runner.waitForFormAssist = async () => ({
    status: "not_applicable",
    snapshot: null
  });

  const runConfig = {
    testMode: "functional",
    startUrl: "http://localhost:3113/dashboard",
    goal: "Run authenticated checks and validate logout last",
    profileTag: "functional-local",
    functional: {
      strategy: "smoke-pack",
      maxFlows: 1,
      maxStepsPerFlow: 1,
      checkIds: ["LOGOUT_ENDS_SESSION"],
      loginAssist: {
        enabled: true,
        timeoutMs: 60_000,
        resumeStrategy: "restart-flow"
      },
      assertions: {},
      contracts: {}
    },
    budgets: {
      timeBudgetMs: 60_000
    }
  };

  const state = {
    session: {
      id: "qa-functional-logout-final",
      status: "running",
      goal: runConfig.goal,
      startUrl: runConfig.startUrl,
      currentUrl: runConfig.startUrl,
      currentStep: 0,
      frame: null,
      runConfig,
      profile: {
        domain: "localhost"
      },
      loginAssist: null,
      authAssist: {
        state: "authenticated",
        code: "AUTH_VALIDATED",
        resumeTargetUrl: "http://localhost:3113/dashboard"
      }
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
    },
    appendObservation() {
      return null;
    }
  };

  let captureCount = 0;
  const browserSession = {
    async capture() {
      captureCount += 1;
      if (captureCount === 1) {
        return {
          url: "http://localhost:3113/dashboard",
          title: "Dashboard",
          bodyText: "Welcome back",
          screenshotBase64: "ZGFzaGJvYXJk",
          overlays: [],
          semanticMap: [],
          interactive: [
            {
              elementId: "logout",
              selector: "button#logout",
              tag: "button",
              text: "Logout",
              inViewport: true,
              disabled: false
            }
          ],
          formControls: [],
          consoleErrors: [],
          networkSummary: {},
          viewportLabel: "desktop"
        };
      }
      return {
        url: "http://localhost:3113/login",
        title: "Sign in",
        bodyText: "Sign in to continue",
        screenshotBase64: "bG9naW4=",
        overlays: [],
        semanticMap: [],
        interactive: [],
        formControls: [],
        consoleErrors: [],
        networkSummary: {},
        viewportLabel: "desktop"
      };
    },
    async executeAction(action) {
      actionKinds.push(action.functionalKind ?? action.type);
      return {
        progressSignals: []
      };
    },
    async collectAuthFormProbe() {
      authProbeCalls += 1;
      if (authProbeCalls <= 1) {
        return {
          pageUrl: "http://localhost:3113/dashboard",
          site: "localhost",
          loginWallDetected: false,
          otpChallengeDetected: false,
          identifierFieldDetected: false,
          usernameFieldDetected: false,
          passwordFieldDetected: false,
          otpFieldDetected: false,
          submitControlDetected: false
        };
      }
      return {
        pageUrl: "http://localhost:3113/login",
        site: "localhost",
        loginWallDetected: true,
        otpChallengeDetected: false,
        identifierFieldDetected: true,
        usernameFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true
      };
    },
    async isAuthenticated() {
      return actionKinds.length === 0;
    },
    getArtifactIndex() {
      return {};
    }
  };

  const result = await runner.run({
    session: state.session,
    runConfig,
    browserSession,
    sessionStore,
    sessionId: state.session.id,
    testCaseTracker: null,
    emit: () => {},
    emitSessionUpdate: () => {},
    sessionStartAt: Date.now(),
    shouldStop: () => false
  });

  assert.deepEqual(actionKinds, ["logout"]);
  assert.equal(result.status, "passed");
  assert.equal(result.flows.some((flow) => flow.flowType === "LOGOUT_FINAL_STAGE"), true);
});

test("waitForVerificationAssist prompts when confidence is below 1.0 and waits for decision", async () => {
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
      id: "qa-verify",
      status: "running",
      runConfig: {
        functional: {
          verification: {
            timeoutMs: 60_000
          }
        }
      },
      verificationAssist: null
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
      if (patch?.verificationAssist?.state === "awaiting_user") {
        const prompts = patch.verificationAssist.prompts ?? [];
        state.session.verificationAssist = {
          ...patch.verificationAssist,
          decisions: Object.fromEntries(
            prompts.map((prompt) => [
              prompt.promptId,
              {
                decision: "accept-agent",
                decidedAt: "2026-03-10T00:00:00.000Z"
              }
            ])
          ),
          pendingPromptIds: []
        };
      }
      return state.session;
    },
    appendTimeline() {
      return null;
    }
  };

  const result = await runner.waitForVerificationAssist({
    sessionId: "qa-verify",
    sessionStore,
    emitSessionUpdate: () => {},
    snapshot: {
      url: "https://example.com/checkout"
    },
    step: 3,
    flow: {
      flowId: "flow_checkout"
    },
    assertionResults: [
      {
        ruleId: "CHECKOUT_PAGE_VISIBLE",
        pass: false,
        expected: "Checkout page should be visible",
        actual: "Checkout marker not found",
        confidence: 0.99,
        severity: "P2",
        evidenceRefs: [{ type: "screenshot", ref: "/tmp/step.png" }]
      }
    ]
  });

  assert.equal(result.prompted, 1);
  assert.equal(result.overrides, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.resolvedAssertions.length, 1);
  assert.equal(result.resolvedAssertions[0].confidence, 1);
  assert.equal(result.resolvedAssertions[0].pass, false);
});

test("waitForVerificationAssist skips prompt at confidence 1.0", async () => {
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
      id: "qa-verify-no-prompt",
      status: "running",
      runConfig: {
        functional: {
          verification: {
            timeoutMs: 60_000
          }
        }
      },
      verificationAssist: null
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

  const inputAssertion = {
    ruleId: "URL_CHANGED",
    pass: true,
    expected: "URL should change",
    actual: "URL changed",
    confidence: 1,
    severity: "P3"
  };
  const result = await runner.waitForVerificationAssist({
    sessionId: "qa-verify-no-prompt",
    sessionStore,
    emitSessionUpdate: () => {},
    snapshot: {
      url: "https://example.com/search"
    },
    step: 2,
    flow: {
      flowId: "flow_search"
    },
    assertionResults: [inputAssertion]
  });

  assert.equal(result.prompted, 0);
  assert.equal(result.overrides, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.resolvedAssertions[0], inputAssertion);
  assert.equal(state.session.verificationAssist, null);
});

test("waitForFormAssist supports auto-all decisions and resumes execution", async () => {
  const runner = new FunctionalRunner({
    safetyPolicy: {
      evaluateBeforeAction() {
        return { allowed: true };
      }
    },
    gatekeeper: {}
  });

  const snapshot = {
    url: "https://example.com/signup",
    title: "Create account",
    screenshotBase64: "YmFzZTY0",
    formControls: [
      {
        selector: "form#signup input[name='email']",
        tag: "input",
        type: "email",
        name: "email",
        placeholder: "Email address",
        labelText: "Email",
        requiredAttr: true,
        ariaRequired: false,
        formSelector: "form#signup",
        formName: "Signup",
        nearestHeading: "Create account",
        bounds: {
          x: 24,
          y: 80,
          width: 260,
          height: 34,
          centerX: 154,
          centerY: 97
        }
      }
    ],
    interactive: [
      {
        elementId: "submit-signup",
        selector: "form#signup button[type='submit']",
        tag: "button",
        type: "submit",
        text: "Create account",
        ariaLabel: "Create account",
        placeholder: "",
        name: "",
        disabled: false,
        bounds: {
          x: 24,
          y: 130,
          width: 180,
          height: 36,
          centerX: 114,
          centerY: 148
        }
      }
    ]
  };

  const state = {
    session: {
      id: "qa-form-auto",
      status: "running",
      runConfig: {
        functional: {
          formAssist: {
            timeoutMs: 60_000
          }
        }
      },
      formAssist: null
    }
  };
  const submissions = [];

  const sessionStore = {
    getSession() {
      return state.session;
    },
    patchSession(_sessionId, patch) {
      state.session = {
        ...state.session,
        ...patch
      };
      if (patch?.formAssist?.state === "awaiting_user") {
        state.session.formAssist = {
          ...patch.formAssist,
          globalAction: "auto-all"
        };
      }
      return state.session;
    },
    appendTimeline() {
      return null;
    }
  };

  const browserSession = {
    getArtifactIndex() {
      return {};
    },
    async submitFormAssistGroup(group, decision) {
      submissions.push({
        group,
        decision
      });
      return {
        submitTriggered: true,
        fieldResults: []
      };
    },
    async capture() {
      return {
        ...snapshot,
        url: "https://example.com/signup/confirmation",
        screenshotBase64: "bmV4dA==",
        formControls: [],
        interactive: []
      };
    }
  };

  const result = await runner.waitForFormAssist({
    session: state.session,
    sessionId: "qa-form-auto",
    browserSession,
    sessionStore,
    emitSessionUpdate: () => {},
    snapshot,
    step: 4,
    flow: {
      flowId: "flow_signup"
    }
  });

  assert.equal(result.status, "resolved");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].decision.action, "auto");
  assert.equal(result.snapshot?.url, "https://example.com/signup/confirmation");
});
