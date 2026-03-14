import test from "node:test";
import assert from "node:assert/strict";

import { config } from "../../../lib/config.js";
import { EventBus } from "../../../services/eventBus.js";
import { QaOrchestrator } from "../../../orchestrator/qaOrchestrator.js";
import { buildRunReport } from "../../../services/reportBuilder.js";
import { SessionStore } from "../../../services/sessionStore.js";

function createRunConfig() {
  return {
    startUrl: "https://example.com/account",
    goal: "Functional authenticated smoke test",
    testMode: "functional",
    profileTag: "functional-local",
    providerMode: "heuristic",
    profileTagRequired: true,
    budgets: {
      maxSteps: 10,
      timeBudgetMs: 60_000,
      stagnationLimit: 2,
      actionRetryCount: 1
    },
    readiness: {
      uiReadyStrategy: "networkidle-only",
      readyTimeoutMs: 5_000
    },
    functional: {
      loginAssist: {
        enabled: true,
        timeoutMs: 30_000,
        resumeStrategy: "restart-flow"
      }
    }
  };
}

function createOrchestratorHarness() {
  const sessionStore = new SessionStore();
  const orchestrator = new QaOrchestrator({
    eventBus: new EventBus(),
    sessionStore,
    explorerProvider: {
      async plan() {
        return null;
      }
    },
    auditorProvider: {
      async audit() {
        return null;
      }
    },
    documentarianProvider: {
      async buildEvidence() {
        return null;
      }
    }
  });

  const session = sessionStore.createSession({
    goal: "Functional authenticated smoke test",
    startUrl: "https://example.com/account",
    runConfig: createRunConfig(),
    providerMode: "heuristic",
    goalFamily: "functional",
    summary: "Queued functional run."
  });

  return {
    orchestrator,
    sessionStore,
    session
  };
}

test("resume target resolution avoids auth/logout URLs and prefers authenticated destination", () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    startUrl: "http://localhost:3113/login",
    currentUrl: "http://localhost:3113/login",
    authAssist: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      resumeTargetUrl: "http://localhost:3113/logout"
    },
    observations: [
      {
        url: "http://localhost:3113/dashboard",
        step: 1
      },
      {
        url: "http://localhost:3113/logout",
        step: 2
      }
    ]
  });

  const resolved = orchestrator.resolveResumeTargetUrl(session.id, "http://localhost:3113/logout");
  assert.equal(resolved, "http://localhost:3113/dashboard");
});

test("credential submission transitions to awaiting_otp without persisting secrets", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  let probeCallCount = 0;

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      probeCallCount += 1;
      if (probeCallCount <= 1) {
        return {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          reason: "Login wall detected"
        };
      }
      return {
        pageUrl: "https://example.com/verify",
        site: "example.com",
        loginWallDetected: false,
        otpChallengeDetected: true,
        captchaDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        otpFieldDetected: true,
        submitControlDetected: true,
        reason: "OTP challenge detected"
      };
    },
    async submitAuthCredentials() {
      return {
        success: true,
        code: "CREDENTIALS_SUBMITTED",
        reason: "Credentials submitted.",
        authenticated: false,
        probe: {
          pageUrl: "https://example.com/verify",
          site: "example.com",
          loginWallDetected: false,
          otpChallengeDetected: true,
          captchaDetected: false,
          usernameFieldDetected: false,
          passwordFieldDetected: false,
          otpFieldDetected: true,
          submitControlDetected: true,
          reason: "OTP challenge detected"
        }
      };
    },
    async persistStorageState() {
      return true;
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "qa-user@example.com",
    password: "super-secret-password"
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "OTP_REQUIRED");

  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.authAssist?.state, "awaiting_otp");
  assert.equal(stored.authAssist?.form?.otpFieldDetected, true);
  assert.equal(JSON.stringify(stored).includes("super-secret-password"), false);
  assert.equal(JSON.stringify(stored).includes("qa-user@example.com"), false);
});

test("dynamic input-fields submission uses detected field keys and returns input-field state", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    status: "login-assist",
    authAssist: {
      state: "awaiting_input_fields",
      code: "LOGIN_REQUIRED",
      reason: "Login wall detected.",
      site: "example.com",
      pageUrl: "https://example.com/login",
      loginRequired: true,
      form: {
        visibleStep: "credentials",
        identifierFieldDetected: true,
        passwordFieldDetected: true,
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
      }
    }
  });

  let receivedInputFields = null;
  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/login",
        site: "example.com",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        identifierFieldVisibleCount: 1,
        identifierLabelCandidates: ["Access Key"],
        visibleStep: "credentials",
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
        },
        reason: "Identifier and password fields are visible on the same step."
      };
    },
    async submitAuthInputFields({ inputFields }) {
      receivedInputFields = inputFields;
      return {
        success: true,
        code: "INPUT_FIELDS_SUBMITTED",
        reason: "Input fields were submitted to the active login form.",
        authenticated: false,
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
            valueLengthAfterFill: 14
          },
          {
            key: "password",
            resolved: true,
            actionable: true,
            fillAttempted: true,
            filled: true,
            verified: true,
            valuePresentAfterFill: true,
            valueLengthAfterFill: 21
          }
        ],
        viewerFrameCapturedAfterFill: true,
        viewerFrameCapturedAfterSubmit: true,
        viewerSnapshots: {
          afterFill: {
            screenshotBase64: "ZmFrZS1maWxsLWZyYW1l",
            url: "https://example.com/login",
            title: "Sign In"
          },
          afterSubmit: {
            screenshotBase64: "ZmFrZS1zdWJtaXQtZnJhbWU=",
            url: "https://example.com/login/challenge",
            title: "Sign In"
          }
        },
        postSubmitUrlChanged: true,
        postSubmitUrl: "https://example.com/login/challenge",
        probe: {
          pageUrl: "https://example.com/login/challenge",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          identifierFieldVisibleCount: 1,
          identifierLabelCandidates: ["Access Key"],
          visibleStep: "credentials",
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
          },
          reason: "Identifier and password fields are visible on the same step."
        }
      };
    },
    async submitAuthCredentials() {
      throw new Error("legacy submitAuthCredentials should not be used for input-fields payloads");
    },
    async persistStorageState() {
      return true;
    }
  });

  const result = await orchestrator.submitSessionInputFields(session.id, {
    inputFields: {
      access_key: "access-key-123",
      password: "super-secret-password"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "AUTH_STEP_ADVANCED");
  assert.equal(result.authAssist?.state, "auth_step_advanced");
  assert.equal(receivedInputFields?.access_key, "access-key-123");
  assert.equal(receivedInputFields?.password, "super-secret-password");
  assert.equal(result.authAssist?.runtime?.inputFieldsConsumed, true);
  assert.equal(result.authAssist?.runtime?.fillExecutionSucceeded, true);
  assert.equal(result.authAssist?.runtime?.fieldTargetsVerifiedCount, 2);
  assert.equal(result.authAssist?.runtime?.targetedFrameType, "page");
  assert.equal(result.authAssist?.runtime?.viewerFrameCapturedAfterFill, true);
  assert.equal(result.authAssist?.runtime?.viewerFrameCapturedAfterSubmit, true);
  assert.equal(result.authAssist?.runtime?.perField?.length, 2);
  assert.deepEqual(result.authAssist?.runtime?.focusedFieldKeys, ["access_key", "password"]);
  const storedSession = sessionStore.getSession(session.id);
  assert.match(String(storedSession?.frame ?? ""), /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(sessionStore.getSession(session.id)).includes("super-secret-password"), false);
});

test("multi-step auth advances from username to password without INVALID_CREDENTIALS", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  let probeCallCount = 0;

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      probeCallCount += 1;
      if (probeCallCount <= 1) {
        return {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: true,
          passwordFieldDetected: false,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "username",
          reason: "Username/email step is visible."
        };
      }
      return {
        pageUrl: "https://example.com/login/password",
        site: "example.com",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        visibleStep: "password",
        reason: "Password step is visible."
      };
    },
    async submitAuthCredentials() {
      return {
        success: true,
        code: "CREDENTIALS_SUBMITTED",
        reason: "Username step submitted and password step shown.",
        authenticated: false,
        submitTriggered: true,
        stepAdvanced: true,
        probe: {
          pageUrl: "https://example.com/login/password",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "password",
          reason: "Password step is visible."
        }
      };
    },
    async persistStorageState() {
      return true;
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "qa-user@example.com",
    password: "super-secret-password"
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "AUTH_STEP_ADVANCED");
  assert.equal(result.authAssist?.state, "awaiting_password");

  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.authAssist?.state, "awaiting_password");
  assert.equal(stored.authAssist?.code, "AUTH_STEP_ADVANCED");
});

test("single-step custom identifier + password transitions to auth_step_advanced while auth settles", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  let submitCallCount = 0;
  let receivedCredentials = null;

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/login",
        site: "example.com",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        identifierFieldVisibleCount: 1,
        identifierLabelCandidates: ["Access Key"],
        visibleStep: "credentials",
        reason: "Identifier and password fields are visible on the same step."
      };
    },
    async submitAuthCredentials() {
      submitCallCount += 1;
      receivedCredentials = arguments[0];
      return {
        success: true,
        code: "CREDENTIALS_SUBMITTED",
        reason: "Credentials submitted on single-step auth form.",
        authenticated: false,
        submitTriggered: true,
        submitControlType: "control-click",
        postSubmitUrlChanged: true,
        postSubmitUrl: "https://example.com/login/challenge",
        stepAdvanced: false,
        probe: {
          pageUrl: "https://example.com/login/challenge",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          identifierFieldVisibleCount: 1,
          identifierLabelCandidates: ["Access Key"],
          visibleStep: "credentials",
          invalidCredentialErrorDetected: false,
          reason: "Identifier and password fields are visible on the same step."
        }
      };
    },
    async persistStorageState() {
      return true;
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "access-key-123",
    password: "super-secret-password"
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "AUTH_STEP_ADVANCED");
  assert.equal(result.authAssist?.state, "auth_step_advanced");
  assert.equal(result.authAssist?.submitAttempted, true);
  assert.equal(submitCallCount, 1);
  assert.equal(result.authAssist?.form?.identifierFieldDetected, true);
  assert.equal(result.authAssist?.form?.passwordFieldDetected, true);
  assert.equal(result.authAssist?.form?.visibleStep, "credentials");
  assert.equal(result.authAssist?.runtime?.submitTriggered, true);
  assert.equal(result.authAssist?.runtime?.submitControlType, "control-click");
  assert.equal(receivedCredentials?.identifier, "access-key-123");
  assert.equal(receivedCredentials?.username, "access-key-123");
  assert.equal(receivedCredentials?.email, "access-key-123");
  assert.equal(receivedCredentials?.password, "super-secret-password");

  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.authAssist?.state, "auth_step_advanced");
  assert.equal(stored.authAssist?.form?.identifierFieldDetected, true);
  assert.equal(stored.authAssist?.submitAttempted, true);
  assert.equal(stored.authAssist?.runtime?.submitTriggered, true);
});

test("credential submission returns AUTH_SUBMIT_NOT_TRIGGERED instead of stale LOGIN_REQUIRED when browser cannot trigger submit", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/login",
        site: "example.com",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        identifierFieldVisibleCount: 1,
        identifierLabelCandidates: ["Access Key"],
        visibleStep: "credentials",
        reason: "Identifier and password fields are visible on the same step."
      };
    },
    async submitAuthCredentials() {
      return {
        success: true,
        code: "CREDENTIALS_SUBMITTED",
        reason: "Credentials were entered but no submit action could be triggered.",
        authenticated: false,
        submitTriggered: false,
        submitControlType: "none",
        usernameFilled: true,
        passwordFilled: true,
        identifierFilled: true,
        browserActionExecuted: true,
        postSubmitUrlChanged: false,
        postSubmitProbeState: "credentials",
        probe: {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          identifierFieldVisibleCount: 1,
          identifierLabelCandidates: ["Access Key"],
          visibleStep: "credentials",
          invalidCredentialErrorDetected: false,
          reason: "Identifier and password fields are visible on the same step."
        }
      };
    },
    async confirmAuthenticatedSession() {
      return {
        state: "awaiting_credentials",
        code: "LOGIN_REQUIRED",
        reason: "Identifier and password fields are visible on the same step.",
        probe: {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          identifierFieldVisibleCount: 1,
          identifierLabelCandidates: ["Access Key"],
          visibleStep: "credentials",
          reason: "Identifier and password fields are visible on the same step."
        }
      };
    },
    async persistStorageState() {
      return true;
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "access-key-123",
    password: "super-secret-password"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTH_SUBMIT_NOT_TRIGGERED");
  assert.notEqual(result.code, "LOGIN_REQUIRED");
  assert.equal(result.authAssist?.state, "awaiting_credentials");
  assert.equal(result.authAssist?.runtime?.submitTriggered, false);
  assert.equal(result.authAssist?.runtime?.identifierFilled, true);
  assert.equal(result.authAssist?.runtime?.passwordFilled, true);

  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.authAssist?.code, "AUTH_SUBMIT_NOT_TRIGGERED");
  assert.equal(stored.authAssist?.runtime?.submitTriggered, false);
});

test("credential submission uses AUTH_PENDING_TRANSITION when submit is triggered without deterministic transition", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    status: "login-assist",
    authAssist: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: "Login wall detected.",
      site: "example.com",
      pageUrl: "https://example.com/login",
      loginRequired: true,
      form: {
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true
      }
    }
  });

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/login",
        site: "example.com",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        visibleStep: "credentials",
        reason: "Identifier and password fields are visible on the same step."
      };
    },
    async submitAuthCredentials() {
      return {
        success: true,
        code: "CREDENTIALS_SUBMITTED",
        reason: "Credentials submitted.",
        submitTriggered: true,
        identifierFilled: true,
        passwordFilled: true,
        postSubmitUrlChanged: false,
        probe: {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "credentials",
          reason: "Identifier and password fields are visible on the same step."
        }
      };
    },
    async confirmAuthenticatedSession() {
      return {
        state: "awaiting_credentials",
        code: "LOGIN_REQUIRED",
        reason: "Identifier and password fields are visible on the same step.",
        probe: {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "credentials",
          reason: "Identifier and password fields are visible on the same step."
        }
      };
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "access-key-123",
    password: "super-secret-password"
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "AUTH_PENDING_TRANSITION");
  assert.notEqual(result.code, "AUTH_SUBMIT_NOT_TRIGGERED");
  assert.equal(result.authAssist?.state, "submitting_credentials");
  assert.equal(result.authAssist?.runtime?.submitTriggered, true);

  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.authAssist?.code, "AUTH_PENDING_TRANSITION");
  assert.equal(stored.authAssist?.state, "submitting_credentials");
  assert.equal(stored.authAssist?.runtime?.submitTriggered, true);
});

test("credential submission confirms authenticated state and preserves resume target metadata", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    status: "login-assist",
    currentUrl: "https://example.com/account",
    authAssist: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      reason: "Login wall detected.",
      site: "example.com",
      pageUrl: "https://example.com/login",
      loginRequired: true,
      resumeTargetUrl: "https://example.com/account",
      resumeCheckpoint: {
        mode: "functional",
        step: 3
      },
      form: {
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true
      }
    }
  });

  let confirmationArgs = null;
  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/login",
        site: "example.com",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        visibleStep: "credentials",
        reason: "Identifier and password fields are visible on the same step."
      };
    },
    async submitAuthCredentials() {
      return {
        success: true,
        code: "CREDENTIALS_SUBMITTED",
        reason: "Credentials submitted.",
        authenticated: false,
        submitTriggered: true,
        probe: {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "credentials",
          reason: "Identifier and password fields are visible on the same step."
        }
      };
    },
    async confirmAuthenticatedSession(args) {
      confirmationArgs = args;
      return {
        state: "authenticated",
        code: "AUTH_VALIDATED",
        reason: "Protected content became reachable after login.",
        probe: {
          pageUrl: "https://example.com/account",
          site: "example.com",
          loginWallDetected: false,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: false,
          passwordFieldDetected: false,
          otpFieldDetected: false,
          submitControlDetected: false,
          visibleStep: "authenticated",
          reason: "Authenticated markers are visible."
        }
      };
    },
    async persistStorageState() {
      return true;
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "access-key-123",
    password: "correct-password"
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "AUTH_VALIDATED");
  assert.equal(confirmationArgs?.resumeTargetUrl, "https://example.com/account");
  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.status, "running");
  assert.equal(stored.authAssist?.state, "authenticated");
  assert.equal(stored.authAssist?.resumeTargetUrl, "https://example.com/account");
  assert.equal(stored.authAssist?.resumeCheckpoint?.step, 3);
});

test("otp submission transitions session back to running", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();

  sessionStore.patchSession(session.id, {
    status: "login-assist",
    authAssist: {
      state: "awaiting_otp",
      code: "OTP_REQUIRED",
      reason: "OTP challenge detected",
      site: "example.com",
      pageUrl: "https://example.com/verify",
      loginRequired: true,
      form: {
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        otpFieldDetected: true,
        submitControlDetected: true
      },
      startedAt: new Date().toISOString()
    }
  });

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/account",
        site: "example.com",
        loginWallDetected: false,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        otpFieldDetected: false,
        submitControlDetected: false,
        reason: "No authentication wall detected."
      };
    },
    async submitAuthOtp() {
      return {
        success: true,
        code: "OTP_SUBMITTED",
        reason: "OTP submitted.",
        authenticated: true,
        probe: {
          pageUrl: "https://example.com/account",
          site: "example.com",
          loginWallDetected: false,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          passwordFieldDetected: false,
          otpFieldDetected: false,
          submitControlDetected: false,
          reason: "No authentication wall detected."
        }
      };
    },
    async persistStorageState() {
      return true;
    }
  });

  const result = await orchestrator.submitSessionOtp(session.id, {
    otp: "123456"
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "AUTH_VALIDATED");

  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.status, "running");
  assert.equal(stored.authAssist?.state, "authenticated");
  assert.equal(JSON.stringify(stored).includes("123456"), false);
});

test("credential submission returns AUTH_STATE_INVALID when session is waiting for otp", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    status: "login-assist",
    authAssist: {
      state: "awaiting_otp",
      code: "OTP_REQUIRED",
      reason: "OTP challenge detected",
      site: "example.com",
      pageUrl: "https://example.com/verify",
      loginRequired: true,
      form: {
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        otpFieldDetected: true,
        submitControlDetected: true
      },
      startedAt: new Date().toISOString()
    }
  });

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/verify",
        site: "example.com",
        loginWallDetected: false,
        otpChallengeDetected: true,
        captchaDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        otpFieldDetected: true,
        submitControlDetected: true,
        reason: "OTP challenge detected"
      };
    },
    async submitAuthCredentials() {
      throw new Error("should not submit credentials when awaiting otp");
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "qa-user@example.com",
    password: "super-secret-password"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTH_STATE_INVALID");
  assert.equal(result.message, "Session is not waiting for credentials.");
});

test("explicit invalid credential error maps to INVALID_CREDENTIALS", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();

  orchestrator.activeBrowserSessions.set(session.id, {
    async collectAuthFormProbe() {
      return {
        pageUrl: "https://example.com/login",
        site: "example.com",
        loginWallDetected: true,
        otpChallengeDetected: false,
        captchaDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true,
        visibleStep: "password",
        invalidCredentialErrorDetected: true,
        invalidCredentialReason: "Invalid username or password.",
        reason: "Authentication form shows an invalid credential error."
      };
    },
    async submitAuthCredentials() {
      return {
        success: true,
        code: "CREDENTIALS_SUBMITTED",
        reason: "Credentials submitted.",
        authenticated: false,
        submitTriggered: true,
        stepAdvanced: false,
        explicitInvalidCredentialErrorDetected: true,
        probe: {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "password",
          invalidCredentialErrorDetected: true,
          invalidCredentialReason: "Invalid username or password.",
          reason: "Authentication form shows an invalid credential error."
        }
      };
    }
  });

  const result = await orchestrator.submitSessionCredentials(session.id, {
    username: "qa-user@example.com",
    password: "wrong-secret"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_CREDENTIALS");
  assert.equal(sessionStore.getSession(session.id)?.authAssist?.state, "auth_failed");
});

test("handleLoginAssist resumes when authenticated signal is published by credentials flow", async () => {
  const originalPollMs = config.loginAssistPollMs;
  config.loginAssistPollMs = 1;

  try {
    const { orchestrator, sessionStore, session } = createOrchestratorHarness();
    const browserSession = {
      async collectAuthFormProbe() {
        return {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "credentials",
          reason: "Login wall detected."
        };
      },
      async confirmAuthenticatedSession() {
        return {
          state: "authenticated",
          code: "AUTH_VALIDATED",
          reason: "Authentication signals are stable and login wall is no longer visible.",
          probe: {
            pageUrl: "https://example.com/account",
            site: "example.com",
            loginWallDetected: false,
            otpChallengeDetected: false,
            captchaDetected: false,
            usernameFieldDetected: false,
            identifierFieldDetected: false,
            passwordFieldDetected: false,
            otpFieldDetected: false,
            submitControlDetected: false,
            visibleStep: "authenticated",
            reason: "Authenticated markers are visible."
          }
        };
      },
      async isAuthenticated() {
        return false;
      }
    };

    const runPromise = orchestrator.handleLoginAssist({
      sessionId: session.id,
      browserSession,
      domain: "example.com"
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const current = sessionStore.getSession(session.id);
    sessionStore.patchSession(session.id, {
      authAssist: {
        ...(current?.authAssist ?? {}),
        state: "authenticated",
        code: "AUTH_VALIDATED",
        source: "api",
        reason: "Credentials accepted and authentication detected.",
        loginRequired: false
      }
    });

    const resumed = await runPromise;
    const updated = sessionStore.getSession(session.id);
    assert.equal(resumed, true);
    assert.equal(updated?.status, "running");
    assert.equal(updated?.authAssist?.state, "resumed");
    assert.equal(updated?.authAssist?.code, "AUTH_VALIDATED");
    assert.equal(updated?.authAssist?.resumeTargetUrl, "https://example.com/account");
  } finally {
    config.loginAssistPollMs = originalPollMs;
  }
});

test("handleLoginAssist does not park run when probe has no credential-field evidence", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();

  const resumed = await orchestrator.handleLoginAssist({
    sessionId: session.id,
    browserSession: {
      async collectAuthFormProbe() {
        return {
          pageUrl: "https://www.w3schools.com/",
          site: "www.w3schools.com",
          loginWallDetected: true,
          loginWallStrength: "medium",
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: false,
          passwordFieldDetected: false,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "credentials",
          inputFields: [],
          reason: "Auth-like controls are visible, but credential fields are not confirmed."
        };
      },
      async isAuthenticated() {
        return false;
      }
    },
    domain: "www.w3schools.com"
  });

  const updated = sessionStore.getSession(session.id);
  assert.equal(resumed, true);
  assert.equal(updated?.status, "running");
  assert.equal(updated?.authAssist?.state, "running");
  assert.equal(updated?.authAssist?.code, "AUTH_NOT_REQUIRED");
});

test("active login-assist loop consumes credential submission and resumes run", async () => {
  const originalPollMs = config.loginAssistPollMs;
  config.loginAssistPollMs = 1;

  try {
    const { orchestrator, sessionStore, session } = createOrchestratorHarness();
    let submitCalls = 0;
    let submitted = false;

    const browserSession = {
      async collectAuthFormProbe() {
        if (!submitted) {
          return {
            pageUrl: "https://example.com/login",
            site: "example.com",
            loginWallDetected: true,
            otpChallengeDetected: false,
            captchaDetected: false,
            usernameFieldDetected: true,
            identifierFieldDetected: true,
            passwordFieldDetected: true,
            otpFieldDetected: false,
            submitControlDetected: true,
            visibleStep: "credentials",
            reason: "Identifier and password fields are visible on the same step."
          };
        }
        return {
          pageUrl: "https://example.com/account",
          site: "example.com",
          loginWallDetected: false,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: false,
          identifierFieldDetected: false,
          passwordFieldDetected: false,
          otpFieldDetected: false,
          submitControlDetected: false,
          visibleStep: "authenticated",
          authenticatedHint: true,
          reason: "Authenticated markers are visible."
        };
      },
      async submitAuthCredentials() {
        submitCalls += 1;
        submitted = true;
        return {
          success: true,
          code: "CREDENTIALS_SUBMITTED",
          reason: "Credentials were entered and submission was triggered.",
          authenticated: false,
          submitTriggered: true,
          probe: {
            pageUrl: "https://example.com/account",
            site: "example.com",
            loginWallDetected: false,
            otpChallengeDetected: false,
            captchaDetected: false,
            usernameFieldDetected: false,
            identifierFieldDetected: false,
            passwordFieldDetected: false,
            otpFieldDetected: false,
            submitControlDetected: false,
            visibleStep: "authenticated",
            authenticatedHint: true,
            reason: "Authenticated markers are visible."
          }
        };
      },
      async confirmAuthenticatedSession() {
        if (!submitted) {
          return {
            state: "awaiting_credentials",
            code: "LOGIN_REQUIRED",
            reason: "Credentials are still required.",
            probe: {
              pageUrl: "https://example.com/login",
              site: "example.com",
              loginWallDetected: true,
              otpChallengeDetected: false,
              captchaDetected: false,
              usernameFieldDetected: true,
              identifierFieldDetected: true,
              passwordFieldDetected: true,
              otpFieldDetected: false,
              submitControlDetected: true,
              visibleStep: "credentials",
              reason: "Identifier and password fields are visible on the same step."
            }
          };
        }
        return {
          state: "authenticated",
          code: "AUTH_VALIDATED",
          reason: "Authentication signals are stable and login wall is no longer visible.",
          probe: {
            pageUrl: "https://example.com/account",
            site: "example.com",
            loginWallDetected: false,
            otpChallengeDetected: false,
            captchaDetected: false,
            usernameFieldDetected: false,
            identifierFieldDetected: false,
            passwordFieldDetected: false,
            otpFieldDetected: false,
            submitControlDetected: false,
            visibleStep: "authenticated",
            authenticatedHint: true,
            reason: "Authenticated markers are visible."
          }
        };
      },
      async isAuthenticated() {
        return submitted;
      },
      async persistStorageState() {
        return true;
      }
    };

    orchestrator.activeBrowserSessions.set(session.id, browserSession);
    const waitPromise = orchestrator.handleLoginAssist({
      sessionId: session.id,
      browserSession,
      domain: "example.com"
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const submitResult = await orchestrator.submitSessionCredentials(session.id, {
      username: "access-key-123",
      password: "correct-password"
    });

    const resumed = await waitPromise;
    const finalSession = sessionStore.getSession(session.id);

    assert.equal(submitResult.ok, true);
    assert.equal(submitResult.code, "AUTH_VALIDATED");
    assert.equal(resumed, true);
    assert.equal(submitCalls, 1);
    assert.equal(finalSession?.status, "running");
    assert.equal(finalSession?.authAssist?.state, "resumed");
    assert.equal(finalSession?.authAssist?.resumeTriggered, true);
    assert.equal(JSON.stringify(finalSession).includes("correct-password"), false);
    assert.equal(JSON.stringify(finalSession).includes("access-key-123"), false);
  } finally {
    config.loginAssistPollMs = originalPollMs;
  }
});

test("resumeSession writes a manual resume signal that loops can consume", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    status: "login-assist",
    authAssist: {
      state: "awaiting_password",
      code: "AUTH_STEP_ADVANCED",
      reason: "Password step is visible.",
      site: "example.com",
      pageUrl: "https://example.com/login/password",
      loginRequired: true,
      source: "api",
      form: {
        usernameFieldDetected: false,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true
      }
    }
  });

  const updated = await orchestrator.resumeSession(session.id);
  assert.equal(updated?.authAssist?.source, "manual");
  assert.equal(Boolean(updated?.authAssist?.resumeRequestedAt), true);
});

test("handleLoginAssist exits cleanly when credentials are skipped", async () => {
  const originalPollMs = config.loginAssistPollMs;
  config.loginAssistPollMs = 1;

  try {
    const { orchestrator, sessionStore, session } = createOrchestratorHarness();
    const browserSession = {
      async collectAuthFormProbe() {
        return {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: true,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "credentials",
          reason: "Identifier and password fields are visible on the same step."
        };
      },
      async confirmAuthenticatedSession() {
        return {
          state: "awaiting_credentials",
          code: "LOGIN_REQUIRED",
          reason: "Credentials are still required.",
          probe: {
            pageUrl: "https://example.com/login",
            site: "example.com",
            loginWallDetected: true,
            otpChallengeDetected: false,
            captchaDetected: false,
            usernameFieldDetected: true,
            identifierFieldDetected: true,
            passwordFieldDetected: true,
            otpFieldDetected: false,
            submitControlDetected: true,
            visibleStep: "credentials",
            reason: "Identifier and password fields are visible on the same step."
          }
        };
      },
      async isAuthenticated() {
        return false;
      }
    };

    orchestrator.activeBrowserSessions.set(session.id, browserSession);
    const waitPromise = orchestrator.handleLoginAssist({
      sessionId: session.id,
      browserSession,
      domain: "example.com"
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const skipResult = await orchestrator.skipSessionAuth(session.id, {
      reason: "Credential submission was skipped by user."
    });
    const resumed = await waitPromise;
    const updated = sessionStore.getSession(session.id);

    assert.equal(skipResult.ok, true);
    assert.equal(skipResult.code, "LOGIN_SKIPPED");
    assert.equal(resumed, false);
    assert.equal(updated?.status, "running");
    assert.equal(updated?.authAssist?.code, "LOGIN_SKIPPED");
  } finally {
    config.loginAssistPollMs = originalPollMs;
  }
});

test("handleLoginAssist does not auto-resume after skip even when browser reports authenticated", async () => {
  const originalPollMs = config.loginAssistPollMs;
  config.loginAssistPollMs = 1;

  try {
    const { orchestrator, sessionStore, session } = createOrchestratorHarness();
    const browserSession = {
      async collectAuthFormProbe() {
        return {
          pageUrl: "https://example.com/login",
          site: "example.com",
          loginWallDetected: true,
          otpChallengeDetected: false,
          captchaDetected: false,
          usernameFieldDetected: true,
          identifierFieldDetected: true,
          passwordFieldDetected: true,
          otpFieldDetected: false,
          submitControlDetected: true,
          visibleStep: "credentials",
          reason: "Identifier and password fields are visible on the same step."
        };
      },
      async confirmAuthenticatedSession() {
        return {
          state: "authenticated",
          code: "AUTH_VALIDATED",
          reason: "Authenticated markers detected.",
          probe: {
            pageUrl: "https://example.com/account",
            site: "example.com",
            loginWallDetected: false,
            otpChallengeDetected: false,
            captchaDetected: false,
            usernameFieldDetected: false,
            identifierFieldDetected: false,
            passwordFieldDetected: false,
            otpFieldDetected: false,
            submitControlDetected: false,
            visibleStep: "authenticated",
            reason: "Authenticated markers are visible."
          }
        };
      },
      async isAuthenticated() {
        return true;
      }
    };

    orchestrator.activeBrowserSessions.set(session.id, browserSession);
    const waitPromise = orchestrator.handleLoginAssist({
      sessionId: session.id,
      browserSession,
      domain: "example.com"
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const skipResult = await orchestrator.skipSessionAuth(session.id, {
      reason: "Credential submission was skipped by user."
    });
    const resumed = await waitPromise;
    const updated = sessionStore.getSession(session.id);

    assert.equal(skipResult.ok, true);
    assert.equal(skipResult.code, "LOGIN_SKIPPED");
    assert.equal(resumed, false);
    assert.equal(updated?.authAssist?.code, "LOGIN_SKIPPED");
    assert.equal(updated?.authAssist?.state, "auth_failed");
  } finally {
    config.loginAssistPollMs = originalPollMs;
  }
});

test("report exposes only safe auth assist metadata", () => {
  const { sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    authAssist: {
      state: "auth_failed",
      code: "INVALID_CREDENTIALS",
      reason: "Login form still visible.",
      site: "example.com",
      pageUrl: "https://example.com/login",
      loginRequired: true,
      profileTag: "functional-local",
      username: "leak-user@example.com",
      password: "leak-password",
      otp: "654321",
      form: {
        usernameFieldDetected: true,
        passwordFieldDetected: true,
        otpFieldDetected: false,
        submitControlDetected: true
      }
    }
  });

  const report = buildRunReport(sessionStore.getSession(session.id));
  assert.equal(report.authAssist?.state, "auth_failed");
  assert.equal(report.authAssist?.code, "INVALID_CREDENTIALS");
  assert.equal(report.authAssist?.site, "example.com");
  assert.equal("username" in (report.authAssist ?? {}), false);
  assert.equal("password" in (report.authAssist ?? {}), false);
  assert.equal("otp" in (report.authAssist ?? {}), false);
});

test("uiux login assist triggers from snapshot credential form when probe is unavailable", async () => {
  const { orchestrator, session } = createOrchestratorHarness();
  let loginAssistCalled = false;
  const originalHandleLoginAssist = orchestrator.handleLoginAssist.bind(orchestrator);
  orchestrator.handleLoginAssist = async (args) => {
    loginAssistCalled = true;
    assert.equal(args.sessionId, session.id);
    assert.equal(args.resumeCheckpoint?.mode, "uiux");
    return false;
  };

  try {
    const result = await orchestrator.maybeHandleUiuxLoginAssist({
      sessionId: session.id,
      browserSession: {
        async collectAuthFormProbe() {
          throw new Error("probe unavailable");
        },
        getCurrentUrl() {
          return "https://example.com/login";
        }
      },
      currentUrl: "https://example.com/login",
      snapshot: {
        formControls: [
          {
            tag: "input",
            type: "",
            placeholder: "Enter your access key",
            inViewport: true
          },
          {
            tag: "input",
            type: "password",
            placeholder: "Enter password",
            inViewport: true
          }
        ],
        interactive: [
          {
            elementId: "el-3",
            tag: "button",
            text: "Sign In",
            inViewport: true,
            disabled: false
          }
        ]
      },
      step: 1,
      depth: 0
    });

    assert.equal(loginAssistCalled, true);
    assert.equal(result.handled, true);
    assert.equal(result.resumed, false);
  } finally {
    orchestrator.handleLoginAssist = originalHandleLoginAssist;
  }
});

test("uiux login assist ignores weak auth-intent pages without credential field evidence", async () => {
  const { orchestrator, session } = createOrchestratorHarness();
  let loginAssistCalled = false;
  const originalHandleLoginAssist = orchestrator.handleLoginAssist.bind(orchestrator);
  orchestrator.handleLoginAssist = async () => {
    loginAssistCalled = true;
    return false;
  };

  try {
    const result = await orchestrator.maybeHandleUiuxLoginAssist({
      sessionId: session.id,
      browserSession: {
        async collectAuthFormProbe() {
          return {
            pageUrl: "https://www.w3schools.com/",
            site: "www.w3schools.com",
            loginWallDetected: true,
            loginWallStrength: "medium",
            usernameFieldDetected: false,
            identifierFieldDetected: false,
            passwordFieldDetected: false,
            otpFieldDetected: false,
            otpChallengeDetected: false,
            captchaDetected: false,
            submitControlDetected: true,
            visibleStep: "credentials",
            reason: "Auth-like controls are visible, but credential fields are not confirmed."
          };
        },
        getCurrentUrl() {
          return "https://www.w3schools.com/";
        }
      },
      currentUrl: "https://www.w3schools.com/",
      snapshot: {
        formControls: [],
        interactive: [
          {
            elementId: "nav-signin",
            tag: "button",
            text: "Sign In",
            inViewport: true,
            disabled: false
          }
        ]
      },
      step: 1,
      depth: 0
    });

    assert.equal(loginAssistCalled, false);
    assert.equal(result.handled, false);
    assert.equal(result.resumed, false);
  } finally {
    orchestrator.handleLoginAssist = originalHandleLoginAssist;
  }
});

test("uiux login assist does not trigger from snapshot fallback without identifier evidence", async () => {
  const { orchestrator, session } = createOrchestratorHarness();
  let loginAssistCalled = false;
  const originalHandleLoginAssist = orchestrator.handleLoginAssist.bind(orchestrator);
  orchestrator.handleLoginAssist = async () => {
    loginAssistCalled = true;
    return false;
  };

  try {
    const result = await orchestrator.maybeHandleUiuxLoginAssist({
      sessionId: session.id,
      browserSession: {
        async collectAuthFormProbe() {
          return {
            pageUrl: "https://www.w3schools.com/",
            site: "www.w3schools.com",
            loginWallDetected: false,
            loginWallStrength: "none",
            usernameFieldDetected: false,
            identifierFieldDetected: false,
            passwordFieldDetected: false,
            otpFieldDetected: false,
            otpChallengeDetected: false,
            captchaDetected: false,
            submitControlDetected: true,
            visibleStep: "unknown",
            reason: "No strong authentication wall detected."
          };
        },
        getCurrentUrl() {
          return "https://www.w3schools.com/";
        }
      },
      currentUrl: "https://www.w3schools.com/",
      snapshot: {
        formControls: [
          {
            tag: "input",
            type: "search",
            placeholder: "Search our tutorials, e.g. HTML",
            inViewport: true
          },
          {
            tag: "input",
            type: "password",
            placeholder: "Password",
            inViewport: true
          }
        ],
        interactive: [
          {
            elementId: "nav-signin",
            tag: "button",
            text: "Sign In",
            inViewport: true,
            disabled: false
          }
        ]
      },
      step: 1,
      depth: 0
    });

    assert.equal(loginAssistCalled, false);
    assert.equal(result.handled, false);
    assert.equal(result.resumed, false);
  } finally {
    orchestrator.handleLoginAssist = originalHandleLoginAssist;
  }
});

test("uiux login assist timeout enables continue-without-auth mode", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  const originalHandleLoginAssist = orchestrator.handleLoginAssist.bind(orchestrator);
  orchestrator.handleLoginAssist = async () => {
    sessionStore.patchSession(session.id, {
      authAssist: {
        state: "auth_failed",
        code: "LOGIN_ASSIST_TIMEOUT",
        reason: "Authentication assist timed out before login was completed."
      }
    });
    return false;
  };

  try {
    const result = await orchestrator.maybeHandleUiuxLoginAssist({
      sessionId: session.id,
      browserSession: {
        async collectAuthFormProbe() {
          return {
            pageUrl: "https://example.com/login",
            site: "example.com",
            loginWallDetected: true,
            usernameFieldDetected: true,
            identifierFieldDetected: true,
            passwordFieldDetected: true,
            otpFieldDetected: false,
            submitControlDetected: true,
            visibleStep: "credentials",
            reason: "Identifier and password fields are visible on the same step."
          };
        },
        getCurrentUrl() {
          return "https://example.com/login";
        }
      },
      currentUrl: "https://example.com/login",
      step: 1,
      depth: 0
    });

    assert.equal(result.handled, true);
    assert.equal(result.resumed, false);
    const updated = sessionStore.getSession(session.id);
    assert.equal(updated?.uiux?.continueWithoutAuth, true);
  } finally {
    orchestrator.handleLoginAssist = originalHandleLoginAssist;
  }
});

test("uiux continue-without-auth mode bypasses blocking login-assist waits", async () => {
  const { orchestrator, sessionStore, session } = createOrchestratorHarness();
  sessionStore.patchSession(session.id, {
    uiux: {
      ...(sessionStore.getSession(session.id)?.uiux ?? {}),
      continueWithoutAuth: true
    }
  });
  let loginAssistCalled = false;
  const originalHandleLoginAssist = orchestrator.handleLoginAssist.bind(orchestrator);
  orchestrator.handleLoginAssist = async () => {
    loginAssistCalled = true;
    return false;
  };

  try {
    const result = await orchestrator.maybeHandleUiuxLoginAssist({
      sessionId: session.id,
      browserSession: {
        async collectAuthFormProbe() {
          return {
            pageUrl: "https://example.com/login",
            site: "example.com",
            loginWallDetected: true,
            usernameFieldDetected: true,
            identifierFieldDetected: true,
            passwordFieldDetected: true,
            otpFieldDetected: false,
            submitControlDetected: true,
            visibleStep: "credentials",
            reason: "Identifier and password fields are visible on the same step."
          };
        },
        getCurrentUrl() {
          return "https://example.com/login";
        }
      },
      currentUrl: "https://example.com/login",
      step: 2,
      depth: 0
    });

    assert.equal(loginAssistCalled, false);
    assert.equal(result.handled, true);
    assert.equal(result.resumed, false);
  } finally {
    orchestrator.handleLoginAssist = originalHandleLoginAssist;
  }
});

test("session store derives safe auth debug payload when explicit debug is omitted", () => {
  const sessionStore = new SessionStore();
  const session = sessionStore.createSession({
    goal: "auth debug payload smoke",
    startUrl: "https://example.com/login",
    runConfig: createRunConfig(),
    providerMode: "heuristic",
    goalFamily: "functional",
    summary: "Queued."
  });

  sessionStore.patchSession(session.id, {
    status: "login-assist",
    authAssist: {
      state: "awaiting_credentials",
      code: "LOGIN_REQUIRED",
      pageUrl: "https://example.com/login",
      form: {
        identifierFieldDetected: true,
        passwordFieldDetected: true,
        submitControlDetected: true,
        visibleStep: "credentials"
      },
      runtime: {
        identifierFilled: true,
        passwordFilled: true,
        submitTriggered: true,
        submitControlType: "control-click",
        postSubmitUrl: "https://example.com/login",
        postSubmitProbeState: "credentials"
      }
    }
  });

  const stored = sessionStore.getSession(session.id);
  assert.equal(stored.authAssist?.debug?.authPanelEligible, true);
  assert.equal(stored.authAssist?.debug?.credentialsPending, true);
  assert.equal(stored.authAssist?.debug?.otpPending, false);
  assert.equal(stored.authAssist?.debug?.identifierFilled, true);
  assert.equal(stored.authAssist?.debug?.passwordFilled, true);
  assert.equal(stored.authAssist?.debug?.submitTriggered, true);
  assert.equal(stored.authAssist?.debug?.submitControlType, "control-click");
  assert.equal(stored.authAssist?.debug?.postSubmitProbeState, "credentials");
});
