import test from "node:test";
import assert from "node:assert/strict";

import { buildCredentialActionPlan } from "../../../services/authInteractionPolicy.js";

function makeField(overrides = {}) {
  return {
    primarySelector: `[data-field="${overrides.id ?? "field"}"]`,
    fallbackSelector: overrides.fallbackSelector ?? null,
    label: overrides.label ?? "",
    ariaLabel: overrides.ariaLabel ?? "",
    placeholder: overrides.placeholder ?? "",
    name: overrides.name ?? "",
    id: overrides.id ?? "",
    autocomplete: overrides.autocomplete ?? "",
    inputType: overrides.inputType ?? "text",
    actionable: overrides.actionable ?? true,
    visible: overrides.visible ?? true,
    enabled: overrides.enabled ?? true,
    readOnly: overrides.readOnly ?? false,
    inViewport: overrides.inViewport ?? true,
    formSelector: overrides.formSelector ?? "[data-form='login']",
    sameFormHasPassword: overrides.sameFormHasPassword ?? false,
    sameFormHasSubmitControl: overrides.sameFormHasSubmitControl ?? false,
    top: overrides.top ?? 10,
    left: overrides.left ?? 10
  };
}

function makeControl(overrides = {}) {
  return {
    primarySelector: `[data-control="${overrides.id ?? "control"}"]`,
    fallbackSelector: overrides.fallbackSelector ?? null,
    label: overrides.label ?? "",
    type: overrides.type ?? "button",
    role: overrides.role ?? "button",
    tag: overrides.tag ?? "button",
    actionable: overrides.actionable ?? true,
    visible: overrides.visible ?? true,
    enabled: overrides.enabled ?? true,
    inViewport: overrides.inViewport ?? true,
    isSubmitLike: overrides.isSubmitLike ?? true,
    formSelector: overrides.formSelector ?? "[data-form='login']",
    top: overrides.top ?? 20,
    left: overrides.left ?? 20
  };
}

test("buildCredentialActionPlan ignores hidden or non-actionable stale username fields", () => {
  const staleHiddenUsername = makeField({
    id: "stale-username",
    name: "email",
    inputType: "email",
    actionable: false,
    visible: false,
    top: 5
  });
  const visibleUsername = makeField({
    id: "visible-username",
    name: "email",
    inputType: "email",
    top: 30
  });
  const plan = buildCredentialActionPlan(
    {
      fields: [staleHiddenUsername, visibleUsername],
      controls: [makeControl({ id: "next", label: "Next" })]
    },
    { stepHint: "username" }
  );

  assert.equal(plan.fillUsername, true);
  assert.equal(plan.usernameFieldSelector, visibleUsername.primarySelector);
  assert.equal(plan.submitControlLabel?.toLowerCase(), "next");
});

test("buildCredentialActionPlan chooses Next/Continue controls for username step", () => {
  const plan = buildCredentialActionPlan(
    {
      fields: [
        makeField({
          id: "username",
          name: "email",
          inputType: "email"
        })
      ],
      controls: [
        makeControl({ id: "signin", label: "Sign in", top: 60 }),
        makeControl({ id: "continue", label: "Continue", top: 30 })
      ]
    },
    { stepHint: "username" }
  );

  assert.equal(plan.fillUsername, true);
  assert.equal(plan.fillPassword, false);
  assert.equal(plan.submitControlSelector, "[data-control=\"continue\"]");
});

test("buildCredentialActionPlan fills password only when password field is actionable", () => {
  const plan = buildCredentialActionPlan(
    {
      fields: [
        makeField({
          id: "username-hidden",
          name: "email",
          inputType: "email",
          actionable: false,
          visible: false
        }),
        makeField({
          id: "password",
          name: "password",
          inputType: "password",
          autocomplete: "current-password"
        })
      ],
      controls: [makeControl({ id: "verify", label: "Verify and continue" })]
    },
    { stepHint: "password" }
  );

  assert.equal(plan.fillUsername, false);
  assert.equal(plan.fillPassword, true);
  assert.equal(plan.passwordFieldSelector, "[data-field=\"password\"]");
  assert.equal(plan.submitControlSelector, "[data-control=\"verify\"]");
});

test("buildCredentialActionPlan detects sign-in and verify submit controls deterministically", () => {
  const fields = [
    makeField({
      id: "password",
      name: "password",
      inputType: "password",
      autocomplete: "current-password"
    })
  ];

  const signInPlan = buildCredentialActionPlan(
    {
      fields,
      controls: [makeControl({ id: "signin", label: "Log in" })]
    },
    { stepHint: "password" }
  );

  const verifyPlan = buildCredentialActionPlan(
    {
      fields,
      controls: [makeControl({ id: "verify", label: "Verify" })]
    },
    { stepHint: "password" }
  );

  assert.equal(signInPlan.submitControlSelector, "[data-control=\"signin\"]");
  assert.equal(verifyPlan.submitControlSelector, "[data-control=\"verify\"]");
});

test("buildCredentialActionPlan treats Access Key + Password as same-step credentials", () => {
  const accessKeyField = makeField({
    id: "access-key",
    label: "Access Key",
    name: "access_key",
    inputType: "text",
    sameFormHasPassword: true,
    sameFormHasSubmitControl: true,
    formSelector: "[data-form='portal-login']"
  });
  const passwordField = makeField({
    id: "password",
    name: "password",
    inputType: "password",
    autocomplete: "current-password",
    formSelector: "[data-form='portal-login']"
  });
  const plan = buildCredentialActionPlan(
    {
      fields: [accessKeyField, passwordField],
      controls: [
        makeControl({
          id: "signin",
          label: "Sign In",
          formSelector: "[data-form='portal-login']"
        })
      ]
    },
    { stepHint: "credentials" }
  );

  assert.equal(plan.fillUsername, true);
  assert.equal(plan.fillPassword, true);
  assert.equal(plan.usernameFieldSelector, "[data-field=\"access-key\"]");
  assert.equal(plan.passwordFieldSelector, "[data-field=\"password\"]");
});

test("buildCredentialActionPlan does not stay password-only when identifier is visible on same form", () => {
  const plan = buildCredentialActionPlan(
    {
      fields: [
        makeField({
          id: "access-key",
          label: "Staff Portal Key",
          name: "portal_key",
          inputType: "text",
          sameFormHasPassword: true,
          sameFormHasSubmitControl: true,
          formSelector: "[data-form='login']"
        }),
        makeField({
          id: "password",
          name: "password",
          inputType: "password",
          autocomplete: "current-password",
          formSelector: "[data-form='login']"
        })
      ],
      controls: [makeControl({ id: "signin", label: "Sign In", formSelector: "[data-form='login']" })]
    },
    { stepHint: "password" }
  );

  assert.equal(plan.fillUsername, true);
  assert.equal(plan.fillPassword, true);
});

test("buildCredentialActionPlan enables identifier/password fill from detector signals when selectors are weak", () => {
  const plan = buildCredentialActionPlan(
    {
      fields: [],
      controls: [makeControl({ id: "signin", label: "Sign In", formSelector: "[data-form='login']" })],
      identifierFieldDetected: true,
      usernameFieldDetected: true,
      passwordFieldDetected: true,
      identifierFieldVisibleCount: 1,
      passwordFieldVisibleCount: 1
    },
    { stepHint: "credentials" }
  );

  assert.equal(plan.fillUsername, true);
  assert.equal(plan.fillPassword, true);
});
