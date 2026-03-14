import test from "node:test";
import assert from "node:assert/strict";

import { QaOrchestrator } from "../../../orchestrator/qaOrchestrator.js";
import { detectVisibleCredentialFormSignals, hasVisibleCredentialForm } from "../../../library/common-tests/authFlowSignals.js";
import { buildSnapshotEvidenceRefs } from "../../../library/common-tests/evidenceRefs.js";
import { deadEndPageCheck } from "../../uiux/checks/index.js";
import { UiuxRunner } from "../../uiux/uiuxRunner.js";

function makeCredentialSnapshot(overrides = {}) {
  return {
    spinnerVisible: false,
    overlays: [],
    contentHints: {
      isStaticContentPage: false
    },
    formControls: [
      {
        tag: "input",
        type: "",
        labelText: "Access Key",
        placeholder: "Enter your access key",
        ariaLabel: "",
        name: "",
        inViewport: true
      },
      {
        tag: "input",
        type: "password",
        labelText: "Password",
        placeholder: "Enter password",
        ariaLabel: "",
        name: "",
        inViewport: true
      }
    ],
    interactive: [
      {
        tag: "button",
        text: "Sign In",
        ariaLabel: "",
        placeholder: "",
        name: "",
        href: "",
        disabled: false,
        inViewport: true,
        bounds: { x: 20, y: 50, width: 200, height: 44 }
      }
    ],
    ...overrides
  };
}

test("shared auth-flow signal detects credential forms deterministically", () => {
  const snapshot = makeCredentialSnapshot();
  const result = detectVisibleCredentialFormSignals(snapshot);
  assert.equal(result.passwordFieldDetected, true);
  assert.equal(result.identifierFieldDetected, true);
  assert.equal(result.submitControlDetected, true);
  assert.equal(result.hasCredentialForm, true);
  assert.equal(hasVisibleCredentialForm(snapshot), true);
});

test("shared auth-flow signal excludes search forms from credential detection", () => {
  const snapshot = makeCredentialSnapshot({
    formControls: [
      {
        tag: "input",
        type: "search",
        labelText: "Search",
        placeholder: "Search products",
        ariaLabel: "",
        name: "q",
        inViewport: true
      }
    ],
    interactive: [
      {
        tag: "button",
        text: "Search",
        ariaLabel: "",
        placeholder: "",
        name: "",
        href: "",
        disabled: false,
        inViewport: true
      }
    ]
  });

  assert.equal(hasVisibleCredentialForm(snapshot), false);
});

test("UI/UX dead-end check reuses shared credential-form signal behavior", () => {
  const issue = deadEndPageCheck.run({
    snapshot: makeCredentialSnapshot(),
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/frame.png" }]
  });
  assert.equal(issue, null);
});

test("orchestrator login-step helper matches shared credential-form signal", () => {
  const orchestrator = new QaOrchestrator({
    sessionStore: {},
    explorerProvider: {},
    auditorProvider: {},
    documentarianProvider: {}
  });

  const credentialSnapshot = makeCredentialSnapshot();
  const nonCredentialSnapshot = makeCredentialSnapshot({
    formControls: [],
    interactive: []
  });

  assert.equal(
    orchestrator.snapshotShowsLoginCredentialStep(credentialSnapshot),
    hasVisibleCredentialForm(credentialSnapshot)
  );
  assert.equal(
    orchestrator.snapshotShowsLoginCredentialStep(nonCredentialSnapshot),
    hasVisibleCredentialForm(nonCredentialSnapshot)
  );
});

test("shared evidence helper keeps UI/UX evidence shape stable", () => {
  const snapshot = {
    screenshotPath: "/artifacts/frame.png",
    screenshotCaptureMode: "viewport",
    viewportWidth: 390,
    viewportHeight: 844,
    artifacts: {
      dom: [{ url: "/artifacts/dom.json" }],
      a11y: [{ url: "/artifacts/a11y.json" }]
    }
  };

  const refs = buildSnapshotEvidenceRefs(snapshot, {
    includeCaptureMode: true,
    defaultCaptureMode: "viewport",
    includeViewport: true
  });
  assert.deepEqual(refs, [
    {
      type: "screenshot",
      ref: "/artifacts/frame.png",
      captureMode: "viewport",
      viewport: {
        width: 390,
        height: 844
      }
    },
    { type: "dom", ref: "/artifacts/dom.json" },
    { type: "a11y", ref: "/artifacts/a11y.json" }
  ]);

  const uiuxRunner = new UiuxRunner();
  assert.deepEqual(uiuxRunner.buildEvidenceRefs(snapshot), refs);
});

