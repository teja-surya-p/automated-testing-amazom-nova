import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeUiuxComponentBreakpoints,
  buildCoarseHeightSweep,
  buildCoarseWidthSweep,
  discoverUiuxComponents,
  resolveUiuxBreakpointSettings,
  runWithBoundedConcurrency
} from "../componentBreakpointAnalysis.js";

function makeSnapshot(width = 390) {
  return {
    step: 1,
    url: "https://example.com/pricing",
    viewportWidth: width,
    viewportHeight: 900,
    screenshotUrl: `/artifacts/frame-${width}.png`,
    screenshotPath: `/tmp/frame-${width}.png`,
    responsiveSignals: {
      majorOverflowContainers: [
        {
          selector: "#pricing-table",
          overflowPx: width <= 430 ? 120 : 0,
          bounds: {
            x: 12,
            y: 220,
            width: Math.max(width - 24, 300),
            height: 320
          }
        }
      ],
      mediaOverflowItems: [],
      severeAlignment: {
        candidates: [],
        candidateCount: 0
      }
    },
    dataDisplaySignals: {
      problematicRegions: width <= 430
        ? [
            {
              selector: "#pricing-table",
              kind: "table",
              bounds: {
                x: 12,
                y: 220,
                width: Math.max(width - 24, 300),
                height: 320
              }
            }
          ]
        : []
    },
    headerLandmarks: [
      {
        selector: "header nav",
        text: "Top nav",
        bounds: {
          x: 0,
          y: 0,
          width,
          height: 72
        }
      }
    ],
    primaryCta: {
      selector: "#start-trial",
      text: "Start trial",
      bounds: {
        x: 24,
        y: 140,
        width: 180,
        height: 48
      }
    },
    formControlDescriptors: [],
    overlays: []
  };
}

test("discoverUiuxComponents is deterministic for same snapshot", () => {
  const snapshot = makeSnapshot(390);
  const first = discoverUiuxComponents(snapshot, { maxComponents: 12 });
  const second = discoverUiuxComponents(snapshot, { maxComponents: 12 });

  assert.deepEqual(
    first.map((entry) => entry.id),
    second.map((entry) => entry.id)
  );
  assert.equal(first.some((entry) => entry.type === "primary-nav"), true);
  assert.equal(first.some((entry) => entry.type === "table"), true);
});

test("breakpoint settings and coarse sweep are normalized predictably", () => {
  const settings = resolveUiuxBreakpointSettings({
    uiux: {
      breakpoints: {
        minWidth: 360,
        maxWidth: 600,
        coarseStep: 80,
        fineStep: 20
      }
    }
  });

  assert.equal(settings.minWidth, 360);
  assert.equal(settings.maxWidth, 600);
  assert.equal(buildCoarseWidthSweep(settings).includes(360), true);
  assert.equal(buildCoarseWidthSweep(settings).includes(390), true);
  assert.equal(buildCoarseWidthSweep(settings).includes(600), true);
});

test("coarse height sweep includes device-like anchors and base viewport", () => {
  const settings = resolveUiuxBreakpointSettings({
    uiux: {
      breakpoints: {
        minHeight: 560,
        maxHeight: 1100,
        maxHeightsPerPage: 6
      }
    }
  });
  const heights = buildCoarseHeightSweep(settings, 844);
  assert.equal(heights.includes(560), true);
  assert.equal(heights.includes(844), true);
  assert.equal(heights.some((height) => height >= 900), true);
  assert.equal(heights.length <= 6, true);
});

test("bounded concurrency worker keeps deterministic output ordering", async () => {
  const values = [1, 2, 3, 4, 5];
  const result = await runWithBoundedConcurrency(
    values,
    async (value) => value * 10,
    3
  );
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
});

test("component breakpoint analysis groups responsive failures by component and width range", async () => {
  let currentWidth = 390;
  let currentHeight = 900;
  const browserSession = {
    async setViewportSize(viewport) {
      currentWidth = Number(viewport.width);
      currentHeight = Number(viewport.height);
    },
    async waitForUIReady() {},
    async capture() {
      const snapshot = makeSnapshot(currentWidth);
      return {
        ...snapshot,
        viewportHeight: currentHeight,
        viewportLabel: `w-${currentWidth}-h-${currentHeight}`,
        screenshotUrl: `/artifacts/frame-${currentWidth}x${currentHeight}.png`,
        screenshotPath: `/tmp/frame-${currentWidth}x${currentHeight}.png`
      };
    }
  };
  const uiuxRunner = {
    run({ snapshot }) {
      if (snapshot.viewportWidth <= 430 && snapshot.viewportHeight <= 1024) {
        return [
          {
            issueType: "TABLE_CHART_MOBILE_USABILITY",
            severity: "P1",
            title: "Table is hard to use on narrow screens",
            expected: "Table should remain usable on mobile widths.",
            actual: "Horizontal panning is required to read core columns.",
            confidence: 0.91,
            evidenceRefs: [],
            affectedSelector: "#pricing-table",
            affectedUrl: snapshot.url,
            viewportLabel: `w-${snapshot.viewportWidth}-h-${snapshot.viewportHeight}`,
            calibratedJudgment: {
              verdict: "FAIL"
            }
          }
        ];
      }
      return [];
    }
  };

  const result = await analyzeUiuxComponentBreakpoints({
    browserSession,
    uiuxRunner,
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      },
      uiux: {
        breakpoints: {
          minWidth: 320,
          maxWidth: 560,
          coarseStep: 80,
          fineStep: 20,
          minHeight: 640,
          maxHeight: 1100,
          maxConcurrentWorkers: 3,
          maxNearbyViewportProbes: 10
        }
      }
    },
    baseSnapshot: makeSnapshot(390),
    stage: "navigation"
  });

  assert.equal(result.groupedIssues.length >= 1, true);
  const tableIssue = result.groupedIssues.find((issue) => issue.issueType === "TABLE_CHART_MOBILE_USABILITY");
  assert.ok(tableIssue);
  assert.equal(tableIssue.componentType, "table");
  assert.equal(tableIssue.breakpointRange.minWidth <= 430, true);
  assert.equal(tableIssue.breakpointRange.maxWidth >= 320, true);
  assert.equal(tableIssue.heightRange.minHeight <= 1024, true);
  assert.equal(Array.isArray(tableIssue.heightRanges), true);
  assert.equal(Array.isArray(tableIssue.representativeViewports), true);
  assert.equal(tableIssue.representativeViewports.length >= 1, true);
  assert.equal(tableIssue.confirmedFailingViewport?.width <= 430, true);
  assert.equal(tableIssue.confirmedFailingViewport?.height <= 1024, true);
  assert.equal(typeof tableIssue.confirmedFailingViewport?.screenshotRef, "string");
  assert.equal(Array.isArray(tableIssue.representativeWidths), true);
  assert.equal(Array.isArray(result.sampledHeights), true);
  assert.equal(result.sampledHeights.length >= 1, true);
  assert.equal(result.breakpointSummary.sampledHeightCount >= 1, true);
  assert.equal(Array.isArray(result.breakpointSummary.representativeViewports), true);
  assert.equal(result.pageMatrixEntries.length >= 1, true);
  assert.equal(Number.isFinite(result.pageMatrixEntries[0].viewportWidth), true);
  assert.equal(Number.isFinite(result.pageMatrixEntries[0].viewportHeight), true);
  assert.equal(typeof result.pageMatrixEntries[0].screenshotRef, "string");
});

test("capture progress entries include snapshots for live viewer updates", async () => {
  let currentWidth = 390;
  let currentHeight = 900;
  const progressEvents = [];
  const browserSession = {
    async setViewportSize(viewport) {
      currentWidth = Number(viewport.width);
      currentHeight = Number(viewport.height);
    },
    async waitForUIReady() {},
    async capture() {
      return {
        ...makeSnapshot(currentWidth),
        viewportHeight: currentHeight,
        screenshotBase64: "ZmFrZS1zY3JlZW5zaG90"
      };
    }
  };
  const uiuxRunner = {
    run() {
      return [];
    }
  };

  await analyzeUiuxComponentBreakpoints({
    browserSession,
    uiuxRunner,
    runConfig: {
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 1_000
      },
      uiux: {
        breakpoints: {
          minWidth: 360,
          maxWidth: 430,
          coarseStep: 35,
          fineStep: 15,
          minHeight: 640,
          maxHeight: 900,
          maxConcurrentWorkers: 2,
          maxNearbyViewportProbes: 2
        }
      }
    },
    baseSnapshot: {
      ...makeSnapshot(390),
      screenshotBase64: "YmFzZS1zY3JlZW5zaG90"
    },
    stage: "navigation",
    onProgress: (payload) => {
      progressEvents.push(payload);
    }
  });

  const captureEvents = progressEvents.filter((entry) =>
    ["coarse-capture", "refined-capture", "nearby-capture"].includes(entry.phase)
  );
  assert.equal(captureEvents.length > 0, true);
  assert.equal(captureEvents.every((entry) => Boolean(entry.snapshot)), true);
  const firstCapture = captureEvents[0];
  assert.equal(Number.isFinite(firstCapture.snapshot?.viewportWidth), true);
  assert.equal(Number.isFinite(firstCapture.snapshot?.viewportHeight), true);
});
