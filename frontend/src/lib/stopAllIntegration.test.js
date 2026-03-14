import assert from "node:assert/strict";
import test from "node:test";

import { API_BASE_URL } from "../services/constants.js";
import { stopAllSessions } from "../services/sessionsService.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

test("stopAllSessions uses canonical POST /api/sessions/stop-all", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      ok: true,
      activeFound: 1,
      activeCount: 1,
      stoppedCount: 1,
      requestedSessionIds: ["qa_a"],
      failed: []
    });
  };

  try {
    const payload = await stopAllSessions();
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${API_BASE_URL}/api/sessions/stop-all`);
    assert.equal(calls[0].init.method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stopAllSessions retries legacy alias when canonical route is missing", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: String(url), init };
    calls.push(entry);
    if (calls.length === 1) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "API_ROUTE_NOT_FOUND",
            message: "API route not found."
          }
        },
        404
      );
    }
    return jsonResponse({
      ok: true,
      activeFound: 2,
      activeCount: 2,
      stoppedCount: 2,
      requestedSessionIds: ["qa_a", "qa_b"],
      failed: []
    });
  };

  try {
    const payload = await stopAllSessions();
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${API_BASE_URL}/api/sessions/stop-all`);
    assert.equal(calls[1].url, `${API_BASE_URL}/api/sessions/stop-all-active`);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[1].init.method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

