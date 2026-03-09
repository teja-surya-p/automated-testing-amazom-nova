import { baselineA11yRules } from "./index.js";

export class A11yRuleRegistry {
  constructor(rules = baselineA11yRules) {
    this.rules = rules;
  }

  runAll(context) {
    return this.rules.flatMap((rule) => {
      const result = rule.run(context);
      if (!result) {
        return [];
      }
      return Array.isArray(result) ? result.filter(Boolean) : [result];
    });
  }
}
