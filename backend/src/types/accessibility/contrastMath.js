export function srgbChannelToLinear(channel) {
  const value = Math.min(Math.max(Number(channel) || 0, 0), 255) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color = { r: 0, g: 0, b: 0 }) {
  return (
    0.2126 * srgbChannelToLinear(color.r) +
    0.7152 * srgbChannelToLinear(color.g) +
    0.0722 * srgbChannelToLinear(color.b)
  );
}

export function contrastRatioFromRgb(foreground, background) {
  const lum1 = relativeLuminance(foreground);
  const lum2 = relativeLuminance(background);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function parseFontWeight(fontWeight) {
  const normalized = String(fontWeight ?? "").trim().toLowerCase();
  if (normalized === "bold") {
    return 700;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 400;
}

export function isLargeText(fontSizePx, fontWeight) {
  const size = Number(fontSizePx) || 0;
  const weight = parseFontWeight(fontWeight);
  return size >= 24 || (size >= 18.66 && weight >= 700);
}

export function requiredContrastRatio({
  fontSizePx,
  fontWeight,
  minRatioNormalText = 4.5,
  minRatioLargeText = 3.0,
  isLargeTextOverride = null
} = {}) {
  const large =
    typeof isLargeTextOverride === "boolean"
      ? isLargeTextOverride
      : isLargeText(fontSizePx, fontWeight);
  return large ? Number(minRatioLargeText) || 3.0 : Number(minRatioNormalText) || 4.5;
}

export function evaluateContrastSample(sample = {}, config = {}) {
  const ratio = Number(sample.ratio ?? 0);
  const requiredRatio = requiredContrastRatio({
    fontSizePx: sample.fontSizePx,
    fontWeight: sample.fontWeight,
    isLargeTextOverride: sample.isLargeText,
    minRatioNormalText: config.minRatioNormalText,
    minRatioLargeText: config.minRatioLargeText
  });
  return {
    ratio,
    requiredRatio,
    passes: ratio >= requiredRatio,
    isLargeText: typeof sample.isLargeText === "boolean" ? sample.isLargeText : isLargeText(sample.fontSizePx, sample.fontWeight)
  };
}
