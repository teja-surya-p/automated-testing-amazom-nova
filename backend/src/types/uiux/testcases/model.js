const VALID_PAGE_SCOPES = new Set([
  "page",
  "element",
  "viewport",
  "cross-page"
]);

const VALID_DEVICE_SCOPES = new Set([
  "single-viewport",
  "multi-viewport",
  "all-configured-devices"
]);

const VALID_JUDGMENT_POLICIES = new Set(["hard-fail", "advisory"]);

function nonEmptyString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeFixes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function defineUiuxTestCase({
  id,
  title,
  category,
  severity = "P2",
  pageScope = "page",
  deviceScope = "single-viewport",
  judgmentPolicy = "hard-fail",
  detector,
  evidenceRequirements = [],
  explanationTemplate = {}
}) {
  if (typeof detector !== "function") {
    throw new Error(`UI/UX testcase ${id ?? "<unknown>"} must provide a detector function.`);
  }

  const normalizedId = nonEmptyString(id, "UNKNOWN_TESTCASE");
  const normalizedTitle = nonEmptyString(title, normalizedId);
  const normalizedCategory = nonEmptyString(category, "general");
  const normalizedSeverity = nonEmptyString(severity, "P2");
  const normalizedPageScope = VALID_PAGE_SCOPES.has(pageScope) ? pageScope : "page";
  const normalizedDeviceScope = VALID_DEVICE_SCOPES.has(deviceScope)
    ? deviceScope
    : "single-viewport";
  const normalizedJudgmentPolicy = VALID_JUDGMENT_POLICIES.has(judgmentPolicy)
    ? judgmentPolicy
    : "hard-fail";
  const normalizedEvidenceRequirements = Array.isArray(evidenceRequirements)
    ? evidenceRequirements.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];

  const whatHappened = nonEmptyString(
    explanationTemplate.whatHappened,
    `${normalizedTitle} was detected.`
  );
  const whyItFailed = nonEmptyString(
    explanationTemplate.whyItFailed,
    "The rendered UI state did not satisfy this deterministic check."
  );
  const whyItMatters = nonEmptyString(
    explanationTemplate.whyItMatters,
    "This can degrade usability and completion rates."
  );
  const recommendedFix = normalizeFixes(explanationTemplate.recommendedFix);

  return Object.freeze({
    id: normalizedId,
    title: normalizedTitle,
    category: normalizedCategory,
    severity: normalizedSeverity,
    pageScope: normalizedPageScope,
    deviceScope: normalizedDeviceScope,
    judgmentPolicy: normalizedJudgmentPolicy,
    detector,
    evidenceRequirements: normalizedEvidenceRequirements,
    explanationTemplate: {
      whatHappened,
      whyItFailed,
      whyItMatters,
      recommendedFix
    }
  });
}

export function withUiuxTestCaseIssueMetadata(issue = {}, testCase = {}) {
  const explanation = issue.explanation ?? {};
  return {
    ...issue,
    testcaseId: testCase.id ?? issue.testcaseId ?? null,
    testcaseTitle: testCase.title ?? issue.testcaseTitle ?? null,
    testcaseCategory: testCase.category ?? issue.testcaseCategory ?? null,
    testcaseSeverity: testCase.severity ?? issue.testcaseSeverity ?? null,
    testcaseJudgmentPolicy: testCase.judgmentPolicy ?? issue.testcaseJudgmentPolicy ?? "hard-fail",
    testcaseScope: {
      pageScope: testCase.pageScope ?? issue.testcaseScope?.pageScope ?? "page",
      deviceScope: testCase.deviceScope ?? issue.testcaseScope?.deviceScope ?? "single-viewport"
    },
    explanation: {
      whatHappened:
        explanation.whatHappened ??
        testCase.explanationTemplate?.whatHappened ??
        `${testCase.title ?? issue.issueType ?? "UI issue"} was detected.`,
      whyItFailed:
        explanation.whyItFailed ??
        issue.actual ??
        testCase.explanationTemplate?.whyItFailed ??
        "The rendered UI state did not satisfy this deterministic check.",
      whyItMatters:
        explanation.whyItMatters ??
        testCase.explanationTemplate?.whyItMatters ??
        "This can degrade usability and completion rates.",
      recommendedFix:
        normalizeFixes(explanation.recommendedFix).length > 0
          ? normalizeFixes(explanation.recommendedFix)
          : normalizeFixes(testCase.explanationTemplate?.recommendedFix)
    }
  };
}
