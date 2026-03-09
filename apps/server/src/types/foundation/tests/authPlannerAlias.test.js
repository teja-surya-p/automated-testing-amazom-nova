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
