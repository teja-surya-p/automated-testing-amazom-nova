import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAuthAssistStateFromProbe,
  detectAuthStepAdvance,
  inferAuthVisibleStep,
  isAuthAssistReadyToResume,
  mergeDerivedAuthAssistState
} from "../../../services/authAssistState.js";

test("inferAuthVisibleStep prefers visible actionable fields over hidden stale fields", () => {
  const step = inferAuthVisibleStep({
    usernameFieldPresentCount: 1,
    usernameFieldDetected: false,
    passwordFieldPresentCount: 1,
    passwordFieldDetected: true,
    loginWallDetected: true
  });

  assert.equal(step, "password");
});

test("inferAuthVisibleStep treats custom identifier + password as credentials", () => {
  const step = inferAuthVisibleStep({
    usernameFieldDetected: false,
    identifierFieldDetected: true,
    identifierFieldVisibleCount: 1,
    passwordFieldDetected: true,
    passwordFieldVisibleCount: 1,
    loginWallDetected: true
  });

  assert.equal(step, "credentials");
});

test("detectAuthStepAdvance reports username to password progression", () => {
  const progression = detectAuthStepAdvance(
    {
      pageUrl: "https://example.com/login",
      visibleStep: "username",
      usernameFieldDetected: true,
      passwordFieldDetected: false
    },
    {
      pageUrl: "https://example.com/login/password",
      visibleStep: "password",
      usernameFieldDetected: false,
      passwordFieldDetected: true
    },
    {
      submitTriggered: true
    }
  );

  assert.equal(progression.advanced, true);
  assert.equal(progression.fromStep, "username");
  assert.equal(progression.toStep, "password");
});

test("deriveAuthAssistStateFromProbe returns awaiting_password when step advanced", () => {
  const state = deriveAuthAssistStateFromProbe(
    {
      pageUrl: "https://example.com/login/password",
      loginWallDetected: true,
      usernameFieldDetected: false,
      passwordFieldDetected: true,
      visibleStep: "password"
    },
    {
      previousProbe: {
        pageUrl: "https://example.com/login",
        loginWallDetected: true,
        usernameFieldDetected: true,
        passwordFieldDetected: false,
        visibleStep: "username"
      },
      submission: {
        submitTriggered: true
      }
    }
  );

  assert.equal(state.state, "awaiting_password");
  assert.equal(state.code, "AUTH_STEP_ADVANCED");
});

test("deriveAuthAssistStateFromProbe returns INVALID_CREDENTIALS only for explicit error without progression", () => {
  const state = deriveAuthAssistStateFromProbe(
    {
      pageUrl: "https://example.com/login",
      loginWallDetected: true,
      usernameFieldDetected: false,
      passwordFieldDetected: true,
      visibleStep: "password",
      invalidCredentialErrorDetected: true,
      invalidCredentialReason: "Invalid username or password."
    },
    {
      previousProbe: {
        pageUrl: "https://example.com/login",
        loginWallDetected: true,
        usernameFieldDetected: false,
        passwordFieldDetected: true,
        visibleStep: "password"
      },
      submission: {
        submitTriggered: true
      }
    }
  );

  assert.equal(state.state, "auth_failed");
  assert.equal(state.code, "INVALID_CREDENTIALS");
});

test("deriveAuthAssistStateFromProbe does not mark auth_failed without explicit invalid evidence", () => {
  const state = deriveAuthAssistStateFromProbe(
    {
      pageUrl: "https://example.com/login",
      loginWallDetected: true,
      usernameFieldDetected: false,
      identifierFieldDetected: true,
      passwordFieldDetected: true,
      visibleStep: "credentials",
      invalidCredentialErrorDetected: false
    },
    {
      previousProbe: {
        pageUrl: "https://example.com/login",
        loginWallDetected: true,
        usernameFieldDetected: false,
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        visibleStep: "credentials"
      },
      submission: {
        submitTriggered: true
      }
    }
  );

  assert.notEqual(state.state, "auth_failed");
  assert.equal(state.state, "awaiting_credentials");
});

test("deriveAuthAssistStateFromProbe transitions to awaiting_otp when otp challenge appears", () => {
  const state = deriveAuthAssistStateFromProbe({
    otpChallengeDetected: true,
    otpFieldDetected: true,
    reason: "OTP challenge detected."
  });

  assert.equal(state.state, "awaiting_otp");
  assert.equal(state.code, "OTP_REQUIRED");
});

test("deriveAuthAssistStateFromProbe yields auth_unknown_state when submission triggered but state unclear", () => {
  const state = deriveAuthAssistStateFromProbe(
    {
      pageUrl: "https://example.com/challenge",
      loginWallDetected: false,
      usernameFieldDetected: false,
      passwordFieldDetected: false,
      otpFieldDetected: false,
      visibleStep: "unknown"
    },
    {
      previousProbe: {
        pageUrl: "https://example.com/login",
        loginWallDetected: true,
        visibleStep: "credentials"
      },
      submission: {
        submitTriggered: true
      }
    }
  );

  assert.equal(state.state, "auth_unknown_state");
  assert.equal(state.code, "AUTH_UNKNOWN_STATE");
});

test("deriveAuthAssistStateFromProbe ignores weak identifier-only hints in authenticated context", () => {
  const state = deriveAuthAssistStateFromProbe(
    {
      pageUrl: "https://example.com/dashboard",
      loginWallDetected: false,
      loginWallStrength: "weak",
      usernameFieldDetected: true,
      identifierFieldDetected: true,
      passwordFieldDetected: false,
      otpFieldDetected: false,
      visibleStep: "unknown",
      authenticatedHint: true,
      authenticatedSignalStrength: "strong"
    },
    {
      previousProbe: {
        pageUrl: "https://example.com/dashboard",
        loginWallDetected: false,
        visibleStep: "authenticated"
      },
      submission: {
        submitTriggered: false
      }
    }
  );

  assert.equal(state.state, "authenticated");
  assert.equal(state.code, "AUTH_VALIDATED");
});

test("deriveAuthAssistStateFromProbe does not force login-required from credentials step without field evidence", () => {
  const state = deriveAuthAssistStateFromProbe({
    pageUrl: "https://www.w3schools.com/",
    loginWallDetected: true,
    loginWallStrength: "medium",
    usernameFieldDetected: false,
    identifierFieldDetected: false,
    passwordFieldDetected: false,
    otpFieldDetected: false,
    submitControlDetected: true,
    visibleStep: "credentials",
    inputFields: [],
    authenticatedHint: false
  });

  assert.equal(state.state, "running");
  assert.equal(state.code, "AUTH_NOT_REQUIRED");
});

test("isAuthAssistReadyToResume returns true for authenticated and AUTH_VALIDATED states", () => {
  assert.equal(
    isAuthAssistReadyToResume({
      state: "authenticated",
      code: "AUTH_VALIDATED"
    }),
    true
  );
  assert.equal(
    isAuthAssistReadyToResume({
      state: "awaiting_password",
      code: "AUTH_STEP_ADVANCED"
    }),
    false
  );
});

test("mergeDerivedAuthAssistState preserves api step-advanced state against generic probe fallback", () => {
  const merged = mergeDerivedAuthAssistState({
    currentAuthAssist: {
      state: "awaiting_password",
      code: "AUTH_STEP_ADVANCED",
      source: "api",
      reason: "Password entry is required."
    },
    derivedState: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: "Login required."
    }
  });

  assert.equal(merged.state, "awaiting_password");
  assert.equal(merged.code, "AUTH_STEP_ADVANCED");
  assert.equal(merged.reason, "Password entry is required.");
});

test("mergeDerivedAuthAssistState prevents regression from authenticated to waiting", () => {
  const merged = mergeDerivedAuthAssistState({
    currentAuthAssist: {
      state: "authenticated",
      code: "AUTH_VALIDATED",
      source: "api",
      reason: "Credentials accepted."
    },
    derivedState: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: "Login required."
    }
  });

  assert.equal(merged.state, "authenticated");
  assert.equal(merged.code, "AUTH_VALIDATED");
});

test("mergeDerivedAuthAssistState preserves api submitting state against generic probe fallback", () => {
  const merged = mergeDerivedAuthAssistState({
    currentAuthAssist: {
      state: "submitting_credentials",
      code: "CREDENTIALS_SUBMITTED",
      source: "api",
      reason: "Credentials submitted; waiting for auth transition."
    },
    derivedState: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: "Login required."
    }
  });

  assert.equal(merged.state, "submitting_credentials");
  assert.equal(merged.code, "CREDENTIALS_SUBMITTED");
});

test("mergeDerivedAuthAssistState preserves submitting_input_fields against generic fallback", () => {
  const merged = mergeDerivedAuthAssistState({
    currentAuthAssist: {
      state: "submitting_input_fields",
      code: "AUTH_PENDING_TRANSITION",
      source: "api",
      reason: "Input fields submitted."
    },
    derivedState: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: "Login required."
    }
  });

  assert.equal(merged.state, "submitting_input_fields");
  assert.equal(merged.code, "AUTH_PENDING_TRANSITION");
  assert.equal(merged.reason, "Input fields submitted.");
});
