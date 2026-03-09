const DESTRUCTIVE_PATTERNS = [
  /delete/i,
  /remove account/i,
  /close account/i,
  /confirm purchase/i,
  /\bpay\b/i,
  /place order/i,
  /unsubscribe/i,
  /reset/i,
  /wipe/i,
  /permanently remove/i
];

const LOGOUT_PATTERNS = [/\blog ?out\b/i, /sign out/i];
const PAYMENT_WALL_PATTERNS = [
  /confirm purchase/i,
  /payment method/i,
  /billing/i,
  /subscribe/i,
  /subscription/i,
  /start trial/i,
  /choose a plan/i,
  /upgrade to premium/i,
  /place order/i,
  /checkout/i
];

function normalizeDomain(value) {
  return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "").toLowerCase();
}

function extractHostname(value) {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return normalizeDomain(value);
  }
}

function matchesDomainRule(hostname, rule) {
  const normalizedRule = normalizeDomain(rule);
  return hostname === normalizedRule || hostname.endsWith(`.${normalizedRule}`);
}

function collectPlanText(actionPlan = {}, snapshot = null) {
  const semanticId = actionPlan.target?.semanticId ?? null;
  const semantic = semanticId
    ? snapshot?.interactive?.find((item) => item.elementId === semanticId) ?? null
    : null;

  return [
    actionPlan.actionType,
    actionPlan.inputValue,
    actionPlan.rationale,
    actionPlan.expectedStateChange,
    ...(actionPlan.safetyTags ?? []),
    actionPlan.target?.locator,
    actionPlan.target?.fallback,
    semantic?.text,
    semantic?.ariaLabel,
    semantic?.placeholder,
    semantic?.name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isDestructiveAction(actionPlan, snapshot = null) {
  const haystack = collectPlanText(actionPlan, snapshot);
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function isLogoutAction(actionPlan, snapshot = null) {
  const haystack = collectPlanText(actionPlan, snapshot);
  return LOGOUT_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function evaluateDomainAccess(url, safety = {}) {
  const hostname = extractHostname(url);
  const allowlist = (safety.allowlistDomains ?? []).map(normalizeDomain);
  const blocklist = (safety.blocklistDomains ?? []).map(normalizeDomain);

  if (blocklist.some((rule) => matchesDomainRule(hostname, rule))) {
    return {
      allowed: false,
      code: "DOMAIN_BLOCKLISTED",
      reason: `Navigation to ${hostname} is blocklisted.`
    };
  }

  if (allowlist.length > 0 && !allowlist.some((rule) => matchesDomainRule(hostname, rule))) {
    return {
      allowed: false,
      code: "DOMAIN_NOT_ALLOWLISTED",
      reason: `Navigation to ${hostname} is outside the configured allowlist.`
    };
  }

  return {
    allowed: true,
    code: null,
    reason: null
  };
}

export function detectPaymentWall(snapshot) {
  const body = [
    snapshot?.bodyText ?? "",
    ...(snapshot?.overlays ?? []).map((item) => item.text ?? ""),
    ...(snapshot?.semanticMap ?? []).map((item) => item.text ?? "")
  ]
    .join(" ")
    .toLowerCase();

  return PAYMENT_WALL_PATTERNS.some((pattern) => pattern.test(body));
}

export class SafetyPolicy {
  evaluateBeforeAction({ runConfig, actionPlan, snapshot, currentUrl }) {
    const safety = runConfig?.safety ?? {};
    const crawlerMode = Boolean(runConfig?.crawlerMode);

    if (safety.destructiveActionPolicy !== "relaxed" && isDestructiveAction(actionPlan, snapshot)) {
      return {
        allowed: false,
        code: "DESTRUCTIVE_ACTION_BLOCKED",
        reason: "Blocked a potentially destructive action under the strict safety policy."
      };
    }

    if (!crawlerMode && isLogoutAction(actionPlan, snapshot)) {
      return {
        allowed: false,
        code: "LOGOUT_BLOCKED",
        reason: "Logout actions are blocked outside crawler mode."
      };
    }

    if (actionPlan?.actionType === "goto") {
      const targetUrl = actionPlan?.target?.fallback || actionPlan?.target?.locator || currentUrl;
      const domainDecision = evaluateDomainAccess(targetUrl, safety);
      if (!domainDecision.allowed) {
        return domainDecision;
      }
    }

    return {
      allowed: true,
      code: null,
      reason: null
    };
  }

  evaluateNavigation(url, runConfig) {
    return evaluateDomainAccess(url, runConfig?.safety ?? {});
  }

  shouldStopForPaymentWall(snapshot, runConfig) {
    if (runConfig?.safety?.paymentWallStop === false) {
      return false;
    }

    return detectPaymentWall(snapshot);
  }
}
