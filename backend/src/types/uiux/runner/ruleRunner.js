import { withUiuxTestCaseIssueMetadata } from "../testcases/model.js";
import { calibrateUiuxJudgment } from "../judgment/calibration.js";

export class UiuxRuleRunner {
  constructor(testCases = []) {
    this.testCases = Array.isArray(testCases) ? testCases : [];
  }

  runAll(context = {}) {
    return this.testCases.flatMap((testCase) => {
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
