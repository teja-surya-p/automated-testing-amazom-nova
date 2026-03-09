import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_UIUX_VIEWPORTS, selectViewportSweepCandidates } from "../viewportSweep.js";

test("viewport sweep keeps all configured viewports when budget allows", () => {
  const candidates = selectViewportSweepCandidates({
    viewports: DEFAULT_UIUX_VIEWPORTS,
    currentViewportLabel: "desktop",
    elapsedMs: 5_000,
    timeBudgetMs: 30_000,
    minViewportBudgetMs: 3_500
  });

  assert.deepEqual(
    candidates.map((viewport) => viewport.label),
    ["mobile", "tablet"]
  );
});

test("viewport sweep deterministically skips remaining viewports when budget is low", () => {
  const candidates = selectViewportSweepCandidates({
    viewports: DEFAULT_UIUX_VIEWPORTS,
    currentViewportLabel: "desktop",
    elapsedMs: 24_000,
    timeBudgetMs: 30_000,
    minViewportBudgetMs: 4_000
  });

  assert.deepEqual(
    candidates.map((viewport) => viewport.label),
    ["mobile"]
  );
});
