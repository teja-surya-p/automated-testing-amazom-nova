import test from "node:test";
import assert from "node:assert/strict";

import { parseRunConfig } from "../src/library/schemas/runConfig.js";

test("run config supplies defaults that preserve current behavior", () => {
  const runConfig = parseRunConfig(
    {
      goal: "Search YouTube for a song",
      startUrl: "http://localhost:4174/store"
    },
    {
      defaultStartUrl: "http://localhost:4174/store"
    }
  );

  assert.equal(runConfig.testMode, "default");
  assert.equal(runConfig.artifacts.captureHtml, false);
  assert.equal(runConfig.artifacts.captureHar, false);
  assert.equal(runConfig.artifacts.captureTraceOnFail, false);
  assert.equal(runConfig.artifacts.captureVideo, "fail-only");
  assert.equal(runConfig.readiness.uiReadyStrategy, "networkidle-only");
  assert.equal(runConfig.uiux.artifactRetention.maxSnapshotsPerViewport, 12);
  assert.equal(runConfig.uiux.artifactRetention.keepOnlyFailedOrFlaggedSteps, false);
  assert.equal(runConfig.uiux.artifactRetention.keepDomForIssuesOnly, false);
  assert.equal(runConfig.uiux.baseline.mode, "off");
  assert.equal(runConfig.uiux.baseline.baselineId, "");
  assert.equal(runConfig.functional.strategy, "smoke-pack");
  assert.equal(runConfig.functional.maxFlows, 6);
  assert.equal(runConfig.functional.maxStepsPerFlow, 12);
  assert.equal(runConfig.functional.allowFormSubmit, false);
  assert.deepEqual(runConfig.functional.allowedSubmitTypes, ["search", "filter", "pagination"]);
  assert.equal(runConfig.functional.testDataProfile, "synthetic");
  assert.equal(runConfig.functional.loginAssist.enabled, true);
  assert.equal(runConfig.functional.loginAssist.timeoutMs, 180000);
  assert.equal(runConfig.functional.loginAssist.resumeStrategy, "restart-flow");
  assert.equal(runConfig.functional.capabilities.allowNewTabs, true);
  assert.equal(runConfig.functional.capabilities.allowDownloads, true);
  assert.equal(runConfig.functional.capabilities.allowUploads, false);
  assert.equal(runConfig.functional.capabilities.uploadFixturePath, "fixtures/upload.txt");
  assert.equal(runConfig.functional.readiness.strategy, "hybrid");
  assert.equal(runConfig.functional.readiness.postClickSettleMs, 800);
  assert.equal(runConfig.functional.profile.requireProfileTag, true);
  assert.equal(runConfig.functional.profile.reuseProfileAcrossRuns, true);
  assert.equal(runConfig.functional.assertions.failOnConsoleError, true);
  assert.equal(runConfig.functional.assertions.failOn5xx, true);
  assert.equal(runConfig.functional.contracts.failOnApi5xx, true);
  assert.equal(runConfig.functional.contracts.warnOnThirdPartyFailures, true);
  assert.deepEqual(runConfig.functional.contracts.endpointAllowlistPatterns, []);
  assert.deepEqual(runConfig.functional.contracts.endpointBlocklistPatterns, []);
  assert.equal(runConfig.functional.baseline.mode, "off");
  assert.equal(runConfig.functional.baseline.baselineId, "");
  assert.equal(runConfig.accessibility.strategy, "coverage-a11y");
  assert.equal(runConfig.accessibility.maxPages, 20);
  assert.equal(runConfig.accessibility.ruleset, "wcag-lite");
  assert.equal(runConfig.accessibility.failOnCritical, true);
  assert.equal(runConfig.accessibility.baseline.mode, "off");
  assert.equal(runConfig.accessibility.baseline.baselineId, "");
});

test("functional mode requires profileTag by default", () => {
  assert.throws(() =>
    parseRunConfig(
      {
        goal: "Functional smoke",
        startUrl: "http://localhost:4174/store",
        testMode: "functional"
      },
      {
        defaultStartUrl: "http://localhost:4174/store"
      }
    )
  );
});

test("accessibility mode enforces coverage defaults and a11y snapshots", () => {
  const runConfig = parseRunConfig(
    {
      goal: "Accessibility scan",
      startUrl: "http://localhost:4174/store",
      testMode: "accessibility"
    },
    {
      defaultStartUrl: "http://localhost:4174/store"
    }
  );

  assert.equal(runConfig.exploration.strategy, "coverage-driven");
  assert.equal(runConfig.exploration.urlFrontierEnabled, true);
  assert.equal(runConfig.exploration.canonicalizeUrls, true);
  assert.equal(runConfig.artifacts.captureA11ySnapshot, true);
  assert.equal(runConfig.uiux.artifactRetention.keepDomForIssuesOnly, true);
});
