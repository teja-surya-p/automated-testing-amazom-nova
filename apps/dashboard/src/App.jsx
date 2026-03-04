import { AnimatePresence, motion } from "framer-motion";
import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
const socket = io(API_BASE, {
  transports: ["websocket"],
  autoConnect: true,
  reconnection: true
});

const sampleGoals = [
  "Create a new user",
  "Find a way to check out without a credit card",
  "Detect whether the checkout flow is blocked by a popup"
];

function toAbsoluteUrl(value) {
  if (!value) {
    return null;
  }

  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }

  return `${API_BASE}${value}`;
}

function summarizeSocketState(connected) {
  return connected
    ? {
        label: "Live",
        tone: "bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.55)]",
        text: "Socket linked to Nova Sentinel"
      }
    : {
        label: "Offline",
        tone: "bg-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.55)]",
        text: "Socket link degraded"
      };
}

function mergeIncident(existing, incoming) {
  const next = [incoming, ...existing.filter((item) => item.sessionId !== incoming.sessionId)];
  return next.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
}

function incidentFromSession(session) {
  if (!session?.bug) {
    return null;
  }

  return {
    sessionId: session.id,
    type: session.bug.type,
    severity: session.bug.severity,
    summary: session.bug.summary,
    evidenceStatus: session.evidence?.status ?? "ready",
    evidenceProvider: session.evidence?.provider ?? "unknown",
    evidenceSummary: session.evidence?.summary ?? "",
    videoUrl: session.evidence?.videoUrl ?? null,
    updatedAt: session.updatedAt
  };
}

function thoughtFromPayload(payload) {
  const timestamp = payload.timestamp ?? new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sessionId: payload.sessionId,
    step: payload.step,
    phase: payload.phase ?? "before-action",
    status: payload.status,
    ghost: false,
    title: payload.title ?? payload.stepTitle ?? payload.action ?? "Reviewing current state",
    action: payload.action ?? payload.title ?? "Reviewing current state",
    details: payload.details ?? payload.reasoning ?? "No reasoning provided.",
    reasoning: payload.reasoning ?? payload.details ?? "No reasoning provided.",
    blockers: payload.blockers ?? [],
    nextBestAction: payload.nextBestAction ?? null,
    targetAchieved: Boolean(payload.targetAchieved),
    evidenceQualityScore: Number(payload.evidenceQualityScore ?? 0),
    landmark: payload.landmark ?? null,
    targetText: payload.targetText ?? null,
    targetCoordinates: payload.targetCoordinates ?? null,
    verification: payload.verification ?? null,
    confidence: Number(payload.confidence ?? payload.confidenceScore ?? 0),
    confidenceScore: Number(payload.confidence ?? payload.confidenceScore ?? 0),
    raw: payload.raw ?? "{}",
    timestamp,
    at: new Date(timestamp).toLocaleTimeString()
  };
}

function getThoughtOutcome(log) {
  if (log.ghost) {
    return {
      label: "In Progress",
      detail: "Success: Pending",
      tone: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
    };
  }

  if (log.status === "success") {
    return {
      label: "Success",
      detail: "Success: Yes",
      tone: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
    };
  }

  if (log.status === "bug") {
    return {
      label: "Failed",
      detail: "Success: No",
      tone: "border-rose-300/20 bg-rose-400/10 text-rose-100"
    };
  }

  if (log.status === "recoverable") {
    return {
      label: "Blocked",
      detail: "Success: No",
      tone: "border-amber-300/20 bg-amber-400/10 text-amber-100"
    };
  }

  return {
    label: "Continuing",
    detail: "Success: No",
    tone: "border-slate-300/15 bg-white/[0.04] text-slate-200"
  };
}

function ghostThoughtFromPayload(payload) {
  const timestamp = payload.timestamp ?? new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sessionId: payload.sessionId,
    step: payload.step,
    phase: payload.phase ?? "before-action",
    status: payload.status ?? "thinking",
    ghost: true,
    title: payload.title ?? "Analyzing current view...",
    action: payload.action ?? "Analyzing current view...",
    details: payload.details ?? "Nova Auditor is processing the current screenshot.",
    reasoning: payload.details ?? "Nova Auditor is processing the current screenshot.",
    landmark: payload.landmark ?? null,
    targetText: payload.targetText ?? null,
    targetCoordinates: payload.targetCoordinates ?? null,
    verification: payload.verification ?? null,
    confidence: null,
    confidenceScore: null,
    raw: null,
    timestamp,
    at: new Date(timestamp).toLocaleTimeString()
  };
}

function isSameThoughtMove(entry, payload) {
  return (
    entry.sessionId === payload.sessionId &&
    entry.step === payload.step &&
    (entry.phase ?? "before-action") === (payload.phase ?? "before-action")
  );
}

function selectPreferredSession(sessions) {
  return (
    sessions.find((session) => session.status === "running")?.id ??
    sessions.find((session) => session.status === "queued")?.id ??
    sessions[0]?.id ??
    null
  );
}

function StatusPill({ status }) {
  const tone =
    status === "passed"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : status === "soft-passed"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : status === "failed"
        ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
        : status === "waiting-login"
          ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
        : status === "running"
          ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
          : "border-white/10 bg-white/5 text-slate-300";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] ${tone}`}>
      {status ?? "idle"}
    </span>
  );
}

function HighlightOverlay({ highlight }) {
  if (!highlight) {
    return null;
  }

  const toneClasses =
    highlight.tone === "rose"
      ? "border-rose-300/90 shadow-[0_0_45px_rgba(251,113,133,0.45)]"
      : highlight.tone === "amber"
        ? "border-amber-300/90 shadow-[0_0_45px_rgba(251,191,36,0.4)]"
        : highlight.tone === "violet"
          ? "border-violet-300/90 shadow-[0_0_45px_rgba(196,181,253,0.45)]"
          : "border-cyan-300/90 shadow-[0_0_45px_rgba(103,232,249,0.45)]";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22 }}
        className={`absolute rounded-full border-2 bg-white/[0.02] ${toneClasses}`}
        style={{
          left: `${highlight.xPct}%`,
          top: `${highlight.yPct}%`,
          width: `${highlight.widthPct}%`,
          height: `${highlight.heightPct}%`
        }}
      >
        <div className="absolute inset-[-12px] rounded-full border border-white/15 animate-pulse" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, delay: 0.08 }}
        className="absolute rounded-full border border-white/15 bg-slate-950/90 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-white shadow-panel"
        style={{
          left: `${Math.min(highlight.xPct + 1, 78)}%`,
          top: `${Math.max(highlight.yPct - 4, 2)}%`
        }}
      >
        {highlight.label}
      </motion.div>
    </div>
  );
}

function RailTabs({ tab, setTab }) {
  return (
    <div className="flex rounded-2xl border border-white/10 bg-slate-900/80 p-1 xl:hidden">
      {[
        ["thoughts", "Thought Stream"],
        ["incidents", "Incident Archive"]
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setTab(value)}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.24em] transition ${
            tab === value
              ? "bg-cyan-400/10 text-cyan-200"
              : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PanelShell({ title, accent, children, headerSlot = null, className = "", bodyClassName = "" }) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-3xl border border-white/10 bg-slate-900/80 shadow-panel backdrop-blur ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <p className={`text-[11px] font-semibold uppercase tracking-[0.32em] ${accent}`}>{title}</p>
        {headerSlot}
      </div>
      <div className={`min-h-0 flex-1 p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function humanizeAction(action) {
  if (!action) {
    return "Pending";
  }

  if (typeof action === "string") {
    return action;
  }

  if (action.type === "click") {
    return "Click";
  }
  if (action.type === "type") {
    return `Type${action.text ? ` "${action.text}"` : ""}`;
  }
  if (action.type === "wait") {
    return "Wait";
  }
  if (action.type === "scroll") {
    return "Scroll";
  }
  if (action.type === "goto") {
    return `Go to ${action.url ?? "target"}`;
  }
  if (action.type === "refresh") {
    return "Refresh";
  }
  if (action.type === "back") {
    return "Go back";
  }
  if (action.type === "done") {
    return "Complete";
  }

  return action.type ?? "Pending";
}

function stepResultTone(result) {
  if (result === "advanced") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-100";
  }
  if (result === "no-effect") {
    return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  }
  if (result === "planned" || result === "observed") {
    return "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
  }

  return "border-white/10 bg-white/[0.04] text-slate-300";
}

function OutcomeBadge({ outcome }) {
  const tone =
    outcome === "PASS"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : outcome === "SOFT-PASS"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
        : outcome === "FAIL"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
          : "border-white/10 bg-white/[0.03] text-slate-300";

  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] ${tone}`}>
      {outcome ?? "Active"}
    </span>
  );
}

function RunSummaryPanel({ session, onResumeLogin }) {
  const summary = session?.runSummary ?? null;
  const blocker = summary?.primaryBlocker ?? session?.primaryBlocker ?? null;
  const confidence = Math.round((blocker?.confidence ?? 0) * 100);
  const steps = [...(session?.steps ?? [])].sort((left, right) => left.stepId - right.stepId);

  return (
    <PanelShell
      title="Run Summary"
      accent="text-amber-200"
      headerSlot={<OutcomeBadge outcome={summary?.outcome} />}
      className="h-full"
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Primary Blocker</p>
          <p className="mt-3 text-sm font-semibold text-white">{blocker?.type ?? "None"}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {blocker?.rationale ?? "The run is currently exploring without a confirmed blocker."}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-amber-300" style={{ width: `${confidence}%` }} />
          </div>
          <p className="mt-2 font-mono text-xs text-slate-500">{confidence}% confidence</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Next Best Action</p>
            <p className="mt-3 text-sm font-semibold text-cyan-100">
              {summary?.nextBestAction ?? session?.outcome?.nextBestAction ?? "CONTINUE"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Evidence Quality</p>
            <p className="mt-3 text-sm font-semibold text-white">
              {Math.round((summary?.evidenceQualityScore ?? session?.outcome?.evidenceQualityScore ?? 0) * 100)}%
            </p>
          </div>
        </div>

        {session?.loginAssist?.state === "WAIT_FOR_USER" ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100">Login Required</p>
            <p className="mt-3 text-sm leading-6 text-amber-50/90">
              Complete authentication in the controlled browser for {session.loginAssist.domain}, then resume the run.
            </p>
            <button
              type="button"
              onClick={onResumeLogin}
              className="mt-4 rounded-full border border-amber-200/30 bg-amber-200/10 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-200/20"
            >
              Resume
            </button>
          </div>
        ) : null}

        <div className="min-h-0 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">Run Steps</p>
            <span className="font-mono text-xs text-slate-500">{steps.length} recorded</span>
          </div>

          <div className="mt-4 max-h-[22rem] space-y-3 overflow-y-auto pr-1">
            {steps.length ? (
              steps.map((step) => (
                <div key={step.stepId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-200">
                        Step {step.stepId}
                      </p>
                      <h3 className="mt-2 text-sm font-semibold text-white">
                        {step.actionPlan?.thinking ?? humanizeAction(step.actionPlan?.action)}
                      </h3>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${stepResultTone(step.result)}`}
                    >
                      {step.result ?? "pending"}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-slate-400">
                    <p>
                      <span className="text-slate-500">Planned:</span> {humanizeAction(step.actionPlan?.action)}
                    </p>
                    <p>
                      <span className="text-slate-500">Attempted:</span> {humanizeAction(step.actionAttempted)}
                    </p>
                    {step.postConditions?.length ? (
                      <p className="line-clamp-2">
                        <span className="text-slate-500">Checks:</span> {step.postConditions.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-slate-500">
                Step records will appear here as the run advances.
              </div>
            )}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

function LiveFeedPanel({ screenshot, session, latestThought, highlight, onResumeLogin }) {
  const liveUrl = session?.currentUrl ?? session?.startUrl ?? null;

  return (
    <PanelShell
      title="Live Observer (Nova Act)"
      accent="text-cyan-300"
      headerSlot={<StatusPill status={session?.status} />}
      className="min-h-[28rem]"
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        {session?.loginAssist?.state === "WAIT_FOR_USER" ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-100">
                  Login Assist
                </p>
                <p className="mt-2 text-sm leading-6 text-amber-50/90">
                  Authentication is required on {session.loginAssist.domain}. Complete the login in the controlled
                  browser window, then resume.
                </p>
              </div>
              <button
                type="button"
                onClick={onResumeLogin}
                className="rounded-full border border-amber-200/30 bg-amber-200/10 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-200/20"
              >
                Resume
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 rounded-2xl border border-cyan-400/20 bg-slate-950/70 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <h2 className="max-w-xl text-2xl font-semibold leading-tight text-white sm:text-3xl">
              {session?.goal ?? "Awaiting mission objective"}
            </h2>
            <p className="mt-3 break-all text-sm text-slate-400">
              {session?.currentUrl ?? "Launch a run to stream the agent browser here in real time."}
            </p>
          </div>
          <div className="grid gap-3 text-xs uppercase tracking-[0.2em] text-slate-400">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <span className="block text-[10px] text-slate-500">Session</span>
              <strong className="mt-2 block break-all font-mono text-sm text-slate-100">
                {session?.id ?? "unbound"}
              </strong>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <span className="block text-[10px] text-slate-500">Auditor Action</span>
              <strong className="mt-2 block text-sm normal-case tracking-normal text-slate-100">
                {latestThought?.title ?? latestThought?.action ?? "Monitoring"}
              </strong>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-slate-950">
          <div className="absolute inset-0 animate-pulse-grid bg-[linear-gradient(rgba(34,211,238,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.06)_1px,transparent_1px)] bg-[size:34px_34px]" />
          <div className="relative z-10 max-h-[22rem] overflow-auto lg:max-h-[30rem] xl:max-h-[36rem]">
            {screenshot ? (
              <div className="relative">
                <img src={screenshot} alt="Live browser observer" className="block w-full h-auto" />
                <HighlightOverlay highlight={highlight} />
              </div>
            ) : (
              <div className="flex min-h-[22rem] items-center justify-center px-6 text-center text-sm text-slate-400 lg:min-h-[30rem] xl:min-h-[36rem]">
                Nova Sentinel is standing by for a target URL.
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">Reasoning</p>
            <p className="mt-3 text-sm leading-6 text-slate-200">
              {latestThought?.details ?? latestThought?.reasoning ?? session?.lastAudit ?? "The Auditor stream will appear here."}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-violet-300">Confidence</p>
            <p className="mt-3 text-4xl font-semibold text-white">
              {typeof latestThought?.confidenceScore === "number" ? `${Math.round(latestThought.confidenceScore)}%` : "--"}
            </p>
            <p className="mt-2 text-xs text-slate-400">Confidence is taken from the active Auditor payload.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">Live Test Access</p>
            <p className="mt-2 break-all text-sm text-slate-400">
              {liveUrl ?? "A target URL will appear here once the run starts."}
            </p>
          </div>

          {liveUrl ? (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
            >
              Open Live Target
            </a>
          ) : null}
        </div>
      </div>
    </PanelShell>
  );
}

function ThoughtStreamPanel({ logs, selectedSessionId }) {
  const filteredLogs = selectedSessionId ? logs.filter((log) => log.sessionId === selectedSessionId) : logs;

  return (
    <PanelShell
      title="Thought Stream"
      accent="text-emerald-300"
      headerSlot={<span className="font-mono text-xs text-slate-500">buffer {filteredLogs.length}/50</span>}
      className="h-full"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-xs leading-6 text-slate-400">
          Each step is collapsed by default so the stream stays responsive. Open any row to inspect the reasoning,
          success state, and raw Bedrock output.
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {filteredLogs.length ? (
              filteredLogs.map((log, index) => {
                const outcome = getThoughtOutcome(log);

                return (
                <motion.details
                  key={log.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                  open={log.ghost || index === 0}
                  className={`group rounded-2xl border shadow-[0_12px_40px_rgba(3,7,18,0.35)] ${
                    log.ghost
                      ? "border-cyan-300/20 bg-cyan-400/[0.05]"
                      : "border-emerald-400/15 bg-slate-950/80"
                  }`}
                >
                  <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-mono text-[10px] uppercase tracking-[0.24em] ${
                            log.ghost ? "text-cyan-200" : "text-emerald-300"
                          }`}
                        >
                          Step {log.step}
                        </span>
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${outcome.tone}`}>
                          {outcome.label}
                        </span>
                        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                          {outcome.detail}
                        </span>
                      </div>

                      <h3 className="mt-3 text-sm font-semibold text-white sm:text-base">{log.title}</h3>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">{log.details}</p>
                      {log.landmark ? (
                        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/90">
                          Landmark: {log.landmark}
                        </p>
                      ) : null}
                      {log.targetText ? (
                        <p className="mt-1 text-xs text-slate-400">Target: {log.targetText}</p>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
                      <span className="font-mono text-xs text-slate-500">{log.at}</span>
                      <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 sm:mt-4">
                        <span className="transition group-open:rotate-180">⌄</span>
                        Expand
                      </span>
                    </div>
                  </summary>

                  <div className="border-t border-white/10 px-4 py-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem]">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p
                          className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${
                            log.ghost ? "text-cyan-200" : "text-slate-300"
                          }`}
                        >
                          Reasoning
                        </p>
                        <p className={`mt-3 text-sm leading-6 ${log.ghost ? "text-cyan-50/80" : "text-slate-300"}`}>
                          {log.details}
                        </p>
                        {log.verification ? (
                          <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.05] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
                              Verification
                            </p>
                            <p className="mt-2 text-sm leading-6 text-cyan-50/90">{log.verification}</p>
                          </div>
                        ) : null}
                        {log.blockers?.length ? (
                          <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100">
                              Blockers
                            </p>
                            <p className="mt-2 text-sm leading-6 text-amber-50/90">
                              {log.blockers.map((blocker) => blocker.type).join(", ")}
                            </p>
                          </div>
                        ) : null}
                        {log.targetCoordinates ? (
                          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                              Semantic Center
                            </p>
                            <p className="mt-2 font-mono text-sm text-slate-200">
                              [{Math.round(log.targetCoordinates[0])}, {Math.round(log.targetCoordinates[1])}]
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <div className="grid gap-3">
                        {log.landmark ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                              Landmark
                            </p>
                            <p className="mt-3 text-sm font-semibold text-white">{log.landmark}</p>
                          </div>
                        ) : null}

                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                            Step Result
                          </p>
                          <p className="mt-3 text-sm font-semibold text-white">{outcome.detail}</p>
                        </div>

                        {log.ghost ? (
                          <div className="flex items-center gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.04] px-3 py-4">
                            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
                            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/90">
                              Nova is reasoning in Frankfurt
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                                Confidence
                              </p>
                              <p className="mt-3 font-mono text-2xl text-cyan-200">{Math.round(log.confidenceScore)}%</p>
                            </div>
                            {log.nextBestAction ? (
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                                  Next Best Action
                                </p>
                                <p className="mt-3 text-sm font-semibold text-white">{log.nextBestAction}</p>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>

                    {!log.ghost ? (
                      <details className="mt-4 rounded-2xl border border-white/10 bg-black/25">
                        <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-400">
                          Raw JSON
                        </summary>
                        <pre className="overflow-x-auto border-t border-white/10 px-4 py-4 font-mono text-[11px] leading-6 text-cyan-100">
                          {log.raw}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </motion.details>
                );
              })
            
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex h-full min-h-[18rem] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 text-center text-sm text-slate-500"
              >
                The Auditor has not emitted any reasoning yet.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PanelShell>
  );
}

function IncidentCard({ incident, selected, onSelect }) {
  const isReady = incident.evidenceStatus === "ready";
  const videoUrl = toAbsoluteUrl(incident.videoUrl);

  return (
    <motion.button
      layout
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-rose-400/50 bg-rose-400/10"
          : "border-white/10 bg-white/[0.03] hover:border-rose-400/30 hover:bg-rose-400/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-rose-300">{incident.type}</p>
          <h3 className="mt-2 text-sm font-semibold leading-6 text-white">{incident.summary}</h3>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-slate-300">
          {incident.severity}
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-400">Session {incident.sessionId}</p>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
        {isReady && videoUrl ? (
          <video src={videoUrl} controls className="aspect-video w-full bg-black" preload="metadata" />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-[radial-gradient(circle_at_top,rgba(248,113,113,0.18),transparent_60%),linear-gradient(160deg,#0f172a,#020617)]">
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-rose-300/20 border-t-rose-300" />
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-rose-200">Generating Video...</p>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs leading-6 text-slate-400">
        {incident.evidenceSummary || "Awaiting incident media."}
      </p>
    </motion.button>
  );
}

function IncidentArchivePanel({ incidents, selectedSessionId, onSelectSession }) {
  return (
    <PanelShell
      title="Incident Archive (Nova Reel)"
      accent="text-rose-300"
      headerSlot={<span className="font-mono text-xs text-slate-500">{incidents.length} incidents</span>}
      className="h-full"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-xs leading-6 text-slate-400">
          Incident cards stay hydrated while evidence is rendering. Judges see clear loading state instead of an empty
          broken panel.
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {incidents.length ? (
              incidents.map((incident) => (
                <IncidentCard
                  key={incident.sessionId}
                  incident={incident}
                  selected={incident.sessionId === selectedSessionId}
                  onSelect={() => onSelectSession(incident.sessionId)}
                />
              ))
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex h-full min-h-[18rem] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 text-center text-sm text-slate-500"
              >
                No incidents archived yet. Trigger a chaos case to populate this panel.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PanelShell>
  );
}

export default function App() {
  const [goal, setGoal] = useState(sampleGoals[1]);
  const [startUrl, setStartUrl] = useState("http://localhost:4174/store");
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [screenshot, setScreenshot] = useState(null);
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [launching, setLaunching] = useState(false);
  const [railTab, setRailTab] = useState("thoughts");
  const [highlightsBySession, setHighlightsBySession] = useState({});
  const selectedSessionIdRef = useRef(selectedSessionId);

  const deferredLogs = useDeferredValue(logs);
  const deferredIncidents = useDeferredValue(incidents);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  async function refreshSessions() {
    const response = await fetch(`${API_BASE}/api/sessions`);
    const data = await response.json();

    setSessions(data);

    const knownIncidents = data.map(incidentFromSession).filter(Boolean);
    startTransition(() => {
      setIncidents((current) => {
        let next = [...current];
        for (const incident of knownIncidents) {
          next = mergeIncident(next, incident);
        }
        return next;
      });
    });

    setSelectedSessionId((current) => current ?? selectPreferredSession(data));
  }

  useEffect(() => {
    refreshSessions().catch(console.error);
  }, []);

  useEffect(() => {
    function handleConnect() {
      setSocketConnected(true);
    }

    function handleDisconnect() {
      setSocketConnected(false);
    }

    function handleSessionCreated(payload) {
      setSelectedSessionId(payload.sessionId);
      setSessions((current) => [payload.session, ...current.filter((item) => item.id !== payload.session.id)]);
    }

    function handleSessionUpdated(payload) {
      setSessions((current) => [payload.session, ...current.filter((item) => item.id !== payload.session.id)]);
      if (!selectedSessionIdRef.current) {
        setSelectedSessionId(payload.sessionId);
      }
    }

    function handleUiUpdate(payload) {
      if (!selectedSessionIdRef.current || payload.sessionId === selectedSessionIdRef.current) {
        setScreenshot(payload.image);
      }

      setSessions((current) =>
        current.map((session) =>
          session.id === payload.sessionId
            ? {
                ...session,
                frame: payload.image,
                currentUrl: payload.url,
                currentStep: payload.step
              }
            : session
        )
      );

      setSelectedSessionId((current) => current ?? payload.sessionId);
    }

    function handleThought(payload) {
      startTransition(() => {
        setLogs((current) =>
          [thoughtFromPayload(payload), ...current.filter((entry) => !isSameThoughtMove(entry, payload))].slice(0, 50)
        );
      });
      if (Object.prototype.hasOwnProperty.call(payload, "highlight")) {
        setHighlightsBySession((current) => ({
          ...current,
          [payload.sessionId]: payload.highlight ?? null
        }));
      }
    }

    function handleStartingMove(payload) {
      startTransition(() => {
        setLogs((current) =>
          [ghostThoughtFromPayload(payload), ...current.filter((entry) => !isSameThoughtMove(entry, payload))].slice(
            0,
            50
          )
        );
      });
    }

    function handleBugPayload(payload) {
      startTransition(() => {
        setIncidents((current) =>
          mergeIncident(current, {
            ...payload,
            updatedAt: new Date().toISOString()
          })
        );
      });
      refreshSessions().catch(console.error);
    }

    function handleSessionTerminal() {
      refreshSessions().catch(console.error);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("session.created", handleSessionCreated);
    socket.on("session.updated", handleSessionUpdated);
    socket.on("ui-update", handleUiUpdate);
    socket.on("ai-starting-move", handleStartingMove);
    socket.on("ai-thought", handleThought);
    socket.on("bug-found", handleBugPayload);
    socket.on("incident-updated", handleBugPayload);
    socket.on("session.passed", handleSessionTerminal);
    socket.on("session.soft-passed", handleSessionTerminal);
    socket.on("session.failed", handleSessionTerminal);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("session.created", handleSessionCreated);
      socket.off("session.updated", handleSessionUpdated);
      socket.off("ui-update", handleUiUpdate);
      socket.off("ai-starting-move", handleStartingMove);
      socket.off("ai-thought", handleThought);
      socket.off("bug-found", handleBugPayload);
      socket.off("incident-updated", handleBugPayload);
      socket.off("session.passed", handleSessionTerminal);
      socket.off("session.soft-passed", handleSessionTerminal);
      socket.off("session.failed", handleSessionTerminal);
    };
  }, []);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
  const latestThought =
    deferredLogs.find((entry) => entry.sessionId === (selectedSession?.id ?? selectedSessionId)) ??
    deferredLogs[0] ??
    null;
  const activeHighlight =
    highlightsBySession[selectedSession?.id ?? selectedSessionId] ?? selectedSession?.currentHighlight ?? null;
  const statusMeta = summarizeSocketState(socketConnected);

  useEffect(() => {
    if (selectedSession?.frame) {
      setScreenshot(selectedSession.frame);
    }
  }, [selectedSession?.frame]);

  async function startRun(event) {
    event.preventDefault();
    setLaunching(true);

    try {
      const response = await fetch(`${API_BASE}/api/sessions/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          goal,
          startUrl
        })
      });

      const data = await response.json();
      setSelectedSessionId(data.id);
      await refreshSessions();
    } finally {
      setLaunching(false);
    }
  }

  async function resumeLoginAssist() {
    if (!selectedSession?.id) {
      return;
    }

    await fetch(`${API_BASE}/api/sessions/${selectedSession.id}/resume`, {
      method: "POST"
    });
    await refreshSessions();
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_22rem),radial-gradient(circle_at_top_right,rgba(244,63,94,0.12),transparent_20rem),linear-gradient(165deg,#020617,#0f172a_55%,#030712)] text-slate-100">
      <AnimatePresence>
        {!socketConnected ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur"
          >
            <div className="rounded-3xl border border-rose-400/20 bg-slate-900/90 px-8 py-6 text-center shadow-panel">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-rose-300/20 border-t-rose-300" />
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.32em] text-rose-200">
                Reconnecting to Nova Sentinel...
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mx-auto flex min-h-screen max-w-[1880px] flex-col gap-4 p-3 sm:p-4">
        <header className="rounded-3xl border border-white/10 bg-slate-900/75 px-4 py-4 shadow-panel backdrop-blur sm:px-5 sm:py-5">
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(34rem,46rem)]">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`h-3 w-3 rounded-full ${statusMeta.tone}`} />
                <span className="text-xs font-semibold uppercase tracking-[0.36em] text-slate-300">
                  {statusMeta.label}
                </span>
                <span className="hidden text-xs text-slate-500 sm:inline">{statusMeta.text}</span>
              </div>

              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">Sentinel Dashboard</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                  Observe Nova-driven intent testing in real time. The live feed gets priority, while the thought
                  stream and incident archive compress intelligently on smaller screens.
                </p>
              </div>
            </div>

            <form className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4" onSubmit={startRun}>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
                <label className="grid gap-2 text-sm text-slate-400">
                  Goal
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none ring-0 transition focus:border-cyan-400/40"
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    list="goal-presets"
                  />
                </label>
                <label className="grid gap-2 text-sm text-slate-400">
                  Target URL
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none ring-0 transition focus:border-cyan-400/40"
                    value={startUrl}
                    onChange={(event) => setStartUrl(event.target.value)}
                  />
                </label>
              </div>

              <datalist id="goal-presets">
                {sampleGoals.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap gap-2">
                  {sessions.slice(0, 4).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedSessionId(session.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-mono transition ${
                        session.id === selectedSession?.id
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                          : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20"
                      }`}
                    >
                      {session.id}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={launching}
                  className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {launching ? "Launching..." : "Launch Sentinel Run"}
                </button>
              </div>
            </form>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-4 xl:grid-cols-12">
          <div className="min-h-0 xl:col-span-7 2xl:col-span-8">
            <LiveFeedPanel
              screenshot={screenshot}
              session={selectedSession}
              latestThought={latestThought}
              highlight={activeHighlight}
              onResumeLogin={resumeLoginAssist}
            />
          </div>

          <div className="min-h-0 xl:col-span-5 2xl:col-span-4">
            <div className="flex h-full min-h-0 flex-col gap-4">
              <RunSummaryPanel session={selectedSession} onResumeLogin={resumeLoginAssist} />
              <RailTabs tab={railTab} setTab={setRailTab} />

              <div className="hidden min-h-0 flex-1 gap-4 xl:grid xl:grid-rows-2 2xl:grid-cols-1 2xl:grid-rows-2">
                <ThoughtStreamPanel logs={deferredLogs} selectedSessionId={selectedSession?.id ?? selectedSessionId} />
                <IncidentArchivePanel
                  incidents={deferredIncidents}
                  selectedSessionId={selectedSession?.id ?? selectedSessionId}
                  onSelectSession={setSelectedSessionId}
                />
              </div>

              <div className="min-h-0 xl:hidden">
                {railTab === "thoughts" ? (
                  <ThoughtStreamPanel logs={deferredLogs} selectedSessionId={selectedSession?.id ?? selectedSessionId} />
                ) : (
                  <IncidentArchivePanel
                    incidents={deferredIncidents}
                    selectedSessionId={selectedSession?.id ?? selectedSessionId}
                    onSelectSession={setSelectedSessionId}
                  />
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
