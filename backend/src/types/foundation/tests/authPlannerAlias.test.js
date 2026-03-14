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

test("submitAuthInputFields maps non-standard first-field keys to detected identifier field", async () => {
  const session = new BrowserSession("qa-auth-input-fields-mapping", {
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      }
    }
  });

  const probe = {
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
    visibleStep: "credentials",
    reason: "Identifier and password fields are visible on the same step."
  };

  let capturedEntries = [];
  session.page = {
    async evaluate(_fn, payload) {
      capturedEntries = Array.isArray(payload?.entries) ? payload.entries : [];
      return {
        ok: true,
        code: "INPUT_FIELDS_SUBMITTED",
        reason: "Input fields were entered and submission was triggered.",
        inputFieldsConsumed: true,
        fillExecutionAttempted: true,
        fillExecutionSucceeded: true,
        fieldTargetsResolvedCount: capturedEntries.length,
        fieldTargetsFilledCount: capturedEntries.length,
        fieldTargetsVerifiedCount: capturedEntries.length,
        focusedFieldKeys: capturedEntries.map((entry) => entry.key),
        identifierFilled: true,
        usernameFilled: true,
        passwordFilled: true,
        submitTriggered: true,
        submitControlResolved: true,
        submitControlType: "control-click",
        submitControlDetected: true,
        selectedControlLabel: "Sign In",
        explicitInvalidCredentialErrorDetected: false,
        fieldResults: capturedEntries.map((entry) => ({
          key: entry.key,
          kind: entry.kind,
          secret: Boolean(entry.secret),
          resolved: true,
          filled: true,
          verified: true
        }))
      };
    },
    async waitForTimeout() {}
  };
  session.waitForUIReady = async () => {};
  session.collectAuthFormProbe = async () => probe;
  session.collectAuthInteractionContext = async () => ({
    pageUrl: probe.pageUrl,
    stepHint: "credentials",
    fields: [
      {
        primarySelector: "#access-key",
        fallbackSelector: "input[name='accessKey']",
        label: "Access Key",
        placeholder: "Enter your access key",
        name: "access_key",
        inputType: "text",
        actionable: true,
        visible: true,
        enabled: true,
        readOnly: false,
        inViewport: true,
        formSelector: "#login-form",
        sameFormHasPassword: true,
        sameFormHasSubmitControl: true,
        top: 20,
        left: 12
      },
      {
        primarySelector: "#password",
        fallbackSelector: "input[type='password']",
        label: "Password",
        placeholder: "Password",
        name: "password",
        inputType: "password",
        actionable: true,
        visible: true,
        enabled: true,
        readOnly: false,
        inViewport: true,
        formSelector: "#login-form",
        sameFormHasPassword: true,
        sameFormHasSubmitControl: true,
        top: 48,
        left: 12
      }
    ],
    controls: [
      {
        label: "Sign In",
        type: "submit",
        actionable: true,
        visible: true,
        enabled: true,
        inViewport: true,
        isSubmitLike: true,
        formSelector: "#login-form",
        top: 80,
        left: 12
      }
    ],
    identifierFieldDetected: true,
    usernameFieldDetected: true,
    passwordFieldDetected: true,
    submitControlDetected: true,
    identifierFieldVisibleCount: 1,
    usernameFieldVisibleCount: 1,
    passwordFieldVisibleCount: 1,
    identifierLabelCandidates: ["Access Key"]
  });
  session.settleAfterAuthSubmission = async () => {};
  session.waitForAuthTransition = async ({ previousProbe }) => previousProbe;
  session.isAuthenticated = async () => false;

  const result = await session.submitAuthInputFields({
    inputFields: {
      enter_your_access_key: "AK-123",
      password: "PW-123"
    }
  });

  assert.equal(capturedEntries.length, 2);
  const accessKeyEntry = capturedEntries.find((entry) => entry.key === "access_key");
  const passwordEntry = capturedEntries.find((entry) => entry.key === "password");
  assert.equal(accessKeyEntry?.value, "AK-123");
  assert.equal(passwordEntry?.value, "PW-123");
  assert.equal(result.submitTriggered, true);
  assert.notEqual(result.code, "AUTH_SUBMIT_NOT_TRIGGERED");
});

test("submitAuthInputFields captures viewer-visible fill and submit diagnostics", async () => {
  const session = new BrowserSession("qa-auth-input-fields-viewer-diagnostics", {
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      }
    }
  });

  const probe = {
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
    visibleStep: "credentials",
    reason: "Identifier and password fields are visible on the same step."
  };

  const stages = [];
  session.page = {
    url() {
      return "https://example.com/login";
    },
    async title() {
      return "Sign In";
    },
    async screenshot() {
      return Buffer.from("frame-bytes");
    },
    async evaluate(_fn, payload) {
      stages.push(payload?.stage ?? "unknown");
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      const fieldResults = entries.map((entry) => ({
        key: entry.key,
        kind: entry.kind,
        secret: Boolean(entry.secret),
        actionable: true,
        fillAttempted: true,
        resolved: true,
        filled: true,
        verified: true,
        valuePresentAfterFill: true,
        valueLengthAfterFill: String(entry.value ?? "").length
      }));
      if (payload?.stage === "fill-only") {
        return {
          ok: true,
          code: "INPUT_FIELDS_FILLED",
          reason: "Input fields were entered and verified.",
          inputFieldsConsumed: true,
          fillExecutionAttempted: true,
          fillExecutionSucceeded: true,
          fieldTargetsResolvedCount: entries.length,
          fieldTargetsFilledCount: entries.length,
          fieldTargetsVerifiedCount: entries.length,
          focusedFieldKeys: entries.map((entry) => entry.key),
          identifierFilled: true,
          usernameFilled: true,
          passwordFilled: true,
          submitTriggered: false,
          submitControlResolved: false,
          submitControlType: "none",
          submitControlDetected: false,
          selectedControlLabel: null,
          explicitInvalidCredentialErrorDetected: false,
          fieldResults,
          targetedPageUrl: "https://example.com/login",
          targetedFrameUrl: "https://example.com/login",
          targetedFrameType: "page"
        };
      }
      return {
        ok: true,
        code: "INPUT_FIELDS_SUBMITTED",
        reason: "Input fields were entered and submission was triggered.",
        inputFieldsConsumed: true,
        fillExecutionAttempted: true,
        fillExecutionSucceeded: true,
        fieldTargetsResolvedCount: entries.length,
        fieldTargetsFilledCount: entries.length,
        fieldTargetsVerifiedCount: entries.length,
        focusedFieldKeys: entries.map((entry) => entry.key),
        identifierFilled: true,
        usernameFilled: true,
        passwordFilled: true,
        submitTriggered: true,
        submitControlResolved: true,
        submitControlType: "control-click",
        submitControlDetected: true,
        selectedControlLabel: "Sign In",
        explicitInvalidCredentialErrorDetected: false,
        fieldResults,
        targetedPageUrl: "https://example.com/login",
        targetedFrameUrl: "https://example.com/login",
        targetedFrameType: "page"
      };
    },
    async waitForTimeout() {}
  };
  session.waitForUIReady = async () => {};
  session.collectAuthFormProbe = async () => probe;
  session.collectAuthInteractionContext = async () => ({
    pageUrl: probe.pageUrl,
    stepHint: "credentials",
    fields: [
      {
        primarySelector: "#access-key",
        fallbackSelector: "input[name='accessKey']",
        label: "Access Key",
        placeholder: "Enter your access key",
        name: "access_key",
        inputType: "text",
        actionable: true,
        visible: true,
        enabled: true,
        readOnly: false,
        inViewport: true,
        formSelector: "#login-form",
        sameFormHasPassword: true,
        sameFormHasSubmitControl: true,
        top: 20,
        left: 12
      },
      {
        primarySelector: "#password",
        fallbackSelector: "input[type='password']",
        label: "Password",
        placeholder: "Password",
        name: "password",
        inputType: "password",
        actionable: true,
        visible: true,
        enabled: true,
        readOnly: false,
        inViewport: true,
        formSelector: "#login-form",
        sameFormHasPassword: true,
        sameFormHasSubmitControl: true,
        top: 48,
        left: 12
      }
    ],
    controls: [
      {
        label: "Sign In",
        type: "submit",
        actionable: true,
        visible: true,
        enabled: true,
        inViewport: true,
        isSubmitLike: true,
        formSelector: "#login-form",
        top: 80,
        left: 12
      }
    ],
    identifierFieldDetected: true,
    usernameFieldDetected: true,
    passwordFieldDetected: true,
    submitControlDetected: true,
    identifierFieldVisibleCount: 1,
    usernameFieldVisibleCount: 1,
    passwordFieldVisibleCount: 1,
    identifierLabelCandidates: ["Access Key"]
  });
  session.settleAfterAuthSubmission = async () => {};
  session.waitForAuthTransition = async () => probe;
  session.isAuthenticated = async () => false;

  const result = await session.submitAuthInputFields({
    inputFields: {
      access_key: "AK-123",
      password: "PW-123"
    }
  });

  assert.deepEqual(stages, ["fill-only", "fill-and-submit"]);
  assert.equal(result.submitTriggered, true);
  assert.equal(result.viewerFrameCapturedAfterFill, true);
  assert.equal(result.viewerFrameCapturedAfterSubmit, true);
  assert.equal(result.targetedFrameType, "page");
  assert.equal(result.perField.length, 2);
  assert.equal(result.perField[0].valuePresentAfterFill, true);
  assert.equal(result.perField[1].valueLengthAfterFill, 6);
});

test("submitAuthInputFields fallback targets iframe fields when top-page resolution fails", async () => {
  const session = new BrowserSession("qa-auth-input-fields-iframe-fallback", {
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      }
    }
  });

  const probe = {
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
    visibleStep: "credentials",
    reason: "Identifier and password fields are visible on the same step."
  };

  function createLocator(active = false) {
    return {
      _active: active,
      _value: "",
      first() {
        return this;
      },
      locator() {
        return this;
      },
      async count() {
        return this._active ? 1 : 0;
      },
      async isVisible() {
        return this._active;
      },
      async isDisabled() {
        return false;
      },
      async evaluate(_fn, expected) {
        if (!this._active) {
          return false;
        }
        if (typeof expected === "string") {
          return String(this._value) === String(expected);
        }
        return false;
      },
      async focus() {},
      async fill(value) {
        this._value = String(value ?? "");
      },
      async click() {},
      async press() {}
    };
  }

  const inactiveLocator = createLocator(false);
  const activeLocator = createLocator(true);
  const mainFrame = {
    url() {
      return "https://example.com/login";
    },
    locator() {
      return inactiveLocator;
    }
  };
  const iframeFrame = {
    url() {
      return "https://auth.example.com/embedded-login";
    },
    locator() {
      return activeLocator;
    }
  };

  session.page = {
    url() {
      return "https://example.com/login";
    },
    async title() {
      return "Sign In";
    },
    async screenshot() {
      return Buffer.from("frame");
    },
    mainFrame() {
      return mainFrame;
    },
    frames() {
      return [mainFrame, iframeFrame];
    },
    keyboard: {
      async press() {},
      async type() {}
    },
    async evaluate(_fn, payload) {
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      return {
        ok: false,
        code: "AUTH_FILL_BLOCKED",
        reason: "Detected input fields could not be filled for this step.",
        inputFieldsConsumed: true,
        fillExecutionAttempted: true,
        fillExecutionSucceeded: false,
        fieldTargetsResolvedCount: 0,
        fieldTargetsFilledCount: 0,
        fieldTargetsVerifiedCount: 0,
        focusedFieldKeys: [],
        identifierFilled: false,
        usernameFilled: false,
        passwordFilled: false,
        submitTriggered: false,
        submitControlResolved: false,
        submitControlType: "none",
        submitControlDetected: false,
        selectedControlLabel: null,
        explicitInvalidCredentialErrorDetected: false,
        fieldResults: entries.map((entry) => ({
          key: entry.key,
          kind: entry.kind,
          secret: Boolean(entry.secret),
          actionable: false,
          fillAttempted: false,
          resolved: false,
          filled: false,
          verified: false,
          valuePresentAfterFill: false,
          valueLengthAfterFill: 0
        })),
        targetedPageUrl: "https://example.com/login",
        targetedFrameUrl: "https://example.com/login",
        targetedFrameType: "page"
      };
    },
    async waitForTimeout() {}
  };
  session.waitForUIReady = async () => {};
  session.collectAuthFormProbe = async () => probe;
  session.collectAuthInteractionContext = async () => ({
    pageUrl: probe.pageUrl,
    stepHint: "credentials",
    fields: [
      {
        primarySelector: "#access-key",
        fallbackSelector: "input[name='accessKey']",
        label: "Access Key",
        placeholder: "Enter your access key",
        name: "access_key",
        inputType: "text",
        actionable: true,
        visible: true,
        enabled: true,
        readOnly: false,
        inViewport: true,
        formSelector: "#login-form",
        sameFormHasPassword: true,
        sameFormHasSubmitControl: true,
        top: 20,
        left: 12
      },
      {
        primarySelector: "#password",
        fallbackSelector: "input[type='password']",
        label: "Password",
        placeholder: "Password",
        name: "password",
        inputType: "password",
        actionable: true,
        visible: true,
        enabled: true,
        readOnly: false,
        inViewport: true,
        formSelector: "#login-form",
        sameFormHasPassword: true,
        sameFormHasSubmitControl: true,
        top: 48,
        left: 12
      }
    ],
    controls: [
      {
        label: "Sign In",
        type: "submit",
        actionable: true,
        visible: true,
        enabled: true,
        inViewport: true,
        isSubmitLike: true,
        formSelector: "#login-form",
        top: 80,
        left: 12
      }
    ],
    identifierFieldDetected: true,
    usernameFieldDetected: true,
    passwordFieldDetected: true,
    submitControlDetected: true,
    identifierFieldVisibleCount: 1,
    usernameFieldVisibleCount: 1,
    passwordFieldVisibleCount: 1,
    identifierLabelCandidates: ["Access Key"]
  });
  session.settleAfterAuthSubmission = async () => {};
  session.waitForAuthTransition = async () => probe;
  session.isAuthenticated = async () => false;

  const result = await session.submitAuthInputFields({
    inputFields: {
      access_key: "AK-123",
      password: "PW-123"
    }
  });

  assert.equal(result.submitTriggered, true);
  assert.equal(result.targetedFrameType, "iframe");
  assert.equal(result.targetedFrameUrl, "https://auth.example.com/embedded-login");
  assert.equal(result.fieldTargetsVerifiedCount, 2);
});
