function titleCaseToken(token = '') {
  const upper = token.toUpperCase();
  if (upper === 'OTP') return 'OTP';
  if (upper === 'MFA') return 'MFA';
  if (upper === 'IDP') return 'IdP';
  if (upper === 'API') return 'API';
  if (upper === 'CSV') return 'CSV';
  if (upper === 'SSO') return 'SSO';
  if (upper === 'KPI') return 'KPI';
  if (upper === 'RTL') return 'RTL';
  if (upper === 'URL') return 'URL';
  if (upper === 'UX') return 'UX';
  return `${token.slice(0, 1).toUpperCase()}${token.slice(1).toLowerCase()}`;
}

export function formatFunctionalCheckTitle(checkId = '') {
  return String(checkId)
    .split('_')
    .filter(Boolean)
    .map((token) => titleCaseToken(token))
    .join(' ')
    .trim();
}

const CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "authentication-session-account-flow",
    title: "Authentication, session, and account flow",
    description: "Login, session continuity, password recovery, OTP/MFA, and protected-route authentication behavior."
  }),
  Object.freeze({
    id: "signup-onboarding-account-creation",
    title: "Signup, onboarding, and account creation",
    description: "Account creation, invite/verification gates, and onboarding progression behavior."
  }),
  Object.freeze({
    id: "form-submission-validation-data-processing",
    title: "Form submission, validation, and data processing",
    description: "Input validation, submit behavior, conditional rules, and data processing correctness for forms."
  }),
  Object.freeze({
    id: "crud-data-lifecycle",
    title: "CRUD and data lifecycle",
    description: "Create/read/update/delete actions, bulk operations, and record lifecycle consistency."
  }),
  Object.freeze({
    id: "search-filter-sort-pagination",
    title: "Search, filter, sort, and pagination",
    description: "Query behavior, filter/sort interactions, pagination boundaries, and result-state correctness."
  }),
  Object.freeze({
    id: "tables-lists-dashboards-data-views",
    title: "Tables, lists, dashboards, and data views",
    description: "Table/list interactions, dashboard widgets, and data-view correctness behavior."
  }),
  Object.freeze({
    id: "file-upload-export-import-download",
    title: "File upload, export, import, and download",
    description: "Upload/import/export flows, file validation, and download/report lifecycle behavior."
  }),
  Object.freeze({
    id: "external-integrations-third-party-flows",
    title: "External integrations and third-party flows",
    description: "OAuth, payment callbacks, third-party handoffs, and external dependency flow behavior."
  }),
  Object.freeze({
    id: "roles-permissions-tenant-workspace-behavior",
    title: "Roles, permissions, tenant, and workspace behavior",
    description: "Access scope, role-gated actions, tenant isolation, and workspace context behavior."
  }),
  Object.freeze({
    id: "workflow-process-state-machine-behavior",
    title: "Workflow, process, and state machine behavior",
    description: "Process-stage transitions, wizard progression, approvals, and state-machine guard behavior."
  }),
  Object.freeze({
    id: "notifications-messaging-asynchronous-behavior",
    title: "Notifications, messaging, and asynchronous behavior",
    description: "In-app notifications, async updates, polling/realtime consistency, and side-effect messaging behavior."
  }),
  Object.freeze({
    id: "error-handling-recovery-resilience",
    title: "Error handling, recovery, and resilience",
    description: "4xx/5xx/network recovery handling, retries, conflict handling, and resilience behavior."
  }),
  Object.freeze({
    id: "localization-formatting-regional-logic",
    title: "Localization, formatting, and regional logic",
    description: "Locale formatting, timezone conversion, RTL behavior, and regional functional correctness."
  }),
  Object.freeze({
    id: "browser-device-platform-behavior",
    title: "Browser, device, and platform behavior",
    description: "Cross-browser and device-specific behavior including navigation and pending-action handling."
  }),
  Object.freeze({
    id: "commerce-booking-transaction-flows",
    title: "Commerce, booking, and transaction flows",
    description: "Commerce and booking flows including checkout, payment, order, and subscription behavior."
  }),
  Object.freeze({
    id: "admin-configuration-settings",
    title: "Admin, configuration, and settings",
    description: "Settings persistence, admin controls, API keys/webhooks, and team-management behavior."
  }),
  Object.freeze({
    id: "blocked-unverifiable-handling",
    title: "Blocked and unverifiable handling",
    description: "Blocked-state classification where verification cannot proceed without external prerequisites."
  }),
  Object.freeze({
    id: "evidence-bug-reporting-failure-capture",
    title: "Evidence, bug reporting, and quality of failure capture",
    description: "Evidence quality, repro capture completeness, and failure reporting metadata quality."
  }),
]);

const LEGACY_BY_CATEGORY = Object.freeze({
  "authentication-session-account-flow": Object.freeze([
    "LOGIN_VALID_CREDENTIALS",
    "LOGIN_INVALID_PASSWORD",
    "LOGIN_EMPTY_FIELDS",
    "LOGIN_REDIRECT_TARGET",
    "LOGOUT_ENDS_SESSION",
    "PROTECTED_URL_BLOCKING",
    "LOGIN_VISIBLE_VALIDATION_ONLY",
    "OTP_CORRECT_CODE",
    "OTP_WRONG_CODE",
    "OTP_EXPIRED_CODE",
    "OTP_RESEND_BEHAVIOR",
    "UNAUTHORIZED_REDIRECT_CHECK",
  ]),
  "signup-onboarding-account-creation": Object.freeze([]),
  "form-submission-validation-data-processing": Object.freeze([
    "INPUT_EMAIL_VALIDATION",
    "INPUT_USERNAME_VALIDATION",
    "INPUT_PHONE_VALIDATION",
    "INPUT_PASSWORD_VALIDATION",
    "INPUT_OTP_VALIDATION",
    "INPUT_DATE_VALIDATION",
    "INPUT_NUMBER_VALIDATION",
    "INPUT_ACCESS_KEY_VALIDATION",
    "INPUT_REQUIRED_FIELD_VALIDATION",
    "INPUT_FORMAT_VALIDATION",
    "INPUT_BOUNDARY_VALUE_VALIDATION",
    "INPUT_EMPTY_VALUE_VALIDATION",
    "INPUT_INVALID_VALUE_REJECTION",
    "INPUT_PLACEHOLDER_OR_HINT_CHECK",
    "PASSWORD_VISIBILITY_TOGGLE_CHECK",
    "BUTTON_CLICK_ACTION_CORRECT",
    "BUTTON_DISABLED_STATE_CORRECT",
    "BUTTON_DUPLICATE_SUBMIT_PROTECTION",
    "FORM_VALID_SUBMIT",
    "FORM_INVALID_SUBMIT",
    "FORM_EMPTY_SUBMIT",
    "FORM_SUCCESS_MESSAGE",
    "FORM_ERROR_MESSAGE",
    "FORM_DATA_PROCESSED",
    "FORM_STATE_AFTER_REFRESH",
    "UNSAVED_DATA_WARNING_CHECK",
  ]),
  "crud-data-lifecycle": Object.freeze([]),
  "search-filter-sort-pagination": Object.freeze([
    "INPUT_SEARCH_BEHAVIOR",
  ]),
  "tables-lists-dashboards-data-views": Object.freeze([]),
  "file-upload-export-import-download": Object.freeze([]),
  "external-integrations-third-party-flows": Object.freeze([
    "EXTERNAL_DESTINATION_CORRECT",
    "EXTERNAL_HANDOFF_CORRECT",
    "EXTERNAL_RETURN_FLOW_CORRECT",
    "EXTERNAL_FAILURE_HANDLING",
    "EXTERNAL_ACCESS_CONTROL",
    "OAUTH_GOOGLE_HANDOFF",
    "OAUTH_MICROSOFT_HANDOFF",
    "THIRD_PARTY_PAYMENT_REDIRECT",
    "SUPPORT_PORTAL_REDIRECT",
    "EXTERNAL_DOCUMENT_LINK",
  ]),
  "roles-permissions-tenant-workspace-behavior": Object.freeze([
    "ROLE_ACCESS_CORRECTNESS",
    "ROLE_FEATURE_VISIBILITY",
    "ROLE_UNAUTHORIZED_ACCESS_BLOCK",
  ]),
  "workflow-process-state-machine-behavior": Object.freeze([
    "PAGE_OPENS_SUCCESSFULLY",
    "PAGE_PURPOSE_UNDERSTOOD",
    "VISIBLE_ELEMENTS_IDENTIFIED",
    "MAIN_ACTION_IDENTIFIED",
    "NORMAL_FLOW_VERIFIED",
    "INVALID_FLOW_VERIFIED",
    "DATA_STATE_CHANGE_CONFIRMED",
    "NAVIGATION_AND_RECOVERY_VERIFIED",
  ]),
  "notifications-messaging-asynchronous-behavior": Object.freeze([]),
  "error-handling-recovery-resilience": Object.freeze([
    "ERROR_HANDLING_VISIBLE",
    "BROKEN_LINK_DETECTION_FUNCTIONAL",
  ]),
  "localization-formatting-regional-logic": Object.freeze([]),
  "browser-device-platform-behavior": Object.freeze([
    "LINK_DESTINATION_CORRECT",
    "LINK_TAB_BEHAVIOR_CORRECT",
    "NAV_BACK_BEHAVIOR",
    "NAV_FORWARD_BEHAVIOR",
    "NAV_CANCEL_BEHAVIOR",
    "NAV_CLOSE_BEHAVIOR",
    "NAV_REFRESH_BEHAVIOR",
    "DIRECT_URL_ACCESS_BEHAVIOR",
  ]),
  "commerce-booking-transaction-flows": Object.freeze([]),
  "admin-configuration-settings": Object.freeze([]),
  "blocked-unverifiable-handling": Object.freeze([
    "BLOCKED_NO_CREDENTIALS_HANDLING",
    "BLOCKED_NO_OTP_ACCESS_HANDLING",
    "BLOCKED_NO_TEST_DATA_HANDLING",
    "BLOCKED_BUSINESS_RULE_UNCLEAR_HANDLING",
    "BLOCKED_BACKEND_STATE_NOT_VISIBLE_HANDLING",
    "BLOCKED_THIRD_PARTY_SANDBOX_MISSING_HANDLING",
  ]),
  "evidence-bug-reporting-failure-capture": Object.freeze([
    "EVIDENCE_SCREENSHOT_CAPTURE",
    "EVIDENCE_VIDEO_CAPTURE",
    "BUG_TITLE_CAPTURE",
    "BUG_STEPS_CAPTURE",
    "BUG_EXPECTED_RESULT_CAPTURE",
    "BUG_ACTUAL_RESULT_CAPTURE",
    "BUG_ENVIRONMENT_CAPTURE",
    "BUG_SEVERITY_CAPTURE",
    "BUG_BLOCKER_CAPTURE",
    "PAGE_VERIFICATION_CHECKLIST",
    "QUICK_TEST_CASE_SHEET_COVERAGE",
    "BUG_REPORT_TEMPLATE_COVERAGE",
    "LOGIN_WALKTHROUGH_COVERAGE",
    "CONTACT_FORM_WALKTHROUGH_COVERAGE",
  ]),
});

const LEGACY_CHECK_IDS = Object.freeze(
  Object.values(LEGACY_BY_CATEGORY).flat()
);

export const FUNCTIONAL_RECOMMENDED_CHECK_IDS = Object.freeze([
  "PAGE_OPENS_SUCCESSFULLY",
  "NORMAL_FLOW_VERIFIED",
  "INVALID_FLOW_VERIFIED",
  "DATA_STATE_CHANGE_CONFIRMED",
  "INPUT_REQUIRED_FIELD_VALIDATION",
  "INPUT_FORMAT_VALIDATION",
  "BUTTON_CLICK_ACTION_CORRECT",
  "LINK_DESTINATION_CORRECT",
  "FORM_VALID_SUBMIT",
  "FORM_INVALID_SUBMIT",
  "FORM_SUCCESS_MESSAGE",
  "FORM_ERROR_MESSAGE",
  "NAV_BACK_BEHAVIOR",
  "LOGIN_VISIBLE_VALIDATION_ONLY",
  "PROTECTED_URL_BLOCKING",
  "EXTERNAL_DESTINATION_CORRECT",
  "EXTERNAL_FAILURE_HANDLING",
  "EVIDENCE_VIDEO_CAPTURE",
  "BUG_STEPS_CAPTURE",
  "BUG_EXPECTED_RESULT_CAPTURE",
  "BUG_ACTUAL_RESULT_CAPTURE",
]);

const EXPANSION_BY_CATEGORY = Object.freeze({
  "authentication-session-account-flow": Object.freeze([
    Object.freeze({
      id: "LOGIN_RATE_LIMIT_BEHAVIOR",
      title: "repeated failed login attempts are handled correctly."
    }),
    Object.freeze({
      id: "LOGIN_LOCKOUT_RECOVERY",
      title: "lockout state can be recovered properly."
    }),
    Object.freeze({
      id: "LOGIN_TRIM_INPUT_BEHAVIOR",
      title: "leading/trailing spaces are handled correctly."
    }),
    Object.freeze({
      id: "LOGIN_CASE_SENSITIVITY_RULES",
      title: "username, email, or access-key case behavior is correct."
    }),
    Object.freeze({
      id: "LOGIN_REMEMBER_ME_BEHAVIOR",
      title: "remember-me changes session persistence correctly."
    }),
    Object.freeze({
      id: "LOGIN_ALREADY_AUTHENTICATED_REDIRECT",
      title: "logged-in users do not see login page again."
    }),
    Object.freeze({
      id: "SESSION_EXPIRY_BEHAVIOR",
      title: "expired session redirects correctly."
    }),
    Object.freeze({
      id: "SESSION_CONTINUES_ACROSS_REFRESH",
      title: "valid session survives refresh when expected."
    }),
    Object.freeze({
      id: "SESSION_INVALIDATED_AFTER_LOGOUT_ALL_TABS",
      title: "logout affects all tabs correctly."
    }),
    Object.freeze({
      id: "MULTI_TAB_SESSION_CONSISTENCY",
      title: "login/logout state is consistent across tabs."
    }),
    Object.freeze({
      id: "PASSWORD_RESET_ENTRYPOINT_WORKS",
      title: "forgot-password flow starts correctly."
    }),
    Object.freeze({
      id: "PASSWORD_RESET_TOKEN_INVALID_BEHAVIOR",
      title: "invalid reset token handled correctly."
    }),
    Object.freeze({
      id: "PASSWORD_RESET_TOKEN_EXPIRED_BEHAVIOR",
      title: "expired reset token handled correctly."
    }),
    Object.freeze({
      id: "PASSWORD_RESET_SUCCESS_LOGIN_PATH",
      title: "user can log in after reset."
    }),
    Object.freeze({
      id: "ACCOUNT_VERIFICATION_REQUIRED_FLOW",
      title: "unverified-account path handled correctly."
    }),
    Object.freeze({
      id: "MFA_SETUP_REQUIRED_FLOW",
      title: "forced MFA setup flow works correctly."
    }),
    Object.freeze({
      id: "MFA_SKIP_POLICY_BEHAVIOR",
      title: "skip/remind-later logic works when allowed."
    }),
    Object.freeze({
      id: "ROLE_SWITCH_SESSION_BEHAVIOR",
      title: "changing role/account context updates session correctly."
    }),
    Object.freeze({
      id: "UNAUTHORIZED_DEEP_LINK_REDIRECT",
      title: "protected deep links redirect properly after auth."
    }),
    Object.freeze({
      id: "POST_LOGIN_RETURN_URL_BEHAVIOR",
      title: "user returns to intended page after login."
    }),
  ]),
  "signup-onboarding-account-creation": Object.freeze([
    Object.freeze({
      id: "SIGNUP_VALID_FLOW",
      title: "account creation succeeds with valid data."
    }),
    Object.freeze({
      id: "SIGNUP_DUPLICATE_EMAIL_REJECTION",
      title: "duplicate account is prevented correctly."
    }),
    Object.freeze({
      id: "SIGNUP_INVITE_ONLY_RESTRICTION",
      title: "invite-gated signup is enforced."
    }),
    Object.freeze({
      id: "SIGNUP_TERMS_REQUIRED_BEHAVIOR",
      title: "terms consent is enforced."
    }),
    Object.freeze({
      id: "SIGNUP_EMAIL_VERIFICATION_FLOW",
      title: "verification step works end to end."
    }),
    Object.freeze({
      id: "SIGNUP_PARTIAL_PROGRESS_PERSISTENCE",
      title: "partial signup data is preserved or intentionally reset."
    }),
    Object.freeze({
      id: "ONBOARDING_STEP_PROGRESS_PERSISTENCE",
      title: "onboarding saves step state correctly."
    }),
    Object.freeze({
      id: "ONBOARDING_SKIP_OPTION_BEHAVIOR",
      title: "optional onboarding steps skip correctly."
    }),
    Object.freeze({
      id: "ONBOARDING_REQUIRED_STEP_ENFORCEMENT",
      title: "required steps cannot be bypassed."
    }),
    Object.freeze({
      id: "PROFILE_COMPLETION_GATE_BEHAVIOR",
      title: "incomplete profile gating works correctly."
    }),
  ]),
  "form-submission-validation-data-processing": Object.freeze([
    Object.freeze({
      id: "SERVER_VALIDATION_MATCHES_CLIENT_VALIDATION",
      title: "client and server validation stay consistent."
    }),
    Object.freeze({
      id: "DUPLICATE_SUBMISSION_PREVENTION",
      title: "repeated submit does not create duplicates."
    }),
    Object.freeze({
      id: "IDEMPOTENT_FORM_RETRY_BEHAVIOR",
      title: "retrying safe submit does not duplicate state."
    }),
    Object.freeze({
      id: "PARTIAL_FORM_SAVE_BEHAVIOR",
      title: "draft/save-later works correctly."
    }),
    Object.freeze({
      id: "FORM_STATE_PRESERVED_AFTER_ERROR",
      title: "valid fields are preserved after failed submit."
    }),
    Object.freeze({
      id: "FORM_STATE_AFTER_NAVIGATION_RETURN",
      title: "returning to form preserves or resets correctly."
    }),
    Object.freeze({
      id: "FORM_DEPENDENT_FIELDS_BEHAVIOR",
      title: "field dependencies update correctly."
    }),
    Object.freeze({
      id: "CONDITIONAL_FIELD_VISIBILITY_BEHAVIOR",
      title: "conditionally shown fields work correctly."
    }),
    Object.freeze({
      id: "CONDITIONAL_REQUIREDNESS_BEHAVIOR",
      title: "requirement changes correctly with state."
    }),
    Object.freeze({
      id: "FORM_SECTION_ENABLE_DISABLE_BEHAVIOR",
      title: "section locking/unlocking works correctly."
    }),
    Object.freeze({
      id: "AUTOPOPULATED_FIELD_CORRECTNESS",
      title: "auto-filled values are correct."
    }),
    Object.freeze({
      id: "READONLY_FIELD_INTEGRITY",
      title: "readonly/computed fields cannot be altered incorrectly."
    }),
    Object.freeze({
      id: "COMPUTED_TOTAL_FIELD_CORRECTNESS",
      title: "totals/calculated values update correctly."
    }),
    Object.freeze({
      id: "CROSS_FIELD_VALIDATION_BEHAVIOR",
      title: "interdependent field rules are enforced."
    }),
    Object.freeze({
      id: "ASYNC_VALIDATION_RESULT_CORRECTNESS",
      title: "async validation returns correct result."
    }),
    Object.freeze({
      id: "FORM_CLEAR_RESET_BEHAVIOR",
      title: "reset clears the correct fields only."
    }),
    Object.freeze({
      id: "FORM_CANCEL_RESTORE_BEHAVIOR",
      title: "cancel restores prior saved state correctly."
    }),
    Object.freeze({
      id: "FORM_SUBMIT_WITH_STALE_DATA_WARNING",
      title: "stale data warning appears when needed."
    }),
    Object.freeze({
      id: "FORM_FILE_ATTACHMENT_REQUIREDNESS",
      title: "attachment requirement handled correctly."
    }),
    Object.freeze({
      id: "FORM_FILE_REPLACEMENT_BEHAVIOR",
      title: "replacing uploaded file works correctly."
    }),
    Object.freeze({
      id: "FORM_MAX_LENGTH_ENFORCEMENT",
      title: "max length is enforced functionally."
    }),
    Object.freeze({
      id: "FORM_MIN_MAX_NUMERIC_RULES",
      title: "numeric min/max enforced correctly."
    }),
    Object.freeze({
      id: "FORM_DATE_RANGE_RULES",
      title: "start/end date relationships are handled correctly."
    }),
    Object.freeze({
      id: "FORM_TIMEZONE_SENSITIVE_INPUT_BEHAVIOR",
      title: "timezone-dependent fields behave correctly."
    }),
  ]),
  "crud-data-lifecycle": Object.freeze([
    Object.freeze({
      id: "CREATE_RECORD_SUCCESS",
      title: "create action actually persists the record."
    }),
    Object.freeze({
      id: "CREATE_RECORD_VISIBILITY_AFTER_CREATE",
      title: "created item appears where expected."
    }),
    Object.freeze({
      id: "EDIT_RECORD_SUCCESS",
      title: "edit action updates data correctly."
    }),
    Object.freeze({
      id: "EDIT_RECORD_CONFLICT_HANDLING",
      title: "concurrent edit conflict handled correctly."
    }),
    Object.freeze({
      id: "DELETE_RECORD_SUCCESS",
      title: "delete actually removes the item."
    }),
    Object.freeze({
      id: "DELETE_RECORD_RECOVERY_BEHAVIOR",
      title: "undo/archive/recovery works if supported."
    }),
    Object.freeze({
      id: "ARCHIVE_UNARCHIVE_BEHAVIOR",
      title: "archive lifecycle works correctly."
    }),
    Object.freeze({
      id: "SOFT_DELETE_HIDDEN_FROM_ACTIVE_VIEWS",
      title: "deleted/archived items leave active views."
    }),
    Object.freeze({
      id: "DUPLICATE_RECORD_ACTION_BEHAVIOR",
      title: "duplicate/clone action works correctly."
    }),
    Object.freeze({
      id: "COPY_RECORD_ACTION_BEHAVIOR",
      title: "copy action preserves intended fields only."
    }),
    Object.freeze({
      id: "BULK_DELETE_BEHAVIOR",
      title: "bulk destructive actions affect exact selected items."
    }),
    Object.freeze({
      id: "BULK_EDIT_BEHAVIOR",
      title: "bulk update applies correctly."
    }),
    Object.freeze({
      id: "BULK_ACTION_PARTIAL_FAILURE_HANDLING",
      title: "mixed success/failure bulk ops are reported properly."
    }),
    Object.freeze({
      id: "RECORD_HISTORY_AUDIT_VISIBILITY",
      title: "change history/audit events appear correctly."
    }),
    Object.freeze({
      id: "LAST_UPDATED_METADATA_CORRECTNESS",
      title: "updated-by/time metadata are correct after changes."
    }),
  ]),
  "search-filter-sort-pagination": Object.freeze([
    Object.freeze({
      id: "SEARCH_EXACT_MATCH_BEHAVIOR",
      title: "exact query works correctly."
    }),
    Object.freeze({
      id: "SEARCH_PARTIAL_MATCH_BEHAVIOR",
      title: "partial query works correctly."
    }),
    Object.freeze({
      id: "SEARCH_CASE_INSENSITIVE_BEHAVIOR",
      title: "case handling is correct."
    }),
    Object.freeze({
      id: "SEARCH_TRIM_SPACES_BEHAVIOR",
      title: "whitespace normalization is correct."
    }),
    Object.freeze({
      id: "SEARCH_SPECIAL_CHARACTER_BEHAVIOR",
      title: "special characters are handled safely and correctly."
    }),
    Object.freeze({
      id: "SEARCH_EMPTY_QUERY_BEHAVIOR",
      title: "empty-search behavior is correct."
    }),
    Object.freeze({
      id: "SEARCH_DEBOUNCE_RESULT_CORRECTNESS",
      title: "debounced search does not show stale results."
    }),
    Object.freeze({
      id: "SEARCH_CLEAR_RESETS_RESULTS",
      title: "clearing search restores correct state."
    }),
    Object.freeze({
      id: "FILTER_COMBINATION_LOGIC_CORRECTNESS",
      title: "multi-filter AND/OR logic is correct."
    }),
    Object.freeze({
      id: "FILTER_CLEAR_ALL_BEHAVIOR",
      title: "clear-all resets everything correctly."
    }),
    Object.freeze({
      id: "FILTER_PERSISTENCE_ACROSS_REFRESH",
      title: "filter state persists if expected."
    }),
    Object.freeze({
      id: "SORT_ASC_DESC_CORRECTNESS",
      title: "ascending/descending order is actually correct."
    }),
    Object.freeze({
      id: "SORT_WITH_FILTER_INTERACTION_CORRECTNESS",
      title: "sorting after filtering still behaves correctly."
    }),
    Object.freeze({
      id: "PAGINATION_BOUNDARY_BEHAVIOR",
      title: "first/last page boundaries are correct."
    }),
    Object.freeze({
      id: "PAGINATION_PAGE_SIZE_BEHAVIOR",
      title: "page-size changes work correctly."
    }),
    Object.freeze({
      id: "PAGINATION_STATE_AFTER_DELETE",
      title: "deleting last row on page is handled correctly."
    }),
    Object.freeze({
      id: "INFINITE_SCROLL_LOAD_MORE_BEHAVIOR",
      title: "lazy load appends correctly without duplication."
    }),
    Object.freeze({
      id: "RESULT_COUNT_CORRECTNESS",
      title: "shown counts match actual results."
    }),
    Object.freeze({
      id: "NO_RESULTS_STATE_CORRECTNESS",
      title: "no-result state triggers only when correct."
    }),
  ]),
  "tables-lists-dashboards-data-views": Object.freeze([
    Object.freeze({
      id: "TABLE_ROW_ACTION_TARGET_CORRECTNESS",
      title: "row actions apply to the correct row."
    }),
    Object.freeze({
      id: "TABLE_SELECTION_PERSISTENCE_BEHAVIOR",
      title: "selected rows persist/reset correctly."
    }),
    Object.freeze({
      id: "TABLE_SELECT_ALL_SCOPE_CORRECTNESS",
      title: "select-all affects the correct scope."
    }),
    Object.freeze({
      id: "TABLE_COLUMN_HIDE_SHOW_PERSISTENCE",
      title: "column visibility settings behave correctly."
    }),
    Object.freeze({
      id: "TABLE_STICKY_HEADER_DATA_ALIGNMENT",
      title: "sticky headers still match columns functionally."
    }),
    Object.freeze({
      id: "TABLE_INLINE_EDIT_SAVE_BEHAVIOR",
      title: "inline edits save correctly."
    }),
    Object.freeze({
      id: "TABLE_INLINE_EDIT_CANCEL_BEHAVIOR",
      title: "cancel reverts correctly."
    }),
    Object.freeze({
      id: "TABLE_EXPANDED_ROW_CONTENT_CORRECTNESS",
      title: "expanded details match the row."
    }),
    Object.freeze({
      id: "TREE_TABLE_EXPAND_COLLAPSE_BEHAVIOR",
      title: "nested table structures behave correctly."
    }),
    Object.freeze({
      id: "KANBAN_DRAG_DROP_PERSISTENCE",
      title: "drag/drop changes actually persist."
    }),
    Object.freeze({
      id: "CALENDAR_EVENT_CREATE_BEHAVIOR",
      title: "calendar item creation works."
    }),
    Object.freeze({
      id: "CALENDAR_EVENT_EDIT_BEHAVIOR",
      title: "move/edit event updates correctly."
    }),
    Object.freeze({
      id: "DASHBOARD_WIDGET_FILTER_SCOPING",
      title: "widget-level filters affect only correct widgets."
    }),
    Object.freeze({
      id: "DASHBOARD_GLOBAL_FILTER_PROPAGATION",
      title: "global filters propagate correctly."
    }),
    Object.freeze({
      id: "METRIC_CARD_VALUE_CORRECTNESS",
      title: "KPI values match underlying data."
    }),
    Object.freeze({
      id: "DRILLDOWN_NAVIGATION_CORRECTNESS",
      title: "clicking metric/card opens the correct filtered detail view."
    }),
  ]),
  "file-upload-export-import-download": Object.freeze([
    Object.freeze({
      id: "FILE_UPLOAD_SUCCESS",
      title: "upload actually completes and persists."
    }),
    Object.freeze({
      id: "FILE_UPLOAD_TYPE_RESTRICTION",
      title: "invalid types are rejected correctly."
    }),
    Object.freeze({
      id: "FILE_UPLOAD_SIZE_LIMIT_ENFORCEMENT",
      title: "oversize files are blocked correctly."
    }),
    Object.freeze({
      id: "FILE_UPLOAD_MULTIPLE_FILE_BEHAVIOR",
      title: "multi-file upload works correctly."
    }),
    Object.freeze({
      id: "FILE_UPLOAD_RETRY_BEHAVIOR",
      title: "retry works after failure."
    }),
    Object.freeze({
      id: "FILE_UPLOAD_CANCEL_BEHAVIOR",
      title: "cancel upload works if supported."
    }),
    Object.freeze({
      id: "FILE_PREVIEW_BEHAVIOR",
      title: "uploaded-file preview is correct."
    }),
    Object.freeze({
      id: "FILE_REMOVE_BEHAVIOR",
      title: "removing uploaded file works correctly."
    }),
    Object.freeze({
      id: "CSV_IMPORT_VALID_FILE_BEHAVIOR",
      title: "valid import works correctly."
    }),
    Object.freeze({
      id: "CSV_IMPORT_PARTIAL_ERROR_REPORTING",
      title: "mixed import failures are surfaced properly."
    }),
    Object.freeze({
      id: "CSV_IMPORT_TEMPLATE_MATCH_ENFORCEMENT",
      title: "schema/template mismatches handled correctly."
    }),
    Object.freeze({
      id: "EXPORT_CURRENT_FILTER_SCOPE",
      title: "export respects current filters."
    }),
    Object.freeze({
      id: "EXPORT_SELECTED_ROWS_SCOPE",
      title: "export selected-only when intended."
    }),
    Object.freeze({
      id: "DOWNLOAD_LINK_EXPIRY_BEHAVIOR",
      title: "expiring download links are handled correctly."
    }),
    Object.freeze({
      id: "GENERATED_REPORT_READY_STATE",
      title: "async report-generation completion is handled correctly."
    }),
  ]),
  "external-integrations-third-party-flows": Object.freeze([
    Object.freeze({
      id: "OAUTH_CANCEL_RETURN_FLOW",
      title: "canceling OAuth returns safely."
    }),
    Object.freeze({
      id: "OAUTH_ACCOUNT_SWITCH_BEHAVIOR",
      title: "changing external account behaves correctly."
    }),
    Object.freeze({
      id: "EXTERNAL_WINDOW_CLOSE_HANDLING",
      title: "closing popup/window is handled correctly."
    }),
    Object.freeze({
      id: "PAYMENT_SUCCESS_CALLBACK_BEHAVIOR",
      title: "successful external payment updates app state."
    }),
    Object.freeze({
      id: "PAYMENT_CANCEL_CALLBACK_BEHAVIOR",
      title: "cancel path is handled correctly."
    }),
    Object.freeze({
      id: "PAYMENT_FAILURE_CALLBACK_BEHAVIOR",
      title: "failure path is handled correctly."
    }),
    Object.freeze({
      id: "WEBHOOK_DELAY_STATE_BEHAVIOR",
      title: "delayed third-party confirmation is handled correctly."
    }),
    Object.freeze({
      id: "EMBEDDED_WIDGET_LOAD_FAILURE_HANDLING",
      title: "failed embeds are handled correctly."
    }),
    Object.freeze({
      id: "MAP_LOCATION_PICKER_BEHAVIOR",
      title: "map/location selection persists correctly."
    }),
    Object.freeze({
      id: "DOC_VIEWER_LINK_HANDOFF",
      title: "document viewer opens the correct file/state."
    }),
    Object.freeze({
      id: "SUPPORT_CHAT_WIDGET_STATE_IMPACT",
      title: "support widget does not break main flow."
    }),
    Object.freeze({
      id: "SSO_INITIATED_LOGIN_FLOW",
      title: "SSO launched from app behaves correctly."
    }),
    Object.freeze({
      id: "SSO_IDP_ERROR_RETURN_FLOW",
      title: "IdP error returns are handled correctly."
    }),
  ]),
  "roles-permissions-tenant-workspace-behavior": Object.freeze([
    Object.freeze({
      id: "ROLE_BASED_PAGE_ACCESS",
      title: "pages are hidden/blocked correctly by role."
    }),
    Object.freeze({
      id: "ROLE_BASED_ACTION_PERMISSION",
      title: "buttons/actions are allowed only for proper roles."
    }),
    Object.freeze({
      id: "ROLE_BASED_DATA_VISIBILITY",
      title: "rows/records are scoped correctly by role."
    }),
    Object.freeze({
      id: "ROLE_BASED_EDITABILITY",
      title: "readonly vs editable state is correct per role."
    }),
    Object.freeze({
      id: "TENANT_DATA_ISOLATION",
      title: "tenant/workspace data isolation is enforced."
    }),
    Object.freeze({
      id: "WORKSPACE_SWITCH_DATA_REFRESH",
      title: "switching workspace reloads correct data."
    }),
    Object.freeze({
      id: "ADMIN_OVERRIDE_BEHAVIOR",
      title: "admin-only overrides work correctly."
    }),
    Object.freeze({
      id: "IMPERSONATION_MODE_BEHAVIOR",
      title: "impersonation changes context correctly if supported."
    }),
    Object.freeze({
      id: "PERMISSION_CHANGE_EFFECTIVE_AFTER_REFRESH_OR_RELOGIN",
      title: "updated role/permission takes effect correctly."
    }),
  ]),
  "workflow-process-state-machine-behavior": Object.freeze([
    Object.freeze({
      id: "MULTI_STEP_WIZARD_NEXT_PREV_BEHAVIOR",
      title: "next/back preserves correct state."
    }),
    Object.freeze({
      id: "MULTI_STEP_WIZARD_SUBMIT_ONLY_ON_FINAL_STEP",
      title: "final action only on correct stage."
    }),
    Object.freeze({
      id: "STEP_SKIP_RULE_ENFORCEMENT",
      title: "blocked steps cannot be skipped."
    }),
    Object.freeze({
      id: "WORKFLOW_APPROVAL_ACTION_CORRECTNESS",
      title: "approve/reject affects the correct object."
    }),
    Object.freeze({
      id: "WORKFLOW_STATUS_TRANSITION_RULES",
      title: "invalid transitions are blocked."
    }),
    Object.freeze({
      id: "WORKFLOW_REOPEN_BEHAVIOR",
      title: "reopened items return to proper state."
    }),
    Object.freeze({
      id: "WORKFLOW_ESCALATION_BEHAVIOR",
      title: "escalation rules trigger correctly."
    }),
    Object.freeze({
      id: "WORKFLOW_ASSIGNMENT_CHANGE_BEHAVIOR",
      title: "reassignment updates ownership correctly."
    }),
    Object.freeze({
      id: "DRAFT_TO_SUBMITTED_TRANSITION",
      title: "draft lifecycle is handled correctly."
    }),
    Object.freeze({
      id: "SUBMITTED_TO_COMPLETED_TRANSITION",
      title: "downstream status updates are correct."
    }),
    Object.freeze({
      id: "ROLLBACK_OR_REVERT_TRANSITION",
      title: "revert path works if supported."
    }),
  ]),
  "notifications-messaging-asynchronous-behavior": Object.freeze([
    Object.freeze({
      id: "TOAST_TRIGGER_CORRECTNESS",
      title: "toasts appear only when correct."
    }),
    Object.freeze({
      id: "TOAST_DUPLICATION_PREVENTION",
      title: "duplicate notifications are not spammed."
    }),
    Object.freeze({
      id: "IN_APP_NOTIFICATION_MARK_READ_BEHAVIOR",
      title: "read/unread state is correct."
    }),
    Object.freeze({
      id: "NOTIFICATION_DEEP_LINK_CORRECTNESS",
      title: "clicking notification opens the right target."
    }),
    Object.freeze({
      id: "BADGE_COUNT_CORRECTNESS",
      title: "counts match unread items."
    }),
    Object.freeze({
      id: "EMAIL_TRIGGER_SIDE_EFFECT_BEHAVIOR",
      title: "email/send side effect triggers correctly."
    }),
    Object.freeze({
      id: "POLLING_DATA_REFRESH_CORRECTNESS",
      title: "polling updates data without stale duplication."
    }),
    Object.freeze({
      id: "REALTIME_UPDATE_CONSISTENCY",
      title: "websocket/live updates merge correctly."
    }),
    Object.freeze({
      id: "ASYNC_JOB_STATUS_REFRESH",
      title: "pending/processing/completed states update correctly."
    }),
    Object.freeze({
      id: "BACKGROUND_RETRY_STATUS_BEHAVIOR",
      title: "failed background ops retry/report correctly."
    }),
  ]),
  "error-handling-recovery-resilience": Object.freeze([
    Object.freeze({
      id: "SERVER_4XX_ERROR_HANDLING",
      title: "user-caused server errors are surfaced correctly."
    }),
    Object.freeze({
      id: "SERVER_5XX_ERROR_HANDLING",
      title: "server failures are handled gracefully."
    }),
    Object.freeze({
      id: "NETWORK_TIMEOUT_RETRY_BEHAVIOR",
      title: "timeouts are retriable where expected."
    }),
    Object.freeze({
      id: "RETRY_BUTTON_ACTUAL_RECOVERY",
      title: "retry actually retries the correct operation."
    }),
    Object.freeze({
      id: "PARTIAL_PAGE_LOAD_FAILURE_HANDLING",
      title: "one section failing does not corrupt others."
    }),
    Object.freeze({
      id: "STALE_FORM_SUBMIT_CONFLICT_HANDLING",
      title: "submitting stale form state is handled."
    }),
    Object.freeze({
      id: "OFFLINE_CREATE_EDIT_QUEUE_BEHAVIOR",
      title: "queued actions behave correctly if supported."
    }),
    Object.freeze({
      id: "IDEMPOTENCY_ON_REFRESH_AFTER_SUBMIT",
      title: "refresh after submit does not duplicate action."
    }),
    Object.freeze({
      id: "ERROR_STATE_RESET_AFTER_RECOVERY",
      title: "error message clears correctly after success."
    }),
    Object.freeze({
      id: "BROKEN_DEPENDENCY_FALLBACK_BEHAVIOR",
      title: "third-party failure does not fully block app when avoidable."
    }),
  ]),
  "localization-formatting-regional-logic": Object.freeze([
    Object.freeze({
      id: "DATE_FORMAT_BY_LOCALE_CORRECTNESS",
      title: "locale-specific date formatting is correct."
    }),
    Object.freeze({
      id: "NUMBER_FORMAT_BY_LOCALE_CORRECTNESS",
      title: "decimal/thousand formatting is correct."
    }),
    Object.freeze({
      id: "CURRENCY_FORMAT_BY_LOCALE_CORRECTNESS",
      title: "money formatting is correct."
    }),
    Object.freeze({
      id: "TIMEZONE_CONVERSION_CORRECTNESS",
      title: "displayed times convert correctly."
    }),
    Object.freeze({
      id: "RTL_FLOW_FUNCTIONAL_CORRECTNESS",
      title: "right-to-left mode still behaves correctly."
    }),
    Object.freeze({
      id: "TRANSLATED_VALIDATION_LOGIC_MATCHES",
      title: "translated labels still map to correct validation behavior."
    }),
    Object.freeze({
      id: "LOCALE_SWITCH_PERSISTS_CORRECTLY",
      title: "switching locale updates state correctly."
    }),
    Object.freeze({
      id: "LOCALIZED_EXPORT_CONTENT_CORRECTNESS",
      title: "exports reflect correct locale formatting when expected."
    }),
  ]),
  "browser-device-platform-behavior": Object.freeze([
    Object.freeze({
      id: "CROSS_BROWSER_FORM_SUBMIT_CONSISTENCY",
      title: "submit works the same across browsers."
    }),
    Object.freeze({
      id: "MOBILE_BROWSER_FILE_PICKER_BEHAVIOR",
      title: "upload/file picker works on mobile browsers."
    }),
    Object.freeze({
      id: "MOBILE_AUTOFILL_BEHAVIOR",
      title: "autofill does not break logic."
    }),
    Object.freeze({
      id: "PASSWORD_MANAGER_INTERACTION_BEHAVIOR",
      title: "password-manager suggestions do not break login."
    }),
    Object.freeze({
      id: "BROWSER_BACK_AFTER_SUBMIT_BEHAVIOR",
      title: "back button after submit lands in correct state."
    }),
    Object.freeze({
      id: "TAB_RESTORE_SESSION_BEHAVIOR",
      title: "restored tab/session behaves correctly."
    }),
    Object.freeze({
      id: "REFRESH_DURING_PENDING_ACTION_BEHAVIOR",
      title: "refresh during pending action is handled correctly."
    }),
  ]),
  "commerce-booking-transaction-flows": Object.freeze([
    Object.freeze({
      id: "CART_ADD_REMOVE_UPDATE_CORRECTNESS",
      title: "cart changes actually persist."
    }),
    Object.freeze({
      id: "CART_TOTAL_RECALCULATION_CORRECTNESS",
      title: "totals update correctly."
    }),
    Object.freeze({
      id: "PROMO_CODE_VALIDATION_CORRECTNESS",
      title: "promo acceptance/rejection is correct."
    }),
    Object.freeze({
      id: "CHECKOUT_ADDRESS_SELECTION_BEHAVIOR",
      title: "selected address is applied correctly."
    }),
    Object.freeze({
      id: "SHIPPING_METHOD_CHANGE_EFFECT",
      title: "shipping choice updates totals/delivery correctly."
    }),
    Object.freeze({
      id: "PAYMENT_METHOD_SELECTION_PERSISTENCE",
      title: "selected payment method is preserved correctly."
    }),
    Object.freeze({
      id: "ORDER_CONFIRMATION_RECORD_CREATION",
      title: "order confirmation corresponds to a real created order."
    }),
    Object.freeze({
      id: "BOOKING_SLOT_RESERVATION_BEHAVIOR",
      title: "selected slot is actually reserved."
    }),
    Object.freeze({
      id: "BOOKING_CONFLICT_HANDLING",
      title: "already-booked slot is handled correctly."
    }),
    Object.freeze({
      id: "CANCELLATION_REFUND_FLOW_BEHAVIOR",
      title: "cancel/refund states update correctly."
    }),
    Object.freeze({
      id: "SUBSCRIPTION_UPGRADE_DOWNGRADE_BEHAVIOR",
      title: "plan changes are applied correctly."
    }),
    Object.freeze({
      id: "TRIAL_EXPIRY_GATE_BEHAVIOR",
      title: "trial-expiry handling is correct."
    }),
    Object.freeze({
      id: "INVOICE_DOWNLOAD_CORRECTNESS",
      title: "invoice/download corresponds to the correct transaction."
    }),
  ]),
  "admin-configuration-settings": Object.freeze([
    Object.freeze({
      id: "SETTINGS_SAVE_PERSISTENCE",
      title: "settings persist after save."
    }),
    Object.freeze({
      id: "SETTINGS_RESET_TO_DEFAULTS_BEHAVIOR",
      title: "reset behaves correctly."
    }),
    Object.freeze({
      id: "FEATURE_FLAG_TOGGLE_EFFECT",
      title: "feature toggle actually affects behavior."
    }),
    Object.freeze({
      id: "CONFIG_DEPENDENCY_RULES",
      title: "related settings enable/disable correctly."
    }),
    Object.freeze({
      id: "AUDIT_LOG_ENTRY_CREATED",
      title: "important admin actions create audit records."
    }),
    Object.freeze({
      id: "DANGEROUS_SETTING_CONFIRMATION_BEHAVIOR",
      title: "risky settings require correct confirmation."
    }),
    Object.freeze({
      id: "API_KEY_CREATE_REVOKE_BEHAVIOR",
      title: "API key lifecycle works correctly."
    }),
    Object.freeze({
      id: "WEBHOOK_CREATE_TEST_DISABLE_BEHAVIOR",
      title: "webhook-management flow works correctly."
    }),
    Object.freeze({
      id: "INVITE_USER_FLOW_BEHAVIOR",
      title: "invite/send/resend/revoke works correctly."
    }),
    Object.freeze({
      id: "TEAM_MEMBER_REMOVE_TRANSFER_BEHAVIOR",
      title: "removing member handles ownership transfer correctly."
    }),
  ]),
  "blocked-unverifiable-handling": Object.freeze([
    Object.freeze({
      id: "BLOCKED_CAPTCHA_REQUIRED_HANDLING",
      title: "CAPTCHA requirement is surfaced correctly."
    }),
    Object.freeze({
      id: "BLOCKED_EXTERNAL_IDP_REQUIRED_HANDLING",
      title: "external IdP dependency is surfaced correctly."
    }),
    Object.freeze({
      id: "BLOCKED_HARD_PHONE_VERIFICATION_HANDLING",
      title: "hard phone-verification requirement is handled."
    }),
    Object.freeze({
      id: "BLOCKED_DEVICE_BINDING_REQUIRED_HANDLING",
      title: "device-binding requirement is surfaced."
    }),
    Object.freeze({
      id: "BLOCKED_ADMIN_APPROVAL_PENDING_HANDLING",
      title: "admin approval dependency is surfaced."
    }),
    Object.freeze({
      id: "BLOCKED_TEST_ENV_DATA_MISMATCH_HANDLING",
      title: "environment-data mismatch is surfaced correctly."
    }),
    Object.freeze({
      id: "BLOCKED_RATE_LIMIT_PREVENTS_CONTINUATION_HANDLING",
      title: "rate-limit blockage is surfaced correctly."
    }),
    Object.freeze({
      id: "BLOCKED_GEO_RESTRICTED_FLOW_HANDLING",
      title: "geo-restricted flow is surfaced correctly."
    }),
  ]),
  "evidence-bug-reporting-failure-capture": Object.freeze([
    Object.freeze({
      id: "VIDEO_EVIDENCE_TRIMMED_TO_FAILURE_WINDOW",
      title: "video evidence is trimmed to the relevant failure window."
    }),
    Object.freeze({
      id: "FAILED_STEP_FIELD_VALUE_STATE_CAPTURE_SAFE",
      title: "failed-step field state is captured safely."
    }),
    Object.freeze({
      id: "REQUEST_RESPONSE_CONTEXT_CAPTURE_SAFE",
      title: "request/response context is captured safely."
    }),
    Object.freeze({
      id: "REPRO_STEP_SEQUENCE_CAPTURE_COMPLETE",
      title: "repro step sequence is complete."
    }),
    Object.freeze({
      id: "FAILURE_BRANCH_DECISION_CAPTURE",
      title: "decision branch leading to failure is captured."
    }),
    Object.freeze({
      id: "MODE_SPECIFIC_FAILURE_SUMMARY_QUALITY",
      title: "failure summary quality is mode-appropriate."
    }),
    Object.freeze({
      id: "BUG_TITLE_GENERATION_QUALITY",
      title: "generated bug titles are useful and specific."
    }),
    Object.freeze({
      id: "BUG_DEDUPLICATION_SIGNAL_QUALITY",
      title: "deduplication signals are high quality."
    }),
    Object.freeze({
      id: "MULTI_DEVICE_FAILURE_ATTRIBUTION_CORRECTNESS",
      title: "cross-device failure attribution is correct."
    }),
    Object.freeze({
      id: "FUNCTIONAL_FAILURE_SEVERITY_CALIBRATION",
      title: "severity is calibrated correctly."
    }),
  ]),
});

const EXPANSION_CHECK_IDS = Object.freeze(
  Object.values(EXPANSION_BY_CATEGORY).flatMap((entries) =>
    entries.map((entry) => entry.id)
  )
);

export const FUNCTIONAL_CHECK_IDS = Object.freeze(
  [...new Set([...LEGACY_CHECK_IDS, ...EXPANSION_CHECK_IDS])]
);

const IMPLEMENTED_SET = new Set(FUNCTIONAL_CHECK_IDS);
const RECOMMENDED_SET = new Set(FUNCTIONAL_RECOMMENDED_CHECK_IDS);

function normalizeChecklistTitle(title = "") {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const withoutPeriod = trimmed.replace(/\.$/u, "");
  return `${withoutPeriod.slice(0, 1).toUpperCase()}${withoutPeriod.slice(1)}`;
}

function createCheckEntry({ id, title = null, source = "expansion" }) {
  const implemented = IMPLEMENTED_SET.has(id);
  const resolvedTitle = normalizeChecklistTitle(title) || formatFunctionalCheckTitle(id);
  return Object.freeze({
    id,
    title: resolvedTitle,
    implementationStatus: implemented ? "implemented" : "planned",
    source,
    selectable: implemented,
    recommended: implemented && RECOMMENDED_SET.has(id),
    plannedReason: null
  });
}

function mergeChecksForCategory(categoryId) {
  const entries = [];
  const seen = new Set();
  for (const checkId of LEGACY_BY_CATEGORY[categoryId] ?? []) {
    if (seen.has(checkId)) continue;
    seen.add(checkId);
    entries.push(createCheckEntry({ id: checkId, source: "legacy" }));
  }
  for (const expansion of EXPANSION_BY_CATEGORY[categoryId] ?? []) {
    if (seen.has(expansion.id)) continue;
    seen.add(expansion.id);
    entries.push(createCheckEntry({ id: expansion.id, title: expansion.title, source: "expansion" }));
  }
  return Object.freeze(entries);
}

export const FUNCTIONAL_CHECK_GROUPS = Object.freeze(
  CATEGORY_DEFINITIONS.map((category) =>
    Object.freeze({
      ...category,
      checks: mergeChecksForCategory(category.id)
    })
  )
);

export const FUNCTIONAL_ALL_CHECK_IDS = Object.freeze(
  FUNCTIONAL_CHECK_GROUPS.flatMap((group) => group.checks.map((check) => check.id))
);
export const FUNCTIONAL_PLANNED_CHECK_IDS = Object.freeze(
  FUNCTIONAL_CHECK_GROUPS.flatMap((group) =>
    group.checks.filter((check) => check.implementationStatus === "planned").map((check) => check.id)
  )
);
export const FUNCTIONAL_EXPANSION_CHECK_IDS = Object.freeze(
  FUNCTIONAL_CHECK_GROUPS.flatMap((group) =>
    group.checks.filter((check) => check.source === "expansion").map((check) => check.id)
  )
);

const CHECK_BY_ID = new Map(
  FUNCTIONAL_CHECK_GROUPS.flatMap((group) => group.checks).map((check) => [check.id, check])
);

export function getFunctionalCheckById(checkId = "") {
  return CHECK_BY_ID.get(String(checkId)) ?? null;
}

export function normalizeFunctionalCheckSelection(selectedChecks = []) {
  const selected = new Set((Array.isArray(selectedChecks) ? selectedChecks : []).map((value) => String(value)));
  return FUNCTIONAL_CHECK_IDS.filter((checkId) => selected.has(checkId));
}

export function listFunctionalCheckGroups({ includePlanned = true } = {}) {
  return FUNCTIONAL_CHECK_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    checks: group.checks.filter((check) => includePlanned || check.implementationStatus === "implemented")
  }));
}

export function getFunctionalChecklistCategoryCounts() {
  return FUNCTIONAL_CHECK_GROUPS.map((group) => {
    const implemented = group.checks.filter((check) => check.implementationStatus === "implemented").length;
    const planned = group.checks.length - implemented;
    return {
      id: group.id,
      title: group.title,
      total: group.checks.length,
      implemented,
      planned
    };
  });
}

export function getRecommendedFunctionalChecks() {
  return FUNCTIONAL_RECOMMENDED_CHECK_IDS.filter((checkId) => IMPLEMENTED_SET.has(checkId));
}
