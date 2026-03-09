import test from "node:test";
import assert from "node:assert/strict";

import { decideUiuxPaymentWall } from "../paymentWallPolicy.js";

test("uiux payment wall continues when alternate coverage paths exist", () => {
  const decision = decideUiuxPaymentWall({
    paymentWallDetected: true,
    frontierHasQueuedUrls: true,
    hasSafeCandidates: false
  });

  assert.equal(decision.shouldRecordIssue, true);
  assert.equal(decision.shouldBlockCurrentUrl, true);
  assert.equal(decision.shouldStopRun, false);
});

test("uiux payment wall stops only when no alternate paths remain", () => {
  const decision = decideUiuxPaymentWall({
    paymentWallDetected: true,
    frontierHasQueuedUrls: false,
    hasSafeCandidates: false
  });

  assert.equal(decision.shouldRecordIssue, true);
  assert.equal(decision.shouldBlockCurrentUrl, true);
  assert.equal(decision.shouldStopRun, true);
});
