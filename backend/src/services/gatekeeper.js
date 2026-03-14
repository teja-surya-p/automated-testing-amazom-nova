function includesPattern(value, patterns) {
  const normalized = value.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

function summarizeTopCtas(snapshot) {
  return snapshot.semanticMap
    .slice(0, 12)
    .map((item) => ({
      text: item.text,
      zone: item.zone,
      landmark: item.landmark,
      center: item.center
    }));
}

function buildBlocker(type, confidence, rationale) {
  return {
    type,
    confidence,
    rationale
  };
}

function choosePrimaryBlocker(blockers) {
  return [...blockers].sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export class Gatekeeper {
  constructor({ auditorProvider }) {
    this.auditorProvider = auditorProvider;
  }

  async classify(context) {
    const blockers = this.classifyDeterministically(context);
    let primaryBlocker = choosePrimaryBlocker(blockers);

    if (this.auditorProvider?.classifyGateState) {
      const llmResult = await this.auditorProvider.classifyGateState({
        goal: context.goal,
        url: context.snapshot.url,
        title: context.snapshot.title,
        topCtas: summarizeTopCtas(context.snapshot),
        overlays: context.snapshot.overlays.slice(0, 4),
        consoleErrors: context.snapshot.consoleErrors ?? [],
        networkSummary: context.snapshot.networkSummary ?? {}
      });

      if (llmResult?.pageState && llmResult.pageState !== "READY") {
        primaryBlocker = {
          type: llmResult.pageState,
          confidence: llmResult.confidence ?? primaryBlocker?.confidence ?? 0.7,
          rationale: llmResult.rationale ?? primaryBlocker?.rationale ?? ""
        };
      }
    }

    const policy = this.policyFor(primaryBlocker?.type ?? "READY", context);
    return {
      pageState: primaryBlocker?.type ?? "READY",
      blockers,
      primaryBlocker,
      policy,
      confidence: primaryBlocker?.confidence ?? 0.88,
      rationale: primaryBlocker?.rationale ?? "No blocking state detected."
    };
  }

  classifyDeterministically({ goal, snapshot, unchangedSteps }) {
    const blockers = [];
    const body = snapshot.bodyText.toLowerCase();
    const url = snapshot.url.toLowerCase();
    const combinedLabels = snapshot.semanticMap.map((item) => item.text.toLowerCase()).join(" ");
    const consoleErrors = (snapshot.consoleErrors ?? []).join(" ").toLowerCase();
    const failedRequests = snapshot.networkSummary?.failedRequests ?? 0;
    const status4xx = snapshot.networkSummary?.status4xx ?? 0;
    const status429 = snapshot.networkSummary?.status429 ?? 0;
    const status5xx = snapshot.networkSummary?.status5xx ?? 0;
    const rateLikeFailureSignals = (snapshot.networkSummary?.lastFailures ?? []).reduce((count, failure) => {
      const sample = `${failure?.status ?? ""} ${failure?.failureText ?? ""} ${failure?.url ?? ""}`;
      if (includesPattern(sample, ["429", "rate limit", "too many requests"])) {
        return count + 1;
      }
      return count;
    }, 0);

    if (
      snapshot.overlays.length &&
      includesPattern(
        `${body} ${snapshot.overlays.map((item) => item.text).join(" ").toLowerCase()}`,
        ["cookie", "consent", "before you continue", "privacy", "accept all", "reject all"]
      )
    ) {
      blockers.push(buildBlocker("CONSENT_REQUIRED", 0.96, "Consent or cookie overlay is blocking the page."));
    }

    if (
      includesPattern(`${url} ${body} ${combinedLabels}`, [
        "accounts.google.com",
        "sign in",
        "log in",
        "continue with google"
      ]) &&
      !includesPattern(`${body} ${combinedLabels}`, ["sign out", "your channel", "profile"])
    ) {
      blockers.push(buildBlocker("LOGIN_REQUIRED", 0.92, "The page is prompting for authentication."));
    }

    if (
      includesPattern(`${url} ${body} ${combinedLabels}`, [
        "unusual traffic",
        "recaptcha",
        "are you a robot",
        "challenge"
      ])
    ) {
      blockers.push(buildBlocker("CAPTCHA_BOT_DETECTED", 0.99, "A bot challenge or captcha is visible."));
    }

    const explicitRateLimitSignal = includesPattern(`${body} ${combinedLabels}`, ["rate limit", "too many requests"]);
    const severeRateLikeNetworkPattern = failedRequests >= 8 && (status4xx >= 3 || rateLikeFailureSignals >= 2);
    if (explicitRateLimitSignal || status429 > 0 || rateLikeFailureSignals >= 2 || severeRateLikeNetworkPattern) {
      blockers.push(buildBlocker("RATE_LIMITED", 0.84, "The site appears to be rate limiting the session."));
    }

    if (includesPattern(`${body} ${combinedLabels}`, ["not available in your country", "not available in your region"])) {
      blockers.push(buildBlocker("REGION_RESTRICTED", 0.95, "Regional availability restriction detected."));
    }

    if (
      includesPattern(`${body} ${combinedLabels}`, [
        "payment required",
        "add payment method",
        "billing",
        "confirm purchase",
        "payment method"
      ])
    ) {
      blockers.push(buildBlocker("PAYMENT_REQUIRED", 0.94, "A payment or billing wall is active."));
    } else if (
      includesPattern(`${goal} ${body} ${combinedLabels}`, ["premium", "subscription", "upgrade", "trial", "plan"]) &&
      includesPattern(`${body} ${combinedLabels}`, ["premium", "subscribe", "upgrade", "plan", "trial"])
    ) {
      blockers.push(buildBlocker("PAYWALL", 0.78, "Upgrade or subscription funnel is visible."));
    }

    if (
      snapshot.spinnerVisible &&
      unchangedSteps >= 2
    ) {
      blockers.push(buildBlocker("STUCK_LOADING", 0.9, "A loading state is persisting without meaningful DOM change."));
    }

    if (
      includesPattern(body, ["something went wrong", "error loading", "temporarily unavailable"]) ||
      includesPattern(consoleErrors, ["uncaught", "typeerror", "referenceerror"]) ||
      status5xx > 0
    ) {
      blockers.push(buildBlocker("UI_CHANGED", 0.74, "The page emitted frontend or network errors that may affect navigation."));
    }

    if (!snapshot.semanticMap.length) {
      blockers.push(buildBlocker("UNSUPPORTED_FLOW", 0.68, "No actionable semantic elements were detected."));
    }

    return blockers;
  }

  policyFor(pageState, context) {
    switch (pageState) {
      case "CONSENT_REQUIRED":
        return { strategy: "resolve-consent", nextBestAction: "DISMISS_OVERLAY" };
      case "LOGIN_REQUIRED":
        return { strategy: "login-assist", nextBestAction: "WAIT_FOR_LOGIN" };
      case "CAPTCHA_BOT_DETECTED":
        return { strategy: "safe-abort", nextBestAction: "ABORT_SOFT_PASS" };
      case "PAYMENT_REQUIRED":
        return { strategy: "stop-before-purchase", nextBestAction: "STOP_PAYMENT_REQUIRED" };
      case "PAYWALL":
        return /(premium|subscription|upgrade|plan|trial)/i.test(context.goal)
          ? { strategy: "explore-upgrade-options", nextBestAction: "MAP_FUNNEL" }
          : { strategy: "allow-explore", nextBestAction: "CONTINUE" };
      case "STUCK_LOADING":
        return { strategy: "recover-loading", nextBestAction: "REFRESH_OR_BACK" };
      case "REGION_RESTRICTED":
      case "RATE_LIMITED":
      case "UNSUPPORTED_FLOW":
        return { strategy: "safe-abort", nextBestAction: "ABORT_SOFT_PASS" };
      default:
        return { strategy: "continue", nextBestAction: "CONTINUE" };
    }
  }
}
