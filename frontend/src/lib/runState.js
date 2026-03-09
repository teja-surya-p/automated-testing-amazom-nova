export const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "waiting-login", "login-assist", "cancelling"]);

export function isRunActive(status) {
  return ACTIVE_RUN_STATUSES.has(status);
}

export function canShowStopButton(status) {
  return isRunActive(status) && status !== "cancelling";
}
