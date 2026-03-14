const AUTOMATION_MODE = Object.freeze({
  AUTOMATED: "automated",
  ADVISORY: "advisory",
  MANUAL: "manual"
});

function defineHandbookCheck({
  id,
  title,
  section,
  automation = AUTOMATION_MODE.AUTOMATED,
  mappedIssueTypes = []
}) {
  return Object.freeze({
    id,
    title,
    section,
    automation,
    mappedIssueTypes: [...new Set((mappedIssueTypes ?? []).filter(Boolean))]
  });
}

export const uiuxHandbookChecks = Object.freeze([
  defineHandbookCheck({
    id: "UI-001",
    title: "Homepage purpose is understandable in 5 seconds",
    section: "clarity-first-impression",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["MISSING_PAGE_HEADING", "ABOVE_FOLD_OVERLOAD", "PARTIAL_RENDER_SILENT_FAILURE"]
  }),
  defineHandbookCheck({
    id: "UI-002",
    title: "Primary call to action is obvious",
    section: "clarity-first-impression",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["CTA_PRIORITY_CONFLICT", "CLIPPED_PRIMARY_CTA", "TOUCH_HOVER_ONLY_CRITICAL_ACTION"]
  }),
  defineHandbookCheck({
    id: "UI-003",
    title: "Headline communicates value, not just style",
    section: "clarity-first-impression",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-004",
    title: "Above-the-fold section avoids overload",
    section: "clarity-first-impression",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: [
      "ABOVE_FOLD_OVERLOAD",
      "OVERLAY_BLOCKING",
      "STICKY_OVERLAY_HIDES_CONTENT",
      "CTA_PRIORITY_CONFLICT"
    ]
  }),
  defineHandbookCheck({
    id: "UI-005",
    title: "Visual cues match business goal",
    section: "clarity-first-impression",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-006",
    title: "Main navigation labels are clear",
    section: "information-architecture-navigation",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["INCONSISTENT_PRIMARY_NAV", "GENERIC_ACTION_LABELS"]
  }),
  defineHandbookCheck({
    id: "UI-007",
    title: "Users can tell where they are",
    section: "information-architecture-navigation",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["MISSING_PAGE_HEADING", "INCONSISTENT_PRIMARY_NAV", "NAVIGATION_TRAP_PATTERN"]
  }),
  defineHandbookCheck({
    id: "UI-008",
    title: "Important pages are reachable within few steps",
    section: "information-architecture-navigation",
    mappedIssueTypes: ["DEAD_END_PAGE", "NAVIGATION_TRAP_PATTERN", "BROKEN_PRIMARY_NAV", "BROKEN_LINK"]
  }),
  defineHandbookCheck({
    id: "UI-009",
    title: "Mobile navigation is usable",
    section: "information-architecture-navigation",
    mappedIssueTypes: ["OFFSCREEN_PRIMARY_NAV", "NON_DISMISSABLE_MODAL", "TOUCH_TARGET_TOO_SMALL"]
  }),
  defineHandbookCheck({
    id: "UI-010",
    title: "Search works when search is important",
    section: "information-architecture-navigation",
    mappedIssueTypes: ["SEARCH_RESULTS_WITHOUT_FEEDBACK", "BROKEN_LINK"]
  }),
  defineHandbookCheck({
    id: "UI-011",
    title: "Page hierarchy guides the eye correctly",
    section: "visual-hierarchy-layout-consistency",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["CTA_PRIORITY_CONFLICT", "ABOVE_FOLD_OVERLOAD"]
  }),
  defineHandbookCheck({
    id: "UI-012",
    title: "Spacing is consistent and intentional",
    section: "visual-hierarchy-layout-consistency",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["SEVERE_ALIGNMENT_BREAK", "OVERLAPPING_INTERACTIVE_CONTROLS"]
  }),
  defineHandbookCheck({
    id: "UI-013",
    title: "Grid and alignment are clean",
    section: "visual-hierarchy-layout-consistency",
    mappedIssueTypes: ["SEVERE_ALIGNMENT_BREAK", "OVERLAPPING_INTERACTIVE_CONTROLS"]
  }),
  defineHandbookCheck({
    id: "UI-014",
    title: "Typography supports readability",
    section: "visual-hierarchy-layout-consistency",
    mappedIssueTypes: ["TEXT_OVERFLOW_CLIP", "HORIZONTAL_SCROLL", "LOCALIZATION_OVERFLOW_HINT"]
  }),
  defineHandbookCheck({
    id: "UI-015",
    title: "Reusable components stay consistent",
    section: "visual-hierarchy-layout-consistency",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["INCONSISTENT_PRIMARY_NAV", "DUPLICATE_PRIMARY_CTA_LABELS", "DUPLICATE_BRAND_HEADER"]
  }),
  defineHandbookCheck({
    id: "UI-016",
    title: "Content is scannable",
    section: "content-readability",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["CONTENT_SCANNABILITY_POOR", "MISSING_PAGE_HEADING"]
  }),
  defineHandbookCheck({
    id: "UI-017",
    title: "Labels and button text are specific",
    section: "content-readability",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["GENERIC_ACTION_LABELS"]
  }),
  defineHandbookCheck({
    id: "UI-018",
    title: "Important info is not hidden in long paragraphs",
    section: "content-readability",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-019",
    title: "Tone matches audience and context",
    section: "content-readability",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-020",
    title: "Empty states explain what to do next",
    section: "content-readability",
    mappedIssueTypes: ["EMPTY_STATE_WITHOUT_GUIDANCE", "SEARCH_RESULTS_WITHOUT_FEEDBACK"]
  }),
  defineHandbookCheck({
    id: "UI-021",
    title: "Every form field has a clear label",
    section: "forms-input",
    mappedIssueTypes: ["FORM_LABEL_MISSING"]
  }),
  defineHandbookCheck({
    id: "UI-022",
    title: "Required vs optional fields are explicit",
    section: "forms-input",
    mappedIssueTypes: ["REQUIRED_OPTIONAL_UNCLEAR"]
  }),
  defineHandbookCheck({
    id: "UI-023",
    title: "Validation messages are useful",
    section: "forms-input",
    mappedIssueTypes: [
      "FIELD_ERROR_NOT_VISIBLE",
      "ERROR_STATE_WITHOUT_ACTION",
      "TOAST_OR_ERROR_WITHOUT_RECOVERY"
    ]
  }),
  defineHandbookCheck({
    id: "UI-024",
    title: "Input format help is available",
    section: "forms-input",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["INPUT_FORMAT_HELP_MISSING"]
  }),
  defineHandbookCheck({
    id: "UI-025",
    title: "Form submission feedback is clear",
    section: "forms-input",
    mappedIssueTypes: ["SUCCESS_STATE_MISSING_CONFIRMATION", "SUCCESS_STATE_WITHOUT_NEXT_STEP", "STUCK_LOADING"]
  }),
  defineHandbookCheck({
    id: "UI-026",
    title: "Keyboard-only form use is possible",
    section: "forms-input",
    mappedIssueTypes: ["FOCUS_VISIBILITY_SMOKE", "UNCLICKABLE_VISIBLE_CONTROL", "TOUCH_TARGET_TOO_SMALL"]
  }),
  defineHandbookCheck({
    id: "UI-027",
    title: "Clickable elements look clickable",
    section: "interaction-feedback",
    mappedIssueTypes: ["UNCLICKABLE_VISIBLE_CONTROL", "INTERACTIVE_NAME_MISSING_UIUX", "TOUCH_TARGET_TOO_SMALL"]
  }),
  defineHandbookCheck({
    id: "UI-028",
    title: "Hover, focus, and pressed states exist",
    section: "interaction-feedback",
    mappedIssueTypes: ["FOCUS_VISIBILITY_SMOKE", "UNCLICKABLE_VISIBLE_CONTROL"]
  }),
  defineHandbookCheck({
    id: "UI-029",
    title: "Loading states reduce uncertainty",
    section: "interaction-feedback",
    mappedIssueTypes: ["STUCK_LOADING", "PARTIAL_RENDER_SILENT_FAILURE"]
  }),
  defineHandbookCheck({
    id: "UI-030",
    title: "Success states confirm completion",
    section: "interaction-feedback",
    mappedIssueTypes: ["SUCCESS_STATE_MISSING_CONFIRMATION", "SUCCESS_STATE_WITHOUT_NEXT_STEP"]
  }),
  defineHandbookCheck({
    id: "UI-031",
    title: "Error states do not trap the user",
    section: "interaction-feedback",
    mappedIssueTypes: ["ERROR_STATE_WITHOUT_ACTION", "TOAST_OR_ERROR_WITHOUT_RECOVERY", "NON_DISMISSABLE_MODAL"]
  }),
  defineHandbookCheck({
    id: "UI-032",
    title: "Text contrast is sufficient",
    section: "accessibility",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-033",
    title: "Focus indicator is visible",
    section: "accessibility",
    mappedIssueTypes: ["FOCUS_VISIBILITY_SMOKE"]
  }),
  defineHandbookCheck({
    id: "UI-034",
    title: "Images have meaningful alternative text where needed",
    section: "accessibility",
    mappedIssueTypes: ["IMAGE_MISSING_ALT_UIUX"]
  }),
  defineHandbookCheck({
    id: "UI-035",
    title: "Headings follow logical structure",
    section: "accessibility",
    mappedIssueTypes: ["HEADING_ORDER_SUSPICIOUS_UIUX", "MISSING_PAGE_HEADING"]
  }),
  defineHandbookCheck({
    id: "UI-036",
    title: "Interactive controls have accessible names",
    section: "accessibility",
    mappedIssueTypes: ["INTERACTIVE_NAME_MISSING_UIUX"]
  }),
  defineHandbookCheck({
    id: "UI-037",
    title: "Zoom and text resizing do not break layout",
    section: "accessibility",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-038",
    title: "No horizontal scroll on standard mobile pages",
    section: "responsive-cross-device",
    mappedIssueTypes: ["HORIZONTAL_SCROLL"]
  }),
  defineHandbookCheck({
    id: "UI-039",
    title: "Touch targets are large enough",
    section: "responsive-cross-device",
    mappedIssueTypes: ["TOUCH_TARGET_TOO_SMALL"]
  }),
  defineHandbookCheck({
    id: "UI-040",
    title: "Responsive layout keeps priority content first",
    section: "responsive-cross-device",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["CLIPPED_PRIMARY_CTA", "TOUCH_HOVER_ONLY_CRITICAL_ACTION", "OFFSCREEN_PRIMARY_NAV"]
  }),
  defineHandbookCheck({
    id: "UI-041",
    title: "Media scales correctly",
    section: "responsive-cross-device",
    mappedIssueTypes: ["MEDIA_SCALING_BROKEN", "HORIZONTAL_SCROLL"]
  }),
  defineHandbookCheck({
    id: "UI-042",
    title: "Sticky elements do not block content",
    section: "responsive-cross-device",
    mappedIssueTypes: ["STICKY_OVERLAY_HIDES_CONTENT", "OVERLAY_BLOCKING"]
  }),
  defineHandbookCheck({
    id: "UI-043",
    title: "The site looks trustworthy",
    section: "trust-credibility-conversion",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-044",
    title: "Important business information is easy to find",
    section: "trust-credibility-conversion",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-045",
    title: "Social proof is believable and relevant",
    section: "trust-credibility-conversion",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-046",
    title: "Conversion path has low friction",
    section: "trust-credibility-conversion",
    mappedIssueTypes: ["DEAD_END_PAGE", "DISABLED_SUBMIT_NO_EXPLANATION", "NAVIGATION_TRAP_PATTERN"]
  }),
  defineHandbookCheck({
    id: "UI-047",
    title: "Interruptive elements are controlled",
    section: "trust-credibility-conversion",
    mappedIssueTypes: ["OVERLAY_BLOCKING", "NON_DISMISSABLE_MODAL", "CONSENT_BANNER_BLOCKING_TASK"]
  }),
  defineHandbookCheck({
    id: "UI-048",
    title: "Page feels fast enough for the task",
    section: "performance-perception",
    mappedIssueTypes: ["STUCK_LOADING"]
  }),
  defineHandbookCheck({
    id: "UI-049",
    title: "Layout shift is controlled",
    section: "performance-perception",
    mappedIssueTypes: ["VISUAL_STABILITY_SHIFT_SMOKE"]
  }),
  defineHandbookCheck({
    id: "UI-050",
    title: "Heavy media does not delay key actions",
    section: "performance-perception",
    mappedIssueTypes: ["STUCK_LOADING", "PARTIAL_RENDER_SILENT_FAILURE", "MEDIA_SCALING_BROKEN"]
  }),
  defineHandbookCheck({
    id: "UI-051",
    title: "Repeated actions feel smooth",
    section: "performance-perception",
    mappedIssueTypes: ["INTERACTIVE_NO_OP"]
  }),
  defineHandbookCheck({
    id: "UI-052",
    title: "No-result states are helpful",
    section: "edge-case-resilience",
    mappedIssueTypes: ["SEARCH_RESULTS_WITHOUT_FEEDBACK", "EMPTY_STATE_WITHOUT_GUIDANCE"]
  }),
  defineHandbookCheck({
    id: "UI-053",
    title: "Long content does not break components",
    section: "edge-case-resilience",
    mappedIssueTypes: ["TEXT_OVERFLOW_CLIP", "LOCALIZATION_OVERFLOW_HINT", "OVERLAPPING_INTERACTIVE_CONTROLS"]
  }),
  defineHandbookCheck({
    id: "UI-054",
    title: "Slow network or delayed response is handled gracefully",
    section: "edge-case-resilience",
    mappedIssueTypes: ["STUCK_LOADING", "ERROR_STATE_WITHOUT_ACTION"]
  }),
  defineHandbookCheck({
    id: "UI-055",
    title: "Session interruptions are understandable",
    section: "edge-case-resilience",
    mappedIssueTypes: ["ERROR_STATE_WITHOUT_ACTION", "TOAST_OR_ERROR_WITHOUT_RECOVERY"]
  }),
  defineHandbookCheck({
    id: "UI-056",
    title: "Unsaved work is protected when relevant",
    section: "edge-case-resilience",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-057",
    title: "Dashboard prioritizes important information",
    section: "product-specific-dashboards",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["ABOVE_FOLD_OVERLOAD", "CTA_PRIORITY_CONFLICT", "DEAD_END_PAGE"]
  }),
  defineHandbookCheck({
    id: "UI-058",
    title: "Data tables are readable and usable",
    section: "product-specific-dashboards",
    mappedIssueTypes: ["TABLE_CHART_MOBILE_USABILITY", "PAGINATION_WITHOUT_CONTEXT", "SEARCH_RESULTS_WITHOUT_FEEDBACK"]
  }),
  defineHandbookCheck({
    id: "UI-059",
    title: "Settings pages explain consequences",
    section: "product-specific-dashboards",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-060",
    title: "Permissions and disabled states are explained",
    section: "product-specific-dashboards",
    mappedIssueTypes: ["DISABLED_SUBMIT_NO_EXPLANATION"]
  }),
  defineHandbookCheck({
    id: "UI-061",
    title: "Critical pages work across browser engines",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-062",
    title: "Native controls and text rendering stay usable across OS/browser combinations",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-063",
    title: "Orientation changes do not break layout",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-064",
    title: "Safe areas, notches, and browser chrome do not cover key UI",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["STICKY_OVERLAY_HIDES_CONTENT", "CLIPPED_PRIMARY_CTA", "OVERLAY_BLOCKING"]
  }),
  defineHandbookCheck({
    id: "UI-065",
    title: "Soft keyboard does not block focused fields or submit controls",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-066",
    title: "Viewport-height usage behaves correctly on mobile",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["CLIPPED_PRIMARY_CTA", "STICKY_OVERLAY_HIDES_CONTENT"]
  }),
  defineHandbookCheck({
    id: "UI-067",
    title: "Images and icons stay sharp on high-density screens",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-068",
    title: "Reduced-motion preference is respected when motion is heavy",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-069",
    title: "Dark mode or alternate theme stays visually consistent if supported",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-070",
    title: "Autofill and password manager flows work cleanly",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-071",
    title: "Back and forward browser navigation preserve expected context",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["NAVIGATION_TRAP_PATTERN", "INTERACTIVE_NO_OP"]
  }),
  defineHandbookCheck({
    id: "UI-072",
    title: "Refresh and deep links preserve or recover state properly",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["NAVIGATION_TRAP_PATTERN", "BROKEN_LINK", "PARTIAL_RENDER_SILENT_FAILURE"]
  }),
  defineHandbookCheck({
    id: "UI-073",
    title: "Search, filter, and sort state is stable",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["SEARCH_RESULTS_WITHOUT_FEEDBACK", "PAGINATION_WITHOUT_CONTEXT", "INTERACTIVE_NO_OP"]
  }),
  defineHandbookCheck({
    id: "UI-074",
    title: "Pagination or infinite scroll is recoverable",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["NAVIGATION_TRAP_PATTERN", "DEAD_END_PAGE", "PAGINATION_WITHOUT_CONTEXT"]
  }),
  defineHandbookCheck({
    id: "UI-075",
    title: "Session timeout is explained before work is lost",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-076",
    title: "Network interruption recovery is understandable",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["ERROR_STATE_WITHOUT_ACTION", "TOAST_OR_ERROR_WITHOUT_RECOVERY", "STUCK_LOADING"]
  }),
  defineHandbookCheck({
    id: "UI-077",
    title: "New-user empty states teach the first action",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["EMPTY_STATE_WITHOUT_GUIDANCE"]
  }),
  defineHandbookCheck({
    id: "UI-078",
    title: "Returning users can resume interrupted work",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.ADVISORY,
    mappedIssueTypes: ["SUCCESS_STATE_WITHOUT_NEXT_STEP", "INTERACTIVE_NO_OP"]
  }),
  defineHandbookCheck({
    id: "UI-079",
    title: "Destructive actions are safe and reversible where reasonable",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-080",
    title: "Toasts, alerts, and banners do not hide key controls",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["TOAST_OR_ERROR_WITHOUT_RECOVERY", "STICKY_OVERLAY_HIDES_CONTENT"]
  }),
  defineHandbookCheck({
    id: "UI-081",
    title: "File upload flows handle progress, type errors, and retry",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-082",
    title: "Date and time selection works across devices and locales",
    section: "advanced-cross-browser-state",
    automation: AUTOMATION_MODE.MANUAL
  }),
  defineHandbookCheck({
    id: "UI-083",
    title: "Long text, translated text, and user-generated content do not break layout",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["LOCALIZATION_OVERFLOW_HINT", "TEXT_OVERFLOW_CLIP"]
  }),
  defineHandbookCheck({
    id: "UI-084",
    title: "Data tables and charts remain usable on smaller screens",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["TABLE_CHART_MOBILE_USABILITY", "HORIZONTAL_SCROLL"]
  }),
  defineHandbookCheck({
    id: "UI-085",
    title: "Consent, cookie, and legal banners do not block the core task",
    section: "advanced-cross-browser-state",
    mappedIssueTypes: ["CONSENT_BANNER_BLOCKING_TASK", "OVERLAY_BLOCKING", "NON_DISMISSABLE_MODAL"]
  })
]);

export function getUiuxHandbookCheckById(checkId) {
  return uiuxHandbookChecks.find((entry) => entry.id === checkId) ?? null;
}

export { AUTOMATION_MODE as uiuxHandbookAutomationMode };
