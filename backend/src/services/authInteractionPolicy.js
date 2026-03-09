function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLower(value = "") {
  return normalizeText(value).toLowerCase();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const USERNAME_HINT_RE =
  /\b(email|e-mail|username|user name|user|login|identifier|account|phone|mobile|access key|account id|employee id|user id|member id|workspace id|tenant id|organization id|organisation id|customer id|login id|sign[-\s]?in id|handle|short code|portal key|staff id|staff portal key)\b/;
const PASSWORD_HINT_RE = /\b(password|passcode|pass phrase|secret)\b/;
const OTP_HINT_RE =
  /\b(otp|verification|verify|code|2fa|two[-\s]?factor|one[-\s]?time|security code)\b/;
const SEARCH_HINT_RE = /\b(search|query|find)\b/;

const NEXT_CONTROL_RE = /\b(next|continue|proceed|continue with|use account|go on)\b/;
const SUBMIT_CONTROL_RE = /\b(sign in|log in|login|submit|verify|confirm|allow|continue)\b/;

export function isFieldActionable(field = {}) {
  return (
    Boolean(field?.actionable) &&
    Boolean(field?.visible) &&
    Boolean(field?.enabled) &&
    !Boolean(field?.readOnly)
  );
}

export function isControlActionable(control = {}) {
  return Boolean(control?.actionable) && Boolean(control?.visible) && Boolean(control?.enabled);
}

export function buildFieldHaystack(field = {}) {
  return normalizeLower(
    [
      field?.label,
      field?.ariaLabel,
      field?.placeholder,
      field?.name,
      field?.id,
      field?.autocomplete,
      field?.inputType
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function scoreField(field = {}, targetKind = "username") {
  if (!isFieldActionable(field)) {
    return Number.NEGATIVE_INFINITY;
  }

  const haystack = buildFieldHaystack(field);
  const inputType = normalizeLower(field?.inputType);
  const autocomplete = normalizeLower(field?.autocomplete);
  const scoreBase = (field?.inViewport ? 20 : 0) + Math.max(0, 30 - asNumber(field?.top, 0) / 40);
  let score = scoreBase;

  if (targetKind === "username") {
    if (USERNAME_HINT_RE.test(haystack)) {
      score += 120;
    }
    if (field?.sameFormHasPassword) {
      score += 55;
    }
    if (field?.sameFormHasSubmitControl) {
      score += 35;
    }
    if (inputType === "email") {
      score += 50;
    }
    if (autocomplete.includes("username") || autocomplete.includes("email")) {
      score += 40;
    }
    if (PASSWORD_HINT_RE.test(haystack) || inputType === "password") {
      score -= 200;
    }
    if (OTP_HINT_RE.test(haystack)) {
      score -= 120;
    }
    if (SEARCH_HINT_RE.test(haystack) && !field?.sameFormHasPassword) {
      score -= 90;
    }
    if (!haystack && ["text", "email", "tel", "search", ""].includes(inputType)) {
      score += 10;
    }
    if (
      ["text", "tel", "number", "search", ""].includes(inputType) &&
      field?.sameFormHasPassword &&
      !SEARCH_HINT_RE.test(haystack)
    ) {
      score += 30;
    }
  }

  if (targetKind === "password") {
    if (PASSWORD_HINT_RE.test(haystack)) {
      score += 140;
    }
    if (inputType === "password") {
      score += 140;
    }
    if (autocomplete.includes("current-password") || autocomplete.includes("password")) {
      score += 60;
    }
    if (OTP_HINT_RE.test(haystack)) {
      score -= 180;
    }
    if (USERNAME_HINT_RE.test(haystack) || inputType === "email") {
      score -= 180;
    }
  }

  if (targetKind === "otp") {
    if (OTP_HINT_RE.test(haystack)) {
      score += 140;
    }
    if (autocomplete.includes("one-time-code")) {
      score += 120;
    }
    if (PASSWORD_HINT_RE.test(haystack) || inputType === "password") {
      score -= 200;
    }
  }

  return score;
}

export function classifyAuthField(field = {}) {
  const usernameScore = scoreField(field, "username");
  const passwordScore = scoreField(field, "password");
  const otpScore = scoreField(field, "otp");
  const scores = [
    { kind: "username", score: usernameScore },
    { kind: "password", score: passwordScore },
    { kind: "otp", score: otpScore }
  ].sort((left, right) => right.score - left.score);

  const top = scores[0];
  if (!Number.isFinite(top.score) || top.score < 40) {
    return {
      kind: "unknown",
      confidence: 0,
      scores: {
        username: usernameScore,
        password: passwordScore,
        otp: otpScore
      }
    };
  }

  const runnerUp = scores[1];
  const delta = Math.max(0, top.score - runnerUp.score);
  return {
    kind: top.kind,
    confidence: Math.min(1, 0.45 + delta / 220),
    scores: {
      username: usernameScore,
      password: passwordScore,
      otp: otpScore
    }
  };
}

function sortByVisualOrder(items = []) {
  return [...items].sort((left, right) => {
    const topDelta = asNumber(left?.top, 0) - asNumber(right?.top, 0);
    if (Math.abs(topDelta) >= 2) {
      return topDelta;
    }
    return asNumber(left?.left, 0) - asNumber(right?.left, 0);
  });
}

function chooseBestField(fields = [], targetKind = "username") {
  const scored = fields
    .map((field) => ({
      field,
      score: scoreField(field, targetKind)
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const topDelta = asNumber(left.field?.top, 0) - asNumber(right.field?.top, 0);
      if (Math.abs(topDelta) >= 2) {
        return topDelta;
      }
      return asNumber(left.field?.left, 0) - asNumber(right.field?.left, 0);
    });

  const best = scored[0];
  if (!best || best.score < 40) {
    return null;
  }
  return best.field;
}

function scoreSubmitControl(control = {}, context = {}) {
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
    score += 30;
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

function chooseSubmitControl(controls = [], context = {}) {
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

export function buildCredentialActionPlan(
  context = {},
  options = {}
) {
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
