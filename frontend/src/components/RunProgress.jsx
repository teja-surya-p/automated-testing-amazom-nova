function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function RunProgress({ stats = {} }) {
  const planned = toNumber(stats.planned);
  const discovered = toNumber(stats.discovered);
  const completed = toNumber(stats.completed);
  const passed = toNumber(stats.passed);
  const failed = toNumber(stats.failed);
  const total = Math.max(planned, discovered, completed, 0);
  const percent = total > 0 ? Math.min(Math.round((completed / total) * 100), 100) : 0;

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
    </section>
  );
}
