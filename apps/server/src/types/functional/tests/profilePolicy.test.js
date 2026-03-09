import test from "node:test";
import assert from "node:assert/strict";

import { resolveFunctionalProfilePolicy } from "../src/types/functional/profilePolicy.js";

test("profile policy passes through non-functional mode", () => {
  const result = resolveFunctionalProfilePolicy({
    runConfig: {
      testMode: "default",
      profileTag: ""
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.isFunctional, false);
  assert.equal(result.storageStateEnabled, true);
});

test("profile policy enforces profileTag when required in functional mode", () => {
  const result = resolveFunctionalProfilePolicy({
    runConfig: {
      testMode: "functional",
      profileTag: "",
      functional: {
        profile: {
          requireProfileTag: true,
          reuseProfileAcrossRuns: true
        }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "FUNCTIONAL_PROFILE_TAG_REQUIRED");
});

test("profile policy disables storage state reuse when configured", () => {
  const result = resolveFunctionalProfilePolicy({
    runConfig: {
      testMode: "functional",
      profileTag: "functional-regression",
      functional: {
        profile: {
          requireProfileTag: true,
          reuseProfileAcrossRuns: false
        }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.storageStateEnabled, false);
  assert.equal(result.reuseProfileAcrossRuns, false);
});

