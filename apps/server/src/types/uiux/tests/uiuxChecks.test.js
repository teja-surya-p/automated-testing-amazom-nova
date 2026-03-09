import test from "node:test";
import assert from "node:assert/strict";

import {
  brokenImageCheck,
  brokenPrimaryNavCheck,
  ctaPriorityConflictCheck,
  deadEndPageCheck,
  duplicatePrimaryCtaLabelsCheck,
  duplicateBrandHeaderCheck,
  emptyStateWithoutGuidanceCheck,
  errorStateWithoutActionCheck,
  focusVisibilitySmokeCheck,
  formLabelMissingCheck,
  inconsistentPrimaryNavCheck,
  missingPageHeadingCheck,
  nonDismissableModalCheck,
  offscreenPrimaryNavCheck,
  overlappingInteractiveControlsCheck,
  paginationWithoutContextCheck,
  searchBarInconsistentCheck,
  searchResultsWithoutFeedbackCheck,
  successStateWithoutNextStepCheck,
  textOverflowClipCheck,
  toastOrErrorWithoutRecoveryCheck,
  unclickableVisibleControlCheck,
  visualStabilityShiftSmokeCheck
} from "../src/types/uiux/checks/index.js";

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

  assert.equal(issue.issueType, "CTA_PRIORITY_CONFLICT");
  assert.equal(issue.severity, "P2");
});
