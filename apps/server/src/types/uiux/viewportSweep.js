export const DEFAULT_UIUX_VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 }
];

export function normalizeUiuxViewports(viewports = DEFAULT_UIUX_VIEWPORTS) {
  const seen = new Set();
  return (viewports.length ? viewports : DEFAULT_UIUX_VIEWPORTS)
    .map((viewport) => ({
      label: String(viewport.label ?? `${viewport.width}x${viewport.height}`).trim(),
      width: Number(viewport.width),
      height: Number(viewport.height)
    }))
    .filter((viewport) => viewport.label && Number.isFinite(viewport.width) && Number.isFinite(viewport.height))
    .filter((viewport) => {
      if (seen.has(viewport.label)) {
        return false;
      }
      seen.add(viewport.label);
      return true;
    });
}

export function resolveUiuxViewports(runConfig = {}) {
  return normalizeUiuxViewports(runConfig?.uiux?.viewports ?? DEFAULT_UIUX_VIEWPORTS);
}

export function matchViewportLabel(size, viewports = DEFAULT_UIUX_VIEWPORTS) {
  if (!size?.width || !size?.height) {
    return null;
  }

  return (
    normalizeUiuxViewports(viewports).find(
      (viewport) => viewport.width === size.width && viewport.height === size.height
    )?.label ?? null
  );
}

export function selectViewportSweepCandidates({
  viewports,
  currentViewportLabel,
  elapsedMs,
  timeBudgetMs,
  minViewportBudgetMs = 3_500
}) {
  const normalized = normalizeUiuxViewports(viewports);
  const candidates = normalized.filter((viewport) => viewport.label !== currentViewportLabel);
  const remainingMs = Math.max(timeBudgetMs - elapsedMs, 0);
  const allowedCount = Math.max(Math.floor(remainingMs / minViewportBudgetMs), 0);
  return candidates.slice(0, allowedCount);
}
