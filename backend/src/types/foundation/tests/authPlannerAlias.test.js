import test from "node:test";
import assert from "node:assert/strict";

import { BrowserSession } from "../../../services/browserSession.js";

function makeIdentifierCredentialProbe() {
  return {
    pageUrl: "https://example.com/login",
    site: "example.com",
    loginWallDetected: true,
    otpChallengeDetected: false,
    captchaDetected: false,
    usernameFieldDetected: true,
    identifierFieldDetected: true,
    passwordFieldDetected: true,
    otpFieldDetected: false,
    submitControlDetected: true,
    usernameFieldVisibleCount: 1,
    identifierFieldVisibleCount: 1,
    passwordFieldVisibleCount: 1,
    identifierLabelCandidates: ["Access Key"],
    visibleStep: "password",
    reason: "Identifier and password fields are visible on the same step."
  };
}

test("identifier-style form uses first credential alias, fills fields, and triggers submit", async () => {
  const probe = makeIdentifierCredentialProbe();
  const session = new BrowserSession("qa-auth-planner-alias", {
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      }
    }
  });

  let capturedPlan = null;
  let capturedValues = null;

  session.page = {
    async waitForLoadState() {},
    async waitForTimeout() {}
  };
  session.waitForUIReady = async () => {};
  session.collectAuthFormProbe = async () => probe;
  session.collectAuthInteractionContext = async () => ({
    pageUrl: probe.pageUrl,
    stepHint: "unknown",
    fields: [],
    controls: [],
    identifierFieldDetected: false,
    usernameFieldDetected: false,
    passwordFieldDetected: false,
    submitControlDetected: false,
    identifierFieldVisibleCount: 0,
    usernameFieldVisibleCount: 0,
    passwordFieldVisibleCount: 0,
    identifierLabelCandidates: []
  });
  session.executeCredentialActionPlan = async ({ plan, usernameValue, passwordValue }) => {
    capturedPlan = plan;
    capturedValues = {
      usernameValue,
      passwordValue
    };
    return {
      ok: true,
      code: "CREDENTIALS_SUBMITTED",
      reason: "Credentials were entered and submission was triggered.",
      usernameFilled: true,
      passwordFilled: true,
      identifierFilled: true,
      submitTriggered: true,
      submitControlType: "control-click",
      submitControlDetected: true,
      selectedControlLabel: "Sign In",
      explicitInvalidCredentialErrorDetected: false
    };
  };
  session.settleAfterAuthSubmission = async () => {};
  session.waitForAuthTransition = async () => probe;
  session.isAuthenticated = async () => false;

  const result = await session.submitAuthCredentials({
    username: "access-key-123",
    password: "super-secret-password"
  });

  assert.equal(capturedValues?.usernameValue, "access-key-123");
  assert.equal(capturedPlan?.fillUsername, true);
  assert.equal(capturedPlan?.fillPassword, true);
  assert.equal(result.identifierFilled, true);
  assert.equal(result.passwordFilled, true);
  assert.equal(result.submitTriggered, true);
  assert.notEqual(result.code, "AUTH_SUBMIT_NOT_TRIGGERED");
});

test("submitAuthCredentials retries probe before giving up and executes when fields appear", async () => {
  const hiddenProbe = {
    pageUrl: "https://example.com/login",
    site: "example.com",
    loginWallDetected: true,
    otpChallengeDetected: false,
    captchaDetected: false,
    usernameFieldDetected: false,
    identifierFieldDetected: false,
    passwordFieldDetected: false,
    otpFieldDetected: false,
    submitControlDetected: false,
    usernameFieldVisibleCount: 0,
    identifierFieldVisibleCount: 0,
    passwordFieldVisibleCount: 0,
    identifierLabelCandidates: [],
    visibleStep: "unknown",
    reason: "Login UI is still rendering."
  };
  const visibleProbe = makeIdentifierCredentialProbe();

  const session = new BrowserSession("qa-auth-planner-alias-retry", {
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      }
    }
  });

  let probeCallCount = 0;
  let executeCalled = false;

  session.page = {
    async waitForLoadState() {},
    async waitForTimeout() {}
  };
  session.waitForUIReady = async () => {};
  session.collectAuthFormProbe = async () => {
    probeCallCount += 1;
    if (probeCallCount <= 2) {
      return hiddenProbe;
    }
    return visibleProbe;
  };
  session.collectAuthInteractionContext = async () => ({
    pageUrl: visibleProbe.pageUrl,
    stepHint: "unknown",
    fields: [],
    controls: [],
    identifierFieldDetected: false,
    usernameFieldDetected: false,
    passwordFieldDetected: false,
    submitControlDetected: false,
    identifierFieldVisibleCount: 0,
    usernameFieldVisibleCount: 0,
    passwordFieldVisibleCount: 0,
    identifierLabelCandidates: []
  });
  session.executeCredentialActionPlan = async () => {
    executeCalled = true;
    return {
      ok: true,
      code: "CREDENTIALS_SUBMITTED",
      reason: "Credentials were entered and submission was triggered.",
      usernameFilled: true,
      passwordFilled: true,
      identifierFilled: true,
      submitTriggered: true,
      submitControlType: "control-click",
      submitControlDetected: true,
      selectedControlLabel: "Sign In",
      explicitInvalidCredentialErrorDetected: false
    };
  };
  session.settleAfterAuthSubmission = async () => {};
  session.waitForAuthTransition = async () => visibleProbe;
  session.isAuthenticated = async () => false;

  const result = await session.submitAuthCredentials({
    identifier: "access-key-123",
    password: "super-secret-password"
  });

  assert.equal(executeCalled, true);
  assert.equal(result.submitTriggered, true);
  assert.notEqual(result.code, "AUTH_SUBMIT_NOT_TRIGGERED");
});

test("submitAuthCredentials performs late fallback submit when final probe shows visible credential form", async () => {
  const hiddenProbe = {
    pageUrl: "https://example.com/login",
    site: "example.com",
    loginWallDetected: true,
    otpChallengeDetected: false,
    captchaDetected: false,
    usernameFieldDetected: false,
    identifierFieldDetected: false,
    passwordFieldDetected: false,
    otpFieldDetected: false,
    submitControlDetected: false,
    usernameFieldVisibleCount: 0,
    identifierFieldVisibleCount: 0,
    passwordFieldVisibleCount: 0,
    identifierLabelCandidates: [],
    visibleStep: "unknown",
    reason: "Login UI is still rendering."
  };
  const visibleProbe = makeIdentifierCredentialProbe();

  const session = new BrowserSession("qa-auth-planner-late-fallback", {
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      }
    }
  });

  let probeCallCount = 0;
  let executeCallCount = 0;

  session.page = {
    async waitForLoadState() {},
    async waitForTimeout() {}
  };
  session.waitForUIReady = async () => {};
  session.collectAuthFormProbe = async () => {
    probeCallCount += 1;
    return probeCallCount >= 8 ? visibleProbe : hiddenProbe;
  };
  session.collectAuthInteractionContext = async () => ({
    pageUrl: hiddenProbe.pageUrl,
    stepHint: "unknown",
    fields: [],
    controls: [],
    identifierFieldDetected: false,
    usernameFieldDetected: false,
    passwordFieldDetected: false,
    submitControlDetected: false,
    identifierFieldVisibleCount: 0,
    usernameFieldVisibleCount: 0,
    passwordFieldVisibleCount: 0,
    identifierLabelCandidates: []
  });
  session.executeCredentialActionPlan = async () => {
    executeCallCount += 1;
    return {
      ok: true,
      code: "CREDENTIALS_SUBMITTED",
      reason: "Credentials were entered and submission was triggered.",
      usernameFilled: true,
      passwordFilled: true,
      identifierFilled: true,
      submitTriggered: true,
      submitControlType: "control-click",
      submitControlDetected: true,
      selectedControlLabel: "Sign In",
      explicitInvalidCredentialErrorDetected: false
    };
  };
  session.settleAfterAuthSubmission = async () => {};
  session.waitForAuthTransition = async () => visibleProbe;
  session.isAuthenticated = async () => false;

  const result = await session.submitAuthCredentials({
    identifier: "access-key-123",
    password: "super-secret-password"
  });

  assert.equal(executeCallCount, 1);
  assert.equal(result.submitTriggered, true);
  assert.equal(result.usernameFilled, true);
  assert.equal(result.passwordFilled, true);
  assert.notEqual(result.code, "AUTH_SUBMIT_NOT_TRIGGERED");
});

test("submitAuthCredentials late fallback still executes when credential fields are visible but submit-control signal is missing", async () => {
  const hiddenProbe = {
    pageUrl: "https://example.com/login",
    site: "example.com",
    loginWallDetected: true,
    otpChallengeDetected: false,
    captchaDetected: false,
    usernameFieldDetected: false,
    identifierFieldDetected: false,
    passwordFieldDetected: false,
    otpFieldDetected: false,
    submitControlDetected: false,
    usernameFieldVisibleCount: 0,
    identifierFieldVisibleCount: 0,
    passwordFieldVisibleCount: 0,
    identifierLabelCandidates: [],
    visibleStep: "unknown",
    reason: "Login UI is still rendering."
  };
  const visibleProbeWithoutSubmitSignal = {
    ...makeIdentifierCredentialProbe(),
    submitControlDetected: false
  };

  const session = new BrowserSession("qa-auth-planner-late-fallback-no-submit-signal", {
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      }
    }
  });

  let probeCallCount = 0;
  let executeCallCount = 0;

  session.page = {
    async waitForLoadState() {},
    async waitForTimeout() {}
  };
  session.waitForUIReady = async () => {};
  session.collectAuthFormProbe = async () => {
    probeCallCount += 1;
    return probeCallCount >= 8 ? visibleProbeWithoutSubmitSignal : hiddenProbe;
  };
  session.collectAuthInteractionContext = async () => ({
    pageUrl: hiddenProbe.pageUrl,
    stepHint: "unknown",
    fields: [],
    controls: [],
    identifierFieldDetected: false,
    usernameFieldDetected: false,
    passwordFieldDetected: false,
    submitControlDetected: false,
    identifierFieldVisibleCount: 0,
    usernameFieldVisibleCount: 0,
    passwordFieldVisibleCount: 0,
    identifierLabelCandidates: []
  });
  session.executeCredentialActionPlan = async () => {
    executeCallCount += 1;
    return {
      ok: true,
      code: "CREDENTIALS_SUBMITTED",
      reason: "Credentials were entered and submission was triggered.",
      usernameFilled: true,
      passwordFilled: true,
      identifierFilled: true,
      submitTriggered: true,
      submitControlType: "keyboard-enter",
      submitControlDetected: false,
      selectedControlLabel: "keyboard-enter",
      explicitInvalidCredentialErrorDetected: false
    };
  };
  session.settleAfterAuthSubmission = async () => {};
  session.waitForAuthTransition = async () => visibleProbeWithoutSubmitSignal;
  session.isAuthenticated = async () => false;

  const result = await session.submitAuthCredentials({
    identifier: "access-key-123",
    password: "super-secret-password"
  });

  assert.equal(executeCallCount, 1);
  assert.equal(result.submitTriggered, true);
  assert.equal(result.usernameFilled, true);
  assert.equal(result.passwordFilled, true);
  assert.notEqual(result.code, "AUTH_SUBMIT_NOT_TRIGGERED");
});
