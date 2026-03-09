import express from "express";
import { config } from "../lib/config.js";
import { parseRunConfig, RunConfigValidationError } from "../library/schemas/runConfig.js";
import { SafetyPolicy } from "../library/policies/safetyPolicy.js";
import { buildFullDeviceMatrix, QUICK_DEVICE_PROFILES } from "../types/uiux/deviceMatrix.js";

export function createSessionRouter(orchestrator, sessionStore, documentarianProvider) {
  const router = express.Router();
  const safetyPolicy = new SafetyPolicy();

  function resolveFirstCredentialAlias(payload = {}) {
    const aliases = [
      payload?.identifier,
      payload?.accessKey,
      payload?.access_key,
      payload?.username,
      payload?.email,
      payload?.loginId,
      payload?.login_id,
      payload?.accountId,
      payload?.account_id,
      payload?.userId,
      payload?.user_id
    ];

    for (const alias of aliases) {
      const normalized = String(alias ?? "").trim();
      if (normalized) {
        return normalized;
      }
    }
    return "";
  }

  function sendAuthError(res, status, code, message, extras = {}) {
    res.status(status).json({
      ok: false,
      sessionId: extras.sessionId ?? null,
      authAssist: extras.authAssist ?? null,
      code,
      message,
      error: {
        code,
        message
      }
    });
  }

  function sendAuthSuccess(res, sessionId, code, message, authAssist) {
    res.json({
      ok: true,
      sessionId,
      code,
      message,
      authAssist: authAssist ?? null
    });
  }

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      targetAppUrl: config.targetAppUrl
    });
  });

  router.get("/sessions", (_req, res) => {
    res.json(sessionStore.listSessions());
  });

  router.get("/sessions/:sessionId", (req, res) => {
    const session = sessionStore.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session);
  });

  router.get("/uiux/devices", (req, res) => {
    const mode = req.query.mode === "full" ? "full" : "quick";
    const listRequested = req.query.list === "1";
    const maxParam = Number(req.query.max);
    const maxList = Number.isFinite(maxParam) ? Math.max(1, Math.min(Math.floor(maxParam), 3000)) : 3000;

    if (mode === "quick") {
      const quick = QUICK_DEVICE_PROFILES.map((profile) => ({
        id: profile.id,
        label: profile.label,
        width: profile.width,
        height: profile.height,
        dpr: profile.dpr,
        deviceClass: profile.deviceClass
      }));
      res.json({
        mode,
        count: quick.length,
        sample: quick.slice(0, 25),
        devices: listRequested ? quick : undefined
      });
      return;
    }

    const fullMatrix = buildFullDeviceMatrix({ includeUserAgents: false });
    const sample = fullMatrix.slice(0, 25).map((profile) => ({
      id: profile.id,
      label: profile.label,
      width: profile.width,
      height: profile.height,
      dpr: profile.dpr,
      deviceClass: profile.deviceClass
    }));
    const boundedList = listRequested
      ? fullMatrix.slice(0, maxList).map((profile) => ({
          id: profile.id,
          label: profile.label,
          width: profile.width,
          height: profile.height,
          dpr: profile.dpr,
          deviceClass: profile.deviceClass
        }))
      : undefined;

    res.json({
      mode,
      count: fullMatrix.length,
      sample,
      devices: boundedList,
      truncated: listRequested ? fullMatrix.length > maxList : false
    });
  });

  router.post("/sessions/start", async (req, res) => {
    try {
      const runConfig = parseRunConfig(req.body, {
        defaultStartUrl: config.targetAppUrl
      });
      const navigationDecision = safetyPolicy.evaluateNavigation(runConfig.startUrl, runConfig);

      if (!navigationDecision.allowed) {
        res.status(400).json({ error: navigationDecision.reason });
        return;
      }

      const session = await orchestrator.start({
        runConfig
      });

      res.status(202).json(session);
    } catch (error) {
      if (error instanceof RunConfigValidationError) {
        const issues = Array.isArray(error.issues) ? error.issues : [];
        // Keep logs deterministic and actionable without dumping request payloads.
        console.warn("[VALIDATION_ERROR] /api/sessions/start", issues);
        res.status(400).json({
          error: "VALIDATION_ERROR",
          message: error.message,
          issues
        });
        return;
      }

      res.status(400).json({
        error: error.message
      });
    }
  });

  router.post("/sessions/:sessionId/resume", async (req, res) => {
    const session = await orchestrator.resumeSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session);
  });

  router.post("/sessions/:sessionId/stop", async (req, res) => {
    const result = await orchestrator.stopSession(req.params.sessionId, {
      reason: "Run stop requested by user."
    });

    if (!result?.ok && result?.code === "SESSION_NOT_FOUND") {
      res.status(404).json({
        ok: false,
        error: {
          code: result.code,
          message: result.message
        }
      });
      return;
    }

    if (!result?.ok && result?.code === "SESSION_NOT_ACTIVE") {
      res.status(409).json({
        ok: false,
        sessionId: req.params.sessionId,
        session: result.session ?? null,
        error: {
          code: result.code,
          message: result.message
        }
      });
      return;
    }

    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result?.code ?? "SESSION_STOP_REQUESTED",
      message: result?.message ?? "Run stop requested.",
      status: result?.session?.status ?? null,
      session: result?.session ?? null
    });
  });

  async function handleCredentialSubmission(req, res) {
    const identifier = resolveFirstCredentialAlias(req.body);
    const password = String(req.body?.password ?? "");

    if (!identifier || !password) {
      sendAuthError(
        res,
        400,
        "VALIDATION_ERROR",
        "Both first credential (identifier/username/email) and password are required.",
        {
        sessionId: req.params.sessionId
        }
      );
      return;
    }

    const result = await orchestrator.submitSessionCredentials(req.params.sessionId, {
      identifier,
      username: identifier,
      email: identifier,
      password
    });

    if (!result?.ok && result?.code === "SESSION_NOT_FOUND") {
      sendAuthError(res, 404, result.code, result.message, {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    if (!result?.ok && result?.code === "SESSION_NOT_ACTIVE") {
      sendAuthError(res, 409, result.code, result.message, {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    if (!result?.ok && result?.code === "AUTH_STATE_INVALID") {
      sendAuthError(res, 409, result.code, result.message, {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    if (!result?.ok) {
      sendAuthError(res, 400, result?.code ?? "AUTH_ASSIST_ERROR", result?.message ?? "Credential submission failed.", {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    sendAuthSuccess(
      res,
      req.params.sessionId,
      result?.code ?? "AUTH_ASSIST_UPDATE",
      result?.message ?? "Auth assist updated.",
      result?.authAssist ?? null
    );
  }

  async function handleOtpSubmission(req, res) {
    const otp = String(req.body?.otp ?? req.body?.code ?? "").trim();
    if (!otp) {
      sendAuthError(res, 400, "VALIDATION_ERROR", "OTP code is required.", {
        sessionId: req.params.sessionId
      });
      return;
    }

    const result = await orchestrator.submitSessionOtp(req.params.sessionId, {
      otp
    });

    if (!result?.ok && result?.code === "SESSION_NOT_FOUND") {
      sendAuthError(res, 404, result.code, result.message, {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    if (!result?.ok && result?.code === "SESSION_NOT_ACTIVE") {
      sendAuthError(res, 409, result.code, result.message, {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    if (!result?.ok && result?.code === "AUTH_STATE_INVALID") {
      sendAuthError(res, 409, result.code, result.message, {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    if (!result?.ok) {
      sendAuthError(res, 400, result?.code ?? "AUTH_ASSIST_ERROR", result?.message ?? "OTP submission failed.", {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    sendAuthSuccess(
      res,
      req.params.sessionId,
      result?.code ?? "AUTH_ASSIST_UPDATE",
      result?.message ?? "Auth assist updated.",
      result?.authAssist ?? null
    );
  }

  router.post("/sessions/:sessionId/auth/credentials", handleCredentialSubmission);
  router.post("/sessions/:sessionId/login-assist/credentials", handleCredentialSubmission);
  router.post("/sessions/:sessionId/auth/otp", handleOtpSubmission);
  router.post("/sessions/:sessionId/login-assist/otp", handleOtpSubmission);

  router.get("/sessions/:sessionId/report", (req, res) => {
    const session = sessionStore.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session.report ?? null);
  });

  router.get("/incidents/:sessionId/video", async (req, res) => {
    const session = sessionStore.getSession(req.params.sessionId);
    if (!session?.evidence) {
      res.status(404).json({ error: "Incident video not found" });
      return;
    }

    try {
      await documentarianProvider.streamEvidence(session.evidence, res);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  });

  return router;
}
