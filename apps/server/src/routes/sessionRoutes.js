import express from "express";
import { config } from "../lib/config.js";

export function createSessionRouter(orchestrator, sessionStore, documentarianProvider) {
  const router = express.Router();

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

  router.post("/sessions/start", async (req, res) => {
    const goal = req.body.goal?.trim();
    const startUrl = req.body.startUrl?.trim() || config.targetAppUrl;
    if (!goal) {
      res.status(400).json({ error: "goal is required" });
      return;
    }

    const session = await orchestrator.start({
      goal,
      startUrl,
      providerMode: req.body.providerMode ?? "auto",
      profileTag: req.body.profileTag ?? "",
      crawlerMode: req.body.crawlerMode ?? null
    });

    res.status(202).json(session);
  });

  router.post("/sessions/:sessionId/resume", async (req, res) => {
    const session = await orchestrator.resumeSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session);
  });

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
