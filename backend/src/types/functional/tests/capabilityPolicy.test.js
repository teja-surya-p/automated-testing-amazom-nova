import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateUploadCapability,
  resolveFunctionalCapabilities,
  resolveFunctionalReadiness
} from "../capabilityPolicy.js";

test("functional capabilities resolve safe defaults", () => {
  const capabilities = resolveFunctionalCapabilities({
    functional: {
      capabilities: {}
    }
  });
  assert.equal(capabilities.allowNewTabs, true);
  assert.equal(capabilities.allowDownloads, true);
  assert.equal(capabilities.allowUploads, false);
  assert.equal(capabilities.uploadFixturePath, "fixtures/upload.txt");
});

test("functional readiness resolves hybrid defaults", () => {
  const readiness = resolveFunctionalReadiness({
    functional: {
      readiness: {}
    }
  });
  assert.equal(readiness.strategy, "hybrid");
  assert.equal(readiness.postClickSettleMs, 800);
});

test("upload capability blocks when allowUploads is false", () => {
  const decision = evaluateUploadCapability({
    runConfig: {
      functional: {
        capabilities: {
          allowUploads: false
        }
      }
    },
    target: {
      text: "Profile picture upload"
    }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.blockerType, "UPLOAD_REQUIRED");
});

test("upload capability allows high-confidence non-destructive upload target", () => {
  const decision = evaluateUploadCapability({
    runConfig: {
      functional: {
        capabilities: {
          allowUploads: true
        }
      }
    },
    target: {
      text: "Upload profile photo",
      ariaLabel: "Profile picture"
    }
  });

  assert.equal(decision.allowed, true);
});

test("upload capability blocks risky upload target semantics", () => {
  const decision = evaluateUploadCapability({
    runConfig: {
      functional: {
        capabilities: {
          allowUploads: true
        }
      }
    },
    target: {
      text: "Upload payment receipt",
      ariaLabel: "Invoice upload"
    }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.blockerType, "UPLOAD_REQUIRED");
});

