import { inferAuthFormStep } from "./authFormStep.js";

function boolOrFallback(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return Boolean(fallback);
}

function numberOrFallback(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback ?? 0);
}

function normalizeLabelCandidates(candidates = [], fallback = []) {
  const source = Array.isArray(candidates) ? candidates : fallback;
  return Array.from(
    new Set(
      source
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .slice(0, 5)
    )
  );
}

function normalizeInputFields(inputFields = [], fallback = []) {
  const source = Array.isArray(inputFields) ? inputFields : fallback;
  const normalized = [];
  const seen = new Set();

  for (const field of source) {
    const key = String(field?.key ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      key,
      label: String(field?.label ?? "").trim() || key,
      placeholder: String(field?.placeholder ?? "").trim() || String(field?.label ?? "").trim() || key,
      kind: String(field?.kind ?? "text").trim().toLowerCase() || "text",
      secret: Boolean(field?.secret),
      required: Boolean(field?.required),
      position: Number.isFinite(Number(field?.position)) ? Number(field.position) : normalized.length + 1
    });
  }

  return normalized;
}

function normalizeSubmitAction(submitAction = null, fallback = null) {
  const source =
    submitAction && typeof submitAction === "object"
      ? submitAction
      : fallback && typeof fallback === "object"
        ? fallback
        : null;

  if (!source) {
    return null;
  }

  const label = String(source?.label ?? "").trim() || "Submit";
  const type = String(source?.type ?? "").trim().toLowerCase() || "control";
  return {
    label,
    type
  };
}

function normalizeKeyList(keys = [], fallback = []) {
  const source = Array.isArray(keys) ? keys : fallback;
  return Array.from(
    new Set(
      source
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

function normalizeFrameType(value = "", fallback = "unknown") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["page", "iframe", "shadow-host", "unknown"].includes(normalized)) {
    return normalized;
  }
  const fallbackNormalized = String(fallback ?? "").trim().toLowerCase();
  if (["page", "iframe", "shadow-host", "unknown"].includes(fallbackNormalized)) {
    return fallbackNormalized;
  }
  return "unknown";
}

function normalizeStrength(value = "", fallback = "weak") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["none", "weak", "medium", "strong"].includes(normalized)) {
    return normalized;
  }
  const fallbackNormalized = String(fallback ?? "").trim().toLowerCase();
  if (["none", "weak", "medium", "strong"].includes(fallbackNormalized)) {
    return fallbackNormalized;
  }
  return "weak";
}

function normalizeFunctionalPhase(value = "", fallback = "authenticated") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["pre_auth", "authenticated", "final_logout"].includes(normalized)) {
    return normalized;
  }
  const fallbackNormalized = String(fallback ?? "").trim().toLowerCase();
  if (["pre_auth", "authenticated", "final_logout"].includes(fallbackNormalized)) {
    return fallbackNormalized;
  }
  return "authenticated";
}

function normalizePerField(perField = [], fallback = []) {
  const source = Array.isArray(perField) ? perField : fallback;
  const normalized = [];
  const seen = new Set();
  for (const field of source) {
    const key = String(field?.key ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      key,
      resolved: Boolean(field?.resolved),
      actionable: Boolean(field?.actionable),
      fillAttempted: Boolean(field?.fillAttempted),
      filled: Boolean(field?.filled),
      verified: Boolean(field?.verified),
      valuePresentAfterFill: Boolean(field?.valuePresentAfterFill),
      valueLengthAfterFill: numberOrFallback(field?.valueLengthAfterFill, 0)
    });
  }
  return normalized;
}

export function buildAuthFormMetadata({
  probe = null,
  currentForm = null,
  runtimeMeta = null
} = {}) {
  const safeCurrentForm = currentForm && typeof currentForm === "object" ? currentForm : {};
  const safeRuntime = runtimeMeta && typeof runtimeMeta === "object" ? runtimeMeta : {};
  const visibleStep = String(
    probe?.visibleStep ?? safeCurrentForm.visibleStep ?? inferAuthFormStep(probe ?? safeCurrentForm)
  ).trim() || "unknown";

  return {
    identifierFieldDetected: boolOrFallback(
      probe?.identifierFieldDetected ?? probe?.usernameFieldDetected,
      safeCurrentForm.identifierFieldDetected
    ),
    usernameFieldDetected: boolOrFallback(
      probe?.usernameFieldDetected ?? probe?.identifierFieldDetected,
      safeCurrentForm.usernameFieldDetected
    ),
    passwordFieldDetected: boolOrFallback(probe?.passwordFieldDetected, safeCurrentForm.passwordFieldDetected),
    otpFieldDetected: boolOrFallback(probe?.otpFieldDetected, safeCurrentForm.otpFieldDetected),
    submitControlDetected: boolOrFallback(probe?.submitControlDetected, safeCurrentForm.submitControlDetected),
    identifierFieldVisibleCount: numberOrFallback(
      probe?.identifierFieldVisibleCount ?? probe?.usernameFieldVisibleCount,
      safeCurrentForm.identifierFieldVisibleCount
    ),
    usernameFieldVisibleCount: numberOrFallback(
      probe?.usernameFieldVisibleCount ?? probe?.identifierFieldVisibleCount,
      safeCurrentForm.usernameFieldVisibleCount
    ),
    passwordFieldVisibleCount: numberOrFallback(
      probe?.passwordFieldVisibleCount,
      safeCurrentForm.passwordFieldVisibleCount
    ),
    otpFieldVisibleCount: numberOrFallback(probe?.otpFieldVisibleCount, safeCurrentForm.otpFieldVisibleCount),
    identifierLabelCandidates: normalizeLabelCandidates(
      probe?.identifierLabelCandidates,
      safeCurrentForm.identifierLabelCandidates
    ),
    identifierFilled: boolOrFallback(safeRuntime.identifierFilled, safeCurrentForm.identifierFilled),
    usernameFilled: boolOrFallback(safeRuntime.usernameFilled, safeCurrentForm.usernameFilled),
    passwordFilled: boolOrFallback(safeRuntime.passwordFilled, safeCurrentForm.passwordFilled),
    submitTriggered: boolOrFallback(safeRuntime.submitTriggered, safeCurrentForm.submitTriggered),
    submitControlType: String(safeRuntime.submitControlType ?? safeCurrentForm.submitControlType ?? "none"),
    postSubmitProbeState:
      safeRuntime.postSubmitProbeState ?? safeCurrentForm.postSubmitProbeState ?? null,
    postSubmitUrl:
      safeRuntime.postSubmitUrl ??
      safeCurrentForm.postSubmitUrl ??
      null,
    postSubmitUrlChanged: boolOrFallback(
      safeRuntime.postSubmitUrlChanged,
      safeCurrentForm.postSubmitUrlChanged
    ),
    inputFields: normalizeInputFields(
      probe?.inputFields,
      safeCurrentForm.inputFields
    ),
    submitAction: normalizeSubmitAction(
      probe?.submitAction,
      safeCurrentForm.submitAction
    ),
    visibleStep,
    nextRecommendedAction: probe?.nextRecommendedAction ?? safeCurrentForm.nextRecommendedAction ?? null
  };
}

export function buildSafeAuthRuntimeMetadata(runtimeMeta = null, currentRuntime = null) {
  const safeRuntime = runtimeMeta && typeof runtimeMeta === "object" ? runtimeMeta : {};
  const safeCurrentRuntime =
    currentRuntime && typeof currentRuntime === "object" ? currentRuntime : {};

  return {
    browserActionExecuted: boolOrFallback(
      safeRuntime.browserActionExecuted,
      safeCurrentRuntime.browserActionExecuted
    ),
    inputFieldsConsumed: boolOrFallback(
      safeRuntime.inputFieldsConsumed,
      safeCurrentRuntime.inputFieldsConsumed
    ),
    fillExecutionAttempted: boolOrFallback(
      safeRuntime.fillExecutionAttempted,
      safeCurrentRuntime.fillExecutionAttempted
    ),
    fillExecutionSucceeded: boolOrFallback(
      safeRuntime.fillExecutionSucceeded,
      safeCurrentRuntime.fillExecutionSucceeded
    ),
    fieldTargetsResolvedCount: numberOrFallback(
      safeRuntime.fieldTargetsResolvedCount,
      safeCurrentRuntime.fieldTargetsResolvedCount
    ),
    fieldTargetsFilledCount: numberOrFallback(
      safeRuntime.fieldTargetsFilledCount,
      safeCurrentRuntime.fieldTargetsFilledCount
    ),
    fieldTargetsVerifiedCount: numberOrFallback(
      safeRuntime.fieldTargetsVerifiedCount,
      safeCurrentRuntime.fieldTargetsVerifiedCount
    ),
    focusedFieldKeys: normalizeKeyList(
      safeRuntime.focusedFieldKeys,
      safeCurrentRuntime.focusedFieldKeys
    ),
    identifierFilled: boolOrFallback(safeRuntime.identifierFilled, safeCurrentRuntime.identifierFilled),
    usernameFilled: boolOrFallback(safeRuntime.usernameFilled, safeCurrentRuntime.usernameFilled),
    passwordFilled: boolOrFallback(safeRuntime.passwordFilled, safeCurrentRuntime.passwordFilled),
    submitTriggered: boolOrFallback(safeRuntime.submitTriggered, safeCurrentRuntime.submitTriggered),
    submitControlResolved: boolOrFallback(
      safeRuntime.submitControlResolved,
      safeCurrentRuntime.submitControlResolved
    ),
    submitControlType: String(safeRuntime.submitControlType ?? safeCurrentRuntime.submitControlType ?? "none"),
    submitControlDetected: boolOrFallback(
      safeRuntime.submitControlDetected,
      safeCurrentRuntime.submitControlDetected
    ),
    targetedPageUrl: safeRuntime.targetedPageUrl ?? safeCurrentRuntime.targetedPageUrl ?? null,
    targetedFrameUrl: safeRuntime.targetedFrameUrl ?? safeCurrentRuntime.targetedFrameUrl ?? null,
    targetedFrameType: normalizeFrameType(
      safeRuntime.targetedFrameType,
      safeCurrentRuntime.targetedFrameType
    ),
    perField: normalizePerField(safeRuntime.perField, safeCurrentRuntime.perField),
    viewerFrameCapturedAfterFill: boolOrFallback(
      safeRuntime.viewerFrameCapturedAfterFill,
      safeCurrentRuntime.viewerFrameCapturedAfterFill
    ),
    viewerFrameCapturedAfterSubmit: boolOrFallback(
      safeRuntime.viewerFrameCapturedAfterSubmit,
      safeCurrentRuntime.viewerFrameCapturedAfterSubmit
    ),
    resumeLoopAwakened: boolOrFallback(
      safeRuntime.resumeLoopAwakened,
      safeCurrentRuntime.resumeLoopAwakened
    ),
    resumeLoopConsumedFields: boolOrFallback(
      safeRuntime.resumeLoopConsumedFields,
      safeCurrentRuntime.resumeLoopConsumedFields
    ),
    postSubmitProbeState: safeRuntime.postSubmitProbeState ?? safeCurrentRuntime.postSubmitProbeState ?? null,
    postSubmitUrl: safeRuntime.postSubmitUrl ?? safeCurrentRuntime.postSubmitUrl ?? null,
    postSubmitUrlChanged: boolOrFallback(
      safeRuntime.postSubmitUrlChanged,
      safeCurrentRuntime.postSubmitUrlChanged
    ),
    authClassificationReason:
      String(
        safeRuntime.authClassificationReason ??
          safeCurrentRuntime.authClassificationReason ??
          ""
      ).trim() || null,
    loginWallStrength: normalizeStrength(
      safeRuntime.loginWallStrength,
      safeCurrentRuntime.loginWallStrength ?? "none"
    ),
    authenticatedSignalStrength: normalizeStrength(
      safeRuntime.authenticatedSignalStrength,
      safeCurrentRuntime.authenticatedSignalStrength ?? "weak"
    ),
    currentFunctionalPhase: normalizeFunctionalPhase(
      safeRuntime.currentFunctionalPhase,
      safeCurrentRuntime.currentFunctionalPhase ?? "authenticated"
    ),
    authenticatedConfirmedAt:
      safeRuntime.authenticatedConfirmedAt ?? safeCurrentRuntime.authenticatedConfirmedAt ?? null,
    resumedFromAuth: boolOrFallback(
      safeRuntime.resumedFromAuth,
      safeCurrentRuntime.resumedFromAuth
    ),
    logoutScheduled: boolOrFallback(
      safeRuntime.logoutScheduled,
      safeCurrentRuntime.logoutScheduled
    ),
    logoutExecuted: boolOrFallback(
      safeRuntime.logoutExecuted,
      safeCurrentRuntime.logoutExecuted
    ),
    whyAuthRegressed:
      String(safeRuntime.whyAuthRegressed ?? safeCurrentRuntime.whyAuthRegressed ?? "").trim() || null,
    whyLogoutBlocked:
      String(safeRuntime.whyLogoutBlocked ?? safeCurrentRuntime.whyLogoutBlocked ?? "").trim() || null
  };
}
