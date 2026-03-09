import { useEffect, useMemo, useState } from "react";
import { DEFAULT_TARGET_APP_URL } from "../services/constants";
import { fetchUiuxDevices } from "../services/sessionsService";

const TEST_MODES = [
  "default",
  "uiux",
  "functional",
  "accessibility",
  "performance",
  "security",
  "api",
  "dataReliability",
  "compatIntl",
  "compliance"
];

const UIUX_LAUNCH_BUDGET_DEFAULTS = Object.freeze({
  quick: 600_000,
  full: 1_800_000,
  fullAll: 3_600_000
});
const UIUX_FULL_SAFE_DEVICE_CAP = 250;

function isAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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

function parseLineList(value = "") {
  return String(value)
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveUiuxLaunchTimeBudgetMs({ deviceMode = "quick", selection = "cap" } = {}) {
  if (deviceMode === "full" && selection === "all") {
    return UIUX_LAUNCH_BUDGET_DEFAULTS.fullAll;
  }
  if (deviceMode === "full") {
    return UIUX_LAUNCH_BUDGET_DEFAULTS.full;
  }
  return UIUX_LAUNCH_BUDGET_DEFAULTS.quick;
}

export default function LaunchForm({ defaultStartUrl, onLaunch, onLaunched }) {
  const [startUrl, setStartUrl] = useState(defaultStartUrl ?? DEFAULT_TARGET_APP_URL);
  const [goal, setGoal] = useState("");
  const [testMode, setTestMode] = useState("default");
  const [profileTag, setProfileTag] = useState("functional-local");
  const [uiuxDeviceMode, setUiuxDeviceMode] = useState("quick");
  const [uiuxSelection, setUiuxSelection] = useState("cap");
  const [uiuxMaxDevices, setUiuxMaxDevices] = useState("250");
  const [uiuxAllowlist, setUiuxAllowlist] = useState("");
  const [uiuxBlocklist, setUiuxBlocklist] = useState("");
  const [fullDeviceCount, setFullDeviceCount] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [launchError, setLaunchError] = useState(null);

  const isGoalRequired = testMode === "default";
  const goalHint = isGoalRequired
    ? "Goal is required in default mode."
    : "Goal is optional here. Server will auto-generate one if empty.";

  useEffect(() => {
    if (testMode !== "uiux" || uiuxDeviceMode !== "full") {
      return;
    }

    let cancelled = false;
    fetchUiuxDevices({ mode: "full" })
      .then((payload) => {
        if (!cancelled) {
          setFullDeviceCount(Number(payload?.count ?? 0) || 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFullDeviceCount(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [testMode, uiuxDeviceMode]);

  const estimatedDeviceCountLabel = useMemo(() => {
    if (testMode !== "uiux") {
      return null;
    }
    if (uiuxDeviceMode === "quick") {
      return "Estimated devices: 3";
    }
    if (uiuxSelection === "all") {
      if (fullDeviceCount === null) {
        return "Estimated devices: ~loading…";
      }
      return `Estimated devices: ~${fullDeviceCount}`;
    }
    const cap = Math.max(1, Number(uiuxMaxDevices) || 250);
    return `Estimated devices: ${cap}`;
  }, [fullDeviceCount, testMode, uiuxDeviceMode, uiuxMaxDevices, uiuxSelection]);

  const clientIssues = useMemo(() => {
    const issues = [];
    if (!isAbsoluteHttpUrl(startUrl)) {
      issues.push({
        path: ["runConfig", "startUrl"],
        message: "Target URL must be an absolute http(s) URL.",
        code: "invalid_string"
      });
    }
    if (isGoalRequired && !String(goal).trim()) {
      issues.push({
        path: ["runConfig", "goal"],
        message: "Goal is required when mode is default.",
        code: "too_small"
      });
    }
    if (testMode === "functional" && !String(profileTag).trim()) {
      issues.push({
        path: ["runConfig", "profileTag"],
        message: "Functional mode requires a profile tag.",
        code: "custom"
      });
    }
    if (testMode === "uiux" && uiuxDeviceMode === "full" && uiuxSelection === "cap") {
      const parsed = Number(uiuxMaxDevices);
      if (!Number.isFinite(parsed) || parsed < 1) {
        issues.push({
          path: ["runConfig", "uiux", "devices", "maxDevices"],
          message: "Full-throttle cap mode requires maxDevices >= 1.",
          code: "too_small"
        });
      }
    }
    return issues;
  }, [goal, isGoalRequired, profileTag, startUrl, testMode, uiuxDeviceMode, uiuxMaxDevices, uiuxSelection]);

  async function handleSubmit(event) {
    event.preventDefault();
    setLaunchError(null);

    if (clientIssues.length > 0) {
      setLaunchError({
        error: "VALIDATION_ERROR",
        message: "Please fix launch form fields.",
        issues: clientIssues
      });
      return;
    }

    const trimmedGoal = String(goal).trim();
    const runConfig = {
      startUrl: String(startUrl).trim(),
      testMode,
      ...(trimmedGoal ? { goal: trimmedGoal } : {}),
      ...(testMode === "functional" ? { profileTag: String(profileTag).trim() } : {})
    };

    if (testMode === "uiux") {
      const allowlist = parseLineList(uiuxAllowlist);
      const blocklist = parseLineList(uiuxBlocklist);
      const isFull = uiuxDeviceMode === "full";
      const selection = isFull ? uiuxSelection : "cap";
      const uiuxTimeBudgetMs = resolveUiuxLaunchTimeBudgetMs({
        deviceMode: isFull ? "full" : "quick",
        selection
      });
      const maxDevices = isFull
        ? (selection === "all" ? 0 : Math.max(1, Number(uiuxMaxDevices) || UIUX_FULL_SAFE_DEVICE_CAP))
        : 3;
      runConfig.budgets = {
        ...(runConfig.budgets ?? {}),
        timeBudgetMs: uiuxTimeBudgetMs
      };
      runConfig.uiux = {
        timeBudgetMs: uiuxTimeBudgetMs,
        devices: {
          mode: isFull ? "full" : "quick",
          selection,
          maxDevices,
          allowlist,
          blocklist
        }
      };
    }

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Target URL</span>
          <input
            value={startUrl}
            onChange={(event) => setStartUrl(event.target.value)}
            placeholder="https://example.com"
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Mode</span>
          <select
            value={testMode}
            onChange={(event) => setTestMode(event.target.value)}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
          >
            {TEST_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Goal {isGoalRequired ? "(Required)" : "(Optional)"}
        </span>
        <textarea
          rows={3}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder={isGoalRequired ? "Describe what Sentinel should verify" : "Optional focus for this run"}
          className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
        />
        <span className="text-xs text-slate-500">{goalHint}</span>
      </label>

      {testMode === "functional" ? (
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Profile Tag</span>
          <input
            value={profileTag}
            onChange={(event) => setProfileTag(event.target.value)}
            placeholder="functional-local"
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
          />
        </label>
      ) : null}

      {testMode === "uiux" ? (
        <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Device Coverage
              </span>
              <select
                value={uiuxDeviceMode}
                onChange={(event) => setUiuxDeviceMode(event.target.value)}
                className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
              >
                <option value="quick">Quick (3 devices)</option>
                <option value="full">Full throttle (2000+ devices)</option>
              </select>
            </label>

            {uiuxDeviceMode === "full" ? (
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Full Selection
                </span>
                <select
                  value={uiuxSelection}
                  onChange={(event) => setUiuxSelection(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
                >
                  <option value="cap">Cap devices</option>
                  <option value="all">Run ALL devices</option>
                </select>
              </label>
            ) : null}
          </div>

          {uiuxDeviceMode === "full" && uiuxSelection === "cap" ? (
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Max Devices</span>
              <input
                type="number"
                min={1}
                max={3000}
                value={uiuxMaxDevices}
                onChange={(event) => setUiuxMaxDevices(event.target.value)}
                className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
              />
            </label>
          ) : null}

          {uiuxDeviceMode === "full" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Allowlist (IDs or label substrings)
                </span>
                <textarea
                  rows={3}
                  value={uiuxAllowlist}
                  onChange={(event) => setUiuxAllowlist(event.target.value)}
                  placeholder="one per line"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Blocklist (IDs or label substrings)
                </span>
                <textarea
                  rows={3}
                  value={uiuxBlocklist}
                  onChange={(event) => setUiuxBlocklist(event.target.value)}
                  placeholder="one per line"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none ring-cyan-300/35 transition focus:ring"
                />
              </label>
            </div>
          ) : null}

          {estimatedDeviceCountLabel ? (
            <p className="text-xs text-cyan-200">{estimatedDeviceCountLabel}</p>
          ) : null}
          <p className="text-xs text-slate-500">
            Time budget defaults:
            {" "}
            quick {Math.round(UIUX_LAUNCH_BUDGET_DEFAULTS.quick / 60_000)}m,
            {" "}
            full {Math.round(UIUX_LAUNCH_BUDGET_DEFAULTS.full / 60_000)}m,
            {" "}
            full-all {Math.round(UIUX_LAUNCH_BUDGET_DEFAULTS.fullAll / 60_000)}m.
          </p>
        </section>
      ) : null}

      {launchError ? (
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
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Launching…" : "Launch Sentinel Run"}
      </button>
    </form>
  );
}
