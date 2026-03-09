const VALID_POLICY_CLASSES = new Set(["hard-fail", "advisory"]);
const VALID_VERDICTS = new Set(["PASS", "INFO", "WARN", "FAIL"]);
const VALID_EVIDENCE_STRENGTH = new Set(["weak", "medium", "strong"]);
const VALID_USABILITY_SEVERITY = new Set(["none", "low", "medium", "high", "critical"]);
const VALID_SIGNAL_STRENGTH = new Set(["weak", "medium", "strong"]);

const ADVISORY_CHECKS = new Set([
  "CTA_PRIORITY_CONFLICT",
  "SEVERE_ALIGNMENT_BREAK",
  "INCONSISTENT_PRIMARY_NAV",
  "SEARCH_BAR_INCONSISTENT",
  "LOCALIZATION_OVERFLOW_HINT",
  "DUPLICATE_PRIMARY_CTA_LABELS",
  "TOUCH_HOVER_ONLY_CRITICAL_ACTION"
]);

const DEFAULT_RECOMMENDED_FIX = ["Review the highlighted region and apply the most direct UI fix."];

export const UIUX_JUDGMENT_FEW_SHOTS = Object.freeze([
  Object.freeze({
    issueType: "CTA_PRIORITY_CONFLICT",
    policyClass: "advisory",
    detectorSignals: { strong: 1, medium: 1, weak: 1 },
    confidence: 0.78,
    expectedFinalVerdict: "WARN",
    rationale: "Ambiguous CTA hierarchy is advisory unless confidence and strong evidence are both high."
  }),
  Object.freeze({
    issueType: "CTA_PRIORITY_CONFLICT",
    policyClass: "advisory",
    detectorSignals: { strong: 3, medium: 1, weak: 0 },
    confidence: 0.94,
    expectedFinalVerdict: "FAIL",
    rationale: "Competing equal-prominence CTAs with conflicting labels can be a clear defect."
  }),
  Object.freeze({
    issueType: "TEXT_OVERFLOW_CLIP",
    policyClass: "hard-fail",
    detectorSignals: { strong: 2, medium: 0, weak: 0 },
    confidence: 0.83,
    expectedFinalVerdict: "FAIL",
    rationale: "Objective clipping remains a hard-fail when evidence is clear."
  })
]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeVerdict(value, fallback = "WARN") {
  const verdict = String(value ?? "").toUpperCase();
  return VALID_VERDICTS.has(verdict) ? verdict : fallback;
}

function normalizeEvidenceStrength(value, fallback = "medium") {
  const normalized = String(value ?? "").toLowerCase();
  return VALID_EVIDENCE_STRENGTH.has(normalized) ? normalized : fallback;
}

function normalizeSignalStrength(value, fallback = "medium") {
  const normalized = String(value ?? "").toLowerCase();
  return VALID_SIGNAL_STRENGTH.has(normalized) ? normalized : fallback;
}

function confidenceFor(value, fallback = 0.75) {
  return clamp(Number(value ?? fallback), 0, 1);
}

function normalizeRecommendedFix(input = []) {
  if (!Array.isArray(input)) {
    return [...DEFAULT_RECOMMENDED_FIX];
  }
  const normalized = input
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .slice(0, 3);
  return normalized.length ? normalized : [...DEFAULT_RECOMMENDED_FIX];
}

function normalizeSignalArray(input = []) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const id = normalizeText(entry.id ?? entry.signal ?? `signal-${index + 1}`);
      if (!id) {
        return null;
      }
      return {
        id,
        strength: normalizeSignalStrength(entry.strength, "medium"),
        label: normalizeText(entry.label ?? entry.summary ?? id),
        value: entry.value ?? null
      };
    })
    .filter(Boolean);
}

function normalizedSignalsFromIssue(issue = {}) {
  const directSignals = normalizeSignalArray(issue.supportingSignals);
  if (directSignals.length) {
    return directSignals;
  }

  const detectorSignalSet = issue.detectorSignals?.signalSet;
  if (!detectorSignalSet || typeof detectorSignalSet !== "object") {
    return [];
  }

  const aggregate = [];
  for (const [strength, signals] of Object.entries(detectorSignalSet)) {
    if (!Array.isArray(signals)) {
      continue;
    }
    for (const signal of signals) {
      const id = normalizeText(signal?.id ?? signal?.signal);
      if (!id) {
        continue;
      }
      aggregate.push({
        id,
        strength: normalizeSignalStrength(strength, "medium"),
        label: normalizeText(signal?.label ?? signal?.summary ?? id),
        value: signal?.value ?? null
      });
    }
  }

  return aggregate;
}

function supportingSignalCounts(signals = []) {
  return signals.reduce(
    (acc, signal) => {
      acc.total += 1;
      if (signal.strength === "strong") {
        acc.strong += 1;
      } else if (signal.strength === "medium") {
        acc.medium += 1;
      } else {
        acc.weak += 1;
      }
      return acc;
    },
    {
      strong: 0,
      medium: 0,
      weak: 0,
      total: 0
    }
  );
}

function deriveEvidenceStrength(issue = {}, counts = { strong: 0, medium: 0, weak: 0 }) {
  if (counts.strong >= 2) {
    return "strong";
  }
  if (counts.strong >= 1 || counts.medium >= 2) {
    return "medium";
  }

  const confidence = confidenceFor(issue.confidence, 0.75);
  if (confidence >= 0.9) {
    return "strong";
  }
  if (confidence >= 0.72) {
    return "medium";
  }
  return "weak";
}

function usabilitySeverity(verdict = "WARN", issueSeverity = "P2", policyClass = "hard-fail") {
  const normalizedVerdict = normalizeVerdict(verdict);
  if (normalizedVerdict === "PASS") {
    return "none";
  }
  if (normalizedVerdict === "INFO") {
    return "low";
  }
  if (normalizedVerdict === "WARN") {
    return "medium";
  }

  if (issueSeverity === "P0") {
    return policyClass === "advisory" ? "high" : "critical";
  }
  if (issueSeverity === "P1") {
    return "high";
  }
  if (issueSeverity === "P2") {
    return "medium";
  }
  return "low";
}

function normalizeJudgmentContract(input = {}, fallback = {}) {
  const verdict = normalizeVerdict(input.verdict, normalizeVerdict(fallback.verdict, "WARN"));
  const evidenceStrength = normalizeEvidenceStrength(
    input.evidenceStrength,
    normalizeEvidenceStrength(fallback.evidenceStrength, "medium")
  );
  const severity = normalizeText(input.severity, normalizeText(fallback.severity, "medium")).toLowerCase();
  const recommendedFix = normalizeRecommendedFix(
    input.recommendedFix ?? fallback.recommendedFix ?? DEFAULT_RECOMMENDED_FIX
  );
  const supportingCounts = input.supportingSignalCounts ?? fallback.supportingSignalCounts ?? {
    strong: 0,
    medium: 0,
    weak: 0,
    total: 0
  };

  return {
    verdict,
    confidence: confidenceFor(input.confidence, fallback.confidence ?? 0.75),
    summary: normalizeText(
      input.summary,
      normalizeText(fallback.summary, `${normalizeText(fallback.violatedRule, "UI/UX rule")} evaluation`)
    ),
    reasoning: normalizeText(
      input.reasoning,
      normalizeText(fallback.reasoning, "Evidence was evaluated against deterministic UI/UX policy rules.")
    ),
    violatedRule: normalizeText(input.violatedRule, normalizeText(fallback.violatedRule, null)),
    evidenceStrength,
    severity: VALID_USABILITY_SEVERITY.has(severity) ? severity : "medium",
    recommendedFix,
    requiresHumanReview: Boolean(input.requiresHumanReview ?? fallback.requiresHumanReview ?? false),
    supportingSignalCounts: {
      strong: Number(supportingCounts.strong ?? 0),
      medium: Number(supportingCounts.medium ?? 0),
      weak: Number(supportingCounts.weak ?? 0),
      total: Number(supportingCounts.total ?? 0)
    }
  };
}

function buildRawDetectorJudgment(issue = {}, policyClass = "hard-fail", signalCounts = { strong: 0, medium: 0, weak: 0, total: 0 }) {
  const evidenceStrength = deriveEvidenceStrength(issue, signalCounts);
  const issueType = normalizeText(issue.issueType, "UIUX_RULE");
  const title = normalizeText(issue.title, issueType);
  const summary = normalizeText(issue.actual, normalizeText(issue.explanation?.whatHappened, `${title} was detected.`));
  const confidence = confidenceFor(issue.confidence, 0.75);

  let verdict = "FAIL";
  if (policyClass === "advisory" && (confidence < 0.75 || evidenceStrength === "weak")) {
    verdict = confidence < 0.58 ? "INFO" : "WARN";
  }

  return normalizeJudgmentContract({
    verdict,
    confidence,
    summary,
    reasoning: normalizeText(
      issue.expected,
      "Detector identified a candidate issue in the rendered UI state."
    ),
    violatedRule: issueType,
    evidenceStrength,
    severity: usabilitySeverity(verdict, issue.severity, policyClass),
    recommendedFix: issue.explanation?.recommendedFix,
    requiresHumanReview: policyClass === "advisory" && verdict !== "FAIL",
    supportingSignalCounts: signalCounts
  });
}

function buildLlmJudgment(issue = {}, rawDetectorResult = {}) {
  const candidate = issue.llmJudgment ?? issue.judgment?.llm ?? null;
  if (candidate && typeof candidate === "object") {
    return normalizeJudgmentContract(candidate, rawDetectorResult);
  }

  return normalizeJudgmentContract(
    {
      ...rawDetectorResult,
      summary: rawDetectorResult.summary ?? issue.title ?? issue.issueType ?? "UI/UX issue",
      reasoning:
        "No model-level semantic override was provided; using deterministic detector judgment fallback."
    },
    rawDetectorResult
  );
}

function calibrateAdvisoryVerdict({
  issue,
  initialJudgment,
  signalCounts,
  policyClass,
  clusterStats
}) {
  const adjusted = {
    ...initialJudgment,
    confidence: confidenceFor(initialJudgment.confidence, 0.75)
  };
  const reasons = [];

  if (Number(clusterStats.viewportCount ?? 1) >= 2) {
    adjusted.confidence = confidenceFor(adjusted.confidence + 0.05, adjusted.confidence);
  }
  if (Number(clusterStats.occurrenceCount ?? 1) >= 3) {
    adjusted.confidence = confidenceFor(adjusted.confidence + 0.04, adjusted.confidence);
  }

  const ctaClearPrimary = Boolean(issue.detectorSignals?.ctaHasClearPrimary);
  if (issue.issueType === "CTA_PRIORITY_CONFLICT" && ctaClearPrimary) {
    adjusted.verdict = "PASS";
    adjusted.summary = "Top-fold CTA hierarchy appears clear in this viewport.";
    adjusted.reasoning =
      "Primary-versus-secondary distinction is explicit, so priority conflict criteria are not met.";
    adjusted.evidenceStrength = normalizeEvidenceStrength(adjusted.evidenceStrength, "medium");
    adjusted.severity = "none";
    adjusted.requiresHumanReview = false;
    reasons.push("cta-clear-primary-secondary");
    return {
      calibrated: normalizeJudgmentContract(adjusted, initialJudgment),
      downgradeReason: reasons.join(";")
    };
  }

  if (adjusted.verdict === "FAIL") {
    if (adjusted.confidence < 0.9 || signalCounts.strong < 2) {
      adjusted.verdict = adjusted.confidence >= 0.75 || signalCounts.medium + signalCounts.strong >= 2
        ? "WARN"
        : "INFO";
      reasons.push("advisory-fail-threshold-not-met");
    }
  }

  if (adjusted.evidenceStrength === "weak" && adjusted.verdict === "FAIL") {
    adjusted.verdict = "INFO";
    reasons.push("weak-subjective-evidence");
  } else if (adjusted.evidenceStrength === "weak" && adjusted.verdict === "WARN") {
    adjusted.verdict = "INFO";
    reasons.push("weak-evidence-demoted");
  }

  adjusted.severity = usabilitySeverity(adjusted.verdict, issue.severity, policyClass);
  adjusted.requiresHumanReview = adjusted.verdict === "WARN";

  return {
    calibrated: normalizeJudgmentContract(adjusted, initialJudgment),
    downgradeReason: reasons.length ? reasons.join(";") : null
  };
}

function calibrateHardFailVerdict({ issue, initialJudgment, signalCounts, policyClass, clusterStats }) {
  const adjusted = {
    ...initialJudgment,
    confidence: confidenceFor(initialJudgment.confidence, 0.75)
  };
  const reasons = [];

  if (Number(clusterStats.occurrenceCount ?? 1) >= 3) {
    adjusted.confidence = confidenceFor(adjusted.confidence + 0.03, adjusted.confidence);
  }

  if (adjusted.verdict === "FAIL" && adjusted.evidenceStrength === "weak" && adjusted.confidence < 0.6) {
    adjusted.verdict = "WARN";
    adjusted.requiresHumanReview = true;
    reasons.push("insufficient-objective-evidence");
  }

  adjusted.severity = usabilitySeverity(adjusted.verdict, issue.severity, policyClass);

  return {
    calibrated: normalizeJudgmentContract(adjusted, initialJudgment),
    downgradeReason: reasons.length ? reasons.join(";") : null
  };
}

export function resolveUiuxCheckPolicy(issue = {}) {
  const explicit = normalizeText(
    issue.judgmentPolicy ?? issue.testcaseJudgmentPolicy ?? issue.policyClass,
    ""
  ).toLowerCase();
  if (VALID_POLICY_CLASSES.has(explicit)) {
    return explicit;
  }
  if (ADVISORY_CHECKS.has(issue.issueType ?? "")) {
    return "advisory";
  }
  return "hard-fail";
}

export function calibrateUiuxJudgment({
  issue = {},
  clusterStats = {}
} = {}) {
  const policyClass = resolveUiuxCheckPolicy(issue);
  const supportingSignals = normalizedSignalsFromIssue(issue);
  const signalCounts = supportingSignalCounts(supportingSignals);
  const rawDetectorResult = buildRawDetectorJudgment(issue, policyClass, signalCounts);
  const llmJudgment = buildLlmJudgment(issue, rawDetectorResult);

  const initialJudgment = normalizeJudgmentContract(llmJudgment, rawDetectorResult);
  const calibration =
    policyClass === "advisory"
      ? calibrateAdvisoryVerdict({
          issue,
          initialJudgment,
          signalCounts,
          policyClass,
          clusterStats
        })
      : calibrateHardFailVerdict({
          issue,
          initialJudgment,
          signalCounts,
          policyClass,
          clusterStats
        });

  const calibrated = calibration.calibrated;
  const downgradeReason =
    normalizeVerdict(rawDetectorResult.verdict) === "FAIL" && calibrated.verdict !== "FAIL"
      ? calibration.downgradeReason ?? "calibrated-to-non-fail"
      : calibration.downgradeReason;

  return {
    judgmentPolicy: policyClass,
    supportingSignals,
    supportingSignalCounts: signalCounts,
    rawDetectorResult,
    llmJudgment,
    calibratedJudgment: calibrated,
    calibratedVerdict: calibrated.verdict,
    downgradeReason,
    isDefect: calibrated.verdict === "FAIL"
  };
}
