import test from "node:test";
import assert from "node:assert/strict";

import {
  baselineA11yRules,
  buttonNameMissingRule,
  describedByMissingTargetRule,
  errorNotAnnouncedRule,
  errorNotAssociatedRule,
  focusTrapDetectedRule,
  focusableHiddenRule,
  genericLinkTextRule,
  headingOrderSuspiciousRule,
  imageMissingAltRule,
  invalidFieldNotFocusedRule,
  keyboardFocusNotVisibleRule,
  landmarksMissingRule,
  lowContrastTextRule,
  modalMissingAccessibleNameRule,
  modalNotDismissableRule,
  missingFormLabelRule,
  requiredNotAnnouncedRule,
  reducedMotionNotRespectedRule,
  skipLinkMissingRule,
  textScaleBreaksLayoutRule
} from "../rules/index.js";
import { A11yRuleRegistry } from "../rules/registry.js";

function makeSnapshot(overrides = {}) {
  return {
    step: 1,
    url: "https://example.com/store",
    viewportLabel: "desktop",
    formControls: [],
    formControlDescriptors: [],
    visibleErrorMessages: [],
    firstInvalidFocusAfterSubmit: null,
    formValidationProbe: null,
    images: [],
    interactive: [],
    overlays: [],
    headings: [],
    headerLandmarks: [],
    hasSkipLink: false,
    hasMainLandmark: true,
    focusA11yProbe: null,
    contrastSamples: null,
    textScaleFindings: null,
    reducedMotionFindings: null,
    focusableHiddenElements: [],
    accessibilitySnapshot: {
      role: "WebArea",
      name: "Store",
      children: [{ role: "main", name: "Main" }]
    },
    ...overrides
  };
}

const evidenceRefs = [{ type: "screenshot", ref: "/artifacts/x.png" }];

test("MISSING_FORM_LABEL flags visible unlabeled inputs", () => {
  const issue = missingFormLabelRule.run({
    snapshot: makeSnapshot({
      formControls: [
        {
          selector: "input[name='email']",
          tag: "input",
          type: "text",
          inViewport: true,
          name: "",
          labelText: "",
          ariaLabel: ""
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "MISSING_FORM_LABEL");
  assert.equal(issue.severity, "P1");
});

test("IMAGE_MISSING_ALT ignores decorative images and flags missing alt", () => {
  const issue = imageMissingAltRule.run({
    snapshot: makeSnapshot({
      images: [
        { selector: "img.decorative", alt: "", role: "presentation", ariaHidden: false, inViewport: true },
        { selector: "img.hero", alt: "", role: "", ariaHidden: false, inViewport: true }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "IMAGE_MISSING_ALT");
  assert.equal(issue.affectedSelector, "img.hero");
});

test("BUTTON_NAME_MISSING flags empty visible button/link names", () => {
  const issue = buttonNameMissingRule.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          selector: "button.icon-only",
          tag: "button",
          text: "",
          ariaLabel: "",
          placeholder: "",
          inViewport: true,
          disabled: false
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "BUTTON_NAME_MISSING");
  assert.equal(issue.severity, "P1");
});

test("HEADING_ORDER_SUSPICIOUS flags heading level jumps", () => {
  const issue = headingOrderSuspiciousRule.run({
    snapshot: makeSnapshot({
      headings: [
        { level: 1, text: "Title" },
        { level: 3, text: "Skipped" }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "HEADING_ORDER_SUSPICIOUS");
  assert.match(issue.actual, /h1 to h3/i);
});

test("LANDMARKS_MISSING flags absent main landmark", () => {
  const issue = landmarksMissingRule.run({
    snapshot: makeSnapshot({
      hasMainLandmark: false,
      accessibilitySnapshot: {
        role: "WebArea",
        name: "No main",
        children: [{ role: "navigation", name: "Nav" }]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "LANDMARKS_MISSING");
  assert.equal(issue.severity, "P2");
});

test("FOCUSABLE_HIDDEN flags hidden focusable controls", () => {
  const issue = focusableHiddenRule.run({
    snapshot: makeSnapshot({
      focusableHiddenElements: [
        {
          selector: "a#hidden-link",
          tag: "a",
          text: "Hidden link"
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "FOCUSABLE_HIDDEN");
  assert.equal(issue.severity, "P1");
});

test("KEYBOARD_FOCUS_NOT_VISIBLE flags probe runs with no visible indicator", () => {
  const issue = keyboardFocusNotVisibleRule.run({
    snapshot: makeSnapshot({
      focusA11yProbe: {
        attempted: true,
        anyFocusable: true,
        anyVisibleIndicator: false,
        maxTabs: 10,
        steps: [
          {
            step: 1,
            selector: "a#nav-home",
            role: "link",
            accessibleName: "Home",
            visibleFocusIndicator: false
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "KEYBOARD_FOCUS_NOT_VISIBLE");
  assert.equal(issue.severity, "P1");
  assert.equal(issue.focusProbe?.maxTabs, 10);
});

test("FOCUS_TRAP_DETECTED flags short-loop focus trap with other focusables available", () => {
  const issue = focusTrapDetectedRule.run({
    snapshot: makeSnapshot({
      focusA11yProbe: {
        attempted: true,
        anyFocusable: true,
        anyVisibleIndicator: true,
        loopDetected: true,
        potentialTrap: true,
        totalFocusableCount: 9,
        uniqueFocusedCount: 2,
        repeatedSelectors: ["#modal-close", "#modal-action"],
        steps: [
          { step: 1, selector: "#modal-close", role: "button", accessibleName: "Close", visibleFocusIndicator: true },
          { step: 2, selector: "#modal-action", role: "button", accessibleName: "Confirm", visibleFocusIndicator: true }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "FOCUS_TRAP_DETECTED");
  assert.equal(issue.severity, "P1");
  assert.equal(issue.focusProbe?.potentialTrap, true);
});

test("MODAL_MISSING_ACCESSIBLE_NAME flags modal dialog without name", () => {
  const issue = modalMissingAccessibleNameRule.run({
    snapshot: makeSnapshot({
      overlays: [
        {
          selector: ".modal",
          isModalDialog: true,
          hasAccessibleName: false,
          areaRatio: 0.4
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "MODAL_MISSING_ACCESSIBLE_NAME");
  assert.equal(issue.severity, "P1");
});

test("MODAL_NOT_DISMISSABLE flags blocking modal with no dismiss control", () => {
  const issue = modalNotDismissableRule.run({
    snapshot: makeSnapshot({
      overlays: [
        {
          selector: ".blocking-modal",
          isModalDialog: true,
          isBlocking: true,
          areaRatio: 0.7,
          hasDismissAction: false
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "MODAL_NOT_DISMISSABLE");
  assert.equal(issue.severity, "P1");
});

test("SKIP_LINK_MISSING flags large-header pages without skip link", () => {
  const issue = skipLinkMissingRule.run({
    snapshot: makeSnapshot({
      viewportWidth: 1280,
      viewportHeight: 900,
      hasMainLandmark: true,
      hasSkipLink: false,
      headerLandmarks: [
        {
          selector: "header",
          inViewport: true,
          bounds: { width: 1280, height: 90 }
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "SKIP_LINK_MISSING");
  assert.equal(issue.severity, "P2");
});

test("GENERIC_LINK_TEXT flags context-poor generic anchor labels", () => {
  const issue = genericLinkTextRule.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          selector: "a.read-more",
          tag: "a",
          text: "Read more",
          ariaLabel: "",
          contextText: "Read more",
          zone: "Primary Content",
          inViewport: true,
          disabled: false
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "GENERIC_LINK_TEXT");
  assert.equal(issue.severity, "P2");
  assert.equal(issue.confidence < 0.7, true);
});

test("GENERIC_LINK_TEXT ignores generic labels with strong nearby context", () => {
  const issue = genericLinkTextRule.run({
    snapshot: makeSnapshot({
      interactive: [
        {
          selector: "a.read-more",
          tag: "a",
          text: "Read more",
          ariaLabel: "",
          contextText: "Read more about annual billing limits and account recovery options.",
          zone: "Primary Content",
          inViewport: true,
          disabled: false
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue, null);
});

test("LOW_CONTRAST_TEXT uses normal-text threshold and raises severity for large gap", () => {
  const issue = lowContrastTextRule.run({
    snapshot: makeSnapshot({
      contrastSamples: {
        enabled: true,
        minRatioNormalText: 4.5,
        minRatioLargeText: 3.0,
        offenders: [
          {
            selector: "p.price",
            textSample: "Special offer",
            ratio: 2.7,
            requiredRatio: 4.5,
            fontSizePx: 14,
            fontWeight: 400,
            isLargeText: false,
            passes: false
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "LOW_CONTRAST_TEXT");
  assert.equal(issue.severity, "P1");
});

test("LOW_CONTRAST_TEXT applies large-text threshold correctly", () => {
  const issue = lowContrastTextRule.run({
    snapshot: makeSnapshot({
      contrastSamples: {
        enabled: true,
        minRatioNormalText: 4.5,
        minRatioLargeText: 3.0,
        offenders: [
          {
            selector: "h2.title",
            textSample: "Large heading",
            ratio: 2.8,
            requiredRatio: 3.0,
            fontSizePx: 24,
            fontWeight: 700,
            isLargeText: true,
            passes: false
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "LOW_CONTRAST_TEXT");
  assert.equal(issue.severity, "P2");
});

test("TEXT_SCALE_BREAKS_LAYOUT flags scale regression", () => {
  const issue = textScaleBreaksLayoutRule.run({
    snapshot: makeSnapshot({
      textScaleFindings: {
        enabled: true,
        scales: [1, 1.25, 1.5],
        baseline: {
          horizontalOverflowPx: 0,
          textOverflowItemsCount: 1
        },
        results: [
          {
            scale: 1.25,
            deltaHorizontalOverflow: 36,
            deltaTextOverflowCount: 2,
            breaksLayout: true
          }
        ]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "TEXT_SCALE_BREAKS_LAYOUT");
  assert.equal(issue.severity, "P2");
});

test("REDUCED_MOTION_NOT_RESPECTED flags persistent long animations", () => {
  const issue = reducedMotionNotRespectedRule.run({
    snapshot: makeSnapshot({
      reducedMotionFindings: {
        enabled: true,
        longAnimationCount: 7,
        longAnimationSelectors: [{ selector: ".hero-animation" }]
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "REDUCED_MOTION_NOT_RESPECTED");
  assert.equal(issue.severity, "P2");
});

test("REQUIRED_NOT_ANNOUNCED flags required field without aria-required and indicator", () => {
  const issue = requiredNotAnnouncedRule.run({
    snapshot: makeSnapshot({
      formControlDescriptors: [
        {
          selector: "input[name='email']",
          requiredAttr: true,
          ariaRequired: false,
          requiredIndicatorNearLabel: false
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "REQUIRED_NOT_ANNOUNCED");
  assert.equal(issue.severity, "P1");
});

test("ERROR_NOT_ASSOCIATED flags visible errors without field association", () => {
  const issue = errorNotAssociatedRule.run({
    snapshot: makeSnapshot({
      visibleErrorMessages: [
        {
          selector: ".field-error",
          text: "Please enter a valid email.",
          associatedFieldSelector: null,
          roleAlert: true,
          ariaLive: null
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "ERROR_NOT_ASSOCIATED");
  assert.equal(issue.severity, "P1");
});

test("ERROR_NOT_ANNOUNCED flags errors without alert/live region", () => {
  const issue = errorNotAnnouncedRule.run({
    snapshot: makeSnapshot({
      visibleErrorMessages: [
        {
          selector: ".field-error",
          text: "Required.",
          associatedFieldSelector: "input[name='q']",
          roleAlert: false,
          ariaLive: null
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "ERROR_NOT_ANNOUNCED");
  assert.equal(issue.severity, "P2");
});

test("INVALID_FIELD_NOT_FOCUSED flags when safe submit does not focus expected invalid control", () => {
  const issue = invalidFieldNotFocusedRule.run({
    snapshot: makeSnapshot({
      formValidationProbe: {
        attempted: true,
        mode: "safe-submit",
        submitType: "search",
        expectedInvalidSelector: "input[name='q']",
        firstInvalidFocusAfterSubmit: {
          selector: "button[type='submit']"
        }
      },
      firstInvalidFocusAfterSubmit: {
        selector: "button[type='submit']"
      }
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "INVALID_FIELD_NOT_FOCUSED");
  assert.equal(issue.severity, "P1");
});

test("DESCRIBEDBY_MISSING_TARGET flags missing aria-describedby references", () => {
  const issue = describedByMissingTargetRule.run({
    snapshot: makeSnapshot({
      formControlDescriptors: [
        {
          selector: "input[name='phone']",
          ariaDescribedByMissingIds: ["field-error-42"]
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issue.ruleId, "DESCRIBEDBY_MISSING_TARGET");
  assert.equal(issue.severity, "P2");
});

test("A11y registry executes baseline rule pack deterministically", () => {
  const registry = new A11yRuleRegistry(baselineA11yRules);
  const issues = registry.runAll({
    snapshot: makeSnapshot({
      formControls: [
        {
          selector: "input#x",
          tag: "input",
          type: "text",
          inViewport: true,
          name: "",
          labelText: "",
          ariaLabel: ""
        }
      ]
    }),
    evidenceRefs
  });

  assert.equal(issues.length >= 1, true);
  assert.equal(issues[0].ruleId, "MISSING_FORM_LABEL");
});
