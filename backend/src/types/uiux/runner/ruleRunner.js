import { withUiuxTestCaseIssueMetadata } from "../testcases/model.js";
import { calibrateUiuxJudgment } from "../judgment/calibration.js";

export class UiuxRuleRunner {
  constructor(testCases = []) {
    this.testCases = Array.isArray(testCases) ? testCases : [];
  }

  runAll(context = {}) {
    const activeCheckSet = context.activeCheckIds instanceof Set
      ? context.activeCheckIds
      : (Array.isArray(context.activeCheckIds) && context.activeCheckIds.length > 0
        ? new Set(context.activeCheckIds.map((value) => String(value)))
        : null);

    return this.testCases.flatMap((testCase) => {
      if (activeCheckSet && !activeCheckSet.has(testCase.id)) {
        return [];
      }
      const result = testCase.detector(context);
      if (!result) {
        return [];
      }

      const issues = Array.isArray(result) ? result.filter(Boolean) : [result];
      return issues.map((issue) => {
        const withMetadata = withUiuxTestCaseIssueMetadata(
          {
            ...issue,
            judgmentPolicy: issue.judgmentPolicy ?? testCase.judgmentPolicy ?? "hard-fail"
          },
          testCase
        );
        return {
          ...withMetadata,
          ...calibrateUiuxJudgment({
            issue: withMetadata
          })
        };
      });
    });
  }
}
