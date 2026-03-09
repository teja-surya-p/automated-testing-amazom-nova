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

export default function LiveViewer({ session, currentCase, socketConnected }) {
  const frame = session?.frame ?? null;
  const steps = Array.isArray(session?.steps) ? [...session.steps] : [];
  const currentStepRecord = steps
    .sort((left, right) => (right.stepId ?? 0) - (left.stepId ?? 0))
    .find((entry) => Number(entry.stepId) === Number(session?.currentStep)) ?? steps[0] ?? null;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Live Viewer</h2>
        <span
          className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
            socketConnected
              ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
              : "border-rose-400/40 bg-rose-500/20 text-rose-100"
          }`}
        >
          {socketConnected ? "Streaming" : "Waiting"}
        </span>
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

      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
        <p className="uppercase tracking-[0.18em] text-slate-500">Step Details</p>
        <p className="mt-1">Result: {currentStepRecord?.result ?? "-"}</p>
        <p className="mt-1">Action: {currentStepRecord?.actionAttempted?.type ?? "-"}</p>
        <p className="mt-1">Updated: {formatTimestamp(session?.updatedAt)}</p>
      </div>
    </section>
  );
}
