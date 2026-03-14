function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLogEntry(entry = null) {
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

export default function RunProgress({ stats = {}, actionLogs = {} }) {
  const planned = toNumber(stats.planned);
  const discovered = toNumber(stats.discovered);
  const completed = toNumber(stats.completed);
  const passed = toNumber(stats.passed);
  const failed = toNumber(stats.failed);
  const total = Math.max(planned, discovered, completed, 0);
  const percent = total > 0 ? Math.min(Math.round((completed / total) * 100), 100) : 0;
  const currentLog = normalizeLogEntry(actionLogs?.current);
  const nextLog = normalizeLogEntry(actionLogs?.next);

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Test Case Progress</h2>
        <span className="font-mono text-xs text-slate-400">{completed} / {total || "-"}</span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-cyan-300 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <p className="uppercase tracking-[0.16em] text-slate-500">Completed</p>
          <p className="mt-1 font-mono text-sm text-white">{completed}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <p className="uppercase tracking-[0.16em] text-slate-500">Passed</p>
          <p className="mt-1 font-mono text-sm text-emerald-200">{passed}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <p className="uppercase tracking-[0.16em] text-slate-500">Failed</p>
          <p className="mt-1 font-mono text-sm text-rose-200">{failed}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Logs</p>
        <div className="mt-2 space-y-2 text-xs">
          <div className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Current</p>
              {currentLog?.phase ? (
                <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {currentLog.phase}
                </span>
              ) : null}
              {currentLog?.status ? (
                <span className="rounded-full border border-cyan-300/25 px-1.5 py-0.5 text-[10px] text-cyan-100">
                  {currentLog.status}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-slate-100">
              {currentLog?.message ?? "Waiting for next action"}
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Next</p>
              {nextLog?.phase ? (
                <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {nextLog.phase}
                </span>
              ) : null}
              {nextLog?.status ? (
                <span className="rounded-full border border-violet-300/25 px-1.5 py-0.5 text-[10px] text-violet-100">
                  {nextLog.status}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-slate-100">{nextLog?.message ?? "—"}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
