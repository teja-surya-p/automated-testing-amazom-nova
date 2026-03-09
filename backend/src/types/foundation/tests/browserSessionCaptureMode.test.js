import test from "node:test";
import assert from "node:assert/strict";

import { BrowserSession } from "../../../services/browserSession.js";

test("browser session uses viewport-only screenshots in uiux mode", () => {
  const session = new BrowserSession("qa-test-uiux", {
    runConfig: {
      testMode: "uiux"
    }
  });

  const options = session.resolveScreenshotCaptureOptions();
  assert.equal(options.captureMode, "viewport");
  assert.equal(options.fullPage, false);
});

test("browser session keeps full-page screenshot mode outside uiux", () => {
  const session = new BrowserSession("qa-test-functional", {
    runConfig: {
      testMode: "functional"
    }
  });

  const options = session.resolveScreenshotCaptureOptions();
  assert.equal(options.captureMode, "full-page");
  assert.equal(options.fullPage, true);
});

