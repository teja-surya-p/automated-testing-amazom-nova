import { useMemo, useState } from "react";

const PAGE_SIZE = 10;

function toAbsoluteUrl(apiBase, value) {
  if (!value) {
    return null;
  }
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  return `${apiBase}${value}`;
}

function flattenArtifacts(artifacts = {}) {
  return Object.entries(artifacts).flatMap(([kind, value]) => {
    if (!value) {
      return [];
    }
    const list = Array.isArray(value) ? value : [value];
    return list
      .filter(Boolean)
      .map((entry, index) => ({
        id: `${kind}-${entry.path ?? entry.relativePath ?? entry.url ?? index}`,
        kind,
        ref: entry.url ?? entry.relativePath ?? entry.path ?? null,
        step: entry.step ?? null
      }));
  });
}

export default function ArtifactsList({ artifacts = {}, apiBase }) {
  const [page, setPage] = useState(1);
  const entries = useMemo(() => flattenArtifacts(artifacts), [artifacts]);
  const totalPages = Math.max(Math.ceil(entries.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, totalPages);
  const sliceStart = (safePage - 1) * PAGE_SIZE;
  const visible = entries.slice(sliceStart, sliceStart + PAGE_SIZE);

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">Artifacts</h2>
        <span className="font-mono text-xs text-slate-500">{entries.length}</span>
      </div>

      <div className="mt-3 space-y-2">
        {visible.map((entry) => (
          <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
            <p className="font-mono uppercase tracking-[0.18em] text-slate-400">{entry.kind}</p>
            <p className="mt-1 truncate text-slate-300">{entry.ref ?? "-"}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-500">step {entry.step ?? "-"}</span>
              {entry.ref ? (
                <a
                  href={toAbsoluteUrl(apiBase, entry.ref)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-200 hover:text-cyan-100"
                >
                  Open
                </a>
              ) : null}
            </div>
          </div>
        ))}

        {!visible.length ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-500">
            No artifacts indexed yet.
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <button
          type="button"
          className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/[0.03] disabled:opacity-40"
          onClick={() => setPage((value) => Math.max(value - 1, 1))}
          disabled={safePage <= 1}
        >
          Prev
        </button>
        <span className="font-mono">{safePage} / {totalPages}</span>
        <button
          type="button"
          className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/[0.03] disabled:opacity-40"
          onClick={() => setPage((value) => Math.min(value + 1, totalPages))}
          disabled={safePage >= totalPages}
        >
          Next
        </button>
      </div>
    </section>
  );
}
