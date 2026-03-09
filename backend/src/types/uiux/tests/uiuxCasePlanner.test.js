import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateUiuxPlannedCases,
  planUiuxCasesForPage,
  selectUiuxSafeInteractionCandidates
} from "../uiuxCasePlanner.js";
import { baselineUiuxChecks } from "../checks/index.js";

function buildSnapshotFixture() {
  return {
    url: "https://example.com/store",
    interactive: [
      {
        elementId: "search-input",
        tag: "input",
        type: "search",
        text: "",
        ariaLabel: "Search products",
        placeholder: "Search",
        name: "q",
        inViewport: true,
        disabled: false,
        bounds: { y: 40, x: 40, width: 240, height: 36 }
      },
      {
        elementId: "next-page",
        tag: "a",
        text: "Next",
        ariaLabel: "",
        inViewport: true,
        disabled: false,
        href: "https://example.com/store?page=2",
        bounds: { y: 640, x: 40, width: 90, height: 32 }
      },
      {
        elementId: "filter-toggle",
        tag: "button",
        text: "Filter",
        ariaLabel: "Filter",
        inViewport: true,
        disabled: false,
        bounds: { y: 130, x: 40, width: 110, height: 32 }
      },
      {
        elementId: "menu-expand",
        tag: "button",
        text: "Show more",
        ariaLabel: "Show more",
        inViewport: true,
        disabled: false,
        bounds: { y: 220, x: 40, width: 150, height: 32 }
      }
    ],
    formControls: [
      {
        selector: "input[name='q']",
        type: "search",
        name: "q",
        placeholder: "Search"
      }
    ]
  };
}

test("estimateUiuxPlannedCases is deterministic and bounded by config", () => {
  const estimate = estimateUiuxPlannedCases({
    uiux: {
      maxPages: 5,
      viewports: [{ label: "mobile" }, { label: "desktop" }],
      maxInteractionsPerPage: 4
    }
  });
  const expected = 5 * 2 * (1 + baselineUiuxChecks.length) + 5 * 4;
  assert.equal(estimate, expected);
});

test("planUiuxCasesForPage emits render/check/interaction cases for all devices", () => {
  const planned = planUiuxCasesForPage({
    pageUrl: "https://example.com/store",
    canonicalUrl: "https://example.com/store",
    deviceLabels: ["mobile", "desktop"],
    checkIds: ["OVERLAY_BLOCKING", "HORIZONTAL_SCROLL"],
    interactionCandidates: [{ actionKind: "NAV_CLICK", elementId: "next-page" }]
  });

  assert.equal(planned.renderCases.length, 2);
  assert.equal(planned.checkCases.length, 4);
  assert.equal(planned.interactionCases.length, 1);
  assert.equal(planned.allCases.length, 7);
  assert.equal(planned.checkCases[0].caseKind, "UI_CHECK");
  assert.equal(planned.interactionCases[0].caseKind, "SAFE_INTERACTION");
});

test("selectUiuxSafeInteractionCandidates returns deterministic safe actions", () => {
  const candidates = selectUiuxSafeInteractionCandidates({
    snapshot: buildSnapshotFixture(),
    runConfig: {
      uiux: {
        maxInteractionsPerPage: 3
      }
    }
  });

  assert.equal(candidates.length, 3);
  assert.deepEqual(
    candidates.map((candidate) => candidate.actionKind),
    ["SEARCH_SUBMIT", "FILTER_TOGGLE", "PAGINATION"]
  );
});
