import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyTestCaseStats,
  TestCaseTracker
} from "../../../library/reporting/testCaseTracker.js";

function createSessionStoreFixture() {
  const session = {
    id: "qa_tracker",
    runConfig: {
      testMode: "uiux"
    },
    startUrl: "https://example.com/store",
    currentUrl: "https://example.com/store",
    testCaseStats: createEmptyTestCaseStats(),
    testCases: []
  };

  return {
    getSession(id) {
      return id === session.id ? session : null;
    },
    patchSession(id, patch) {
      if (id !== session.id) {
        return null;
      }
      Object.assign(session, patch);
      return session;
    },
    snapshot() {
      return session;
    }
  };
}

test("testCaseTracker tracks planned/discovered/completed counters deterministically", () => {
  const store = createSessionStoreFixture();
  const emitted = [];
  const tracker = new TestCaseTracker({
    sessionId: "qa_tracker",
    sessionStore: store,
    emit(type, payload) {
      emitted.push({ type, payload });
    }
  });

  tracker.planCases(4);
  tracker.discoverCases(2);
  const started = tracker.startCase({
    caseKind: "VIEWPORT_RENDER",
    pageUrl: "https://example.com/store",
    expected: "Viewport should render.",
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/frame-1.png" }]
  });
  tracker.completeCase(started.id, {
    status: "passed",
    actual: "Viewport rendered.",
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/frame-1.png" }]
  });

  const second = tracker.startCase({
    caseKind: "UI_CHECK",
    pageUrl: "https://example.com/store",
    expected: "No blocking overlay."
  });
  tracker.failCase(second.id, {
    severity: "P1",
    actual: "Blocking overlay found.",
    evidenceRefs: [{ type: "screenshot", ref: "/artifacts/frame-2.png" }]
  });

  const stats = tracker.snapshotStats();
  assert.equal(stats.planned, 4);
  assert.equal(stats.discovered, 2);
  assert.equal(stats.completed, 2);
  assert.equal(stats.passed, 1);
  assert.equal(stats.failed, 1);

  const snapshot = store.snapshot();
  assert.equal(snapshot.testCases.length, 2);
  assert.equal(snapshot.testCases[1].status, "failed");
  assert.equal(snapshot.testCases[1].severity, "P1");

  assert.equal(emitted.some((entry) => entry.type === "testcase.stats"), true);
  assert.equal(emitted.some((entry) => entry.type === "testcase.event"), true);
});

test("testCaseTracker keeps only bounded recent test cases", () => {
  const store = createSessionStoreFixture();
  const tracker = new TestCaseTracker({
    sessionId: "qa_tracker",
    sessionStore: store,
    maxCases: 3
  });

  for (let index = 0; index < 5; index += 1) {
    tracker.discoverCases(1);
    const started = tracker.startCase({
      caseKind: "STEP_SNAPSHOT",
      expected: `Case ${index}`
    });
    tracker.completeCase(started.id, {
      status: "passed",
      actual: `Done ${index}`
    });
  }

  const snapshot = store.snapshot();
  assert.equal(snapshot.testCases.length, 3);
  assert.equal(snapshot.testCases[0].expected, "Case 2");
  assert.equal(snapshot.testCases[2].expected, "Case 4");
});
