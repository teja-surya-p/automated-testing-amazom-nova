const ACTIVITY_STATUS_ORDER = {
  planned: 0,
  doing: 1,
  done: 2,
  blocked: 3,
  failed: 4
};
const SECRET_VALUE_PATTERN =
  /(password|otp|token|cookie|secret|authorization|bearer)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

export function normalizeAgentActivityEntries(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      id: String(entry.id ?? `activity-${index}`),
      ts: entry.ts ?? null,
      elapsedMs: Number.isFinite(Number(entry.elapsedMs)) ? Math.max(Number(entry.elapsedMs), 0) : 0,
      phase: String(entry.phase ?? "state").trim().toLowerCase() || "state",
      kind: String(entry.kind ?? "event").trim().toLowerCase() || "event",
      status: String(entry.status ?? "done").trim().toLowerCase() || "done",
      message: String(entry.message ?? "").trim(),
      details: entry.details && typeof entry.details === "object" ? entry.details : null
    }))
    .filter((entry) => entry.message.length > 0)
    .sort((left, right) => {
      const leftTs = Date.parse(left.ts ?? 0);
      const rightTs = Date.parse(right.ts ?? 0);
      if (!Number.isNaN(leftTs) && !Number.isNaN(rightTs) && leftTs !== rightTs) {
        return leftTs - rightTs;
      }
      if (left.elapsedMs !== right.elapsedMs) {
        return left.elapsedMs - right.elapsedMs;
      }
      const leftStatus = ACTIVITY_STATUS_ORDER[left.status] ?? 99;
      const rightStatus = ACTIVITY_STATUS_ORDER[right.status] ?? 99;
      return leftStatus - rightStatus;
    });
}

export function deriveAgentActivitySummary(entries = []) {
  const normalized = normalizeAgentActivityEntries(entries);
  const reverse = [...normalized].reverse();
  return {
    justDid: reverse.find((entry) => ["done", "blocked", "failed"].includes(entry.status)) ?? null,
    doingNow: reverse.find((entry) => entry.status === "doing") ?? null,
    nextAction: reverse.find((entry) => entry.status === "planned") ?? null
  };
}

export function formatActivityElapsed(elapsedMs = 0) {
  const totalSeconds = Math.max(Math.floor(Number(elapsedMs ?? 0) / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatActivityTimestamp(ts) {
  if (!ts) {
    return "";
  }
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function activityStatusTone(status = "done") {
  if (status === "failed") {
    return "border-rose-400/40 bg-rose-500/20 text-rose-100";
  }
  if (status === "blocked") {
    return "border-amber-400/40 bg-amber-500/20 text-amber-100";
  }
  if (status === "doing") {
    return "border-cyan-400/40 bg-cyan-500/20 text-cyan-100";
  }
  if (status === "planned") {
    return "border-violet-400/40 bg-violet-500/20 text-violet-100";
  }
  return "border-emerald-400/40 bg-emerald-500/20 text-emerald-100";
}

export function shouldHighlightLogoutActivity(entry = null) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const haystack = [entry.message, entry.kind, entry.phase, entry.details?.targetLabel, entry.details?.reason]
    .map((value) => String(value ?? ""))
    .join(" ")
    .toLowerCase();
  return /logout|log out|sign out|signout|session end|end session/.test(haystack);
}

function sanitizeActionMessage(value = "") {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
  if (!normalized) {
    return "";
  }
  return normalized.replace(SECRET_VALUE_PATTERN, (_, key) => `${key}=[REDACTED]`);
}

function normalizeActionLogEntry(entry = null) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const message = sanitizeActionMessage(entry.message ?? "");
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

export function deriveProgressActionLogs({ session = null, entries = [] } = {}) {
  const summary = deriveAgentActivitySummary(entries);
  return {
    current:
      normalizeActionLogEntry(session?.currentAction) ??
      normalizeActionLogEntry(summary.doingNow) ??
      normalizeActionLogEntry(summary.justDid) ??
      null,
    next:
      normalizeActionLogEntry(session?.nextAction) ??
      normalizeActionLogEntry(summary.nextAction) ??
      null
  };
}
