import test from "node:test";
import assert from "node:assert/strict";

import {
  filterFlowCandidatesBySelection,
  normalizeFunctionalCheckIds,
  resolveFunctionalCheckSelection
} from "../checkSelection.js";

test("normalizeFunctionalCheckIds deduplicates and normalizes check ids", () => {
  const normalized = normalizeFunctionalCheckIds([
    "form_valid_submit",
    "FORM_VALID_SUBMIT",
    " LINK_DESTINATION_CORRECT ",
    "INPUT_EMAIL_VALIDATION",
    ""
  ]);
  assert.deepEqual(normalized, ["FORM_VALID_SUBMIT", "LINK_DESTINATION_CORRECT", "INPUT_EMAIL_VALIDATION"]);
});

test("resolveFunctionalCheckSelection maps selected checks to rule and flow filters", () => {
  const selection = resolveFunctionalCheckSelection([
    "FORM_VALID_SUBMIT",
    "PROTECTED_URL_BLOCKING"
  ]);

  assert.equal(selection.selectionActive, true);
  assert.equal(selection.allowedRuleIds.has("SEARCH_RESULTS_OR_NO_RESULTS_MESSAGE"), true);
  assert.equal(selection.allowedRuleIds.has("SAFE_REDIRECT_ALLOWED"), true);
  assert.equal(selection.preferredFlowTypes.has("SEARCH_SMOKE"), true);
  assert.equal(selection.preferredFlowTypes.has("HOME_NAV_SMOKE"), true);
});

test("filterFlowCandidatesBySelection returns only selected flow types when mapping exists", () => {
  const flowCandidates = [
    { flowType: "HOME_NAV_SMOKE" },
    { flowType: "SEARCH_SMOKE" },
    { flowType: "FILTER_SMOKE" }
  ];

  const selection = resolveFunctionalCheckSelection(["FORM_VALID_SUBMIT"]);
  const filtered = filterFlowCandidatesBySelection(flowCandidates, selection);
  assert.deepEqual(filtered.map((flow) => flow.flowType), ["SEARCH_SMOKE", "FILTER_SMOKE"]);
});

test("filterFlowCandidatesBySelection keeps candidates unchanged without active selection", () => {
  const flowCandidates = [
    { flowType: "HOME_NAV_SMOKE" },
    { flowType: "SEARCH_SMOKE" }
  ];
  const filtered = filterFlowCandidatesBySelection(flowCandidates, resolveFunctionalCheckSelection([]));
  assert.deepEqual(filtered, flowCandidates);
});
