import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAuthAssistStatusLabel,
  formatRunTargetForDisplay,
  getLiveViewerFullscreenLabel,
  shouldShowRecentRunsForLaunchStep
} from "./dashboardUi.js";

test("formatRunTargetForDisplay strips protocol/query/hash and keeps compact host", () => {
  assert.equal(
    formatRunTargetForDisplay("https://example.com/path/to/page?x=1#section"),
    "example.com"
  );
  assert.equal(
    formatRunTargetForDisplay("http://www.example.com/path/?x=1", { includePath: true }),
    "example.com/path"
  );
});

test("formatRunTargetForDisplay handles non-url input safely", () => {
  assert.equal(formatRunTargetForDisplay("example.com/test/?a=1"), "example.com/test");
  assert.equal(formatRunTargetForDisplay(""), "-");
});

test("shouldShowRecentRunsForLaunchStep hides recent runs on step 2 only", () => {
  assert.equal(shouldShowRecentRunsForLaunchStep(1), true);
  assert.equal(shouldShowRecentRunsForLaunchStep(2), false);
  assert.equal(shouldShowRecentRunsForLaunchStep(3), true);
});

test("formatAuthAssistStatusLabel keeps auth status compact and readable", () => {
  assert.equal(formatAuthAssistStatusLabel("awaiting_input_fields"), "Awaiting input fields");
  assert.equal(formatAuthAssistStatusLabel("submitting_input_fields"), "Submitting input fields");
  assert.equal(formatAuthAssistStatusLabel("awaiting_otp"), "Awaiting OTP");
  assert.equal(formatAuthAssistStatusLabel("auth_failed"), "Auth failed");
});

test("getLiveViewerFullscreenLabel toggles based on fullscreen state", () => {
  assert.equal(getLiveViewerFullscreenLabel(false), "Fullscreen");
  assert.equal(getLiveViewerFullscreenLabel(true), "Exit fullscreen");
});
