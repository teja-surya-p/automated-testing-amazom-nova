import { config } from "../lib/config.js";
import { nowIso, pickLast } from "../lib/utils.js";
import { BrowserSession } from "../services/browserSession.js";
import { RingBuffer } from "../services/ringBuffer.js";

export class QaOrchestrator {
  constructor({ eventBus, sessionStore, explorerProvider, auditorProvider, documentarianProvider }) {
    this.eventBus = eventBus;
    this.sessionStore = sessionStore;
    this.explorerProvider = explorerProvider;
    this.auditorProvider = auditorProvider;
    this.documentarianProvider = documentarianProvider;
    this.activeRuns = new Map();
  }

  async start({ goal, startUrl, providerMode = "auto" }) {
    const session = this.sessionStore.createSession({
      goal,
      startUrl,
      providerMode
    });

    this.emit("session.created", {
      sessionId: session.id,
      session
    });

    const run = this.runSession(session.id).catch((error) => {
      this.sessionStore.patchSession(session.id, {
        status: "failed",
        bug: {
          type: "orchestrator-error",
          severity: "P0",
          summary: error.message
        }
      });
      this.emit("session.failed", {
        sessionId: session.id,
        error: error.message
      });
    });

    this.activeRuns.set(session.id, run);
    return session;
  }

  async runSession(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    const browserSession = new BrowserSession(sessionId);
    const frameBuffer = new RingBuffer(config.screenshotLimit);
    const recentActions = [];
    let lastHash = "";
    let unchangedSteps = 0;
    let lastAction = null;

    await browserSession.launch();
    await browserSession.goto(session.startUrl);

    this.sessionStore.patchSession(sessionId, {
      status: "running"
    });

    for (let step = 1; step <= config.maxSteps; step += 1) {
      const snapshot = await browserSession.capture(step);
      frameBuffer.push(snapshot);

      unchangedSteps = snapshot.hash === lastHash ? unchangedSteps + 1 : 0;
      lastHash = snapshot.hash;

      const framePayload = {
        sessionId,
        step,
        url: snapshot.url,
        title: snapshot.title,
        frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
        spinnerVisible: snapshot.spinnerVisible,
        overlays: snapshot.overlays,
        elements: snapshot.interactive.slice(0, 18)
      };

      this.sessionStore.patchSession(sessionId, {
        currentStep: step,
        currentUrl: snapshot.url,
        frame: framePayload.frame
      });
      this.sessionStore.appendTimeline(sessionId, {
        type: "frame",
        message: `${snapshot.title} @ ${snapshot.url}`
      });
      this.emit("frame", framePayload);
      this.emit("audit.starting", {
        sessionId,
        step,
        phase: "before-action",
        status: "thinking",
        title: "Analyzing current view...",
        details: "Nova Auditor is reviewing the latest screenshot for blockers, loaders, and goal progress.",
        timestamp: nowIso()
      });

      const preAudit = await this.auditorProvider.audit({
        goal: session.goal,
        phase: "before-action",
        step,
        snapshot,
        recentActions,
        unchangedSteps,
        lastAction
      });

      this.sessionStore.patchSession(sessionId, {
        lastAudit: preAudit.thought,
        currentHighlight: preAudit.highlight ?? null
      });
      this.sessionStore.appendTimeline(sessionId, {
        type: "audit",
        message: preAudit.thought
      });
      this.emit("audit", {
        sessionId,
        step,
        phase: "before-action",
        timestamp: nowIso(),
        ...preAudit
      });

      if (preAudit.status === "success") {
        this.sessionStore.patchSession(sessionId, {
          status: "passed",
          success: {
            summary: preAudit.thought
          }
        });
        this.emit("session.passed", {
          sessionId,
          summary: preAudit.thought
        });
        await browserSession.close();
        return;
      }

      if (preAudit.status === "bug") {
        await this.finalizeBug(sessionId, browserSession, frameBuffer.values(), preAudit.bug);
        return;
      }

      const plan = await this.explorerProvider.plan({
        goal: session.goal,
        step,
        snapshot,
        recentActions: pickLast(recentActions, 3),
        auditorInstruction: preAudit.nextInstruction
      });

      this.sessionStore.patchSession(sessionId, {
        lastThought: plan.thinking
      });
      this.sessionStore.appendTimeline(sessionId, {
        type: "explorer",
        message: plan.thinking
      });
      this.emit("action.planned", {
        sessionId,
        step,
        thought: plan.thinking,
        action: plan.action
      });

      if (plan.action.type === "done" || plan.isDone) {
        this.sessionStore.patchSession(sessionId, {
          status: "passed",
          success: {
            summary: plan.thinking
          }
        });
        this.emit("session.passed", {
          sessionId,
          summary: plan.thinking
        });
        await browserSession.close();
        return;
      }

      if (plan.action.type === "bug") {
        await this.finalizeBug(
          sessionId,
          browserSession,
          frameBuffer.values(),
          plan.bug ?? {
            type: "explorer-bug",
            severity: "P1",
            summary: plan.thinking,
            evidencePrompt: plan.thinking
          }
        );
        return;
      }

      await browserSession.executeAction(plan.action, snapshot);
      lastAction = plan.action;
      recentActions.push({
        step,
        action: plan.action,
        thought: plan.thinking
      });
      this.sessionStore.patchSession(sessionId, {
        history: pickLast(recentActions, 12)
      });
      this.emit("action.executed", {
        sessionId,
        step,
        action: plan.action
      });
    }

    await this.finalizeBug(sessionId, browserSession, frameBuffer.values(), {
      type: "max-steps",
      severity: "P1",
      summary: `The explorer reached the max step limit of ${config.maxSteps} without completing the goal.`,
      evidencePrompt: "Show the last visible state before the test was terminated for exceeding the step budget."
    });
  }

  async finalizeBug(sessionId, browserSession, frames, bug) {
    const evidence = await this.documentarianProvider.buildEvidence({
      sessionId,
      frames,
      bug
    });

    this.sessionStore.patchSession(sessionId, {
      status: "failed",
      bug,
      evidence
    });
    this.sessionStore.appendTimeline(sessionId, {
      type: "bug",
      message: bug.summary
    });
    this.emit("bug", {
      sessionId,
      bug,
      evidence
    });
    this.emit("session.failed", {
      sessionId,
      summary: bug.summary
    });

    if (evidence?.status === "generating" && this.documentarianProvider.waitForEvidence) {
      this.documentarianProvider
        .waitForEvidence({
          sessionId,
          frames,
          bug,
          evidence
        })
        .then((resolvedEvidence) => {
          this.sessionStore.patchSession(sessionId, {
            evidence: resolvedEvidence
          });
          this.emit("bug.updated", {
            sessionId,
            bug,
            evidence: resolvedEvidence
          });
        })
        .catch((error) => {
          this.sessionStore.appendTimeline(sessionId, {
            type: "evidence",
            message: `Evidence generation failed: ${error.message}`
          });
          this.emit("bug.updated", {
            sessionId,
            bug,
            evidence: {
              ...evidence,
              status: "failed",
              summary: `${bug.summary} Evidence generation failed: ${error.message}`
            }
          });
        });
    }

    await browserSession.close();
  }

  emit(type, payload) {
    this.eventBus.publish(type, payload);
  }
}
