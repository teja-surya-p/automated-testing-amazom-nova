export function resolvePrimaryEvidenceKind({ mode = "", videoRef = null, screenshotRef = null } = {}) {
  if (mode === "functional" && videoRef) {
    return "video";
  }
  if (screenshotRef) {
    return "screenshot";
  }
  if (videoRef) {
    return "video";
  }
  return "none";
}

