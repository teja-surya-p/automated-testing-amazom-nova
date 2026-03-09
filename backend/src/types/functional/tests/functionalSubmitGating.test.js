import test from "node:test";
import assert from "node:assert/strict";

import {
  FUNCTIONAL_SUBMIT_CONFIDENCE_THRESHOLD,
  classifyFunctionalSubmitAction,
  evaluateFunctionalSubmitGate
} from "../submitGating.js";

function runConfig(overrides = {}) {
  return {
    functional: {
      allowFormSubmit: false,
      allowedSubmitTypes: ["search", "filter", "pagination"],
      ...overrides
    }
  };
}

function semantics(overrides = {}) {
  return {
    searchForms: [{ inputElementId: "el-search", submitElementId: "el-search-submit", confidence: 0.92 }],
    filterControls: [{ elementId: "el-filter", type: "button", confidence: 0.88 }],
    paginationControls: [{ nextId: "el-next", prevId: "el-prev", pageLinks: ["el-page-2"], confidence: 0.9 }],
    riskyForms: [],
    ...overrides
  };
}

test("submit gate blocks all submit actions when allowFormSubmit is false", () => {
  const result = evaluateFunctionalSubmitGate({
    action: { type: "type", functionalKind: "search", elementId: "el-search" },
    runConfig: runConfig({ allowFormSubmit: false }),
    semantics: semantics()
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "FUNCTIONAL_SUBMIT_DISABLED");
});

test("submit gate allows whitelisted high-confidence submit actions", () => {
  const result = evaluateFunctionalSubmitGate({
    action: { type: "type", functionalKind: "search", elementId: "el-search" },
    runConfig: runConfig({ allowFormSubmit: true, allowedSubmitTypes: ["search"] }),
    semantics: semantics()
  });

  assert.equal(result.allowed, true);
  assert.equal(result.code, "FUNCTIONAL_SUBMIT_ALLOWED");
  assert.equal(result.confidence >= FUNCTIONAL_SUBMIT_CONFIDENCE_THRESHOLD, true);
});

test("submit gate blocks low-confidence classification", () => {
  const result = evaluateFunctionalSubmitGate({
    action: { type: "click", functionalKind: "pagination", elementId: "el-unknown" },
    runConfig: runConfig({ allowFormSubmit: true, allowedSubmitTypes: ["pagination"] }),
    semantics: semantics()
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "FUNCTIONAL_SUBMIT_LOW_CONFIDENCE");
});

test("submit gate blocks risky form controls", () => {
  const result = evaluateFunctionalSubmitGate({
    action: { type: "type", functionalKind: "search", elementId: "el-search" },
    runConfig: runConfig({ allowFormSubmit: true, allowedSubmitTypes: ["search"] }),
    semantics: semantics({
      riskyForms: [{ formType: "newsletter", elementIds: ["el-search"], confidence: 0.94 }]
    })
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "FUNCTIONAL_RISKY_FORM_BLOCKED");
});

test("submit gate blocks submit type not present in whitelist", () => {
  const result = evaluateFunctionalSubmitGate({
    action: { type: "click", functionalKind: "filter", elementId: "el-filter" },
    runConfig: runConfig({ allowFormSubmit: true, allowedSubmitTypes: ["search"] }),
    semantics: semantics()
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "FUNCTIONAL_SUBMIT_TYPE_BLOCKED");
});

test("submit classifier maps filter-clear actions to filter submit type", () => {
  const classification = classifyFunctionalSubmitAction(
    { type: "click", functionalKind: "filter-clear", elementId: "el-filter" },
    semantics()
  );

  assert.equal(classification.submitType, "filter");
  assert.equal(classification.matched, true);
});

