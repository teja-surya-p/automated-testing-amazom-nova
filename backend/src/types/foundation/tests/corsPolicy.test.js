import test from "node:test";
import assert from "node:assert/strict";

import {
  createCorsOptions,
  isAllowedCorsOrigin,
  resolveAllowedCorsOrigins
} from "../../../services/corsPolicy.js";

test("resolveAllowedCorsOrigins always includes local dashboard dev origin", () => {
  const origins = resolveAllowedCorsOrigins({
    dashboardOrigins: ["http://localhost:3000"]
  });

  assert.ok(origins.includes("http://localhost:3001"));
  assert.ok(origins.includes("http://localhost:3000"));
});

test("isAllowedCorsOrigin allows configured and local development origins", () => {
  const allowedOrigins = resolveAllowedCorsOrigins({
    dashboardOrigins: ["http://localhost:3000"]
  });

  assert.equal(isAllowedCorsOrigin("http://localhost:3001", allowedOrigins), true);
  assert.equal(isAllowedCorsOrigin("http://localhost:3000", allowedOrigins), true);
  assert.equal(isAllowedCorsOrigin("http://evil.example.com", allowedOrigins), false);
});

test("createCorsOptions origin callback accepts dashboard origin and rejects unknown origin", async () => {
  const corsOptions = createCorsOptions({
    dashboardOrigins: ["http://localhost:3001"]
  });

  const allowKnown = await new Promise((resolve) => {
    corsOptions.origin("http://localhost:3001", (_error, allowed) => {
      resolve(Boolean(allowed));
    });
  });
  const allowUnknown = await new Promise((resolve) => {
    corsOptions.origin("http://unknown.example.com", (_error, allowed) => {
      resolve(Boolean(allowed));
    });
  });

  assert.equal(allowKnown, true);
  assert.equal(allowUnknown, false);
});
