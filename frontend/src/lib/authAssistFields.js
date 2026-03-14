function normalizeStep(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || "unknown";
}

function normalizeInputFields(inputFields = []) {
  const source = Array.isArray(inputFields) ? inputFields : [];
  const deduped = [];
  const seen = new Set();

  for (const field of source) {
    const key = String(field?.key ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const label = String(field?.label ?? "").trim() || key;
    deduped.push({
      key,
      label,
      placeholder: String(field?.placeholder ?? "").trim() || label,
      kind: String(field?.kind ?? "text").trim().toLowerCase() || "text",
      secret: Boolean(field?.secret),
      required: Boolean(field?.required),
      position: Number.isFinite(Number(field?.position)) ? Number(field.position) : deduped.length + 1
    });
  }

  deduped.sort((left, right) => left.position - right.position);
  return deduped;
}

export function buildAuthInputFieldsPayload({ renderFields = [], values = {} } = {}) {
  const fields = Array.isArray(renderFields) ? renderFields : [];
  const sourceValues = values && typeof values === "object" ? values : {};
  const inputFields = {};

  for (const field of fields) {
    const key = String(field?.key ?? "").trim().toLowerCase();
    if (!key) {
      continue;
    }
    const value = String(sourceValues[key] ?? "");
    if (!value.trim() && !field?.required) {
      continue;
    }
    inputFields[key] = value;
  }

  return { inputFields };
}

function firstIdentifierLabel(authAssist = {}, fields = []) {
  const fromFields = fields.find((field) => !field.secret && field.kind !== "otp")?.label;
  if (fromFields) {
    return fromFields;
  }
  const candidates = authAssist?.form?.identifierLabelCandidates;
  if (!Array.isArray(candidates)) {
    return "";
  }
  return String(candidates.find((entry) => String(entry ?? "").trim()) ?? "").trim();
}

export function deriveAuthAssistFieldVisibility(authAssist = {}) {
  const state = normalizeStep(authAssist?.state);
  const form = authAssist?.form && typeof authAssist.form === "object" ? authAssist.form : {};
  const visibleStep = normalizeStep(form.visibleStep);
  const normalizedFields = normalizeInputFields(form.inputFields);

  const otpPending =
    state === "awaiting_otp" ||
    state === "submitting_otp" ||
    state === "awaiting_input_fields" && visibleStep === "otp" ||
    form.otpFieldDetected === true;

  const credentialLikeState = new Set([
    "awaiting_credentials",
    "awaiting_input_fields",
    "awaiting_username",
    "awaiting_password",
    "auth_step_advanced",
    "auth_unknown_state",
    "submitting_credentials",
    "submitting_input_fields",
    "auth_failed"
  ]).has(state);

  const credentialsPending = !otpPending && (credentialLikeState || authAssist?.loginRequired === true);

  let renderFields = [];
  if (otpPending) {
    const otpFields = normalizedFields.filter((field) => field.kind === "otp");
    renderFields = otpFields;
  } else if (credentialsPending) {
    const nonOtp = normalizedFields.filter((field) => field.kind !== "otp");
    renderFields = nonOtp;
  }

  const identifierLabel = firstIdentifierLabel(authAssist, renderFields);
  const identifierPlaceholder = identifierLabel || "Username, email, or access key";
  const showIdentifierField = renderFields.some((field) => !field.secret && field.kind !== "otp");
  const showPasswordField = renderFields.some((field) => field.kind === "password");

  const submitActionLabel = String(authAssist?.form?.submitAction?.label ?? "").trim();
  const primaryActionLabel = submitActionLabel || (otpPending ? "Submit OTP" : "Submit Input Fields");

  return {
    otpPending,
    credentialsPending,
    showIdentifierField,
    showPasswordField,
    identifierLabel,
    identifierPlaceholder,
    renderFields,
    primaryActionLabel
  };
}
