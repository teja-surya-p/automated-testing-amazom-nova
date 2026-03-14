import test from "node:test";
import assert from "node:assert/strict";

import {
  decideLoginAssistTransition,
  detectNonLoginUrlWithAuthMarkers
} from "../loginAssistState.js";

test("login assist waits when headless so dashboard auth-assist can continue", () => {
  const result = decideLoginAssistTransition({
    enabled: true,
    headless: true,
    elapsedMs: 0,
    timeoutMs: 180000
  });

  assert.equal(result.outcome, "WAIT");
  assert.equal(result.code, "LOGIN_ASSIST_WAITING");
});

test("login assist resumes when authentication detected", () => {
  const result = decideLoginAssistTransition({
    enabled: true,
    headless: false,
    authenticated: true,
    elapsedMs: 1000,
    timeoutMs: 180000
  });

  assert.equal(result.outcome, "RESUME");
  assert.equal(result.code, "LOGIN_ASSIST_AUTH_VALIDATED");
});

test("login assist times out deterministically", () => {
  const result = decideLoginAssistTransition({
    enabled: true,
    headless: false,
    authenticated: false,
    elapsedMs: 180000,
    timeoutMs: 180000
  });

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.code, "LOGIN_ASSIST_TIMEOUT");
});

test("login assist soft-passes when captcha is detected", () => {
  const result = decideLoginAssistTransition({
    enabled: true,
    headless: false,
    captchaDetected: true,
    elapsedMs: 2000,
    timeoutMs: 180000
  });

  assert.equal(result.outcome, "SOFT_PASS");
  assert.equal(result.code, "CAPTCHA_BOT_DETECTED");
});

test("auth marker detector requires non-login URL plus authenticated markers", () => {
  const falsePositive = detectNonLoginUrlWithAuthMarkers({
    url: "https://accounts.google.com/signin/v2/identifier",
    bodyText: "My account"
  });
  const truePositive = detectNonLoginUrlWithAuthMarkers({
    url: "https://example.com/dashboard",
    bodyText: "Welcome back. Sign out"
  });

  assert.equal(falsePositive, false);
  assert.equal(truePositive, true);
});
