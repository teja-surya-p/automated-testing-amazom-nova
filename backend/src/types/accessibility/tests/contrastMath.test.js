import test from "node:test";
import assert from "node:assert/strict";

import {
  contrastRatioFromRgb,
  evaluateContrastSample,
  isLargeText,
  parseFontWeight,
  relativeLuminance,
  srgbChannelToLinear
} from "../contrastMath.js";

test("srgbChannelToLinear converts channel boundaries deterministically", () => {
  assert.equal(srgbChannelToLinear(0), 0);
  assert.equal(Number(srgbChannelToLinear(255).toFixed(3)), 1);
});

test("relativeLuminance computes expected ordering", () => {
  const black = relativeLuminance({ r: 0, g: 0, b: 0 });
  const white = relativeLuminance({ r: 255, g: 255, b: 255 });
  assert.equal(black < white, true);
});

test("contrastRatioFromRgb returns WCAG ratio baseline", () => {
  const ratio = contrastRatioFromRgb(
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 }
  );
  assert.equal(Number(ratio.toFixed(2)), 21);
});

test("isLargeText respects font size and weight thresholds", () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.66, 600), false);
  assert.equal(isLargeText(16, 700), false);
});

test("parseFontWeight handles numeric and keyword values", () => {
  assert.equal(parseFontWeight("bold"), 700);
  assert.equal(parseFontWeight("600"), 600);
  assert.equal(parseFontWeight("normal"), 400);
});

test("evaluateContrastSample applies normal text threshold", () => {
  const result = evaluateContrastSample(
    {
      ratio: 4.0,
      fontSizePx: 14,
      fontWeight: 400,
      isLargeText: false
    },
    {
      minRatioNormalText: 4.5,
      minRatioLargeText: 3.0
    }
  );

  assert.equal(result.requiredRatio, 4.5);
  assert.equal(result.passes, false);
});

test("evaluateContrastSample applies large text threshold", () => {
  const result = evaluateContrastSample(
    {
      ratio: 3.2,
      fontSizePx: 24,
      fontWeight: 700,
      isLargeText: true
    },
    {
      minRatioNormalText: 4.5,
      minRatioLargeText: 3.0
    }
  );

  assert.equal(result.requiredRatio, 3);
  assert.equal(result.passes, true);
});
