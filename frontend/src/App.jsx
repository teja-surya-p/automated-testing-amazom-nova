import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { io } from "socket.io-client";
import Home from "./pages/Home";
import RunConsole from "./pages/RunConsole";
import { isRunActive } from "./lib/runState";
import { API_BASE_URL, SOCKET_BASE_URL } from "./services/constants";
import {
  autoAllSessionForms,
  autoSessionFormGroup,
  getApiHealth,
  getSession,
  getSessionReport,
  listSessions,
  skipAllSessionForms,
  skipSessionAuth,
  skipSessionFormGroup,
  startSession,
  stopAllSessions,
  stopSession,
  submitSessionFormGroup,
  submitVerificationDecision,
  submitVerificationDecisionAll,
  submitSessionInputFields,
  submitSessionOtp,
  updateSessionFormGroupDescription
} from "./services/sessionsService";

const API_BASE = API_BASE_URL;
const TEST_CASE_BUFFER_LIMIT = 5000;
const AGENT_ACTIVITY_BUFFER_LIMIT = 300;

const socket = io(SOCKET_BASE_URL, {
  transports: ["websocket"],
  autoConnect: true,
  reconnection: true
});

function sortSessionsByRecent(sessions = []) {
  return [...sessions].sort((left, right) => {
    const leftAt = Date.parse(left.updatedAt ?? left.createdAt ?? 0);
    const rightAt = Date.parse(right.updatedAt ?? right.createdAt ?? 0);
    return rightAt - leftAt;
  });
}

function upsertSessionEntry(existing = [], incoming = null) {
  if (!incoming?.id) {
    return existing;
  }

  const index = existing.findIndex((entry) => entry.id === incoming.id);
  if (index < 0) {
    return sortSessionsByRecent([incoming, ...existing]);
  }

  const next = [...existing];
  next[index] = {
    ...next[index],
    ...incoming
  };
  return sortSessionsByRecent(next);
}

function patchSessionEntry(existing = [], sessionId, patch = {}) {
  if (!sessionId) {
    return existing;
  }
  return sortSessionsByRecent(
    existing.map((entry) => (entry.id === sessionId ? { ...entry, ...patch } : entry))
  );
}

function appendAgentActivityEntry(existing = [], sessionId, event) {
  if (!sessionId || !event || typeof event !== "object") {
    return existing;
  }
  return sortSessionsByRecent(
    existing.map((entry) => {
      if (entry.id !== sessionId) {
        return entry;
      }
      const current = Array.isArray(entry.agentActivity) ? entry.agentActivity : [];
      return {
        ...entry,
        agentActivity: [...current, event].slice(-AGENT_ACTIVITY_BUFFER_LIMIT)
      };
    })
  );
}

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [backendHealth, setBackendHealth] = useState(null);
  const [backendHealthError, setBackendHealthError] = useState("");

  const refreshSessions = useCallback(async () => {
    const payload = await listSessions();
    const list = Array.isArray(payload) ? payload : [];
    setSessions(sortSessionsByRecent(list));
    return list;
  }, []);

  const fetchSession = useCallback(async (sessionId) => {
    if (!sessionId) {
      return null;
    }
    const session = await getSession(sessionId);
    setSessions((current) => upsertSessionEntry(current, session));
    return session;
  }, []);

  const fetchReport = useCallback(async (sessionId) => {
    if (!sessionId) {
      return null;
    }
    const report = await getSessionReport(sessionId);
    if (!report) {
      return null;
    }

    setSessions((current) =>
      patchSessionEntry(current, sessionId, {
        report,
        summaryText: report.summaryText ?? null
      })
    );

    return report;
  }, []);

  const refreshBackendHealth = useCallback(async () => {
    try {
      const payload = await getApiHealth();
      setBackendHealth(payload);
      setBackendHealthError("");
      return payload;
    } catch (error) {
      setBackendHealthError(error?.message ?? "Unable to read backend runtime metadata.");
      return null;
    }
  }, []);

  const startRun = useCallback(async (body) => {
    const session = await startSession(body);
    setSessions((current) => upsertSessionEntry(current, session));
    return session;
  }, []);

  const submitAuthInputFields = useCallback(async (sessionId, payload) => {
    try {
      const result = await submitSessionInputFields(sessionId, payload);
      if (result?.authAssist) {
        setSessions((current) =>
          patchSessionEntry(current, sessionId, {
            authAssist: result.authAssist
          })
        );
      }
      return result;
    } catch (errorPayload) {
      if (errorPayload?.authAssist) {
        setSessions((current) =>
          patchSessionEntry(current, sessionId, {
            authAssist: errorPayload.authAssist
          })
        );
      }
      throw errorPayload;
    }
  }, []);

  const submitAuthOtp = useCallback(async (sessionId, payload) => {
    try {
      const result = await submitSessionOtp(sessionId, payload);
      if (result?.authAssist) {
        setSessions((current) =>
          patchSessionEntry(current, sessionId, {
            authAssist: result.authAssist
          })
        );
      }
      return result;
    } catch (errorPayload) {
      if (errorPayload?.authAssist) {
        setSessions((current) =>
          patchSessionEntry(current, sessionId, {
            authAssist: errorPayload.authAssist
          })
        );
      }
      throw errorPayload;
    }
  }, []);

  const skipAuthCredentials = useCallback(async (sessionId, payload = {}) => {
    try {
      const result = await skipSessionAuth(sessionId, payload);
      if (result?.authAssist) {
        setSessions((current) =>
          patchSessionEntry(current, sessionId, {
            authAssist: result.authAssist
          })
        );
      }
      return result;
    } catch (errorPayload) {
      if (errorPayload?.authAssist) {
        setSessions((current) =>
          patchSessionEntry(current, sessionId, {
            authAssist: errorPayload.authAssist
          })
        );
      }
      throw errorPayload;
    }
  }, []);

  const applyFormAssistPatch = useCallback((sessionId, payload = {}) => {
    if (!sessionId) {
      return;
    }
    if (payload?.session?.id) {
      setSessions((current) => upsertSessionEntry(current, payload.session));
      return;
    }
    const patch = {};
    if (payload?.formAssist !== undefined) {
      patch.formAssist = payload.formAssist;
    }
    if (payload?.verificationAssist !== undefined) {
      patch.verificationAssist = payload.verificationAssist;
    }
    if (payload?.status !== undefined) {
      patch.status = payload.status;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    setSessions((current) =>
      patchSessionEntry(current, sessionId, patch)
    );
  }, []);

  const submitFormGroup = useCallback(async (sessionId, groupId, payload = {}) => {
    const response = await submitSessionFormGroup(sessionId, groupId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const skipFormGroup = useCallback(async (sessionId, groupId, payload = {}) => {
    const response = await skipSessionFormGroup(sessionId, groupId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const autoFormGroup = useCallback(async (sessionId, groupId, payload = {}) => {
    const response = await autoSessionFormGroup(sessionId, groupId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const updateFormGroupDescription = useCallback(async (sessionId, groupId, payload = {}) => {
    const response = await updateSessionFormGroupDescription(sessionId, groupId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const skipAllForms = useCallback(async (sessionId, payload = {}) => {
    const response = await skipAllSessionForms(sessionId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const autoAllForms = useCallback(async (sessionId, payload = {}) => {
    const response = await autoAllSessionForms(sessionId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const resolveVerificationPrompt = useCallback(async (sessionId, promptId, payload = {}) => {
    const response = await submitVerificationDecision(sessionId, promptId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const resolveAllVerificationPrompts = useCallback(async (sessionId, payload = {}) => {
    const response = await submitVerificationDecisionAll(sessionId, payload);
    applyFormAssistPatch(sessionId, response);
    return response;
  }, [applyFormAssistPatch]);

  const stopRun = useCallback(async (sessionId) => {
    const result = await stopSession(sessionId);
    if (result?.session) {
      setSessions((current) => upsertSessionEntry(current, result.session));
    } else if (result?.sessionId) {
      setSessions((current) =>
        patchSessionEntry(current, result.sessionId, {
          status: result.status ?? "cancelling",
          summary: result.message ?? "Run stop requested."
        })
      );
    }
    return result;
  }, []);

  const stopAllRuns = useCallback(async () => {
    const result = await stopAllSessions();
    const requestedSessionIds = Array.isArray(result?.requestedSessionIds) ? result.requestedSessionIds : [];
    if (requestedSessionIds.length) {
      setSessions((current) =>
        sortSessionsByRecent(
          current.map((entry) =>
            requestedSessionIds.includes(entry.id) && isRunActive(entry.status)
              ? {
                  ...entry,
                  status: "cancelling",
                  summary: "Run stop requested by user."
                }
              : entry
          )
        )
      );
    }
    refreshSessions().catch(() => null);
    return result;
  }, [refreshSessions]);

  useEffect(() => {
    refreshSessions().catch(() => null);
  }, [refreshSessions]);

  useEffect(() => {
    refreshBackendHealth().catch(() => null);
  }, [refreshBackendHealth]);

  useEffect(() => {
    const refreshTimer = setInterval(() => {
      refreshSessions().catch(() => null);
      refreshBackendHealth().catch(() => null);
    }, 30_000);

    return () => clearInterval(refreshTimer);
  }, [refreshBackendHealth, refreshSessions]);

  useEffect(() => {
    function handleSocketConnect() {
      setSocketConnected(true);
    }

    function handleSocketDisconnect() {
      setSocketConnected(false);
    }

    function handleSessionPayload(payload) {
      const session = payload?.session ?? payload;
      if (!session?.id && payload?.sessionId) {
        fetchSession(payload.sessionId).catch(() => null);
        return;
      }
      setSessions((current) => upsertSessionEntry(current, session));
    }

    function handleUiUpdate(payload) {
      if (!payload?.sessionId) {
        return;
      }

      setSessions((current) =>
        patchSessionEntry(current, payload.sessionId, {
          frame: payload.image ?? null,
          currentStep: payload.step ?? null,
          currentUrl: payload.url ?? null,
          frameTitle: payload.title ?? null
        })
      );
    }

    function handleTestCaseStats(payload) {
      if (!payload?.sessionId) {
        return;
      }
      setSessions((current) =>
        patchSessionEntry(current, payload.sessionId, {
          testCaseStats: {
            ...(current.find((entry) => entry.id === payload.sessionId)?.testCaseStats ?? {}),
            ...(payload.stats ?? {})
          }
        })
      );
    }

    function handleTestCaseEvent(payload) {
      if (!payload?.sessionId || !payload?.testCase?.id) {
        return;
      }

      setSessions((current) =>
        sortSessionsByRecent(
          current.map((entry) => {
            if (entry.id !== payload.sessionId) {
              return entry;
            }

            const testCases = Array.isArray(entry.testCases) ? [...entry.testCases] : [];
            const index = testCases.findIndex((item) => item.id === payload.testCase.id);
            if (index >= 0) {
              testCases[index] = {
                ...testCases[index],
                ...payload.testCase
              };
            } else {
              testCases.push(payload.testCase);
            }

            return {
              ...entry,
              testCaseStats: {
                ...(entry.testCaseStats ?? {}),
                ...(payload.stats ?? {})
              },
              testCases: testCases.slice(-TEST_CASE_BUFFER_LIMIT)
            };
          })
        )
      );
    }

    function handleTerminalSession(payload) {
      handleSessionPayload(payload);
      if (payload?.sessionId) {
        fetchReport(payload.sessionId).catch(() => null);
      }
    }

    function handleAgentActivity(payload) {
      const sessionId = payload?.sessionId;
      const event = payload?.event;
      if (!sessionId || !event) {
        return;
      }
      setSessions((current) => appendAgentActivityEntry(current, sessionId, event));
    }

    socket.on("connect", handleSocketConnect);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("session.created", handleSessionPayload);
    socket.on("session.updated", handleSessionPayload);
    socket.on("session.passed", handleTerminalSession);
    socket.on("session.soft-passed", handleTerminalSession);
    socket.on("session.failed", handleTerminalSession);
    socket.on("session.cancelled", handleTerminalSession);
    socket.on("ui-update", handleUiUpdate);
    socket.on("testcase:stats", handleTestCaseStats);
    socket.on("testcase:event", handleTestCaseEvent);
    socket.on("agent.activity", handleAgentActivity);

    return () => {
      socket.off("connect", handleSocketConnect);
      socket.off("disconnect", handleSocketDisconnect);
      socket.off("session.created", handleSessionPayload);
      socket.off("session.updated", handleSessionPayload);
      socket.off("session.passed", handleTerminalSession);
      socket.off("session.soft-passed", handleTerminalSession);
      socket.off("session.failed", handleTerminalSession);
      socket.off("session.cancelled", handleTerminalSession);
      socket.off("ui-update", handleUiUpdate);
      socket.off("testcase:stats", handleTestCaseStats);
      socket.off("testcase:event", handleTestCaseEvent);
      socket.off("agent.activity", handleAgentActivity);
    };
  }, [fetchReport, fetchSession]);

  const activeSessionsCount = useMemo(
    () => sessions.filter((session) => isRunActive(session.status)).length,
    [sessions]
  );

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Home
            sessions={sessions}
            socketConnected={socketConnected}
            activeSessionsCount={activeSessionsCount}
            apiBase={API_BASE}
            backendHealth={backendHealth}
            backendHealthError={backendHealthError}
            onLaunch={startRun}
            onStopAllActiveRuns={stopAllRuns}
          />
        }
      />
      <Route
        path="/runs/:sessionId"
        element={
          <RunConsole
            apiBase={API_BASE}
            sessions={sessions}
            socketConnected={socketConnected}
            fetchSession={fetchSession}
            fetchReport={fetchReport}
            submitAuthInputFields={submitAuthInputFields}
            submitAuthOtp={submitAuthOtp}
            skipAuthCredentials={skipAuthCredentials}
            submitFormGroup={submitFormGroup}
            skipFormGroup={skipFormGroup}
            autoFormGroup={autoFormGroup}
            updateFormGroupDescription={updateFormGroupDescription}
            skipAllForms={skipAllForms}
            autoAllForms={autoAllForms}
            resolveVerificationPrompt={resolveVerificationPrompt}
            resolveAllVerificationPrompts={resolveAllVerificationPrompts}
            stopRun={stopRun}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
