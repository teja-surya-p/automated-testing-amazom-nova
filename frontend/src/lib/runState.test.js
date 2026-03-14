import assert from "node:assert/strict";
import test from "node:test";

import { canTerminateAllRuns, deriveAuthAssistUiState } from "./runState.js";

test("canTerminateAllRuns is true only when active sessions exist", () => {
  assert.equal(
    canTerminateAllRuns([
      { id: "qa_done", status: "passed" },
      { id: "qa_failed", status: "failed" }
    ]),
    false
  );
  assert.equal(
    canTerminateAllRuns([
      { id: "qa_done", status: "passed" },
      { id: "qa_running", status: "running" }
    ]),
    true
  );
});

test("deriveAuthAssistUiState shows credential panel for functionality login-assist state", () => {
  const session = {
    status: "login-assist",
    runConfig: {
      testMode: "functional"
    },
    authAssist: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED"
    }
  };

  const uiState = deriveAuthAssistUiState({
    status: session.status,
    authAssist: session.authAssist
  });

  assert.equal(uiState.credentialsPending, true);
  assert.equal(uiState.otpPending, false);
  assert.equal(uiState.showAuthAssistPanel, true);
});

test("deriveAuthAssistUiState treats awaiting_input_fields as credential-pending", () => {
  const uiState = deriveAuthAssistUiState({
    status: "login-assist",
    authAssist: {
      state: "awaiting_input_fields",
      code: "LOGIN_REQUIRED"
    }
  });

  assert.equal(uiState.credentialsPending, true);
  assert.equal(uiState.otpPending, false);
  assert.equal(uiState.showAuthAssistPanel, true);
});

test("deriveAuthAssistUiState shows otp panel when otp is required", () => {
  const uiState = deriveAuthAssistUiState({
    status: "login-assist",
    authAssist: {
      state: "awaiting_otp",
      code: "OTP_REQUIRED"
    }
  });

  assert.equal(uiState.credentialsPending, false);
  assert.equal(uiState.otpPending, true);
  assert.equal(uiState.showAuthAssistPanel, true);
});
