const rawApiBase =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_BASE ??
  "http://localhost:3000";

export const API_BASE_URL = String(rawApiBase).replace(/\/+$/, "");
export const API_PREFIX = "/api";
export const SOCKET_BASE_URL = API_BASE_URL;
export const DEFAULT_TARGET_APP_URL =
  import.meta.env.VITE_TARGET_APP_URL ?? "https://example.com";

export const API_ROUTES = Object.freeze({
  sessions: "/sessions",
  session: (sessionId) => `/sessions/${sessionId}`,
  sessionReport: (sessionId) => `/sessions/${sessionId}/report`,
  startSession: "/sessions/start",
  resumeSession: (sessionId) => `/sessions/${sessionId}/resume`,
  stopSession: (sessionId) => `/sessions/${sessionId}/stop`,
  authCredentials: (sessionId) => `/sessions/${sessionId}/auth/credentials`,
  authOtp: (sessionId) => `/sessions/${sessionId}/auth/otp`,
  authSkip: (sessionId) => `/sessions/${sessionId}/auth/skip`,
  uiuxDevices: "/uiux/devices"
});
