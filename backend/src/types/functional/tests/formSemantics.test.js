import test from "node:test";
import assert from "node:assert/strict";

import { extractFormSemantics } from "../formSemantics.js";

function makeSnapshot(overrides = {}) {
  return {
    interactive: [],
    formControls: [],
    ...overrides
  };
}

test("form semantics extracts search form with strong confidence", () => {
  const snapshot = makeSnapshot({
    interactive: [
      {
        elementId: "el-search",
        selector: "input[name='q']",
        tag: "input",
        type: "search",
        name: "q",
        placeholder: "Search products",
        ariaLabel: "Search",
        text: "",
        zone: "Header",
        disabled: false,
        bounds: { y: 20, viewportY: 20 }
      },
      {
        elementId: "el-search-submit",
        selector: "button[aria-label='Search']",
        tag: "button",
        text: "Search",
        ariaLabel: "Search",
        zone: "Header",
        disabled: false,
        bounds: { y: 24, viewportY: 24 }
      }
    ],
    formControls: [
      {
        selector: "input[name='q']",
        tag: "input",
        type: "search",
        name: "q",
        placeholder: "Search products",
        ariaLabel: "Search"
      }
    ]
  });

  const semantics = extractFormSemantics(snapshot);
  assert.equal(semantics.searchForms.length, 1);
  assert.equal(semantics.searchForms[0].inputElementId, "el-search");
  assert.equal(semantics.searchForms[0].submitElementId, "el-search-submit");
  assert.equal(semantics.searchForms[0].confidence >= 0.8, true);
  assert.equal(semantics.searchForms[0].queryParamHint, "q");
});

test("form semantics extracts filter and pagination controls", () => {
  const snapshot = makeSnapshot({
    interactive: [
      {
        elementId: "el-filter-select",
        selector: "select[name='category']",
        tag: "select",
        name: "category",
        text: "Category",
        ariaLabel: "Filter by category",
        zone: "Primary Content",
        disabled: false
      },
      {
        elementId: "el-next",
        selector: "a.next",
        tag: "a",
        text: "Next",
        href: "https://example.com/products?page=2",
        disabled: false
      },
      {
        elementId: "el-prev",
        selector: "a.prev",
        tag: "a",
        text: "Previous",
        href: "https://example.com/products?page=1",
        disabled: false
      },
      {
        elementId: "el-page-2",
        selector: "a.page-2",
        tag: "a",
        text: "2",
        href: "https://example.com/products?page=2",
        disabled: false
      }
    ],
    formControls: [
      {
        selector: "select[name='category']",
        tag: "select",
        name: "category",
        ariaLabel: "Filter by category"
      }
    ]
  });

  const semantics = extractFormSemantics(snapshot);
  assert.equal(semantics.filterControls.some((item) => item.elementId === "el-filter-select"), true);
  assert.equal(semantics.paginationControls.length, 1);
  assert.equal(semantics.paginationControls[0].nextId, "el-next");
  assert.equal(semantics.paginationControls[0].prevId, "el-prev");
  assert.equal(semantics.paginationControls[0].pageLinks.includes("el-page-2"), true);
});

test("form semantics classifies risky forms", () => {
  const snapshot = makeSnapshot({
    interactive: [
      {
        elementId: "el-register",
        selector: "button#create-account",
        tag: "button",
        text: "Create account",
        ariaLabel: "",
        disabled: false
      },
      {
        elementId: "el-newsletter",
        selector: "input[name='newsletter_email']",
        tag: "input",
        type: "email",
        name: "newsletter_email",
        placeholder: "Subscribe to newsletter",
        ariaLabel: "",
        disabled: false
      }
    ],
    formControls: [
      {
        selector: "input[name='newsletter_email']",
        tag: "input",
        type: "email",
        name: "newsletter_email",
        placeholder: "Subscribe to newsletter",
        ariaLabel: ""
      }
    ]
  });

  const semantics = extractFormSemantics(snapshot);
  const types = semantics.riskyForms.map((item) => item.formType);
  assert.equal(types.includes("sign-up"), true);
  assert.equal(types.includes("newsletter"), true);
});

