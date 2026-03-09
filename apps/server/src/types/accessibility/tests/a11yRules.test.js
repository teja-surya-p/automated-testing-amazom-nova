import test from "node:test";
import assert from "node:assert/strict";

import {
  baselineA11yRules,
  buttonNameMissingRule,
  focusableHiddenRule,
  headingOrderSuspiciousRule,
  imageMissingAltRule,
  landmarksMissingRule,
  missingFormLabelRule
} from "../src/types/accessibility/rules/index.js";
import { A11yRuleRegistry } from "../src/types/accessibility/rules/registry.js";

function makeSnapshot(overrides = {}) {
  return {
    step: 1,
    url: "https://example.com/store",
    viewportLabel: "desktop",
    formControls: [],
    images: [],
    interactive: [],
    headings: [],
    hasMainLandmark: true,
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
