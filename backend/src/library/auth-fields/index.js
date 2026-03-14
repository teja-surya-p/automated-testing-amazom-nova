export {
  asNumber,
  normalizeLower,
  normalizeText
} from "./normalization.js";
export {
  AUTH_CONTROL_QUERY_SELECTOR,
  AUTH_FIELD_QUERY_SELECTOR,
  AUTH_SUBMIT_CONTROL_PATTERN,
  FIRST_CREDENTIAL_KEYS,
  IDENTIFIER_FIELD_PATTERN,
  NEXT_CONTROL_PATTERN_SOURCE,
  NEXT_CONTROL_RE,
  OTP_HINT_PATTERN_SOURCE,
  OTP_HINT_RE,
  OTP_SELECTOR,
  PASSWORD_FIELD_PATTERN,
  PASSWORD_HINT_PATTERN_SOURCE,
  PASSWORD_HINT_RE,
  PASSWORD_SELECTOR,
  SEARCH_HINT_PATTERN_SOURCE,
  SEARCH_HINT_RE,
  SUBMIT_CONTROL_PATTERN_SOURCE,
  SUBMIT_CONTROL_RE,
  SUBMIT_SELECTOR,
  USERNAME_HINT_PATTERN_SOURCE,
  USERNAME_HINT_RE,
  USERNAME_SELECTOR
} from "./patterns.js";
export { resolveFirstCredentialAlias } from "./credentialAlias.js";
export { isControlActionable, isFieldActionable } from "./actionability.js";
export {
  buildFieldHaystack,
  chooseBestField,
  classifyAuthField,
  scoreAuthField,
  sortByVisualOrder
} from "./fieldClassification.js";
export { inferAuthFormStep } from "./authFormStep.js";
export {
  buildCredentialActionPlan,
  chooseSubmitControl,
  scoreSubmitControl
} from "./authActionPlan.js";
export {
  detectVisibleCredentialFormSignals,
  hasVisibleCredentialForm,
  toProbeCredentialSignals
} from "./authFormSignals.js";
export {
  buildAuthFormMetadata,
  buildSafeAuthRuntimeMetadata
} from "./authRuntimeMetadata.js";
export {
  deriveAuthInputFieldsFromContext,
  deriveAuthSubmitActionFromControls,
  normalizeSubmittedInputFieldValues
} from "./inputFieldsCatalog.js";
