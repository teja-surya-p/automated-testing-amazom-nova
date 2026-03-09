import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRunConfig,
  RunConfigValidationError
} from "../../../library/schemas/runConfig.js";
import { resolveUiuxTimeBudgetMs } from "../../uiux/budget.js";

test("run config supplies defaults that preserve current behavior", () => {
  const runConfig = parseRunConfig(
    {
      goal: "Search YouTube for a song",
      startUrl: "https://example.com/store"
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.testMode, "default");
  assert.equal(runConfig.artifacts.captureHtml, false);
  assert.equal(runConfig.artifacts.captureHar, false);
  assert.equal(runConfig.artifacts.captureTraceOnFail, false);
  assert.equal(runConfig.artifacts.captureVideo, "fail-only");
  assert.equal(runConfig.readiness.uiReadyStrategy, "networkidle-only");
  assert.equal(runConfig.uiux.maxPages, 24);
  assert.equal(runConfig.uiux.depthLimit, 6);
  assert.equal(runConfig.uiux.perDomainCap, 120);
  assert.equal(runConfig.uiux.maxInteractionsPerPage, 6);
  assert.equal(runConfig.uiux.timeBudgetMs, undefined);
  assert.equal(runConfig.uiux.viewports, undefined);
  assert.equal(runConfig.uiux.devices.mode, "quick");
  assert.equal(runConfig.uiux.devices.selection, "cap");
  assert.equal(runConfig.uiux.devices.maxDevices, 3);
  assert.equal(runConfig.uiux.devices.includeUserAgents, false);
  assert.deepEqual(runConfig.uiux.devices.allowlist, []);
  assert.deepEqual(runConfig.uiux.devices.blocklist, []);
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
  assert.equal(runConfig.accessibility.focusProbeTabSteps, 10);
  assert.equal(runConfig.accessibility.forms.enabled, true);
  assert.equal(runConfig.accessibility.forms.mode, "observe-only");
  assert.deepEqual(runConfig.accessibility.forms.safeSubmitTypes, ["search"]);
  assert.equal(runConfig.accessibility.forms.maxValidationAttemptsPerPage, 1);
  assert.equal(runConfig.accessibility.contrast.enabled, true);
  assert.equal(runConfig.accessibility.contrast.sampleLimit, 40);
  assert.equal(runConfig.accessibility.contrast.minRatioNormalText, 4.5);
  assert.equal(runConfig.accessibility.contrast.minRatioLargeText, 3.0);
  assert.equal(runConfig.accessibility.textScale.enabled, true);
  assert.deepEqual(runConfig.accessibility.textScale.scales, [1, 1.25, 1.5]);
  assert.equal(runConfig.accessibility.reducedMotion.enabled, true);
  assert.equal(runConfig.accessibility.ruleset, "wcag-lite");
  assert.equal(runConfig.accessibility.failOnCritical, true);
  assert.equal(runConfig.accessibility.baseline.mode, "off");
  assert.equal(runConfig.accessibility.baseline.baselineId, "");
});

test("functional mode requires profileTag by default", () => {
  assert.throws(
    () =>
      parseRunConfig(
        {
          goal: "Functional smoke",
          startUrl: "https://example.com/store",
          testMode: "functional"
        },
        {
          defaultStartUrl: "https://example.com/store"
        }
      ),
    (error) => {
      assert.equal(error instanceof RunConfigValidationError, true);
      assert.equal(error.error, "VALIDATION_ERROR");
      assert.equal(Array.isArray(error.issues), true);
      assert.equal(error.issues[0].path.join("."), "runConfig.profileTag");
      return true;
    }
  );
});

test("empty goal fails with clear runConfig issue path", () => {
  assert.throws(
    () =>
      parseRunConfig(
        {
          goal: "",
          startUrl: "https://example.com/store",
          testMode: "default"
        },
        {
          defaultStartUrl: "https://example.com/store"
        }
      ),
    (error) => {
      assert.equal(error instanceof RunConfigValidationError, true);
      assert.equal(error.error, "VALIDATION_ERROR");
      assert.equal(error.issues[0].path.join("."), "runConfig.goal");
      assert.equal(error.issues[0].code, "custom");
      return true;
    }
  );
});

test("non-default mode auto-generates goal when missing", () => {
  const runConfig = parseRunConfig(
    {
      startUrl: "https://example.com/store",
      testMode: "uiux"
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.goal, "uiux scan for https://example.com/store");
});

test("uiux mode applies uiux coverage caps onto exploration/time budget", () => {
  const runConfig = parseRunConfig(
    {
      startUrl: "https://example.com/store",
      testMode: "uiux",
      uiux: {
        depthLimit: 4,
        timeBudgetMs: 120000,
        maxPages: 10,
        perDomainCap: 25,
        maxInteractionsPerPage: 3
      }
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.exploration.depthLimit, 4);
  assert.equal(runConfig.budgets.timeBudgetMs, 120000);
  assert.equal(runConfig.uiux.maxPages, 10);
  assert.equal(runConfig.uiux.perDomainCap, 25);
  assert.equal(runConfig.uiux.maxInteractionsPerPage, 3);
  assert.equal(runConfig.uiux.devices.mode, "quick");
  assert.equal(runConfig.uiux.devices.maxDevices, 3);
});

test("uiux mode uses explicit uiux default time budget when omitted", () => {
  const expected = resolveUiuxTimeBudgetMs(
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "quick"
        }
      }
    },
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "quick"
        }
      }
    }
  );
  const runConfig = parseRunConfig(
    {
      startUrl: "https://example.com/store",
      testMode: "uiux"
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.budgets.timeBudgetMs, expected);
  assert.equal(runConfig.uiux.timeBudgetMs, expected);
});

test("uiux full mode defaults to a larger budget", () => {
  const expected = resolveUiuxTimeBudgetMs(
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full",
          selection: "cap"
        }
      }
    },
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full",
          selection: "cap"
        }
      }
    }
  );
  const runConfig = parseRunConfig(
    {
      startUrl: "https://example.com/store",
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full"
        }
      }
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.budgets.timeBudgetMs, expected);
  assert.equal(runConfig.uiux.timeBudgetMs, expected);
});

test("uiux full device mode applies cap defaults and supports all-mode with maxDevices=0", () => {
  const expectedFullCapBudget = resolveUiuxTimeBudgetMs(
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full",
          selection: "cap"
        }
      }
    },
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full",
          selection: "cap"
        }
      }
    }
  );
  const expectedFullAllBudget = resolveUiuxTimeBudgetMs(
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full",
          selection: "all",
          maxDevices: 0
        }
      }
    },
    {
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full",
          selection: "all",
          maxDevices: 0
        }
      }
    }
  );
  const capped = parseRunConfig(
    {
      startUrl: "https://example.com/store",
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full"
        }
      }
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(capped.uiux.devices.mode, "full");
  assert.equal(capped.uiux.devices.selection, "cap");
  assert.equal(capped.uiux.devices.maxDevices, 250);
  assert.equal(capped.budgets.timeBudgetMs, expectedFullCapBudget);
  assert.equal(capped.uiux.timeBudgetMs, expectedFullCapBudget);

  const all = parseRunConfig(
    {
      startUrl: "https://example.com/store",
      testMode: "uiux",
      uiux: {
        devices: {
          mode: "full",
          selection: "all",
          maxDevices: 0
        }
      }
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(all.uiux.devices.mode, "full");
  assert.equal(all.uiux.devices.selection, "all");
  assert.equal(all.uiux.devices.maxDevices, 0);
  assert.equal(all.budgets.timeBudgetMs, expectedFullAllBudget);
  assert.equal(all.uiux.timeBudgetMs, expectedFullAllBudget);
});

test("uiux all-device selection with low explicit budget is safely capped", () => {
  const runConfig = parseRunConfig(
    {
      startUrl: "https://example.com/store",
      testMode: "uiux",
      budgets: {
        timeBudgetMs: 120000
      },
      uiux: {
        devices: {
          mode: "full",
          selection: "all",
          maxDevices: 0
        }
      }
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.budgets.timeBudgetMs, 120000);
  assert.equal(runConfig.uiux.timeBudgetMs, 120000);
  assert.equal(runConfig.uiux.devices.mode, "full");
  assert.equal(runConfig.uiux.devices.selection, "cap");
  assert.equal(runConfig.uiux.devices.maxDevices, 250);
});

test("wrapped runConfig payload shape parses successfully", () => {
  const runConfig = parseRunConfig(
    {
      runConfig: {
        goal: "Smoke run",
        startUrl: "https://example.com/store",
        testMode: "default"
      }
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.goal, "Smoke run");
  assert.equal(runConfig.startUrl, "https://example.com/store");
});

test("accessibility mode enforces coverage defaults and a11y snapshots", () => {
  const runConfig = parseRunConfig(
    {
      goal: "Accessibility scan",
      startUrl: "https://example.com/store",
      testMode: "accessibility"
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );

  assert.equal(runConfig.exploration.strategy, "coverage-driven");
  assert.equal(runConfig.exploration.urlFrontierEnabled, true);
  assert.equal(runConfig.exploration.canonicalizeUrls, true);
  assert.equal(runConfig.artifacts.captureA11ySnapshot, true);
  assert.equal(runConfig.uiux.artifactRetention.keepDomForIssuesOnly, true);
});
