import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthInputFieldsPayload,
  deriveAuthAssistFieldVisibility
} from "./authAssistFields.js";

test("deriveAuthAssistFieldVisibility shows credentials inputs for functionality login-assist payload", () => {
  const ui = deriveAuthAssistFieldVisibility({
    state: "awaiting_input_fields",
    loginRequired: true,
    form: {
      visibleStep: "credentials",
      inputFields: [
        {
          key: "access_key",
          label: "Access Key",
          placeholder: "Enter your access key",
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
      ]
    }
  });

  assert.equal(ui.credentialsPending, true);
  assert.equal(ui.otpPending, false);
  assert.equal(ui.showIdentifierField, true);
  assert.equal(ui.showPasswordField, true);
  assert.equal(ui.renderFields[0]?.label, "Access Key");
  assert.equal(ui.renderFields[1]?.label, "Password");
  assert.equal(ui.renderFields[1]?.secret, true);
  assert.equal(ui.identifierPlaceholder, "Access Key");
});

test("deriveAuthAssistFieldVisibility prioritizes otp input when otp is required", () => {
  const ui = deriveAuthAssistFieldVisibility({
    state: "awaiting_otp",
    form: {
      otpFieldDetected: true,
      visibleStep: "otp",
      inputFields: [
        {
          key: "verification_code",
          label: "Verification Code",
          placeholder: "Enter code",
          kind: "otp",
          secret: true,
          required: true,
          position: 1
        }
      ]
    }
  });

  assert.equal(ui.otpPending, true);
  assert.equal(ui.credentialsPending, false);
  assert.equal(ui.showIdentifierField, false);
  assert.equal(ui.showPasswordField, false);
  assert.equal(ui.renderFields.length, 1);
  assert.equal(ui.renderFields[0]?.key, "verification_code");
});

test("deriveAuthAssistFieldVisibility does not synthesize credential fields when none were detected", () => {
  const ui = deriveAuthAssistFieldVisibility({
    state: "awaiting_input_fields",
    loginRequired: true,
    form: {
      visibleStep: "credentials",
      inputFields: []
    }
  });

  assert.equal(ui.credentialsPending, true);
  assert.equal(ui.otpPending, false);
  assert.equal(ui.showIdentifierField, false);
  assert.equal(ui.showPasswordField, false);
  assert.equal(ui.renderFields.length, 0);
});

test("deriveAuthAssistFieldVisibility does not synthesize otp fields when none were detected", () => {
  const ui = deriveAuthAssistFieldVisibility({
    state: "awaiting_otp",
    form: {
      visibleStep: "otp",
      otpFieldDetected: false,
      inputFields: []
    }
  });

  assert.equal(ui.otpPending, true);
  assert.equal(ui.credentialsPending, false);
  assert.equal(ui.showIdentifierField, false);
  assert.equal(ui.showPasswordField, false);
  assert.equal(ui.renderFields.length, 0);
});

test("buildAuthInputFieldsPayload keeps canonical payload scoped to detected field keys only", () => {
  const payload = buildAuthInputFieldsPayload({
    renderFields: [
      {
        key: "enter_your_access_key",
        label: "Access Key",
        kind: "text",
        secret: false,
        required: true
      },
      {
        key: "password",
        label: "Password",
        kind: "password",
        secret: true,
        required: true
      }
    ],
    values: {
      enter_your_access_key: "LRM-OWN-K9X2",
      password: "RISE@owner1",
      username: "should-not-leak",
      identifier: "should-not-leak",
      email: "should-not-leak"
    }
  });

  assert.deepEqual(payload, {
    inputFields: {
      enter_your_access_key: "LRM-OWN-K9X2",
      password: "RISE@owner1"
    }
  });
  assert.equal(Object.hasOwn(payload, "username"), false);
  assert.equal(Object.hasOwn(payload, "identifier"), false);
  assert.equal(Object.hasOwn(payload, "email"), false);
});
