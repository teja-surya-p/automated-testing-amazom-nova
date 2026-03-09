import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ArtifactsList from "../components/ArtifactsList";
import DeviceSummary from "../components/DeviceSummary";
import EvidenceViewer from "../components/EvidenceViewer";
import FailuresDrawer from "../components/FailuresDrawer";
import LiveViewer from "../components/LiveViewer";
import RunProgress from "../components/RunProgress";
import { canShowStopButton, isRunActive } from "../lib/runState";
import { resumeSession } from "../services/sessionsService";

function severityRank(level = "P3") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function statusTone(status = "queued") {
  if (status === "passed") {
    return "border-emerald-400/40 bg-emerald-500/20 text-emerald-100";
  }
  if (status === "failed") {
    return "border-rose-400/40 bg-rose-500/20 text-rose-100";
  }
  if (status === "soft-passed") {
    return "border-amber-400/40 bg-amber-500/20 text-amber-100";
  }
  if (isRunActive(status)) {
    return "border-cyan-400/40 bg-cyan-500/20 text-cyan-100";
  }
  return "border-slate-400/30 bg-slate-700/30 text-slate-200";
}

function formatDuration(milliseconds = 0) {
  const totalSeconds = Math.max(Math.floor(milliseconds / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function elapsedMsForSession(session, nowMs) {
  const createdAt = Date.parse(session?.createdAt ?? 0);
  if (Number.isNaN(createdAt)) {
    return 0;
  }
  const isActive = isRunActive(session?.status);
  const updatedAt = Date.parse(session?.updatedAt ?? session?.createdAt ?? 0);
  const end = isActive ? nowMs : Number.isNaN(updatedAt) ? nowMs : updatedAt;
  return Math.max(end - createdAt, 0);
}

function selectCurrentCase(testCases = []) {
  const sorted = [...testCases].sort((left, right) => {
    const leftAt = Date.parse(left.startedAt ?? left.endedAt ?? 0);
    const rightAt = Date.parse(right.startedAt ?? right.endedAt ?? 0);
    return rightAt - leftAt;
  });

  return sorted.find((entry) => entry.status === "running") ?? sorted[0] ?? null;
}

function normalizeFailure({
  id,
  groupId,
  mode,
  issueType,
  title,
  summary,
  testcaseId,
  testcaseTitle,
  severity,
  deviceLabel,
  viewportLabel,
  pageUrl,
  canonicalUrl,
  step,
  expected,
  actual,
  whyItFailed,
  occurrenceCount,
  devices,
  primaryEvidence,
  grouped,
  explanation,
  highlight,
  affectedSelector,
  judgmentPolicy,
  rawDetectorResult,
  llmJudgment,
  calibratedJudgment,
  downgradeReason,
  supportingSignalCounts,
  evidenceRefs = []
}) {
  return {
    id: id ?? `${issueType ?? "issue"}-${pageUrl ?? ""}-${step ?? "na"}-${deviceLabel ?? "default"}`,
    groupId: groupId ?? null,
    mode: mode ?? "default",
    issueType: issueType ?? "ISSUE",
    title: title ?? issueType ?? "Issue",
    summary: summary ?? "",
    testcaseId: testcaseId ?? null,
    testcaseTitle: testcaseTitle ?? null,
    severity: severity ?? "P2",
    deviceLabel: deviceLabel ?? "default",
    viewportLabel: viewportLabel ?? null,
    pageUrl: pageUrl ?? "",
    canonicalUrl: canonicalUrl ?? "",
    step: step ?? null,
    expected: expected ?? "",
    actual: actual ?? "",
    whyItFailed: whyItFailed ?? "",
    occurrenceCount: Number(occurrenceCount ?? 1),
    devices: Array.isArray(devices) ? devices : [],
    primaryEvidence: primaryEvidence ?? null,
    grouped: Boolean(grouped),
    explanation: explanation ?? null,
    highlight: highlight ?? null,
    affectedSelector: affectedSelector ?? null,
    judgmentPolicy: judgmentPolicy ?? null,
    rawDetectorResult: rawDetectorResult ?? null,
    llmJudgment: llmJudgment ?? null,
    calibratedJudgment: calibratedJudgment ?? null,
    downgradeReason: downgradeReason ?? null,
    supportingSignalCounts: supportingSignalCounts ?? null,
    evidenceRefs
  };
}

function collectFailures(report, mode) {
  if (!report) {
    return [];
  }

  if (mode === "uiux") {
    const groupedIssues = report.uiux?.groupedIssues ?? report.uiuxGroupedIssues ?? [];
    if (groupedIssues.length > 0) {
      return groupedIssues.map((group) =>
        normalizeFailure({
          id: group.groupId ?? group.id,
          groupId: group.groupId ?? null,
          mode: "uiux",
          grouped: true,
          issueType: group.issueType,
          title: group.title,
          summary:
            group.summary ??
            group.explanation?.whatHappened ??
            group.actual ??
            group.title ??
            group.issueType,
          testcaseId: group.testcaseId ?? null,
          testcaseTitle: group.testcaseTitle ?? group.testcaseId ?? null,
          severity: group.finalSeverity ?? group.severity,
          deviceLabel: group.deviceLabel ?? group.devices?.[0]?.deviceLabel,
          viewportLabel: group.viewportLabel ?? group.devices?.[0]?.viewportLabel ?? null,
          pageUrl: group.affectedUrl,
          canonicalUrl: group.canonicalUrl,
          step: group.step ?? null,
          expected: group.expected,
          actual: group.actual,
          whyItFailed:
            group.explanation?.whyItFailed ??
            group.whyItFailed ??
            group.actual ??
            "The rendered UI state did not satisfy deterministic checks.",
          devices: group.devices ?? [],
          occurrenceCount: group.occurrenceCount ?? group.devices?.length ?? 1,
          primaryEvidence: group.primaryEvidence ?? null,
          explanation: group.explanation ?? null,
          highlight: group.primaryEvidence?.highlight ?? group.highlight ?? null,
          affectedSelector: group.affectedSelector ?? null,
          judgmentPolicy: group.judgmentPolicy ?? null,
          rawDetectorResult: group.rawDetectorResult ?? null,
          llmJudgment: group.llmJudgment ?? null,
          calibratedJudgment: group.calibratedJudgment ?? null,
          downgradeReason: group.downgradeReason ?? null,
          supportingSignalCounts: group.supportingSignalCounts ?? null,
          evidenceRefs:
            group.evidenceRefs?.length
              ? group.evidenceRefs
              : group.primaryEvidence?.screenshotRef
                ? [
                    {
                      type: "screenshot",
                      ref: group.primaryEvidence.screenshotRef,
                      captureMode: group.primaryEvidence.captureMode ?? "viewport",
                      viewport: group.primaryEvidence.viewport ?? null
                    }
                  ]
                : []
        })
      );
    }

    const defectIssues = (report.uiux?.issues ?? []).filter(
      (issue) => (issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL") === "FAIL"
    );

    return defectIssues.map((issue, index) =>
      normalizeFailure({
        id: issue.id ?? `uiux-${index}`,
        mode: "uiux",
        grouped: false,
        issueType: issue.issueType,
        title: issue.title,
        summary:
          issue.summary ??
          issue.explanation?.whatHappened ??
          issue.actual ??
          issue.title ??
          issue.issueType,
        testcaseId: issue.testcaseId ?? null,
        testcaseTitle: issue.testcaseTitle ?? issue.testcaseId ?? null,
        severity: issue.finalSeverity ?? issue.severity,
        deviceLabel: issue.deviceLabel ?? issue.viewportLabel,
        viewportLabel: issue.viewportLabel ?? null,
        pageUrl: issue.affectedUrl,
        canonicalUrl: issue.repro?.canonicalUrl,
        step: issue.step ?? issue.repro?.step,
        expected: issue.expected,
        actual: issue.actual,
        whyItFailed:
          issue.explanation?.whyItFailed ??
          issue.actual ??
          "The rendered UI state did not satisfy deterministic checks.",
        devices: issue.deviceLabel
          ? [
              {
                deviceId: issue.deviceId ?? null,
                deviceLabel: issue.deviceLabel,
                viewportLabel: issue.viewportLabel ?? issue.deviceLabel
              }
            ]
          : [],
        occurrenceCount: 1,
        primaryEvidence: {
          screenshotRef: issue.evidenceRefs?.find((entry) => entry.type === "screenshot")?.ref ?? null,
          captureMode: issue.evidenceRefs?.find((entry) => entry.type === "screenshot")?.captureMode ?? "viewport",
          highlight: issue.highlight ?? null
        },
        explanation: issue.explanation ?? null,
        highlight: issue.highlight ?? null,
        affectedSelector: issue.affectedSelector ?? issue.repro?.targetSelector ?? null,
        judgmentPolicy: issue.judgmentPolicy ?? issue.testcaseJudgmentPolicy ?? null,
        rawDetectorResult: issue.rawDetectorResult ?? null,
        llmJudgment: issue.llmJudgment ?? null,
        calibratedJudgment: issue.calibratedJudgment ?? null,
        downgradeReason: issue.downgradeReason ?? null,
        supportingSignalCounts: issue.supportingSignalCounts ?? null,
        evidenceRefs: issue.evidenceRefs
      })
    );
  }

  if (mode === "functional") {
    return (report.functional?.issues ?? []).map((issue, index) =>
      normalizeFailure({
        id: issue.id ?? `functional-${index}`,
        mode: "functional",
        issueType: issue.assertionId ?? issue.issueType,
        title: issue.title,
        summary: issue.summary ?? issue.actual ?? issue.title,
        testcaseId: issue.assertionId ?? issue.testcaseId ?? null,
        testcaseTitle: issue.title ?? issue.assertionId ?? null,
        severity: issue.severity,
        deviceLabel: issue.viewportLabel,
        viewportLabel: issue.viewportLabel ?? null,
        pageUrl: issue.affectedUrl,
        canonicalUrl: issue.repro?.canonicalUrl,
        step: issue.step ?? issue.repro?.step,
        expected: issue.expected,
        actual: issue.actual,
        whyItFailed: issue.explanation?.whyItFailed ?? issue.actual ?? "Assertion failed.",
        explanation: issue.explanation ?? null,
        affectedSelector: issue.repro?.targetSelector ?? issue.selector ?? null,
        evidenceRefs: issue.evidenceRefs
      })
    );
  }

  if (mode === "accessibility") {
    return (report.accessibility?.issues ?? []).map((issue, index) =>
      normalizeFailure({
        id: issue.id ?? `a11y-${index}`,
        mode: "accessibility",
        issueType: issue.ruleId ?? issue.issueType,
        title: issue.title,
        summary: issue.summary ?? issue.actual ?? issue.title,
        testcaseId: issue.ruleId ?? issue.testcaseId ?? null,
        testcaseTitle: issue.title ?? issue.ruleId ?? null,
        severity: issue.finalSeverity ?? issue.severity,
        deviceLabel: issue.viewportLabel,
        viewportLabel: issue.viewportLabel ?? null,
        pageUrl: issue.affectedUrl,
        canonicalUrl: issue.repro?.canonicalUrl,
        step: issue.step ?? issue.repro?.step,
        expected: issue.expected,
        actual: issue.actual,
        whyItFailed: issue.explanation?.whyItFailed ?? issue.actual ?? "Accessibility rule failed.",
        explanation: issue.explanation ?? null,
        affectedSelector: issue.affectedSelector ?? issue.repro?.selector ?? null,
        evidenceRefs: issue.evidenceRefs
      })
    );
  }

  return [];
}

function collectDeviceSummary(session, report, mode) {
  const summary =
    mode === "uiux"
      ? report?.uiux?.deviceSummary ?? session?.uiux?.deviceSummary ?? []
      : mode === "functional"
        ? report?.functional?.deviceSummary ?? session?.functional?.deviceSummary ?? []
        : mode === "accessibility"
          ? report?.accessibility?.summary?.deviceSummary ?? report?.accessibility?.deviceSummary ?? session?.accessibility?.deviceSummary ?? []
          : [];

  return [...summary].sort((left, right) => {
    const severityDiff = severityRank(left.worstSeverity) - severityRank(right.worstSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    const leftFailures = Number(left.totalChecksFailed ?? left.assertionsFailed ?? 0);
    const rightFailures = Number(right.totalChecksFailed ?? right.assertionsFailed ?? 0);
    if (rightFailures !== leftFailures) {
      return rightFailures - leftFailures;
    }
    return String(left.deviceLabel ?? "").localeCompare(String(right.deviceLabel ?? ""));
  });
}

function normalizeAuthAssist(session) {
  const authAssist = session?.authAssist;
  if (authAssist && typeof authAssist === "object") {
    return authAssist;
  }

  const legacy = session?.loginAssist;
  if (!legacy || typeof legacy !== "object") {
    return null;
  }

  const normalizedState = String(legacy.state ?? "").toLowerCase();
  return {
    state:
      normalizedState === "await_for_user" || normalizedState === "wait_for_user"
        ? "awaiting_credentials"
        : normalizedState === "awaiting_otp"
          ? "awaiting_otp"
          : normalizedState === "auth_validated"
            ? "resumed"
            : normalizedState || "awaiting_credentials",
    code: null,
    reason: legacy.hint ?? "Authentication is required to continue.",
    site: legacy.domain ?? "",
    pageUrl: session?.currentUrl ?? session?.startUrl ?? "",
    loginRequired: true,
    form: {
      usernameFieldDetected: false,
      passwordFieldDetected: false,
      otpFieldDetected: normalizedState === "awaiting_otp",
      submitControlDetected: false
    },
    startedAt: legacy.startedAt ?? null,
    timeoutMs: legacy.timeoutMs ?? null,
    remainingMs: legacy.remainingMs ?? null,
    profileTag: session?.runConfig?.profileTag ?? ""
  };
}

function authStateTone(state = "") {
  if (state === "resumed" || state === "authenticated") {
    return "border-emerald-400/40 bg-emerald-500/20 text-emerald-100";
  }
  if (state === "auth_failed") {
    return "border-rose-400/40 bg-rose-500/20 text-rose-100";
  }
  if (state === "submitting_credentials" || state === "submitting_otp") {
    return "border-amber-400/40 bg-amber-500/20 text-amber-100";
  }
  return "border-cyan-400/40 bg-cyan-500/20 text-cyan-100";
}

function SkeletonPanel({ className = "" }) {
  return <div className={`animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] ${className}`} />;
}

export default function RunConsole({
  apiBase,
  sessions = [],
  socketConnected,
  fetchSession,
  fetchReport,
  submitAuthCredentials,
  submitAuthOtp,
  skipAuthCredentials,
  stopRun
}) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [report, setReport] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [evidenceViewerOpen, setEvidenceViewerOpen] = useState(false);
  const [selectedFailure, setSelectedFailure] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authOtp, setAuthOtp] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authStatusMessage, setAuthStatusMessage] = useState("");
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [stopError, setStopError] = useState("");

  const session = useMemo(
    () => sessions.find((entry) => entry.id === sessionId) ?? null,
    [sessionId, sessions]
  );

  const mode = session?.runConfig?.testMode ?? "default";

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!sessionId) {
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const [sessionPayload, reportPayload] = await Promise.all([
          fetchSession(sessionId),
          fetchReport(sessionId)
        ]);
        if (cancelled) {
          return;
        }
        setReport(reportPayload ?? sessionPayload?.report ?? null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadError(error?.message ?? "Failed to load run console.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fetchReport, fetchSession, sessionId]);

  useEffect(() => {
    if (session?.report) {
      setReport(session.report);
    }
  }, [session?.report, session?.updatedAt]);

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }

    const interval = setInterval(() => {
      const isActive = isRunActive(session?.status);
      if (!isActive && report) {
        return;
      }
      fetchSession(sessionId).catch(() => null);
      fetchReport(sessionId)
        .then((payload) => {
          if (payload) {
            setReport(payload);
          }
        })
        .catch(() => null);
    }, 5_000);

    return () => clearInterval(interval);
  }, [fetchReport, fetchSession, report, session?.status, sessionId]);

  const mergedReport = report ?? session?.report ?? null;
  const testCaseStats = session?.testCaseStats ?? {
    planned: 0,
    discovered: 0,
    completed: 0,
    failed: 0,
    passed: 0
  };
  const currentCase = selectCurrentCase(session?.testCases ?? []);
  const failures = useMemo(() => collectFailures(mergedReport, mode), [mergedReport, mode]);
  const topFailures = useMemo(
    () =>
      [...failures]
        .sort((left, right) => {
          const severityDiff = severityRank(left.severity) - severityRank(right.severity);
          if (severityDiff !== 0) {
            return severityDiff;
          }
          return String(left.pageUrl).localeCompare(String(right.pageUrl));
        })
        .slice(0, 8),
    [failures]
  );
  const uiuxCalibratedAdvisories = useMemo(() => {
    if (mode !== "uiux") {
      return [];
    }
    const issues = mergedReport?.uiux?.issues ?? [];
    return issues
      .filter((issue) => (issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL") !== "FAIL")
      .filter((issue) => issue.downgradeReason)
      .slice(0, 5);
  }, [mergedReport?.uiux?.issues, mode]);
  const deviceSummary = useMemo(
    () => collectDeviceSummary(session, mergedReport, mode),
    [mergedReport, mode, session]
  );
  const deterministicSummary = mergedReport?.summaryText?.deterministic ?? "Summary not available yet.";
  const llmSummary = mergedReport?.summaryText?.llm ?? null;
  const showStopButton = canShowStopButton(session?.status);
  const authAssist = useMemo(() => normalizeAuthAssist(session), [session]);
  const authState = authAssist?.state ?? null;
  const otpPending = Boolean(
    authAssist &&
      (
        authState === "awaiting_otp" ||
        authState === "submitting_otp" ||
        authAssist.code === "OTP_REQUIRED" ||
        authAssist.code === "OTP_INVALID"
      )
  );
  const credentialsPending = Boolean(
    authAssist &&
      (
        authState === "awaiting_username" ||
        authState === "awaiting_password" ||
        authState === "awaiting_credentials" ||
        authState === "auth_step_advanced" ||
        authState === "auth_unknown_state" ||
        authState === "submitting_credentials" ||
        (authState === "auth_failed" && !otpPending)
      )
  );
  const showAuthAssistPanel = Boolean(
    authAssist &&
      !["resumed", "authenticated"].includes(authState ?? "") &&
      (credentialsPending || otpPending || session?.status === "login-assist" || session?.status === "waiting-login")
  );

  const extractErrorMessage = (error, fallback) => {
    if (!error) {
      return fallback;
    }
    if (error?.error && typeof error.error === "object") {
      const nested = String(error.error.message ?? "").trim();
      if (nested) {
        return nested;
      }
    }
    if (typeof error?.message === "string" && error.message.trim()) {
      return error.message;
    }
    if (typeof error?.error === "string" && error.error.trim()) {
      return error.error;
    }
    return fallback;
  };

  const openEvidenceViewer = (failure) => {
    if (!failure) {
      return;
    }
    setSelectedFailure(failure);
    setEvidenceViewerOpen(true);
  };

  const submitCredentials = async (event) => {
    event.preventDefault();
    if (!sessionId || !submitAuthCredentials) {
      return;
    }
    setAuthError("");
    setAuthStatusMessage("");
    setAuthSubmitting(true);
    try {
      const response = await submitAuthCredentials(sessionId, {
        identifier: authUsername,
        username: authUsername,
        email: authUsername,
        password: authPassword
      });
      setAuthPassword("");
      setAuthStatusMessage(response?.message ?? "Credentials submitted.");
      await fetchSession(sessionId).catch(() => null);
    } catch (error) {
      setAuthError(extractErrorMessage(error, "Credential submission failed."));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const submitOtp = async (event) => {
    event.preventDefault();
    if (!sessionId || !submitAuthOtp) {
      return;
    }
    setAuthError("");
    setAuthStatusMessage("");
    setAuthSubmitting(true);
    try {
      const response = await submitAuthOtp(sessionId, {
        otp: authOtp
      });
      setAuthOtp("");
      setAuthStatusMessage(response?.message ?? "OTP submitted.");
      await fetchSession(sessionId).catch(() => null);
    } catch (error) {
      setAuthError(extractErrorMessage(error, "OTP submission failed."));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const requestResume = async () => {
    if (!sessionId) {
      return;
    }
    setAuthError("");
    setAuthStatusMessage("");
    setAuthSubmitting(true);
    try {
      await resumeSession(sessionId);
      await fetchSession(sessionId).catch(() => null);
      setAuthStatusMessage("Resume check requested.");
    } catch (error) {
      setAuthError(extractErrorMessage(error, "Failed to request resume check."));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const requestSkipCredentials = async () => {
    if (!sessionId || !skipAuthCredentials) {
      return;
    }
    setAuthError("");
    setAuthStatusMessage("");
    setAuthSubmitting(true);
    try {
      const response = await skipAuthCredentials(sessionId, {
        reason: "Credential submission skipped by user from dashboard."
      });
      setAuthStatusMessage(response?.message ?? "Authentication step skipped.");
      await fetchSession(sessionId).catch(() => null);
    } catch (error) {
      setAuthError(extractErrorMessage(error, "Failed to skip authentication step."));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const requestStop = async () => {
    if (!sessionId || !stopRun || !showStopButton) {
      return;
    }
    setStopError("");
    setStopSubmitting(true);
    try {
      const response = await stopRun(sessionId);
      if (response?.message) {
        setAuthStatusMessage(response.message);
      }
      await fetchSession(sessionId).catch(() => null);
    } catch (error) {
      setStopError(extractErrorMessage(error, "Failed to stop run."));
    } finally {
      setStopSubmitting(false);
    }
  };

  if (loading && !session) {
    return (
      <div className="h-screen bg-slate-950 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto grid h-full max-w-7xl gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(360px,1fr)]">
          <SkeletonPanel className="h-full" />
          <div className="flex h-full flex-col gap-4">
            <SkeletonPanel className="h-40" />
            <SkeletonPanel className="h-52" />
            <SkeletonPanel className="h-56" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-center">
          <h1 className="text-xl font-semibold text-white">Run not found</h1>
          <p className="mt-2 text-sm text-slate-400">This session may have expired or was deleted.</p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mt-4 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.05]"
                >
                  Dashboard
                </button>
                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(session.status)}`}>
                  {session.status}
                </span>
                <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-xs text-slate-300">
                  {mode}
                </span>
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-xs ${
                    socketConnected
                      ? "border-emerald-400/30 text-emerald-200"
                      : "border-rose-400/30 text-rose-200"
                  }`}
                >
                  {socketConnected ? "Live" : "Offline"}
                </span>
              </div>
              <p className="mt-2 truncate text-sm text-slate-300">{session.currentUrl ?? session.startUrl}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Elapsed</p>
              <p className="font-mono text-sm text-white">{formatDuration(elapsedMsForSession(session, nowMs))}</p>
            </div>
            {showStopButton ? (
              <button
                type="button"
                onClick={requestStop}
                disabled={stopSubmitting}
                className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-60"
              >
                {stopSubmitting ? "Stopping..." : "Stop"}
              </button>
            ) : null}
          </div>
          {stopError ? (
            <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-100">
              {stopError}
            </p>
          ) : null}
        </header>

        <main className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
          {loadError ? (
            <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {loadError}
            </div>
          ) : null}

          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(360px,1fr)]">
            <div className="min-h-0">
              <LiveViewer session={session} currentCase={currentCase} socketConnected={socketConnected} />
            </div>

            <aside className="min-h-0 overflow-y-auto space-y-4 pr-1">
              <RunProgress stats={testCaseStats} />

              {showAuthAssistPanel ? (
                <section className="rounded-2xl border border-cyan-300/25 bg-cyan-300/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                      Authentication Required
                    </h2>
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${authStateTone(authState)}`}>
                      {authState ?? "awaiting_credentials"}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-300">
                    <p className="truncate">Site: {authAssist?.site || "-"}</p>
                    <p className="truncate">Page: {authAssist?.pageUrl || session.currentUrl || "-"}</p>
                    <p>Profile: {session.runConfig?.profileTag || "-"}</p>
                    {authAssist?.form?.visibleStep ? (
                      <p>Visible step: {authAssist.form.visibleStep}</p>
                    ) : null}
                    {typeof authAssist?.submitAttempted === "boolean" ? (
                      <p>Submit attempted: {authAssist.submitAttempted ? "yes" : "no"}</p>
                    ) : null}
                    {typeof authAssist?.resumeTriggered === "boolean" ? (
                      <p>Resume triggered: {authAssist.resumeTriggered ? "yes" : "no"}</p>
                    ) : null}
                    {Number.isFinite(authAssist?.remainingMs) ? (
                      <p>Time remaining: {formatDuration(Number(authAssist.remainingMs))}</p>
                    ) : null}
                    <p>{authAssist?.reason || "Submit credentials to continue the run."}</p>
                  </div>

                  {credentialsPending ? (
                    <form className="mt-3 space-y-2" onSubmit={submitCredentials}>
                      <input
                        value={authUsername}
                        onChange={(event) => setAuthUsername(event.target.value)}
                        type="text"
                        autoComplete="username"
                        placeholder="Username or email"
                        className="w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-100 outline-none"
                        disabled={authSubmitting}
                      />
                      <input
                        value={authPassword}
                        onChange={(event) => setAuthPassword(event.target.value)}
                        type="password"
                        autoComplete="current-password"
                        placeholder="Password"
                        className="w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-100 outline-none"
                        disabled={authSubmitting}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="submit"
                          disabled={authSubmitting || !authUsername.trim() || !authPassword}
                          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                        >
                          {authSubmitting ? "Submitting..." : "Submit Credentials"}
                        </button>
                        <button
                          type="button"
                          onClick={requestSkipCredentials}
                          disabled={authSubmitting}
                          className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-50"
                        >
                          Skip Credentials
                        </button>
                        <button
                          type="button"
                          onClick={requestResume}
                          disabled={authSubmitting}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                        >
                          Resume Check
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {otpPending ? (
                    <form className="mt-3 space-y-2" onSubmit={submitOtp}>
                      <input
                        value={authOtp}
                        onChange={(event) => setAuthOtp(event.target.value)}
                        type="password"
                        autoComplete="one-time-code"
                        placeholder="OTP / verification code"
                        className="w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-100 outline-none"
                        disabled={authSubmitting}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="submit"
                          disabled={authSubmitting || !authOtp.trim()}
                          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-50"
                        >
                          {authSubmitting ? "Submitting..." : "Submit OTP"}
                        </button>
                        <button
                          type="button"
                          onClick={requestSkipCredentials}
                          disabled={authSubmitting}
                          className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-50"
                        >
                          Skip Login
                        </button>
                        <button
                          type="button"
                          onClick={requestResume}
                          disabled={authSubmitting}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                        >
                          Resume Check
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {authError ? (
                    <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-100">
                      {authError}
                    </p>
                  ) : null}
                  {authStatusMessage ? (
                    <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100">
                      {authStatusMessage}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Currently Running</h2>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    View failed cases
                  </button>
                </div>
                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                  <p className="font-semibold text-white">{currentCase?.caseKind ?? "No active case"}</p>
                  <p className="mt-1 text-slate-400">device: {currentCase?.deviceLabel ?? "-"}</p>
                  <p className="mt-1 truncate text-slate-400">page: {currentCase?.pageUrl ?? session.currentUrl ?? "-"}</p>
                  <p className="mt-1 text-slate-500">step: {session.currentStep ?? "-"}</p>
                </div>
              </section>

              <DeviceSummary entries={deviceSummary} />

              <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-200">Failures</h2>
                  <span className="font-mono text-xs text-slate-500">{failures.length}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {topFailures.map((failure, index) => (
                    <article
                      key={failure.id ?? `${failure.issueType}-${failure.pageUrl}-${index}`}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs cursor-pointer hover:bg-white/[0.05]"
                      onClick={() => openEvidenceViewer(failure)}
                    >
                      {failure.mode === "uiux" ? (
                        <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-rose-300/35 bg-rose-500/20 px-2 py-1 text-[10px] font-semibold text-rose-100">
                          FAILED
                        </span>
                        <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] text-slate-300">
                          {failure.severity}
                        </span>
                        {failure.grouped ? (
                          <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 font-semibold text-[10px] text-cyan-100">
                            {failure.occurrenceCount} devices
                          </span>
                        ) : (
                          <span className="rounded-full border border-cyan-300/20 px-2 py-1 font-semibold text-[10px] text-cyan-100">
                            {failure.deviceLabel}
                          </span>
                        )}
                        {failure.viewportLabel ? (
                          <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] text-slate-400">
                            {failure.viewportLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 font-semibold text-white">{failure.title}</p>
                      <p className="mt-1 text-slate-300">{failure.summary || "Issue detected in the current UI state."}</p>
                      <p className="mt-1 text-slate-500">Why failed: {failure.whyItFailed || failure.actual || "No additional detail."}</p>
                      <p className="mt-1 truncate text-slate-400">{failure.pageUrl || "-"}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Check: {failure.testcaseTitle || failure.testcaseId || failure.issueType}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Affected devices: {failure.occurrenceCount}
                      </p>
                      {failure.devices?.length ? (
                        <p className="mt-1 text-[11px] text-slate-400">
                          {failure.devices
                            .slice(0, 3)
                            .map((device) => device.deviceLabel || device.viewportLabel)
                            .join(", ")}
                          {failure.devices.length > 3 ? ` +${failure.devices.length - 3} more` : ""}
                        </p>
                      ) : null}
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] text-slate-300">
                              {failure.severity}
                            </span>
                            <span className="rounded-full border border-cyan-300/20 px-2 py-1 font-semibold text-[10px] text-cyan-100">
                              {failure.deviceLabel}
                            </span>
                          </div>
                          <p className="mt-2 font-semibold text-white">{failure.title}</p>
                          <p className="mt-1 truncate text-slate-400">{failure.pageUrl || "-"}</p>
                          <p className="mt-1 text-slate-500">{failure.actual || "No additional detail."}</p>
                        </>
                      )}
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEvidenceViewer(failure);
                          }}
                          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                        >
                          {failure.mode === "uiux" ? "Open evidence" : "View evidence"}
                        </button>
                      </div>
                    </article>
                  ))}
                  {!topFailures.length ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-500">
                      No failures captured yet.
                    </div>
                  ) : null}
                </div>
              </section>

              {mode === "uiux" ? (
                <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
                      Calibrated Advisories
                    </h2>
                    <span className="font-mono text-xs text-slate-500">{uiuxCalibratedAdvisories.length}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {uiuxCalibratedAdvisories.length ? (
                      uiuxCalibratedAdvisories.map((issue, index) => (
                        <article
                          key={`uiux-advisory-${issue.id ?? issue.issueType}-${index}`}
                          className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs"
                        >
                          <p className="font-semibold text-white">{issue.title ?? issue.issueType}</p>
                          <p className="mt-1 text-slate-300">
                            Detector: {issue.rawDetectorResult?.verdict ?? "FAIL"} | Model: {issue.llmJudgment?.verdict ?? "WARN"} | Final: {issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "WARN"}
                          </p>
                          <p className="mt-1 text-slate-500">
                            Downgrade reason: {issue.downgradeReason}
                          </p>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-500">
                        No advisory downgrades recorded.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Summary</h2>
                <p className="mt-2 text-xs leading-5 text-slate-300">{deterministicSummary}</p>
                {llmSummary ? (
                  <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-2 text-xs leading-5 text-cyan-100">
                    {llmSummary}
                  </div>
                ) : null}
              </section>

              <ArtifactsList artifacts={mergedReport?.artifacts ?? session.artifactIndex ?? {}} apiBase={apiBase} />
            </aside>
          </div>
        </main>
      </div>

      <FailuresDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        failures={failures}
        onSelectFailure={(failure) => {
          setDrawerOpen(false);
          openEvidenceViewer(failure);
        }}
      />
      <EvidenceViewer
        open={evidenceViewerOpen}
        onClose={() => setEvidenceViewerOpen(false)}
        failure={selectedFailure}
        apiBase={apiBase}
      />
    </div>
  );
}
