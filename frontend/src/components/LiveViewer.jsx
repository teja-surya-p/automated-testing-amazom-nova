import { useEffect, useState } from "react";
import { getLiveViewerFullscreenLabel } from "../lib/dashboardUi";

function formatTimestamp(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString();
}

function normalizeActivityEntry(entry = null) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const message = String(entry.message ?? "").trim();
  if (!message) {
    return null;
  }
  const phase = String(entry.phase ?? "").trim().toLowerCase();
  const status = String(entry.status ?? "").trim().toLowerCase();
  return {
    message,
    phase: phase || null,
    status: status || null
  };
}

export default function LiveViewer({ session, currentCase, socketConnected }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const frame = session?.frame ?? null;
  const frameTitle = String(session?.frameTitle ?? "").trim();
  const currentAction = normalizeActivityEntry(session?.currentAction);
  const nextAction = normalizeActivityEntry(session?.nextAction);
  const recentActivity = (Array.isArray(session?.agentActivity) ? session.agentActivity : [])
    .slice(-6)
    .map((entry) => normalizeActivityEntry(entry))
    .filter(Boolean)
    .reverse();
  const steps = Array.isArray(session?.steps) ? [...session.steps] : [];
  const currentStepRecord = steps
    .sort((left, right) => (right.stepId ?? 0) - (left.stepId ?? 0))
    .find((entry) => Number(entry.stepId) === Number(session?.currentStep)) ?? steps[0] ?? null;

  useEffect(() => {
    if (!isFullscreen) {
      return undefined;
    }
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isFullscreen]);

  return (
    <>
      <section className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-slate-950/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Live Viewer</h2>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                socketConnected
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                  : "border-rose-400/40 bg-rose-500/20 text-rose-100"
              }`}
            >
              {socketConnected ? "Streaming" : "Waiting"}
            </span>
            <button
              type="button"
              onClick={() => setIsFullscreen((current) => !current)}
              className="rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-white/30"
            >
              {getLiveViewerFullscreenLabel(isFullscreen)}
            </button>
          </div>
        </div>

        <div className="mt-3 flex-1 overflow-hidden rounded-xl border border-white/10 bg-slate-900">
          {frame ? (
            <img src={frame} alt="Live run screenshot" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Waiting for first screenshot…
            </div>
          )}
        </div>

        <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-xs">
          <p className="truncate text-slate-200">{frameTitle || currentAction?.message || "Live capture active."}</p>
          <p className="mt-1 text-[11px] text-slate-500">Updated: {formatTimestamp(session?.updatedAt)}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300">
            <p className="uppercase tracking-[0.18em] text-slate-500">Current Step</p>
            <p className="mt-1 font-mono text-sm text-white">{session?.currentStep ?? "-"}</p>
            <p className="mt-1 truncate text-slate-400">{session?.currentUrl ?? session?.startUrl ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300">
            <p className="uppercase tracking-[0.18em] text-slate-500">Currently Running</p>
            <p className="mt-1 font-semibold text-white">{currentCase?.caseKind ?? "Awaiting case"}</p>
            <p className="mt-1 text-slate-400">{currentCase?.deviceLabel ?? "-"}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
            <p className="uppercase tracking-[0.16em] text-slate-500">Current Action</p>
            <p className="mt-1 text-slate-100">{currentAction?.message ?? "Waiting for next action"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
            <p className="uppercase tracking-[0.16em] text-slate-500">Next Action</p>
            <p className="mt-1 text-slate-100">{nextAction?.message ?? "—"}</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Recent Agent Steps</p>
          <div className="mt-2 max-h-24 space-y-1 overflow-y-auto pr-1 text-xs">
            {recentActivity.length ? (
              recentActivity.map((entry, index) => (
                <div key={`${entry.phase ?? "phase"}-${entry.status ?? "status"}-${index}`} className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1">
                  <p className="text-[10px] text-slate-400">{entry.phase ?? "state"} {entry.status ? `• ${entry.status}` : ""}</p>
                  <p className="truncate text-slate-100">{entry.message}</p>
                </div>
              ))
            ) : (
              <p className="text-slate-500">No recent activity yet.</p>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
          <p className="uppercase tracking-[0.18em] text-slate-500">Step Details</p>
          <p className="mt-1">Result: {currentStepRecord?.result ?? "-"}</p>
          <p className="mt-1">Action: {currentStepRecord?.actionAttempted?.type ?? "-"}</p>
          <p className="mt-1">Updated: {formatTimestamp(session?.updatedAt)}</p>
        </div>
      </section>

      {isFullscreen ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/95 p-4">
          <div className="mx-auto flex h-full max-w-[1700px] flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Live Viewer Fullscreen</p>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="rounded-lg border border-white/20 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-white/40"
              >
                Exit fullscreen
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/15 bg-slate-900">
              {frame ? (
                <img src={frame} alt="Live run screenshot fullscreen" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Waiting for first screenshot…
                </div>
              )}
            </div>
            <div className="rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2 text-xs text-slate-200">
              <p>{frameTitle || currentAction?.message || "Live capture active."}</p>
              <p className="mt-1 text-[11px] text-slate-400">Next: {nextAction?.message ?? "—"}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
