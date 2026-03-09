import { A11yRuleRegistry } from "./rules/registry.js";

function issueKey(issue) {
  return [
    issue.ruleId,
    issue.viewportLabel ?? "",
    issue.affectedUrl ?? "",
    issue.affectedSelector ?? "",
    issue.actual ?? ""
  ].join("|");
}

export class A11yRunner {
  constructor({ registry } = {}) {
    this.registry = registry ?? new A11yRuleRegistry();
    this.seenIssues = new Set();
  }

  buildEvidenceRefs(snapshot) {
    const refs = [{ type: "screenshot", ref: snapshot.screenshotUrl ?? snapshot.screenshotPath }];

    const domArtifacts = snapshot.artifacts?.dom ?? [];
    const a11yArtifacts = snapshot.artifacts?.a11y ?? [];
    const latestDom = domArtifacts.at(-1);
    const latestA11y = a11yArtifacts.at(-1);

    if (latestDom?.url) {
      refs.push({ type: "dom", ref: latestDom.url });
    }

    if (latestA11y?.url) {
      refs.push({ type: "a11y", ref: latestA11y.url });
    }

    return refs;
  }

  run({ snapshot, stage, actionResult = null, actionContext = null }) {
    const issues = this.registry.runAll({
      snapshot,
      stage,
      actionResult,
      actionContext,
      evidenceRefs: this.buildEvidenceRefs(snapshot)
    });

    return issues
      .map((issue) => ({
        ...issue,
        step: issue.step ?? snapshot.step ?? null,
        viewportLabel: issue.viewportLabel ?? snapshot.viewportLabel ?? null
      }))
      .filter((issue) => {
        const key = issueKey(issue);
        if (this.seenIssues.has(key)) {
          return false;
        }
        this.seenIssues.add(key);
        return true;
      });
  }
}
