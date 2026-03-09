import test from "node:test";
import assert from "node:assert/strict";

import {
  brokenIconCheck,
  brokenImageCheck,
  brokenPrimaryNavCheck,
  ctaPriorityConflictCheck,
  deadEndPageCheck,
  disabledSubmitNoExplanationCheck,
  duplicatePrimaryCtaLabelsCheck,
  duplicateBrandHeaderCheck,
  emptyStateWithoutGuidanceCheck,
  errorStateWithoutActionCheck,
  fieldErrorNotVisibleCheck,
  focusVisibilitySmokeCheck,
  formLabelMissingCheck,
  interactiveNoOpCheck,
  inconsistentPrimaryNavCheck,
  localizationOverflowHintCheck,
  missingPageHeadingCheck,
  navigationTrapPatternCheck,
  nonDismissableModalCheck,
  offscreenPrimaryNavCheck,
  overlappingInteractiveControlsCheck,
  paginationWithoutContextCheck,
  partialRenderSilentFailureCheck,
  severeAlignmentBreakCheck,
  searchBarInconsistentCheck,
  searchResultsWithoutFeedbackCheck,
  stickyOverlayHidesContentCheck,
  successStateMissingConfirmationCheck,
  successStateWithoutNextStepCheck,
  textOverflowClipCheck,
  touchHoverOnlyCriticalActionCheck,
  toastOrErrorWithoutRecoveryCheck,
  unclickableVisibleControlCheck,
  visualStabilityShiftSmokeCheck
} from "../checks/index.js";

function makeSnapshot(overrides = {}) {
  return {
    step: 3,
    url: "https://example.com/page",
    bodyText: "Example page",
    viewportWidth: 1280,
    viewportHeight: 720,
    pageWidth: 1280,
    pageHeight: 1600,
    viewportLabel: "desktop",
    pageTypeHints: {
      isHome: false,
      isSearch: false,
      isProduct: false,
      isCheckout: false,
      isAuth: false,
      isDocs: false
    },
    primaryNavLabels: ["Home", "Pricing", "Docs"],
    brandHeaderSignature: "sig-default",
    headerLandmarks: [],
    h1Text: "Example Heading",
    hasSearchBar: true,
    primaryCta: null,
    interactive: [],
    images: [],
    formControls: [],
    errorBanners: [],
    textOverflowItems: [],
    focusableHiddenElements: [],
    formControlDescriptors: [],
    visibleErrorMessages: [],
    hasMainLandmark: true,
    contentHints: { isStaticContentPage: false },
    overlays: [],
    spinnerVisible: false,
    focusProbe: null,
    layoutStabilityProbe: null,
    stateSignals: {
      guidanceActions: [],
      emptyStates: [],
      errorStates: [],
      successStates: [],
      pagination: {
        controls: [],
        hasPaginationControls: false,
        hasContext: false
      },
      search: {
        isSearchResultsPage: false,
        searchTerm: "",
        visibleResultCount: 0,
        hasNoResultsExplanation: false,
        hasRefinementGuidance: false,
        searchTermVisible: true
      }
    },
    uiReadyState: { timedOut: false, strategy: "hybrid" },
    networkSummary: {
      mainDocumentStatus: null,
      mainDocumentUrl: null,
      mainDocumentFailed: false
    },
    ...overrides
  };
}

const evidenceRefs = [{ type: "screenshot", ref: "/artifacts/test.png" }];

test("BROKEN_IMAGE flags broken hero image with elevated severity", () => {
  const issue = brokenImageCheck.run({
    snapshot: makeSnapshot({
      images: [
        {
          selector: "img.hero",
          src: "https://cdn.example.com/hero.png",
          hadError: false,
          broken: true,
          areaRatio: 0.22
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "BROKEN_IMAGE");
  assert.equal(issue.severity, "P1");
  assert.equal(issue.affectedSelector, "img.hero");
});

test("BROKEN_PRIMARY_NAV requires a header nav click and failing document status", () => {
  const issue = brokenPrimaryNavCheck.run({
    snapshot: makeSnapshot({
      networkSummary: {
        mainDocumentStatus: 404,
        mainDocumentUrl: "https://example.com/pricing",
        mainDocumentFailed: true
      }
    }),
    evidenceRefs,
    actionContext: {
      action: { type: "click", elementId: "el-nav" },
      target: {
        selector: "a[href='/pricing']",
        tag: "a",
        text: "Pricing",
        zone: "Header",
        landmark: "navigation:main"
      }
    }
  });

  assert.equal(issue.issueType, "BROKEN_PRIMARY_NAV");
  assert.equal(issue.severity, "P1");
  assert.match(issue.actual, /404/);
});

test("UNCLICKABLE_VISIBLE_CONTROL detects covered visible primary controls", () => {
  const issue = unclickableVisibleControlCheck.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          elementId: "el-1",
          selector: "button.buy-now",
          tag: "button",
          text: "Buy now",
          ariaLabel: "",
          disabled: false,
          inViewport: true,
          zone: "Primary Content",
          isPrimaryCta: true,
          bounds: { x: 24, y: 80, width: 200, height: 48 },
          centerProbe: {
            targetInViewport: true,
            sameTarget: false,
            covered: true,
            topTag: "div",
            topText: "Overlay blocker",
            topSelector: ".overlay"
          }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "UNCLICKABLE_VISIBLE_CONTROL");
  assert.equal(issue.severity, "P1");
  assert.match(issue.actual, /Overlay blocker/);
});

test("FORM_LABEL_MISSING flags unlabeled visible form controls", () => {
  const issue = formLabelMissingCheck.run({
    snapshot: makeSnapshot({
      formControls: [
        {
          selector: "input[name='email']",
          tag: "input",
          type: "email",
          name: "email",
          placeholder: "",
          ariaLabel: "",
          hasAssociatedLabel: false,
          inViewport: true
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "FORM_LABEL_MISSING");
  assert.equal(issue.severity, "P2");
  assert.match(issue.actual, /email/);
});

test("TOAST_OR_ERROR_WITHOUT_RECOVERY flags visible errors without action", () => {
  const issue = toastOrErrorWithoutRecoveryCheck.run({
    snapshot: makeSnapshot({
      errorBanners: [
        {
          selector: ".toast-error",
          text: "Payment failed. Please try again later.",
          inViewport: true,
          hasRecoveryAction: false
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "TOAST_OR_ERROR_WITHOUT_RECOVERY");
  assert.equal(issue.severity, "P2");
  assert.match(issue.actual, /without a retry or dismiss control/);
});

test("TEXT_OVERFLOW_CLIP elevates clipped header text", () => {
  const issue = textOverflowClipCheck.run({
    snapshot: makeSnapshot({
      textOverflowItems: [
        {
          selector: "a.nav-link",
          text: "Very long pricing label",
          zone: "Header",
          landmark: "navigation:main",
          inViewport: true,
          overflowPx: 42
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "TEXT_OVERFLOW_CLIP");
  assert.equal(issue.severity, "P1");
});

test("OVERLAPPING_INTERACTIVE_CONTROLS flags overlapping controls", () => {
  const issue = overlappingInteractiveControlsCheck.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          selector: "button.first",
          tag: "button",
          text: "First",
          disabled: false,
          inViewport: true,
          bounds: { x: 20, y: 20, width: 100, height: 40 }
        },
        {
          selector: "button.second",
          tag: "button",
          text: "Second",
          disabled: false,
          inViewport: true,
          bounds: { x: 60, y: 20, width: 100, height: 40 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "OVERLAPPING_INTERACTIVE_CONTROLS");
  assert.equal(issue.severity, "P1");
});

test("OFFSCREEN_PRIMARY_NAV flags missing mobile nav trigger", () => {
  const issue = offscreenPrimaryNavCheck.run({
    snapshot: makeSnapshot({
      viewportWidth: 390,
      viewportHeight: 844,
      viewportLabel: "mobile",
      interactive: [
        {
          selector: "a.nav-home",
          tag: "a",
          text: "Home",
          ariaLabel: "",
          placeholder: "",
          name: "",
          zone: "Header",
          landmark: "navigation:main",
          inViewport: false,
          bounds: { x: 420, y: 16, width: 64, height: 24 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "OFFSCREEN_PRIMARY_NAV");
  assert.equal(issue.severity, "P1");
});

test("NON_DISMISSABLE_MODAL flags blocking overlays without dismiss action", () => {
  const issue = nonDismissableModalCheck.run({
    snapshot: makeSnapshot({
      overlays: [
        {
          selector: ".full-modal",
          hasDismissAction: false,
          bounds: { x: 0, y: 0, width: 1280, height: 720 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "NON_DISMISSABLE_MODAL");
  assert.equal(issue.severity, "P0");
});

test("DEAD_END_PAGE flags app pages without safe interactive exits", () => {
  const issue = deadEndPageCheck.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          tag: "button",
          text: "Create account",
          ariaLabel: "",
          placeholder: "",
          name: "",
          href: "",
          disabled: false,
          inViewport: true,
          bounds: { x: 20, y: 50, width: 160, height: 40 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "DEAD_END_PAGE");
  assert.equal(issue.severity, "P1");
});

test("DEAD_END_PAGE ignores visible credential forms so auth assist can handle them", () => {
  const issue = deadEndPageCheck.run({
    snapshot: makeSnapshot({
      formControls: [
        {
          tag: "input",
          type: "",
          labelText: "Access Key",
          placeholder: "Enter your access key",
          ariaLabel: "",
          name: "",
          inViewport: true
        },
        {
          tag: "input",
          type: "password",
          labelText: "Password",
          placeholder: "Enter password",
          ariaLabel: "",
          name: "",
          inViewport: true
        }
      ],
      interactive: [
        {
          tag: "button",
          text: "Sign In",
          ariaLabel: "",
          placeholder: "",
          name: "",
          href: "",
          disabled: false,
          inViewport: true,
          bounds: { x: 20, y: 50, width: 200, height: 44 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue, null);
});

test("FOCUS_VISIBILITY_SMOKE flags lack of visible keyboard focus", () => {
  const issue = focusVisibilitySmokeCheck.run({
    snapshot: makeSnapshot({
      viewportLabel: "desktop",
      focusProbe: {
        attempted: true,
        anyFocusable: true,
        anyVisibleIndicator: false,
        steps: [
          {
            selector: "a.skip-link",
            text: "Skip to content"
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "FOCUS_VISIBILITY_SMOKE");
  assert.equal(issue.severity, "P2");
  assert.equal(issue.viewportLabel, "desktop");
});

test("EMPTY_STATE_WITHOUT_GUIDANCE flags empty states with no next action", () => {
  const issue = emptyStateWithoutGuidanceCheck.run({
    snapshot: makeSnapshot({
      stateSignals: {
        guidanceActions: [],
        emptyStates: [
          {
            selector: ".empty-state",
            text: "No items found",
            inViewport: true,
            hasGuidanceAction: false
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "EMPTY_STATE_WITHOUT_GUIDANCE");
  assert.equal(issue.severity, "P2");
});

test("ERROR_STATE_WITHOUT_ACTION elevates full-page errors", () => {
  const issue = errorStateWithoutActionCheck.run({
    snapshot: makeSnapshot({
      stateSignals: {
        guidanceActions: [],
        errorStates: [
          {
            selector: ".error-screen",
            text: "Something went wrong",
            inViewport: true,
            isFullPage: true,
            areaRatio: 0.7,
            hasRecoveryAction: false
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "ERROR_STATE_WITHOUT_ACTION");
  assert.equal(issue.severity, "P1");
});

test("SUCCESS_STATE_WITHOUT_NEXT_STEP flags isolated success confirmations", () => {
  const issue = successStateWithoutNextStepCheck.run({
    snapshot: makeSnapshot({
      stateSignals: {
        guidanceActions: [],
        successStates: [
          {
            selector: ".success-banner",
            text: "Saved successfully",
            inViewport: true,
            hasNextAction: false
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "SUCCESS_STATE_WITHOUT_NEXT_STEP");
  assert.equal(issue.severity, "P2");
});

test("PAGINATION_WITHOUT_CONTEXT flags controls missing page context", () => {
  const issue = paginationWithoutContextCheck.run({
    snapshot: makeSnapshot({
      stateSignals: {
        pagination: {
          hasPaginationControls: true,
          hasContext: false,
          controls: [{ selector: "a.next", text: "Next" }]
        }
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "PAGINATION_WITHOUT_CONTEXT");
  assert.equal(issue.severity, "P2");
});

test("SEARCH_RESULTS_WITHOUT_FEEDBACK flags zero-results pages without guidance", () => {
  const issue = searchResultsWithoutFeedbackCheck.run({
    snapshot: makeSnapshot({
      stateSignals: {
        search: {
          isSearchResultsPage: true,
          searchTerm: "wireless earbuds",
          visibleResultCount: 0,
          hasNoResultsExplanation: false,
          hasRefinementGuidance: false,
          searchTermVisible: false
        }
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "SEARCH_RESULTS_WITHOUT_FEEDBACK");
  assert.equal(issue.severity, "P2");
});

test("DUPLICATE_PRIMARY_CTA_LABELS flags duplicate labels with different destinations", () => {
  const issue = duplicatePrimaryCtaLabelsCheck.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          elementId: "el-1",
          selector: "a.primary-signup",
          tag: "a",
          text: "Start now",
          ariaLabel: "",
          placeholder: "",
          zone: "Primary Content",
          href: "https://example.com/signup",
          disabled: false,
          inViewport: true,
          isPrimaryCta: true,
          bounds: { x: 20, y: 120, width: 160, height: 44 }
        },
        {
          elementId: "el-2",
          selector: "a.primary-trial",
          tag: "a",
          text: "Start now",
          ariaLabel: "",
          placeholder: "",
          zone: "Primary Content",
          href: "https://example.com/trial",
          disabled: false,
          inViewport: true,
          isPrimaryCta: false,
          bounds: { x: 200, y: 120, width: 160, height: 44 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "DUPLICATE_PRIMARY_CTA_LABELS");
  assert.equal(issue.severity, "P2");
});

test("VISUAL_STABILITY_SHIFT_SMOKE flags anchor drift between bounded samples", () => {
  const issue = visualStabilityShiftSmokeCheck.run({
    snapshot: makeSnapshot({
      layoutStabilityProbe: {
        sampleCount: 2,
        unstableAnchors: [
          {
            anchor: "primary",
            selector: "button.primary",
            shiftPx: 72
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "VISUAL_STABILITY_SHIFT_SMOKE");
  assert.equal(issue.severity, "P1");
});

test("INCONSISTENT_PRIMARY_NAV flags low similarity nav labels in same page type", () => {
  const issue = inconsistentPrimaryNavCheck.run({
    snapshot: makeSnapshot({
      url: "https://example.com/products/phone",
      pageTypeHints: { isProduct: true },
      primaryNavLabels: ["Home", "Support", "Account"]
    }),
    evidenceRefs,
    runHistory: [
      {
        url: "https://example.com/products/laptop",
        pageTypeHints: { isProduct: true },
        primaryNavLabels: ["Home", "Pricing", "Docs"]
      }
    ]
  });

  assert.equal(issue.issueType, "INCONSISTENT_PRIMARY_NAV");
  assert.equal(issue.severity, "P2");
});

test("INCONSISTENT_PRIMARY_NAV elevates to P1 when affecting 3+ pages", () => {
  const issue = inconsistentPrimaryNavCheck.run({
    snapshot: makeSnapshot({
      url: "https://example.com/products/phone",
      pageTypeHints: { isProduct: true },
      primaryNavLabels: ["Home", "Support", "Account"]
    }),
    evidenceRefs,
    runHistory: [
      {
        url: "https://example.com/products/laptop",
        pageTypeHints: { isProduct: true },
        primaryNavLabels: ["Home", "Pricing", "Docs"]
      },
      {
        url: "https://example.com/products/tablet",
        pageTypeHints: { isProduct: true },
        primaryNavLabels: ["Shop", "Compare", "Deals"]
      }
    ]
  });

  assert.equal(issue.issueType, "INCONSISTENT_PRIMARY_NAV");
  assert.equal(issue.severity, "P1");
});

test("MISSING_PAGE_HEADING flags content pages without H1", () => {
  const issue = missingPageHeadingCheck.run({
    snapshot: makeSnapshot({
      pageTypeHints: { isDocs: true },
      h1Text: ""
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "MISSING_PAGE_HEADING");
  assert.equal(issue.severity, "P2");
});

test("SEARCH_BAR_INCONSISTENT flags unexpected search bar disappearance", () => {
  const issue = searchBarInconsistentCheck.run({
    snapshot: makeSnapshot({
      pageTypeHints: { isProduct: true },
      hasSearchBar: false
    }),
    evidenceRefs,
    runHistory: [
      { pageTypeHints: { isProduct: true }, hasSearchBar: true },
      { pageTypeHints: { isProduct: true }, hasSearchBar: true },
      { pageTypeHints: { isProduct: true }, hasSearchBar: false }
    ]
  });

  assert.equal(issue.issueType, "SEARCH_BAR_INCONSISTENT");
  assert.equal(issue.severity, "P2");
});

test("DUPLICATE_BRAND_HEADER flags stacked duplicate headers", () => {
  const issue = duplicateBrandHeaderCheck.run({
    snapshot: makeSnapshot({
      headerLandmarks: [
        {
          selector: "header.main",
          text: "Home Pricing Docs",
          inViewport: true,
          bounds: { x: 0, y: 0, width: 1200, height: 72 }
        },
        {
          selector: "header.clone",
          text: "Home Pricing Docs",
          inViewport: true,
          bounds: { x: 0, y: 60, width: 1200, height: 70 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "DUPLICATE_BRAND_HEADER");
  assert.equal(issue.severity, "P1");
});

test("CTA_PRIORITY_CONFLICT flags multiple top-fold primary-looking CTAs", () => {
  const issue = ctaPriorityConflictCheck.run({
    snapshot: makeSnapshot({
      viewportHeight: 900,
      interactive: [
        {
          selector: "a.start-free",
          elementId: "el-a",
          tag: "a",
          text: "Start free trial",
          ariaLabel: "",
          placeholder: "",
          zone: "Primary Content",
          inViewport: true,
          disabled: false,
          bounds: { x: 20, y: 120, viewportY: 120, width: 210, height: 48 }
        },
        {
          selector: "button.book-demo",
          elementId: "el-b",
          tag: "button",
          text: "Book demo",
          ariaLabel: "",
          placeholder: "",
          zone: "Primary Content",
          inViewport: true,
          disabled: false,
          bounds: { x: 250, y: 120, viewportY: 120, width: 190, height: 48 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.ok(issue);
  assert.equal(issue.issueType, "CTA_PRIORITY_CONFLICT");
  assert.equal(issue.severity, "P2");
  assert.ok((issue.supportingSignals ?? []).length >= 2);
  assert.ok((issue.detectorSignals?.signalSet?.strong ?? []).length >= 2);
});

test("CTA_PRIORITY_CONFLICT does not flag when one clear primary CTA is present", () => {
  const issue = ctaPriorityConflictCheck.run({
    snapshot: makeSnapshot({
      viewportHeight: 900,
      interactive: [
        {
          selector: "a.start-free",
          elementId: "el-a",
          tag: "a",
          text: "Start free trial",
          zone: "Primary Content",
          inViewport: true,
          disabled: false,
          isPrimaryCta: true,
          bounds: { x: 20, y: 120, viewportY: 120, width: 240, height: 50 }
        },
        {
          selector: "button.book-demo",
          elementId: "el-b",
          tag: "button",
          text: "Learn more",
          zone: "Primary Content",
          inViewport: true,
          disabled: false,
          isPrimaryCta: false,
          bounds: { x: 280, y: 120, viewportY: 120, width: 150, height: 44 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue, null);
});

test("BROKEN_ICON flags broken icon-sized assets", () => {
  const issue = brokenIconCheck.run({
    snapshot: makeSnapshot({
      images: [
        {
          selector: "img.icon-cart",
          src: "https://cdn.example.com/icon-cart.svg",
          hadError: true,
          broken: true,
          inViewport: true,
          areaRatio: 0.01
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "BROKEN_ICON");
  assert.equal(issue.severity, "P2");
});

test("STICKY_OVERLAY_HIDES_CONTENT flags persistent top-fold covering layers", () => {
  const issue = stickyOverlayHidesContentCheck.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          selector: "button.primary-buy",
          tag: "button",
          text: "Buy",
          disabled: false,
          inViewport: true,
          zone: "Primary Content",
          bounds: { x: 20, y: 120, width: 140, height: 40, viewportY: 120 },
          centerProbe: {
            targetInViewport: true,
            covered: true,
            topSelector: ".sticky-banner"
          }
        },
        {
          selector: "a.primary-details",
          tag: "a",
          text: "Details",
          disabled: false,
          inViewport: true,
          zone: "Primary Content",
          bounds: { x: 180, y: 130, width: 140, height: 40, viewportY: 130 },
          centerProbe: {
            targetInViewport: true,
            covered: true,
            topSelector: ".sticky-banner"
          }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "STICKY_OVERLAY_HIDES_CONTENT");
});

test("SEVERE_ALIGNMENT_BREAK flags major header row misalignment", () => {
  const issue = severeAlignmentBreakCheck.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          selector: "a.header-home",
          tag: "a",
          text: "Home",
          zone: "Header",
          inViewport: true,
          disabled: false,
          bounds: { x: 10, y: 10, width: 80, height: 24, viewportY: 10 }
        },
        {
          selector: "a.header-pricing",
          tag: "a",
          text: "Pricing",
          zone: "Header",
          inViewport: true,
          disabled: false,
          bounds: { x: 120, y: 62, width: 90, height: 24, viewportY: 62 }
        },
        {
          selector: "button.header-login",
          tag: "button",
          text: "Login",
          zone: "Header",
          inViewport: true,
          disabled: false,
          bounds: { x: 230, y: 74, width: 90, height: 28, viewportY: 74 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "SEVERE_ALIGNMENT_BREAK");
  assert.equal(issue.severity, "P2");
});

test("INTERACTIVE_NO_OP flags successful interactions without visible state change", () => {
  const issue = interactiveNoOpCheck.run({
    snapshot: makeSnapshot({
      url: "https://example.com/catalog",
      hash: "same-hash"
    }),
    evidenceRefs,
    actionContext: {
      action: { type: "click" },
      target: { selector: "button.open-menu", text: "Open menu" }
    },
    actionResult: {
      success: true,
      progressSignals: []
    },
    runHistory: [
      {
        url: "https://example.com/catalog",
        hash: "same-hash"
      }
    ]
  });

  assert.equal(issue.issueType, "INTERACTIVE_NO_OP");
  assert.equal(issue.severity, "P2");
});

test("NAVIGATION_TRAP_PATTERN flags short route cycles", () => {
  const issue = navigationTrapPatternCheck.run({
    snapshot: makeSnapshot({
      url: "https://example.com/a"
    }),
    evidenceRefs,
    runHistory: [
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
      { url: "https://example.com/a" }
    ]
  });

  assert.equal(issue.issueType, "NAVIGATION_TRAP_PATTERN");
  assert.equal(issue.severity, "P1");
});

test("TOUCH_HOVER_ONLY_CRITICAL_ACTION flags hidden critical actions on touch viewports", () => {
  const issue = touchHoverOnlyCriticalActionCheck.run({
    snapshot: makeSnapshot({
      viewportWidth: 390,
      primaryCta: null,
      focusableHiddenElements: [
        {
          selector: "button.checkout-hidden",
          text: "Checkout now"
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "TOUCH_HOVER_ONLY_CRITICAL_ACTION");
  assert.equal(issue.severity, "P1");
});

test("DISABLED_SUBMIT_NO_EXPLANATION flags blocked submit with no guidance", () => {
  const issue = disabledSubmitNoExplanationCheck.run({
    snapshot: makeSnapshot({
      bodyText: "Create account",
      visibleErrorMessages: [],
      stateSignals: {
        guidanceActions: []
      },
      interactive: [
        {
          selector: "button.submit",
          tag: "button",
          text: "Submit",
          ariaLabel: "",
          placeholder: "",
          type: "submit",
          disabled: true,
          inViewport: true
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "DISABLED_SUBMIT_NO_EXPLANATION");
  assert.equal(issue.severity, "P2");
});

test("FIELD_ERROR_NOT_VISIBLE flags required fields with unassociated errors", () => {
  const issue = fieldErrorNotVisibleCheck.run({
    snapshot: makeSnapshot({
      bodyText: "Email is required",
      formControlDescriptors: [
        {
          selector: "input[name='email']",
          requiredAttr: true,
          ariaRequired: false
        }
      ],
      visibleErrorMessages: [
        {
          selector: ".error-banner",
          text: "Please fix invalid fields",
          associatedFieldSelector: null
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "FIELD_ERROR_NOT_VISIBLE");
  assert.equal(issue.severity, "P2");
});

test("SUCCESS_STATE_MISSING_CONFIRMATION flags mutation-like success without confirmation", () => {
  const issue = successStateMissingConfirmationCheck.run({
    snapshot: makeSnapshot({
      stateSignals: {
        successStates: []
      }
    }),
    evidenceRefs,
    actionResult: {
      success: true
    },
    actionContext: {
      action: { type: "click" },
      target: {
        selector: "button.save",
        text: "Save changes"
      }
    }
  });

  assert.equal(issue.issueType, "SUCCESS_STATE_MISSING_CONFIRMATION");
  assert.equal(issue.severity, "P2");
});

test("PARTIAL_RENDER_SILENT_FAILURE flags sparse incomplete pages without explicit errors", () => {
  const issue = partialRenderSilentFailureCheck.run({
    snapshot: makeSnapshot({
      bodyText: "Loading",
      hasMainLandmark: false,
      interactive: [
        {
          selector: "a.help",
          tag: "a",
          inViewport: true,
          disabled: false,
          bounds: { x: 20, y: 20, width: 40, height: 20 }
        }
      ],
      stateSignals: {
        emptyStates: [],
        errorStates: [],
        successStates: []
      },
      networkSummary: {
        mainDocumentStatus: 200
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "PARTIAL_RENDER_SILENT_FAILURE");
  assert.equal(issue.severity, "P1");
});

test("LOCALIZATION_OVERFLOW_HINT flags locale-like clipped formatted text", () => {
  const issue = localizationOverflowHintCheck.run({
    snapshot: makeSnapshot({
      textOverflowItems: [
        {
          selector: ".price-summary",
          text: "Total due: €12,345.67 due Dec 31, 2026 at 11:59 PM",
          inViewport: true,
          overflowPx: 18
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.issueType, "LOCALIZATION_OVERFLOW_HINT");
  assert.equal(issue.severity, "P2");
});
