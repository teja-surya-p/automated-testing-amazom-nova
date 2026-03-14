import { useEffect, useMemo, useState } from "react";

function normalizeFieldInputType(field = {}) {
  const tag = String(field.tag ?? "").toLowerCase();
  const type = String(field.type ?? "").toLowerCase();
  if (tag === "textarea") {
    return "textarea";
  }
  if (tag === "select") {
    return "select";
  }
  if (["checkbox", "radio", "date", "email", "number", "password", "search", "tel", "url"].includes(type)) {
    return type;
  }
  return "text";
}

function fieldDisplayLabel(field = {}) {
  return (
    String(field.label ?? "").trim() ||
    String(field.placeholder ?? "").trim() ||
    String(field.name ?? "").trim() ||
    "Input field"
  );
}

function toKeyedInitialValues(groups = []) {
  const byGroup = {};
  for (const group of groups) {
    byGroup[group.groupId] = {};
    for (const field of group.fields ?? []) {
      const key = field.fieldId ?? field.selector ?? field.name ?? fieldDisplayLabel(field);
      byGroup[group.groupId][key] = field.type === "checkbox" ? false : "";
    }
  }
  return byGroup;
}

export default function FormAssistModal({
  open,
  formAssist,
  onSubmitGroup,
  onSkipGroup,
  onAutoGroup,
  onUpdateDescription,
  onSkipAll,
  onAutoAll
}) {
  const groups = useMemo(() => (Array.isArray(formAssist?.groups) ? formAssist.groups : []), [formAssist?.groups]);
  const [draftValues, setDraftValues] = useState({});
  const [draftDescriptions, setDraftDescriptions] = useState({});
  const [loadingKey, setLoadingKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftValues(toKeyedInitialValues(groups));
    const descriptions = {};
    for (const group of groups) {
      descriptions[group.groupId] = group.description ?? "";
    }
    setDraftDescriptions(descriptions);
  }, [groups, open]);

  if (!open || !formAssist) {
    return null;
  }

  const hasGroups = groups.length > 0;

  const withLoading = async (key, callback) => {
    setError("");
    setLoadingKey(key);
    try {
      await callback();
    } catch (actionError) {
      setError(actionError?.message ?? "Unable to submit form decision.");
    } finally {
      setLoadingKey("");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-cyan-300/30 bg-slate-950 p-4 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100">
            Form Confirmation Required
          </h2>
          <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-xs text-slate-300">
            pending {formAssist.pendingGroupIds?.length ?? groups.length}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-300">
          Agent paused because page inputs were detected. Choose how each form should be handled.
        </p>
        <p className="mt-1 text-xs text-slate-500 truncate">Page: {formAssist.pageUrl || "-"}</p>

        {hasGroups ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => withLoading("global-auto", () => onAutoAll?.())}
              disabled={Boolean(loadingKey)}
              className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-60"
            >
              Auto Fill All Forms
            </button>
            <button
              type="button"
              onClick={() => withLoading("global-skip", () => onSkipAll?.())}
              disabled={Boolean(loadingKey)}
              className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-60"
            >
              Skip All Forms
            </button>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {groups.map((group) => (
            <section key={group.groupId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                  {group.purpose || "Form Group"}
                </p>
                <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-slate-400">
                  {group.groupId}
                </span>
              </div>

              <div className="mt-2">
                <label className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Description</label>
                <div className="mt-1 flex gap-2">
                  <textarea
                    rows={2}
                    value={draftDescriptions[group.groupId] ?? ""}
                    onChange={(event) =>
                      setDraftDescriptions((current) => ({
                        ...current,
                        [group.groupId]: event.target.value
                      }))
                    }
                    className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      withLoading(`desc-${group.groupId}`, () =>
                        onUpdateDescription?.(group.groupId, {
                          description: draftDescriptions[group.groupId] ?? ""
                        })
                      )
                    }
                    disabled={Boolean(loadingKey)}
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(group.fields ?? []).map((field) => {
                  const fieldKey = field.fieldId ?? field.selector ?? field.name ?? fieldDisplayLabel(field);
                  const inputType = normalizeFieldInputType(field);
                  const value = draftValues[group.groupId]?.[fieldKey];
                  return (
                    <label key={fieldKey} className="flex flex-col gap-1">
                      <span className="text-xs text-slate-300">
                        {fieldDisplayLabel(field)}
                        {field.required ? " *" : ""}
                      </span>
                      {inputType === "textarea" ? (
                        <textarea
                          rows={2}
                          value={String(value ?? "")}
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              [group.groupId]: {
                                ...(current[group.groupId] ?? {}),
                                [fieldKey]: event.target.value
                              }
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none"
                        />
                      ) : inputType === "select" ? (
                        <select
                          value={String(value ?? "")}
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              [group.groupId]: {
                                ...(current[group.groupId] ?? {}),
                                [fieldKey]: event.target.value
                              }
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none"
                        >
                          <option value="">Select value</option>
                          {(field.options ?? []).map((option, index) => (
                            <option key={`${fieldKey}-${index}`} value={option.value ?? ""}>
                              {option.text ?? option.value ?? ""}
                            </option>
                          ))}
                        </select>
                      ) : inputType === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              [group.groupId]: {
                                ...(current[group.groupId] ?? {}),
                                [fieldKey]: event.target.checked
                              }
                            }))
                          }
                          className="h-4 w-4 accent-cyan-300"
                        />
                      ) : (
                        <input
                          type={inputType}
                          value={String(value ?? "")}
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              [group.groupId]: {
                                ...(current[group.groupId] ?? {}),
                                [fieldKey]: event.target.value
                              }
                            }))
                          }
                          placeholder={field.placeholder || field.name || ""}
                          className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none"
                        />
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    withLoading(`submit-${group.groupId}`, () =>
                      onSubmitGroup?.(group.groupId, {
                        values: draftValues[group.groupId] ?? {},
                        description: draftDescriptions[group.groupId] ?? group.description ?? ""
                      })
                    )
                  }
                  disabled={Boolean(loadingKey)}
                  className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-60"
                >
                  Submit With User Inputs
                </button>
                <button
                  type="button"
                  onClick={() =>
                    withLoading(`skip-${group.groupId}`, () =>
                      onSkipGroup?.(group.groupId, {
                        reason: "Form skipped from dashboard."
                      })
                    )
                  }
                  disabled={Boolean(loadingKey)}
                  className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-60"
                >
                  Skip Form
                </button>
                <button
                  type="button"
                  onClick={() =>
                    withLoading(`auto-${group.groupId}`, () =>
                      onAutoGroup?.(group.groupId, {
                        description: draftDescriptions[group.groupId] ?? group.description ?? ""
                      })
                    )
                  }
                  disabled={Boolean(loadingKey)}
                  className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                >
                  Auto Submit
                </button>
              </div>
            </section>
          ))}

          {!groups.length ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-xs text-slate-400">
              Waiting for form groups from the current page.
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

