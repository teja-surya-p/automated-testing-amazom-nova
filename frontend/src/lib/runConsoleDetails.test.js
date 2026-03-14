import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRunConsoleDetailToggleOptions,
  isRunConsoleDetailVisible,
  toggleRunConsoleDetailSelection
} from "./runConsoleDetails.js";

test("buildRunConsoleDetailToggleOptions returns base sections with failure count", () => {
  const options = buildRunConsoleDetailToggleOptions({
    mode: "default",
    failureCount: 3
  });

  const keys = options.map((entry) => entry.key);
  assert.deepEqual(keys, ["activity", "currentCase", "devices", "failures", "summary", "artifacts"]);
  assert.equal(options.find((entry) => entry.key === "failures")?.label, "Failures (3)");
});

test("buildRunConsoleDetailToggleOptions includes uiux-specific sections", () => {
  const options = buildRunConsoleDetailToggleOptions({
    mode: "uiux",
    advisoryCount: 2,
    hasUiuxHandbook: true
  });

  const keys = options.map((entry) => entry.key);
  assert.equal(keys.includes("advisories"), true);
  assert.equal(keys.includes("handbook"), true);
  assert.equal(options.find((entry) => entry.key === "advisories")?.label, "Advisories (2)");
});

test("buildRunConsoleDetailToggleOptions includes functional website docs only when available", () => {
  const noDocs = buildRunConsoleDetailToggleOptions({
    mode: "functional",
    hasWebsiteDocs: false
  });
  const withDocs = buildRunConsoleDetailToggleOptions({
    mode: "functional",
    hasWebsiteDocs: true
  });

  assert.equal(noDocs.some((entry) => entry.key === "websiteDocs"), false);
  assert.equal(withDocs.some((entry) => entry.key === "websiteDocs"), true);
});

test("toggleRunConsoleDetailSelection keeps single active section and allows deselect", () => {
  const first = toggleRunConsoleDetailSelection(null, "failures");
  assert.equal(first, "failures");

  const second = toggleRunConsoleDetailSelection(first, "summary");
  assert.equal(second, "summary");

  const third = toggleRunConsoleDetailSelection(second, "summary");
  assert.equal(third, null);
});

test("isRunConsoleDetailVisible validates selected and available keys", () => {
  assert.equal(isRunConsoleDetailVisible("summary", "summary"), true);
  assert.equal(isRunConsoleDetailVisible("summary", "failures"), false);
  assert.equal(isRunConsoleDetailVisible("summary", "summary", ["failures"]), false);
});
