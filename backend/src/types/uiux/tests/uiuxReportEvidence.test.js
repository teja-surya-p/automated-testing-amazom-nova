import test from "node:test";
import assert from "node:assert/strict";

import { buildRunReport } from "../../../services/reportBuilder.js";

function makeSession(overrides = {}) {
  return {
    id: "qa_uiux_report_test",
    status: "failed",
    goal: "UI/UX scan",
    startUrl: "https://example.com",
    currentUrl: "https://example.com/pricing",
    primaryBlocker: null,
    outcome: {
      targetAchieved: false,
      blockers: [],
      nextBestAction: "REVIEW_UIUX_REPORT",
      evidenceQualityScore: 0.84
    },
    runConfig: {
      testMode: "uiux",
      exploration: {
        strategy: "coverage-driven"
      },
      uiux: {
        artifactRetention: {
          keepOnlyFailedOrFlaggedSteps: false,
          keepDomForIssuesOnly: false
        }
      }
    },
    timeline: [],
    incidents: [],
    observations: [],
    steps: [],
    artifactIndex: {},
    uiux: {
      enabled: true,
      pagesVisited: ["https://example.com/pricing"],
      uniqueStateHashes: ["abc123"],
      interactionsAttempted: 1,
      interactionsSkippedBySafety: 0,
      artifactsPrunedCount: 0,
      artifactsRetainedCount: 1,
      pageDeviceMatrix: [],
      deviceSummary: [],
      issues: [
        {
          issueType: "TEXT_OVERFLOW_CLIP",
          title: "Primary CTA text is clipped",
          severity: "P1",
          expected: "CTA label should fit visible bounds.",
          actual: "Button text \"Start free trial\" is clipped in the current viewport.",
          exactVisibleText: "Start free trial",
          confidence: 0.9,
          affectedUrl: "https://example.com/pricing",
          affectedSelector: "button.primary-cta",
          step: 12,
          viewportLabel: "Apple iPhone 15 Pro (390x844 @3x)",
          deviceLabel: "Apple iPhone 15 Pro (390x844 @3x)",
          deviceId: "apple-iphone-15-pro-390-844-3x",
          evidenceRefs: [
            {
              type: "screenshot",
              ref: "/artifacts/qa_uiux_report_test/frames/step-012.png",
              captureMode: "viewport"
            }
          ],
          explanation: {
            whatHappened: "CTA text is visually cut off.",
            whyItFailed: "The label overflows the control bounds.",
            whyItMatters: "Users may not understand the action.",
            recommendedFix: ["Increase CTA width or allow wrapping."]
          },
          highlightSources: {
            viewport: { width: 390, height: 844 },
            selectorBounds: { x: 40, y: 510, width: 180, height: 42 },
            overlayBounds: null,
            primaryCtaBounds: null
          }
        }
      ],
      clusters: []
    },
    accessibility: {
      enabled: false,
      pagesScanned: [],
      issues: [],
      clusters: []
    },
    functional: {
      enabled: false,
      flowsRun: 0,
      issues: [],
      blockers: [],
      assertionCounts: {
        evaluated: 0,
        passed: 0,
        failed: 0
      },
      deviceSummary: []
    },
    ...overrides
  };
}

test("uiux report includes viewport evidence capture mode, explanation, and highlight metadata", () => {
  const report = buildRunReport(makeSession());
  const issue = report.uiux?.issues?.[0];

  assert.equal(issue.evidenceRefs?.[0]?.captureMode, "viewport");
  assert.equal(issue.summary, "CTA text is visually cut off.");
  assert.equal(issue.explanation?.whatHappened, "CTA text is visually cut off.");
  assert.equal(issue.explanation?.whyItFailed, "The label overflows the control bounds.");
  assert.equal(issue.highlight?.kind, "box");
  assert.deepEqual(issue.highlight?.box, { x: 40, y: 510, width: 180, height: 42 });
  assert.equal(issue.highlight?.label, "Primary CTA text is clipped");
  assert.equal(issue.rawDetectorResult?.verdict, "FAIL");
  assert.equal(issue.calibratedJudgment?.verdict, "FAIL");
  assert.equal(issue.isDefect, true);
});

test("uiux report builds deterministic summary and whyItFailed fallback when explanation is partial", () => {
  const report = buildRunReport(
    makeSession({
      uiux: {
        enabled: true,
        pagesVisited: ["https://example.com/pricing"],
        uniqueStateHashes: ["abc123"],
        interactionsAttempted: 1,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 1,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [
          {
            issueType: "HORIZONTAL_SCROLL",
            title: "Horizontal scrolling detected",
            severity: "P1",
            actual: "Page width exceeds viewport by 64px.",
            affectedUrl: "https://example.com/pricing",
            viewportLabel: "mobile",
            deviceLabel: "mobile",
            highlightSources: {
              viewport: { width: 390, height: 844 },
              selectorBounds: null,
              overlayBounds: null,
              primaryCtaBounds: null
            },
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/step-013.png",
                captureMode: "viewport"
              }
            ],
            explanation: {
              whatHappened: "The layout overflows the visible viewport."
            }
          }
        ],
        clusters: []
      }
    })
  );

  const issue = report.uiux?.issues?.[0];
  assert.equal(issue.summary, "The layout overflows the visible viewport.");
  assert.equal(issue.explanation?.whatHappened, "The layout overflows the visible viewport.");
  assert.equal(issue.explanation?.whyItFailed, "Page width exceeds viewport by 64px.");
});

test("uiux report groups same issue across devices with one primary evidence record", () => {
  const report = buildRunReport(
    makeSession({
      uiux: {
        enabled: true,
        pagesVisited: ["https://example.com/pricing"],
        uniqueStateHashes: ["abc123"],
        interactionsAttempted: 1,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 2,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [
          {
            issueType: "TEXT_OVERFLOW_CLIP",
            testcaseId: "TEXT_OVERFLOW_CLIP",
            title: "Primary CTA text is clipped",
            severity: "P1",
            confidence: 0.72,
            expected: "CTA label should fit visible bounds.",
            actual: "Button text \"Start free trial\" is clipped in mobile viewport.",
            exactVisibleText: "Start free trial",
            affectedUrl: "https://example.com/pricing?ref=mobile",
            affectedSelector: "button.primary-cta",
            step: 9,
            viewportLabel: "Apple iPhone 12 (360x800 @2x)",
            deviceLabel: "Apple iPhone 12 (360x800 @2x)",
            deviceId: "apple-iphone-12-360-800-2x",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/mobile-step-009.png",
                captureMode: "viewport"
              }
            ],
            explanation: {
              whatHappened: "The primary CTA label is clipped.",
              whyItFailed: "The label overflows the button bounds."
            },
            highlightSources: {
              viewport: { width: 360, height: 800 },
              selectorBounds: { x: 24, y: 500, width: 170, height: 40 },
              overlayBounds: null,
              primaryCtaBounds: null
            }
          },
          {
            issueType: "TEXT_OVERFLOW_CLIP",
            testcaseId: "TEXT_OVERFLOW_CLIP",
            title: "Primary CTA text is clipped",
            severity: "P1",
            confidence: 0.96,
            expected: "CTA label should fit visible bounds.",
            actual: "Button text \"Start free trial\" is clipped in tablet viewport.",
            exactVisibleText: "Start free trial",
            affectedUrl: "https://example.com/pricing",
            affectedSelector: "button.primary-cta",
            step: 11,
            viewportLabel: "Apple iPad Air 5 (820x1180 @2x)",
            deviceLabel: "Apple iPad Air 5 (820x1180 @2x)",
            deviceId: "apple-ipad-air-5-820-1180-2x",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/tablet-step-011.png",
                captureMode: "viewport"
              }
            ],
            explanation: {
              whatHappened: "The primary CTA label is clipped.",
              whyItFailed: "The label overflows the button bounds."
            },
            highlightSources: {
              viewport: { width: 820, height: 1180 },
              selectorBounds: { x: 54, y: 560, width: 210, height: 44 },
              overlayBounds: null,
              primaryCtaBounds: null
            }
          }
        ],
        clusters: []
      }
    })
  );

  const groupedIssues = report.uiux?.groupedIssues ?? [];
  assert.equal(groupedIssues.length, 1);
  assert.equal(groupedIssues[0].occurrenceCount, 2);
  assert.equal(groupedIssues[0].devices.length, 2);
  assert.equal(groupedIssues[0].evidenceRefs.length, 1);
  assert.equal(groupedIssues[0].primaryEvidence.screenshotRef, "/artifacts/qa_uiux_report_test/frames/tablet-step-011.png");
  assert.equal(groupedIssues[0].primaryEvidence.captureMode, "viewport");
  assert.equal(
    groupedIssues[0].devices.map((device) => device.deviceLabel).join("|"),
    "Apple iPad Air 5 (820x1180 @2x)|Apple iPhone 12 (360x800 @2x)"
  );
});

test("uiux grouped issues do not merge unrelated failures", () => {
  const report = buildRunReport(
    makeSession({
      uiux: {
        enabled: true,
        pagesVisited: ["https://example.com/pricing"],
        uniqueStateHashes: ["abc123"],
        interactionsAttempted: 1,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 2,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [
          {
            issueType: "TEXT_OVERFLOW_CLIP",
            testcaseId: "TEXT_OVERFLOW_CLIP",
            title: "Primary CTA text is clipped",
            severity: "P1",
            confidence: 0.95,
            actual: "Button text \"Start free trial\" is clipped.",
            exactVisibleText: "Start free trial",
            affectedUrl: "https://example.com/pricing",
            affectedSelector: "button.primary-cta",
            viewportLabel: "mobile",
            deviceLabel: "mobile",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/mobile-step-012.png",
                captureMode: "viewport"
              }
            ],
            explanation: {
              whatHappened: "The primary CTA label is clipped.",
              whyItFailed: "The label overflows the button bounds."
            }
          },
          {
            issueType: "TEXT_OVERFLOW_CLIP",
            testcaseId: "TEXT_OVERFLOW_CLIP",
            title: "Primary CTA text is clipped",
            severity: "P1",
            confidence: 0.94,
            actual: "Button text \"View plans\" is clipped.",
            exactVisibleText: "View plans",
            affectedUrl: "https://example.com/pricing",
            affectedSelector: "button.secondary-cta",
            viewportLabel: "mobile",
            deviceLabel: "mobile",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/mobile-step-013.png",
                captureMode: "viewport"
              }
            ],
            explanation: {
              whatHappened: "A secondary CTA label is clipped.",
              whyItFailed: "The label overflows the secondary button bounds."
            }
          }
        ],
        clusters: []
      }
    })
  );

  const groupedIssues = report.uiux?.groupedIssues ?? [];
  assert.equal(groupedIssues.length, 2);
});

test("uiux grouped issues merge overlapping issue names for same page component and preserve source issue types", () => {
  const report = buildRunReport(
    makeSession({
      uiux: {
        enabled: true,
        pagesVisited: ["https://example.com/pricing"],
        uniqueStateHashes: ["abc123"],
        interactionsAttempted: 1,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 3,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [
          {
            issueType: "CLIPPED_PRIMARY_CTA",
            testcaseId: "CLIPPED_PRIMARY_CTA",
            title: "Primary CTA is clipped",
            severity: "P1",
            confidence: 0.88,
            actual: "Primary CTA extends beyond visible container.",
            exactVisibleText: "Start free trial",
            affectedUrl: "https://example.com/pricing?utm=mobile",
            affectedSelector: "button.primary-cta",
            step: 8,
            viewportLabel: "Apple iPhone 12 (360x800 @2x)",
            deviceLabel: "Apple iPhone 12 (360x800 @2x)",
            deviceId: "apple-iphone-12-360-800-2x",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/mobile-step-008.png",
                captureMode: "viewport"
              }
            ],
            explanation: {
              whatHappened: "Primary CTA is clipped in mobile viewport.",
              whyItFailed: "CTA width exceeds container."
            },
            highlightSources: {
              viewport: { width: 360, height: 800 },
              selectorBounds: { x: 24, y: 500, width: 170, height: 40 },
              overlayBounds: null,
              primaryCtaBounds: null
            }
          },
          {
            issueType: "TEXT_OVERFLOW_CLIP",
            testcaseId: "TEXT_OVERFLOW_CLIP",
            title: "Primary CTA text is clipped",
            severity: "P1",
            confidence: 0.94,
            actual: "Primary CTA text overflows and clips in tablet viewport.",
            exactVisibleText: "Start free trial",
            affectedUrl: "https://example.com/pricing",
            affectedSelector: "button.primary-cta",
            step: 11,
            viewportLabel: "Apple iPad Air 5 (820x1180 @2x)",
            deviceLabel: "Apple iPad Air 5 (820x1180 @2x)",
            deviceId: "apple-ipad-air-5-820-1180-2x",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/tablet-step-011.png",
                captureMode: "viewport"
              }
            ],
            explanation: {
              whatHappened: "Primary CTA text is clipped in tablet viewport.",
              whyItFailed: "The label overflows CTA bounds."
            },
            highlightSources: {
              viewport: { width: 820, height: 1180 },
              selectorBounds: { x: 54, y: 560, width: 210, height: 44 },
              overlayBounds: null,
              primaryCtaBounds: null
            }
          }
        ],
        clusters: []
      }
    })
  );

  const groupedIssues = report.uiux?.groupedIssues ?? [];
  assert.equal(groupedIssues.length, 1);
  assert.equal(groupedIssues[0].devices.length, 2);
  assert.equal(groupedIssues[0].affectedDeviceCount, 2);
  assert.equal(groupedIssues[0].occurrenceCount, 2);
  assert.deepEqual(groupedIssues[0].sourceIssueTypes, ["CLIPPED_PRIMARY_CTA", "TEXT_OVERFLOW_CLIP"]);
  assert.equal(groupedIssues[0].canonicalIssueFamily, "RESPONSIVE_OVERFLOW");
});

test("uiux grouped issues keep same component separate across different canonical urls", () => {
  const report = buildRunReport(
    makeSession({
      uiux: {
        enabled: true,
        pagesVisited: ["https://example.com/pricing", "https://example.com/checkout"],
        uniqueStateHashes: ["abc123"],
        interactionsAttempted: 2,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 2,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [
          {
            issueType: "TEXT_OVERFLOW_CLIP",
            testcaseId: "TEXT_OVERFLOW_CLIP",
            title: "Primary CTA text is clipped",
            severity: "P1",
            confidence: 0.95,
            actual: "Button text is clipped on pricing page.",
            exactVisibleText: "Start free trial",
            affectedUrl: "https://example.com/pricing",
            affectedSelector: "button.primary-cta",
            viewportLabel: "mobile",
            deviceLabel: "mobile",
            highlightSources: {
              viewport: { width: 390, height: 844 },
              selectorBounds: { x: 40, y: 510, width: 180, height: 42 },
              overlayBounds: null,
              primaryCtaBounds: null
            }
          },
          {
            issueType: "TEXT_OVERFLOW_CLIP",
            testcaseId: "TEXT_OVERFLOW_CLIP",
            title: "Primary CTA text is clipped",
            severity: "P1",
            confidence: 0.95,
            actual: "Button text is clipped on checkout page.",
            exactVisibleText: "Start free trial",
            affectedUrl: "https://example.com/checkout",
            affectedSelector: "button.primary-cta",
            viewportLabel: "mobile",
            deviceLabel: "mobile",
            highlightSources: {
              viewport: { width: 390, height: 844 },
              selectorBounds: { x: 40, y: 510, width: 180, height: 42 },
              overlayBounds: null,
              primaryCtaBounds: null
            }
          }
        ],
        clusters: []
      }
    })
  );

  const groupedIssues = report.uiux?.groupedIssues ?? [];
  assert.equal(groupedIssues.length, 2);
});

test("non-uiux reports keep grouped uiux failures empty", () => {
  const report = buildRunReport(
    makeSession({
      runConfig: {
        testMode: "functional"
      },
      uiux: {
        enabled: true,
        pagesVisited: [],
        uniqueStateHashes: [],
        interactionsAttempted: 0,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 0,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [],
        clusters: []
      }
    })
  );

  assert.deepEqual(report.uiux?.groupedIssues ?? [], []);
  assert.deepEqual(report.uiuxGroupedIssues ?? [], []);
});

test("advisory uiux issue is downgraded and excluded from grouped failures", () => {
  const report = buildRunReport(
    makeSession({
      uiux: {
        enabled: true,
        pagesVisited: ["https://example.com/hero"],
        uniqueStateHashes: ["def456"],
        interactionsAttempted: 1,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 1,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [
          {
            issueType: "CTA_PRIORITY_CONFLICT",
            title: "Top-fold CTAs conflict in priority",
            severity: "P2",
            confidence: 0.78,
            actual: "Detected 2 CTA candidates with 1 strong and 1 medium ambiguity signal(s).",
            affectedUrl: "https://example.com/hero",
            viewportLabel: "mobile",
            deviceLabel: "mobile",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_uiux_report_test/frames/mobile-step-020.png",
                captureMode: "viewport"
              }
            ],
            supportingSignals: [
              { id: "equal-visual-prominence", strength: "strong" },
              { id: "competing-cta-labels", strength: "medium" }
            ]
          }
        ],
        clusters: []
      }
    })
  );

  const issue = report.uiux?.issues?.[0];
  assert.ok(issue);
  assert.ok(["WARN", "INFO"].includes(issue.calibratedJudgment?.verdict));
  assert.equal(issue.isDefect, false);
  assert.ok(issue.downgradeReason);
  assert.equal((report.uiux?.groupedIssues ?? []).length, 0);
});
