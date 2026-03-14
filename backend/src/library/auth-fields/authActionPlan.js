import { isControlActionable, isFieldActionable } from "./actionability.js";
import { asNumber, normalizeLower, normalizeText } from "./normalization.js";
import { chooseBestField, classifyAuthField, sortByVisualOrder } from "./fieldClassification.js";
import { NEXT_CONTROL_RE, SUBMIT_CONTROL_RE } from "./patterns.js";

export function scoreSubmitControl(control = {}, context = {}) {
  if (!isControlActionable(control)) {
    return Number.NEGATIVE_INFINITY;
  }

  const stepHint = normalizeLower(context?.stepHint || "unknown");
  const intent = normalizeLower(context?.intent || "");
  const label = normalizeLower(control?.label);
  const type = normalizeLower(control?.type);
  const role = normalizeLower(control?.role);
  const tag = normalizeLower(control?.tag);
  const activeFormSelector = normalizeText(context?.activeFormSelector);

  let score = 0;
  if (control?.inViewport) {
    score += 20;
  }
  if (control?.isSubmitLike || type === "submit") {
    score += 12;
  }
  if (role === "button" || tag === "button") {
    score += 10;
  }
  if (activeFormSelector && normalizeText(control?.formSelector) === activeFormSelector) {
    // Strongly prefer controls bound to the same form as detected auth fields.
    score += 140;
  } else if (activeFormSelector) {
    // De-prioritize controls outside the active auth form to avoid no-op decoy clicks.
    score -= 40;
  }

  const nextMatch = NEXT_CONTROL_RE.test(label);
  const submitMatch = SUBMIT_CONTROL_RE.test(label);

  if (stepHint === "username" || intent === "advance-username") {
    if (nextMatch) {
      score += 120;
    } else if (submitMatch) {
      score += 60;
    }
  } else if (stepHint === "password" || intent === "submit-password") {
    if (/\b(sign in|log in|login|submit|verify|confirm|allow)\b/.test(label)) {
      score += 120;
    } else if (submitMatch) {
      score += 90;
    } else if (nextMatch) {
      score += 45;
    }
  } else if (submitMatch) {
    score += 95;
  } else if (nextMatch) {
    score += 80;
  }

  if (context?.forceSubmitControl && (submitMatch || nextMatch || control?.isSubmitLike)) {
    score += 25;
  }

  if (!label && (type === "submit" || control?.isSubmitLike)) {
    score += 15;
  }

  score += Math.max(0, 30 - asNumber(control?.top, 0) / 50);
  return score;
}

export function chooseSubmitControl(controls = [], context = {}) {
  const sorted = controls
    .map((control) => ({
      control,
      score: scoreSubmitControl(control, context)
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const topDelta = asNumber(left.control?.top, 0) - asNumber(right.control?.top, 0);
      if (Math.abs(topDelta) >= 2) {
        return topDelta;
      }
      return asNumber(left.control?.left, 0) - asNumber(right.control?.left, 0);
    });

  return sorted[0]?.control ?? null;
}

function normalizeStepHint(stepHint = "") {
  const normalized = normalizeLower(stepHint || "");
  if (["username", "password", "credentials", "otp", "authenticated"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}

export function buildCredentialActionPlan(context = {}, options = {}) {
  const fields = sortByVisualOrder(Array.isArray(context?.fields) ? context.fields : []);
  const controls = sortByVisualOrder(Array.isArray(context?.controls) ? context.controls : []);
  const stepHint = normalizeStepHint(options?.stepHint || context?.stepHint || "unknown");
  const allowUsername = options?.allowUsername !== false;
  const allowPassword = options?.allowPassword !== false;

  const actionableFields = fields.filter((field) => isFieldActionable(field));
  const usernameField = chooseBestField(actionableFields, "username");
  const passwordField = chooseBestField(actionableFields, "password");
  const otpField = chooseBestField(actionableFields, "otp");
  const identifierSignal =
    Boolean(context?.identifierFieldDetected) ||
    Boolean(context?.usernameFieldDetected) ||
    Number(context?.identifierFieldVisibleCount ?? 0) > 0 ||
    Number(context?.usernameFieldVisibleCount ?? 0) > 0;
  const passwordSignal =
    Boolean(context?.passwordFieldDetected) ||
    Number(context?.passwordFieldVisibleCount ?? 0) > 0;

  let fillUsername = false;
  let fillPassword = false;

  const sameFormCredentialsVisible =
    Boolean(usernameField?.formSelector) &&
    Boolean(passwordField?.formSelector) &&
    usernameField.formSelector === passwordField.formSelector;

  if (stepHint === "username") {
    fillUsername = Boolean(usernameField) && allowUsername;
  } else if (stepHint === "password") {
    if (sameFormCredentialsVisible) {
      fillUsername = Boolean(usernameField) && allowUsername;
      fillPassword = Boolean(passwordField) && allowPassword;
    } else {
      fillPassword = Boolean(passwordField) && allowPassword;
    }
    if (!fillUsername && allowUsername && identifierSignal && passwordSignal) {
      fillUsername = true;
    }
  } else if (stepHint === "credentials") {
    fillUsername = Boolean(usernameField) && allowUsername;
    fillPassword = Boolean(passwordField) && allowPassword;
    if (!fillUsername && allowUsername && identifierSignal) {
      fillUsername = true;
    }
    if (!fillPassword && allowPassword && passwordSignal) {
      fillPassword = true;
    }
  } else {
    if (usernameField && passwordField) {
      fillUsername = allowUsername;
      fillPassword = allowPassword;
    } else if (passwordField && !usernameField) {
      fillPassword = allowPassword;
    } else if (usernameField && !passwordField) {
      fillUsername = allowUsername;
    }
    if (!fillUsername && allowUsername && identifierSignal && (stepHint === "unknown" || !passwordField)) {
      fillUsername = true;
    }
    if (!fillPassword && allowPassword && passwordSignal && (stepHint === "unknown" || !usernameField)) {
      fillPassword = true;
    }
  }

  const intent =
    fillPassword && !fillUsername
      ? "submit-password"
      : fillUsername && !fillPassword
        ? "advance-username"
        : "submit-credentials";

  const activeFormSelector = fillPassword
    ? normalizeText(passwordField?.formSelector)
    : normalizeText(usernameField?.formSelector);
  const submitControl = chooseSubmitControl(controls, {
    stepHint,
    intent,
    activeFormSelector,
    forceSubmitControl: options?.forceSubmitControl === true
  });

  return {
    stepHint,
    fillUsername,
    fillPassword,
    usernameFieldSelector: usernameField?.primarySelector ?? null,
    usernameFallbackSelector: usernameField?.fallbackSelector ?? null,
    passwordFieldSelector: passwordField?.primarySelector ?? null,
    passwordFallbackSelector: passwordField?.fallbackSelector ?? null,
    submitControlSelector: submitControl?.primarySelector ?? null,
    submitControlFallbackSelector: submitControl?.fallbackSelector ?? null,
    submitControlLabel: normalizeText(submitControl?.label || "") || null,
    intent,
    hasOtpField: Boolean(otpField),
    usernameCandidateCount: actionableFields.filter((field) => classifyAuthField(field).kind === "username").length,
    passwordCandidateCount: actionableFields.filter((field) => classifyAuthField(field).kind === "password").length,
    controlCandidateCount: controls.filter((control) => isControlActionable(control)).length
  };
}
