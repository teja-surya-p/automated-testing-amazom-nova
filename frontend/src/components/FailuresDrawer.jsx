import { useEffect, useMemo, useState } from "react";

function severityBadgeTone(severity = "P2") {
  if (severity === "P0") {
    return "bg-rose-500/25 text-rose-100 border-rose-400/40";
  }
  if (severity === "P1") {
    return "bg-amber-500/25 text-amber-100 border-amber-400/40";
  }
  if (severity === "P2") {
    return "bg-cyan-500/20 text-cyan-100 border-cyan-400/30";
  }
  return "bg-slate-700/30 text-slate-200 border-slate-400/30";
}

function severityRank(level = "P3") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function getFailureDeviceLabels(entry = {}) {
  const labels = new Set();
  if (Array.isArray(entry.devices)) {
    for (const device of entry.devices) {
      if (device?.deviceLabel) {
        labels.add(device.deviceLabel);
      } else if (device?.viewportLabel) {
        labels.add(device.viewportLabel);
      }
    }
  }
  if (entry.deviceLabel) {
    labels.add(entry.deviceLabel);
  }
  return [...labels];
}

export default function FailuresDrawer({ open, onClose, failures = [], onSelectFailure }) {
  const [deviceFilter, setDeviceFilter] = useState("ALL");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [issueTypeFilter, setIssueTypeFilter] = useState("ALL");
  const [pageFilter, setPageFilter] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  const deviceOptions = useMemo(
    () =>
      [...new Set(failures.flatMap((entry) => getFailureDeviceLabels(entry)).filter(Boolean))].sort((left, right) =>
        left.localeCompare(right)
      ),
    [failures]
  );

  const issueTypeOptions = useMemo(
    () => [...new Set(failures.map((entry) => entry.issueType).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [failures]
  );

  const filteredFailures = useMemo(() => {
    const normalizedPageFilter = pageFilter.trim().toLowerCase();
    return failures
      .filter((entry) => (deviceFilter === "ALL" ? true : getFailureDeviceLabels(entry).includes(deviceFilter)))
      .filter((entry) => (severityFilter === "ALL" ? true : entry.severity === severityFilter))
      .filter((entry) => (issueTypeFilter === "ALL" ? true : entry.issueType === issueTypeFilter))
      .filter((entry) => {
        if (!normalizedPageFilter) {
          return true;
        }
        return String(entry.pageUrl ?? "").toLowerCase().includes(normalizedPageFilter);
      })
      .sort((left, right) => {
        const severityDiff = severityRank(left.severity) - severityRank(right.severity);
        if (severityDiff !== 0) {
          return severityDiff;
        }
        return String(left.pageUrl ?? "").localeCompare(String(right.pageUrl ?? ""));
      });
  }, [deviceFilter, failures, issueTypeFilter, pageFilter, severityFilter]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close failure drawer"
        className="h-full flex-1 bg-slate-950/70"
        onClick={onClose}
      />

      <aside className="h-full w-full max-w-2xl border-l border-white/10 bg-slate-950 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">Failed Cases</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.04]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <select
            value={deviceFilter}
            onChange={(event) => setDeviceFilter(event.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none"
          >
            <option value="ALL">All devices</option>
            {deviceOptions.map((device) => (
              <option key={device} value={device}>{device}</option>
            ))}
          </select>

          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none"
          >
            <option value="ALL">All severity</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>

          <select
            value={issueTypeFilter}
            onChange={(event) => setIssueTypeFilter(event.target.value)}
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none"
          >
            <option value="ALL">All issue types</option>
            {issueTypeOptions.map((issueType) => (
              <option key={issueType} value={issueType}>{issueType}</option>
            ))}
          </select>

          <input
            value={pageFilter}
            onChange={(event) => setPageFilter(event.target.value)}
            placeholder="Page contains..."
            className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none"
          />
        </div>

        <div className="mt-4 max-h-[calc(100vh-180px)] overflow-auto space-y-2 pr-1">
          {filteredFailures.map((failure, index) => (
            <article
              key={failure.groupId ?? failure.id ?? `${failure.issueType}-${failure.pageUrl}-${index}`}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3 cursor-pointer hover:bg-white/[0.05]"
              onClick={() => onSelectFailure?.(failure)}
            >
              {failure.mode === "uiux" ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full border border-rose-300/35 bg-rose-500/20 px-2 py-1 text-[10px] font-semibold text-rose-100">
                      FAILED
                    </span>
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${severityBadgeTone(failure.severity)}`}>
                      {failure.severity}
                    </span>
                    {failure.grouped ? (
                      <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
                        {failure.affectedDeviceCount ?? failure.devices?.length ?? 1} devices
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
                        {failure.deviceLabel ?? "default"}
                      </span>
                    )}
                    {failure.viewportLabel ? (
                      <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] text-slate-400">
                        {failure.viewportLabel}
                      </span>
                    ) : null}
                    <span className="font-mono text-[10px] text-slate-500">{failure.issueType}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{failure.title}</p>
                  <p className="mt-1 text-xs text-slate-300">{failure.summary || "Issue detected in the current UI state."}</p>
                  <p className="mt-1 text-xs text-slate-500">Why failed: {failure.whyItFailed || failure.actual || "No details"}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{failure.pageUrl ?? "-"}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Check: {failure.testcaseTitle || failure.testcaseId || failure.issueType}</p>
                  {failure.grouped && failure.sourceIssueTypes?.length > 1 ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Merged issue types: {failure.sourceIssueTypes.join(", ")}
                    </p>
                  ) : null}
                  {failure.grouped && failure.devices?.length ? (
                    <div className="mt-1 text-[11px] text-slate-400">
                      <p className="text-slate-500">Affected devices:</p>
                      <p>
                        {failure.devices
                          .slice(0, 4)
                          .map((device) => device.deviceLabel || device.viewportLabel)
                          .join(", ")}
                        {failure.devices.length > 4 ? ` +${failure.devices.length - 4} more` : ""}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${severityBadgeTone(failure.severity)}`}>
                      {failure.severity}
                    </span>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
                      {failure.deviceLabel ?? "default"}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">{failure.issueType}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{failure.title}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{failure.pageUrl ?? "-"}</p>
                  <p className="mt-1 text-xs text-slate-500">{failure.actual ?? "No details"}</p>
                </>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectFailure?.(failure);
                  }}
                  className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  {failure.mode === "uiux" ? "Open evidence" : "View evidence"}
                </button>
              </div>
            </article>
          ))}

          {!filteredFailures.length ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-500">
              No failures matched the selected filters.
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
