import { apiCall } from "./apiCallHandler";
import { API_ROUTES } from "./constants";

export function listSessions() {
  return apiCall({
    path: API_ROUTES.sessions
  });
}

export function getSession(sessionId) {
  return apiCall({
    path: API_ROUTES.session(sessionId)
  });
}

export function getSessionReport(sessionId) {
  return apiCall({
    path: API_ROUTES.sessionReport(sessionId)
  });
}

export function startSession(payload) {
  return apiCall({
    path: API_ROUTES.startSession,
    method: "POST",
    body: payload
  });
}

export function submitSessionCredentials(sessionId, payload) {
  return apiCall({
    path: API_ROUTES.authCredentials(sessionId),
    method: "POST",
    body: payload
  });
}

export function submitSessionOtp(sessionId, payload) {
  return apiCall({
    path: API_ROUTES.authOtp(sessionId),
    method: "POST",
    body: payload
  });
}

export function skipSessionAuth(sessionId, payload = {}) {
  return apiCall({
    path: API_ROUTES.authSkip(sessionId),
    method: "POST",
    body: payload
  });
}

export function stopSession(sessionId) {
  return apiCall({
    path: API_ROUTES.stopSession(sessionId),
    method: "POST"
  });
}

export function resumeSession(sessionId) {
  return apiCall({
    path: API_ROUTES.resumeSession(sessionId),
    method: "POST"
  });
}

export function fetchUiuxDevices({ mode = "full", list = 0, max } = {}) {
  return apiCall({
    path: API_ROUTES.uiuxDevices,
    params: {
      mode,
      list,
      max
    }
  });
}
