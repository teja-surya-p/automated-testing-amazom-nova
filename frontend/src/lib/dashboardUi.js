function trimTrailingSlashes(value = "") {
  return String(value).replace(/\/+$/, "");
}

function stripProtocolAndDecorators(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "");
}

export function formatRunTargetForDisplay(targetUrl = "", { includePath = false } = {}) {
  const raw = String(targetUrl ?? "").trim();
  if (!raw) {
    return "-";
  }

  try {
    const parsed = new URL(raw);
    const host = stripProtocolAndDecorators(parsed.host);
    const pathname = trimTrailingSlashes(parsed.pathname || "");
    if (!includePath || !pathname || pathname === "/") {
      return host || "-";
    }
    return `${host}${pathname}`;
  } catch {
    const normalized = trimTrailingSlashes(
      stripProtocolAndDecorators(raw).replace(/[?#].*$/, "")
    );
    return normalized || "-";
  }
}

export function shouldShowRecentRunsForLaunchStep(step = 1) {
  return Number(step) !== 2;
}

export function formatAuthAssistStatusLabel(state = "") {
  const normalized = String(state ?? "").trim().toLowerCase();
  const mapped = {
    awaiting_input_fields: "Awaiting input fields",
    awaiting_credentials: "Awaiting input fields",
    awaiting_username: "Awaiting input fields",
    awaiting_password: "Awaiting input fields",
    submitting_input_fields: "Submitting input fields",
    submitting_credentials: "Submitting input fields",
    awaiting_otp: "Awaiting OTP",
    submitting_otp: "Submitting OTP",
    auth_failed: "Auth failed",
    authenticated: "Authenticated",
    resumed: "Authenticated",
    auth_pending_transition: "Pending transition",
    auth_unknown_state: "Pending transition"
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  if (!normalized) {
    return "Awaiting input fields";
  }
  return normalized
    .split("_")
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

export function getLiveViewerFullscreenLabel(isFullscreen = false) {
  return isFullscreen ? "Exit fullscreen" : "Fullscreen";
}
