import { formatRunTargetForDisplay } from "../lib/dashboardUi";

function statusTone(status = "queued") {
  if (status === "passed") {
    return "bg-emerald-500/20 text-emerald-100 border-emerald-400/30";
  }
  if (status === "failed") {
    return "bg-rose-500/20 text-rose-100 border-rose-400/30";
  }
  if (status === "soft-passed") {
    return "bg-amber-500/20 text-amber-100 border-amber-400/30";
  }
  if (status === "running" || status === "login-assist" || status === "waiting-login") {
    return "bg-cyan-500/20 text-cyan-100 border-cyan-400/30";
  }
  return "bg-slate-700/40 text-slate-200 border-slate-400/30";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

export default function RecentRuns({ sessions = [], onSelect }) {
  const recent = sessions.slice(0, 12);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Recent Runs</h2>
        <span className="font-mono text-xs text-slate-500">{recent.length}</span>
      </div>

      {recent.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-500">
          No runs yet. Launch your first Sentinel run.
        </div>
      ) : (
        <div className="mt-4 overflow-auto rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900 text-[11px] uppercase tracking-[0.2em] text-slate-500">
              <tr>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Mode</th>
                <th className="px-3 py-3">Target</th>
                <th className="px-3 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((session) => (
                <tr
                  key={session.id}
                  className="cursor-pointer border-t border-white/10 hover:bg-white/[0.03]"
                  onClick={() => onSelect?.(session.id)}
                >
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(session.status)}`}>
                      {session.status ?? "queued"}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-cyan-100">{session.runConfig?.testMode ?? "default"}</td>
                  <td className="max-w-[260px] truncate px-3 py-3 text-xs text-slate-300" title={session.startUrl}>
                    {formatRunTargetForDisplay(session.startUrl)}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">{formatDate(session.updatedAt ?? session.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
