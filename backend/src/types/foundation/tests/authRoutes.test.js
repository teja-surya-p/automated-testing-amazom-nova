import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import cors from "cors";
import express from "express";
import { createSessionRouter } from "../../../routes/sessionRoutes.js";
import { createCorsOptions } from "../../../services/corsPolicy.js";

async function withTestServer({
  orchestratorOverrides = {},
  sessionLookup = null,
  sessionsList = []
} = {}, callback) {
  const app = express();
  const corsOptions = createCorsOptions({
    dashboardOrigins: ["http://localhost:3001"]
  });
  const orchestrator = {
    async start() {
      return null;
    },
    async resumeSession() {
      return null;
    },
    async submitSessionCredentials() {
      return {
        ok: true,
        code: "SUBMITTING_CREDENTIALS",
        message: "Credentials accepted for processing.",
        authAssist: {
          state: "submitting_credentials"
        }
      };
    },
    async submitSessionInputFields() {
      return {
        ok: true,
        code: "SUBMITTING_INPUT_FIELDS",
        message: "Input fields accepted for processing.",
        authAssist: {
          state: "submitting_input_fields"
        }
      };
    },
    async submitSessionOtp() {
      return {
        ok: true,
        code: "SUBMITTING_OTP",
        message: "OTP accepted for processing.",
        authAssist: {
          state: "submitting_otp"
        }
      };
    },
    async skipSessionAuth() {
      return {
        ok: true,
        code: "LOGIN_SKIPPED",
        message: "Authentication step skipped by user.",
        authAssist: {
          state: "auth_failed",
          code: "LOGIN_SKIPPED"
        }
      };
    },
    async submitSessionFormDecision() {
      return {
        ok: true,
        code: "FORM_DECISION_RECORDED",
        message: "Form decision recorded.",
        formAssist: {
          state: "awaiting_user",
          groups: [],
          decisions: {}
        }
      };
    },
    async submitSessionFormGlobalDecision() {
      return {
        ok: true,
        code: "FORM_GLOBAL_DECISION_RECORDED",
        message: "Form global decision recorded.",
        formAssist: {
          state: "awaiting_user",
          groups: [],
          decisions: {}
        }
      };
    },
    async updateSessionFormGroupDescription() {
      return {
        ok: true,
        code: "FORM_GROUP_DESCRIPTION_UPDATED",
        message: "Form group description updated.",
        formAssist: {
          state: "awaiting_user",
          groups: [],
          decisions: {}
        }
      };
    },
    async submitSessionVerificationDecision() {
      return {
        ok: true,
        code: "VERIFICATION_DECISION_RECORDED",
        message: "Verification decision recorded.",
        verificationAssist: {
          state: "awaiting_user",
          prompts: [],
          decisions: {}
        }
      };
    },
    async submitSessionVerificationDecisionAll() {
      return {
        ok: true,
        code: "VERIFICATION_DECISION_ALL_RECORDED",
        message: "Verification decisions recorded.",
        verificationAssist: {
          state: "awaiting_user",
          prompts: [],
          decisions: {}
        }
      };
    },
    async stopSession(sessionId) {
      return {
        ok: true,
        code: "SESSION_STOP_REQUESTED",
        message: "Run stop requested by user.",
        session: {
          id: sessionId,
          status: "cancelling"
        }
      };
    },
    async stopAllActiveSessions() {
      return {
        ok: true,
        activeFound: 0,
        stoppedCount: 0,
        requestedSessionIds: [],
        failed: []
      };
    },
    ...orchestratorOverrides
  };
  const sessionStore = {
    listSessions() {
      return Array.isArray(sessionsList) ? sessionsList : [];
    },
    getSession(sessionId) {
      if (typeof sessionLookup === "function") {
        return sessionLookup(sessionId);
      }
      return null;
    }
  };
  const documentarianProvider = {
    async streamEvidence() {
      return null;
    }
  };

  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createSessionRouter(orchestrator, sessionStore, documentarianProvider));
  app.use("/api", (_req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "API route not found."
      }
    });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test("input-fields endpoint exists and returns structured success JSON", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionInputFields(sessionId) {
          return {
            ok: true,
            code: "SUBMITTING_INPUT_FIELDS",
            message: "Input fields accepted for processing.",
            authAssist: {
              state: "submitting_input_fields",
              sessionId
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/qa_test/auth/input-fields`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          inputFields: {
            access_key: "tester@example.com",
            password: "super-secret"
          }
        })
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.sessionId, "qa_test");
      assert.equal(payload.authAssist?.state, "submitting_input_fields");
    }
  );
});

test("health endpoint exposes backend runtime version and functionality login-assist capability", async () => {
  await withTestServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: "http://localhost:3001"
      }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.service, "string");
    assert.equal(typeof payload.version, "string");
    assert.equal(typeof payload.gitShortHash, "string");
    assert.equal(typeof payload.startedAt, "string");
    assert.equal(typeof payload.targetAppUrl, "string");
    assert.equal(payload.capabilities?.functionalityLoginAssist, true);
  });
});

test("version endpoint is mounted and returns runtime metadata", async () => {
  await withTestServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/version`, {
      headers: {
        Origin: "http://localhost:3001"
      }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.service, "string");
    assert.equal(typeof payload.version, "string");
    assert.equal(typeof payload.gitShortHash, "string");
    assert.equal(typeof payload.startedAt, "string");
    assert.equal(payload.capabilities?.functionalityLoginAssist, true);
  });
});

test("legacy credentials endpoint alias remains compatible", async () => {
  let capturedPayload = null;
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionInputFields(_sessionId, payload) {
          capturedPayload = payload;
          return {
            ok: true,
            code: "SUBMITTING_INPUT_FIELDS",
            message: "Input fields accepted for processing.",
            authAssist: {
              state: "submitting_input_fields"
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/qa_test/auth/credentials`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          identifier: "access-key-123",
          password: "super-secret"
        })
      });

      assert.equal(response.status, 200);
      assert.equal(capturedPayload?.inputFields?.identifier, "access-key-123");
      assert.equal(capturedPayload?.inputFields?.password, "super-secret");
    }
  );
});

test("input-fields endpoint accepts multiple dynamic fields", async () => {
  let capturedPayload = null;
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionInputFields(_sessionId, payload) {
          capturedPayload = payload;
          return {
            ok: true,
            code: "SUBMITTING_INPUT_FIELDS",
            message: "Input fields accepted for processing.",
            authAssist: {
              state: "submitting_input_fields"
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/qa_test/auth/input-fields`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          inputFields: {
            organization_id: "org_123",
            access_key: "access-key-123",
            password: "super-secret"
          }
        })
      });

      assert.equal(response.status, 200);
      assert.equal(capturedPayload?.inputFields?.organization_id, "org_123");
      assert.equal(capturedPayload?.inputFields?.access_key, "access-key-123");
      assert.equal(capturedPayload?.inputFields?.password, "super-secret");
    }
  );
});

test("input-fields endpoint returns structured auth-state error JSON", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionInputFields() {
          return {
            ok: false,
            code: "AUTH_STATE_INVALID",
            message: "Session is not waiting for input fields.",
            authAssist: {
              state: "awaiting_otp"
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/qa_test/auth/input-fields`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          inputFields: {
            access_key: "tester@example.com",
            password: "super-secret"
          }
        })
      });

      assert.equal(response.status, 409);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.error?.code, "AUTH_STATE_INVALID");
      assert.equal(payload.error?.message, "Session is not waiting for input fields.");
      assert.equal(payload.authAssist?.state, "awaiting_otp");
    }
  );
});

test("skip-auth endpoint exists and returns structured success JSON", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async skipSessionAuth(sessionId) {
          return {
            ok: true,
            code: "LOGIN_SKIPPED",
            message: "Authentication step skipped by user.",
            authAssist: {
              state: "auth_failed",
              code: "LOGIN_SKIPPED",
              sessionId
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/qa_test/auth/skip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          reason: "Skip requested from dashboard"
        })
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.code, "LOGIN_SKIPPED");
      assert.equal(payload.sessionId, "qa_test");
      assert.equal(payload.authAssist?.code, "LOGIN_SKIPPED");
    }
  );
});

test("auth route preflight returns CORS headers for localhost:3001", async () => {
  await withTestServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sessions/qa_test/auth/credentials`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3001",
        "Access-Control-Request-Method": "POST"
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3001");
    assert.ok(String(response.headers.get("access-control-allow-methods") ?? "").includes("POST"));
  });
});

test("stop endpoint exists and returns structured JSON response", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async stopSession(sessionId) {
          return {
            ok: true,
            code: "SESSION_STOP_REQUESTED",
            message: "Run stop requested by user.",
            session: {
              id: sessionId,
              status: "cancelling"
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/qa_test/stop`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3001"
        }
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.sessionId, "qa_test");
      assert.equal(payload.status, "cancelling");
      assert.equal(payload.code, "SESSION_STOP_REQUESTED");
    }
  );
});

test("stop-all endpoint exists and returns structured JSON response", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async stopAllActiveSessions() {
          return {
            ok: true,
            activeFound: 4,
            stoppedCount: 4,
            requestedSessionIds: ["qa_a", "qa_b", "qa_c", "qa_d"],
            failed: []
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/stop-all`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3001"
        }
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.activeFound, 4);
      assert.equal(payload.activeCount, 4);
      assert.equal(payload.stoppedCount, 4);
      assert.deepEqual(payload.requestedSessionIds, ["qa_a", "qa_b", "qa_c", "qa_d"]);
      assert.deepEqual(payload.failed, []);
    }
  );
});

test("legacy stop-all route alias remains compatible", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async stopAllActiveSessions() {
          return {
            ok: true,
            activeFound: 2,
            stoppedCount: 2,
            requestedSessionIds: ["qa_a", "qa_b"],
            failed: []
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/stop-all-active`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3001"
        }
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.activeFound, 2);
      assert.equal(payload.activeCount, 2);
      assert.equal(payload.stoppedCount, 2);
      assert.deepEqual(payload.requestedSessionIds, ["qa_a", "qa_b"]);
      assert.deepEqual(payload.failed, []);
    }
  );
});

test("additional stop-all aliases remain compatible", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async stopAllActiveSessions() {
          return {
            ok: true,
            activeFound: 1,
            stoppedCount: 1,
            requestedSessionIds: ["qa_a"],
            failed: []
          };
        }
      }
    },
    async (baseUrl) => {
      for (const path of ["/api/sessions/terminate-all", "/api/stop-all"]) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            Origin: "http://localhost:3001"
          }
        });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.ok, true);
        assert.equal(payload.activeFound, 1);
        assert.equal(payload.activeCount, 1);
        assert.equal(payload.stoppedCount, 1);
        assert.deepEqual(payload.requestedSessionIds, ["qa_a"]);
        assert.deepEqual(payload.failed, []);
      }
    }
  );
});

test("stop-all fallback targets only active sessions", async () => {
  const requestedIds = [];
  await withTestServer(
    {
      sessionsList: [
        { id: "qa_running", status: "running" },
        { id: "qa_queued", status: "queued" },
        { id: "qa_login", status: "login-assist" },
        { id: "qa_form", status: "form-assist" },
        { id: "qa_done", status: "passed" },
        { id: "qa_fail", status: "failed" },
        { id: "qa_cancelled", status: "cancelled" }
      ],
      orchestratorOverrides: {
        stopAllActiveSessions: null,
        async stopSession(sessionId) {
          requestedIds.push(sessionId);
          return {
            ok: true,
            code: "SESSION_STOP_REQUESTED",
            message: "Run stop requested by user.",
            session: {
              id: sessionId,
              status: "cancelling"
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/stop-all`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3001"
        }
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.activeFound, 4);
      assert.equal(payload.activeCount, 4);
      assert.equal(payload.stoppedCount, 4);
      assert.deepEqual(payload.requestedSessionIds, ["qa_running", "qa_queued", "qa_login", "qa_form"]);
      assert.deepEqual(payload.failed, []);
      assert.deepEqual(requestedIds, ["qa_running", "qa_queued", "qa_login", "qa_form"]);
    }
  );
});

test("form submit endpoint accepts values and description payload", async () => {
  let captured = null;
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionFormDecision(sessionId, groupId, payload) {
          captured = { sessionId, groupId, payload };
          return {
            ok: true,
            code: "FORM_DECISION_RECORDED",
            message: "Form decision recorded.",
            formAssist: {
              state: "awaiting_user",
              decisions: {
                [groupId]: {
                  action: payload.action
                }
              }
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/qa_test/forms/form_1/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          values: {
            email: "qa@example.com"
          },
          description: "Checkout form"
        })
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.code, "FORM_DECISION_RECORDED");
      assert.equal(body.formAssist?.decisions?.form_1?.action, "submit");
      assert.equal(captured?.sessionId, "qa_test");
      assert.equal(captured?.groupId, "form_1");
      assert.equal(captured?.payload?.action, "submit");
      assert.equal(captured?.payload?.values?.email, "qa@example.com");
      assert.equal(captured?.payload?.description, "Checkout form");
    }
  );
});

test("form global endpoints map to auto-all and skip-all actions", async () => {
  const capturedActions = [];
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionFormGlobalDecision(_sessionId, payload) {
          capturedActions.push(payload?.action ?? null);
          return {
            ok: true,
            code: "FORM_GLOBAL_DECISION_RECORDED",
            message: "Form global decision recorded.",
            formAssist: {
              state: "awaiting_user",
              globalAction: payload?.action ?? null
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const autoAll = await fetch(`${baseUrl}/api/sessions/qa_test/forms/auto-all`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3001"
        }
      });
      const skipAll = await fetch(`${baseUrl}/api/sessions/qa_test/forms/skip-all`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3001"
        }
      });

      assert.equal(autoAll.status, 200);
      assert.equal(skipAll.status, 200);
      assert.deepEqual(capturedActions, ["auto-all", "skip-all"]);
    }
  );
});

test("verification decision endpoints return structured payloads", async () => {
  let perPromptCall = null;
  let allDecisionCall = null;
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionVerificationDecision(sessionId, promptId, payload) {
          perPromptCall = { sessionId, promptId, payload };
          return {
            ok: true,
            code: "VERIFICATION_DECISION_RECORDED",
            message: "Verification decision recorded.",
            verificationAssist: {
              state: "awaiting_user",
              decisions: {
                [promptId]: {
                  decision: payload?.decision
                }
              }
            }
          };
        },
        async submitSessionVerificationDecisionAll(sessionId, payload) {
          allDecisionCall = { sessionId, payload };
          return {
            ok: true,
            code: "VERIFICATION_DECISION_ALL_RECORDED",
            message: "Verification decision applied to all prompts.",
            verificationAssist: {
              state: "awaiting_user",
              globalDecision: payload?.decision ?? null
            }
          };
        }
      }
    },
    async (baseUrl) => {
      const perPromptResponse = await fetch(`${baseUrl}/api/sessions/qa_test/verifications/prompt_1/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          decision: "override-pass"
        })
      });

      const allResponse = await fetch(`${baseUrl}/api/sessions/qa_test/verifications/decision-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3001"
        },
        body: JSON.stringify({
          decision: "accept-agent"
        })
      });

      assert.equal(perPromptResponse.status, 200);
      assert.equal(allResponse.status, 200);
      assert.equal(perPromptCall?.sessionId, "qa_test");
      assert.equal(perPromptCall?.promptId, "prompt_1");
      assert.equal(perPromptCall?.payload?.decision, "override-pass");
      assert.equal(allDecisionCall?.sessionId, "qa_test");
      assert.equal(allDecisionCall?.payload?.decision, "accept-agent");
    }
  );
});
