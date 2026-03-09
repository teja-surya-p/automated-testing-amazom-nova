import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { io } from "socket.io-client";
import Home from "./pages/Home";
import RunConsole from "./pages/RunConsole";
import { isRunActive } from "./lib/runState";
import { API_BASE_URL, SOCKET_BASE_URL } from "./services/constants";
import {
  getSession,
  getSessionReport,
  listSessions,
  skipSessionAuth,
  startSession,
  stopSession,
  submitSessionCredentials,
  submitSessionOtp
} from "./services/sessionsService";

const API_BASE = API_BASE_URL;

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

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [socketConnected, setSocketConnected] = useState(socket.connected);

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

  const startRun = useCallback(async (body) => {
    const session = await startSession(body);
    setSessions((current) => upsertSessionEntry(current, session));
    return session;
  }, []);

  const submitAuthCredentials = useCallback(async (sessionId, payload) => {
    try {
      const result = await submitSessionCredentials(sessionId, payload);
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

  useEffect(() => {
    refreshSessions().catch(() => null);
  }, [refreshSessions]);

  useEffect(() => {
    const refreshTimer = setInterval(() => {
      refreshSessions().catch(() => null);
    }, 30_000);

    return () => clearInterval(refreshTimer);
  }, [refreshSessions]);

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
              testCases: testCases.slice(-500)
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
            onLaunch={startRun}
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
            submitAuthCredentials={submitAuthCredentials}
            submitAuthOtp={submitAuthOtp}
            skipAuthCredentials={skipAuthCredentials}
            stopRun={stopRun}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
