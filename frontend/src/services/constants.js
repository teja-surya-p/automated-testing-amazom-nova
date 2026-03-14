const viteEnv = import.meta?.env ?? globalThis?.process?.env ?? {};

export function normalizeApiBaseUrl(value, fallback = "http://localhost:3000") {
  const input = String(value ?? "").trim();
  if (!input) {
    return fallback;
  }

  try {
    const parsed = new URL(input);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (normalizedPath.toLowerCase() === "/api") {
      parsed.pathname = "";
    } else if (normalizedPath.toLowerCase().endsWith("/api")) {
      parsed.pathname = normalizedPath.slice(0, -4) || "";
    } else {
      parsed.pathname = normalizedPath;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return (
      input
        .replace(/\/+$/, "")
        .replace(/\/api$/i, "") || fallback
    );
  }
}

const rawApiBase =
  viteEnv.VITE_API_BASE_URL ??
  viteEnv.VITE_API_BASE ??
  "http://localhost:3000";

export const API_BASE_URL = normalizeApiBaseUrl(rawApiBase);
export const API_PREFIX = "/api";
export const SOCKET_BASE_URL = API_BASE_URL;
export const DEFAULT_TARGET_APP_URL =
  viteEnv.VITE_TARGET_APP_URL ?? "https://example.com";

export const API_ROUTES = Object.freeze({
  health: "/health",
  version: "/version",
  sessions: "/sessions",
  session: (sessionId) => `/sessions/${sessionId}`,
  sessionReport: (sessionId) => `/sessions/${sessionId}/report`,
  startSession: "/sessions/start",
  stopAllSessions: "/sessions/stop-all",
  stopAllSessionsLegacy: "/sessions/stop-all-active",
  resumeSession: (sessionId) => `/sessions/${sessionId}/resume`,
  stopSession: (sessionId) => `/sessions/${sessionId}/stop`,
  authInputFields: (sessionId) => `/sessions/${sessionId}/auth/input-fields`,
  authCredentials: (sessionId) => `/sessions/${sessionId}/auth/credentials`,
  authOtp: (sessionId) => `/sessions/${sessionId}/auth/otp`,
  authSkip: (sessionId) => `/sessions/${sessionId}/auth/skip`,
  formSubmit: (sessionId, groupId) => `/sessions/${sessionId}/forms/${groupId}/submit`,
  formSkip: (sessionId, groupId) => `/sessions/${sessionId}/forms/${groupId}/skip`,
  formAuto: (sessionId, groupId) => `/sessions/${sessionId}/forms/${groupId}/auto`,
  formDescription: (sessionId, groupId) => `/sessions/${sessionId}/forms/${groupId}/description`,
  formSkipAll: (sessionId) => `/sessions/${sessionId}/forms/skip-all`,
  formAutoAll: (sessionId) => `/sessions/${sessionId}/forms/auto-all`,
  verificationDecision: (sessionId, promptId) => `/sessions/${sessionId}/verifications/${promptId}/decision`,
  verificationDecisionAll: (sessionId) => `/sessions/${sessionId}/verifications/decision-all`,
  uiuxDevices: "/uiux/devices"
});
