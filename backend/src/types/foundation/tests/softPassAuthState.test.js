import test from "node:test";
import assert from "node:assert/strict";

import { EventBus } from "../../../services/eventBus.js";
import { QaOrchestrator } from "../../../orchestrator/qaOrchestrator.js";
import { SessionStore } from "../../../services/sessionStore.js";

function createRunConfig() {
  return {
    startUrl: "https://example.com/account",
    goal: "Functional authenticated smoke test",
    testMode: "functional",
    providerMode: "heuristic",
    profileTag: "functional-local",
    functional: {
      loginAssist: {
        enabled: true,
        timeoutMs: 30_000,
        resumeStrategy: "restart-flow"
      }
    }
  };
}

function createHarness() {
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

  return { orchestrator, sessionStore, session };
}

test("finalizeSoftPass preserves AUTH_VALIDATED state when auth was already confirmed", async () => {
  const { orchestrator, sessionStore, session } = createHarness();
  sessionStore.patchSession(session.id, {
    status: "running",
    authAssist: {
      state: "authenticated",
      code: "AUTH_VALIDATED",
      reason: "Authenticated session signals detected."
    }
  });

  orchestrator.attachDeferredEvidence = async () => {};
  await orchestrator.finalizeSoftPass(
    session.id,
    {
      async close() {
        return {};
      }
    },
    [],
    {
      blocker: {
        type: "RATE_LIMITED",
        confidence: 0.84,
        rationale: "The site appears to be rate limiting the session."
      },
      summary: "Run finished with blockers (soft-pass).",
      nextBestAction: "ABORT_SOFT_PASS",
      evidenceQualityScore: 0.82
    }
  );

  const updated = sessionStore.getSession(session.id);
  assert.equal(updated?.status, "soft-passed");
  assert.equal(updated?.authAssist?.state, "authenticated");
  assert.equal(updated?.authAssist?.code, "AUTH_VALIDATED");
});
