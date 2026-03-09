import test from "node:test";
import assert from "node:assert/strict";

import {
  SafetyPolicy,
  evaluateDomainAccess,
  isDestructiveAction,
  isLogoutAction
} from "../../../library/policies/safetyPolicy.js";

test("destructive classifier blocks destructive account action", () => {
  const plan = {
    actionType: "click",
    target: {
      semanticId: "el-1",
      locator: "button[data-testid='delete-account']",
      fallback: "Delete account"
    },
    rationale: "Delete the current account",
    safetyTags: [],
    expectedStateChange: "The account should be removed."
  };

  assert.equal(isDestructiveAction(plan), true);
});

test("allowlist and blocklist domain logic is enforced", () => {
  const allowed = evaluateDomainAccess("https://app.example.com/dashboard", {
    allowlistDomains: ["example.com"],
    blocklistDomains: []
  });
  const blocked = evaluateDomainAccess("https://evil.example.net", {
    allowlistDomains: ["example.com"],
    blocklistDomains: ["evil.example.net"]
  });

  assert.equal(allowed.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, "DOMAIN_BLOCKLISTED");
});

test("logout is blocked in non-crawler mode", () => {
  const policy = new SafetyPolicy();
  const plan = {
    actionType: "click",
    target: {
      semanticId: "el-9",
      locator: "button[aria-label='Log out']",
      fallback: "Log out"
    },
    rationale: "Open the log out action",
    safetyTags: [],
    expectedStateChange: "The user should be logged out."
  };

  assert.equal(isLogoutAction(plan), true);

  const result = policy.evaluateBeforeAction({
    runConfig: {
      crawlerMode: false,
      safety: {
        allowlistDomains: [],
        blocklistDomains: [],
        destructiveActionPolicy: "strict",
        paymentWallStop: true
      }
    },
    actionPlan: plan,
    snapshot: null,
    currentUrl: "https://example.com"
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, "LOGOUT_BLOCKED");
});
