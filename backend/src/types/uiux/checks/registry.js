import { uiuxTestCaseCatalog } from "../testcases/catalog.js";
import { UiuxRuleRunner } from "../runner/ruleRunner.js";

export class UiuxCheckRegistry {
  constructor(testCases = uiuxTestCaseCatalog) {
    this.testCases = testCases;
    this.ruleRunner = new UiuxRuleRunner(testCases);
  }

  runAll(context) {
    return this.ruleRunner.runAll(context);
  }
}
