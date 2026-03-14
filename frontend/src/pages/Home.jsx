import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LaunchForm from "../components/LaunchForm";
import RecentRuns from "../components/RecentRuns";
import { shouldShowRecentRunsForLaunchStep } from "../lib/dashboardUi";
import { DEFAULT_TARGET_APP_URL } from "../services/constants";

function defaultStartUrlFromSessions(sessions = []) {
  return sessions[0]?.startUrl ?? DEFAULT_TARGET_APP_URL;
}

export default function Home({
  sessions = [],
  socketConnected,
  activeSessionsCount = 0,
  apiBase = "http://localhost:3000",
  backendHealth = null,
  backendHealthError = "",
  onLaunch,
  onStopAllActiveRuns
}) {
  const navigate = useNavigate();
  const defaultStartUrl = useMemo(() => defaultStartUrlFromSessions(sessions), [sessions]);
  const [launchStep, setLaunchStep] = useState(1);
  const [showStopAllConfirm, setShowStopAllConfirm] = useState(false);
  const [stopAllSubmitting, setStopAllSubmitting] = useState(false);
  const [stopAllError, setStopAllError] = useState("");
  const [stopAllResult, setStopAllResult] = useState(null);
  const hasActiveRuns = activeSessionsCount > 0;
  const showRecentRuns = shouldShowRecentRunsForLaunchStep(launchStep);

  async function handleLaunch(payload) {
    const session = await onLaunch(payload);
    navigate(`/runs/${session.id}`);
    return session;
  }

  async function handleConfirmStopAll() {
    if (typeof onStopAllActiveRuns !== "function") {
      return;
    }
    setStopAllSubmitting(true);
    setStopAllError("");
    try {
      const result = await onStopAllActiveRuns();
      setStopAllResult({
        activeFound: Number(result?.activeFound ?? result?.activeCount ?? 0),
        stoppedCount: Number(result?.stoppedCount ?? 0),
        requestedSessionIds: Array.isArray(result?.requestedSessionIds) ? result.requestedSessionIds : [],
        failed: Array.isArray(result?.failed) ? result.failed : []
      });
      setShowStopAllConfirm(false);
    } catch (error) {
      setStopAllError(error?.message ?? "Failed to terminate active runs.");
    } finally {
      setStopAllSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-2xl border border-white/10 bg-slate-900/70 px-5 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Sentinel Dashboard</p>
              <h1 className="mt-1 text-2xl font-semibold text-white">Launch and Monitor QA Runs</h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                    socketConnected
                      ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                      : "border-rose-400/40 bg-rose-500/20 text-rose-100"
                  }`}
                >
                  {socketConnected ? "Live" : "Offline"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-slate-300">
                  active {activeSessionsCount}
                </span>
              </div>
              <button
                type="button"
                disabled={!hasActiveRuns || stopAllSubmitting}
                onClick={() => {
                  setStopAllError("");
                  setShowStopAllConfirm(true);
                }}
                className="inline-flex items-center justify-center rounded-lg border border-rose-300/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-800/40 disabled:text-slate-500"
              >
                {stopAllSubmitting ? "Terminating…" : "Terminate all active runs"}
              </button>
            </div>
          </div>
        </header>

        {stopAllError ? (
          <div className="rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {stopAllError}
          </div>
        ) : null}
        {stopAllResult ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              stopAllResult.failed.length
                ? "border-amber-400/35 bg-amber-500/10 text-amber-100"
                : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            <p>
              Stop-all requested for {stopAllResult.activeFound} active run(s). Successful requests:{" "}
              {stopAllResult.stoppedCount}.
            </p>
            {stopAllResult.failed.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-50">
                {stopAllResult.failed.map((failure) => (
                  <li key={`${failure.sessionId}-${failure.code}`}>
                    {failure.sessionId}: {failure.code} - {failure.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className={`grid gap-6 ${showRecentRuns ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : "grid-cols-1"}`}>
          <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Launch Sentinel Run</h2>
            <p className="mt-2 text-sm text-slate-400">
              Step 1 collects target URL, mode, and goal. UI/UX and functionality continue to step 2 for mode-specific
              configuration before launch.
            </p>
            <div className="mt-4">
              <LaunchForm
                defaultStartUrl={defaultStartUrl}
                onLaunch={handleLaunch}
                onStepChange={setLaunchStep}
              />
            </div>
          </section>

          {showRecentRuns ? (
            <section>
              <RecentRuns sessions={sessions} onSelect={(sessionId) => navigate(`/runs/${sessionId}`)} />
            </section>
          ) : null}
        </div>
      </div>

      {showStopAllConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close terminate-all confirmation"
            className="absolute inset-0 bg-slate-950/75"
            onClick={() => setShowStopAllConfirm(false)}
          />
          <section className="relative z-10 w-full max-w-md rounded-2xl border border-rose-400/35 bg-slate-950 p-5 shadow-2xl">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-200">
              Confirm Termination
            </h2>
            <p className="mt-3 text-sm text-slate-200">
              Are you sure you want to terminate all active runs?
            </p>
            <p className="mt-1 text-xs text-slate-500">
              This sends cooperative stop requests to all currently active sessions.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowStopAllConfirm(false)}
                className="rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-white/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStopAll}
                disabled={stopAllSubmitting}
                className="rounded-lg border border-rose-300/35 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stopAllSubmitting ? "Terminating…" : "Yes, terminate"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
