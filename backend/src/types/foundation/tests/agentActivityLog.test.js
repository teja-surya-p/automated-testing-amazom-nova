import test from "node:test";
import assert from "node:assert/strict";

import { QaOrchestrator } from "../../../orchestrator/qaOrchestrator.js";
import { SessionStore } from "../../../services/sessionStore.js";

function createRunConfig() {
  return {
    goal: "Agent activity coverage",
    startUrl: "https://example.com",
    testMode: "default",
    budgets: {
      maxSteps: 3,
      timeBudgetMs: 30_000,
      stagnationLimit: 2,
      actionRetryCount: 1
    },
    readiness: {
      uiReadyStrategy: "networkidle-only",
      readyTimeoutMs: 5_000
    },
    exploration: {
      strategy: "goal-directed",
      depthLimit: 2
    },
    functional: {
      loginAssist: {
        enabled: true,
        timeoutMs: 30_000,
        resumeStrategy: "restart-flow"
      }
    }
  };
}

function createSession(store) {
  return store.createSession({
    goal: "Agent activity coverage",
    startUrl: "https://example.com",
    runConfig: createRunConfig(),
    providerMode: "heuristic"
  });
}

test("timeline entries are mirrored into safe agent activity events", () => {
  const store = new SessionStore();
  const session = createSession(store);

  store.appendTimeline(session.id, {
    type: "auth-assist",
    message: "Submit runtime password=super-secret submitTriggered=yes"
  });

  const updated = store.getSession(session.id);
  assert.equal(Array.isArray(updated.agentActivity), true);
  assert.equal(updated.agentActivity.length, 1);
  assert.equal(updated.agentActivity[0].phase, "auth");
  assert.match(updated.agentActivity[0].message, /\[REDACTED\]/);
  assert.equal(updated.agentActivity[0].message.includes("super-secret"), false);
});

test("agent activity history is bounded and redacts secret-like details", () => {
  const store = new SessionStore();
  const session = createSession(store);

  for (let index = 0; index < 340; index += 1) {
    store.appendAgentActivity(session.id, {
      phase: "auth",
      status: "doing",
      kind: "event",
      message: `auth-step-${index}`,
      details: {
        password: "should-not-leak",
        nested: {
          otp: "123456"
        }
      }
    });
  }

  const updated = store.getSession(session.id);
  assert.equal(updated.agentActivity.length, 300);
  const latest = updated.agentActivity[updated.agentActivity.length - 1];
  assert.equal(latest.details.password, "[REDACTED]");
  assert.equal(latest.details.nested.otp, "[REDACTED]");
});

test("session exposes safe current/next action summaries for live progress logs", () => {
  const store = new SessionStore();
  const session = createSession(store);

  store.appendAgentActivity(session.id, {
    phase: "auth",
    status: "planned",
    kind: "planner",
    message: "Submit sign-in form after field fill."
  });
  store.appendAgentActivity(session.id, {
    phase: "auth",
    status: "doing",
    kind: "input-fill",
    message: "Filling password=super-secret into detected input."
  });

  const updated = store.getSession(session.id);
  assert.equal(updated.currentAction?.status, "doing");
  assert.equal(updated.currentAction?.phase, "auth");
  assert.match(updated.currentAction?.message ?? "", /\[REDACTED\]/);
  assert.equal((updated.currentAction?.message ?? "").includes("super-secret"), false);
  assert.equal(updated.nextAction?.status, "planned");
  assert.equal(updated.nextAction?.message, "Submit sign-in form after field fill.");
});

test("patchSession preserves explicit current/next action updates for live progress", () => {
  const store = new SessionStore();
  const session = createSession(store);

  store.patchSession(session.id, {
    currentAction: {
      phase: "uiux",
      status: "doing",
      message: "Capturing coarse responsive sweep (3/36)."
    },
    nextAction: {
      phase: "uiux",
      status: "planned",
      message: "Refine around detected transitions."
    }
  });

  const updated = store.getSession(session.id);
  assert.equal(updated.currentAction?.phase, "uiux");
  assert.equal(updated.currentAction?.status, "doing");
  assert.equal(updated.currentAction?.message, "Capturing coarse responsive sweep (3/36).");
  assert.equal(updated.nextAction?.phase, "uiux");
  assert.equal(updated.nextAction?.status, "planned");
  assert.equal(updated.nextAction?.message, "Refine around detected transitions.");
});

test("orchestrator emits action events into session agent activity stream", () => {
  const published = [];
  const store = new SessionStore();
  const session = createSession(store);

  const orchestrator = new QaOrchestrator({
    eventBus: {
      publish(type, payload) {
        published.push({ type, payload });
      }
    },
    sessionStore: store,
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

  orchestrator.emit("action.planned", {
    sessionId: session.id,
    step: 4,
    thought: "Next safe action in current flow.",
    action: {
      type: "click",
      label: "Dashboard"
    }
  });

  const updated = store.getSession(session.id);
  const lastActivity = updated.agentActivity[updated.agentActivity.length - 1];
  assert.equal(lastActivity.phase, "flow-selection");
  assert.equal(lastActivity.status, "planned");
  assert.match(lastActivity.message, /About to click/i);

  const activityEvent = published.find((entry) => entry.type === "agent.activity");
  assert.equal(Boolean(activityEvent), true);
  assert.equal(activityEvent.payload.sessionId, session.id);
});

test("logout-related timeline entries are marked as blocked auth/safety activity", () => {
  const store = new SessionStore();
  const session = createSession(store);

  store.appendTimeline(session.id, {
    type: "functional-logout-guard",
    message: "Logout/sign-out action was blocked during authenticated exploration and deferred to final logout stage."
  });

  const updated = store.getSession(session.id);
  const lastActivity = updated.agentActivity[updated.agentActivity.length - 1];
  assert.equal(lastActivity.status, "blocked");
  assert.equal(["auth", "safety"].includes(lastActivity.phase), true);
});
