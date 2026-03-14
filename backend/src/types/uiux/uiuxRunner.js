import { UiuxCheckRegistry } from "./checks/registry.js";
import { buildSnapshotEvidenceRefs } from "../../library/common-tests/evidenceRefs.js";

function issueKey(issue) {
  return [
    issue.issueType,
    issue.deviceId ?? "",
    issue.deviceLabel ?? "",
    issue.viewportLabel ?? "",
    issue.affectedUrl ?? "",
    issue.affectedSelector ?? "",
    issue.actual
  ].join("|");
}

export class UiuxRunner {
  constructor({ registry } = {}) {
    this.registry = registry ?? new UiuxCheckRegistry();
    this.seenIssues = new Set();
    this.historyByViewport = new Map();
  }

  buildEvidenceRefs(snapshot) {
    return buildSnapshotEvidenceRefs(snapshot, {
      includeCaptureMode: true,
      defaultCaptureMode: "viewport",
      includeViewport: true
    });
  }

  run({ snapshot, stage, actionResult = null, actionContext = null, activeCheckIds = null }) {
    const viewportLabel = snapshot.viewportLabel ?? "default";
    const runHistory = this.historyByViewport.get(viewportLabel) ?? [];
    const issues = this.registry.runAll({
      snapshot,
      stage,
      actionResult,
      actionContext,
      activeCheckIds,
      evidenceRefs: this.buildEvidenceRefs(snapshot),
      runHistory
    });

    const normalizedIssues = issues
      .map((issue) => ({
        ...issue,
        step: issue.step ?? snapshot.step ?? null
      }))
      .filter((issue) => {
      const key = issueKey(issue);
      if (this.seenIssues.has(key)) {
        return false;
      }
      this.seenIssues.add(key);
      return true;
      });

    const historyEntry = {
      step: snapshot.step ?? null,
      url: snapshot.url,
      hash: snapshot.hash ?? null,
      deviceId: snapshot.deviceId ?? null,
      deviceLabel: snapshot.deviceLabel ?? snapshot.viewportLabel ?? null,
      pageTypeHints: snapshot.pageTypeHints ?? {},
      primaryNavLabels: snapshot.primaryNavLabels ?? [],
      hasSearchBar: Boolean(snapshot.hasSearchBar),
      hasPrimaryCta: Boolean(snapshot.primaryCta),
      h1Text: snapshot.h1Text ?? "",
      brandHeaderSignature: snapshot.brandHeaderSignature ?? null
    };
    this.historyByViewport.set(viewportLabel, [...runHistory, historyEntry].slice(-60));

    return normalizedIssues;
  }
}
