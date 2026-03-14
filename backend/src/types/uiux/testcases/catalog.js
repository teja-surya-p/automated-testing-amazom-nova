import { baselineUiuxChecks } from "../checks/index.js";
import { defineUiuxTestCase } from "./model.js";

const TESTCASE_METADATA_BY_ID = {
  OVERLAY_BLOCKING: {
    title: "Overlay blocks primary UI",
    category: "visual-layout",
    severity: "P0",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "A modal or overlay blocks key content or actions.",
      whyItMatters: "Users cannot proceed, causing abandonment and flow failures.",
      recommendedFix: [
        "Keep overlays scoped and dismissible.",
        "Avoid covering all primary actions."
      ]
    }
  },
  HORIZONTAL_SCROLL: {
    title: "Horizontal overflow",
    category: "responsive",
    severity: "P1",
    pageScope: "viewport",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "The page width exceeds the current viewport.",
      whyItMatters: "On mobile, users must pan sideways and can miss critical controls.",
      recommendedFix: [
        "Constrain responsive containers and remove fixed-width pressure.",
        "Wrap long tokens and prevent nested components from forcing overflow."
      ]
    }
  },
  CLIPPED_PRIMARY_CTA: {
    title: "Primary CTA clipped",
    category: "visual-layout",
    severity: "P2",
    pageScope: "element",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "A primary action is partially outside visible bounds.",
      whyItMatters: "Users miss key conversion actions.",
      recommendedFix: [
        "Adjust CTA container constraints.",
        "Re-test CTA position at all breakpoints."
      ]
    }
  },
  STUCK_LOADING: {
    title: "Loading state never resolves",
    category: "state",
    severity: "P0",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "network"],
    explanationTemplate: {
      whatHappened: "A loading state remained active past readiness budget.",
      whyItMatters: "Users cannot complete tasks while the page appears hung.",
      recommendedFix: [
        "Add timeout and failure recovery paths.",
        "Ensure loading indicators are cleared reliably."
      ]
    }
  },
  BROKEN_LINK: {
    title: "Broken navigation link",
    category: "navigation",
    severity: "P1",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "network"],
    explanationTemplate: {
      whatHappened: "Navigation resolved to an error page or 4xx/5xx response.",
      whyItMatters: "Broken links interrupt core user journeys.",
      recommendedFix: [
        "Fix route target and redirects.",
        "Add route/link health checks to CI."
      ]
    }
  },
  BROKEN_IMAGE: {
    title: "Broken image asset",
    category: "visual-layout",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "A visible image failed to load or rendered at zero natural size.",
      whyItMatters: "Missing visuals reduce trust and can hide important context.",
      recommendedFix: [
        "Validate image URLs and caching paths.",
        "Provide resilient image fallback states."
      ]
    }
  },
  BROKEN_ICON: {
    title: "Broken icon asset",
    category: "visual-layout",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "A small visible icon-style image failed to load.",
      whyItMatters: "Icon-only actions become ambiguous or unusable.",
      recommendedFix: [
        "Ensure icon assets load consistently.",
        "Provide textual fallback labels for icon actions."
      ]
    }
  },
  BROKEN_PRIMARY_NAV: {
    title: "Primary nav link broken",
    category: "navigation",
    severity: "P1",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "network"],
    explanationTemplate: {
      whatHappened: "A primary header/navigation action resolved to an error response.",
      whyItMatters: "Global navigation reliability is a top-level UX requirement.",
      recommendedFix: [
        "Fix nav routes and backend response mapping.",
        "Monitor nav response status in smoke tests."
      ]
    }
  },
  UNCLICKABLE_VISIBLE_CONTROL: {
    title: "Visible control is obstructed",
    category: "interaction",
    severity: "P1",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "A visible control does not receive pointer hit at center.",
      whyItMatters: "Users perceive broken interactions and cannot progress.",
      recommendedFix: [
        "Fix stacking context or z-index collisions.",
        "Align visual and clickable hit areas."
      ]
    }
  },
  FORM_LABEL_MISSING: {
    title: "Form field label missing",
    category: "form-ui",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "A visible form input has no clear label signal.",
      whyItMatters: "Users cannot reliably understand expected input.",
      recommendedFix: [
        "Add visible label or aria-label.",
        "Keep placeholder as hint, not sole label."
      ]
    }
  },
  TOAST_OR_ERROR_WITHOUT_RECOVERY: {
    title: "Error shown without recovery",
    category: "state",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "An error toast/banner is visible with no retry/close path.",
      whyItMatters: "Users cannot recover after failure states.",
      recommendedFix: [
        "Provide retry or dismiss controls.",
        "Add clear next-step guidance near the error."
      ]
    }
  },
  TEXT_OVERFLOW_CLIP: {
    title: "Text overflow clipping",
    category: "content-presentation",
    severity: "P2",
    pageScope: "element",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "Visible text is clipped due to overflow constraints.",
      whyItMatters: "Labels and messaging become unreadable.",
      recommendedFix: [
        "Allow wrapping or responsive truncation rules.",
        "Increase control width for critical labels."
      ]
    }
  },
  LOCALIZATION_OVERFLOW_HINT: {
    title: "Localization overflow hint",
    category: "content-presentation",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "element",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "Likely localized or formatted text appears clipped in the current viewport.",
      whyItMatters: "Localization overflow can hide critical context such as prices, dates, or action labels.",
      recommendedFix: [
        "Use responsive container rules for localized strings.",
        "Allow text wrapping or adaptive truncation for long locale variants."
      ]
    }
  },
  OVERLAPPING_INTERACTIVE_CONTROLS: {
    title: "Overlapping interactive controls",
    category: "visual-layout",
    severity: "P1",
    pageScope: "element",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Interactive controls overlap in the same viewport region.",
      whyItMatters: "Incorrect hits and accidental taps are likely.",
      recommendedFix: [
        "Increase spacing between controls.",
        "Fix responsive layout breakpoints."
      ]
    }
  },
  OFFSCREEN_PRIMARY_NAV: {
    title: "Primary nav offscreen",
    category: "responsive",
    severity: "P1",
    pageScope: "viewport",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Primary navigation is not reachable in mobile viewport.",
      whyItMatters: "Users lose core wayfinding and navigation.",
      recommendedFix: [
        "Expose a clear visible menu trigger on small screens.",
        "Keep primary nav controls within viewport bounds and avoid clipped header rows."
      ]
    }
  },
  NON_DISMISSABLE_MODAL: {
    title: "Modal cannot be dismissed",
    category: "interaction",
    severity: "P0",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "A blocking modal appears without a dismiss action.",
      whyItMatters: "Users get trapped and cannot proceed safely.",
      recommendedFix: [
        "Add visible close action and keyboard escape behavior.",
        "Avoid hard-blocking modal patterns."
      ]
    }
  },
  DEAD_END_PAGE: {
    title: "Dead-end page",
    category: "navigation",
    severity: "P1",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "No safe visible interaction path is available.",
      whyItMatters: "User flow terminates unexpectedly.",
      recommendedFix: [
        "Expose clear next-step actions.",
        "Add safe navigation exits."
      ]
    }
  },
  FOCUS_VISIBILITY_SMOKE: {
    title: "Focus indicator missing",
    category: "a11y-usability",
    severity: "P2",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "Keyboard focus traversal lacks visible focus indication.",
      whyItMatters: "Keyboard users cannot track current interaction target.",
      recommendedFix: [
        "Define strong :focus-visible styling.",
        "Avoid removing outlines without replacement."
      ]
    }
  },
  EMPTY_STATE_WITHOUT_GUIDANCE: {
    title: "Empty state without guidance",
    category: "state",
    severity: "P2",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "An empty state has no clear next action.",
      whyItMatters: "Users cannot recover from zero-data scenarios.",
      recommendedFix: [
        "Add create/retry/filter-reset guidance.",
        "Provide contextual help links."
      ]
    }
  },
  ERROR_STATE_WITHOUT_ACTION: {
    title: "Error state without action",
    category: "state",
    severity: "P1",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "An error state is visible without recovery controls.",
      whyItMatters: "Failure becomes terminal for users.",
      recommendedFix: [
        "Add retry/back/dismiss options.",
        "Link support or alternate path."
      ]
    }
  },
  SUCCESS_STATE_WITHOUT_NEXT_STEP: {
    title: "Success state missing next step",
    category: "state",
    severity: "P2",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "A success state appears without follow-up guidance.",
      whyItMatters: "Users are unsure what to do after completion.",
      recommendedFix: [
        "Add continue/home/view-details action.",
        "Keep post-success navigation explicit."
      ]
    }
  },
  SUCCESS_STATE_MISSING_CONFIRMATION: {
    title: "Success confirmation missing",
    category: "state",
    severity: "P2",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "A likely successful action did not surface clear confirmation text.",
      whyItMatters: "Users may repeat actions due to uncertainty.",
      recommendedFix: [
        "Show explicit success confirmation near action origin.",
        "Expose stable success state messaging."
      ]
    }
  },
  PAGINATION_WITHOUT_CONTEXT: {
    title: "Pagination lacks context",
    category: "navigation",
    severity: "P2",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Pagination controls appear without page/result context.",
      whyItMatters: "Users cannot estimate position or progress.",
      recommendedFix: [
        "Display page count or result totals near pagination.",
        "Keep current page indicator visible."
      ]
    }
  },
  SEARCH_RESULTS_WITHOUT_FEEDBACK: {
    title: "Search results feedback missing",
    category: "state",
    severity: "P2",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Search results state lacks no-results/refinement feedback.",
      whyItMatters: "Users cannot recover from empty or ambiguous search outcomes.",
      recommendedFix: [
        "Show no-results explanation and refinement tips.",
        "Echo active query prominently."
      ]
    }
  },
  DUPLICATE_PRIMARY_CTA_LABELS: {
    title: "Duplicate CTA labels with different actions",
    category: "cross-page-consistency",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Primary-looking controls share label but map to different actions.",
      whyItMatters: "Users infer incorrect outcomes from repeated labels.",
      recommendedFix: [
        "Disambiguate CTA labels.",
        "Align label semantics to destination intent."
      ]
    }
  },
  VISUAL_STABILITY_SHIFT_SMOKE: {
    title: "Visible layout instability",
    category: "visual-layout",
    severity: "P1",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Key anchors shifted after ready state without user action.",
      whyItMatters: "Unexpected movement causes misclicks and loss of orientation.",
      recommendedFix: [
        "Reserve stable space for dynamic content.",
        "Delay rendering until layout-critical data is ready."
      ]
    }
  },
  INCONSISTENT_PRIMARY_NAV: {
    title: "Inconsistent primary navigation",
    category: "cross-page-consistency",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "cross-page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Primary nav labels differ unexpectedly across similar pages.",
      whyItMatters: "Navigation inconsistency reduces trust and wayfinding speed.",
      recommendedFix: [
        "Standardize nav configuration by page type.",
        "Enforce nav schema consistency checks."
      ]
    }
  },
  MISSING_PAGE_HEADING: {
    title: "Primary page heading missing",
    category: "content-presentation",
    severity: "P2",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "A content page lacks an obvious primary heading.",
      whyItMatters: "Users lose context about page purpose.",
      recommendedFix: [
        "Add a clear H1/main heading.",
        "Align heading hierarchy across templates."
      ]
    }
  },
  SEARCH_BAR_INCONSISTENT: {
    title: "Search bar inconsistency",
    category: "cross-page-consistency",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "cross-page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Search bar presence changed unexpectedly across similar pages.",
      whyItMatters: "Users cannot rely on stable search affordances.",
      recommendedFix: [
        "Standardize search bar inclusion rules.",
        "Avoid page-type drift in shared headers."
      ]
    }
  },
  DUPLICATE_BRAND_HEADER: {
    title: "Duplicate brand header",
    category: "cross-page-consistency",
    severity: "P1",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Multiple header/banners appear stacked or overlapping.",
      whyItMatters: "Critical viewport area is wasted and navigation is confused.",
      recommendedFix: [
        "Prevent duplicate mount of header shell.",
        "Guard SPA hydration/rerender path for layout chrome."
      ]
    }
  },
  CTA_PRIORITY_CONFLICT: {
    title: "CTA priority conflict",
    category: "content-presentation",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Top fold presents multiple competing primary CTAs.",
      whyItMatters: "Users face decision friction and lower conversion confidence.",
      recommendedFix: [
        "Promote one dominant CTA per state.",
        "Demote secondary actions visually."
      ]
    }
  },
  STICKY_OVERLAY_HIDES_CONTENT: {
    title: "Sticky/fixed overlay hides important content",
    category: "visual-layout",
    severity: "P1",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "A repeated covering layer obscures multiple key controls.",
      whyItMatters: "Important content is visible but not actionable.",
      recommendedFix: [
        "Reduce sticky overlay footprint.",
        "Reflow top fold content under sticky bars safely."
      ]
    }
  },
  SEVERE_ALIGNMENT_BREAK: {
    title: "Severe alignment inconsistency",
    category: "visual-layout",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Responsive layout blocks drift out of alignment on compact viewport.",
      whyItMatters: "Users struggle to scan sections and interactive controls when structure collapses.",
      recommendedFix: [
        "Align stacked mobile sections to a consistent content lane.",
        "Fix breakpoint-specific spacing and collision issues for adjacent blocks."
      ]
    }
  },
  INTERACTIVE_NO_OP: {
    title: "Interactive element appears to do nothing",
    category: "interaction",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "An interaction completed but the visible state did not change.",
      whyItMatters: "Users cannot trust that actions are processed.",
      recommendedFix: [
        "Provide visible state change or feedback after actions.",
        "Avoid inert clickable affordances."
      ]
    }
  },
  NAVIGATION_TRAP_PATTERN: {
    title: "Navigation trap pattern",
    category: "navigation",
    severity: "P1",
    pageScope: "cross-page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "network"],
    explanationTemplate: {
      whatHappened: "Recent navigation cycles between a tiny set of URLs.",
      whyItMatters: "Users may be trapped in loops and cannot reach destination content.",
      recommendedFix: [
        "Fix redirect/back-forward loop logic.",
        "Provide deterministic exits from gated routes."
      ]
    }
  },
  TOUCH_HOVER_ONLY_CRITICAL_ACTION: {
    title: "Critical action likely hover-only on touch",
    category: "interaction",
    severity: "P1",
    judgmentPolicy: "advisory",
    pageScope: "viewport",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "On touch viewport, critical action appears unavailable while desktop equivalent is visible.",
      whyItMatters: "Touch users cannot access key actions that desktop users can.",
      recommendedFix: [
        "Expose touch-equivalent controls without hover dependency.",
        "Validate parity across mobile and desktop interaction models."
      ]
    }
  },
  DISABLED_SUBMIT_NO_EXPLANATION: {
    title: "Disabled submit with no explanation",
    category: "form-ui",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "A submit control is disabled without nearby explanatory guidance.",
      whyItMatters: "Users do not know how to unblock form submission.",
      recommendedFix: [
        "Show clear validation prerequisites near submit.",
        "Expose inline hints for blocked submit state."
      ]
    }
  },
  FIELD_ERROR_NOT_VISIBLE: {
    title: "Field error state not visible",
    category: "form-ui",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "A field appears invalid without visible error association.",
      whyItMatters: "Users cannot identify which field needs correction.",
      recommendedFix: [
        "Render clear inline error next to invalid field.",
        "Associate error text with field via aria-describedby."
      ]
    }
  },
  PARTIAL_RENDER_SILENT_FAILURE: {
    title: "Partial render with silent failure",
    category: "state",
    severity: "P1",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "network"],
    explanationTemplate: {
      whatHappened: "Main content region appears missing while no explicit error UI is shown.",
      whyItMatters: "Users face blank/partial screens without actionable feedback.",
      recommendedFix: [
        "Detect missing critical regions and show explicit fallback errors.",
        "Add render-complete checks for key page sections."
      ]
    }
  },
  CONSENT_BANNER_BLOCKING_TASK: {
    title: "Consent/legal overlay blocks core task",
    category: "trust-conversion",
    severity: "P1",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "dom"],
    explanationTemplate: {
      whatHappened: "A consent or legal overlay blocks meaningful task interactions.",
      whyItMatters: "Compliance UI should not trap users before core actions.",
      recommendedFix: [
        "Reduce overlay footprint and ensure easy dismissal.",
        "Keep primary actions visible and reachable."
      ]
    }
  },
  ABOVE_FOLD_OVERLOAD: {
    title: "Above-the-fold overload",
    category: "clarity",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "viewport",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Too many competing controls or overlays appear in first viewport.",
      whyItMatters: "Users struggle to identify the main next action.",
      recommendedFix: [
        "Reduce first-screen message and CTA count.",
        "Promote one primary action above the fold."
      ]
    }
  },
  CONTENT_SCANNABILITY_POOR: {
    title: "Content scannability is weak",
    category: "content-presentation",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "viewport",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Long content appears with insufficient heading structure.",
      whyItMatters: "Users scan before reading deeply and can miss key information.",
      recommendedFix: [
        "Break long text with clear headings and lists.",
        "Highlight key details near the top."
      ]
    }
  },
  REQUIRED_OPTIONAL_UNCLEAR: {
    title: "Required vs optional field status unclear",
    category: "form-ui",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "A required field lacks explicit required signaling.",
      whyItMatters: "Users cannot predict validation requirements before submit.",
      recommendedFix: [
        "Mark required fields explicitly in labels and ARIA.",
        "Use consistent required indicators across forms."
      ]
    }
  },
  INPUT_FORMAT_HELP_MISSING: {
    title: "Input format guidance missing",
    category: "form-ui",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Constrained input appears without format guidance.",
      whyItMatters: "Users are forced into trial-and-error validation loops.",
      recommendedFix: [
        "Provide examples or helper text before submission.",
        "Expose accepted format near the field."
      ]
    }
  },
  TOUCH_TARGET_TOO_SMALL: {
    title: "Touch target too small",
    category: "responsive",
    severity: "P1",
    pageScope: "element",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "A mobile/tablet control has undersized tap area.",
      whyItMatters: "Small targets cause mistaps and failed task completion.",
      recommendedFix: [
        "Increase target hit area on touch viewports.",
        "Maintain minimum interactive target dimensions."
      ]
    }
  },
  GENERIC_ACTION_LABELS: {
    title: "Action labels are generic",
    category: "content-presentation",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Action text is generic and does not communicate outcome.",
      whyItMatters: "Vague labels increase hesitation and reduce conversion confidence.",
      recommendedFix: [
        "Replace generic labels with outcome-specific wording.",
        "Differentiate primary and secondary action intent."
      ]
    }
  },
  IMAGE_MISSING_ALT_UIUX: {
    title: "Informative image missing alt text",
    category: "a11y-usability",
    severity: "P2",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "A visible informative image appears to have empty alt text.",
      whyItMatters: "Assistive technology users miss equivalent visual context.",
      recommendedFix: [
        "Add concise alt text for informative visuals.",
        "Keep decorative assets explicitly marked as decorative."
      ]
    }
  },
  HEADING_ORDER_SUSPICIOUS_UIUX: {
    title: "Heading order is suspicious",
    category: "a11y-usability",
    severity: "P2",
    judgmentPolicy: "advisory",
    pageScope: "page",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "Heading structure skips expected level progression.",
      whyItMatters: "Poor structure harms scanning and assistive navigation.",
      recommendedFix: [
        "Maintain progressive heading hierarchy.",
        "Avoid level jumps unless semantically required."
      ]
    }
  },
  INTERACTIVE_NAME_MISSING_UIUX: {
    title: "Interactive control missing name",
    category: "a11y-usability",
    severity: "P1",
    pageScope: "element",
    deviceScope: "single-viewport",
    evidenceRequirements: ["screenshot", "a11y"],
    explanationTemplate: {
      whatHappened: "A visible interactive control has no meaningful label.",
      whyItMatters: "Users cannot identify the action purpose reliably.",
      recommendedFix: [
        "Add visible text or aria-label.",
        "Avoid unlabeled icon-only controls for critical actions."
      ]
    }
  },
  MEDIA_SCALING_BROKEN: {
    title: "Media scaling breaks layout",
    category: "responsive",
    severity: "P1",
    pageScope: "element",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Visible media overflows or clips outside viewport bounds.",
      whyItMatters: "Overflowing media can hide content, clip controls, and break responsive flow on phones.",
      recommendedFix: [
        "Apply mobile-safe max-width constraints to media containers.",
        "Preserve aspect ratio while preventing media from exceeding viewport width."
      ]
    }
  },
  TABLE_CHART_MOBILE_USABILITY: {
    title: "Dense data display not usable on mobile",
    category: "responsive",
    severity: "P1",
    pageScope: "viewport",
    deviceScope: "multi-viewport",
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: "Table/chart regions require excessive horizontal panning on smaller viewports.",
      whyItMatters: "Users lose context and cannot interpret key data comfortably on mobile.",
      recommendedFix: [
        "Convert dense tables into stacked cards or compact row summaries on small screens.",
        "Keep labels/headers visible and avoid forcing excessive side-scroll to read core data."
      ]
    }
  }
};

function defaultMetadataFor(check) {
  return {
    title: check?.id ?? "UIUX_CHECK",
    category: "general",
    severity: "P2",
    judgmentPolicy: "hard-fail",
    pageScope: "page",
    deviceScope: "single-viewport",
    detector: check.run,
    evidenceRequirements: ["screenshot"],
    explanationTemplate: {
      whatHappened: `${check?.id ?? "UI issue"} was detected.`,
      whyItMatters: "This can impact usability and reliability.",
      recommendedFix: ["Inspect the affected selector and viewport behavior."]
    }
  };
}

export function buildUiuxTestCaseCatalog(checks = baselineUiuxChecks) {
  return checks.map((check) => {
    const metadata = TESTCASE_METADATA_BY_ID[check.id] ?? {};
    const merged = {
      ...defaultMetadataFor(check),
      ...metadata,
      id: check.id,
      detector: check.run
    };
    return defineUiuxTestCase(merged);
  });
}

export const uiuxTestCaseCatalog = buildUiuxTestCaseCatalog();
