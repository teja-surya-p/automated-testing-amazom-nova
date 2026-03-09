import test from "node:test";
import assert from "node:assert/strict";

import { BrowserSession } from "../../../services/browserSession.js";
import { buildCredentialActionPlan } from "../../../services/authInteractionPolicy.js";
import { inferAuthVisibleStep } from "../../../services/authAssistState.js";

test("collectAuthInteractionContext detects access-key login form and yields actionable credential plan", async () => {
  const session = new BrowserSession("qa-auth-context-test", {
    runConfig: {
      testMode: "functional",
      readiness: {
        uiReadyStrategy: "networkidle-only",
        readyTimeoutMs: 2_000
      },
      artifacts: {
        captureHtml: false,
        captureA11ySnapshot: false,
        captureHar: false,
        captureTraceOnFail: false,
        captureVideo: "never"
      }
    }
  });

  try {
    await session.launch();
    await session.page.setContent(`
      <main>
        <form id="login-form">
          <label for="access-key">Enter your access key</label>
          <input id="access-key" name="access_key" type="text" />
          <label for="password">Enter password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" />
          <button type="submit">Sign In</button>
        </form>
      </main>
    `);

    const probe = await session.collectAuthFormProbe();
    const context = await session.collectAuthInteractionContext();
    const plan = buildCredentialActionPlan(context, {
      stepHint: inferAuthVisibleStep(probe),
      allowUsername: true,
      allowPassword: true
    });

    assert.equal(probe.visibleStep, "credentials");
    assert.equal(probe.identifierFieldDetected, true);
    assert.equal(probe.passwordFieldDetected, true);
    assert.equal(context.stepHint, "credentials");
    assert.equal(context.identifierFieldDetected, true);
    assert.equal(context.passwordFieldDetected, true);
    assert.ok(context.fields.length >= 2);
    assert.ok(context.controls.length >= 1);
    assert.equal(plan.fillUsername, true);
    assert.equal(plan.fillPassword, true);
    assert.ok(plan.usernameFieldSelector);
    assert.ok(plan.passwordFieldSelector);
    assert.ok(plan.submitControlSelector || plan.submitControlFallbackSelector);
  } finally {
    await session.close().catch(() => {});
  }
});

