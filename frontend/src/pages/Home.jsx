import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import LaunchForm from "../components/LaunchForm";
import RecentRuns from "../components/RecentRuns";
import { DEFAULT_TARGET_APP_URL } from "../services/constants";

function defaultStartUrlFromSessions(sessions = []) {
  return sessions[0]?.startUrl ?? DEFAULT_TARGET_APP_URL;
}

export default function Home({ sessions = [], socketConnected, activeSessionsCount = 0, onLaunch }) {
  const navigate = useNavigate();
  const defaultStartUrl = useMemo(() => defaultStartUrlFromSessions(sessions), [sessions]);

  async function handleLaunch(payload) {
    const session = await onLaunch(payload);
    navigate(`/runs/${session.id}`);
    return session;
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
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Launch Sentinel Run</h2>
            <p className="mt-2 text-sm text-slate-400">
              Default mode requires a goal. For non-default modes, leave goal empty and Sentinel auto-generates one.
            </p>
            <div className="mt-4">
              <LaunchForm defaultStartUrl={defaultStartUrl} onLaunch={handleLaunch} />
            </div>
          </section>

          <section>
            <RecentRuns sessions={sessions} onSelect={(sessionId) => navigate(`/runs/${sessionId}`)} />
          </section>
        </div>
      </div>
    </div>
  );
}
