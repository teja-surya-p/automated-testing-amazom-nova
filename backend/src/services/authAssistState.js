function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLower(value = "") {
  return normalizeText(value).toLowerCase();
}

function hasStepChanged(previousStep, nextStep) {
  const prev = normalizeLower(previousStep);
  const next = normalizeLower(nextStep);
  if (!prev || !next) {
    return false;
  }
  return prev !== next;
}

function hasUrlPathChanged(previousUrl, nextUrl) {
  try {
    const previous = new URL(String(previousUrl ?? ""));
    const next = new URL(String(nextUrl ?? ""));
    return `${previous.origin}${previous.pathname}` !== `${next.origin}${next.pathname}`;
  } catch {
    return false;
  }
}

const AUTH_ASSIST_RESUME_STATES = new Set(["authenticated", "resumed"]);
const AUTH_ASSIST_INTERMEDIATE_STATES = new Set([
  "awaiting_username",
  "awaiting_password",
  "awaiting_otp",
  "auth_step_advanced",
  "submitting_credentials",
  "submitting_otp"
]);
const AUTH_ASSIST_EXPLICIT_FAILURE_CODES = new Set([
  "INVALID_CREDENTIALS",
  "CAPTCHA_BOT_DETECTED",
  "OTP_INVALID",
  "LOGIN_ASSIST_TIMEOUT",
  "LOGIN_SKIPPED"
]);

export function inferAuthVisibleStep(probe = {}) {
  const explicit = normalizeLower(probe.visibleStep);
  if (explicit) {
    if (["username", "password", "otp", "credentials"].includes(explicit)) {
      return explicit;
    }
    if (explicit === "authenticated") {
      return "authenticated";
    }
  }

  if (probe.otpFieldDetected || probe.otpChallengeDetected) {
    return "otp";
  }
  const identifierDetected =
    Boolean(probe.usernameFieldDetected) ||
    Boolean(probe.identifierFieldDetected) ||
    Number(probe.usernameFieldVisibleCount ?? 0) > 0 ||
    Number(probe.identifierFieldVisibleCount ?? 0) > 0;
  if (identifierDetected && probe.passwordFieldDetected) {
    return "credentials";
  }
  if (probe.passwordFieldDetected) {
    return "password";
  }
  if (identifierDetected) {
    return "username";
  }
  if (probe.loginWallDetected) {
    return "credentials";
  }
  return "unknown";
}

export function isAuthAssistReadyToResume(authAssist = {}) {
  const state = normalizeLower(authAssist?.state);
  const code = normalizeLower(authAssist?.code);
  return AUTH_ASSIST_RESUME_STATES.has(state) || code === "auth_validated";
}

export function isAuthAssistSkipRequested(authAssist = {}) {
  const state = normalizeLower(authAssist?.state);
  const code = normalizeLower(authAssist?.code);
  return state === "auth_skipped" || state === "skipped" || code === "login_skipped";
}

export function detectAuthStepAdvance(previousProbe = {}, nextProbe = {}, submission = {}) {
  const fromStep = inferAuthVisibleStep(previousProbe);
  const toStep = inferAuthVisibleStep(nextProbe);

  if (toStep === "authenticated") {
    return {
      advanced: true,
      fromStep,
      toStep,
      reason: "Authentication markers became visible."
    };
  }

  const fromStepKnown = fromStep && fromStep !== "unknown";
  const toStepKnown = toStep && toStep !== "unknown";
  if (fromStepKnown && toStepKnown && hasStepChanged(fromStep, toStep)) {
    return {
      advanced: true,
      fromStep,
      toStep,
      reason: `Auth step changed from ${fromStep} to ${toStep}.`
    };
  }

  if (
    submission.submitTriggered &&
    hasUrlPathChanged(previousProbe.pageUrl, nextProbe.pageUrl) &&
    (nextProbe.loginWallDetected || nextProbe.otpChallengeDetected || nextProbe.passwordFieldDetected)
  ) {
    return {
      advanced: true,
      fromStep,
      toStep,
      reason: "Auth URL changed after submission while remaining in gated flow."
    };
  }

  if (
    submission.submitTriggered &&
    previousProbe.submitControlDetected &&
    nextProbe.submitControlDetected &&
    previousProbe.reason !== nextProbe.reason &&
    nextProbe.loginWallDetected
  ) {
    return {
      advanced: true,
      fromStep,
      toStep,
      reason: "Visible auth prompt changed after submission."
    };
  }

  return {
    advanced: false,
    fromStep,
    toStep,
    reason: "No deterministic auth-step progression signal detected."
  };
}

export function mergeDerivedAuthAssistState({
  currentAuthAssist = null,
  derivedState = null
} = {}) {
  if (!derivedState || typeof derivedState !== "object") {
    return derivedState;
  }

  if (!currentAuthAssist || typeof currentAuthAssist !== "object") {
    return derivedState;
  }

  if (isAuthAssistSkipRequested(currentAuthAssist)) {
    return {
      ...derivedState,
      state: currentAuthAssist.state ?? "auth_failed",
      code: currentAuthAssist.code ?? "LOGIN_SKIPPED",
      reason: currentAuthAssist.reason ?? derivedState.reason
    };
  }

  if (isAuthAssistReadyToResume(currentAuthAssist)) {
    return {
      ...derivedState,
      state: currentAuthAssist.state ?? "resumed",
      code: currentAuthAssist.code ?? "AUTH_VALIDATED",
      reason: currentAuthAssist.reason ?? derivedState.reason
    };
  }

  const currentState = normalizeLower(currentAuthAssist.state);
  const currentCode = normalizeLower(currentAuthAssist.code);
  const currentSource = normalizeLower(currentAuthAssist.source);
  const derivedCode = normalizeLower(derivedState.code);
  const derivedStateName = normalizeLower(derivedState.state);

  const derivedCodeUpper = String(derivedState.code ?? "").toUpperCase();
  if (AUTH_ASSIST_EXPLICIT_FAILURE_CODES.has(derivedCodeUpper)) {
    return derivedState;
  }

  const preserveOtpState =
    currentSource === "api" &&
    currentCode === "otp_required" &&
    derivedStateName !== "awaiting_otp" &&
    !AUTH_ASSIST_EXPLICIT_FAILURE_CODES.has(derivedCodeUpper);

  const derivedGenericState = ["awaiting_credentials", "auth_unknown_state", "running"].includes(
    derivedStateName
  );
  const derivedGenericCode = ["login_required", "auth_not_required", "auth_unknown_state"].includes(derivedCode);
  const preserveIntermediateState =
    currentSource === "api" &&
    AUTH_ASSIST_INTERMEDIATE_STATES.has(currentState) &&
    (derivedGenericState || derivedGenericCode);

  if (preserveOtpState || preserveIntermediateState) {
    return {
      ...derivedState,
      state: currentAuthAssist.state ?? derivedState.state,
      code: currentAuthAssist.code ?? derivedState.code,
      reason: currentAuthAssist.reason ?? derivedState.reason
    };
  }

  return derivedState;
}

export function deriveAuthAssistStateFromProbe(probe = {}, context = {}) {
  const previousProbe = context.previousProbe ?? null;
  const submission = context.submission ?? null;
  const visibleStep = inferAuthVisibleStep(probe);
  const progression = detectAuthStepAdvance(previousProbe ?? {}, probe, submission ?? {});
  const explicitInvalid =
    Boolean(probe.invalidCredentialErrorDetected) ||
    Boolean(probe.invalidPasswordErrorDetected) ||
    Boolean(submission?.explicitInvalidCredentialErrorDetected);

  if (probe?.captchaDetected) {
    return {
      state: "auth_failed",
      code: "CAPTCHA_BOT_DETECTED",
      reason: "CAPTCHA challenge detected. Manual challenge completion is required."
    };
  }

  if (probe?.otpChallengeDetected || probe?.otpFieldDetected || visibleStep === "otp") {
    return {
      state: "awaiting_otp",
      code: "OTP_REQUIRED",
      reason: probe?.reason || "OTP challenge detected."
    };
  }

  if (explicitInvalid && !progression.advanced) {
    return {
      state: "auth_failed",
      code: "INVALID_CREDENTIALS",
      reason: probe?.invalidCredentialReason || "Credentials were rejected by the authentication form."
    };
  }

  if (probe?.authenticatedHint || visibleStep === "authenticated") {
    return {
      state: "authenticated",
      code: "AUTH_VALIDATED",
      reason: "Authenticated session signals detected."
    };
  }

  if (progression.advanced && submission?.submitTriggered) {
    if (visibleStep === "password") {
      return {
        state: "awaiting_password",
        code: "AUTH_STEP_ADVANCED",
        reason: "Username step completed; password entry is now required."
      };
    }
    if (visibleStep === "username") {
      return {
        state: "awaiting_username",
        code: "AUTH_STEP_ADVANCED",
        reason: "Authentication flow advanced; username input is required."
      };
    }
    return {
      state: "auth_step_advanced",
      code: "AUTH_STEP_ADVANCED",
      reason: progression.reason || "Authentication flow advanced to the next step."
    };
  }

  if (visibleStep === "username") {
    return {
      state: "awaiting_username",
      code: "LOGIN_USERNAME_REQUIRED",
      reason: probe?.reason || "Username/email input is required."
    };
  }

  if (visibleStep === "password") {
    return {
      state: "awaiting_password",
      code: "LOGIN_PASSWORD_REQUIRED",
      reason: probe?.reason || "Password input is required."
    };
  }

  if (probe?.loginWallDetected || visibleStep === "credentials") {
    return {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: probe?.reason || "Login credentials are required."
    };
  }

  if (submission?.submitTriggered && !explicitInvalid) {
    return {
      state: "auth_unknown_state",
      code: "AUTH_UNKNOWN_STATE",
      reason: "Authentication submission completed but the next state is unclear."
    };
  }

  return {
    state: "running",
    code: "AUTH_NOT_REQUIRED",
    reason: "No authentication wall detected."
  };
}
