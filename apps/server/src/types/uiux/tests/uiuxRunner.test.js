import test from "node:test";
import assert from "node:assert/strict";

import { UiuxRunner } from "../src/types/uiux/uiuxRunner.js";

test("uiux runner returns normalized issue output with evidence refs and step", () => {
  const runner = new UiuxRunner();
  const issues = runner.run({
    snapshot: {
      step: 7,
      viewportLabel: "desktop",
      url: "https://example.com/home",
      bodyText: "Example page",
      viewportWidth: 1280,
      viewportHeight: 720,
      pageWidth: 1280,
      pageHeight: 1600,
      primaryCta: null,
      interactive: [],
      images: [
        {
          selector: "img.hero",
          src: "https://cdn.example.com/hero.png",
          hadError: true,
          broken: true,
          areaRatio: 0.2
        }
      ],
      formControls: [],
      errorBanners: [],
      overlays: [],
      spinnerVisible: false,
      uiReadyState: { timedOut: false, strategy: "hybrid" },
      networkSummary: {
        mainDocumentStatus: null,
        mainDocumentUrl: null,
        mainDocumentFailed: false
      },
      screenshotUrl: "/artifacts/run/frames/step-007.png",
      artifacts: {
        dom: [{ url: "/artifacts/run/dom/step-7.html" }],
        a11y: [{ url: "/artifacts/run/a11y/step-7.json" }]
      }
    },
    stage: "initial"
  });

  assert.equal(issues.length >= 1, true);
  const issue = issues[0];
  assert.equal(typeof issue.issueType, "string");
  assert.equal(typeof issue.severity, "string");
  assert.equal(typeof issue.title, "string");
  assert.equal(typeof issue.expected, "string");
  assert.equal(typeof issue.actual, "string");
  assert.equal(Array.isArray(issue.evidenceRefs), true);
  assert.equal(issue.step, 7);
  assert.equal(issue.viewportLabel, "desktop");
  assert.deepEqual(
    issue.evidenceRefs.map((ref) => ref.type),
    ["screenshot", "dom", "a11y"]
  );
});
