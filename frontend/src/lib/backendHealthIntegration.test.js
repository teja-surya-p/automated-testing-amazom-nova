import assert from "node:assert/strict";
import test from "node:test";

import { API_BASE_URL } from "../services/constants.js";
import { getApiHealth } from "../services/sessionsService.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

test("getApiHealth uses configured API base and /api/health route", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      init
    });
    return jsonResponse({
      ok: true,
      service: "qa-server",
      version: "test-version",
      capabilities: {
        functionalityLoginAssist: true
      }
    });
  };

  try {
    const payload = await getApiHealth();
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${API_BASE_URL}/api/health`);
    assert.equal(calls[0].init.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
