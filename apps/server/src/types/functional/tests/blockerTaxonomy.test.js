import test from "node:test";
import assert from "node:assert/strict";

import { getBlockerResolutionHint, toFunctionalBlocker } from "../src/types/functional/blockerTaxonomy.js";

test("blocker taxonomy returns deterministic resolution hints", () => {
  assert.equal(
    getBlockerResolutionHint("LOGIN_REQUIRED").includes("Login Assist"),
    true
  );
  assert.equal(
    getBlockerResolutionHint("DOWNLOAD_TRIGGERED").includes("downloaded artifact exists"),
    true
  );
});

test("toFunctionalBlocker enriches blockers with resolutionHint", () => {
  const blocker = toFunctionalBlocker({
    type: "PAYMENT_REQUIRED",
    confidence: 0.95,
    rationale: "Payment wall detected."
  });

  assert.equal(blocker.type, "PAYMENT_REQUIRED");
  assert.equal(blocker.confidence, 0.95);
  assert.equal(blocker.resolutionHint.includes("Stop before payment"), true);
});

