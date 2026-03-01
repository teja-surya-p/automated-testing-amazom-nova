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
import { SessionStore } from "./services/sessionStore.js";

await fs.mkdir(config.artifactsDir, { recursive: true });

const app = express();
const eventBus = new EventBus();
const sessionStore = new SessionStore();
const documentarianProvider = createDocumentarianProvider();
const orchestrator = new QaOrchestrator({
  eventBus,
  sessionStore,
  explorerProvider: createExplorerProvider(),
  auditorProvider: createAuditorProvider(),
  documentarianProvider
});
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: config.dashboardOrigin,
    methods: ["GET", "POST"]
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

  if (type === "session.created" || type === "session.passed" || type === "session.failed") {
    return {
      event: type,
      data: payload
    };
  }

  return null;
}

app.use(
  cors({
    origin: config.dashboardOrigin
  })
);
app.use(express.json({ limit: "15mb" }));
app.use("/artifacts", express.static(config.artifactsDir));
app.use("/api", createSessionRouter(orchestrator, sessionStore, documentarianProvider));

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
});
