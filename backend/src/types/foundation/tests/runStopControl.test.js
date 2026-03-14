import test from "node:test";
import assert from "node:assert/strict";

import { QaOrchestrator } from "../../../orchestrator/qaOrchestrator.js";
import { parseRunConfig } from "../../../library/schemas/runConfig.js";
import { SessionStore } from "../../../services/sessionStore.js";
import { sleep } from "../../../lib/utils.js";

function createRunConfig() {
  return parseRunConfig(
    {
      goal: "Stop active run",
      startUrl: "https://example.com/store",
      testMode: "default"
    },
    {
      defaultStartUrl: "https://example.com/store"
    }
  );
}

function createOrchestrator() {
  const sessionStore = new SessionStore();
  const orchestrator = new QaOrchestrator({
    eventBus: {
      publish() {}
    },
    sessionStore,
    explorerProvider: {
      async plan() {
        return {
          thinking: "noop",
          action: {
            type: "wait",
            durationMs: 10
          }
        };
      }
    },
    auditorProvider: {
      async audit() {
        return {
          thought: "noop"
        };
      }
    },
    documentarianProvider: {
      async buildEvidence() {
        return null;
      }
    }
  });

  return {
    orchestrator,
    sessionStore
  };
}

test("stop request halts active execution and finalizes session as cancelled", async () => {
  const { orchestrator, sessionStore } = createOrchestrator();
  orchestrator.runSession = async function runUntilStopped(sessionId) {
    while (true) {
      await sleep(20);
      this.throwIfStopRequested(sessionId);
    }
  };

  const session = await orchestrator.start({
    runConfig: createRunConfig()
  });
  await sleep(40);

  const stopResult = await orchestrator.stopSession(session.id);
  assert.equal(stopResult.ok, true);
  assert.equal(stopResult.code, "SESSION_STOP_REQUESTED");
  assert.equal(sessionStore.getSession(session.id)?.status, "cancelling");

  let finalized = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = sessionStore.getSession(session.id);
    if (current?.status === "cancelled") {
      finalized = current;
      break;
    }
    await sleep(30);
  }

  assert.equal(finalized?.status, "cancelled");
  assert.equal(finalized?.primaryBlocker?.type, "USER_STOPPED");
  assert.equal(orchestrator.activeRuns.has(session.id), false);
});

test("cancelled run does not resume", async () => {
  const { orchestrator, sessionStore } = createOrchestrator();
  const session = sessionStore.createSession({
    goal: "Stopped run",
    startUrl: "https://example.com/store",
    runConfig: createRunConfig(),
    providerMode: "mock"
  });
  sessionStore.patchSession(session.id, {
    status: "cancelled",
    summary: "Run stop requested by user."
  });

  const resumed = await orchestrator.resumeSession(session.id);
  assert.equal(resumed?.status, "cancelled");
  assert.equal(resumed?.authAssist?.resumeRequestedAt ?? null, null);
});

test("stopAllActiveSessions targets active sessions and returns structured counts", async () => {
  const { orchestrator, sessionStore } = createOrchestrator();
  const runConfig = createRunConfig();
  const activeA = sessionStore.createSession({
    goal: "Run A",
    startUrl: "https://example.com/a",
    runConfig,
    providerMode: "mock"
  });
  const activeB = sessionStore.createSession({
    goal: "Run B",
    startUrl: "https://example.com/b",
    runConfig,
    providerMode: "mock"
  });
  const terminal = sessionStore.createSession({
    goal: "Run C",
    startUrl: "https://example.com/c",
    runConfig,
    providerMode: "mock"
  });

  sessionStore.patchSession(activeA.id, { status: "running" });
  sessionStore.patchSession(activeB.id, { status: "login-assist" });
  sessionStore.patchSession(terminal.id, { status: "passed" });

  const requested = [];
  orchestrator.stopSession = async (sessionId, { reason } = {}) => {
    requested.push(sessionId);
    return {
      ok: true,
      code: "SESSION_STOP_REQUESTED",
      message: reason ?? "Run stop requested by user.",
      session: {
        id: sessionId,
        status: "cancelling"
      }
    };
  };

  const result = await orchestrator.stopAllActiveSessions();

  assert.equal(result.ok, true);
  assert.equal(result.activeFound, 2);
  assert.equal(result.stoppedCount, 2);
  assert.deepEqual(result.requestedSessionIds, [activeB.id, activeA.id]);
  assert.deepEqual(requested, [activeB.id, activeA.id]);
  assert.deepEqual(result.failed, []);
});
