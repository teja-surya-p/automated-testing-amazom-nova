import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import cors from "cors";
import express from "express";
import { createSessionRouter } from "../../../routes/sessionRoutes.js";
import { createCorsOptions } from "../../../services/corsPolicy.js";

async function withTestServer({
  orchestratorOverrides = {},
  sessionLookup = null
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
    ...orchestratorOverrides
  };
  const sessionStore = {
    listSessions() {
      return [];
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

test("credentials endpoint exists and returns structured success JSON", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionCredentials(sessionId) {
          return {
            ok: true,
            code: "SUBMITTING_CREDENTIALS",
            message: "Credentials accepted for processing.",
            authAssist: {
              state: "submitting_credentials",
              sessionId
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
          username: "tester@example.com",
          password: "super-secret"
        })
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.sessionId, "qa_test");
      assert.equal(payload.authAssist?.state, "submitting_credentials");
    }
  );
});

test("credentials endpoint accepts identifier alias for username", async () => {
  let capturedPayload = null;
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionCredentials(_sessionId, payload) {
          capturedPayload = payload;
          return {
            ok: true,
            code: "SUBMITTING_CREDENTIALS",
            message: "Credentials accepted for processing.",
            authAssist: {
              state: "submitting_credentials"
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
      assert.equal(capturedPayload?.username, "access-key-123");
      assert.equal(capturedPayload?.identifier, "access-key-123");
      assert.equal(capturedPayload?.email, "access-key-123");
      assert.equal(capturedPayload?.password, "super-secret");
    }
  );
});

test("credentials endpoint accepts login/account/user/access-key aliases for first credential", async () => {
  let capturedPayload = null;
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionCredentials(_sessionId, payload) {
          capturedPayload = payload;
          return {
            ok: true,
            code: "SUBMITTING_CREDENTIALS",
            message: "Credentials accepted for processing.",
            authAssist: {
              state: "submitting_credentials"
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
          accessKey: "access-key-123",
          loginId: "ignored-login-id",
          accountId: "ignored-account-id",
          userId: "ignored-user-id",
          password: "super-secret"
        })
      });

      assert.equal(response.status, 200);
      assert.equal(capturedPayload?.identifier, "access-key-123");
      assert.equal(capturedPayload?.username, "access-key-123");
      assert.equal(capturedPayload?.email, "access-key-123");
      assert.equal(capturedPayload?.password, "super-secret");
    }
  );
});

test("credentials endpoint returns structured auth-state error JSON", async () => {
  await withTestServer(
    {
      orchestratorOverrides: {
        async submitSessionCredentials() {
          return {
            ok: false,
            code: "AUTH_STATE_INVALID",
            message: "Session is not waiting for credentials.",
            authAssist: {
              state: "awaiting_otp"
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
          username: "tester@example.com",
          password: "super-secret"
        })
      });

      assert.equal(response.status, 409);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.error?.code, "AUTH_STATE_INVALID");
      assert.equal(payload.error?.message, "Session is not waiting for credentials.");
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
