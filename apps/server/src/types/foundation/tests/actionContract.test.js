import test from "node:test";
import assert from "node:assert/strict";

import { validateOrRepairActionPlan } from "../src/library/schemas/actionContract.js";

test("invalid plans are minimally repaired to a safe fallback", () => {
  const result = validateOrRepairActionPlan(
    {
      thinking: "Try something",
      action: {}
    },
    {
      interactive: []
    }
  );

  assert.equal(result.plan.isRepaired, true);
  assert.equal(result.plan.action.type, "wait");
  assert.equal(result.incident?.type, "PLAN_INVALID_REPAIRED");
});
