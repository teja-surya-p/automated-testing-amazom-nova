export function buildSnapshotEvidenceRefs(
  snapshot = {},
  {
    includeCaptureMode = false,
    defaultCaptureMode = null,
    includeViewport = false
  } = {}
) {
  const refs = [
    {
      type: "screenshot",
      ref: snapshot.screenshotUrl ?? snapshot.screenshotPath,
      ...(includeCaptureMode
        ? {
            captureMode: snapshot.screenshotCaptureMode ?? defaultCaptureMode
          }
        : {}),
      ...(includeViewport
        ? {
            viewport: {
              width: snapshot.viewportWidth ?? null,
              height: snapshot.viewportHeight ?? null
            }
          }
        : {})
    }
  ];

  const domArtifacts = snapshot.artifacts?.dom ?? [];
  const a11yArtifacts = snapshot.artifacts?.a11y ?? [];
  const latestDom = domArtifacts.at(-1);
  const latestA11y = a11yArtifacts.at(-1);
  if (latestDom?.url) {
    refs.push({ type: "dom", ref: latestDom.url });
  }
  if (latestA11y?.url) {
    refs.push({ type: "a11y", ref: latestA11y.url });
  }

  return refs;
}

