const BLOCKER_HINTS = {
  LOGIN_REQUIRED: "Use Login Assist in a visible browser, then resume with the same profile tag.",
  CAPTCHA_BOT_DETECTED: "Stop safely; CAPTCHAs are not automated in functional mode.",
  RATE_LIMITED: "Retry later or reduce request pace/profile reuse.",
  REGION_RESTRICTED: "Run from an allowed region or use a region-appropriate target.",
  PAYMENT_REQUIRED: "Stop before payment and mark as blocked.",
  PAYWALL: "Capture paywall blocker and continue only if alternate safe paths exist.",
  CONSENT_REQUIRED: "Attempt safe consent dismiss action and continue.",
  POPUP_BLOCKED: "Popup/new tab blocked by safety domain policy; remain on current tab.",
  NEW_TAB_OPENED: "Switch to the allowed new tab and continue flow assertions.",
  DOWNLOAD_TRIGGERED: "Validate downloaded artifact exists, then continue.",
  UPLOAD_REQUIRED: "Upload needs explicit capability enablement and safe target classification."
};

export function getBlockerResolutionHint(blockerType) {
  return BLOCKER_HINTS[blockerType] ?? "Review blocker context and apply the safest continuation path.";
}

export function toFunctionalBlocker(blocker = {}) {
  return {
    ...blocker,
    resolutionHint: blocker.resolutionHint ?? getBlockerResolutionHint(blocker.type)
  };
}

