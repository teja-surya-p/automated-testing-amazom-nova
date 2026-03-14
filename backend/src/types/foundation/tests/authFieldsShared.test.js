import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthFormMetadata,
  buildSafeAuthRuntimeMetadata,
  buildCredentialActionPlan,
  detectVisibleCredentialFormSignals,
  resolveFirstCredentialAlias
} from "../../../library/auth-fields/index.js";
import {
  buildCredentialActionPlan as policyBuildCredentialActionPlan
} from "../../../services/authInteractionPolicy.js";
import {
  detectVisibleCredentialFormSignals as legacyDetectVisibleCredentialFormSignals
} from "../../../library/common-tests/authFlowSignals.js";

test("auth interaction policy reuses shared credential action planner", () => {
  assert.equal(policyBuildCredentialActionPlan, buildCredentialActionPlan);
});

test("shared credential alias mapper resolves identifier/access-key aliases deterministically", () => {
  assert.equal(
    resolveFirstCredentialAlias({ access_key: "tenant-key-42", email: "ignored@example.com" }),
    "tenant-key-42"
  );
  assert.equal(resolveFirstCredentialAlias({ username: "portal-user" }), "portal-user");
  assert.equal(resolveFirstCredentialAlias({}), "");
});

test("shared auth form metadata includes safe probe/runtime details without secrets", () => {
  const form = buildAuthFormMetadata({
    probe: {
      identifierFieldDetected: true,
      usernameFieldDetected: true,
      passwordFieldDetected: true,
      otpFieldDetected: false,
      submitControlDetected: true,
      identifierFieldVisibleCount: 1,
      usernameFieldVisibleCount: 1,
      passwordFieldVisibleCount: 1,
      otpFieldVisibleCount: 0,
      identifierLabelCandidates: ["Access Key", "Login ID"],
      visibleStep: "credentials",
      nextRecommendedAction: "ENTER_CREDENTIALS",
      inputFields: [
        {
          key: "access_key",
          label: "Access Key",
          placeholder: "Enter access key",
          kind: "text",
          secret: false,
          required: true,
          position: 1
        },
        {
          key: "password",
          label: "Password",
          placeholder: "Enter password",
          kind: "password",
          secret: true,
          required: true,
          position: 2
        }
      ],
      submitAction: {
        label: "Sign In",
        type: "submit"
      }
    },
    runtimeMeta: {
      identifierFilled: true,
      usernameFilled: true,
      passwordFilled: true,
      submitTriggered: true,
      submitControlType: "control-click",
      postSubmitProbeState: "password",
      postSubmitUrlChanged: true
    }
  });

  assert.equal(form.identifierFieldDetected, true);
  assert.equal(form.passwordFieldDetected, true);
  assert.equal(form.submitControlDetected, true);
  assert.equal(form.visibleStep, "credentials");
  assert.equal(form.identifierFilled, true);
  assert.equal(form.passwordFilled, true);
  assert.equal(form.submitTriggered, true);
  assert.equal(form.submitControlType, "control-click");
  assert.equal(form.postSubmitUrlChanged, true);
  assert.deepEqual(form.identifierLabelCandidates, ["Access Key", "Login ID"]);
  assert.equal(form.inputFields?.[0]?.key, "access_key");
  assert.equal(form.inputFields?.[1]?.secret, true);
  assert.equal(form.submitAction?.label, "Sign In");
  assert.equal(Object.prototype.hasOwnProperty.call(form, "password"), false);
});

test("shared runtime metadata keeps safe dynamic input execution diagnostics", () => {
  const runtime = buildSafeAuthRuntimeMetadata(
    {
      inputFieldsConsumed: true,
      fillExecutionAttempted: true,
      fillExecutionSucceeded: true,
      fieldTargetsResolvedCount: 2,
      fieldTargetsFilledCount: 2,
      fieldTargetsVerifiedCount: 2,
      focusedFieldKeys: ["access_key", "password"],
      submitTriggered: true,
      submitControlResolved: true,
      submitControlType: "control-click",
      submitControlDetected: true,
      targetedPageUrl: "https://example.com/login",
      targetedFrameUrl: "https://example.com/login",
      targetedFrameType: "page",
      perField: [
        {
          key: "access_key",
          resolved: true,
          actionable: true,
          fillAttempted: true,
          filled: true,
          verified: true,
          valuePresentAfterFill: true,
          valueLengthAfterFill: 12
        },
        {
          key: "password",
          resolved: true,
          actionable: true,
          fillAttempted: true,
          filled: true,
          verified: true,
          valuePresentAfterFill: true,
          valueLengthAfterFill: 10
        }
      ],
      viewerFrameCapturedAfterFill: true,
      viewerFrameCapturedAfterSubmit: true,
      resumeLoopAwakened: true,
      resumeLoopConsumedFields: true,
      authClassificationReason: "Authenticated signals dominate weak identifier-only hints.",
      loginWallStrength: "weak",
      authenticatedSignalStrength: "strong",
      currentFunctionalPhase: "authenticated",
      authenticatedConfirmedAt: "2026-03-11T00:00:00.000Z",
      resumedFromAuth: true,
      logoutScheduled: true,
      logoutExecuted: false,
      whyAuthRegressed: null,
      whyLogoutBlocked: "reserved_for_final_logout_stage"
    },
    null
  );

  assert.equal(runtime.inputFieldsConsumed, true);
  assert.equal(runtime.fillExecutionAttempted, true);
  assert.equal(runtime.fillExecutionSucceeded, true);
  assert.equal(runtime.fieldTargetsResolvedCount, 2);
  assert.equal(runtime.fieldTargetsFilledCount, 2);
  assert.equal(runtime.fieldTargetsVerifiedCount, 2);
  assert.deepEqual(runtime.focusedFieldKeys, ["access_key", "password"]);
  assert.equal(runtime.submitTriggered, true);
  assert.equal(runtime.submitControlResolved, true);
  assert.equal(runtime.submitControlType, "control-click");
  assert.equal(runtime.submitControlDetected, true);
  assert.equal(runtime.targetedPageUrl, "https://example.com/login");
  assert.equal(runtime.targetedFrameUrl, "https://example.com/login");
  assert.equal(runtime.targetedFrameType, "page");
  assert.equal(runtime.perField?.length, 2);
  assert.equal(runtime.perField?.[0]?.key, "access_key");
  assert.equal(runtime.perField?.[0]?.valueLengthAfterFill, 12);
  assert.equal(runtime.viewerFrameCapturedAfterFill, true);
  assert.equal(runtime.viewerFrameCapturedAfterSubmit, true);
  assert.equal(runtime.resumeLoopAwakened, true);
  assert.equal(runtime.resumeLoopConsumedFields, true);
  assert.equal(runtime.authClassificationReason, "Authenticated signals dominate weak identifier-only hints.");
  assert.equal(runtime.loginWallStrength, "weak");
  assert.equal(runtime.authenticatedSignalStrength, "strong");
  assert.equal(runtime.currentFunctionalPhase, "authenticated");
  assert.equal(runtime.authenticatedConfirmedAt, "2026-03-11T00:00:00.000Z");
  assert.equal(runtime.resumedFromAuth, true);
  assert.equal(runtime.logoutScheduled, true);
  assert.equal(runtime.logoutExecuted, false);
  assert.equal(runtime.whyLogoutBlocked, "reserved_for_final_logout_stage");
});

test("legacy shared auth-flow signal module delegates to the new shared auth-fields detector", () => {
  const snapshot = {
    formControls: [
      {
        tag: "input",
        type: "text",
        labelText: "Access Key",
        inViewport: true
      },
      {
        tag: "input",
        type: "password",
        labelText: "Password",
        inViewport: true
      }
    ],
    interactive: [
      {
        tag: "button",
        text: "Sign in",
        inViewport: true,
        disabled: false
      }
    ]
  };

  const sharedResult = detectVisibleCredentialFormSignals(snapshot);
  const legacyResult = legacyDetectVisibleCredentialFormSignals(snapshot);
  assert.deepEqual(legacyResult, sharedResult);
  assert.equal(sharedResult.hasCredentialForm, true);
});

test("shared credential action planner prefers submit controls in the active auth form", () => {
  const plan = buildCredentialActionPlan(
    {
      stepHint: "credentials",
      fields: [
        {
          primarySelector: "[data-field='identifier']",
          fallbackSelector: "input[name='accessKey']",
          inputType: "text",
          label: "Access Key",
          actionable: true,
          visible: true,
          enabled: true,
          readOnly: false,
          inViewport: true,
          formSelector: "[data-form='login']",
          sameFormHasPassword: true,
          sameFormHasSubmitControl: true,
          top: 120,
          left: 24
        },
        {
          primarySelector: "[data-field='password']",
          fallbackSelector: "input[type='password']",
          inputType: "password",
          label: "Password",
          actionable: true,
          visible: true,
          enabled: true,
          readOnly: false,
          inViewport: true,
          formSelector: "[data-form='login']",
          sameFormHasPassword: true,
          sameFormHasSubmitControl: true,
          top: 160,
          left: 24
        }
      ],
      controls: [
        {
          primarySelector: "[data-decoy='top-continue']",
          fallbackSelector: "button.decoy",
          label: "Continue",
          type: "button",
          tag: "button",
          role: "button",
          actionable: true,
          visible: true,
          enabled: true,
          inViewport: true,
          formSelector: null,
          isSubmitLike: true,
          top: 32,
          left: 16
        },
        {
          primarySelector: "[data-submit='real-go']",
          fallbackSelector: "form#login button[type='submit']",
          label: "Go",
          type: "submit",
          tag: "button",
          role: "button",
          actionable: true,
          visible: true,
          enabled: true,
          inViewport: true,
          formSelector: "[data-form='login']",
          isSubmitLike: true,
          top: 220,
          left: 24
        }
      ]
    },
    {
      stepHint: "credentials",
      allowUsername: true,
      allowPassword: true,
      forceSubmitControl: true
    }
  );

  assert.equal(plan.fillUsername, true);
  assert.equal(plan.fillPassword, true);
  assert.equal(plan.submitControlSelector, "[data-submit='real-go']");
});
