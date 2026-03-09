import test from "node:test";
import assert from "node:assert/strict";

import { FunctionalFlowGraph, buildFlowNode } from "../flowGraph.js";
import { discoverFlowCandidates } from "../flowDiscovery.js";

function makeSnapshot(overrides = {}) {
  return {
    url: "https://example.com/store",
    pageTypeHints: { isHome: true },
    semanticMap: [
      { text: "Home", zone: "Header", landmark: "navigation:main" },
      { text: "Products", zone: "Header", landmark: "navigation:main" }
    ],
    interactive: [],
    ...overrides
  };
}

test("flow graph creates deterministic node ids", () => {
  const nodeA = buildFlowNode(makeSnapshot());
  const nodeB = buildFlowNode(makeSnapshot());
  assert.equal(nodeA.nodeId, nodeB.nodeId);
  assert.equal(nodeA.urlCanonical, "https://example.com/store");
});

test("flow graph adds nodes and edges deterministically", () => {
  const graph = new FunctionalFlowGraph();
  const before = makeSnapshot({ url: "https://example.com/store" });
  const after = makeSnapshot({ url: "https://example.com/products" });

  graph.addTransition({
    fromSnapshot: before,
    toSnapshot: after,
    actionType: "click",
    selector: "a[href='/products']",
    label: "Products"
  });

  const json = graph.toJSON();
  assert.equal(json.nodes.length, 2);
  assert.equal(json.edges.length, 1);
  assert.equal(json.edges[0].actionType, "click");
});

test("flow discovery selects deterministic smoke-pack candidates", () => {
  const snapshot = makeSnapshot({
    interactive: [
      {
        elementId: "el-nav",
        tag: "a",
        text: "Products",
        ariaLabel: "",
        placeholder: "",
        name: "",
        zone: "Header",
        inViewport: true,
        disabled: false,
        href: "https://example.com/products",
        bounds: { y: 10, viewportY: 10 }
      },
      {
        elementId: "el-search",
        selector: "input[name='q']",
        tag: "input",
        type: "search",
        text: "",
        ariaLabel: "Search",
        placeholder: "Search products",
        name: "q",
        zone: "Header",
        inViewport: true,
        disabled: false,
        href: "",
        bounds: { y: 8, viewportY: 8 }
      },
      {
        elementId: "el-search-submit",
        selector: "button[aria-label='Search']",
        tag: "button",
        text: "Search",
        ariaLabel: "Search",
        zone: "Header",
        inViewport: true,
        disabled: false,
        href: "",
        bounds: { y: 10, viewportY: 10 }
      },
      {
        elementId: "el-item",
        tag: "a",
        text: "Item one",
        ariaLabel: "",
        placeholder: "",
        name: "",
        zone: "Primary Content",
        inViewport: true,
        disabled: false,
        href: "https://example.com/products/1",
        bounds: { y: 120, viewportY: 120 }
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

  const flows = discoverFlowCandidates({
    snapshot,
    runConfig: {
      functional: {
        maxFlows: 6,
        allowFormSubmit: true
      }
    }
  });

  assert.equal(flows.length >= 3, true);
  assert.equal(flows[0].flowType, "HOME_NAV_SMOKE");
  assert.equal(flows[1].flowType, "DETAIL_PAGE_SMOKE");
  assert.equal(flows[2].flowType, "SEARCH_SMOKE");
});

test("flow discovery excludes submit-based templates when submit is disabled", () => {
  const snapshot = makeSnapshot({
    interactive: [
      {
        elementId: "el-nav",
        tag: "a",
        text: "Products",
        zone: "Header",
        inViewport: true,
        disabled: false,
        href: "https://example.com/products",
        bounds: { y: 10, viewportY: 10 }
      },
      {
        elementId: "el-search",
        selector: "input[name='q']",
        tag: "input",
        type: "search",
        text: "",
        ariaLabel: "Search",
        placeholder: "Search products",
        name: "q",
        zone: "Header",
        inViewport: true,
        disabled: false,
        href: "",
        bounds: { y: 8, viewportY: 8 }
      }
    ],
    formControls: [
      {
        selector: "input[name='q']",
        tag: "input",
        type: "search",
        name: "q"
      }
    ]
  });

  const flows = discoverFlowCandidates({
    snapshot,
    runConfig: {
      functional: {
        maxFlows: 6,
        allowFormSubmit: false
      }
    }
  });

  assert.equal(flows.some((flow) => flow.flowType === "SEARCH_SMOKE"), false);
});
