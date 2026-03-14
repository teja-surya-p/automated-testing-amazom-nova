import { sortByVisualOrder } from "./fieldClassification.js";
import { normalizeLower, normalizeText } from "./normalization.js";
import { OTP_HINT_RE, PASSWORD_HINT_RE, SEARCH_HINT_RE } from "./patterns.js";

function slugify(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function inputType(field = {}) {
  return normalizeLower(field?.inputType || field?.type || "");
}

function fieldHaystack(field = {}) {
  return normalizeLower(
    [
      field?.label,
      field?.ariaLabel,
      field?.placeholder,
      field?.name,
      field?.id,
      field?.autocomplete,
      inputType(field)
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isTextLikeInputType(type = "") {
  return [
    "",
    "text",
    "email",
    "tel",
    "number",
    "search",
    "url",
    "date",
    "datetime-local",
    "month",
    "week",
    "time",
    "textarea"
  ].includes(type);
}

function deriveKind(field = {}) {
  const type = inputType(field);
  const autocomplete = normalizeLower(field?.autocomplete);
  const haystack = fieldHaystack(field);

  if (type === "password" || PASSWORD_HINT_RE.test(haystack) || autocomplete.includes("password")) {
    return "password";
  }
  if (OTP_HINT_RE.test(haystack) || autocomplete.includes("one-time-code")) {
    return "otp";
  }
  if (type === "email" || autocomplete.includes("email") || /\bemail\b/.test(haystack)) {
    return "email";
  }
  if (type === "tel" || /\bphone\b|\bmobile\b/.test(haystack)) {
    return "phone";
  }
  if (type === "date" || type === "datetime-local" || type === "month" || type === "week" || type === "time") {
    return "date";
  }
  if (type === "number") {
    return "number";
  }
  if (type === "search" || SEARCH_HINT_RE.test(haystack)) {
    return "search";
  }
  return "text";
}

function deriveLabel(field = {}, index = 0) {
  return (
    normalizeText(
      field?.label ||
        field?.ariaLabel ||
        field?.placeholder ||
        field?.name ||
        field?.id
    ) || `Field ${index + 1}`
  );
}

function derivePlaceholder(field = {}, label = "") {
  return normalizeText(field?.placeholder) || label;
}

function baseKeyForField(field = {}, kind = "text", index = 0) {
  if (kind === "password") {
    return "password";
  }
  if (kind === "otp") {
    return "otp";
  }

  const candidates = [
    field?.name,
    field?.id,
    field?.label,
    field?.ariaLabel,
    field?.placeholder
  ];
  for (const candidate of candidates) {
    const key = slugify(candidate);
    if (key && key !== "input" && key !== "field") {
      return key;
    }
  }

  return `input_field_${index + 1}`;
}

function isLikelyAuthField(field = {}) {
  if (!field || field.actionable !== true) {
    return false;
  }

  const type = inputType(field);
  if (!isTextLikeInputType(type) && type !== "password") {
    return false;
  }

  const haystack = fieldHaystack(field);
  if (SEARCH_HINT_RE.test(haystack) && !field?.sameFormHasPassword) {
    return false;
  }

  if (
    type === "password" ||
    OTP_HINT_RE.test(haystack) ||
    PASSWORD_HINT_RE.test(haystack) ||
    Boolean(field?.sameFormHasPassword) ||
    Boolean(field?.sameFormHasSubmitControl)
  ) {
    return true;
  }

  if (
    /\b(email|e-mail|username|user name|user id|login|sign in|identifier|account|access key|organization|organisation|tenant|workspace|customer)\b/.test(
      haystack
    )
  ) {
    return true;
  }

  return false;
}

function normalizeUniqueKey(baseKey = "", used = new Set()) {
  let candidate = baseKey || "input_field";
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${baseKey}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function deriveAuthInputFieldsFromContext(fields = [], { includeSelectors = false } = {}) {
  const source = Array.isArray(fields) ? fields : [];
  const ordered = sortByVisualOrder(source).filter((field) => isLikelyAuthField(field));
  const usedKeys = new Set();

  return ordered.map((field, index) => {
    const kind = deriveKind(field);
    const label = deriveLabel(field, index);
    const placeholder = derivePlaceholder(field, label);
    const baseKey = baseKeyForField(field, kind, index);
    const key = normalizeUniqueKey(baseKey, usedKeys);
    const item = {
      key,
      label,
      placeholder,
      kind,
      secret: kind === "password" || kind === "otp",
      required: Boolean(field?.required),
      position: index + 1
    };
    if (includeSelectors) {
      item.primarySelector = normalizeText(field?.primarySelector) || null;
      item.fallbackSelector = normalizeText(field?.fallbackSelector) || null;
      item.formSelector = normalizeText(field?.formSelector) || null;
    }
    return item;
  });
}

export function deriveAuthSubmitActionFromControls(
  controls = [],
  { activeFormSelector = "" } = {}
) {
  const list = Array.isArray(controls) ? controls : [];
  const ordered = sortByVisualOrder(list).filter((control) => control?.actionable === true);
  const normalizedActiveForm = normalizeText(activeFormSelector);

  const scored = ordered.map((control) => {
    const label = normalizeText(control?.label);
    const type = normalizeLower(control?.type);
    const controlFormSelector = normalizeText(control?.formSelector);
    let score = 0;
    if (control?.isSubmitLike || type === "submit") {
      score += 80;
    }
    if (normalizedActiveForm && controlFormSelector === normalizedActiveForm) {
      score += 140;
    } else if (normalizedActiveForm && controlFormSelector) {
      score -= 35;
    }
    if (/\b(sign in|log in|login|submit|verify|continue|next|confirm|allow)\b/i.test(label)) {
      score += 50;
    }
    if (label) {
      score += 10;
    }
    return {
      control,
      label,
      score
    };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return Number(left.control?.top ?? 0) - Number(right.control?.top ?? 0);
  });

  const selected = scored[0]?.control;
  if (!selected) {
    return null;
  }

  return {
    label: normalizeText(selected?.label) || "Submit",
    type: normalizeLower(selected?.type) || "control"
  };
}

export function normalizeSubmittedInputFieldValues(raw = null) {
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : {};
  const result = {};

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = slugify(key);
    if (!normalizedKey) {
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    result[normalizedKey] = String(value);
  }

  return result;
}
