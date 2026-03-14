import { createId, nowIso } from "../lib/utils.js";
import { upsertA11yIssueClusters } from "../types/accessibility/clustering.js";
import { upsertUiuxIssueClusters } from "../library/reporting/clustering.js";
import {
  createEmptyTestCaseStats,
  TEST_CASE_BUFFER_LIMIT
} from "../library/reporting/testCaseTracker.js";

const AGENT_ACTIVITY_BUFFER_LIMIT = 300;
const AGENT_ACTIVITY_PHASES = new Set([
  "planner",
  "navigation",
  "detection",
  "auth",
  "input-fill",
  "submit",
  "resume",
  "verification",
  "issue-detection",
  "safety",
  "flow-selection",
  "uiux",
  "functionality",
  "state"
]);
const AGENT_ACTIVITY_STATUSES = new Set(["planned", "doing", "done", "blocked", "failed"]);
const SECRET_KEY_PATTERN =
  /(password|otp|token|cookie|secret|authorization|bearer|credential|fieldvalue|inputvalue|sessiontoken)/i;
const SECRET_VALUE_PATTERN =
  /(password|otp|token|cookie|secret|authorization|bearer)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

function createEmptyArtifactIndex() {
  return {
    frames: [],
    dom: [],
    a11y: [],
    console: [],
    network: [],
    downloads: [],
    har: null,
    trace: null,
    video: []
  };
}

function createDefaultTestCases(existing = []) {
  if (!Array.isArray(existing)) {
    return [];
  }
  return existing.slice(-TEST_CASE_BUFFER_LIMIT);
}

function sanitizeAgentActivityMessage(value = "") {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
  if (!normalized) {
    return "";
  }
  return normalized.replace(SECRET_VALUE_PATTERN, (_, key) => `${key}=[REDACTED]`);
}

function sanitizeAgentActivityValue(value, depth = 0) {
  if (value == null) {
    return value;
  }
  if (depth > 3) {
    return null;
  }
  if (typeof value === "string") {
    return sanitizeAgentActivityMessage(value).slice(0, 220);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((entry) => sanitizeAgentActivityValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        next[key] = "[REDACTED]";
        continue;
      }
      next[key] = sanitizeAgentActivityValue(entry, depth + 1);
    }
    return next;
  }
  return String(value);
}

function normalizeAgentActivityPhase(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (AGENT_ACTIVITY_PHASES.has(normalized)) {
    return normalized;
  }
  return "state";
}

function normalizeAgentActivityStatus(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (AGENT_ACTIVITY_STATUSES.has(normalized)) {
    return normalized;
  }
  return "done";
}

function deriveAgentActivityPhaseFromTimelineEntry(entry = {}) {
  const text = `${entry?.type ?? ""} ${entry?.message ?? ""}`.toLowerCase();
  if (/logout|sign out|auth|login|otp/.test(text)) {
    return "auth";
  }
  if (/navigation|goto|redirect|url|new-tab/.test(text)) {
    return "navigation";
  }
  if (/verification/.test(text)) {
    return "verification";
  }
  if (/safety|blocked|policy/.test(text)) {
    return "safety";
  }
  if (/issue|assertion|bug/.test(text)) {
    return "issue-detection";
  }
  if (/flow|functional/.test(text)) {
    return "functionality";
  }
  if (/uiux|responsive|breakpoint/.test(text)) {
    return "uiux";
  }
  if (/plan|candidate|about to|next/.test(text)) {
    return "planner";
  }
  return "state";
}

function deriveAgentActivityStatusFromTimelineEntry(entry = {}) {
  const text = `${entry?.type ?? ""} ${entry?.message ?? ""}`.toLowerCase();
  if (/blocked|skipped|deferred/.test(text)) {
    return "blocked";
  }
  if (/failed|error|timeout/.test(text)) {
    return "failed";
  }
  if (/waiting|awaiting|checking|validating|running/.test(text)) {
    return "doing";
  }
  if (/about to|next|selected/.test(text)) {
    return "planned";
  }
  return "done";
}

function deriveAgentActivityFromTimelineEntry(entry = {}, session = null) {
  const ts = String(entry?.at ?? nowIso()).trim() || nowIso();
  const createdAtMs = Number.isNaN(Date.parse(session?.createdAt ?? 0))
    ? Date.now()
    : Date.parse(session?.createdAt ?? 0);
  const tsMs = Number.isNaN(Date.parse(ts)) ? Date.now() : Date.parse(ts);
  const elapsedMs = Math.max(tsMs - createdAtMs, 0);
  return {
    id: createId("act"),
    ts,
    elapsedMs,
    phase: deriveAgentActivityPhaseFromTimelineEntry(entry),
    kind: String(entry?.type ?? "timeline").trim().slice(0, 120) || "timeline",
    status: deriveAgentActivityStatusFromTimelineEntry(entry),
    message: sanitizeAgentActivityMessage(entry?.message ?? ""),
    details: sanitizeAgentActivityValue({
      step: entry?.step ?? null,
      url: entry?.url ?? null,
      action: entry?.action ?? null,
      blockerType: entry?.blockerType ?? null,
      resolutionHint: entry?.resolutionHint ?? null,
      source: "timeline"
    })
  };
}

function createDefaultAgentActivity(existing = [], session = null) {
  if (!Array.isArray(existing)) {
    return [];
  }
  const createdAtMs = Number.isNaN(Date.parse(session?.createdAt ?? 0))
    ? Date.now()
    : Date.parse(session?.createdAt ?? 0);
  return existing
    .slice(-AGENT_ACTIVITY_BUFFER_LIMIT)
    .map((entry) => {
      const ts = String(entry?.ts ?? nowIso()).trim() || nowIso();
      const tsMs = Number.isNaN(Date.parse(ts)) ? Date.now() : Date.parse(ts);
      return {
        id: String(entry?.id ?? createId("act")),
        ts,
        elapsedMs: Number.isFinite(Number(entry?.elapsedMs))
          ? Math.max(Number(entry.elapsedMs), 0)
          : Math.max(tsMs - createdAtMs, 0),
        phase: normalizeAgentActivityPhase(entry?.phase),
        kind: String(entry?.kind ?? "event").trim().slice(0, 120) || "event",
        status: normalizeAgentActivityStatus(entry?.status),
        message: sanitizeAgentActivityMessage(entry?.message ?? ""),
        details: sanitizeAgentActivityValue(entry?.details ?? null)
      };
    });
}

function normalizeSessionActionEntry(entry = null) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const message = sanitizeAgentActivityMessage(entry?.message ?? "");
  if (!message) {
    return null;
  }
  return {
    id: String(entry?.id ?? createId("act")),
    ts: String(entry?.ts ?? nowIso()).trim() || nowIso(),
    elapsedMs: Number.isFinite(Number(entry?.elapsedMs))
      ? Math.max(Number(entry.elapsedMs), 0)
      : 0,
    phase: normalizeAgentActivityPhase(entry?.phase ?? "state"),
    status: normalizeAgentActivityStatus(entry?.status ?? "done"),
    message
  };
}

function deriveCurrentAndNextAction(agentActivity = []) {
  if (!Array.isArray(agentActivity) || agentActivity.length === 0) {
    return {
      currentAction: null,
      nextAction: null
    };
  }

  const reverse = [...agentActivity].reverse();
  const current =
    reverse.find((entry) => normalizeAgentActivityStatus(entry?.status) === "doing") ??
    reverse.find((entry) => {
      const status = normalizeAgentActivityStatus(entry?.status);
      return status === "done" || status === "blocked" || status === "failed";
    }) ??
    reverse[0] ??
    null;
  const next = reverse.find((entry) => normalizeAgentActivityStatus(entry?.status) === "planned") ?? null;

  return {
    currentAction: normalizeSessionActionEntry(current),
    nextAction: normalizeSessionActionEntry(next)
  };
}

function createDefaultAccessibilityState(existing = {}) {
  return {
    enabled: false,
    currentCanonicalUrl: null,
    pagesScanned: [],
    blockedForFurtherProgress: [],
    deviceSummary: [],
    failedDevices: [],
    issues: [],
    clusters: [],
    interactionsAttempted: 0,
    interactionsSkippedBySafety: 0,
    artifactsPrunedCount: 0,
    artifactsRetainedCount: 0,
    contrastSummary: {
      enabled: false,
      pagesEvaluated: 0,
      sampleLimit: 40,
      minRatioNormalText: 4.5,
      minRatioLargeText: 3.0,
      sampledCount: 0,
      offenderCount: 0,
      worstRatio: null,
      worstOffenders: []
    },
    textScaleSummary: {
      enabled: false,
      scales: [1, 1.25, 1.5],
      pagesEvaluated: 0,
      pagesWithBreaks: 0,
      breakByScale: [],
      worstBreak: null
    },
    reducedMotionSummary: {
      enabled: false,
      pagesEvaluated: 0,
      pagesWithPersistentMotion: 0,
      maxLongAnimationCount: 0,
      worstCase: null
    },
    formSummary: {
      enabled: false,
      mode: "observe-only",
      safeSubmitTypes: ["search"],
      pagesEvaluated: 0,
      controlsObserved: 0,
      visibleErrorsObserved: 0,
      requiredNotAnnouncedCount: 0,
      errorNotAssociatedCount: 0,
      errorNotAnnouncedCount: 0,
      describedByMissingTargetCount: 0,
      invalidFieldNotFocusedCount: 0,
      safeSubmitAttempts: 0,
      safeSubmitSkips: 0,
      sampleFieldSelectors: []
    },
    ...existing
  };
}

function createDefaultUiuxState(existing = {}) {
  return {
    enabled: false,
    effectiveBudget: null,
    currentCanonicalUrl: null,
    pagesVisited: [],
    uniqueStateHashes: [],
    blockedForFurtherProgress: [],
    pageDeviceMatrix: [],
    deviceSummary: [],
    failingDevices: [],
    breakpointSummary: null,
    sampledWidths: [],
    discoveredComponents: [],
    issues: [],
    clusters: [],
    interactionsAttempted: 0,
    interactionsSkippedBySafety: 0,
    artifactsPrunedCount: 0,
    artifactsRetainedCount: 0,
    ...existing
  };
}

function resolveSessionSummary(existing = {}) {
  if (typeof existing.summary === "string" && existing.summary.trim().length > 0) {
    return existing.summary;
  }
  if (typeof existing.success?.summary === "string" && existing.success.summary.trim().length > 0) {
    return existing.success.summary;
  }
  if (typeof existing.bug?.summary === "string" && existing.bug.summary.trim().length > 0) {
    return existing.bug.summary;
  }
  return null;
}

function resolveEffectiveBudgets(existing = {}) {
  return existing.effectiveBudgets ?? null;
}

function createDefaultAuthAssist(existing = null) {
  if (!existing) {
    return null;
  }

  const normalizedState = existing.state ?? "awaiting_credentials";
  const normalizedCode = existing.code ?? null;
  const normalizedForm = {
    identifierFieldDetected: Boolean(existing.form?.identifierFieldDetected),
    usernameFieldDetected: Boolean(existing.form?.usernameFieldDetected ?? existing.form?.identifierFieldDetected),
    passwordFieldDetected: Boolean(existing.form?.passwordFieldDetected),
    otpFieldDetected: Boolean(existing.form?.otpFieldDetected),
    submitControlDetected: Boolean(existing.form?.submitControlDetected),
    identifierFilled: Boolean(existing.form?.identifierFilled),
    usernameFilled: Boolean(existing.form?.usernameFilled),
    passwordFilled: Boolean(existing.form?.passwordFilled),
    submitTriggered: Boolean(existing.form?.submitTriggered),
    submitControlType: existing.form?.submitControlType ?? "none",
    postSubmitUrlChanged: Boolean(existing.form?.postSubmitUrlChanged),
    postSubmitProbeState: existing.form?.postSubmitProbeState ?? null,
    postSubmitUrl: existing.form?.postSubmitUrl ?? null,
    visibleStep: existing.form?.visibleStep ?? null,
    identifierFieldVisibleCount: Number(existing.form?.identifierFieldVisibleCount ?? 0),
    identifierLabelCandidates: Array.isArray(existing.form?.identifierLabelCandidates)
      ? existing.form.identifierLabelCandidates.slice(0, 5)
      : [],
    usernameFieldVisibleCount: Number(existing.form?.usernameFieldVisibleCount ?? 0),
    passwordFieldVisibleCount: Number(existing.form?.passwordFieldVisibleCount ?? 0),
    otpFieldVisibleCount: Number(existing.form?.otpFieldVisibleCount ?? 0),
    inputFields: Array.isArray(existing.form?.inputFields)
      ? existing.form.inputFields
          .map((field, index) => {
            const key = String(field?.key ?? "").trim().toLowerCase();
            if (!key) {
              return null;
            }
            return {
              key,
              label: String(field?.label ?? "").trim() || key,
              placeholder: String(field?.placeholder ?? "").trim() || String(field?.label ?? "").trim() || key,
              kind: String(field?.kind ?? "text").trim().toLowerCase() || "text",
              secret: Boolean(field?.secret),
              required: Boolean(field?.required),
              position: Number.isFinite(Number(field?.position)) ? Number(field.position) : index + 1
            };
          })
          .filter(Boolean)
      : [],
    submitAction:
      existing.form?.submitAction && typeof existing.form.submitAction === "object"
        ? {
            label: String(existing.form.submitAction.label ?? "").trim() || "Submit",
            type: String(existing.form.submitAction.type ?? "").trim().toLowerCase() || "control"
          }
        : null,
    nextRecommendedAction: existing.form?.nextRecommendedAction ?? null
  };
  const normalizedRuntime = {
    browserActionExecuted: Boolean(existing.runtime?.browserActionExecuted),
    inputFieldsConsumed: Boolean(existing.runtime?.inputFieldsConsumed),
    fillExecutionAttempted: Boolean(existing.runtime?.fillExecutionAttempted),
    fillExecutionSucceeded: Boolean(existing.runtime?.fillExecutionSucceeded),
    fieldTargetsResolvedCount: Number(existing.runtime?.fieldTargetsResolvedCount ?? 0),
    fieldTargetsFilledCount: Number(existing.runtime?.fieldTargetsFilledCount ?? 0),
    fieldTargetsVerifiedCount: Number(existing.runtime?.fieldTargetsVerifiedCount ?? 0),
    focusedFieldKeys: Array.isArray(existing.runtime?.focusedFieldKeys)
      ? existing.runtime.focusedFieldKeys
          .map((key) => String(key ?? "").trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 12)
      : [],
    identifierFilled: Boolean(existing.runtime?.identifierFilled),
    usernameFilled: Boolean(existing.runtime?.usernameFilled),
    passwordFilled: Boolean(existing.runtime?.passwordFilled),
    submitTriggered: Boolean(existing.runtime?.submitTriggered),
    submitControlResolved: Boolean(existing.runtime?.submitControlResolved),
    submitControlType: existing.runtime?.submitControlType ?? "none",
    submitControlDetected: Boolean(existing.runtime?.submitControlDetected),
    targetedPageUrl: existing.runtime?.targetedPageUrl ?? null,
    targetedFrameUrl: existing.runtime?.targetedFrameUrl ?? null,
    targetedFrameType: (() => {
      const value = String(existing.runtime?.targetedFrameType ?? "unknown").trim().toLowerCase();
      return ["page", "iframe", "shadow-host", "unknown"].includes(value) ? value : "unknown";
    })(),
    perField: Array.isArray(existing.runtime?.perField)
      ? existing.runtime.perField
          .map((field) => {
            const key = String(field?.key ?? "").trim().toLowerCase();
            if (!key) {
              return null;
            }
            return {
              key,
              resolved: Boolean(field?.resolved),
              actionable: Boolean(field?.actionable),
              fillAttempted: Boolean(field?.fillAttempted),
              filled: Boolean(field?.filled),
              verified: Boolean(field?.verified),
              valuePresentAfterFill: Boolean(field?.valuePresentAfterFill),
              valueLengthAfterFill: Number.isFinite(Number(field?.valueLengthAfterFill))
                ? Number(field.valueLengthAfterFill)
                : 0
            };
          })
          .filter(Boolean)
      : [],
    viewerFrameCapturedAfterFill: Boolean(existing.runtime?.viewerFrameCapturedAfterFill),
    viewerFrameCapturedAfterSubmit: Boolean(existing.runtime?.viewerFrameCapturedAfterSubmit),
    resumeLoopAwakened: Boolean(existing.runtime?.resumeLoopAwakened),
    resumeLoopConsumedFields: Boolean(existing.runtime?.resumeLoopConsumedFields),
    postSubmitUrlChanged: Boolean(existing.runtime?.postSubmitUrlChanged),
    postSubmitProbeState: existing.runtime?.postSubmitProbeState ?? null,
    postSubmitUrl: existing.runtime?.postSubmitUrl ?? null,
    authClassificationReason:
      typeof existing.runtime?.authClassificationReason === "string" &&
      existing.runtime.authClassificationReason.trim().length > 0
        ? existing.runtime.authClassificationReason.trim()
        : null,
    loginWallStrength: (() => {
      const value = String(existing.runtime?.loginWallStrength ?? "none").trim().toLowerCase();
      return ["none", "weak", "medium", "strong"].includes(value) ? value : "none";
    })(),
    authenticatedSignalStrength: (() => {
      const value = String(existing.runtime?.authenticatedSignalStrength ?? "weak").trim().toLowerCase();
      return ["none", "weak", "medium", "strong"].includes(value) ? value : "weak";
    })(),
    currentFunctionalPhase: (() => {
      const value = String(existing.runtime?.currentFunctionalPhase ?? "authenticated").trim().toLowerCase();
      return ["pre_auth", "authenticated", "final_logout"].includes(value) ? value : "authenticated";
    })(),
    authenticatedConfirmedAt: existing.runtime?.authenticatedConfirmedAt ?? null,
    resumedFromAuth: Boolean(existing.runtime?.resumedFromAuth),
    logoutScheduled: Boolean(existing.runtime?.logoutScheduled),
    logoutExecuted: Boolean(existing.runtime?.logoutExecuted),
    whyAuthRegressed:
      typeof existing.runtime?.whyAuthRegressed === "string" &&
      existing.runtime.whyAuthRegressed.trim().length > 0
        ? existing.runtime.whyAuthRegressed.trim()
        : null,
    whyLogoutBlocked:
      typeof existing.runtime?.whyLogoutBlocked === "string" &&
      existing.runtime.whyLogoutBlocked.trim().length > 0
        ? existing.runtime.whyLogoutBlocked.trim()
        : null
  };
  const otpPending = Boolean(
    ["awaiting_otp", "submitting_otp"].includes(normalizedState) ||
    normalizedCode === "OTP_REQUIRED" ||
    normalizedCode === "OTP_INVALID"
  );
  const credentialsPending = Boolean(
    !otpPending &&
    [
      "awaiting_username",
      "awaiting_password",
      "awaiting_credentials",
      "awaiting_input_fields",
      "auth_step_advanced",
      "auth_unknown_state",
      "submitting_credentials",
      "submitting_input_fields",
      "auth_failed"
    ].includes(normalizedState)
  );
  const derivedDebug = {
    authPanelEligible:
      !["running", "authenticated", "resumed"].includes(normalizedState) &&
      (credentialsPending || otpPending),
    sessionStatus: null,
    mode: null,
    authState: normalizedState,
    credentialsPending,
    otpPending,
    identifierFilled: Boolean(normalizedRuntime.identifierFilled),
    passwordFilled: Boolean(normalizedRuntime.passwordFilled),
    submitTriggered: Boolean(normalizedRuntime.submitTriggered),
    submitControlType: normalizedRuntime.submitControlType ?? "none",
    fieldTargetsResolvedCount: Number(normalizedRuntime.fieldTargetsResolvedCount ?? 0),
    fieldTargetsFilledCount: Number(normalizedRuntime.fieldTargetsFilledCount ?? 0),
    fieldTargetsVerifiedCount: Number(normalizedRuntime.fieldTargetsVerifiedCount ?? 0),
    fillExecutionSucceeded: Boolean(normalizedRuntime.fillExecutionSucceeded),
    targetedPageUrl: normalizedRuntime.targetedPageUrl ?? existing.pageUrl ?? null,
    targetedFrameUrl: normalizedRuntime.targetedFrameUrl ?? normalizedRuntime.targetedPageUrl ?? existing.pageUrl ?? null,
    targetedFrameType: normalizedRuntime.targetedFrameType ?? "unknown",
    viewerFrameCapturedAfterFill: Boolean(normalizedRuntime.viewerFrameCapturedAfterFill),
    viewerFrameCapturedAfterSubmit: Boolean(normalizedRuntime.viewerFrameCapturedAfterSubmit),
    resumeLoopAwakened: Boolean(normalizedRuntime.resumeLoopAwakened),
    resumeLoopConsumedFields: Boolean(normalizedRuntime.resumeLoopConsumedFields),
    postSubmitUrl: normalizedRuntime.postSubmitUrl ?? existing.pageUrl ?? null,
    postSubmitProbeState:
      normalizedRuntime.postSubmitProbeState ??
      normalizedForm.postSubmitProbeState ??
      null,
    authClassificationReason: normalizedRuntime.authClassificationReason ?? null,
    loginWallStrength: normalizedRuntime.loginWallStrength ?? "none",
    authenticatedSignalStrength: normalizedRuntime.authenticatedSignalStrength ?? "weak",
    currentFunctionalPhase: normalizedRuntime.currentFunctionalPhase ?? "authenticated",
    authenticatedConfirmedAt: normalizedRuntime.authenticatedConfirmedAt ?? null,
    resumedFromAuth: Boolean(normalizedRuntime.resumedFromAuth),
    logoutScheduled: Boolean(normalizedRuntime.logoutScheduled),
    logoutExecuted: Boolean(normalizedRuntime.logoutExecuted),
    whyAuthRegressed: normalizedRuntime.whyAuthRegressed ?? null,
    whyLogoutBlocked: normalizedRuntime.whyLogoutBlocked ?? null
  };

  return {
    state: normalizedState,
    code: normalizedCode,
    source: existing.source ?? null,
    reason: existing.reason ?? "",
    site: existing.site ?? "",
    pageUrl: existing.pageUrl ?? "",
    loginRequired: existing.loginRequired !== false,
    form: normalizedForm,
    runtime: normalizedRuntime,
    startedAt: existing.startedAt ?? null,
    timeoutMs: existing.timeoutMs ?? null,
    remainingMs: existing.remainingMs ?? null,
    endedAt: existing.endedAt ?? null,
    resumedAt: existing.resumedAt ?? null,
    resumeTargetUrl: existing.resumeTargetUrl ?? null,
    resumeCheckpoint: existing.resumeCheckpoint ?? null,
    profileTag: existing.profileTag ?? "",
    submitAttempted: existing.submitAttempted === true,
    resumeTriggered: existing.resumeTriggered === true,
    updatedAt: existing.updatedAt ?? null,
    resumeRequestedAt: existing.resumeRequestedAt ?? null,
    debug: {
      authPanelEligible: derivedDebug.authPanelEligible,
      sessionStatus: existing.debug?.sessionStatus ?? null,
      mode: existing.debug?.mode ?? null,
      authState: normalizedState,
      credentialsPending,
      otpPending,
      identifierFilled: Boolean(normalizedRuntime.identifierFilled),
      passwordFilled: Boolean(normalizedRuntime.passwordFilled),
      submitTriggered: Boolean(normalizedRuntime.submitTriggered),
      submitControlType: normalizedRuntime.submitControlType ?? "none",
      fieldTargetsResolvedCount: Number(normalizedRuntime.fieldTargetsResolvedCount ?? 0),
      fieldTargetsFilledCount: Number(normalizedRuntime.fieldTargetsFilledCount ?? 0),
      fieldTargetsVerifiedCount: Number(normalizedRuntime.fieldTargetsVerifiedCount ?? 0),
      fillExecutionSucceeded: Boolean(normalizedRuntime.fillExecutionSucceeded),
      targetedPageUrl: normalizedRuntime.targetedPageUrl ?? derivedDebug.postSubmitUrl,
      targetedFrameUrl: normalizedRuntime.targetedFrameUrl ?? normalizedRuntime.targetedPageUrl ?? derivedDebug.postSubmitUrl,
      targetedFrameType: normalizedRuntime.targetedFrameType ?? "unknown",
      viewerFrameCapturedAfterFill: Boolean(normalizedRuntime.viewerFrameCapturedAfterFill),
      viewerFrameCapturedAfterSubmit: Boolean(normalizedRuntime.viewerFrameCapturedAfterSubmit),
      resumeLoopAwakened: Boolean(normalizedRuntime.resumeLoopAwakened),
      resumeLoopConsumedFields: Boolean(normalizedRuntime.resumeLoopConsumedFields),
      postSubmitUrl: normalizedRuntime.postSubmitUrl ?? derivedDebug.postSubmitUrl,
      postSubmitProbeState: normalizedRuntime.postSubmitProbeState ?? derivedDebug.postSubmitProbeState,
      authClassificationReason: normalizedRuntime.authClassificationReason ?? null,
      loginWallStrength: normalizedRuntime.loginWallStrength ?? "none",
      authenticatedSignalStrength: normalizedRuntime.authenticatedSignalStrength ?? "weak",
      currentFunctionalPhase: normalizedRuntime.currentFunctionalPhase ?? "authenticated",
      authenticatedConfirmedAt: normalizedRuntime.authenticatedConfirmedAt ?? null,
      resumedFromAuth: Boolean(normalizedRuntime.resumedFromAuth),
      logoutScheduled: Boolean(normalizedRuntime.logoutScheduled),
      logoutExecuted: Boolean(normalizedRuntime.logoutExecuted),
      whyAuthRegressed: normalizedRuntime.whyAuthRegressed ?? null,
      whyLogoutBlocked: normalizedRuntime.whyLogoutBlocked ?? null
    }
  };
}

function createDefaultFormAssist(existing = null) {
  if (!existing) {
    return null;
  }

  return {
    state: existing.state ?? "idle",
    pageUrl: existing.pageUrl ?? "",
    step: Number(existing.step ?? 0),
    flowId: existing.flowId ?? null,
    reason: existing.reason ?? "",
    groups: Array.isArray(existing.groups) ? existing.groups : [],
    decisions: existing.decisions && typeof existing.decisions === "object" ? existing.decisions : {},
    globalAction: existing.globalAction ?? null,
    pendingGroupIds: Array.isArray(existing.pendingGroupIds) ? existing.pendingGroupIds : [],
    history: Array.isArray(existing.history) ? existing.history : [],
    startedAt: existing.startedAt ?? null,
    endedAt: existing.endedAt ?? null,
    updatedAt: existing.updatedAt ?? null
  };
}

function createDefaultVerificationAssist(existing = null) {
  if (!existing) {
    return null;
  }

  return {
    state: existing.state ?? "idle",
    pageUrl: existing.pageUrl ?? "",
    step: Number(existing.step ?? 0),
    flowId: existing.flowId ?? null,
    reason: existing.reason ?? "",
    prompts: Array.isArray(existing.prompts) ? existing.prompts : [],
    decisions: existing.decisions && typeof existing.decisions === "object" ? existing.decisions : {},
    globalDecision: existing.globalDecision ?? null,
    pendingPromptIds: Array.isArray(existing.pendingPromptIds) ? existing.pendingPromptIds : [],
    startedAt: existing.startedAt ?? null,
    endedAt: existing.endedAt ?? null,
    updatedAt: existing.updatedAt ?? null
  };
}

export class SessionStore {
  constructor({ persistence } = {}) {
    this.sessions = new Map();
    this.persistence = persistence ?? null;
    this.hydrate();
  }

  hydrate() {
    if (!this.persistence) {
      return;
    }

    for (const session of this.persistence.loadAllSessions()) {
      const normalizedAgentActivity = createDefaultAgentActivity(session.agentActivity ?? [], session);
      this.sessions.set(session.id, {
        ...session,
        summary: resolveSessionSummary(session),
        effectiveBudgets: resolveEffectiveBudgets(session),
        agentActivity: normalizedAgentActivity,
        ...deriveCurrentAndNextAction(normalizedAgentActivity),
        authAssist: createDefaultAuthAssist(session.authAssist ?? null),
        formAssist: createDefaultFormAssist(session.formAssist ?? null),
        verificationAssist: createDefaultVerificationAssist(session.verificationAssist ?? null),
        testCaseStats: createEmptyTestCaseStats(session.testCaseStats ?? {}),
        testCases: createDefaultTestCases(session.testCases ?? []),
        uiux: createDefaultUiuxState(session.uiux ?? {}),
        accessibility: createDefaultAccessibilityState(session.accessibility ?? {}),
        functional: {
          enabled: false,
          flowsRun: 0,
          flows: [],
          assertionCounts: {
            evaluated: 0,
            passed: 0,
            failed: 0
          },
          deviceSummary: [],
          issues: [],
          blockers: [],
          blockerTimeline: [],
          resumePoints: [],
          loginAssist: {
            attempted: false,
            success: false,
            timeout: false,
            resumeStrategy: "restart-flow",
            profileTag: ""
          },
          summary: "",
          reproBundles: [],
          contractSummary: {
            snapshotsObserved: 0,
            apiCallsObserved: 0,
            apiErrorCounts: {
              "4xx": 0,
              "5xx": 0,
              timeouts: 0
            },
            topFailingEndpoints: [],
            stepsWithApi5xx: 0,
            stepsWithGraphqlErrors: 0,
            stepsWithThirdPartyFailures: 0,
            failingAssertionCounts: {},
            config: {
              failOnApi5xx: true,
              warnOnThirdPartyFailures: true,
              endpointAllowlistPatterns: [],
              endpointBlocklistPatterns: []
            }
          },
          baselineDiff: null,
          graph: {
            nodes: [],
            edges: []
          },
          ...(session.functional ?? {})
        },
        artifactIndex: {
          ...createEmptyArtifactIndex(),
          ...(session.artifactIndex ?? {})
        }
      });
    }
  }

  ensureSessionLoaded(id) {
    if (this.sessions.has(id) || !this.persistence) {
      return this.sessions.get(id) ?? null;
    }

    const loaded = this.persistence.loadSession(id);
    if (loaded) {
      const normalizedAgentActivity = createDefaultAgentActivity(loaded.agentActivity ?? [], loaded);
      this.sessions.set(id, {
        ...loaded,
        summary: resolveSessionSummary(loaded),
        effectiveBudgets: resolveEffectiveBudgets(loaded),
        agentActivity: normalizedAgentActivity,
        ...deriveCurrentAndNextAction(normalizedAgentActivity),
        authAssist: createDefaultAuthAssist(loaded.authAssist ?? null),
        formAssist: createDefaultFormAssist(loaded.formAssist ?? null),
        verificationAssist: createDefaultVerificationAssist(loaded.verificationAssist ?? null),
        testCaseStats: createEmptyTestCaseStats(loaded.testCaseStats ?? {}),
        testCases: createDefaultTestCases(loaded.testCases ?? []),
        uiux: createDefaultUiuxState(loaded.uiux ?? {}),
        accessibility: createDefaultAccessibilityState(loaded.accessibility ?? {}),
        functional: {
          enabled: false,
          flowsRun: 0,
          flows: [],
          assertionCounts: {
            evaluated: 0,
            passed: 0,
            failed: 0
          },
          deviceSummary: [],
          issues: [],
          blockers: [],
          blockerTimeline: [],
          resumePoints: [],
          loginAssist: {
            attempted: false,
            success: false,
            timeout: false,
            resumeStrategy: "restart-flow",
            profileTag: ""
          },
          summary: "",
          reproBundles: [],
          contractSummary: {
            snapshotsObserved: 0,
            apiCallsObserved: 0,
            apiErrorCounts: {
              "4xx": 0,
              "5xx": 0,
              timeouts: 0
            },
            topFailingEndpoints: [],
            stepsWithApi5xx: 0,
            stepsWithGraphqlErrors: 0,
            stepsWithThirdPartyFailures: 0,
            failingAssertionCounts: {},
            config: {
              failOnApi5xx: true,
              warnOnThirdPartyFailures: true,
              endpointAllowlistPatterns: [],
              endpointBlocklistPatterns: []
            }
          },
          baselineDiff: null,
          graph: {
            nodes: [],
            edges: []
          },
          ...(loaded.functional ?? {})
        },
        artifactIndex: {
          ...createEmptyArtifactIndex(),
          ...(loaded.artifactIndex ?? {})
        }
      });
    }

    return this.sessions.get(id) ?? null;
  }

  syncPersist(session) {
    if (this.persistence && session) {
      this.persistence.saveSession(session);
    }
  }

  createSession(input) {
    const id = createId("qa");
    const session = {
      id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "queued",
      goal: input.goal,
      startUrl: input.startUrl,
      runConfig: input.runConfig,
      providerMode: input.providerMode,
      goalFamily: input.goalFamily ?? "generic",
      profileId: input.profileId ?? null,
      profile: input.profile ?? null,
      sessionHealth: input.sessionHealth ?? null,
      currentUrl: input.startUrl,
      currentStep: 0,
      lastThought: "",
      lastAudit: "",
      evidence: null,
      bug: null,
      success: null,
      frame: null,
      currentHighlight: null,
      gateState: "READY",
      primaryBlocker: null,
      outcome: null,
      summary: input.summary ?? null,
      effectiveBudgets: input.effectiveBudgets ?? null,
      runSummary: null,
      loginAssist: null,
      authAssist: null,
      formAssist: null,
      verificationAssist: null,
      testCaseStats: createEmptyTestCaseStats(),
      testCases: [],
      agentActivity: [],
      currentAction: null,
      nextAction: null,
      history: [],
      timeline: [],
      observations: [],
      incidents: [],
      uiux: createDefaultUiuxState({
        enabled:
          input.runConfig?.testMode === "uiux" ||
          (input.runConfig?.testMode === "default" &&
            input.runConfig?.exploration?.strategy === "coverage-driven")
      }),
      accessibility: createDefaultAccessibilityState({
        enabled: input.runConfig?.testMode === "accessibility"
      }),
      functional: {
        enabled: input.runConfig?.testMode === "functional",
        flowsRun: 0,
        flows: [],
        assertionCounts: {
          evaluated: 0,
          passed: 0,
          failed: 0
        },
        deviceSummary: [],
        issues: [],
        blockers: [],
        blockerTimeline: [],
        resumePoints: [],
        loginAssist: {
          attempted: false,
          success: false,
          timeout: false,
          resumeStrategy: input.runConfig?.functional?.loginAssist?.resumeStrategy ?? "restart-flow",
          profileTag: input.runConfig?.profileTag ?? ""
        },
        summary: "",
        reproBundles: [],
        contractSummary: {
          snapshotsObserved: 0,
          apiCallsObserved: 0,
          apiErrorCounts: {
            "4xx": 0,
            "5xx": 0,
            timeouts: 0
          },
          topFailingEndpoints: [],
          stepsWithApi5xx: 0,
          stepsWithGraphqlErrors: 0,
          stepsWithThirdPartyFailures: 0,
          failingAssertionCounts: {},
          config: {
            failOnApi5xx: true,
            warnOnThirdPartyFailures: true,
            endpointAllowlistPatterns: [],
            endpointBlocklistPatterns: []
          }
        },
        baselineDiff: null,
        graph: {
          nodes: [],
          edges: []
        }
      },
      steps: [],
      artifactIndex: createEmptyArtifactIndex(),
      graph: {
        nodes: [],
        edges: []
      },
      crawler: {
        mode: input.runConfig?.crawlerMode ?? false,
        actionBudget: input.runConfig?.budgets?.maxSteps ?? null,
        startAt: nowIso()
      },
      report: null
    };

    this.sessions.set(id, session);
    this.syncPersist(session);
    return session;
  }

  getSession(id) {
    return this.ensureSessionLoaded(id);
  }

  listSessions() {
    this.hydrate();
    return Array.from(this.sessions.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
  }

  patchSession(id, patch) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      ...patch,
      testCaseStats: createEmptyTestCaseStats({
        ...(current.testCaseStats ?? {}),
        ...(patch.testCaseStats ?? {})
      }),
      authAssist:
        patch.authAssist === undefined
          ? createDefaultAuthAssist(current.authAssist ?? null)
          : patch.authAssist === null
            ? null
            : createDefaultAuthAssist({
                ...(current.authAssist ?? {}),
                ...(patch.authAssist ?? {})
              }),
      formAssist:
        patch.formAssist === undefined
          ? createDefaultFormAssist(current.formAssist ?? null)
          : patch.formAssist === null
            ? null
            : createDefaultFormAssist({
                ...(current.formAssist ?? {}),
                ...(patch.formAssist ?? {})
              }),
      verificationAssist:
        patch.verificationAssist === undefined
          ? createDefaultVerificationAssist(current.verificationAssist ?? null)
          : patch.verificationAssist === null
            ? null
            : createDefaultVerificationAssist({
                ...(current.verificationAssist ?? {}),
                ...(patch.verificationAssist ?? {})
              }),
      agentActivity:
        patch.agentActivity === undefined
          ? createDefaultAgentActivity(current.agentActivity ?? [], current)
          : createDefaultAgentActivity(
              Array.isArray(patch.agentActivity) ? patch.agentActivity : [],
              current
            ),
      testCases: createDefaultTestCases(
        Array.isArray(patch.testCases) ? patch.testCases : current.testCases
      ),
      artifactIndex: {
        ...createEmptyArtifactIndex(),
        ...(current.artifactIndex ?? {}),
        ...(patch.artifactIndex ?? {})
      },
      updatedAt: nowIso()
    };

    const derivedActions = deriveCurrentAndNextAction(updated.agentActivity ?? []);
    const hasCurrentActionPatch = Object.prototype.hasOwnProperty.call(patch, "currentAction");
    const hasNextActionPatch = Object.prototype.hasOwnProperty.call(patch, "nextAction");
    const explicitCurrentAction = hasCurrentActionPatch
      ? normalizeSessionActionEntry(patch.currentAction)
      : undefined;
    const explicitNextAction = hasNextActionPatch
      ? normalizeSessionActionEntry(patch.nextAction)
      : undefined;

    updated.currentAction =
      explicitCurrentAction === undefined ? derivedActions.currentAction : explicitCurrentAction;
    updated.nextAction =
      explicitNextAction === undefined ? derivedActions.nextAction : explicitNextAction;

    this.sessions.set(id, updated);
    this.syncPersist(updated);
    return updated;
  }

  appendTimeline(id, entry) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    const timelineEntry = { ...entry, at: nowIso() };
    current.timeline = [...current.timeline, timelineEntry].slice(-120);
    const derivedActivity = deriveAgentActivityFromTimelineEntry(timelineEntry, current);
    current.agentActivity = [...(current.agentActivity ?? []), derivedActivity].slice(
      -AGENT_ACTIVITY_BUFFER_LIMIT
    );
    const derivedActions = deriveCurrentAndNextAction(current.agentActivity ?? []);
    current.currentAction = derivedActions.currentAction;
    current.nextAction = derivedActions.nextAction;
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendAgentActivity(id, entry = {}) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    const ts = String(entry?.ts ?? nowIso()).trim() || nowIso();
    const createdAtMs = Number.isNaN(Date.parse(current?.createdAt ?? 0))
      ? Date.now()
      : Date.parse(current?.createdAt ?? 0);
    const tsMs = Number.isNaN(Date.parse(ts)) ? Date.now() : Date.parse(ts);
    const normalizedEntry = {
      id: String(entry?.id ?? createId("act")),
      ts,
      elapsedMs: Number.isFinite(Number(entry?.elapsedMs))
        ? Math.max(Number(entry.elapsedMs), 0)
        : Math.max(tsMs - createdAtMs, 0),
      phase: normalizeAgentActivityPhase(entry?.phase),
      kind: String(entry?.kind ?? "event").trim().slice(0, 120) || "event",
      status: normalizeAgentActivityStatus(entry?.status),
      message: sanitizeAgentActivityMessage(entry?.message ?? ""),
      details: sanitizeAgentActivityValue(entry?.details ?? null)
    };

    if (!normalizedEntry.message) {
      return current;
    }

    current.agentActivity = [...(current.agentActivity ?? []), normalizedEntry].slice(
      -AGENT_ACTIVITY_BUFFER_LIMIT
    );
    const derivedActions = deriveCurrentAndNextAction(current.agentActivity ?? []);
    current.currentAction = derivedActions.currentAction;
    current.nextAction = derivedActions.nextAction;
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendObservation(id, observation) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.observations = [...current.observations, observation].slice(-160);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendIncident(id, incident) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.incidents = [...current.incidents, incident].slice(-80);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendUiuxIssue(id, issue) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.uiux = {
      ...(current.uiux ?? {}),
      issues: [...(current.uiux?.issues ?? []), issue].slice(-200),
      clusters: upsertUiuxIssueClusters(current.uiux?.clusters ?? [], issue).slice(0, 120)
    };
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendAccessibilityIssue(id, issue) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.accessibility = {
      ...(current.accessibility ?? createDefaultAccessibilityState()),
      issues: [...(current.accessibility?.issues ?? []), issue].slice(-240),
      clusters: upsertA11yIssueClusters(current.accessibility?.clusters ?? [], issue).slice(0, 140)
    };
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  upsertStep(id, stepRecord) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    const existingIndex = current.steps.findIndex((entry) => entry.stepId === stepRecord.stepId);
    if (existingIndex >= 0) {
      current.steps[existingIndex] = {
        ...current.steps[existingIndex],
        ...stepRecord
      };
    } else {
      current.steps = [...current.steps, stepRecord];
    }

    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendGraphNode(id, node) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    if (!current.graph.nodes.some((entry) => entry.nodeId === node.nodeId)) {
      current.graph.nodes = [...current.graph.nodes, node].slice(-200);
    }

    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendGraphEdge(id, edge) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.graph.edges = [...current.graph.edges, edge].slice(-200);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }
}
