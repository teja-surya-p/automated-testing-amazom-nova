import { apiCall } from "./apiCallHandler.js";
import { API_ROUTES } from "./constants.js";

export function getApiHealth() {
  return apiCall({
    path: API_ROUTES.health
  });
}

export function getApiVersion() {
  return apiCall({
    path: API_ROUTES.version
  });
}

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

export function submitSessionInputFields(sessionId, payload) {
  return apiCall({
    path: API_ROUTES.authInputFields(sessionId),
    method: "POST",
    body: payload
  }).catch((error) => {
    const code = error?.code ?? error?.error ?? "";
    if (code !== "API_ROUTE_NOT_FOUND") {
      throw error;
    }

    // Backward-compat path for older servers that only expose /auth/credentials.
    return apiCall({
      path: API_ROUTES.authCredentials(sessionId),
      method: "POST",
      body: payload
    });
  });
}

export function submitSessionCredentials(sessionId, payload) {
  // Legacy alias retained for compatibility with existing callers.
  return submitSessionInputFields(sessionId, payload);
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

export function submitSessionFormGroup(sessionId, groupId, payload = {}) {
  return apiCall({
    path: API_ROUTES.formSubmit(sessionId, groupId),
    method: "POST",
    body: payload
  });
}

export function skipSessionFormGroup(sessionId, groupId, payload = {}) {
  return apiCall({
    path: API_ROUTES.formSkip(sessionId, groupId),
    method: "POST",
    body: payload
  });
}

export function autoSessionFormGroup(sessionId, groupId, payload = {}) {
  return apiCall({
    path: API_ROUTES.formAuto(sessionId, groupId),
    method: "POST",
    body: payload
  });
}

export function updateSessionFormGroupDescription(sessionId, groupId, payload = {}) {
  return apiCall({
    path: API_ROUTES.formDescription(sessionId, groupId),
    method: "POST",
    body: payload
  });
}

export function skipAllSessionForms(sessionId, payload = {}) {
  return apiCall({
    path: API_ROUTES.formSkipAll(sessionId),
    method: "POST",
    body: payload
  });
}

export function autoAllSessionForms(sessionId, payload = {}) {
  return apiCall({
    path: API_ROUTES.formAutoAll(sessionId),
    method: "POST",
    body: payload
  });
}

export function submitVerificationDecision(sessionId, promptId, payload = {}) {
  return apiCall({
    path: API_ROUTES.verificationDecision(sessionId, promptId),
    method: "POST",
    body: payload
  });
}

export function submitVerificationDecisionAll(sessionId, payload = {}) {
  return apiCall({
    path: API_ROUTES.verificationDecisionAll(sessionId),
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

export function stopAllSessions(payload = {}) {
  return apiCall({
    path: API_ROUTES.stopAllSessions,
    method: "POST",
    body: payload
  }).catch((error) => {
    const code = error?.code ?? error?.error ?? "";
    if (code !== "API_ROUTE_NOT_FOUND") {
      throw error;
    }

    return apiCall({
      path: API_ROUTES.stopAllSessionsLegacy ?? API_ROUTES.stopAllSessions,
      method: "POST",
      body: payload
    });
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
