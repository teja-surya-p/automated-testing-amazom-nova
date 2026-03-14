import test from "node:test";
import assert from "node:assert/strict";

import {
  canTerminateAllRuns,
  canShowStopButton,
  deriveAuthAssistUiState,
  isRunActive
} from "../../../../../frontend/src/lib/runState.js";

test("stop button is visible only for active run states", () => {
  assert.equal(isRunActive("running"), true);
  assert.equal(isRunActive("login-assist"), true);
  assert.equal(isRunActive("cancelling"), true);
  assert.equal(isRunActive("passed"), false);
  assert.equal(isRunActive("cancelled"), false);

  assert.equal(canShowStopButton("running"), true);
  assert.equal(canShowStopButton("queued"), true);
  assert.equal(canShowStopButton("login-assist"), true);
  assert.equal(canShowStopButton("cancelling"), false);
  assert.equal(canShowStopButton("cancelled"), false);
  assert.equal(canShowStopButton("failed"), false);

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

test("auth assist panel visibility supports functionality login state", () => {
  const uiState = deriveAuthAssistUiState({
    status: "login-assist",
    authAssist: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: "Login required."
    }
  });

  assert.equal(uiState.showAuthAssistPanel, true);
  assert.equal(uiState.credentialsPending, true);
  assert.equal(uiState.otpPending, false);
});
