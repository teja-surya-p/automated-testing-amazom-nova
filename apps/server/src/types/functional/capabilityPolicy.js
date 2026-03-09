const UPLOAD_SAFE_PATTERN =
  /\b(profile|avatar|photo|picture|image|logo|thumbnail|cover image)\b/i;
const UPLOAD_RISKY_PATTERN =
  /\b(payment|card|invoice|receipt|kyc|identity|passport|license|tax|bank|contract|order|checkout)\b/i;

export function resolveFunctionalCapabilities(runConfig = {}) {
  const caps = runConfig?.functional?.capabilities ?? {};
  return {
    allowNewTabs: caps.allowNewTabs !== false,
    allowDownloads: caps.allowDownloads !== false,
    allowUploads: caps.allowUploads === true,
    uploadFixturePath: caps.uploadFixturePath || "fixtures/upload.txt"
  };
}

export function resolveFunctionalReadiness(runConfig = {}) {
  const readiness = runConfig?.functional?.readiness ?? {};
  return {
    strategy: readiness.strategy ?? "hybrid",
    postClickSettleMs: Number(readiness.postClickSettleMs ?? 800)
  };
}

export function classifyUploadTarget(target = {}) {
  const haystack = [
    target.text,
    target.ariaLabel,
    target.placeholder,
    target.name,
    target.id,
    target.selector
  ]
    .filter(Boolean)
    .join(" ");

  if (UPLOAD_RISKY_PATTERN.test(haystack)) {
    return {
      category: "risky",
      confidence: 0.94,
      reason: "Upload target appears to belong to a sensitive workflow."
    };
  }

  if (UPLOAD_SAFE_PATTERN.test(haystack)) {
    return {
      category: "non-destructive",
      confidence: 0.86,
      reason: "Upload target appears to be a low-risk profile/media field."
    };
  }

  return {
    category: "unknown",
    confidence: 0.55,
    reason: "Upload target semantics are not confidently classified as safe."
  };
}

export function evaluateUploadCapability({
  runConfig,
  target
}) {
  const capabilities = resolveFunctionalCapabilities(runConfig);
  if (!capabilities.allowUploads) {
    return {
      allowed: false,
      blockerType: "UPLOAD_REQUIRED",
      confidence: 0.96,
      reason: "File upload is required but functional.capabilities.allowUploads is false.",
      resolutionHint: "Enable allowUploads for controlled fixture-based upload validation."
    };
  }

  const classification = classifyUploadTarget(target);
  if (classification.category !== "non-destructive" || classification.confidence < 0.8) {
    return {
      allowed: false,
      blockerType: "UPLOAD_REQUIRED",
      confidence: classification.confidence,
      reason: `Upload classification blocked: ${classification.reason}`,
      resolutionHint: "Restrict uploads to clear non-destructive fields or keep uploads disabled."
    };
  }

  return {
    allowed: true,
    blockerType: null,
    confidence: classification.confidence,
    reason: classification.reason,
    resolutionHint: "Proceed with safe fixture upload."
  };
}

