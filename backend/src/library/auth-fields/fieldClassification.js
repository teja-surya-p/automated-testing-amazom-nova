import { isFieldActionable } from "./actionability.js";
import { asNumber, normalizeLower } from "./normalization.js";
import {
  OTP_HINT_RE,
  PASSWORD_HINT_RE,
  SEARCH_HINT_RE,
  USERNAME_HINT_RE
} from "./patterns.js";

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

export function scoreAuthField(field = {}, targetKind = "username") {
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
  const usernameScore = scoreAuthField(field, "username");
  const passwordScore = scoreAuthField(field, "password");
  const otpScore = scoreAuthField(field, "otp");
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

export function sortByVisualOrder(items = []) {
  return [...items].sort((left, right) => {
    const topDelta = asNumber(left?.top, 0) - asNumber(right?.top, 0);
    if (Math.abs(topDelta) >= 2) {
      return topDelta;
    }
    return asNumber(left?.left, 0) - asNumber(right?.left, 0);
  });
}

export function chooseBestField(fields = [], targetKind = "username") {
  const scored = fields
    .map((field) => ({
      field,
      score: scoreAuthField(field, targetKind)
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
