export const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "waiting-login",
  "login-assist",
  "form-assist",
  "verification-assist",
  "cancelling"
]);

export function isRunActive(status) {
  return ACTIVE_RUN_STATUSES.has(status);
}

export function canShowStopButton(status) {
  return isRunActive(status) && status !== "cancelling";
}

export function canTerminateAllRuns(sessions = []) {
  return (Array.isArray(sessions) ? sessions : []).some((session) => isRunActive(session?.status));
}

const AUTH_TERMINAL_STATES = new Set(["resumed", "authenticated"]);
const AUTH_CREDENTIAL_PENDING_STATES = new Set([
  "awaiting_username",
  "awaiting_password",
  "awaiting_credentials",
  "awaiting_input_fields",
  "auth_step_advanced",
  "auth_unknown_state",
  "submitting_credentials",
  "submitting_input_fields"
]);
const AUTH_OTP_PENDING_STATES = new Set(["awaiting_otp", "submitting_otp"]);

export function deriveAuthAssistUiState({ status, authAssist } = {}) {
  const authState = authAssist?.state ?? null;
  const otpPending = Boolean(
    authAssist &&
      (
        AUTH_OTP_PENDING_STATES.has(authState) ||
        authAssist?.code === "OTP_REQUIRED" ||
        authAssist?.code === "OTP_INVALID"
      )
  );
  const credentialsPending = Boolean(
    authAssist &&
      (
        AUTH_CREDENTIAL_PENDING_STATES.has(authState) ||
        (authState === "auth_failed" && !otpPending)
      )
  );
  const showAuthAssistPanel = Boolean(
    authAssist &&
      !AUTH_TERMINAL_STATES.has(authState) &&
      (credentialsPending || otpPending || status === "login-assist" || status === "waiting-login")
  );

  return {
    authState,
    otpPending,
    credentialsPending,
    showAuthAssistPanel
  };
}
