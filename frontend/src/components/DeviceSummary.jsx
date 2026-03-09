function severityRank(level = "P3") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function toFailureCount(entry = {}) {
  return Number(entry.totalChecksFailed ?? entry.assertionsFailed ?? 0);
}

export default function DeviceSummary({ entries = [], title = "Device Summary" }) {
  const sorted = [...entries].sort((left, right) => {
    const severityDiff = severityRank(left.worstSeverity) - severityRank(right.worstSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    const leftFailures = toFailureCount(left);
    const rightFailures = toFailureCount(right);
    if (rightFailures !== leftFailures) {
      return rightFailures - leftFailures;
    }
    return String(left.deviceLabel ?? "").localeCompare(String(right.deviceLabel ?? ""));
  });

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">{title}</h2>
        <span className="font-mono text-xs text-slate-500">{sorted.length}</span>
      </div>

      <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">Passed</th>
              <th className="px-3 py-2">Failed</th>
              <th className="px-3 py-2">Checks Failed</th>
              <th className="px-3 py-2">Worst</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <tr key={`${entry.deviceLabel}-${entry.worstSeverity}`} className="border-t border-white/10">
                <td className="px-3 py-2 font-semibold text-cyan-100">{entry.deviceLabel ?? "-"}</td>
                <td className="px-3 py-2 font-mono">{entry.pagesPassed ?? entry.flowsPassed ?? 0}</td>
                <td className="px-3 py-2 font-mono text-rose-200">{entry.pagesFailed ?? entry.flowsFailed ?? 0}</td>
                <td className="px-3 py-2 font-mono">{toFailureCount(entry)}</td>
                <td className="px-3 py-2 font-mono">{entry.worstSeverity ?? "P3"}</td>
              </tr>
            ))}
            {!sorted.length ? (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={5}>
                  Device summary unavailable.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
