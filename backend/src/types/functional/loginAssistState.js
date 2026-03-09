export function detectNonLoginUrlWithAuthMarkers(snapshot = {}) {
  const url = String(snapshot?.url ?? "").toLowerCase();
  const body = String(snapshot?.bodyText ?? "").toLowerCase();
  const loginLike = /login|sign[ -]?in|auth|accounts\.google\.com|oauth|sso/.test(url);
  if (loginLike) {
    return false;
  }
  return /sign out|log out|my account|account settings|profile|dashboard|my orders|welcome/.test(body);
}

export function decideLoginAssistTransition({
  enabled = true,
  headless = true,
  elapsedMs = 0,
  timeoutMs = 180_000,
  authenticated = false,
  nonLoginAuthMarker = false,
  captchaDetected = false
} = {}) {
  if (!enabled) {
    return {
      outcome: "BLOCKED",
      code: "LOGIN_ASSIST_DISABLED",
      reason: "Login assist is disabled by functional.loginAssist.enabled."
    };
  }

  if (headless) {
    return {
      outcome: "BLOCKED",
      code: "LOGIN_ASSIST_HEADLESS_UNSUPPORTED",
      reason: "Login assist requires PLAYWRIGHT_HEADLESS=false for manual authentication."
    };
  }

  if (captchaDetected) {
    return {
      outcome: "SOFT_PASS",
      code: "CAPTCHA_BOT_DETECTED",
      reason: "CAPTCHA detected during login assist; run stops safely."
    };
  }

  if (authenticated || nonLoginAuthMarker) {
    return {
      outcome: "RESUME",
      code: "LOGIN_ASSIST_AUTH_VALIDATED",
      reason: "Manual login was detected as completed."
    };
  }

  if (elapsedMs >= timeoutMs) {
    return {
      outcome: "TIMEOUT",
      code: "LOGIN_ASSIST_TIMEOUT",
      reason: "Manual login assist timed out before authentication was detected."
    };
  }

  return {
    outcome: "WAIT",
    code: "LOGIN_ASSIST_WAITING",
    reason: "Waiting for manual login to complete."
  };
}

