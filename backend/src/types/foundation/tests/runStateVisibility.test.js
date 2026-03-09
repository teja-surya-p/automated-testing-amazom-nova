import test from "node:test";
import assert from "node:assert/strict";

import {
  canShowStopButton,
  isRunActive
} from "../../../../../frontend/src/lib/runState.js";

test("stop button is visible only for active run states", () => {
  assert.equal(isRunActive("running"), true);
  assert.equal(isRunActive("login-assist"), true);
  assert.equal(isRunActive("cancelling"), true);
  assert.equal(isRunActive("passed"), false);
  assert.equal(isRunActive("cancelled"), false);

  assert.equal(canShowStopButton("running"), true);
  assert.equal(canShowStopButton("queued"), true);
  assert.equal(canShowStopButton("login-assist"), true);
  assert.equal(canShowStopButton("cancelling"), false);
  assert.equal(canShowStopButton("cancelled"), false);
  assert.equal(canShowStopButton("failed"), false);
});
