import {
  uiuxHandbookAutomationMode,
  uiuxHandbookChecks
} from "./checklist.js";

function severityRank(level = "P3") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function pickWorstIssue(issues = []) {
  return [...issues].sort((left, right) => {
    const severityDiff =
      severityRank(left.finalSeverity ?? left.severity) - severityRank(right.finalSeverity ?? right.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return (right.confidence ?? 0) - (left.confidence ?? 0);
  })[0] ?? null;
}

function resolveIssueVerdict(issue = null) {
  if (!issue) {
    return "PASS";
  }
  return issue.calibratedJudgment?.verdict ?? issue.calibratedVerdict ?? "FAIL";
}

function buildCoverageEntry(check, { issues = [], enabled = true }) {
  const matchedIssues = issues.filter((issue) => check.mappedIssueTypes.includes(issue.issueType));
  const worstIssue = pickWorstIssue(matchedIssues);
  const verdict = resolveIssueVerdict(worstIssue);

  if (!enabled) {
    return {
      ...check,
      status: "NOT_RUN",
      matchedIssueCount: 0,
      mappedIssueTypes: check.mappedIssueTypes,
      details: "UI/UX mode was not active for this run.",
      sample: null
    };
  }

  if (worstIssue) {
    const status = verdict === "FAIL" ? "FAIL" : verdict === "WARN" ? "WARN" : verdict === "INFO" ? "INFO" : "PASS";
    return {
      ...check,
      status,
      matchedIssueCount: matchedIssues.length,
      mappedIssueTypes: check.mappedIssueTypes,
      details:
        worstIssue.summary ??
        worstIssue.actual ??
        `${check.id} matched ${matchedIssues.length} issue occurrence(s).`,
      sample: {
        issueType: worstIssue.issueType,
        severity: worstIssue.finalSeverity ?? worstIssue.severity ?? "P2",
        confidence: worstIssue.finalConfidence ?? worstIssue.confidence ?? null,
        viewportLabel: worstIssue.viewportLabel ?? null,
        deviceLabel: worstIssue.deviceLabel ?? null,
        affectedUrl: worstIssue.affectedUrl ?? null,
        evidenceRefs: worstIssue.evidenceRefs ?? []
      }
    };
  }

  if (check.automation === uiuxHandbookAutomationMode.MANUAL) {
    return {
      ...check,
      status: "INFO",
      matchedIssueCount: 0,
      mappedIssueTypes: check.mappedIssueTypes,
      details: "Manual or extended-environment verification is required for this handbook check.",
      sample: null
    };
  }

  return {
    ...check,
    status: "PASS",
    matchedIssueCount: 0,
    mappedIssueTypes: check.mappedIssueTypes,
    details: "No detector evidence indicated a violation in this run.",
    sample: null
  };
}

export function buildUiuxHandbookCoverage({ issues = [], enabled = true } = {}) {
  const entries = uiuxHandbookChecks.map((check) =>
    buildCoverageEntry(check, { issues, enabled })
  );

  const summary = entries.reduce(
    (accumulator, entry) => {
      accumulator.total += 1;
      if (entry.status === "PASS") {
        accumulator.pass += 1;
      } else if (entry.status === "FAIL") {
        accumulator.fail += 1;
      } else if (entry.status === "WARN") {
        accumulator.warn += 1;
      } else if (entry.status === "INFO") {
        accumulator.info += 1;
      } else if (entry.status === "NOT_RUN") {
        accumulator.notRun += 1;
      }

      if (entry.automation === uiuxHandbookAutomationMode.AUTOMATED) {
        accumulator.automated += 1;
      } else if (entry.automation === uiuxHandbookAutomationMode.ADVISORY) {
        accumulator.advisory += 1;
      } else if (entry.automation === uiuxHandbookAutomationMode.MANUAL) {
        accumulator.manual += 1;
      }
      return accumulator;
    },
    {
      total: 0,
      pass: 0,
      fail: 0,
      warn: 0,
      info: 0,
      notRun: 0,
      automated: 0,
      advisory: 0,
      manual: 0
    }
  );

  return {
    summary,
    checks: entries
  };
}
