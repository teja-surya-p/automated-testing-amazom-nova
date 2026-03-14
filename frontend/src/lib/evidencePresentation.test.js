import assert from "node:assert/strict";
import test from "node:test";

import { resolvePrimaryEvidenceKind } from "./evidencePresentation.js";

test("functionality mode prefers video when available", () => {
  const kind = resolvePrimaryEvidenceKind({
    mode: "functional",
    videoRef: "/artifacts/run/video.webm",
    screenshotRef: "/artifacts/run/step-1.png"
  });
  assert.equal(kind, "video");
});

test("uiux mode remains screenshot-first", () => {
  const kind = resolvePrimaryEvidenceKind({
    mode: "uiux",
    videoRef: "/artifacts/run/video.webm",
    screenshotRef: "/artifacts/run/step-1.png"
  });
  assert.equal(kind, "screenshot");
});

test("falls back to video when screenshot is missing", () => {
  const kind = resolvePrimaryEvidenceKind({
    mode: "uiux",
    videoRef: "/artifacts/run/video.webm",
    screenshotRef: null
  });
  assert.equal(kind, "video");
});

