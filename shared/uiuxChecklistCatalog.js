function titleCaseToken(token = '') {
  const upper = token.toUpperCase();
  if (upper === 'UIUX') return 'UI/UX';
  if (upper === 'CTA') return 'CTA';
  if (upper === 'IOS') return 'iOS';
  if (upper === 'API') return 'API';
  if (upper === 'URL') return 'URL';
  if (upper === 'NAV') return 'Nav';
  if (upper === 'OTP') return 'OTP';
  return `${token.slice(0, 1).toUpperCase()}${token.slice(1).toLowerCase()}`;
}

export function formatUiuxCheckTitle(checkId = '') {
  return String(checkId)
    .split('_')
    .filter(Boolean)
    .map((token) => titleCaseToken(token))
    .join(' ')
    .trim();
}

const CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "layout-spacing-structure",
    title: "Layout, spacing, and structure",
    description: "Structural rhythm, spacing integrity, and viewport-fit layout quality."
  }),
  Object.freeze({
    id: "responsive-mobile-specific-behavior",
    title: "Responsive and mobile-specific behavior",
    description: "Mobile-only breakpoints, orientation, viewport chrome, and small-screen interaction behavior."
  }),
  Object.freeze({
    id: "navigation-clarity-wayfinding",
    title: "Navigation clarity and wayfinding",
    description: "Wayfinding, active-state clarity, hierarchy, and recovery navigation cues."
  }),
  Object.freeze({
    id: "buttons-controls-interaction-affordance",
    title: "Buttons, controls, and interaction affordance",
    description: "Control discoverability, affordance quality, and reliable interaction feedback."
  }),
  Object.freeze({
    id: "form-ux-data-entry",
    title: "Form UX and data entry",
    description: "Field guidance, validation flow clarity, and mobile form usability quality."
  }),
  Object.freeze({
    id: "search-filter-sort-dense-data",
    title: "Search, filter, sort, and dense data",
    description: "Search/result context, filtering, sorting, and dense-data interaction clarity."
  }),
  Object.freeze({
    id: "tables-charts-data-visualization",
    title: "Tables, charts, and data visualization",
    description: "Mobile interpretability and context preservation for tables/charts and dense data visuals."
  }),
  Object.freeze({
    id: "states-system-feedback-recovery",
    title: "States, system feedback, and recovery",
    description: "Loading, success/error, offline/session, and recovery-state communication quality."
  }),
  Object.freeze({
    id: "content-clarity-hierarchy-readability",
    title: "Content clarity, hierarchy, and readability",
    description: "Readability, hierarchy, scannability, and action-copy clarity."
  }),
  Object.freeze({
    id: "modals-drawers-sheets-overlays",
    title: "Modals, drawers, sheets, and overlays",
    description: "Overlay layering, dismissal clarity, and modal/sheet context quality."
  }),
  Object.freeze({
    id: "commerce-critical-conversion-flows",
    title: "Commerce and critical conversion flows",
    description: "Conversion and high-risk action clarity in pricing, checkout, and irreversible flows."
  }),
  Object.freeze({
    id: "accessibility-adjacent-ux-checks",
    title: "Accessibility-adjacent UX checks",
    description: "UX-impacting accessibility-adjacent signals tracked under UI/UX mode."
  }),
]);

const IMPLEMENTED_BY_CATEGORY = Object.freeze({
  "layout-spacing-structure": Object.freeze([
    "OVERLAY_BLOCKING",
    "ABOVE_FOLD_OVERLOAD",
    "CLIPPED_PRIMARY_CTA",
    "BROKEN_IMAGE",
    "BROKEN_ICON",
    "STICKY_OVERLAY_HIDES_CONTENT",
    "SEVERE_ALIGNMENT_BREAK",
    "OVERLAPPING_INTERACTIVE_CONTROLS",
    "VISUAL_STABILITY_SHIFT_SMOKE",
    "DUPLICATE_BRAND_HEADER",
  ]),
  "responsive-mobile-specific-behavior": Object.freeze([
    "HORIZONTAL_SCROLL",
    "TOUCH_TARGET_TOO_SMALL",
    "TEXT_OVERFLOW_CLIP",
    "LOCALIZATION_OVERFLOW_HINT",
    "MEDIA_SCALING_BROKEN",
    "OFFSCREEN_PRIMARY_NAV",
  ]),
  "navigation-clarity-wayfinding": Object.freeze([
    "BROKEN_LINK",
    "BROKEN_PRIMARY_NAV",
    "NAVIGATION_TRAP_PATTERN",
    "DEAD_END_PAGE",
    "PAGINATION_WITHOUT_CONTEXT",
    "INCONSISTENT_PRIMARY_NAV",
    "MISSING_PAGE_HEADING",
  ]),
  "buttons-controls-interaction-affordance": Object.freeze([
    "UNCLICKABLE_VISIBLE_CONTROL",
    "INTERACTIVE_NO_OP",
    "TOUCH_HOVER_ONLY_CRITICAL_ACTION",
    "DUPLICATE_PRIMARY_CTA_LABELS",
  ]),
  "form-ux-data-entry": Object.freeze([
    "FORM_LABEL_MISSING",
    "REQUIRED_OPTIONAL_UNCLEAR",
    "INPUT_FORMAT_HELP_MISSING",
    "DISABLED_SUBMIT_NO_EXPLANATION",
    "FIELD_ERROR_NOT_VISIBLE",
  ]),
  "search-filter-sort-dense-data": Object.freeze([
    "SEARCH_RESULTS_WITHOUT_FEEDBACK",
    "SEARCH_BAR_INCONSISTENT",
  ]),
  "tables-charts-data-visualization": Object.freeze([
    "TABLE_CHART_MOBILE_USABILITY",
  ]),
  "states-system-feedback-recovery": Object.freeze([
    "STUCK_LOADING",
    "TOAST_OR_ERROR_WITHOUT_RECOVERY",
    "EMPTY_STATE_WITHOUT_GUIDANCE",
    "ERROR_STATE_WITHOUT_ACTION",
    "SUCCESS_STATE_WITHOUT_NEXT_STEP",
    "SUCCESS_STATE_MISSING_CONFIRMATION",
    "PARTIAL_RENDER_SILENT_FAILURE",
  ]),
  "content-clarity-hierarchy-readability": Object.freeze([
    "CONTENT_SCANNABILITY_POOR",
    "GENERIC_ACTION_LABELS",
  ]),
  "modals-drawers-sheets-overlays": Object.freeze([
    "CONSENT_BANNER_BLOCKING_TASK",
    "NON_DISMISSABLE_MODAL",
  ]),
  "commerce-critical-conversion-flows": Object.freeze([
    "CTA_PRIORITY_CONFLICT",
  ]),
  "accessibility-adjacent-ux-checks": Object.freeze([
    "IMAGE_MISSING_ALT_UIUX",
    "HEADING_ORDER_SUSPICIOUS_UIUX",
    "INTERACTIVE_NAME_MISSING_UIUX",
    "FOCUS_VISIBILITY_SMOKE",
  ]),
});

const EXPANSION_BY_CATEGORY = Object.freeze({
  "layout-spacing-structure": Object.freeze([
    Object.freeze({
      id: "BROKEN_GRID_RHYTHM",
      title: "Cards or sections stop following a consistent grid rhythm"
    }),
    Object.freeze({
      id: "INCONSISTENT_SPACING_SCALE",
      title: "Spacing system breaks across similar components"
    }),
    Object.freeze({
      id: "SECTION_PADDING_COLLAPSE",
      title: "Section or container padding disappears or becomes uneven"
    }),
    Object.freeze({
      id: "CONTENT_EDGE_PRESSURE_MOBILE",
      title: "Content sits too close to screen edges on mobile"
    }),
    Object.freeze({
      id: "CROPPED_SECTION_CONTENT",
      title: "Whole section content gets cut, not just text"
    }),
    Object.freeze({
      id: "VIEWPORT_HEIGHT_CUT_OFF_MOBILE",
      title: "Content or actions are clipped because of bad viewport-height handling"
    }),
    Object.freeze({
      id: "SAFE_AREA_NOT_RESPECTED_MOBILE",
      title: "Notch or home-indicator safe areas are ignored"
    }),
    Object.freeze({
      id: "Z_INDEX_STACKING_ORDER_BROKEN",
      title: "Layering order is wrong even without a direct overlap collision"
    }),
    Object.freeze({
      id: "FLOATING_ACTION_OVERLAPS_CORE_CONTENT",
      title: "Floating action button or element hides important content"
    }),
    Object.freeze({
      id: "STICKY_HEADER_TOO_TALL_MOBILE",
      title: "Sticky header consumes too much of the mobile viewport"
    }),
    Object.freeze({
      id: "BOTTOM_BAR_BLOCKS_PRIMARY_ACTION",
      title: "Sticky bottom bar hides CTA or core form controls"
    }),
    Object.freeze({
      id: "NESTED_SCROLL_REGION_TRAP",
      title: "Nested scroll areas trap the user or split reading flow badly"
    }),
    Object.freeze({
      id: "SECTION_VISUAL_GROUPING_WEAK",
      title: "Related content is not visually grouped clearly"
    }),
    Object.freeze({
      id: "READING_LINE_LENGTH_POOR",
      title: "Paragraph width is too wide or too narrow for comfortable reading"
    }),
    Object.freeze({
      id: "SECTION_DENSITY_IMBALANCED",
      title: "One section is too cramped or too sparse compared with surrounding sections"
    }),
  ]),
  "responsive-mobile-specific-behavior": Object.freeze([
    Object.freeze({
      id: "ORIENTATION_CHANGE_LAYOUT_BREAK",
      title: "Portrait/landscape switch breaks layout"
    }),
    Object.freeze({
      id: "KEYBOARD_OVERLAPS_ACTIVE_FIELD",
      title: "Mobile keyboard covers the active field"
    }),
    Object.freeze({
      id: "ADDRESS_BAR_COLLAPSE_LAYOUT_JUMP",
      title: "Mobile browser chrome changes cause visible layout jump"
    }),
    Object.freeze({
      id: "BOTTOM_NAV_SAFE_AREA_CLIP",
      title: "Bottom navigation clips against modern phone safe areas"
    }),
    Object.freeze({
      id: "IOS_100VH_LAYOUT_BUG",
      title: "Classic mobile Safari viewport-height issue is visible"
    }),
    Object.freeze({
      id: "MOBILE_MENU_STATE_RESET_BUG",
      title: "Mobile menu resets or closes unexpectedly on navigation"
    }),
    Object.freeze({
      id: "STICKY_FILTER_BAR_OVERCONSUMES_VIEWPORT",
      title: "Filter bar takes too much vertical space on mobile"
    }),
    Object.freeze({
      id: "MOBILE_SHEET_HEIGHT_BROKEN",
      title: "Drawer or bottom-sheet height is clearly broken"
    }),
    Object.freeze({
      id: "HORIZONTAL_GESTURE_CONFLICT",
      title: "Carousel/swipe zones fight with normal page scroll"
    }),
    Object.freeze({
      id: "PULL_TO_REFRESH_CONFLICT_UIUX",
      title: "Browser refresh gesture interferes with intended interaction"
    }),
    Object.freeze({
      id: "BACK_GESTURE_FLOW_BREAK",
      title: "Mobile back gesture leads to broken or confusing state"
    }),
    Object.freeze({
      id: "MOBILE_TAB_BAR_WRAP_BREAK",
      title: "Tab navigation wraps or clips badly on small screens"
    }),
  ]),
  "navigation-clarity-wayfinding": Object.freeze([
    Object.freeze({
      id: "ACTIVE_NAV_STATE_MISSING",
      title: "Current navigation item is not clearly indicated"
    }),
    Object.freeze({
      id: "CURRENT_PAGE_CONTEXT_MISSING",
      title: "User cannot tell where they are in the product"
    }),
    Object.freeze({
      id: "BREADCRUMB_MISSING_OR_BROKEN",
      title: "Breadcrumb is absent or misleading"
    }),
    Object.freeze({
      id: "LOGO_HOME_LINK_MISSING",
      title: "Logo is expected to go home but does not"
    }),
    Object.freeze({
      id: "FOOTER_NAV_INCONSISTENT",
      title: "Footer links differ unexpectedly from header/navigation structure"
    }),
    Object.freeze({
      id: "IN_PAGE_ANCHOR_OFFSET_BROKEN",
      title: "Anchored section is hidden under sticky header"
    }),
    Object.freeze({
      id: "BACK_TO_TOP_MISSING_LONG_PAGE",
      title: "Long pages lack easy recovery navigation"
    }),
    Object.freeze({
      id: "WIZARD_STEP_CONTEXT_MISSING",
      title: "Multi-step flow lacks clear step context"
    }),
    Object.freeze({
      id: "STEP_PROGRESS_NOT_VISIBLE",
      title: "Process progress is not visible in guided flows"
    }),
    Object.freeze({
      id: "OPEN_IN_NEW_TAB_UNANNOUNCED_UIUX",
      title: "Links unexpectedly open a new tab or window"
    }),
    Object.freeze({
      id: "TAB_STATE_NOT_CLEAR",
      title: "Active vs inactive tabs are not visually clear"
    }),
    Object.freeze({
      id: "ACCORDION_STATE_NOT_CLEAR",
      title: "Expanded and collapsed state is not obvious"
    }),
    Object.freeze({
      id: "NAV_GROUP_HIERARCHY_CONFUSING",
      title: "Primary and secondary navigation are not visually distinct"
    }),
  ]),
  "buttons-controls-interaction-affordance": Object.freeze([
    Object.freeze({
      id: "CLICK_TARGETS_TOO_CLOSE",
      title: "Controls are not overlapping, but too close to tap safely"
    }),
    Object.freeze({
      id: "DOUBLE_CLICK_REQUIRED_UNINTENTIONALLY",
      title: "Control requires repeated click/tap unintentionally"
    }),
    Object.freeze({
      id: "TOOLTIP_ONLY_CRITICAL_INFO",
      title: "Important meaning exists only in a tooltip"
    }),
    Object.freeze({
      id: "POPOVER_POSITIONING_BROKEN",
      title: "Popover/menu renders detached or badly positioned"
    }),
    Object.freeze({
      id: "DROPDOWN_DISMISS_BEHAVIOR_BROKEN",
      title: "Dropdown cannot be dismissed naturally"
    }),
    Object.freeze({
      id: "CAROUSEL_CONTROLS_CONFUSING",
      title: "Carousel dots/arrows are unclear or weak"
    }),
    Object.freeze({
      id: "AUTO_ROTATING_CAROUSEL_DISTRACTING",
      title: "Auto-rotating carousel harms usability"
    }),
    Object.freeze({
      id: "CARD_CLICKABILITY_AMBIGUOUS",
      title: "User cannot tell whether a card is clickable"
    }),
    Object.freeze({
      id: "ICON_ONLY_ACTION_UNCLEAR",
      title: "Icon-only action lacks enough meaning"
    }),
    Object.freeze({
      id: "CONTROL_STATE_FEEDBACK_WEAK",
      title: "Hover, press, selected, or disabled states are too subtle"
    }),
    Object.freeze({
      id: "SCROLL_JACKING_BEHAVIOR",
      title: "Custom scroll behavior feels broken or traps the user"
    }),
    Object.freeze({
      id: "DRAG_SCROLL_CONFLICT",
      title: "Draggable area interferes with expected scrolling"
    }),
    Object.freeze({
      id: "CONTEXT_ACTION_DISCOVERABILITY_POOR",
      title: "Contextual actions are too hard to find"
    }),
  ]),
  "form-ux-data-entry": Object.freeze([
    Object.freeze({
      id: "PLACEHOLDER_AS_LABEL_ONLY",
      title: "Placeholder is used as the only field label"
    }),
    Object.freeze({
      id: "INLINE_HELP_TEXT_AMBIGUOUS",
      title: "Help text exists but is unclear or unhelpful"
    }),
    Object.freeze({
      id: "AUTOCOMPLETE_HINT_MISSING_UIUX",
      title: "Missing useful field hints hurts entry flow"
    }),
    Object.freeze({
      id: "KEYBOARD_TYPE_MISMATCH_MOBILE",
      title: "Wrong mobile keyboard appears for the input type"
    }),
    Object.freeze({
      id: "FIELD_GROUPING_UNCLEAR",
      title: "Related form inputs are not visually grouped"
    }),
    Object.freeze({
      id: "PASSWORD_RULES_NOT_VISIBLE",
      title: "Password rules are hidden until failure"
    }),
    Object.freeze({
      id: "PASSWORD_STRENGTH_FEEDBACK_CONFUSING",
      title: "Strength indicator is unclear or noisy"
    }),
    Object.freeze({
      id: "CONFIRM_PASSWORD_FEEDBACK_POOR",
      title: "Mismatch handling is weak or confusing"
    }),
    Object.freeze({
      id: "ERROR_SUMMARY_MISSING_LONG_FORM",
      title: "Large forms lack a top-level error summary"
    }),
    Object.freeze({
      id: "FIRST_ERROR_NOT_BROUGHT_INTO_VIEW",
      title: "User is not guided to the first invalid field"
    }),
    Object.freeze({
      id: "FORM_PROGRESS_LOSS_ON_VALIDATION",
      title: "Validation clears or disrupts other completed work"
    }),
    Object.freeze({
      id: "INPUT_MASK_USABILITY_POOR",
      title: "Input mask makes typing harder than necessary"
    }),
    Object.freeze({
      id: "MULTI_SELECT_USABILITY_POOR",
      title: "Multi-select control is hard to understand or use"
    }),
    Object.freeze({
      id: "CHIP_INPUT_WRAP_BREAKS_LAYOUT",
      title: "Tag/chip input overflows or collapses badly"
    }),
    Object.freeze({
      id: "RADIO_CHECKBOX_GROUP_ALIGNMENT_POOR",
      title: "Selection groups are misaligned and hard to scan"
    }),
    Object.freeze({
      id: "DATE_PICKER_MOBILE_USABILITY_POOR",
      title: "Date entry works badly on mobile"
    }),
    Object.freeze({
      id: "FILE_UPLOAD_STATUS_UNCLEAR",
      title: "Upload progress or result is not clear"
    }),
    Object.freeze({
      id: "AUTOSAVE_STATUS_UNCLEAR",
      title: "User cannot tell whether changes were saved"
    }),
  ]),
  "search-filter-sort-dense-data": Object.freeze([
    Object.freeze({
      id: "FILTER_APPLIED_STATE_HIDDEN",
      title: "Active filters are not clearly visible"
    }),
    Object.freeze({
      id: "FILTER_CHIPS_NOT_CLEARABLE",
      title: "Filter chips are shown but hard to remove"
    }),
    Object.freeze({
      id: "FILTER_RESULT_COUNT_MISSING",
      title: "No clear result count after filtering"
    }),
    Object.freeze({
      id: "SORT_STATE_NOT_VISIBLE",
      title: "Current sort order is not visible"
    }),
    Object.freeze({
      id: "SORT_FILTER_INTERACTION_CONFLICT",
      title: "Sort/filter interaction produces confusion"
    }),
    Object.freeze({
      id: "FACET_PANEL_MOBILE_USABILITY_POOR",
      title: "Faceted filter panel works badly on mobile"
    }),
    Object.freeze({
      id: "SEARCH_SUGGESTION_PANEL_OVERFLOW",
      title: "Autosuggest panel clips or overflows"
    }),
    Object.freeze({
      id: "NO_MATCH_HIGHLIGHT_MISSING",
      title: "Results do not explain what matched"
    }),
    Object.freeze({
      id: "BULK_SELECTION_STATE_UNCLEAR",
      title: "Selected rows/items are not obvious"
    }),
    Object.freeze({
      id: "DENSE_TABLE_ROW_SCANNABILITY_POOR",
      title: "Rows are too dense to scan comfortably"
    }),
    Object.freeze({
      id: "COLUMN_PRIORITY_NOT_REDUCED_ON_MOBILE",
      title: "Too many columns remain visible on phone"
    }),
    Object.freeze({
      id: "STICKY_COLUMN_OVERLAP_MOBILE",
      title: "Sticky columns break small-screen table UX"
    }),
    Object.freeze({
      id: "COMPARISON_VIEW_TOO_WIDE_MOBILE",
      title: "Comparison layout is not mobile-adapted"
    }),
    Object.freeze({
      id: "EXPORT_ACTION_PLACEMENT_POOR",
      title: "Export/download action is badly placed in data view"
    }),
    Object.freeze({
      id: "KPI_PRIORITY_UNCLEAR",
      title: "Metric cards compete with no clear hierarchy"
    }),
  ]),
  "tables-charts-data-visualization": Object.freeze([
    Object.freeze({
      id: "TABLE_HEADER_CONTEXT_LOSS_MOBILE",
      title: "Mobile table loses the meaning of row values when headers are off-screen"
    }),
    Object.freeze({
      id: "TABLE_SCROLL_ONLY_NO_MOBILE_RESTRUCTURE",
      title: "Table is merely scrollable and not truly mobile-friendly"
    }),
    Object.freeze({
      id: "TABLE_ROW_TO_CARD_TRANSFORMATION_MISSING",
      title: "Expected stacked-card transformation is missing"
    }),
    Object.freeze({
      id: "TABLE_FIXED_MIN_WIDTH_BREAK",
      title: "Rigid table width creates layout pressure or overflow"
    }),
    Object.freeze({
      id: "CHART_LEGEND_WRAP_BREAK",
      title: "Chart legend wraps badly or overlaps the plot"
    }),
    Object.freeze({
      id: "CHART_AXIS_LABEL_CLIP",
      title: "Axis labels are clipped on small screens"
    }),
    Object.freeze({
      id: "CHART_SERIES_DIFFERENTIATION_WEAK",
      title: "Series are not visually distinct enough"
    }),
    Object.freeze({
      id: "CHART_TOOLTIP_DEPENDENCY_TOO_HIGH",
      title: "Chart is unusable without precise hover/tooltip access"
    }),
    Object.freeze({
      id: "DATA_VIZ_SUMMARY_CONTEXT_MISSING",
      title: "Chart/table lacks a short readable summary on mobile"
    }),
    Object.freeze({
      id: "SCROLLABLE_DATA_REGION_WITHOUT_CUE",
      title: "User is not told that the region is horizontally scrollable"
    }),
    Object.freeze({
      id: "HEATMAP_OR_MATRIX_MOBILE_UNUSABLE",
      title: "Dense matrix visualization is unreadable on phone"
    }),
    Object.freeze({
      id: "SPARKLINE_CONTEXT_MISSING",
      title: "Mini-chart appears without enough scale or context"
    }),
  ]),
  "states-system-feedback-recovery": Object.freeze([
    Object.freeze({
      id: "SKELETON_LAYOUT_MISMATCH",
      title: "Skeleton state does not resemble final layout"
    }),
    Object.freeze({
      id: "PROCESSING_STATE_WITHOUT_PROGRESS",
      title: "Action runs without useful progress indication"
    }),
    Object.freeze({
      id: "LONG_TASK_WITHOUT_EXPECTATION_SETTING",
      title: "Long wait gives no guidance or expectation"
    }),
    Object.freeze({
      id: "SAVE_SUCCESS_DISAPPEARS_TOO_FAST",
      title: "Success confirmation vanishes before user can perceive it"
    }),
    Object.freeze({
      id: "UNSAVED_CHANGES_STATUS_UNCLEAR",
      title: "User cannot tell whether edits are pending"
    }),
    Object.freeze({
      id: "OFFLINE_STATE_NOT_HANDLED_UIUX",
      title: "Offline or disconnected state is not explained clearly"
    }),
    Object.freeze({
      id: "RECONNECT_STATE_CONFUSING",
      title: "Reconnect flow is unclear or silent"
    }),
    Object.freeze({
      id: "SESSION_TIMEOUT_WARNING_MISSING",
      title: "Session expires without adequate warning"
    }),
    Object.freeze({
      id: "STALE_DATA_INDICATOR_MISSING",
      title: "Outdated data is shown with no freshness cue"
    }),
    Object.freeze({
      id: "PERMISSION_DENIED_EXPLANATION_POOR",
      title: "Permission error lacks useful next steps"
    }),
    Object.freeze({
      id: "EMPTY_FILTER_RESULTS_WITHOUT_RESET",
      title: "Empty filter state lacks a reset path"
    }),
    Object.freeze({
      id: "NO_RESULTS_QUERY_NOT_ECHOED",
      title: "Empty search state does not restate the query"
    }),
    Object.freeze({
      id: "404_RECOVERY_POOR",
      title: "Not-found page lacks useful recovery actions"
    }),
    Object.freeze({
      id: "MAINTENANCE_STATE_WITHOUT_GUIDANCE",
      title: "Maintenance/outage message is not actionable"
    }),
  ]),
  "content-clarity-hierarchy-readability": Object.freeze([
    Object.freeze({
      id: "SECTION_PURPOSE_UNCLEAR",
      title: "Section exists but its purpose is not obvious"
    }),
    Object.freeze({
      id: "MICROCOPY_INCONSISTENT",
      title: "Labels and action copy are inconsistent across similar flows"
    }),
    Object.freeze({
      id: "UNIT_OR_CURRENCY_CONTEXT_MISSING",
      title: "Values appear without units or currency context"
    }),
    Object.freeze({
      id: "DATE_TIME_CONTEXT_MISSING",
      title: "Timezone or date/time format context is missing"
    }),
    Object.freeze({
      id: "ABBREVIATION_UNEXPLAINED",
      title: "Abbreviations reduce usability because they are unexplained"
    }),
    Object.freeze({
      id: "BADGE_MEANING_UNCLEAR",
      title: "Badge/chip meaning is unclear without extra context"
    }),
    Object.freeze({
      id: "VISUAL_HIERARCHY_WEAK",
      title: "Heading/action/content emphasis is too weak"
    }),
    Object.freeze({
      id: "PRIMARY_ACTION_TOO_FAR_BELOW_FOLD",
      title: "Main task is buried too low on the page"
    }),
    Object.freeze({
      id: "TRUST_SIGNAL_PLACEMENT_POOR",
      title: "Trust/security/help information is too hidden in a critical step"
    }),
    Object.freeze({
      id: "LINK_STYLE_INCONSISTENT",
      title: "Some links do not look like links"
    }),
    Object.freeze({
      id: "VISITED_LINK_STATE_MISSING",
      title: "Content-heavy pages lack useful visited-link distinction"
    }),
    Object.freeze({
      id: "CTA_COPY_TOO_VAGUE",
      title: "Action text is too vague to inspire confidence"
    }),
    Object.freeze({
      id: "SUPPORTING_COPY_TOO_DENSE",
      title: "Important explanatory text is too dense"
    }),
    Object.freeze({
      id: "META_INFORMATION_TRUNCATED_WITHOUT_EXPANSION",
      title: "Meta/details are clipped with no expansion path"
    }),
  ]),
  "modals-drawers-sheets-overlays": Object.freeze([
    Object.freeze({
      id: "MODAL_SCROLL_LOCK_BROKEN",
      title: "Background/page scroll behavior breaks while modal is open"
    }),
    Object.freeze({
      id: "DRAWER_FOCUS_CONTEXT_POOR",
      title: "Drawer opens without enough orientation context"
    }),
    Object.freeze({
      id: "BOTTOM_SHEET_CONTENT_CUTOFF",
      title: "Bottom-sheet content is clipped or hidden"
    }),
    Object.freeze({
      id: "SHEET_DISMISS_AFFORDANCE_WEAK",
      title: "Dismiss affordance is weak or unclear"
    }),
    Object.freeze({
      id: "MULTI_LAYER_OVERLAY_CONFUSION",
      title: "Nested overlays become hard to understand"
    }),
    Object.freeze({
      id: "INLINE_CONFIRMATION_REPLACES_CONTEXT_POORLY",
      title: "Confirmation UI removes too much useful prior context"
    }),
    Object.freeze({
      id: "POPOVER_CLIPPED_BY_CONTAINER",
      title: "Floating UI is clipped by an overflow container"
    }),
    Object.freeze({
      id: "TOAST_STACK_COVERS_CORE_UI",
      title: "Stacked toasts hide important controls or content"
    }),
  ]),
  "commerce-critical-conversion-flows": Object.freeze([
    Object.freeze({
      id: "PRICE_SUMMARY_VISIBILITY_POOR",
      title: "Totals/pricing summary is too hidden"
    }),
    Object.freeze({
      id: "TOTALS_UPDATE_FEEDBACK_MISSING",
      title: "Totals update silently after user actions"
    }),
    Object.freeze({
      id: "CHECKOUT_STEP_ORDER_CONFUSING",
      title: "Checkout or conversion flow order is unclear"
    }),
    Object.freeze({
      id: "PROMO_CODE_FLOW_CONFUSING",
      title: "Promo code entry disrupts the checkout flow"
    }),
    Object.freeze({
      id: "CRITICAL_POLICY_INFO_HIDDEN",
      title: "Refund/shipping/terms info is buried"
    }),
    Object.freeze({
      id: "DELETE_OR_DESTRUCTIVE_CONFIRMATION_COPY_AMBIGUOUS",
      title: "Destructive confirmation wording is unclear"
    }),
    Object.freeze({
      id: "FINAL_ACTION_RISK_NOT_EXPLAINED",
      title: "Irreversible action risk is not explained"
    }),
    Object.freeze({
      id: "SURPRISE_ACCOUNT_REQUIREMENT",
      title: "Account requirement appears too late in the journey"
    }),
    Object.freeze({
      id: "PAYMENT_METHOD_SWITCHING_CLARITY_POOR",
      title: "Multiple payment choices are not clearly handled"
    }),
    Object.freeze({
      id: "ADDRESS_OR_SHIPPING_FORM_DENSITY_POOR",
      title: "Checkout address/shipping forms are too dense on mobile"
    }),
  ]),
  "accessibility-adjacent-ux-checks": Object.freeze([
    Object.freeze({
      id: "COLOR_ONLY_STATUS_DISTINCTION",
      title: "Status meaning is conveyed only by color"
    }),
    Object.freeze({
      id: "PLACEHOLDER_CONTRAST_USABILITY_POOR",
      title: "Placeholder text is too faint to be useful"
    }),
    Object.freeze({
      id: "FOCUS_ORDER_CONTEXT_CONFUSING_UIUX",
      title: "Keyboard progression feels illogical from a UX standpoint"
    }),
    Object.freeze({
      id: "KEYBOARD_TRAP_RISK_UIUX",
      title: "User appears visually trapped inside a widget/modal"
    }),
    Object.freeze({
      id: "REDUCED_MOTION_RESPECT_MISSING_UIUX",
      title: "Motion-heavy UI ignores calmer mode expectations"
    }),
    Object.freeze({
      id: "TEXT_RESIZE_LAYOUT_BREAK_UIUX",
      title: "Moderate text scaling breaks the layout"
    }),
    Object.freeze({
      id: "SCREEN_READER_LABEL_COPY_MISMATCH_UIUX",
      title: "Visible and programmatic labels conflict badly"
    }),
    Object.freeze({
      id: "STATUS_MESSAGE_NOT_VISUALLY_ASSOCIATED",
      title: "Success/error text appears too far from the related control"
    }),
  ]),
});

const FIRST_WAVE_REASONS = Object.freeze({
  TABLE_SCROLL_ONLY_NO_MOBILE_RESTRUCTURE: "Catches mobile tables that are only made horizontally scrollable instead of being genuinely usable",
  TABLE_HEADER_CONTEXT_LOSS_MOBILE: "Flags tables where row values lose meaning once headers disappear off-screen",
  COLUMN_PRIORITY_NOT_REDUCED_ON_MOBILE: "Targets dense data views that keep too many columns visible on phones",
  VIEWPORT_HEIGHT_CUT_OFF_MOBILE: "Catches mobile layouts that hide content/actions due to bad 100vh handling",
  KEYBOARD_OVERLAPS_ACTIVE_FIELD: "Important for form usability on small screens",
  ACTIVE_NAV_STATE_MISSING: "Improves wayfinding and navigation clarity",
  PLACEHOLDER_AS_LABEL_ONLY: "Common UX failure in forms; also affects usability and accessibility-adjacent UX",
  PASSWORD_RULES_NOT_VISIBLE: "High-value form guidance check for auth/sign-up flows",
  FILTER_APPLIED_STATE_HIDDEN: "Important in search/filter results experiences",
  PROCESSING_STATE_WITHOUT_PROGRESS: "Catches broken or unclear long-running action states",
  VISUAL_HIERARCHY_WEAK: "Useful for pages where action priority and reading order are unclear",
  MODAL_SCROLL_LOCK_BROKEN: "Common mobile/web app issue that makes overlays feel broken",
});

const UIUX_BASELINE_CHECK_IDS = Object.freeze([
  "OVERLAY_BLOCKING",
  "CONSENT_BANNER_BLOCKING_TASK",
  "ABOVE_FOLD_OVERLOAD",
  "CONTENT_SCANNABILITY_POOR",
  "HORIZONTAL_SCROLL",
  "CLIPPED_PRIMARY_CTA",
  "STUCK_LOADING",
  "BROKEN_LINK",
  "BROKEN_IMAGE",
  "IMAGE_MISSING_ALT_UIUX",
  "BROKEN_ICON",
  "BROKEN_PRIMARY_NAV",
  "UNCLICKABLE_VISIBLE_CONTROL",
  "TOUCH_TARGET_TOO_SMALL",
  "STICKY_OVERLAY_HIDES_CONTENT",
  "SEVERE_ALIGNMENT_BREAK",
  "INTERACTIVE_NO_OP",
  "NAVIGATION_TRAP_PATTERN",
  "TOUCH_HOVER_ONLY_CRITICAL_ACTION",
  "FORM_LABEL_MISSING",
  "REQUIRED_OPTIONAL_UNCLEAR",
  "INPUT_FORMAT_HELP_MISSING",
  "DISABLED_SUBMIT_NO_EXPLANATION",
  "FIELD_ERROR_NOT_VISIBLE",
  "INTERACTIVE_NAME_MISSING_UIUX",
  "GENERIC_ACTION_LABELS",
  "HEADING_ORDER_SUSPICIOUS_UIUX",
  "TOAST_OR_ERROR_WITHOUT_RECOVERY",
  "TEXT_OVERFLOW_CLIP",
  "LOCALIZATION_OVERFLOW_HINT",
  "MEDIA_SCALING_BROKEN",
  "TABLE_CHART_MOBILE_USABILITY",
  "OVERLAPPING_INTERACTIVE_CONTROLS",
  "OFFSCREEN_PRIMARY_NAV",
  "NON_DISMISSABLE_MODAL",
  "DEAD_END_PAGE",
  "FOCUS_VISIBILITY_SMOKE",
  "EMPTY_STATE_WITHOUT_GUIDANCE",
  "ERROR_STATE_WITHOUT_ACTION",
  "SUCCESS_STATE_WITHOUT_NEXT_STEP",
  "SUCCESS_STATE_MISSING_CONFIRMATION",
  "PARTIAL_RENDER_SILENT_FAILURE",
  "PAGINATION_WITHOUT_CONTEXT",
  "SEARCH_RESULTS_WITHOUT_FEEDBACK",
  "DUPLICATE_PRIMARY_CTA_LABELS",
  "VISUAL_STABILITY_SHIFT_SMOKE",
  "INCONSISTENT_PRIMARY_NAV",
  "MISSING_PAGE_HEADING",
  "SEARCH_BAR_INCONSISTENT",
  "DUPLICATE_BRAND_HEADER",
  "CTA_PRIORITY_CONFLICT",
]);

const UIUX_EXPANSION_SOURCE_IDS = Object.freeze(
  Object.values(EXPANSION_BY_CATEGORY).flatMap((entries) =>
    entries.map((entry) => entry.id)
  )
);

export const UIUX_CHECK_IDS = Object.freeze(
  [...new Set([...UIUX_BASELINE_CHECK_IDS, ...UIUX_EXPANSION_SOURCE_IDS])]
);

export const UIUX_RECOMMENDED_CHECK_IDS = Object.freeze([
  "OVERLAY_BLOCKING",
  "HORIZONTAL_SCROLL",
  "CLIPPED_PRIMARY_CTA",
  "STUCK_LOADING",
  "BROKEN_LINK",
  "BROKEN_IMAGE",
  "BROKEN_PRIMARY_NAV",
  "UNCLICKABLE_VISIBLE_CONTROL",
  "STICKY_OVERLAY_HIDES_CONTENT",
  "FORM_LABEL_MISSING",
  "DISABLED_SUBMIT_NO_EXPLANATION",
  "FIELD_ERROR_NOT_VISIBLE",
  "TEXT_OVERFLOW_CLIP",
  "OVERLAPPING_INTERACTIVE_CONTROLS",
  "OFFSCREEN_PRIMARY_NAV",
  "NON_DISMISSABLE_MODAL",
  "DEAD_END_PAGE",
  "EMPTY_STATE_WITHOUT_GUIDANCE",
  "ERROR_STATE_WITHOUT_ACTION",
  "SUCCESS_STATE_MISSING_CONFIRMATION",
  "PARTIAL_RENDER_SILENT_FAILURE",
  "MISSING_PAGE_HEADING",
  "CTA_PRIORITY_CONFLICT",
]);

const IMPLEMENTED_SET = new Set(UIUX_CHECK_IDS);
const RECOMMENDED_SET = new Set(UIUX_RECOMMENDED_CHECK_IDS);
const FIRST_WAVE_SET = new Set(Object.keys(FIRST_WAVE_REASONS));

function createCheckEntry({ id, title = null, source = "baseline" }) {
  const implemented = IMPLEMENTED_SET.has(id);
  const resolvedTitle = String(title ?? "").trim() || formatUiuxCheckTitle(id);
  const plannedReason = implemented ? null : FIRST_WAVE_REASONS[id] ?? null;
  return Object.freeze({
    id,
    title: resolvedTitle,
    implementationStatus: implemented ? "implemented" : "planned",
    source,
    selectable: implemented,
    recommended: implemented && RECOMMENDED_SET.has(id),
    firstWavePriority: FIRST_WAVE_SET.has(id),
    plannedReason
  });
}

function mergeChecksForCategory(categoryId) {
  const entries = [];
  const seen = new Set();
  for (const checkId of IMPLEMENTED_BY_CATEGORY[categoryId] ?? []) {
    if (seen.has(checkId)) continue;
    seen.add(checkId);
    entries.push(createCheckEntry({ id: checkId, source: "baseline" }));
  }
  for (const expansion of EXPANSION_BY_CATEGORY[categoryId] ?? []) {
    if (seen.has(expansion.id)) continue;
    seen.add(expansion.id);
    entries.push(createCheckEntry({ id: expansion.id, title: expansion.title, source: "expansion" }));
  }
  return Object.freeze(entries);
}

export const UIUX_CHECK_GROUPS = Object.freeze(
  CATEGORY_DEFINITIONS.map((category) =>
    Object.freeze({
      ...category,
      checks: mergeChecksForCategory(category.id)
    })
  )
);

export const UIUX_ALL_CHECK_IDS = Object.freeze(
  UIUX_CHECK_GROUPS.flatMap((group) => group.checks.map((check) => check.id))
);
export const UIUX_PLANNED_CHECK_IDS = Object.freeze(
  UIUX_CHECK_GROUPS.flatMap((group) =>
    group.checks.filter((check) => check.implementationStatus === "planned").map((check) => check.id)
  )
);
export const UIUX_EXPANSION_CHECK_IDS = Object.freeze(
  UIUX_CHECK_GROUPS.flatMap((group) =>
    group.checks.filter((check) => check.source === "expansion").map((check) => check.id)
  )
);

const CHECK_BY_ID = new Map(
  UIUX_CHECK_GROUPS.flatMap((group) => group.checks).map((check) => [check.id, check])
);

export function getUiuxCheckById(checkId = "") {
  return CHECK_BY_ID.get(String(checkId)) ?? null;
}

export function normalizeUiuxCheckSelection(selectedChecks = []) {
  const selected = new Set((Array.isArray(selectedChecks) ? selectedChecks : []).map((value) => String(value)));
  return UIUX_CHECK_IDS.filter((checkId) => selected.has(checkId));
}

export function listUiuxCheckGroups({ includePlanned = true } = {}) {
  return UIUX_CHECK_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    checks: group.checks.filter((check) => includePlanned || check.implementationStatus === "implemented")
  }));
}

export function getUiuxChecklistCategoryCounts() {
  return UIUX_CHECK_GROUPS.map((group) => {
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

export function getRecommendedUiuxChecks() {
  return UIUX_RECOMMENDED_CHECK_IDS.filter((checkId) => IMPLEMENTED_SET.has(checkId));
}
