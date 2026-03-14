import { FUNCTIONAL_CHECK_IDS } from "../../../../shared/functionalChecklistCatalog.js";

const RULE_ID_SET = new Set([
  "NAVIGATION_NOT_ERROR_PAGE",
  "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
  "SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE",
  "PAGINATION_CHANGES_CONTENT_OR_PAGE_INDEX",
  "FILTER_CHANGES_RESULTS_OR_NO_RESULTS",
  "CLEAR_FILTER_RESTORES_BASELINE",
  "NO_CONSOLE_ERRORS",
  "NO_5XX_SPIKE",
  "NO_STUCK_LOADING",
  "SAFE_REDIRECT_ALLOWED",
  "NAVIGATION_URL_CHANGED",
  "DOWNLOAD_EXISTS_AFTER_ACTION",
  "NEW_TAB_NAVIGATION_VALID",
  "UPLOAD_ACCEPTED",
  "SPA_READY_AFTER_NAV",
  "NO_API_5XX",
  "GRAPHQL_ERRORS_DETECTED",
  "CONSISTENT_CONTENT_TYPE",
  "EXCESSIVE_THIRD_PARTY_FAILURES"
]);

const FLOW_TYPE_SET = new Set([
  "HOME_NAV_SMOKE",
  "SEARCH_SMOKE",
  "FILTER_SMOKE",
  "PAGINATION_SMOKE",
  "DETAIL_PAGE_SMOKE"
]);

const COMMON_NAV_RULES = Object.freeze([
  "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
  "NAVIGATION_URL_CHANGED",
  "SPA_READY_AFTER_NAV",
  "SAFE_REDIRECT_ALLOWED"
]);

const COMMON_EXTERNAL_RULES = Object.freeze([
  "NEW_TAB_NAVIGATION_VALID",
  "NAVIGATION_NOT_ERROR_PAGE",
  "SAFE_REDIRECT_ALLOWED"
]);

const CHECK_TO_RULE_IDS = Object.freeze({
  PAGE_OPENS_SUCCESSFULLY: ["NAVIGATION_NOT_ERROR_PAGE", "CONSISTENT_CONTENT_TYPE", "SPA_READY_AFTER_NAV"],
  NORMAL_FLOW_VERIFIED: [...COMMON_NAV_RULES],
  INVALID_FLOW_VERIFIED: ["NAVIGATION_NOT_ERROR_PAGE", "NO_5XX_SPIKE", "NO_API_5XX", "GRAPHQL_ERRORS_DETECTED"],
  DATA_STATE_CHANGE_CONFIRMED: [
    "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
    "PAGINATION_CHANGES_CONTENT_OR_PAGE_INDEX",
    "FILTER_CHANGES_RESULTS_OR_NO_RESULTS",
    "CLEAR_FILTER_RESTORES_BASELINE"
  ],
  ERROR_HANDLING_VISIBLE: ["SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE", "NAVIGATION_NOT_ERROR_PAGE", "NO_STUCK_LOADING"],
  NAVIGATION_AND_RECOVERY_VERIFIED: [...COMMON_NAV_RULES],
  INPUT_SEARCH_BEHAVIOR: ["SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE"],
  INPUT_REQUIRED_FIELD_VALIDATION: ["SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE"],
  INPUT_FORMAT_VALIDATION: ["SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE"],
  BUTTON_CLICK_ACTION_CORRECT: ["NAVIGATION_STATE_CHANGE_OR_NOOP_REASON", "SPA_READY_AFTER_NAV"],
  LINK_DESTINATION_CORRECT: ["NAVIGATION_URL_CHANGED", "NAVIGATION_NOT_ERROR_PAGE", "SAFE_REDIRECT_ALLOWED"],
  BROKEN_LINK_DETECTION_FUNCTIONAL: ["NAVIGATION_NOT_ERROR_PAGE"],
  UNAUTHORIZED_REDIRECT_CHECK: ["SAFE_REDIRECT_ALLOWED", "NAVIGATION_NOT_ERROR_PAGE"],
  FORM_VALID_SUBMIT: ["SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE", "SPA_READY_AFTER_NAV"],
  FORM_INVALID_SUBMIT: ["SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE", "NO_STUCK_LOADING"],
  FORM_SUCCESS_MESSAGE: ["NAVIGATION_STATE_CHANGE_OR_NOOP_REASON"],
  FORM_ERROR_MESSAGE: ["SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE", "NO_STUCK_LOADING"],
  FORM_DATA_PROCESSED: ["NAVIGATION_STATE_CHANGE_OR_NOOP_REASON"],
  FORM_STATE_AFTER_REFRESH: ["SAFE_REDIRECT_ALLOWED", "CONSISTENT_CONTENT_TYPE"],
  NAV_BACK_BEHAVIOR: ["NAVIGATION_STATE_CHANGE_OR_NOOP_REASON", "SAFE_REDIRECT_ALLOWED"],
  NAV_FORWARD_BEHAVIOR: [...COMMON_NAV_RULES],
  NAV_REFRESH_BEHAVIOR: ["CONSISTENT_CONTENT_TYPE", "NO_STUCK_LOADING"],
  DIRECT_URL_ACCESS_BEHAVIOR: ["NAVIGATION_NOT_ERROR_PAGE", "CONSISTENT_CONTENT_TYPE"],
  LOGIN_VISIBLE_VALIDATION_ONLY: ["NAVIGATION_NOT_ERROR_PAGE", "NO_STUCK_LOADING"],
  PROTECTED_URL_BLOCKING: ["SAFE_REDIRECT_ALLOWED", "NAVIGATION_NOT_ERROR_PAGE"],
  EXTERNAL_DESTINATION_CORRECT: [...COMMON_EXTERNAL_RULES],
  EXTERNAL_HANDOFF_CORRECT: [...COMMON_EXTERNAL_RULES],
  EXTERNAL_RETURN_FLOW_CORRECT: ["SAFE_REDIRECT_ALLOWED", "NAVIGATION_URL_CHANGED"],
  EXTERNAL_FAILURE_HANDLING: ["EXCESSIVE_THIRD_PARTY_FAILURES", "NO_API_5XX", "GRAPHQL_ERRORS_DETECTED"],
  EXTERNAL_ACCESS_CONTROL: ["SAFE_REDIRECT_ALLOWED", "NAVIGATION_NOT_ERROR_PAGE"],
  OAUTH_GOOGLE_HANDOFF: [...COMMON_EXTERNAL_RULES],
  OAUTH_MICROSOFT_HANDOFF: [...COMMON_EXTERNAL_RULES],
  THIRD_PARTY_PAYMENT_REDIRECT: [...COMMON_EXTERNAL_RULES],
  SUPPORT_PORTAL_REDIRECT: [...COMMON_EXTERNAL_RULES],
  EXTERNAL_DOCUMENT_LINK: ["NAVIGATION_NOT_ERROR_PAGE", "CONSISTENT_CONTENT_TYPE"]
});

const CHECK_TO_FLOW_TYPES = Object.freeze({
  PAGE_OPENS_SUCCESSFULLY: ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE"],
  NORMAL_FLOW_VERIFIED: ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE", "SEARCH_SMOKE", "FILTER_SMOKE", "PAGINATION_SMOKE"],
  INVALID_FLOW_VERIFIED: ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE", "SEARCH_SMOKE"],
  DATA_STATE_CHANGE_CONFIRMED: ["SEARCH_SMOKE", "FILTER_SMOKE", "PAGINATION_SMOKE"],
  INPUT_SEARCH_BEHAVIOR: ["SEARCH_SMOKE"],
  BUTTON_CLICK_ACTION_CORRECT: ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE"],
  LINK_DESTINATION_CORRECT: ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE"],
  FORM_VALID_SUBMIT: ["SEARCH_SMOKE", "FILTER_SMOKE"],
  FORM_INVALID_SUBMIT: ["SEARCH_SMOKE", "FILTER_SMOKE"],
  FORM_SUCCESS_MESSAGE: ["SEARCH_SMOKE", "FILTER_SMOKE"],
  FORM_ERROR_MESSAGE: ["SEARCH_SMOKE", "FILTER_SMOKE"],
  NAV_BACK_BEHAVIOR: ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE"],
  NAV_FORWARD_BEHAVIOR: ["PAGINATION_SMOKE"],
  NAV_REFRESH_BEHAVIOR: ["PAGINATION_SMOKE", "DETAIL_PAGE_SMOKE"],
  PROTECTED_URL_BLOCKING: ["HOME_NAV_SMOKE", "DETAIL_PAGE_SMOKE"],
  EXTERNAL_DESTINATION_CORRECT: ["DETAIL_PAGE_SMOKE"],
  EXTERNAL_HANDOFF_CORRECT: ["DETAIL_PAGE_SMOKE"],
  EXTERNAL_RETURN_FLOW_CORRECT: ["DETAIL_PAGE_SMOKE"]
});

const DEFAULT_RULE_FALLBACK = Object.freeze([
  "NAVIGATION_NOT_ERROR_PAGE",
  "NO_STUCK_LOADING",
  "SAFE_REDIRECT_ALLOWED",
  "CONSISTENT_CONTENT_TYPE"
]);

const DEFAULT_FLOW_FALLBACK = Object.freeze([
  "HOME_NAV_SMOKE",
  "DETAIL_PAGE_SMOKE",
  "SEARCH_SMOKE",
  "FILTER_SMOKE",
  "PAGINATION_SMOKE"
]);

function checkStartsWithAny(checkId = "", prefixes = []) {
  return prefixes.some((prefix) => checkId.startsWith(prefix));
}

function checkContainsAny(checkId = "", tokens = []) {
  return tokens.some((token) => checkId.includes(token));
}

function resolveFallbackRuleIds(checkId = "") {
  if (
    checkStartsWithAny(checkId, ["SEARCH_", "FILTER_", "SORT_", "PAGINATION_"]) ||
    checkContainsAny(checkId, ["RESULT", "QUERY", "INFINITE_SCROLL"])
  ) {
    return [
      "SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE",
      "FILTER_CHANGES_RESULTS_OR_NO_RESULTS",
      "CLEAR_FILTER_RESTORES_BASELINE",
      "PAGINATION_CHANGES_CONTENT_OR_PAGE_INDEX",
      "NO_STUCK_LOADING"
    ];
  }

  if (checkStartsWithAny(checkId, ["TABLE_", "TREE_TABLE_", "KANBAN_", "CALENDAR_", "DASHBOARD_", "METRIC_"])) {
    return [
      "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
      "PAGINATION_CHANGES_CONTENT_OR_PAGE_INDEX",
      "FILTER_CHANGES_RESULTS_OR_NO_RESULTS",
      "CONSISTENT_CONTENT_TYPE",
      "NO_STUCK_LOADING"
    ];
  }

  if (checkStartsWithAny(checkId, ["FILE_", "CSV_IMPORT_", "EXPORT_", "DOWNLOAD_", "GENERATED_REPORT_"])) {
    return [
      "UPLOAD_ACCEPTED",
      "DOWNLOAD_EXISTS_AFTER_ACTION",
      "NO_STUCK_LOADING",
      "NO_API_5XX",
      "CONSISTENT_CONTENT_TYPE"
    ];
  }

  if (
    checkStartsWithAny(checkId, [
      "LOGIN_",
      "SESSION_",
      "PASSWORD_RESET_",
      "MFA_",
      "ACCOUNT_VERIFICATION_",
      "POST_LOGIN_",
      "UNAUTHORIZED_DEEP_LINK_",
      "OAUTH_",
      "SSO_",
      "OTP_"
    ]) ||
    checkContainsAny(checkId, ["AUTH", "PROTECTED", "LOCKOUT", "REMEMBER_ME"])
  ) {
    return [
      "SAFE_REDIRECT_ALLOWED",
      "NAVIGATION_NOT_ERROR_PAGE",
      "NAVIGATION_URL_CHANGED",
      "NO_STUCK_LOADING",
      "CONSISTENT_CONTENT_TYPE"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["ROLE_", "TENANT_", "WORKSPACE_", "ADMIN_", "PERMISSION_", "IMPERSONATION_"]) ||
    checkContainsAny(checkId, ["ACCESS", "ISOLATION"])
  ) {
    return [
      "SAFE_REDIRECT_ALLOWED",
      "NAVIGATION_NOT_ERROR_PAGE",
      "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
      "CONSISTENT_CONTENT_TYPE",
      "NO_API_5XX"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["WORKFLOW_", "MULTI_STEP_", "DRAFT_", "SUBMITTED_", "ROLLBACK_"]) ||
    checkContainsAny(checkId, ["TRANSITION", "APPROVAL", "ASSIGNMENT", "ESCALATION", "STEP_SKIP"])
  ) {
    return [
      "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
      "SPA_READY_AFTER_NAV",
      "SAFE_REDIRECT_ALLOWED",
      "NO_STUCK_LOADING",
      "NO_API_5XX"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["TOAST_", "NOTIFICATION_", "BADGE_", "EMAIL_", "POLLING_", "REALTIME_", "ASYNC_", "BACKGROUND_"]) ||
    checkContainsAny(checkId, ["MESSAGE", "REFRESH", "RETRY"])
  ) {
    return [
      "NO_STUCK_LOADING",
      "NO_API_5XX",
      "GRAPHQL_ERRORS_DETECTED",
      "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["SERVER_", "NETWORK_", "RETRY_", "ERROR_", "OFFLINE_", "BROKEN_DEPENDENCY_"]) ||
    checkContainsAny(checkId, ["CONFLICT", "IDEMPOTENCY", "RECOVERY", "FAILURE"])
  ) {
    return [
      "NO_5XX_SPIKE",
      "NO_API_5XX",
      "GRAPHQL_ERRORS_DETECTED",
      "NO_STUCK_LOADING",
      "SAFE_REDIRECT_ALLOWED"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["DATE_FORMAT_", "NUMBER_FORMAT_", "CURRENCY_FORMAT_", "TIMEZONE_", "RTL_", "LOCALE_", "LOCALIZED_"]) ||
    checkContainsAny(checkId, ["TRANSLATED", "REGIONAL"])
  ) {
    return [
      "CONSISTENT_CONTENT_TYPE",
      "NO_STUCK_LOADING",
      "NAVIGATION_NOT_ERROR_PAGE",
      "NO_API_5XX"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["CROSS_BROWSER_", "MOBILE_", "PASSWORD_MANAGER_", "BROWSER_BACK_", "TAB_RESTORE_", "REFRESH_DURING_"]) ||
    checkContainsAny(checkId, ["PLATFORM", "DEVICE"])
  ) {
    return [
      "SPA_READY_AFTER_NAV",
      "SAFE_REDIRECT_ALLOWED",
      "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
      "CONSISTENT_CONTENT_TYPE"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["CART_", "PROMO_", "CHECKOUT_", "SHIPPING_", "PAYMENT_", "ORDER_", "BOOKING_", "CANCELLATION_", "SUBSCRIPTION_", "TRIAL_", "INVOICE_"]) ||
    checkContainsAny(checkId, ["TRANSACTION", "REFUND"])
  ) {
    return [
      "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
      "SAFE_REDIRECT_ALLOWED",
      "NO_API_5XX",
      "CONSISTENT_CONTENT_TYPE",
      "NO_STUCK_LOADING"
    ];
  }

  if (
    checkStartsWithAny(checkId, ["SETTINGS_", "FEATURE_FLAG_", "CONFIG_", "AUDIT_LOG_", "API_KEY_", "WEBHOOK_", "INVITE_USER_", "TEAM_MEMBER_"]) ||
    checkContainsAny(checkId, ["ADMIN", "CREATE_REVOKE"])
  ) {
    return [
      "NAVIGATION_STATE_CHANGE_OR_NOOP_REASON",
      "SAFE_REDIRECT_ALLOWED",
      "NO_API_5XX",
      "CONSISTENT_CONTENT_TYPE"
    ];
  }

  if (checkStartsWithAny(checkId, ["BLOCKED_"])) {
    return [
      "NAVIGATION_NOT_ERROR_PAGE",
      "SAFE_REDIRECT_ALLOWED",
      "NO_STUCK_LOADING",
      "CONSISTENT_CONTENT_TYPE"
    ];
  }

  if (checkStartsWithAny(checkId, ["EVIDENCE_", "BUG_", "REPRO_", "FAILED_STEP_", "REQUEST_RESPONSE_", "VIDEO_", "MODE_SPECIFIC_", "MULTI_DEVICE_", "FUNCTIONAL_FAILURE_"])) {
    return [...DEFAULT_RULE_FALLBACK, "NO_API_5XX"];
  }

  return DEFAULT_RULE_FALLBACK;
}

function resolveFallbackFlowTypes(checkId = "") {
  if (checkStartsWithAny(checkId, ["SEARCH_"])) {
    return ["SEARCH_SMOKE"];
  }
  if (checkStartsWithAny(checkId, ["FILTER_"])) {
    return ["FILTER_SMOKE"];
  }
  if (checkStartsWithAny(checkId, ["PAGINATION_", "INFINITE_SCROLL_"])) {
    return ["PAGINATION_SMOKE"];
  }
  if (checkStartsWithAny(checkId, ["EXTERNAL_", "OAUTH_", "SSO_", "PAYMENT_"])) {
    return ["DETAIL_PAGE_SMOKE"];
  }
  return DEFAULT_FLOW_FALLBACK;
}

function normalizeCheckId(value) {
  return String(value ?? "").trim().toUpperCase();
}

const SELECTABLE_CHECK_SET = new Set(FUNCTIONAL_CHECK_IDS);

export function normalizeFunctionalCheckIds(selectedCheckIds = []) {
  const normalized = [];
  const seen = new Set();
  for (const candidate of Array.isArray(selectedCheckIds) ? selectedCheckIds : []) {
    const checkId = normalizeCheckId(candidate);
    if (!checkId || seen.has(checkId) || !SELECTABLE_CHECK_SET.has(checkId)) {
      continue;
    }
    seen.add(checkId);
    normalized.push(checkId);
  }
  return normalized;
}

export function resolveFunctionalCheckSelection(selectedCheckIds = []) {
  const normalizedCheckIds = normalizeFunctionalCheckIds(selectedCheckIds);
  const selectionActive = normalizedCheckIds.length > 0;
  const allowedRuleIds = new Set();
  const preferredFlowTypes = new Set();

  for (const checkId of normalizedCheckIds) {
    const mappedRuleIds = CHECK_TO_RULE_IDS[checkId] ?? resolveFallbackRuleIds(checkId);
    for (const ruleId of mappedRuleIds) {
      if (RULE_ID_SET.has(ruleId)) {
        allowedRuleIds.add(ruleId);
      }
    }
    const mappedFlowTypes = CHECK_TO_FLOW_TYPES[checkId] ?? resolveFallbackFlowTypes(checkId);
    for (const flowType of mappedFlowTypes) {
      if (FLOW_TYPE_SET.has(flowType)) {
        preferredFlowTypes.add(flowType);
      }
    }
  }

  if (selectionActive && allowedRuleIds.size === 0) {
    for (const ruleId of RULE_ID_SET) {
      allowedRuleIds.add(ruleId);
    }
  }

  return {
    selectedCheckIds: normalizedCheckIds,
    selectionActive,
    allowedRuleIds,
    preferredFlowTypes
  };
}

export function filterFlowCandidatesBySelection(flowCandidates = [], selection = null) {
  if (!selection?.selectionActive || !(selection.preferredFlowTypes instanceof Set) || selection.preferredFlowTypes.size === 0) {
    return [...flowCandidates];
  }
  return flowCandidates.filter((flow) => selection.preferredFlowTypes.has(flow?.flowType));
}
