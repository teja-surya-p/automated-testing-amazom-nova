import test from "node:test";
import assert from "node:assert/strict";

import { TEST_MODES } from "../../../library/schemas/runConfig.js";
import {
  SUPPORTED_TEST_MODES,
  TEST_MODE_ORDER
} from "../../../../../frontend/src/lib/launchFlow.js";

test("frontend and backend use a consistent functionality mode string", () => {
  assert.equal(TEST_MODES.includes("functional"), true);
  assert.equal(TEST_MODE_ORDER.includes("functional"), true);
  assert.equal(SUPPORTED_TEST_MODES.includes("functional"), true);
  assert.equal(TEST_MODES.includes("performance"), true);
  assert.equal(TEST_MODE_ORDER.includes("performance"), true);
  assert.equal(SUPPORTED_TEST_MODES.includes("performance"), true);

  assert.equal(TEST_MODES.includes("functionality"), false);
  assert.equal(TEST_MODE_ORDER.includes("functionality"), false);
  assert.equal(SUPPORTED_TEST_MODES.includes("functionality"), false);
});
