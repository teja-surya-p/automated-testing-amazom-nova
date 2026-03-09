import test from "node:test";
import assert from "node:assert/strict";

import { computeUiuxArtifactRetentionPlan } from "../src/types/uiux/artifactRetention.js";

function makeArtifact(kind, step, viewportLabel = "desktop") {
  return {
    path: `/tmp/${kind}/step-${step}.json`,
    relativePath: `${kind}/step-${step}.json`,
    url: `/artifacts/${kind}/step-${step}.json`,
    step: String(step),
    viewportLabel
  };
}

test("artifact retention prunes oldest non-issue intermediates per viewport", () => {
  const artifactIndex = {
    dom: [
      makeArtifact("dom", 1),
      makeArtifact("dom", 2),
      makeArtifact("dom", 3),
      makeArtifact("dom", 4),
      makeArtifact("dom", 5)
    ],
    a11y: []
  };
  const issues = [
    {
      evidenceRefs: [{ type: "dom", ref: "/artifacts/dom/step-2.json" }]
    }
  ];

  const plan = computeUiuxArtifactRetentionPlan({
    artifactIndex,
    issues,
    retention: {
      maxSnapshotsPerViewport: 2,
      keepOnlyFailedOrFlaggedSteps: false,
      keepDomForIssuesOnly: false
    }
  });

  assert.equal(plan.artifactsPrunedCount, 1);
  assert.deepEqual(
    plan.nextArtifactIndex.dom.map((entry) => entry.step),
    ["2", "3", "4", "5"]
  );
});

test("keepOnlyFailedOrFlaggedSteps prunes non-issue intermediates for dom and a11y", () => {
  const artifactIndex = {
    dom: [makeArtifact("dom", 1), makeArtifact("dom", 2), makeArtifact("dom", 3)],
    a11y: [makeArtifact("a11y", 1), makeArtifact("a11y", 2), makeArtifact("a11y", 3)]
  };
  const issues = [
    {
      evidenceRefs: [
        { type: "dom", ref: "/artifacts/dom/step-2.json" },
        { type: "a11y", ref: "/artifacts/a11y/step-2.json" }
      ]
    }
  ];

  const plan = computeUiuxArtifactRetentionPlan({
    artifactIndex,
    issues,
    retention: {
      maxSnapshotsPerViewport: 10,
      keepOnlyFailedOrFlaggedSteps: true,
      keepDomForIssuesOnly: false
    }
  });

  assert.deepEqual(
    plan.nextArtifactIndex.dom.map((entry) => entry.step),
    ["2", "3"]
  );
  assert.deepEqual(
    plan.nextArtifactIndex.a11y.map((entry) => entry.step),
    ["2", "3"]
  );
  assert.equal(plan.artifactsPrunedCount, 2);
});

test("keepDomForIssuesOnly prunes dom intermediates but keeps non-dom artifacts within budget", () => {
  const artifactIndex = {
    dom: [makeArtifact("dom", 1), makeArtifact("dom", 2), makeArtifact("dom", 3)],
    a11y: [makeArtifact("a11y", 1), makeArtifact("a11y", 2), makeArtifact("a11y", 3)]
  };
  const issues = [
    {
      evidenceRefs: [{ type: "dom", ref: "/artifacts/dom/step-2.json" }]
    }
  ];

  const plan = computeUiuxArtifactRetentionPlan({
    artifactIndex,
    issues,
    retention: {
      maxSnapshotsPerViewport: 5,
      keepOnlyFailedOrFlaggedSteps: false,
      keepDomForIssuesOnly: true
    }
  });

  assert.deepEqual(
    plan.nextArtifactIndex.dom.map((entry) => entry.step),
    ["2", "3"]
  );
  assert.deepEqual(
    plan.nextArtifactIndex.a11y.map((entry) => entry.step),
    ["1", "2", "3"]
  );
  assert.equal(plan.artifactsPrunedCount, 1);
});

