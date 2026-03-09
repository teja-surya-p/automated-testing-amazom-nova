import fs from "node:fs/promises";
import http from "node:http";
import cors from "cors";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./lib/config.js";
import { createAuditorProvider } from "./providers/auditorProvider.js";
import { createDocumentarianProvider } from "./providers/documentarianProvider.js";
import { createExplorerProvider } from "./providers/explorerProvider.js";
import { createSessionRouter } from "./routes/sessionRoutes.js";
import { QaOrchestrator } from "./orchestrator/qaOrchestrator.js";
import { EventBus } from "./services/eventBus.js";
import { SessionPersistence } from "./services/sessionPersistence.js";
import { SessionStore } from "./services/sessionStore.js";
import { createCorsOptions, resolveAllowedCorsOrigins } from "./services/corsPolicy.js";

await fs.mkdir(config.artifactsDir, { recursive: true });
await fs.mkdir(config.sessionsDir, { recursive: true });

const app = express();
const eventBus = new EventBus();
const sessionStore = new SessionStore({
  persistence: new SessionPersistence(config.sessionsDir)
});
const documentarianProvider = createDocumentarianProvider();
const orchestrator = new QaOrchestrator({
  eventBus,
  sessionStore,
  explorerProvider: createExplorerProvider(),
  auditorProvider: createAuditorProvider(),
  documentarianProvider
});
const corsOptions = createCorsOptions(config);
const allowedCorsOrigins = resolveAllowedCorsOrigins(config);
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin(origin, callback) {
      corsOptions.origin(origin, callback);
    },
    methods: ["GET", "POST", "OPTIONS"]
  }
});

function mapSocketEvent(type, payload) {
  if (type === "frame") {
    return {
      event: "ui-update",
      data: {
        sessionId: payload.sessionId,
        image: payload.frame,
        step: payload.step,
        title: payload.title,
        url: payload.url
      }
    };
  }

  if (type === "audit") {
    return {
      event: "ai-thought",
      data: {
        sessionId: payload.sessionId,
        step: payload.step,
        phase: payload.phase ?? "before-action",
        status: payload.status,
        title: payload.stepTitle ?? payload.title ?? payload.action,
        action: payload.action,
        details: payload.details ?? payload.reasoning,
        reasoning: payload.reasoning,
        blockers: payload.blockers ?? [],
        nextBestAction: payload.nextBestAction ?? null,
        targetAchieved: Boolean(payload.targetAchieved),
        evidenceQualityScore: payload.evidenceQualityScore ?? 0,
        targetText: payload.targetText ?? null,
        targetCoordinates: payload.targetCoordinates ?? null,
        confidence: payload.confidenceScore,
        confidenceScore: payload.confidenceScore,
        timestamp: payload.timestamp ?? new Date().toISOString(),
        highlight: payload.highlight ?? null,
        raw: payload.raw,
        bug: payload.bug ?? null
      }
    };
  }

  if (type === "audit.starting") {
    return {
      event: "ai-starting-move",
      data: {
        sessionId: payload.sessionId,
        step: payload.step,
        phase: payload.phase ?? "before-action",
        status: payload.status ?? "thinking",
        title: payload.title ?? "Analyzing current view...",
        details: payload.details ?? "Nova Auditor is processing the current screenshot.",
        timestamp: payload.timestamp ?? new Date().toISOString()
      }
    };
  }

  if (type === "action.planned") {
    const isTypeAction = payload.action?.type === "type";
    return {
      event: "ai-thought",
      data: {
        sessionId: payload.sessionId,
        step: payload.step,
        phase: "action-plan",
        status: "acting",
        title: payload.thought ?? "Executing next action",
        action: payload.action?.type ?? "act",
        details: isTypeAction
          ? "Keyboard-first submission is being used to avoid hidden button or overlay timeouts."
          : `Explorer is executing a ${payload.action?.type ?? "browser"} action based on the current plan.`,
        landmark: payload.landmark ?? null,
        targetText: payload.targetText ?? null,
        verification: payload.verification ?? null,
        confidence: isTypeAction ? 98 : 88,
        confidenceScore: isTypeAction ? 98 : 88,
        timestamp: new Date().toISOString(),
        highlight: null,
        raw: JSON.stringify(payload, null, 2),
        bug: null
      }
    };
  }

  if (type === "bug" || type === "bug.updated") {
    return {
      event: type === "bug" ? "bug-found" : "incident-updated",
      data: {
        sessionId: payload.sessionId,
        type: payload.bug?.type ?? "bug",
        severity: payload.bug?.severity ?? "P2",
        summary: payload.bug?.summary ?? "Incident detected",
        videoUrl: payload.evidence?.videoUrl ?? null,
        evidenceStatus: payload.evidence?.status ?? "ready",
        evidenceProvider: payload.evidence?.provider ?? "unknown",
        evidenceSummary: payload.evidence?.summary ?? ""
      }
    };
  }

  if (type === "session.created" || type === "session.passed" || type === "session.failed" || type === "session.cancelled") {
    return {
      event: type,
      data: payload
    };
  }

  if (type === "session.updated" || type === "session.soft-passed") {
    return {
      event: type,
      data: payload
    };
  }

  if (type === "testcase.stats") {
    return {
      event: "testcase:stats",
      data: payload
    };
  }

  if (type === "testcase.event") {
    return {
      event: "testcase:event",
      data: payload
    };
  }

  return null;
}

app.use(
  cors(corsOptions)
);
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "15mb" }));
app.use("/artifacts", express.static(config.artifactsDir));
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
app.use((error, req, res, next) => {
  if (!req.path.startsWith("/api/")) {
    next(error);
    return;
  }
  res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected API error."
    }
  });
});

eventBus.subscribe((type, payload) => {
  const mapped = mapSocketEvent(type, payload);
  if (mapped) {
    io.emit(mapped.event, mapped.data);
  }
});

io.on("connection", (socket) => {
  socket.emit("socket-status", {
    connected: true
  });
});

server.listen(config.port, () => {
  console.log(`QA orchestrator listening on http://localhost:${config.port}`);
  console.log(`CORS allowed origins: ${allowedCorsOrigins.join(", ")}`);
});
