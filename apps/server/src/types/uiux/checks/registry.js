import { baselineUiuxChecks } from "./index.js";

export class UiuxCheckRegistry {
  constructor(checks = baselineUiuxChecks) {
    this.checks = checks;
  }

  runAll(context) {
    return this.checks.flatMap((check) => {
      const result = check.run(context);
      if (!result) {
        return [];
      }

      return Array.isArray(result) ? result.filter(Boolean) : [result];
    });
  }
}
