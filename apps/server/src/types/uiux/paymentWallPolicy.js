export function decideUiuxPaymentWall({
  paymentWallDetected,
  frontierHasQueuedUrls,
  hasSafeCandidates
}) {
  if (!paymentWallDetected) {
    return {
      shouldRecordIssue: false,
      shouldBlockCurrentUrl: false,
      shouldStopRun: false,
      reason: null
    };
  }

  const canContinue = Boolean(frontierHasQueuedUrls || hasSafeCandidates);
  return {
    shouldRecordIssue: true,
    shouldBlockCurrentUrl: true,
    shouldStopRun: !canContinue,
    reason: canContinue
      ? "Payment wall detected on the current page, but alternate safe coverage paths remain."
      : "Payment wall detected and no alternate safe coverage paths remain."
  };
}
