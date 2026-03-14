import {
  AUTH_SUBMIT_CONTROL_PATTERN,
  IDENTIFIER_FIELD_PATTERN,
  PASSWORD_FIELD_PATTERN
} from "./patterns.js";
import { normalizeText } from "./normalization.js";

function normalizeSignalText(value = "") {
  return normalizeText(value).toLowerCase();
}

function controlText(control = {}) {
  return normalizeSignalText(
    [
      control.labelText,
      control.placeholder,
      control.ariaLabel,
      control.name,
      control.type,
      control.tag
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function interactiveText(entry = {}) {
  return normalizeSignalText(
    [entry.text, entry.ariaLabel, entry.placeholder, entry.name, entry.id, entry.href]
      .filter(Boolean)
      .join(" ")
  );
}

export function detectVisibleCredentialFormSignals(
  snapshot = {},
  { allowTextLikeFieldFallback = true } = {}
) {
  const formControls = Array.isArray(snapshot.formControls) ? snapshot.formControls : [];
  const interactive = Array.isArray(snapshot.interactive) ? snapshot.interactive : [];

  const visibleControls = formControls.filter((control) => control?.inViewport !== false);
  const visibleInteractive = interactive.filter((entry) => entry?.inViewport && !entry?.disabled);

  const passwordFieldDetected = visibleControls.some((control) => PASSWORD_FIELD_PATTERN.test(controlText(control)));
  const identifierFieldDetected = visibleControls.some((control) => IDENTIFIER_FIELD_PATTERN.test(controlText(control)));
  const textLikeFieldDetected = visibleControls.some((control) => {
    const type = normalizeSignalText(control.type);
    const tag = normalizeSignalText(control.tag);
    return ["input", "textarea"].includes(tag) && ["", "text", "email", "search"].includes(type);
  });
  const submitControlDetected = visibleInteractive.some((entry) => AUTH_SUBMIT_CONTROL_PATTERN.test(interactiveText(entry)));

  const hasCredentialForm = Boolean(
    passwordFieldDetected &&
      submitControlDetected &&
      (identifierFieldDetected || (allowTextLikeFieldFallback && textLikeFieldDetected))
  );

  return {
    hasCredentialForm,
    passwordFieldDetected,
    identifierFieldDetected,
    textLikeFieldDetected,
    submitControlDetected
  };
}

export function hasVisibleCredentialForm(snapshot = {}, options = {}) {
  return detectVisibleCredentialFormSignals(snapshot, options).hasCredentialForm;
}

export function toProbeCredentialSignals(probe = {}) {
  return {
    hasCredentialForm: Boolean(
      (probe?.identifierFieldDetected || probe?.usernameFieldDetected) &&
        probe?.passwordFieldDetected &&
        probe?.submitControlDetected
    ),
    identifierFieldDetected: Boolean(probe?.identifierFieldDetected || probe?.usernameFieldDetected),
    passwordFieldDetected: Boolean(probe?.passwordFieldDetected),
    otpFieldDetected: Boolean(probe?.otpFieldDetected),
    submitControlDetected: Boolean(probe?.submitControlDetected)
  };
}
