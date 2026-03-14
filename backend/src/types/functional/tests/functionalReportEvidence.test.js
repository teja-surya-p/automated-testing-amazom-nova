import test from "node:test";
import assert from "node:assert/strict";

import { buildRunReport } from "../../../services/reportBuilder.js";

function makeBaseSession(overrides = {}) {
  return {
    id: "qa_functional_report_evidence",
    status: "failed",
    goal: "Validate login flow",
    startUrl: "https://example.com/login",
    currentUrl: "https://example.com/login",
    primaryBlocker: null,
    outcome: {
      targetAchieved: false,
      blockers: [],
      nextBestAction: "REVIEW_FUNCTIONAL_REPORT",
      evidenceQualityScore: 0.86
    },
    runConfig: {
      testMode: "functional"
    },
    timeline: [],
    incidents: [],
    observations: [],
    steps: [],
    artifactIndex: {
      frames: [],
      video: [
        {
          type: "video",
          url: "/artifacts/qa_functional_report_evidence/video/run.webm"
        }
      ]
    },
    uiux: {
      enabled: false,
      pagesVisited: [],
      uniqueStateHashes: [],
      interactionsAttempted: 0,
      interactionsSkippedBySafety: 0,
      issues: [],
      clusters: [],
      pageDeviceMatrix: [],
      deviceSummary: []
    },
    accessibility: {
      enabled: false,
      pagesScanned: [],
      issues: [],
      clusters: []
    },
    functional: {
      enabled: true,
      flowsRun: 1,
      flows: [],
      assertionCounts: {
        evaluated: 1,
        passed: 0,
        failed: 1
      },
      issues: [
        {
          id: "functional-issue-1",
          issueType: "FUNCTIONAL_ASSERTION_FAILED",
          assertionId: "POST_LOGIN_REDIRECT",
          severity: "P1",
          title: "Login redirect did not reach dashboard",
          expected: "User should be redirected to /dashboard after valid login.",
          actual: "App remained on /login after submit.",
          affectedUrl: "https://example.com/login",
          step: 7,
          viewportLabel: "desktop",
          evidenceRefs: [
            {
              type: "screenshot",
              ref: "/artifacts/qa_functional_report_evidence/frames/step-007.png"
            }
          ]
        }
      ],
      blockers: [],
      blockerTimeline: [],
      resumePoints: [],
      loginAssist: {
        attempted: false,
        success: false,
        timeout: false,
        resumeStrategy: "restart-flow",
        profileTag: "functional-local"
      },
      summary: "Functional failures detected.",
      reproBundles: [],
      contractSummary: {
        snapshotsObserved: 0,
        apiCallsObserved: 0,
        apiErrorCounts: {
          "4xx": 0,
          "5xx": 0,
          timeouts: 0
        },
        topFailingEndpoints: [],
        stepsWithApi5xx: 0,
        stepsWithGraphqlErrors: 0,
        stepsWithThirdPartyFailures: 0,
        failingAssertionCounts: {},
        config: {
          failOnApi5xx: true,
          warnOnThirdPartyFailures: true,
          endpointAllowlistPatterns: [],
          endpointBlocklistPatterns: []
        }
      },
      baselineDiff: null,
      graph: {
        nodes: [],
        edges: []
      }
    },
    ...overrides
  };
}

test("functional report issues prioritize video evidence and include structured description", () => {
  const report = buildRunReport(makeBaseSession());
  const issue = report.functional?.issues?.[0];

  assert.equal(issue.evidenceRefs?.[0]?.type, "video");
  assert.equal(issue.evidenceRefs?.[0]?.ref, "/artifacts/qa_functional_report_evidence/video/run.webm");
  assert.equal(issue.evidenceRefs?.[0]?.primary, true);
  assert.equal(issue.primaryEvidence?.type, "video");
  assert.equal(issue.primaryEvidence?.ref, "/artifacts/qa_functional_report_evidence/video/run.webm");
  assert.equal(issue.description?.whatFailed, "Login redirect did not reach dashboard");
  assert.equal(issue.description?.expected, "User should be redirected to /dashboard after valid login.");
  assert.equal(issue.description?.actual, "App remained on /login after submit.");
  assert.equal(issue.description?.whyItFailed, "App remained on /login after submit.");
});

test("uiux report remains screenshot-first even when session has video artifacts", () => {
  const report = buildRunReport(
    makeBaseSession({
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
      uiux: {
        enabled: true,
        pagesVisited: ["https://example.com/pricing"],
        uniqueStateHashes: ["state-1"],
        interactionsAttempted: 1,
        interactionsSkippedBySafety: 0,
        artifactsPrunedCount: 0,
        artifactsRetainedCount: 1,
        pageDeviceMatrix: [],
        deviceSummary: [],
        issues: [
          {
            issueType: "BROKEN_LINK",
            title: "Primary link returned 404",
            severity: "P1",
            expected: "Primary nav link should resolve successfully.",
            actual: "Link returned 404.",
            affectedUrl: "https://example.com/pricing",
            affectedSelector: "a.primary-link",
            step: 5,
            viewportLabel: "desktop",
            deviceLabel: "desktop",
            evidenceRefs: [
              {
                type: "screenshot",
                ref: "/artifacts/qa_functional_report_evidence/frames/uiux-step-005.png",
                captureMode: "viewport"
              }
            ]
          }
        ],
        clusters: []
      }
    })
  );

  const groupedIssue = report.uiux?.groupedIssues?.[0];
  assert.equal(groupedIssue.primaryEvidence?.screenshotRef, "/artifacts/qa_functional_report_evidence/frames/uiux-step-005.png");
  assert.equal(groupedIssue.evidenceRefs?.[0]?.type, "screenshot");
});

