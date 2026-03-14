import test from "node:test";
import assert from "node:assert/strict";

import {
  activityStatusTone,
  deriveAgentActivitySummary,
  deriveProgressActionLogs,
  formatActivityElapsed,
  normalizeAgentActivityEntries,
  shouldHighlightLogoutActivity
} from "./agentActivity.js";

test("normalizeAgentActivityEntries keeps chronological order and removes empty items", () => {
  const result = normalizeAgentActivityEntries([
    {
      id: "2",
      ts: "2026-03-11T10:00:02.000Z",
      status: "done",
      phase: "auth",
      message: "Authentication validated."
    },
    null,
    {
      id: "1",
      ts: "2026-03-11T10:00:01.000Z",
      status: "planned",
      phase: "flow-selection",
      message: "About to click Dashboard."
    },
    {
      id: "3",
      status: "doing",
      message: ""
    }
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, "1");
  assert.equal(result[1].id, "2");
});

test("deriveAgentActivitySummary returns just did / doing now / next action", () => {
  const summary = deriveAgentActivitySummary([
    {
      id: "a",
      elapsedMs: 1000,
      status: "planned",
      phase: "flow-selection",
      message: "About to click Profile"
    },
    {
      id: "b",
      elapsedMs: 2000,
      status: "doing",
      phase: "auth",
      message: "Checking authenticated state"
    },
    {
      id: "c",
      elapsedMs: 3000,
      status: "done",
      phase: "navigation",
      message: "Navigation completed"
    }
  ]);

  assert.equal(summary.justDid?.id, "c");
  assert.equal(summary.doingNow?.id, "b");
  assert.equal(summary.nextAction?.id, "a");
});

test("logout activity helper highlights logout-like entries", () => {
  assert.equal(
    shouldHighlightLogoutActivity({
      message: "Blocked potential logout action.",
      phase: "safety",
      status: "blocked"
    }),
    true
  );
  assert.equal(
    shouldHighlightLogoutActivity({
      message: "About to click Dashboard.",
      phase: "navigation",
      status: "planned"
    }),
    false
  );
});

test("format helpers return stable labels", () => {
  assert.equal(formatActivityElapsed(65_000), "01:05");
  assert.ok(activityStatusTone("failed").includes("rose"));
});

test("deriveProgressActionLogs prefers session current/next actions and redacts secret values", () => {
  const result = deriveProgressActionLogs({
    session: {
      currentAction: {
        phase: "auth",
        status: "doing",
        message: "Filling password=super-secret into login form."
      },
      nextAction: {
        phase: "auth",
        status: "planned",
        message: "Submit Sign In."
      }
    },
    entries: []
  });

  assert.equal(result.current?.phase, "auth");
  assert.equal(result.current?.status, "doing");
  assert.match(result.current?.message ?? "", /\[REDACTED\]/);
  assert.equal((result.current?.message ?? "").includes("super-secret"), false);
  assert.equal(result.next?.message, "Submit Sign In.");
});

test("deriveProgressActionLogs falls back to activity timeline summary", () => {
  const result = deriveProgressActionLogs({
    entries: [
      {
        id: "planned-1",
        status: "planned",
        phase: "navigation",
        message: "About to navigate to dashboard."
      },
      {
        id: "doing-1",
        status: "doing",
        phase: "verification",
        message: "Checking protected content visibility."
      }
    ]
  });

  assert.equal(result.current?.message, "Checking protected content visibility.");
  assert.equal(result.next?.message, "About to navigate to dashboard.");
});
