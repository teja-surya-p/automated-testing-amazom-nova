import { useEffect, useMemo, useState } from "react";
import {
  UIUX_LAUNCH_BUDGET_DEFAULTS,
  buildLaunchRunConfig,
  collectFunctionalStepClientIssues,
  collectStepOneClientIssues,
  collectUiuxStepClientIssues,
  formatModeLabel,
  getAllFunctionalChecks,
  getRecommendedFunctionalChecks,
  getAllUiuxChecks,
  getRecommendedUiuxChecks,
  getStepOneAction,
  isGoalRequired,
  listUiuxCheckGroups,
  listModeCards,
  listFunctionalCheckGroups,
  normalizeFunctionalCheckSelection,
  normalizeUiuxCheckSelection,
  requiresStepTwo
} from "../lib/launchFlow";
import { DEFAULT_TARGET_APP_URL } from "../services/constants";

function normalizeServerError(error) {
  if (!error || typeof error !== "object") {
    return {
      error: "REQUEST_FAILED",
      message: "Launch failed. Please retry.",
      issues: []
    };
  }

  return {
    error: error.error ?? "REQUEST_FAILED",
    message: error.message ?? error.error ?? "Launch failed. Please retry.",
    issues: Array.isArray(error.issues) ? error.issues : []
  };
}

function modeIconPaths(icon) {
  switch (icon) {
    case "rocket":
      return (
        <>
          <path d="M7 17l2.5-2.5" />
          <path d="M15 9l4 4" />
          <path d="M4 20l4-1 1-3-3-3-3 1z" />
          <path d="M13 11c3.5-3.5 4.5-8 4.5-8S13 4 9.5 7.5L8 9l4 4z" />
        </>
      );
    case "layout":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 10h18" />
          <path d="M9 10v10" />
        </>
      );
    case "checklist":
      return (
        <>
          <path d="M9 7h11" />
          <path d="M9 12h11" />
          <path d="M9 17h11" />
          <path d="M4 7l1.5 1.5L7 6.5" />
          <path d="M4 12l1.5 1.5L7 11.5" />
          <path d="M4 17l1.5 1.5L7 16.5" />
        </>
      );
    case "accessibility":
      return (
        <>
          <circle cx="12" cy="5" r="2" />
          <path d="M7 9h10" />
          <path d="M12 7v13" />
          <path d="M8.5 21l3.5-6 3.5 6" />
        </>
      );
    case "gauge":
      return (
        <>
          <path d="M4 14a8 8 0 1116 0" />
          <path d="M12 14l4-4" />
          <path d="M6 18h12" />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
          <path d="M9.5 12l2 2 3-3" />
        </>
      );
    case "server":
      return (
        <>
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <path d="M7 7h.01" />
          <path d="M7 17h.01" />
        </>
      );
    case "database":
      return (
        <>
          <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
          <path d="M5 5.5v8c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-8" />
          <path d="M5 9.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
        </>
      );
    case "globe":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 010 18" />
          <path d="M12 3a14 14 0 000 18" />
        </>
      );
    default:
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 10h8" />
          <path d="M8 14h5" />
        </>
      );
  }
}

function ModeIcon({ icon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {modeIconPaths(icon)}
    </svg>
  );
}

function LaunchErrorPanel({ launchError }) {
  if (!launchError) {
    return null;
  }

  return (
    <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3">
      <p className="text-sm font-semibold text-rose-100">{launchError.message}</p>
      {launchError.issues?.length ? (
        <ul className="mt-2 space-y-1 text-xs text-rose-200">
          {launchError.issues.map((issue, index) => (
            <li key={`${issue.path?.join(".") ?? "issue"}-${index}`}>
              {(issue.path ?? []).join(".")}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function LaunchForm({ defaultStartUrl, onLaunch, onLaunched, onStepChange }) {
  const [step, setStep] = useState(1);
  const [startUrl, setStartUrl] = useState(defaultStartUrl ?? DEFAULT_TARGET_APP_URL);
  const [goal, setGoal] = useState("");
  const [testMode, setTestMode] = useState("default");
  const [profileTag, setProfileTag] = useState("functional-local");
  const [uiuxSelectedChecks, setUiuxSelectedChecks] = useState([]);
  const [functionalSelectedChecks, setFunctionalSelectedChecks] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [launchError, setLaunchError] = useState(null);

  const modeCards = useMemo(() => listModeCards(), []);
  const stepOneAction = getStepOneAction(testMode);
  const goalRequired = isGoalRequired(testMode);
  const uiuxCheckGroups = useMemo(() => listUiuxCheckGroups(), []);
  const functionalCheckGroups = useMemo(
    () => listFunctionalCheckGroups(),
    []
  );
  const uiuxSelectedCheckSet = useMemo(() => new Set(uiuxSelectedChecks), [uiuxSelectedChecks]);
  const uiuxSelectedCount = uiuxSelectedChecks.length;
  const functionalSelectedCheckSet = useMemo(
    () => new Set(functionalSelectedChecks),
    [functionalSelectedChecks]
  );
  const functionalSelectedCount = functionalSelectedChecks.length;

  useEffect(() => {
    onStepChange?.(step);
  }, [onStepChange, step]);

  function setValidationError(issues = []) {
    setLaunchError({
      error: "VALIDATION_ERROR",
      message: "Please fix launch form fields.",
      issues
    });
  }

  async function submitLaunch() {
    const runConfig = buildLaunchRunConfig({
      startUrl,
      goal,
      testMode,
      profileTag,
      selectedUiuxChecks: uiuxSelectedChecks,
      selectedFunctionalChecks: functionalSelectedChecks
    });

    setSubmitting(true);
    try {
      const session = await onLaunch({ runConfig });
      onLaunched?.(session);
    } catch (error) {
      setLaunchError(normalizeServerError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStepOneSubmit(event) {
    event.preventDefault();
    setLaunchError(null);

    const issues = collectStepOneClientIssues({
      startUrl,
      goal,
      testMode
    });
    if (issues.length > 0) {
      setValidationError(issues);
      return;
    }

    if (stepOneAction.type === "next") {
      setStep(2);
      return;
    }
    if (stepOneAction.type !== "launch") {
      setValidationError([
        {
          path: ["runConfig", "testMode"],
          message: "This mode is unavailable in the dashboard launch flow.",
          code: "custom"
        }
      ]);
      return;
    }

    await submitLaunch();
  }

  async function handleStepTwoSubmit(event) {
    event.preventDefault();
    setLaunchError(null);

    const issues = [
      ...collectStepOneClientIssues({
        startUrl,
        goal,
        testMode
      })
    ];

    if (testMode === "uiux") {
      issues.push(
        ...collectUiuxStepClientIssues({
          selectedChecks: uiuxSelectedChecks
        })
      );
    } else if (testMode === "functional") {
      issues.push(
        ...collectFunctionalStepClientIssues({
          profileTag,
          selectedChecks: functionalSelectedChecks
        })
      );
    }

    if (issues.length > 0) {
      setValidationError(issues);
      return;
    }

    await submitLaunch();
  }

  function handleModeSelect(mode, supported) {
    if (!supported) {
      return;
    }
    setLaunchError(null);
    setStep(1);
    setTestMode(mode);
  }

  function handleBackToStepOne() {
    setLaunchError(null);
    setStep(1);
  }

  function toggleUiuxCheck(checkId) {
    setUiuxSelectedChecks((current) => {
      const next = new Set(current);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return normalizeUiuxCheckSelection([...next]);
    });
  }

  function selectAllUiuxChecks() {
    setUiuxSelectedChecks(getAllUiuxChecks());
  }

  function selectRecommendedUiuxChecks() {
    setUiuxSelectedChecks(getRecommendedUiuxChecks());
  }

  function toggleFunctionalCheck(checkId) {
    setFunctionalSelectedChecks((current) => {
      const next = new Set(current);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return normalizeFunctionalCheckSelection([...next]);
    });
  }

  function selectAllFunctionalChecks() {
    setFunctionalSelectedChecks(getAllFunctionalChecks());
  }

  function selectRecommendedFunctionalChecks() {
    setFunctionalSelectedChecks(getRecommendedFunctionalChecks());
  }

  const isStepTwoVisible = step === 2 && requiresStepTwo(testMode);

  if (isStepTwoVisible) {
    return (
      <form onSubmit={handleStepTwoSubmit} className="space-y-4">
        <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Step 2 of 2</p>
              <h3 className="mt-1 text-lg font-semibold text-white">{formatModeLabel(testMode)} Configuration</h3>
            </div>
            <button
              type="button"
              onClick={handleBackToStepOne}
              className="inline-flex items-center rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
            >
              Back
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Mode</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{formatModeLabel(testMode)}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Target URL</p>
              <p className="mt-1 break-all text-sm text-slate-100">{startUrl}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Goal</p>
              <p className="mt-1 text-sm text-slate-100">
                {String(goal).trim() ? String(goal).trim() : "Optional; server can auto-generate this for this mode."}
              </p>
            </div>
          </div>
        </section>

        {testMode === "uiux" ? (
          <>
            <section className="space-y-3 rounded-xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">UI/UX checks</p>
                  <p className="text-xs text-slate-400">
                    Select the exact implemented checks to run. Planned checks are visible for checklist coverage and
                    cannot run yet.
                  </p>
                </div>
                <p className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                  {uiuxSelectedCount} selected
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={selectAllUiuxChecks}
                  className="rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
                >
                  Check all
                </button>
                <button
                  type="button"
                  onClick={selectRecommendedUiuxChecks}
                  className="rounded-lg border border-cyan-300/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/60"
                >
                  Check recommended
                </button>
              </div>

              <div className="max-h-[30rem] space-y-3 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/60 p-3">
                {uiuxCheckGroups.map((group) => (
                  <section key={group.id} className="space-y-2 rounded-lg border border-white/10 bg-slate-900/40 p-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-100">{group.title}</h4>
                      <p className="mt-1 text-xs text-slate-400">{group.description}</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.checks.map((check) => {
                        const selectable = check.selectable !== false;
                        const checked = selectable && uiuxSelectedCheckSet.has(check.id);
                        const mutedClasses = selectable
                          ? "border-white/10 bg-slate-900/70 hover:border-white/20"
                          : "cursor-not-allowed border-white/10 bg-slate-900/35 opacity-75";
                        const selectedClasses = checked
                          ? "border-cyan-300/50 bg-cyan-500/10"
                          : mutedClasses;
                        return (
                          <label
                            key={check.id}
                            className={`flex gap-3 rounded-lg border px-3 py-2 transition ${selectedClasses}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!selectable}
                              onChange={() => {
                                if (selectable) {
                                  toggleUiuxCheck(check.id);
                                }
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-white/25 bg-slate-900 text-cyan-300 focus:ring-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-slate-100">{check.label}</span>
                                {!selectable ? (
                                  <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-200">
                                    Planned
                                  </span>
                                ) : null}
                              </span>
                              {!selectable && check.plannedReason ? (
                                <span className="mt-1 block text-[11px] text-amber-100/90">{check.plannedReason}</span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-semibold text-white">UI/UX responsive runtime</p>
              <p className="text-xs text-slate-500">
                Responsive scanning is now fully agent-driven. The runtime automatically discovers component breakpoints,
                validates nearby device-like viewports, and captures representative evidence.
              </p>
              <ul className="space-y-1 text-xs text-slate-300">
                <li>Discovers meaningful components and responsive transitions per page.</li>
                <li>Sweeps widths and heights dynamically, then refines around suspicious breakpoints.</li>
                <li>Confirms failures on nearby device-like viewports before reporting.</li>
                <li>Captures representative screenshots for confirmed layout/alignment issues.</li>
              </ul>
              <p className="text-xs text-slate-500">
                Default UI/UX time budget: {Math.round(UIUX_LAUNCH_BUDGET_DEFAULTS.breakpointSweep / 60_000)}m.
              </p>
            </section>
          </>
        ) : null}

        {testMode === "functional" ? (
          <>
            <section className="space-y-3 rounded-xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">Functionality checks</p>
                  <p className="text-xs text-slate-400">
                    Select the exact functionality coverage to run. Launch requires at least one selected check.
                  </p>
                </div>
                <p className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                  {functionalSelectedCount} selected
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={selectAllFunctionalChecks}
                  className="rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
                >
                  Check all
                </button>
                <button
                  type="button"
                  onClick={selectRecommendedFunctionalChecks}
                  className="rounded-lg border border-cyan-300/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/60"
                >
                  Check recommended
                </button>
              </div>

              <div className="max-h-[30rem] space-y-3 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/60 p-3">
                {functionalCheckGroups.map((group) => (
                  <section key={group.id} className="space-y-2 rounded-lg border border-white/10 bg-slate-900/40 p-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-100">{group.title}</h4>
                      <p className="mt-1 text-xs text-slate-400">{group.description}</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.checks.map((check) => {
                        const selectable = check.selectable !== false;
                        const checked = selectable && functionalSelectedCheckSet.has(check.id);
                        const mutedClasses = selectable
                          ? ""
                          : "border-amber-300/35 bg-amber-500/8 opacity-90";
                        return (
                          <label
                            key={check.id}
                            className={`flex gap-3 rounded-lg border px-3 py-2 transition ${
                              checked
                                ? "border-cyan-300/50 bg-cyan-500/10"
                                : selectable
                                  ? "cursor-pointer border-white/10 bg-slate-900/70 hover:border-white/20"
                                  : ""
                            } ${mutedClasses}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!selectable}
                              onChange={() => {
                                if (selectable) {
                                  toggleFunctionalCheck(check.id);
                                }
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-white/25 bg-slate-900 text-cyan-300 focus:ring-cyan-300/40"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-slate-100">{check.label}</span>
                              {!selectable ? (
                                <span className="mt-1 inline-flex rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                                  Planned
                                </span>
                              ) : null}
                              {!selectable && check.plannedReason ? (
                                <span className="mt-1 block text-[11px] text-amber-100/90">{check.plannedReason}</span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-semibold text-white">Functionality run profile</p>
              <p className="text-xs text-slate-500">
                Profile tag selects reusable login/storage context for functionality runs.
              </p>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Profile Tag</span>
                <input
                  value={profileTag}
                  onChange={(event) => setProfileTag(event.target.value)}
                  placeholder="functional-local"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
                />
              </label>
            </section>
          </>
        ) : null}

        <LaunchErrorPanel launchError={launchError} />

        <button
          type="submit"
          disabled={
            submitting ||
            (testMode === "uiux" && uiuxSelectedCount === 0) ||
            (testMode === "functional" && functionalSelectedCount === 0)
          }
          className="inline-flex items-center justify-center rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Launching…" : "Launch"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleStepOneSubmit} className="space-y-5">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Step 1 of 2</p>
        <h3 className="text-lg font-semibold text-white">Launch Setup</h3>
      </section>

      <section className="space-y-2">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Target URL</span>
          <input
            value={startUrl}
            onChange={(event) => setStartUrl(event.target.value)}
            placeholder="https://example.com"
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
          />
        </label>
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Mode Selection</p>
          <p className="mt-1 text-sm text-slate-500">
            Supported now: default, UI/UX, functionality, and performance. Roadmap modes are visible but unavailable.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {modeCards.map((card) => {
            const selected = testMode === card.mode;
            return (
              <button
                key={card.mode}
                type="button"
                disabled={!card.supported}
                onClick={() => handleModeSelect(card.mode, card.supported)}
                className={`group flex items-start justify-between rounded-xl border p-3 text-left transition ${
                  selected
                    ? "border-cyan-300/70 bg-cyan-500/12"
                    : card.supported
                      ? "border-white/10 bg-slate-900/80 hover:border-white/25"
                      : "cursor-not-allowed border-white/10 bg-slate-900/30 opacity-60"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{card.label}</p>
                  <p className="mt-1 text-xs text-slate-400">{card.description}</p>
                  {!card.supported ? (
                    <span className="mt-2 inline-flex rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                      Unavailable
                    </span>
                  ) : null}
                </div>
                <span
                  className={`ml-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    selected
                      ? "border-cyan-200/60 bg-cyan-400/20 text-cyan-100"
                      : "border-white/10 bg-slate-950/60 text-slate-300"
                  }`}
                >
                  <ModeIcon icon={card.icon} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Goal {goalRequired ? "(Required)" : "(Optional)"}
          </span>
          <textarea
            rows={3}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={goalRequired ? "Describe what Sentinel should verify" : "Optional focus for this run"}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
          />
          <span className="text-xs text-slate-500">
            {goalRequired
              ? "Goal is required in default mode."
              : "Goal is optional in this mode; server can auto-generate it if blank."}
          </span>
        </label>
      </section>

      <LaunchErrorPanel launchError={launchError} />

      <button
        type="submit"
        disabled={submitting || stepOneAction.disabled}
        className="inline-flex items-center justify-center rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting && stepOneAction.type === "launch" ? "Launching…" : stepOneAction.label}
      </button>
    </form>
  );
}
