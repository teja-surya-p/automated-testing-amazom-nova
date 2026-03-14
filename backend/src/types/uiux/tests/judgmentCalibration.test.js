import test from "node:test";
import assert from "node:assert/strict";

import { calibrateUiuxJudgment } from "../judgment/calibration.js";

test("advisory weak subjective evidence is downgraded from fail", () => {
  const result = calibrateUiuxJudgment({
    issue: {
      issueType: "CTA_PRIORITY_CONFLICT",
      title: "Top-fold CTAs conflict in priority",
      severity: "P2",
      confidence: 0.74,
      supportingSignals: [
        { id: "competing-cta-labels", strength: "medium" }
      ]
    }
  });

  assert.equal(result.judgmentPolicy, "advisory");
  assert.equal(result.rawDetectorResult.verdict, "WARN");
  assert.ok(["WARN", "INFO"].includes(result.calibratedJudgment.verdict));
  assert.equal(result.isDefect, false);
});

test("equal-priority conflicting CTA signals can remain FAIL", () => {
  const result = calibrateUiuxJudgment({
    issue: {
      issueType: "CTA_PRIORITY_CONFLICT",
      title: "Top-fold CTAs conflict in priority",
      severity: "P2",
      confidence: 0.95,
      supportingSignals: [
        { id: "equal-visual-prominence", strength: "strong" },
        { id: "unclear-primary-action", strength: "strong" },
        { id: "competing-cta-labels", strength: "medium" }
      ]
    }
  });

  assert.equal(result.calibratedJudgment.verdict, "FAIL");
  assert.equal(result.isDefect, true);
});

test("clear primary CTA hierarchy calibrates to pass", () => {
  const result = calibrateUiuxJudgment({
    issue: {
      issueType: "CTA_PRIORITY_CONFLICT",
      title: "Top-fold CTAs conflict in priority",
      severity: "P2",
      confidence: 0.93,
      supportingSignals: [
        { id: "equal-visual-prominence", strength: "strong" },
        { id: "competing-cta-labels", strength: "medium" }
      ],
      detectorSignals: {
        ctaHasClearPrimary: true
      }
    }
  });

  assert.equal(result.calibratedJudgment.verdict, "PASS");
  assert.equal(result.isDefect, false);
  assert.equal(result.downgradeReason, "cta-clear-primary-secondary");
});

test("objective hard-fail checks remain fail with clear evidence", () => {
  const result = calibrateUiuxJudgment({
    issue: {
      issueType: "TEXT_OVERFLOW_CLIP",
      title: "Text overflow clipping",
      severity: "P1",
      actual: "Text \"Buy now\" overflows its container by 12px.",
      confidence: 0.84,
      supportingSignals: [
        { id: "overflow-detected", strength: "strong" }
      ]
    }
  });

  assert.equal(result.judgmentPolicy, "hard-fail");
  assert.equal(result.calibratedJudgment.verdict, "FAIL");
  assert.equal(result.isDefect, true);
});

test("severe alignment with strong repeated evidence remains a defect", () => {
  const result = calibrateUiuxJudgment({
    issue: {
      issueType: "SEVERE_ALIGNMENT_BREAK",
      title: "Mobile layout shows severe alignment break",
      severity: "P1",
      confidence: 0.9,
      supportingSignals: [
        { id: "stack-left-drift", strength: "strong" },
        { id: "stack-drift-repetition", strength: "strong" }
      ],
      detectorSignals: {
        candidateCount: 4,
        maxLeftDeltaPx: 52,
        thresholdPx: 20
      }
    }
  });

  assert.equal(result.judgmentPolicy, "advisory");
  assert.equal(result.calibratedJudgment.verdict, "FAIL");
  assert.equal(result.isDefect, true);
});

test("text clipping without exact visible text proof is downgraded", () => {
  const result = calibrateUiuxJudgment({
    issue: {
      issueType: "TEXT_OVERFLOW_CLIP",
      title: "Potential clipping near icon area",
      severity: "P1",
      actual: "Potential clipping detected near top-right.",
      confidence: 0.88,
      supportingSignals: [{ id: "overflow-detected", strength: "strong" }]
    }
  });

  assert.ok(["WARN", "INFO"].includes(result.calibratedJudgment.verdict));
  assert.equal(result.isDefect, false);
});

test("non-product overlay selectors are rejected as defects", () => {
  const result = calibrateUiuxJudgment({
    issue: {
      issueType: "TEXT_OVERFLOW_CLIP",
      title: "Clipping on debug badge",
      severity: "P1",
      actual: "Text \"debug\" appears clipped.",
      affectedSelector: ".audit-overlay .debug-badge",
      confidence: 0.93,
      supportingSignals: [
        { id: "overlay-highlight", strength: "medium" },
        { id: "edge-crowding", strength: "weak" }
      ]
    }
  });

  assert.equal(result.calibratedJudgment.verdict, "INFO");
  assert.equal(result.isDefect, false);
});
