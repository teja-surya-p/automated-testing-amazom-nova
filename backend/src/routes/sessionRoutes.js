import express from "express";
import { config } from "../lib/config.js";
import { createServerRuntimeInfo } from "../lib/runtimeInfo.js";
import { parseRunConfig, RunConfigValidationError } from "../library/schemas/runConfig.js";
import { SafetyPolicy } from "../library/policies/safetyPolicy.js";
import {
  normalizeSubmittedInputFieldValues,
  resolveFirstCredentialAlias
} from "../library/auth-fields/index.js";
import { buildFullDeviceMatrix, QUICK_DEVICE_PROFILES } from "../types/uiux/deviceMatrix.js";

export function createSessionRouter(orchestrator, sessionStore, documentarianProvider, options = {}) {
  const router = express.Router();
  const safetyPolicy = new SafetyPolicy();
  const runtimeInfo = options?.runtimeInfo ?? createServerRuntimeInfo();
  const ACTIVE_STOP_ALL_STATUSES = new Set([
    "queued",
    "running",
    "waiting-login",
    "login-assist",
    "form-assist",
    "verification-assist",
    "cancelling"
  ]);

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

  function buildRuntimePayload() {
    return {
      ok: true,
      service: runtimeInfo.service ?? "qa-server",
      version: runtimeInfo.version ?? "unknown",
      startedAt: runtimeInfo.startedAt ?? null,
      gitShortHash: runtimeInfo.gitShortHash ?? "unknown",
      capabilities:
        runtimeInfo.capabilities && typeof runtimeInfo.capabilities === "object"
          ? runtimeInfo.capabilities
          : {
              functionalityLoginAssist: true
            }
    };
  }

  router.get("/health", (_req, res) => {
    res.json({
      ...buildRuntimePayload(),
      targetAppUrl: config.targetAppUrl
    });
  });

  router.get("/version", (_req, res) => {
    res.json(buildRuntimePayload());
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

  function normalizeStopAllResponse(result = {}) {
    const activeCount = Number(result?.activeFound ?? result?.activeCount ?? 0);
    const requestedSessionIds = Array.isArray(result?.requestedSessionIds) ? result.requestedSessionIds : [];
    const failed = Array.isArray(result?.failed) ? result.failed : [];
    const stoppedCount = Number(result?.stoppedCount ?? Math.max(requestedSessionIds.length - failed.length, 0));

    return {
      ok: Boolean(result?.ok) && failed.length === 0,
      activeFound: activeCount,
      activeCount,
      stoppedCount,
      requestedSessionIds,
      failed
    };
  }

  async function fallbackStopAll({ reason }) {
    const sessions = Array.isArray(sessionStore.listSessions?.()) ? sessionStore.listSessions() : [];
    const active = sessions.filter((session) => ACTIVE_STOP_ALL_STATUSES.has(session?.status));
    const requestedSessionIds = [];
    const failed = [];

    for (const session of active) {
      if (!session?.id) {
        continue;
      }
      requestedSessionIds.push(session.id);
      try {
        const stopResult = await orchestrator.stopSession(session.id, { reason });
        if (!stopResult?.ok) {
          failed.push({
            sessionId: session.id,
            code: stopResult?.code ?? "STOP_REQUEST_FAILED",
            message: stopResult?.message ?? "Failed to request stop for session."
          });
        }
      } catch (error) {
        failed.push({
          sessionId: session.id,
          code: error?.code ?? "STOP_REQUEST_FAILED",
          message: error?.message ?? "Failed to request stop for session."
        });
      }
    }

    return {
      ok: failed.length === 0,
      activeFound: active.length,
      stoppedCount: Math.max(requestedSessionIds.length - failed.length, 0),
      requestedSessionIds,
      failed
    };
  }

  async function handleStopAll(_req, res) {
    const reason = "Run stop requested by user.";
    let result = null;

    if (typeof orchestrator.stopAllActiveSessions === "function") {
      try {
        result = await orchestrator.stopAllActiveSessions({ reason });
      } catch {
        result = null;
      }
    }

    if (!result) {
      result = await fallbackStopAll({ reason });
    }

    res.json(normalizeStopAllResponse(result));
  }

  router.post("/sessions/stop-all", handleStopAll);
  router.post("/sessions/stop-all-active", handleStopAll);
  router.post("/sessions/terminate-all", handleStopAll);
  router.post("/stop-all", handleStopAll);

  function normalizeAuthInputFieldsFromRequestBody(body = {}) {
    const directFields = normalizeSubmittedInputFieldValues(body?.inputFields ?? body?.fields ?? {});
    const identifierAlias = resolveFirstCredentialAlias(body);
    const password = String(body?.password ?? "");
    const otp = String(body?.otp ?? body?.code ?? "").trim();

    if (identifierAlias && !directFields.identifier) {
      directFields.identifier = identifierAlias;
    }
    if (password && !directFields.password) {
      directFields.password = password;
    }
    if (otp && !directFields.otp) {
      directFields.otp = otp;
    }

    return directFields;
  }

  async function handleInputFieldsSubmission(req, res) {
    const inputFields = normalizeAuthInputFieldsFromRequestBody(req.body ?? {});

    if (Object.keys(inputFields).length === 0) {
      sendAuthError(
        res,
        400,
        "VALIDATION_ERROR",
        "At least one input field value is required.",
        {
          sessionId: req.params.sessionId
        }
      );
      return;
    }

    const result =
      typeof orchestrator.submitSessionInputFields === "function"
        ? await orchestrator.submitSessionInputFields(req.params.sessionId, {
            inputFields
          })
        : await orchestrator.submitSessionCredentials(req.params.sessionId, {
            ...inputFields,
            inputFields,
            allowPartialInputFields: true,
            identifier: resolveFirstCredentialAlias(inputFields),
            username: resolveFirstCredentialAlias(inputFields),
            email: resolveFirstCredentialAlias(inputFields),
            password: String(inputFields?.password ?? "")
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
      sendAuthError(res, 400, result?.code ?? "AUTH_ASSIST_ERROR", result?.message ?? "Input-field submission failed.", {
        sessionId: req.params.sessionId,
        authAssist: result?.authAssist ?? null
      });
      return;
    }

    sendAuthSuccess(
      res,
      req.params.sessionId,
      result?.code ?? "INPUT_FIELDS_SUBMITTED",
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

  async function handleAuthSkip(req, res) {
    const reason = String(req.body?.reason ?? "").trim();
    const result = await orchestrator.skipSessionAuth(req.params.sessionId, {
      reason
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
      sendAuthError(
        res,
        400,
        result?.code ?? "AUTH_ASSIST_ERROR",
        result?.message ?? "Auth skip failed.",
        {
          sessionId: req.params.sessionId,
          authAssist: result?.authAssist ?? null
        }
      );
      return;
    }

    sendAuthSuccess(
      res,
      req.params.sessionId,
      result?.code ?? "LOGIN_SKIPPED",
      result?.message ?? "Authentication step skipped.",
      result?.authAssist ?? null
    );
  }

  router.post("/sessions/:sessionId/auth/input-fields", handleInputFieldsSubmission);
  router.post("/sessions/:sessionId/login-assist/input-fields", handleInputFieldsSubmission);
  router.post("/sessions/:sessionId/auth/credentials", handleInputFieldsSubmission);
  router.post("/sessions/:sessionId/login-assist/credentials", handleInputFieldsSubmission);
  router.post("/sessions/:sessionId/auth/otp", handleOtpSubmission);
  router.post("/sessions/:sessionId/login-assist/otp", handleOtpSubmission);
  router.post("/sessions/:sessionId/auth/skip", handleAuthSkip);
  router.post("/sessions/:sessionId/login-assist/skip", handleAuthSkip);
  router.post("/sessions/:sessionId/skip", handleAuthSkip);

  async function handleFormGroupSubmit(req, res) {
    const result = await orchestrator.submitSessionFormDecision(req.params.sessionId, req.params.groupId, {
      action: "submit",
      values: req.body?.values ?? {},
      description: req.body?.description ?? "",
      reason: req.body?.reason ?? ""
    });
    if (!result?.ok) {
      res.status(result?.code === "SESSION_NOT_FOUND" ? 404 : 409).json({
        ok: false,
        sessionId: req.params.sessionId,
        code: result?.code ?? "FORM_ASSIST_ERROR",
        message: result?.message ?? "Unable to submit form decision.",
        formAssist: result?.formAssist ?? null
      });
      return;
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result.code,
      message: result.message,
      formAssist: result.formAssist ?? null
    });
  }

  async function handleFormGroupSkip(req, res) {
    const result = await orchestrator.submitSessionFormDecision(req.params.sessionId, req.params.groupId, {
      action: "skip",
      reason: req.body?.reason ?? "Form skipped by user."
    });
    if (!result?.ok) {
      res.status(result?.code === "SESSION_NOT_FOUND" ? 404 : 409).json({
        ok: false,
        sessionId: req.params.sessionId,
        code: result?.code ?? "FORM_ASSIST_ERROR",
        message: result?.message ?? "Unable to skip form.",
        formAssist: result?.formAssist ?? null
      });
      return;
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result.code,
      message: result.message,
      formAssist: result.formAssist ?? null
    });
  }

  async function handleFormGroupAuto(req, res) {
    const result = await orchestrator.submitSessionFormDecision(req.params.sessionId, req.params.groupId, {
      action: "auto",
      description: req.body?.description ?? "",
      reason: req.body?.reason ?? ""
    });
    if (!result?.ok) {
      res.status(result?.code === "SESSION_NOT_FOUND" ? 404 : 409).json({
        ok: false,
        sessionId: req.params.sessionId,
        code: result?.code ?? "FORM_ASSIST_ERROR",
        message: result?.message ?? "Unable to auto submit form.",
        formAssist: result?.formAssist ?? null
      });
      return;
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result.code,
      message: result.message,
      formAssist: result.formAssist ?? null
    });
  }

  async function handleFormGroupDescription(req, res) {
    const result = await orchestrator.updateSessionFormGroupDescription(req.params.sessionId, req.params.groupId, {
      description: req.body?.description ?? ""
    });
    if (!result?.ok) {
      res.status(result?.code === "SESSION_NOT_FOUND" ? 404 : 409).json({
        ok: false,
        sessionId: req.params.sessionId,
        code: result?.code ?? "FORM_ASSIST_ERROR",
        message: result?.message ?? "Unable to update form group description.",
        formAssist: result?.formAssist ?? null
      });
      return;
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result.code,
      message: result.message,
      formAssist: result.formAssist ?? null
    });
  }

  async function handleFormDecisionAll(req, res) {
    const result = await orchestrator.submitSessionFormGlobalDecision(req.params.sessionId, {
      action: req.body?.action
    });
    if (!result?.ok) {
      res.status(result?.code === "SESSION_NOT_FOUND" ? 404 : 409).json({
        ok: false,
        sessionId: req.params.sessionId,
        code: result?.code ?? "FORM_ASSIST_ERROR",
        message: result?.message ?? "Unable to submit global form decision.",
        formAssist: result?.formAssist ?? null
      });
      return;
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result.code,
      message: result.message,
      formAssist: result.formAssist ?? null
    });
  }

  async function handleVerificationDecision(req, res) {
    const result = await orchestrator.submitSessionVerificationDecision(req.params.sessionId, req.params.promptId, {
      decision: req.body?.decision,
      note: req.body?.note ?? ""
    });
    if (!result?.ok) {
      res.status(result?.code === "SESSION_NOT_FOUND" ? 404 : 409).json({
        ok: false,
        sessionId: req.params.sessionId,
        code: result?.code ?? "VERIFICATION_ASSIST_ERROR",
        message: result?.message ?? "Unable to submit verification decision.",
        verificationAssist: result?.verificationAssist ?? null
      });
      return;
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result.code,
      message: result.message,
      verificationAssist: result.verificationAssist ?? null
    });
  }

  async function handleVerificationDecisionAll(req, res) {
    const result = await orchestrator.submitSessionVerificationDecisionAll(req.params.sessionId, {
      decision: req.body?.decision,
      note: req.body?.note ?? ""
    });
    if (!result?.ok) {
      res.status(result?.code === "SESSION_NOT_FOUND" ? 404 : 409).json({
        ok: false,
        sessionId: req.params.sessionId,
        code: result?.code ?? "VERIFICATION_ASSIST_ERROR",
        message: result?.message ?? "Unable to submit verification decision for all prompts.",
        verificationAssist: result?.verificationAssist ?? null
      });
      return;
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      code: result.code,
      message: result.message,
      verificationAssist: result.verificationAssist ?? null
    });
  }

  router.post("/sessions/:sessionId/forms/:groupId/submit", handleFormGroupSubmit);
  router.post("/sessions/:sessionId/forms/:groupId/skip", handleFormGroupSkip);
  router.post("/sessions/:sessionId/forms/:groupId/auto", handleFormGroupAuto);
  router.post("/sessions/:sessionId/forms/:groupId/description", handleFormGroupDescription);
  router.post("/sessions/:sessionId/forms/skip-all", (req, res) => {
    req.body = {
      ...(req.body ?? {}),
      action: "skip-all"
    };
    return handleFormDecisionAll(req, res);
  });
  router.post("/sessions/:sessionId/forms/auto-all", (req, res) => {
    req.body = {
      ...(req.body ?? {}),
      action: "auto-all"
    };
    return handleFormDecisionAll(req, res);
  });
  router.post("/sessions/:sessionId/verifications/:promptId/decision", handleVerificationDecision);
  router.post("/sessions/:sessionId/verifications/decision-all", handleVerificationDecisionAll);

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
