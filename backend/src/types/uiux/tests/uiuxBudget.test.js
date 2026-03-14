import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUiuxEffectiveBudget,
  resolveUiuxLaunchBudgetDefaults,
  resolveUiuxTimeBudgetMs,
  shouldCapUiuxAllDeviceSelection
} from "../budget.js";
import { config } from "../../../lib/config.js";
import { baselineUiuxChecks } from "../checks/index.js";

function expectedUiuxDefaultMaxPages() {
  const cap = Math.max(50, Number(config.uiuxMaxPagesCap ?? 2000) || 2000);
  const fallback = Number(config.uiuxDefaultMaxPages ?? 120) || 120;
  return Math.min(Math.max(1, fallback), cap);
}

test("resolveUiuxTimeBudgetMs prefers uiux-specific budget over generic budget", () => {
  const resolved = resolveUiuxTimeBudgetMs(
    {
      uiux: { timeBudgetMs: 180000 },
      budgets: { timeBudgetMs: 240000 }
    },
    {}
  );
  assert.equal(resolved, 180000);
});

test("resolveUiuxTimeBudgetMs falls back to generic budget when uiux budget missing", () => {
  const resolved = resolveUiuxTimeBudgetMs(
    {
      budgets: { timeBudgetMs: 210000 }
    },
    {}
  );
  assert.equal(resolved, 210000);
});

test("resolveUiuxTimeBudgetMs uses mode-aware quick default when no explicit budget is provided", () => {
  const expected = resolveUiuxLaunchBudgetDefaults().quick;
  const resolved = resolveUiuxTimeBudgetMs(
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
  assert.equal(resolved, expected);
});

test("resolveUiuxTimeBudgetMs uses mode-aware full default when no explicit budget is provided", () => {
  const expected = resolveUiuxLaunchBudgetDefaults().full;
  const resolved = resolveUiuxTimeBudgetMs(
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
  assert.equal(resolved, expected);
});

test("resolveUiuxTimeBudgetMs uses mode-aware full-all default when all devices are requested", () => {
  const expected = resolveUiuxLaunchBudgetDefaults().fullAll;
  const resolved = resolveUiuxTimeBudgetMs(
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
  assert.equal(resolved, expected);
});

test("shouldCapUiuxAllDeviceSelection returns true when all devices are requested under low budget", () => {
  const shouldCap = shouldCapUiuxAllDeviceSelection({
    runConfig: {
      uiux: {
        devices: {
          mode: "full",
          selection: "all",
          maxDevices: 0
        }
      }
    },
    timeBudgetMs: 120000
  });
  assert.equal(shouldCap, true);
});

test("buildUiuxEffectiveBudget returns deterministic derived budget shape", () => {
  const budget = buildUiuxEffectiveBudget({
    runConfig: {
      uiux: {
        maxPages: 12,
        maxInteractionsPerPage: 5
      },
      budgets: {
        timeBudgetMs: 190000
      }
    }
  });

  assert.equal(budget.mode, "uiux");
  assert.equal(budget.timeBudgetMs, 190000);
  assert.equal(budget.maxPages, 12);
  assert.equal(budget.maxInteractionsPerPage, 5);
  assert.equal(budget.checkCount, baselineUiuxChecks.length);
  assert.equal(budget.deviceMode, "quick");
  assert.equal(budget.deviceSelection, "cap");
  assert.equal(budget.strategy, "component-breakpoint");
  assert.equal(budget.breakpointSettings.minWidth >= 240, true);
  assert.equal(budget.breakpointSettings.maxWidth > budget.breakpointSettings.minWidth, true);
  assert.equal(budget.sampledWidthEstimate > 0, true);
  assert.equal(budget.sampledHeightEstimate > 0, true);
  assert.equal(budget.sampledViewportEstimate >= budget.sampledWidthEstimate, true);
});

test("buildUiuxEffectiveBudget uses elevated default max pages for uiux coverage", () => {
  const budget = buildUiuxEffectiveBudget({
    runConfig: {
      uiux: {},
      budgets: {
        timeBudgetMs: 200_000
      }
    }
  });

  assert.equal(budget.maxPages, expectedUiuxDefaultMaxPages());
});
