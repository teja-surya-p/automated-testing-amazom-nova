import { config } from "../../lib/config.js";
import { nowIso, sleep } from "../../lib/utils.js";
import { hasVisibleCredentialForm } from "../../library/common-tests/authFlowSignals.js";
import { buildSnapshotEvidenceRefs } from "../../library/common-tests/evidenceRefs.js";
import { buildAuthFormMetadata } from "../../library/auth-fields/index.js";
import { canonicalizeUrl } from "../../library/url/urlFrontier.js";
import { getBlockerResolutionHint, toFunctionalBlocker } from "./blockerTaxonomy.js";
import { evaluateUploadCapability } from "./capabilityPolicy.js";
import { FunctionalFlowGraph } from "./flowGraph.js";
import { discoverFlowCandidates } from "./flowDiscovery.js";
import {
  filterFlowCandidatesBySelection,
  resolveFunctionalCheckSelection
} from "./checkSelection.js";
import { buildFunctionalFormDocs, deriveFunctionalFormGroups } from "./formAssist.js";
import { extractFormSemantics } from "./formSemantics.js";
import { evaluateCoreFunctionalRules } from "./assertions/coreRules.js";
import {
  decideLoginAssistTransition
} from "./loginAssistState.js";
import { evaluateFunctionalSubmitGate } from "./submitGating.js";
import {
  deriveAuthAssistStateFromProbe as deriveAuthAssistState,
  isAuthAssistSkipRequested,
  isAuthAssistReadyToResume,
  mergeDerivedAuthAssistState
} from "../../services/authAssistState.js";

const FUNCTIONAL_BLOCKER_STATES = new Set([
  "LOGIN_REQUIRED",
  "CAPTCHA_BOT_DETECTED",
  "RATE_LIMITED",
  "REGION_RESTRICTED",
  "PAYMENT_REQUIRED",
  "PAYWALL"
]);

const AUTH_CHALLENGE_PATTERN =
  /2fa|two[- ]factor|verification code|otp|one[- ]time code|reset password|forgot password|security code/i;
const AUTH_URL_PATTERN = /\/(login|sign[-_]?in|auth|verify|otp|two[-_]?factor)\b|accounts\.google\.com|auth0|okta|signin/i;
const LOGOUT_URL_PATTERN = /\/(log(?:out|off)|sign(?:out|[-_]?out)|session[-_]?end|end[-_]?session)\b/i;
const LOGOUT_ACTION_PATTERN =
  /\blog\s*out\b|\blogout\b|\bsign\s*out\b|\bsignout\b|\bsign\s*off\b|\bsignoff\b|\bend\s*session\b|\bsession\s*end\b|\bleave\s*workspace\b|\bswitch\s*account\b/i;

function snapshotShowsCredentialLoginWall(snapshot = {}) {
  return hasVisibleCredentialForm(snapshot, {
    allowTextLikeFieldFallback: false
  });
}

function probeShowsAuthRequired(probe = {}) {
  const visibleStep = String(probe?.visibleStep ?? "").trim().toLowerCase();
  const credentialEvidence = probeHasCredentialEvidence(probe);
  const loginWallStrength = String(probe?.loginWallStrength ?? "").trim().toLowerCase();
  const strongLoginWallDetected = ["strong", "medium"].includes(loginWallStrength)
    ? true
    : Boolean(
        probe?.loginWallDetected &&
          (probe?.passwordFieldDetected ||
            probe?.otpFieldDetected ||
            probe?.otpChallengeDetected ||
            probe?.submitControlDetected ||
            visibleStep === "credentials" ||
            visibleStep === "password")
      );

  if (!credentialEvidence && !probe?.otpChallengeDetected && !probe?.captchaDetected) {
    return false;
  }
  if (visibleStep === "otp") {
    return true;
  }
  if (visibleStep === "credentials" || visibleStep === "password") {
    return true;
  }
  if (visibleStep === "username") {
    return strongLoginWallDetected;
  }
  if (probe?.authenticatedHint && !strongLoginWallDetected) {
    return false;
  }
  return Boolean(
    probe?.otpChallengeDetected ||
      probe?.otpFieldDetected ||
      probe?.passwordFieldDetected ||
      strongLoginWallDetected
  );
}

function probeHasCredentialEvidence(probe = {}) {
  const inputFields = Array.isArray(probe?.inputFields)
    ? probe.inputFields.filter((field) => field && typeof field === "object")
    : [];
  return Boolean(
    inputFields.length > 0 ||
    probe?.identifierFieldDetected ||
    probe?.usernameFieldDetected ||
    probe?.passwordFieldDetected ||
    probe?.otpFieldDetected ||
    probe?.otpChallengeDetected ||
    Number(probe?.identifierFieldVisibleCount ?? probe?.usernameFieldVisibleCount ?? 0) > 0 ||
    Number(probe?.passwordFieldVisibleCount ?? 0) > 0 ||
    Number(probe?.otpFieldVisibleCount ?? 0) > 0
  );
}

function isLogoutLikeAction(action = {}) {
  const haystack = [
    action?.functionalKind ?? "",
    action?.type ?? "",
    action?.label ?? "",
    action?.selector ?? "",
    action?.href ?? ""
  ]
    .join(" ")
    .trim();
  if (!haystack) {
    return false;
  }
  if (String(action?.functionalKind ?? "").trim().toLowerCase() === "logout") {
    return true;
  }
  return LOGOUT_ACTION_PATTERN.test(haystack);
}

function isLikelyAuthUrl(url = "") {
  return AUTH_URL_PATTERN.test(String(url ?? ""));
}

function isLikelyLogoutUrl(url = "") {
  return LOGOUT_URL_PATTERN.test(String(url ?? ""));
}

function isHttpUrl(url = "") {
  return /^https?:/i.test(String(url ?? "").trim());
}

function resolveFunctionalFlowEntryUrl(candidates = []) {
  const urls = (Array.isArray(candidates) ? candidates : [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => isHttpUrl(value));

  for (const url of urls) {
    if (!isLikelyAuthUrl(url) && !isLikelyLogoutUrl(url)) {
      return url;
    }
  }

  for (const url of urls) {
    if (!isLikelyLogoutUrl(url)) {
      return url;
    }
  }

  return urls[0] ?? "";
}

function createRunStoppedError(message = "Run stop requested by user.") {
  const error = new Error(message);
  error.code = "RUN_STOPPED";
  return error;
}

function throwIfRunStopped(shouldStop) {
  if (typeof shouldStop === "function" && shouldStop()) {
    throw createRunStoppedError();
  }
}

function severityRank(level = "P2") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
}

function worstSeverity(left = null, right = null) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return severityRank(left) <= severityRank(right) ? left : right;
}

function buildEvidenceRefs(snapshot) {
  return buildSnapshotEvidenceRefs(snapshot);
}

function safeCanonical(url) {
  if (!url) {
    return null;
  }
  try {
    return canonicalizeUrl(url, {
      stripTrackingParams: true,
      preserveMeaningfulParamsOnly: false
    });
  } catch {
    return url;
  }
}

function actionPlanFromAction(action) {
  return {
    actionType: action.type,
    target: {
      semanticId: action.elementId ?? null,
      locator: action.selector ?? null,
      fallback: action.label ?? action.url ?? null
    },
    inputValue: action.text ?? null,
    rationale: `Functional smoke action (${action.functionalKind ?? "generic"})`,
    safetyTags: [`functional:${action.functionalKind ?? "generic"}`],
    expectedStateChange: "Functional flow step should produce deterministic state transition."
  };
}

function buildIssue({
  assertion,
  flow,
  step,
  snapshot,
  action
}) {
  const evidenceRefs = buildEvidenceRefs(snapshot);
  return {
    issueType: "FUNCTIONAL_ASSERTION_FAILED",
    severity: assertion.severity ?? "P2",
    title: assertion.ruleId,
    expected: assertion.expected,
    actual: assertion.actual,
    confidence: assertion.confidence ?? 0.85,
    evidenceRefs,
    affectedSelector: action?.selector ?? null,
    affectedUrl: snapshot?.url ?? null,
    flowId: flow.flowId,
    flowType: flow.flowType,
    assertionId: assertion.ruleId,
    step,
    viewportLabel: snapshot?.viewportLabel ?? "desktop",
    repro: {
      viewportLabel: snapshot?.viewportLabel ?? "desktop",
      step,
      url: snapshot?.url ?? null,
      canonicalUrl: safeCanonical(snapshot?.url),
      targetSelector: action?.selector ?? null,
      actionContext: {
        actionType: action?.type ?? null,
        functionalKind: action?.functionalKind ?? null,
        label: action?.label ?? null
      },
      evidenceRefs
    }
  };
}

function buildReproBundles(issues = []) {
  return issues.map((issue) => ({
    flowId: issue.flowId,
    flowType: issue.flowType,
    step: issue.step,
    action: issue.repro?.actionContext?.actionType ?? null,
    functionalKind: issue.repro?.actionContext?.functionalKind ?? null,
    url: issue.repro?.url ?? issue.affectedUrl ?? null,
    canonicalUrl: issue.repro?.canonicalUrl ?? safeCanonical(issue.affectedUrl),
    viewportLabel: issue.viewportLabel ?? issue.repro?.viewportLabel ?? "desktop",
    selector: issue.affectedSelector ?? issue.repro?.targetSelector ?? null,
    expected: issue.expected,
    actual: issue.actual,
    severity: issue.severity,
    confidence: issue.confidence,
    assertionId: issue.assertionId,
    evidenceRefs: issue.evidenceRefs ?? []
  }));
}

function toFunctionalDeviceSummary({
  flows = [],
  issues = [],
  blockers = [],
  deviceLabel = "desktop"
}) {
  const flowsFailed = flows.filter((flow) => flow.blocked || (flow.assertionFailures ?? 0) > 0).length;
  const flowsPassed = Math.max(flows.length - flowsFailed, 0);
  const assertionsPassed = flows.reduce((total, flow) => total + (flow.assertionPasses ?? 0), 0);
  const assertionsFailed = flows.reduce((total, flow) => total + (flow.assertionFailures ?? 0), 0);
  const issueWorst = issues.reduce((current, issue) => worstSeverity(current, issue?.severity ?? "P2"), null);

  return [
    {
      deviceLabel,
      flowsPassed,
      flowsFailed,
      assertionsPassed,
      assertionsFailed,
      blockers: blockers.length,
      worstSeverity: issueWorst ?? (blockers.length ? "P2" : "P3")
    }
  ];
}

function startFunctionalTestCase(testCaseTracker, payload = {}) {
  if (!testCaseTracker) {
    return null;
  }
  testCaseTracker.discoverCases(1);
  return testCaseTracker.startCase(payload);
}

function completeFunctionalTestCase(testCaseTracker, testCase, result = {}) {
  if (!testCaseTracker || !testCase?.id) {
    return;
  }
  testCaseTracker.completeCase(testCase.id, result);
}

function failFunctionalTestCase(testCaseTracker, testCase, result = {}) {
  if (!testCaseTracker || !testCase?.id) {
    return;
  }
  testCaseTracker.failCase(testCase.id, result);
}

function buildBlockerTimelineEntry({
  step,
  blockerType,
  action = null,
  url = null,
  resolutionHint = null,
  timestamp = nowIso()
}) {
  return {
    step: step ?? 0,
    blockerType,
    action,
    url,
    resolutionHint: resolutionHint ?? getBlockerResolutionHint(blockerType),
    timestamp
  };
}

function createContractAccumulator() {
  return {
    snapshotsObserved: 0,
    apiCallsObserved: 0,
    apiErrorTotals: {
      "4xx": 0,
      "5xx": 0,
      timeouts: 0
    },
    stepsWithApi5xx: 0,
    stepsWithGraphqlErrors: 0,
    stepsWithThirdPartyFailures: 0,
    endpointFailures: new Map()
  };
}

function mergeEndpointFailures(map, topFailingEndpoints = []) {
  for (const endpoint of topFailingEndpoints) {
    const key = endpoint?.urlPath ?? "/";
    const current = map.get(key) ?? {
      urlPath: key,
      count: 0,
      statusCodes: new Set()
    };
    current.count += Number(endpoint?.count ?? 0);
    for (const status of endpoint?.statusCodes ?? []) {
      current.statusCodes.add(String(status));
    }
    map.set(key, current);
  }
}

function captureContractSnapshot(accumulator, snapshot = {}) {
  const summary = snapshot?.networkSummary ?? {};
  const apiCalls = summary.apiCalls ?? [];
  const apiErrors = summary.apiErrorCounts ?? {};

  accumulator.snapshotsObserved += 1;
  accumulator.apiCallsObserved += apiCalls.length;
  accumulator.apiErrorTotals["4xx"] += Number(apiErrors["4xx"] ?? 0);
  accumulator.apiErrorTotals["5xx"] += Number(apiErrors["5xx"] ?? 0);
  accumulator.apiErrorTotals.timeouts += Number(apiErrors.timeouts ?? 0);

  if (Number(apiErrors["5xx"] ?? 0) > 0) {
    accumulator.stepsWithApi5xx += 1;
  }
  if (Number(summary.graphqlErrorsDetected ?? 0) > 0) {
    accumulator.stepsWithGraphqlErrors += 1;
  }

  const thirdPartyFailures = apiCalls.filter((call) => {
    const status = Number(call?.status);
    return Boolean(call?.isThirdParty) && !Number.isNaN(status) && status >= 400;
  }).length;
  if (thirdPartyFailures > 0) {
    accumulator.stepsWithThirdPartyFailures += 1;
  }

  mergeEndpointFailures(accumulator.endpointFailures, summary.topFailingEndpoints ?? []);
}

function finalizeContractSummary(accumulator, runConfig = {}, issues = []) {
  const topFailingEndpoints = [...accumulator.endpointFailures.values()]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.urlPath.localeCompare(right.urlPath);
    })
    .slice(0, 20)
    .map((entry) => ({
      urlPath: entry.urlPath,
      count: entry.count,
      statusCodes: [...entry.statusCodes].sort((left, right) => left.localeCompare(right))
    }));

  const failingRuleCounts = issues.reduce((map, issue) => {
    const key = issue?.assertionId ?? issue?.issueType ?? "UNKNOWN";
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map());

  return {
    snapshotsObserved: accumulator.snapshotsObserved,
    apiCallsObserved: accumulator.apiCallsObserved,
    apiErrorCounts: {
      "4xx": accumulator.apiErrorTotals["4xx"],
      "5xx": accumulator.apiErrorTotals["5xx"],
      timeouts: accumulator.apiErrorTotals.timeouts
    },
    topFailingEndpoints,
    stepsWithApi5xx: accumulator.stepsWithApi5xx,
    stepsWithGraphqlErrors: accumulator.stepsWithGraphqlErrors,
    stepsWithThirdPartyFailures: accumulator.stepsWithThirdPartyFailures,
    failingAssertionCounts: Object.fromEntries(
      [...failingRuleCounts.entries()].sort((left, right) => left[0].localeCompare(right[0]))
    ),
    config: {
      failOnApi5xx: runConfig?.functional?.contracts?.failOnApi5xx !== false,
      warnOnThirdPartyFailures: runConfig?.functional?.contracts?.warnOnThirdPartyFailures !== false,
      endpointAllowlistPatterns: runConfig?.functional?.contracts?.endpointAllowlistPatterns ?? [],
      endpointBlocklistPatterns: runConfig?.functional?.contracts?.endpointBlocklistPatterns ?? []
    }
  };
}

const REQUIRED_VERIFICATION_CONFIDENCE = 1;
const ASSIST_POLL_INTERVAL_MS = Math.max(500, Number(config.loginAssistPollMs ?? 3000));

function createFunctionalDocsAccumulator(startUrl = "") {
  return {
    pages: new Map(),
    forms: new Map(),
    verificationPrompts: 0,
    verificationOverrides: 0,
    startUrl: startUrl || ""
  };
}

function observeFunctionalDocsSnapshot(accumulator, snapshot = {}) {
  if (!snapshot?.url) {
    return;
  }
  const canonicalUrl = safeCanonical(snapshot.url);
  const current = accumulator.pages.get(canonicalUrl) ?? {
    url: snapshot.url,
    canonicalUrl,
    title: snapshot.title ?? "",
    visits: 0,
    hasInputFields: false,
    hasCredentialForm: false,
    hasSearchBar: false,
    hasMainLandmark: false,
    mainActionHints: []
  };
  current.visits += 1;
  current.title = snapshot.title ?? current.title;
  current.hasInputFields = current.hasInputFields || (snapshot.formControls ?? []).length > 0;
  current.hasCredentialForm = current.hasCredentialForm || hasVisibleCredentialForm(snapshot, {
    allowTextLikeFieldFallback: false
  });
  current.hasSearchBar = current.hasSearchBar || Boolean(snapshot.hasSearchBar);
  current.hasMainLandmark = current.hasMainLandmark || Boolean(snapshot.hasMainLandmark);
  current.mainActionHints = [...new Set([
    ...current.mainActionHints,
    ...(snapshot.interactive ?? [])
      .filter((entry) => entry?.inViewport && !entry?.disabled && entry?.zone === "Primary Content")
      .slice(0, 4)
      .map((entry) => entry.text || entry.ariaLabel || entry.placeholder || entry.name || entry.tag)
      .filter(Boolean)
  ])].slice(0, 8);
  accumulator.pages.set(canonicalUrl, current);
}

function observeFunctionalDocsForms(accumulator, groups = []) {
  for (const group of groups) {
    if (!group?.groupId) {
      continue;
    }
    if (!accumulator.forms.has(group.groupId)) {
      accumulator.forms.set(group.groupId, group);
    }
  }
}

function formatWebsiteDocumentation({
  session,
  flows = [],
  issues = [],
  blockers = [],
  loginAssist = {},
  contractSummary = {},
  docsAccumulator
}) {
  const pages = [...docsAccumulator.pages.values()].sort((left, right) =>
    String(left.canonicalUrl).localeCompare(String(right.canonicalUrl))
  );
  const forms = buildFunctionalFormDocs([...docsAccumulator.forms.values()]);
  const mode = session?.runConfig?.testMode ?? "functional";

  const markdown = [
    "# Functional Website Documentation",
    "",
    `- Start URL: ${session?.startUrl ?? docsAccumulator.startUrl ?? "-"}`,
    `- Mode: ${mode}`,
    `- Pages observed: ${pages.length}`,
    `- Forms detected: ${forms.length}`,
    `- Flows executed: ${flows.length}`,
    `- Functional issues: ${issues.length}`,
    `- Functional blockers: ${blockers.length}`,
    `- Verification prompts (confidence < 1.0): ${docsAccumulator.verificationPrompts}`,
    `- Verification overrides by user: ${docsAccumulator.verificationOverrides}`,
    `- Login assist attempted: ${loginAssist?.attempted ? "yes" : "no"}`,
    `- API calls observed: ${contractSummary?.apiCallsObserved ?? 0}`,
    "",
    "## Pages",
    ...(pages.length
      ? pages.map((page) =>
          `- ${page.url} | visits=${page.visits} | inputs=${page.hasInputFields ? "yes" : "no"} | credential-form=${page.hasCredentialForm ? "yes" : "no"} | search=${page.hasSearchBar ? "yes" : "no"} | main-landmark=${page.hasMainLandmark ? "yes" : "no"}`
        )
      : ["- No pages observed."]),
    "",
    "## Forms",
    ...(forms.length
      ? forms.map((form) => `- ${form.purpose}: ${form.description} (${form.fieldCount} fields)`)
      : ["- No form groups detected during this run."]),
    "",
    "## Contracts",
    `- API 4xx: ${contractSummary?.apiErrorCounts?.["4xx"] ?? 0}`,
    `- API 5xx: ${contractSummary?.apiErrorCounts?.["5xx"] ?? 0}`,
    `- API timeouts: ${contractSummary?.apiErrorCounts?.timeouts ?? 0}`,
    `- GraphQL error steps: ${contractSummary?.stepsWithGraphqlErrors ?? 0}`
  ].join("\n");

  return {
    generatedAt: nowIso(),
    pages,
    forms,
    verificationPrompts: docsAccumulator.verificationPrompts,
    verificationOverrides: docsAccumulator.verificationOverrides,
    markdown
  };
}

export function aggregateFunctionalRunnerResult({
  flows = [],
  issues = [],
  blockers = [],
  blockerTimeline = [],
  resumePoints = [],
  loginAssist = null,
  contractSummary = null,
  websiteDocumentation = null
}) {
  const blockersSorted = [...blockers].sort((left, right) => (left.step ?? 0) - (right.step ?? 0));
  const issuesSorted = [...issues].sort((left, right) => {
    const severityDiff = severityRank(left.severity) - severityRank(right.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return (left.step ?? 0) - (right.step ?? 0);
  });
  const assertionsPassed = flows.reduce((total, flow) => total + (flow.assertionPasses ?? 0), 0);
  const assertionsFailed = flows.reduce((total, flow) => total + (flow.assertionFailures ?? 0), 0);
  const assertionsEvaluated = assertionsPassed + assertionsFailed;
  const deviceSummary = toFunctionalDeviceSummary({
    flows,
    issues: issuesSorted,
    blockers: blockersSorted,
    deviceLabel: "desktop"
  });

  return {
    flows,
    flowsRun: flows.length,
    issues: issuesSorted,
    blockers: blockersSorted,
    summary: `Functional: ran ${flows.length} flows, ${assertionsEvaluated} assertions, passed ${assertionsPassed}, failed ${assertionsFailed}, blockers ${blockersSorted.length}`,
    assertionCounts: {
      evaluated: assertionsEvaluated,
      passed: assertionsPassed,
      failed: assertionsFailed
    },
    deviceSummary,
    reproBundles: buildReproBundles(issuesSorted),
    blockerTimeline: blockerTimeline
      .slice()
      .sort((left, right) => (left.step ?? 0) - (right.step ?? 0)),
    resumePoints: resumePoints
      .slice()
      .sort((left, right) => (left.step ?? 0) - (right.step ?? 0)),
    loginAssist: loginAssist ?? {
      attempted: false,
      success: false,
      timeout: false,
      resumeStrategy: "restart-flow",
      profileTag: ""
    },
    contractSummary: contractSummary ?? {
      snapshotsObserved: 0,
      apiCallsObserved: 0,
      apiErrorCounts: {
        "4xx": 0,
        "5xx": 0,
        timeouts: 0
      },
      topFailingEndpoints: [],
      stepsWithApi5xx: 0,
      stepsWithGraphqlErrors: 0,
      stepsWithThirdPartyFailures: 0,
      failingAssertionCounts: {},
      config: {
        failOnApi5xx: true,
        warnOnThirdPartyFailures: true,
        endpointAllowlistPatterns: [],
        endpointBlocklistPatterns: []
      }
    },
    websiteDocumentation
  };
}

export class FunctionalRunner {
  constructor({ safetyPolicy, gatekeeper }) {
    this.safetyPolicy = safetyPolicy;
    this.gatekeeper = gatekeeper;
  }

  appendFunctionalBlocker({
    blockers,
    blockerTimeline,
    blocker,
    step,
    action = null,
    url = null
  }) {
    const normalized = toFunctionalBlocker(blocker);
    blockers.push(normalized);
    blockerTimeline.push(
      buildBlockerTimelineEntry({
        step,
        blockerType: normalized.type,
        action,
        url,
        resolutionHint: normalized.resolutionHint
      })
    );
  }

  appendFunctionalEvent({
    blockerTimeline,
    step,
    blockerType,
    action = null,
    url = null
  }) {
    blockerTimeline.push(
      buildBlockerTimelineEntry({
        step,
        blockerType,
        action,
        url,
        resolutionHint: getBlockerResolutionHint(blockerType)
      })
    );
  }

  async waitForManualLoginAssist({
    session,
    sessionId,
    browserSession,
    sessionStore,
    emitSessionUpdate,
    runConfig,
    step,
    flow,
    action,
    initialProbe = null,
    shouldStop = null
  }) {
    throwIfRunStopped(shouldStop);
    const loginAssistConfig = runConfig?.functional?.loginAssist ?? {};
    const timeoutMs = loginAssistConfig.timeoutMs ?? 180_000;
    const resumeStrategy = loginAssistConfig.resumeStrategy ?? "restart-flow";
    const startedAt = Date.now();
    const domain = session.profile?.domain ?? new URL(session.startUrl).hostname;
    let lastResumeRequestAt = null;
    const toAuthAssistState = (probe = {}) => {
      const derived = deriveAuthAssistState(probe);
      if (derived.state === "running") {
        return {
          state: "awaiting_credentials",
          code: "LOGIN_REQUIRED",
          reason: "Waiting for authentication."
        };
      }
      return derived;
    };
    const toAuthForm = (probe = null, currentForm = null, runtimeMeta = null) =>
      buildAuthFormMetadata({
        probe,
        currentForm,
        runtimeMeta
      });
    const toAuthRuntime = (probe = null, currentRuntime = null, overrides = {}) => ({
      ...(currentRuntime ?? {}),
      authClassificationReason:
        overrides.authClassificationReason ??
        probe?.authClassificationReason ??
        probe?.reason ??
        currentRuntime?.authClassificationReason ??
        null,
      loginWallStrength:
        overrides.loginWallStrength ??
        probe?.loginWallStrength ??
        currentRuntime?.loginWallStrength ??
        "none",
      authenticatedSignalStrength:
        overrides.authenticatedSignalStrength ??
        probe?.authenticatedSignalStrength ??
        currentRuntime?.authenticatedSignalStrength ??
        "weak",
      currentFunctionalPhase:
        overrides.currentFunctionalPhase ??
        currentRuntime?.currentFunctionalPhase ??
        "pre_auth",
      authenticatedConfirmedAt:
        overrides.authenticatedConfirmedAt ??
        currentRuntime?.authenticatedConfirmedAt ??
        null,
      resumedFromAuth:
        overrides.resumedFromAuth ??
        currentRuntime?.resumedFromAuth ??
        false,
      logoutScheduled:
        overrides.logoutScheduled ??
        currentRuntime?.logoutScheduled ??
        false,
      logoutExecuted:
        overrides.logoutExecuted ??
        currentRuntime?.logoutExecuted ??
        false,
      whyAuthRegressed:
        overrides.whyAuthRegressed ??
        currentRuntime?.whyAuthRegressed ??
        null,
      whyLogoutBlocked:
        overrides.whyLogoutBlocked ??
        currentRuntime?.whyLogoutBlocked ??
        null
    });
    const emptyProbe = {
      visibleStep: "unknown",
      identifierFieldDetected: false,
      usernameFieldDetected: false,
      passwordFieldDetected: false,
      otpFieldDetected: false,
      submitControlDetected: false
    };
    const bootstrapProbe =
      initialProbe ??
      (await browserSession.collectAuthFormProbe().catch(() => null)) ??
      emptyProbe;
    if (!probeShowsAuthRequired(bootstrapProbe) || !probeHasCredentialEvidence(bootstrapProbe)) {
      const resumedAt = nowIso();
      sessionStore.patchSession(sessionId, {
        status: "running",
        loginAssist: {
          state: "NOT_REQUIRED",
          domain,
          timeoutMs,
          resumeStrategy,
          endedAt: resumedAt
        },
        authAssist: {
          state: "running",
          code: "AUTH_NOT_REQUIRED",
          reason: "No login wall detected from live auth probe; continuing flow.",
          site: bootstrapProbe.site || domain,
          pageUrl:
            bootstrapProbe.pageUrl ||
            browserSession.page?.url?.() ||
            session.currentUrl ||
            session.startUrl,
          loginRequired: false,
          form: toAuthForm(bootstrapProbe),
          startedAt: resumedAt,
          timeoutMs,
          remainingMs: 0,
          endedAt: resumedAt,
          profileTag: runConfig.profileTag ?? "",
          source: "probe",
          runtime: toAuthRuntime(bootstrapProbe, null, {
            currentFunctionalPhase: "authenticated",
            authenticatedConfirmedAt: resumedAt,
            resumedFromAuth: true
          }),
          updatedAt: resumedAt
        }
      });
      sessionStore.appendAgentActivity?.(sessionId, {
        phase: "auth",
        kind: "login-assist",
        status: "done",
        message: "Login-assist bypassed because no credential wall evidence was detected.",
        details: {
          flowId: flow?.flowId ?? null,
          step: step ?? null
        }
      });
      emitSessionUpdate?.();
      return {
        status: "resumed",
        code: "LOGIN_ASSIST_NOT_REQUIRED",
        rationale: "No credential wall evidence detected.",
        snapshot: null,
        resumeStrategy
      };
    }

    sessionStore.patchSession(sessionId, {
      status: "login-assist",
      loginAssist: {
        state: "AWAITING_CREDENTIALS",
        domain,
        startedAt: nowIso(),
        timeoutMs,
        resumeStrategy,
        hint: "Authentication required. Submit credentials in dashboard or complete manually in browser."
      },
      authAssist: {
        state: "awaiting_credentials",
        code: "LOGIN_REQUIRED",
        reason: "Authentication required before functional flows can continue.",
        site: domain,
        pageUrl: bootstrapProbe.pageUrl || browserSession.page?.url?.() || session.currentUrl || session.startUrl,
        loginRequired: true,
        form: toAuthForm(bootstrapProbe),
        startedAt: nowIso(),
        timeoutMs,
        remainingMs: timeoutMs,
        profileTag: runConfig.profileTag ?? "",
        source: "probe",
        runtime: toAuthRuntime(bootstrapProbe, null, {
          currentFunctionalPhase: "pre_auth",
          resumedFromAuth: false,
          logoutScheduled: false,
          logoutExecuted: false
        }),
        updatedAt: nowIso()
      },
      runSummary: {
        outcome: null,
        primaryBlocker: {
          type: "LOGIN_REQUIRED",
          confidence: 0.92,
          rationale: "Functional run requires manual login before continuation."
        },
        nextBestAction: "WAIT_FOR_LOGIN",
        evidenceQualityScore: 0.74,
        targetAchieved: false
      }
    });
    sessionStore.appendTimeline?.(sessionId, {
      type: "functional-login-assist",
      message: "Authentication required. Awaiting credentials/OTP via dashboard or manual browser completion."
    });
    sessionStore.appendAgentActivity?.(sessionId, {
      phase: "auth",
      kind: "login-assist",
      status: "doing",
      message: "Login page detected. Waiting for authentication input fields.",
      details: {
        flowId: flow?.flowId ?? null,
        step: step ?? null,
        reason: "Protected flow requires authentication before continuing.",
        nextAction: "Await input fields or OTP"
      }
    });
    emitSessionUpdate?.();

    while (true) {
      throwIfRunStopped(shouldStop);
      const currentSession = sessionStore.getSession(sessionId);
      const currentAuthAssist = currentSession?.authAssist ?? null;
      const resumeRequestAt =
        currentAuthAssist?.resumeRequestedAt ??
        currentSession?.loginAssist?.resumeRequestedAt ??
        null;
      const forceResumeCheck = Boolean(resumeRequestAt && resumeRequestAt !== lastResumeRequestAt);
      if (forceResumeCheck) {
        lastResumeRequestAt = resumeRequestAt;
        sessionStore.appendTimeline?.(sessionId, {
          type: "functional-login-assist",
          message: "Resume check requested; validating authentication state."
        });
        sessionStore.appendAgentActivity?.(sessionId, {
          phase: "resume",
          kind: "auth-resume-check",
          status: "doing",
          message: "Resume requested. Validating whether session is authenticated.",
          details: {
            flowId: flow?.flowId ?? null,
            step: step ?? null
          }
        });
        if (currentAuthAssist && typeof currentAuthAssist === "object") {
          sessionStore.patchSession(sessionId, {
            authAssist: {
              runtime: {
                ...(currentAuthAssist.runtime ?? {}),
                resumeLoopAwakened: true,
                resumeLoopConsumedFields: Boolean(
                  currentAuthAssist.runtime?.inputFieldsConsumed ?? currentAuthAssist.submitAttempted
                )
              }
            }
          });
        }
      }

      if (!forceResumeCheck) {
        await sleep(config.loginAssistPollMs);
      }
      throwIfRunStopped(shouldStop);

      const latestSession = sessionStore.getSession(sessionId);
      const latestAuthAssist = latestSession?.authAssist ?? null;
      if (isAuthAssistSkipRequested(latestAuthAssist)) {
        const skippedAt = nowIso();
        sessionStore.patchSession(sessionId, {
          status: "running",
          loginAssist: {
            state: "SKIPPED",
            domain,
            timeoutMs,
            resumeStrategy,
            endedAt: skippedAt
          },
          authAssist: {
            ...(latestAuthAssist ?? {}),
            state: "auth_failed",
            code: "LOGIN_SKIPPED",
            reason:
              latestAuthAssist?.reason ||
              "Credential submission was skipped by user.",
            site: latestAuthAssist?.site || domain,
            pageUrl:
              latestAuthAssist?.pageUrl ||
              latestSession?.currentUrl ||
              session.startUrl,
            loginRequired: true,
            source: latestAuthAssist?.source ?? "api",
            remainingMs: Math.max(timeoutMs - (Date.now() - startedAt), 0),
            endedAt: skippedAt,
            updatedAt: skippedAt
          }
        });
        sessionStore.appendTimeline?.(sessionId, {
          type: "functional-login-assist",
          message: "Login assist skipped by user."
        });
        emitSessionUpdate?.();
        sessionStore.appendAgentActivity?.(sessionId, {
          phase: "auth",
          kind: "login-assist",
          status: "blocked",
          message: "Login assist was skipped by user; flow remains blocked.",
          details: {
            code: "LOGIN_SKIPPED"
          }
        });
        return {
          status: "blocked",
          code: "LOGIN_SKIPPED",
          rationale:
            latestAuthAssist?.reason ||
            "Credential submission was skipped by user.",
          snapshot: null,
          resumeStrategy
        };
      }
      if (isAuthAssistReadyToResume(latestAuthAssist)) {
        const probe = await browserSession.collectAuthFormProbe();
        const resumedSnapshot = await browserSession
          .capture(`functional-login-assist-resumed-${step}`, {
            includeUiuxSignals: false,
            includeFocusProbe: false
          })
          .catch(() => null);
        await browserSession.persistStorageState();
        sessionStore.patchSession(sessionId, {
          status: "running",
          currentUrl: resumedSnapshot?.url || probe.pageUrl || latestSession?.currentUrl || session.startUrl,
          currentStep: step,
          frame: resumedSnapshot?.screenshotBase64
            ? `data:image/png;base64,${resumedSnapshot.screenshotBase64}`
            : latestSession?.frame ?? null,
          artifactIndex: browserSession.getArtifactIndex(),
          loginAssist: {
            state: "AUTH_VALIDATED",
            domain,
            resumedAt: nowIso(),
            timeoutMs,
            resumeStrategy
          },
          authAssist: {
            state: "resumed",
            code: "AUTH_VALIDATED",
            reason: latestAuthAssist?.reason || "Authentication validated and flow resumed.",
            site: probe.site || domain,
            pageUrl: probe.pageUrl || session.startUrl,
            loginRequired: false,
            form: toAuthForm(probe, latestAuthAssist?.form ?? null),
            runtime: toAuthRuntime(probe, latestAuthAssist?.runtime ?? null, {
              currentFunctionalPhase: "authenticated",
              authenticatedConfirmedAt: nowIso(),
              resumedFromAuth: true
            }),
            startedAt: latestAuthAssist?.startedAt ?? nowIso(),
            timeoutMs,
            remainingMs: 0,
            endedAt: nowIso(),
            profileTag: runConfig.profileTag ?? "",
            source: "probe",
            updatedAt: nowIso()
          }
        });
        emitSessionUpdate?.();
        sessionStore.appendAgentActivity?.(sessionId, {
          phase: "resume",
          kind: "auth-resume",
          status: "done",
          message: "Authentication validated. Resuming functionality flow.",
          details: {
            flowId: flow?.flowId ?? null,
            step: step ?? null,
            authState: "resumed"
          }
        });
        return {
          status: "resumed",
          code: "LOGIN_ASSIST_AUTH_VALIDATED",
          rationale: "Authentication validated and flow resumed.",
          snapshot: resumedSnapshot,
          resumeStrategy
        };
      }

      const elapsedMs = Date.now() - startedAt;
      const probe = await browserSession.collectAuthFormProbe();
      const authenticated = await browserSession.isAuthenticated();
      const nonLoginAuthMarker = !probe.loginWallDetected && !probe.otpChallengeDetected;
      const decision = decideLoginAssistTransition({
        enabled: loginAssistConfig.enabled !== false,
        headless: config.headless,
        elapsedMs,
        timeoutMs,
        authenticated,
        nonLoginAuthMarker,
        captchaDetected: probe.captchaDetected
      });
      const authAssistState = mergeDerivedAuthAssistState({
        currentAuthAssist: latestAuthAssist,
        derivedState: toAuthAssistState(probe)
      });
      const freshestAuthAssist = sessionStore.getSession(sessionId)?.authAssist ?? latestAuthAssist;
      if (isAuthAssistReadyToResume(freshestAuthAssist)) {
        continue;
      }
      const preserveApiState =
        latestAuthAssist?.source === "api" &&
        latestAuthAssist?.state === authAssistState?.state &&
        latestAuthAssist?.code === authAssistState?.code;

      sessionStore.patchSession(sessionId, {
        currentUrl: probe.pageUrl || sessionStore.getSession(sessionId)?.currentUrl || session.startUrl,
        currentStep: step,
        loginAssist: {
          state: authAssistState.state.toUpperCase(),
          domain,
          startedAt: sessionStore.getSession(sessionId)?.loginAssist?.startedAt ?? nowIso(),
          timeoutMs,
          resumeStrategy,
          remainingMs: Math.max(timeoutMs - elapsedMs, 0),
          hint: "Authentication required. Submit credentials/OTP in dashboard or complete manually in browser."
        },
        authAssist: {
          state: authAssistState.state,
          code: authAssistState.code,
          reason: authAssistState.reason,
          site: probe.site || domain,
          pageUrl: probe.pageUrl || sessionStore.getSession(sessionId)?.currentUrl || session.startUrl,
          loginRequired: true,
          form: toAuthForm(probe, latestAuthAssist?.form ?? null),
          runtime: toAuthRuntime(probe, latestAuthAssist?.runtime ?? null, {
            currentFunctionalPhase: "pre_auth",
            resumedFromAuth: false,
            whyAuthRegressed:
              ["authenticated", "resumed"].includes(String(latestAuthAssist?.state ?? "").trim().toLowerCase())
                ? "auth_wall_reappeared_after_authenticated_state"
                : (latestAuthAssist?.runtime?.whyAuthRegressed ?? null)
          }),
          startedAt: sessionStore.getSession(sessionId)?.authAssist?.startedAt ?? nowIso(),
          timeoutMs,
          remainingMs: Math.max(timeoutMs - elapsedMs, 0),
          profileTag: runConfig.profileTag ?? "",
          source: preserveApiState ? "api" : "probe",
          updatedAt: nowIso()
        }
      });
      emitSessionUpdate?.();

      if (decision.outcome === "RESUME") {
        const resumedSnapshot = await browserSession
          .capture(`functional-login-assist-resume-${step}`, {
            includeUiuxSignals: false,
            includeFocusProbe: false
          })
          .catch(() => null);
        await browserSession.persistStorageState();
        sessionStore.patchSession(sessionId, {
          status: "running",
          currentUrl: resumedSnapshot?.url || probe.pageUrl || session.startUrl,
          currentStep: step,
          frame: resumedSnapshot?.screenshotBase64
            ? `data:image/png;base64,${resumedSnapshot.screenshotBase64}`
            : sessionStore.getSession(sessionId)?.frame ?? null,
          artifactIndex: browserSession.getArtifactIndex(),
          loginAssist: {
            state: "AUTH_VALIDATED",
            domain,
            resumedAt: nowIso(),
            timeoutMs,
            resumeStrategy
          },
          authAssist: {
            state: "resumed",
            code: "AUTH_VALIDATED",
            reason: "Authentication validated and flow resumed.",
            site: probe.site || domain,
            pageUrl: probe.pageUrl || session.startUrl,
            loginRequired: false,
            form: toAuthForm(probe, sessionStore.getSession(sessionId)?.authAssist?.form ?? null),
            runtime: toAuthRuntime(probe, sessionStore.getSession(sessionId)?.authAssist?.runtime ?? null, {
              currentFunctionalPhase: "authenticated",
              authenticatedConfirmedAt: nowIso(),
              resumedFromAuth: true
            }),
            startedAt: sessionStore.getSession(sessionId)?.authAssist?.startedAt ?? nowIso(),
            timeoutMs,
            remainingMs: 0,
            endedAt: nowIso(),
            profileTag: runConfig.profileTag ?? "",
            source: "probe",
            updatedAt: nowIso()
          }
        });
        emitSessionUpdate?.();
        sessionStore.appendAgentActivity?.(sessionId, {
          phase: "resume",
          kind: "auth-resume",
          status: "done",
          message: "Authentication validated. Resuming functionality flow.",
          details: {
            flowId: flow?.flowId ?? null,
            step: step ?? null,
            authState: "resumed"
          }
        });
        return {
          status: "resumed",
          code: decision.code,
          rationale: decision.reason,
          snapshot: resumedSnapshot,
          resumeStrategy
        };
      }

      if (decision.outcome === "TIMEOUT") {
        sessionStore.patchSession(sessionId, {
          status: "running",
          loginAssist: {
            state: "TIMEOUT",
            domain,
            timeoutMs,
            resumeStrategy,
            endedAt: nowIso()
          },
          authAssist: {
            state: "auth_failed",
            code: "LOGIN_ASSIST_TIMEOUT",
            reason: decision.reason,
            site: probe.site || domain,
            pageUrl: probe.pageUrl || session.startUrl,
            loginRequired: true,
            form: toAuthForm(probe, sessionStore.getSession(sessionId)?.authAssist?.form ?? null),
            startedAt: sessionStore.getSession(sessionId)?.authAssist?.startedAt ?? nowIso(),
            timeoutMs,
            remainingMs: 0,
            endedAt: nowIso(),
            profileTag: runConfig.profileTag ?? "",
            source: "probe",
            updatedAt: nowIso()
          }
        });
        emitSessionUpdate?.();
        sessionStore.appendAgentActivity?.(sessionId, {
          phase: "auth",
          kind: "timeout",
          status: "failed",
          message: "Login assist timed out before authentication could be validated.",
          details: {
            code: decision.code
          }
        });
        return {
          status: "timeout",
          code: decision.code,
          rationale: decision.reason,
          snapshot: null,
          resumeStrategy
        };
      }

      if (decision.outcome === "SOFT_PASS" || decision.outcome === "BLOCKED") {
        sessionStore.patchSession(sessionId, {
          status: "running",
          loginAssist: {
            state: "BLOCKED",
            domain,
            timeoutMs,
            resumeStrategy,
            endedAt: nowIso()
          },
          authAssist: {
            state: "auth_failed",
            code: decision.code,
            reason: decision.reason,
            site: probe.site || domain,
            pageUrl: probe.pageUrl || session.startUrl,
            loginRequired: true,
            form: toAuthForm(probe, sessionStore.getSession(sessionId)?.authAssist?.form ?? null),
            startedAt: sessionStore.getSession(sessionId)?.authAssist?.startedAt ?? nowIso(),
            timeoutMs,
            remainingMs: Math.max(timeoutMs - elapsedMs, 0),
            endedAt: nowIso(),
            profileTag: runConfig.profileTag ?? "",
            source: "probe",
            updatedAt: nowIso()
          }
        });
        emitSessionUpdate?.();
        sessionStore.appendAgentActivity?.(sessionId, {
          phase: "auth",
          kind: "blocked",
          status: "failed",
          message: decision.reason,
          details: {
            code: decision.code
          }
        });
        return {
          status: "blocked",
          code: decision.code,
          rationale: decision.reason,
          snapshot: null,
          resumeStrategy
        };
      }
    }
  }

  async waitForFormAssist({
    session,
    sessionId,
    browserSession,
    sessionStore,
    emitSessionUpdate,
    snapshot,
    step,
    flow,
    shouldStop = null
  }) {
    throwIfRunStopped(shouldStop);
    const groups = deriveFunctionalFormGroups(snapshot);
    if (!groups.length) {
      return {
        status: "not-required",
        snapshot
      };
    }

    const startedAt = nowIso();
    const formAssistState = {
      state: "awaiting_user",
      pageUrl: snapshot.url,
      step,
      flowId: flow?.flowId ?? null,
      reason: "Input fields detected. User decision is required for submit/skip/auto handling.",
      groups,
      decisions: {},
      globalAction: null,
      pendingGroupIds: groups.map((group) => group.groupId),
      history: [],
      startedAt,
      endedAt: null,
      updatedAt: startedAt
    };

    sessionStore.patchSession(sessionId, {
      status: "form-assist",
      formAssist: formAssistState,
      currentUrl: snapshot.url,
      currentStep: step,
      frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
      artifactIndex: browserSession.getArtifactIndex()
    });
    sessionStore.appendTimeline?.(sessionId, {
      type: "functional-form-assist",
      message: `Detected ${groups.length} form group(s); awaiting dashboard decision.`
    });
    emitSessionUpdate?.();

    const timeoutMs = Math.max(60_000, Number(session?.runConfig?.functional?.formAssist?.timeoutMs ?? 900_000));
    const startedAtMs = Date.now();

    while (true) {
      throwIfRunStopped(shouldStop);
      const latest = sessionStore.getSession(sessionId);
      const assist = latest?.formAssist ?? null;
      if (!assist || assist.state === "resolved") {
        return {
          status: "resolved",
          snapshot
        };
      }

      const globalAction = String(assist.globalAction ?? "").toLowerCase();
      const providedDecisions = assist.decisions ?? {};
      const resolvedDecisions = {
        ...providedDecisions
      };

      if (globalAction === "skip-all" || globalAction === "auto-all") {
        const action = globalAction === "skip-all" ? "skip" : "auto";
        for (const group of groups) {
          if (resolvedDecisions[group.groupId]) {
            continue;
          }
          resolvedDecisions[group.groupId] = {
            action,
            values: {},
            description: group.description ?? "",
            reason: `Applied global action ${globalAction}.`,
            decidedAt: nowIso()
          };
        }
      }

      const allDecided = groups.every((group) => Boolean(resolvedDecisions[group.groupId]));
      if (!allDecided) {
        if (Date.now() - startedAtMs > timeoutMs) {
          sessionStore.patchSession(sessionId, {
            status: "running",
            formAssist: {
              ...assist,
              state: "timed_out",
              endedAt: nowIso(),
              updatedAt: nowIso()
            }
          });
          emitSessionUpdate?.();
          return {
            status: "timeout",
            code: "FORM_ASSIST_TIMEOUT",
            rationale: "Form assist timed out before all form groups received decisions.",
            snapshot
          };
        }
        await sleep(ASSIST_POLL_INTERVAL_MS);
        continue;
      }

      sessionStore.patchSession(sessionId, {
        formAssist: {
          ...assist,
          state: "processing",
          decisions: resolvedDecisions,
          pendingGroupIds: [],
          updatedAt: nowIso()
        }
      });
      emitSessionUpdate?.();

      let latestSnapshot = snapshot;
      const history = [];
      for (const group of groups) {
        throwIfRunStopped(shouldStop);
        const decision = resolvedDecisions[group.groupId];
        const normalizedAction = String(decision?.action ?? "skip").toLowerCase();
        if (normalizedAction === "skip") {
          history.push({
            groupId: group.groupId,
            action: "skip",
            at: nowIso()
          });
          sessionStore.appendTimeline?.(sessionId, {
            type: "functional-form-assist",
            message: `Skipped form group ${group.groupId}.`
          });
          continue;
        }

        const submission = await browserSession.submitFormAssistGroup(group, {
          action: normalizedAction === "auto" ? "auto" : "submit",
          values: decision?.values ?? {},
          description: decision?.description ?? group.description ?? "",
          submitSelector: group.submitSelector ?? null,
          submitLabel: group.submitLabel ?? null
        });
        history.push({
          groupId: group.groupId,
          action: normalizedAction === "auto" ? "auto" : "submit",
          at: nowIso(),
          submitTriggered: Boolean(submission?.submitTriggered),
          fieldResults: submission?.fieldResults ?? []
        });

        latestSnapshot = await browserSession.capture(
          `functional-form-assist-${group.groupId}-${step}`,
          {
            includeUiuxSignals: false,
            includeFocusProbe: false
          }
        );
      }

      const resolvedAssist = sessionStore.getSession(sessionId)?.formAssist ?? assist;
      sessionStore.patchSession(sessionId, {
        status: "running",
        currentUrl: latestSnapshot.url,
        currentStep: step,
        frame: `data:image/png;base64,${latestSnapshot.screenshotBase64}`,
        artifactIndex: browserSession.getArtifactIndex(),
        formAssist: {
          ...resolvedAssist,
          state: "resolved",
          decisions: resolvedDecisions,
          pendingGroupIds: [],
          history: [...(resolvedAssist.history ?? []), ...history].slice(-50),
          endedAt: nowIso(),
          updatedAt: nowIso()
        }
      });
      emitSessionUpdate?.();
      return {
        status: "resolved",
        snapshot: latestSnapshot,
        groups,
        decisions: resolvedDecisions
      };
    }
  }

  async waitForVerificationAssist({
    sessionId,
    sessionStore,
    emitSessionUpdate,
    snapshot,
    step,
    flow,
    assertionResults = [],
    shouldStop = null
  }) {
    const uncertainAssertions = assertionResults.filter(
      (assertion) => Number(assertion?.confidence ?? 0) < REQUIRED_VERIFICATION_CONFIDENCE
    );
    if (!uncertainAssertions.length) {
      return {
        resolvedAssertions: assertionResults,
        prompted: 0,
        overrides: 0,
        timedOut: false
      };
    }

    const prompts = uncertainAssertions.map((assertion, index) => {
      const safeRuleId =
        String(assertion.ruleId ?? "rule")
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64) || "rule";
      return {
        promptId: `verify_${step}_${index + 1}_${safeRuleId}`,
      assertionIndex: assertionResults.findIndex((entry) => entry === assertion),
      ruleId: assertion.ruleId ?? "UNKNOWN_RULE",
      expected: assertion.expected ?? "",
      actual: assertion.actual ?? "",
      confidence: Number(assertion.confidence ?? 0),
      severity: assertion.severity ?? "P2",
      proposedPass: Boolean(assertion.pass),
      evidenceRefs: assertion.evidenceRefs ?? []
      };
    });

    const startedAt = nowIso();
    sessionStore.patchSession(sessionId, {
      status: "verification-assist",
      verificationAssist: {
        state: "awaiting_user",
        pageUrl: snapshot.url,
        step,
        flowId: flow?.flowId ?? null,
        reason: "Verification confidence is below 100%; user confirmation is required.",
        prompts,
        decisions: {},
        globalDecision: null,
        pendingPromptIds: prompts.map((prompt) => prompt.promptId),
        startedAt,
        endedAt: null,
        updatedAt: startedAt
      }
    });
    sessionStore.appendTimeline?.(sessionId, {
      type: "functional-verification-assist",
      message: `Awaiting confirmation for ${prompts.length} verification result(s).`
    });
    emitSessionUpdate?.();

    const timeoutMs = Math.max(60_000, Number(sessionStore.getSession(sessionId)?.runConfig?.functional?.verification?.timeoutMs ?? 900_000));
    const startedAtMs = Date.now();

    while (true) {
      throwIfRunStopped(shouldStop);
      const latest = sessionStore.getSession(sessionId);
      const assist = latest?.verificationAssist ?? null;
      if (!assist || assist.state === "resolved") {
        return {
          resolvedAssertions: assertionResults,
          prompted: prompts.length,
          overrides: 0,
          timedOut: false
        };
      }

      const globalDecision = String(assist.globalDecision ?? "").toLowerCase();
      const decisions = {
        ...(assist.decisions ?? {})
      };
      if (["accept-agent", "override-pass", "override-fail"].includes(globalDecision)) {
        for (const prompt of prompts) {
          if (!decisions[prompt.promptId]) {
            decisions[prompt.promptId] = {
              decision: globalDecision,
              decidedAt: nowIso()
            };
          }
        }
      }

      const allDecided = prompts.every((prompt) => Boolean(decisions[prompt.promptId]));
      if (!allDecided) {
        if (Date.now() - startedAtMs > timeoutMs) {
          sessionStore.patchSession(sessionId, {
            status: "running",
            verificationAssist: {
              ...assist,
              state: "timed_out",
              endedAt: nowIso(),
              updatedAt: nowIso()
            }
          });
          emitSessionUpdate?.();
          return {
            resolvedAssertions: assertionResults,
            prompted: prompts.length,
            overrides: 0,
            timedOut: true
          };
        }
        await sleep(ASSIST_POLL_INTERVAL_MS);
        continue;
      }

      const promptByIndex = new Map(prompts.map((prompt) => [prompt.assertionIndex, prompt]));
      const resolvedAssertions = assertionResults.map((assertion, index) => {
        const prompt = promptByIndex.get(index);
        if (!prompt || !prompt.promptId) {
          return assertion;
        }
        const decisionEntry = decisions[prompt.promptId] ?? {
          decision: "accept-agent"
        };
        const decision = String(decisionEntry.decision ?? "accept-agent").toLowerCase();
        if (decision === "override-pass") {
          return {
            ...assertion,
            pass: true,
            confidence: 1,
            actual: `${assertion.actual} [User override: PASS]`
          };
        }
        if (decision === "override-fail") {
          return {
            ...assertion,
            pass: false,
            confidence: 1,
            actual: `${assertion.actual} [User override: FAIL]`,
            severity: assertion.severity ?? "P2"
          };
        }
        return {
          ...assertion,
          confidence: 1
        };
      });

      const overrideCount = Object.values(decisions).filter((entry) =>
        ["override-pass", "override-fail"].includes(String(entry?.decision ?? "").toLowerCase())
      ).length;
      sessionStore.patchSession(sessionId, {
        status: "running",
        verificationAssist: {
          ...assist,
          state: "resolved",
          decisions,
          pendingPromptIds: [],
          endedAt: nowIso(),
          updatedAt: nowIso()
        }
      });
      emitSessionUpdate?.();
      return {
        resolvedAssertions,
        prompted: prompts.length,
        overrides: overrideCount,
        timedOut: false
      };
    }
  }

  async runFinalLogoutStage({
    session,
    sessionId,
    runConfig,
    browserSession,
    sessionStore,
    snapshot,
    step,
    shouldStop = null
  }) {
    throwIfRunStopped(shouldStop);
    sessionStore.appendAgentActivity?.(sessionId, {
      phase: "auth",
      kind: "logout-stage",
      status: "planned",
      message: "About to execute final logout stage.",
      details: {
        step: step ?? null,
        reason: "Final logout validation is scheduled after authenticated checks."
      }
    });
    const logoutControl = (snapshot?.interactive ?? [])
      .filter((item) => item?.inViewport && !item?.disabled)
      .find((item) =>
        /logout|log out|sign out|signout/i.test(
          [item?.text, item?.ariaLabel, item?.placeholder, item?.name, item?.href].join(" ")
        )
      );

    if (!logoutControl) {
      sessionStore.appendAgentActivity?.(sessionId, {
        phase: "auth",
        kind: "logout-stage",
        status: "blocked",
        message: "Final logout stage skipped because no visible logout control was detected.",
        details: {
          step: step ?? null
        }
      });
      return {
        status: "skipped",
        reason: "No visible logout control was detected for final-stage logout validation.",
        beforeSnapshot: snapshot,
        afterSnapshot: snapshot,
        actionResult: null
      };
    }

    const logoutAction = {
      type: "click",
      elementId: logoutControl.elementId,
      functionalKind: "logout",
      selector: logoutControl.selector ?? null,
      label: logoutControl.text || logoutControl.ariaLabel || logoutControl.name || "Logout"
    };
    const safetyDecision = this.safetyPolicy.evaluateBeforeAction({
      runConfig,
      actionPlan: actionPlanFromAction(logoutAction),
      snapshot,
      currentUrl: snapshot?.url ?? session?.currentUrl ?? session?.startUrl
    });
    if (!safetyDecision.allowed) {
      sessionStore.appendAgentActivity?.(sessionId, {
        phase: "safety",
        kind: "logout-stage",
        status: "blocked",
        message: "Final logout action was blocked by safety policy.",
        details: {
          step: step ?? null,
          code: safetyDecision.code
        }
      });
      return {
        status: "skipped",
        reason: `Final-stage logout validation was skipped by safety policy (${safetyDecision.code}).`,
        beforeSnapshot: snapshot,
        afterSnapshot: snapshot,
        actionResult: null
      };
    }

    const actionResult = await browserSession.executeAction(logoutAction, snapshot);
    const afterSnapshot = await browserSession.capture(`functional-logout-final-${step}`, {
      includeUiuxSignals: false,
      includeFocusProbe: false
    });
    const probe = await browserSession.collectAuthFormProbe().catch(() => null);
    const authenticated = await browserSession.isAuthenticated().catch(() => false);

    const loggedOutByProbe = Boolean(
      probe?.loginWallDetected ||
      probe?.otpChallengeDetected ||
      probe?.identifierFieldDetected ||
      probe?.usernameFieldDetected ||
      probe?.passwordFieldDetected
    );
    const loggedOutByContent = /login|sign in|session expired|authentication required/i.test(
      String(afterSnapshot?.bodyText ?? "")
    );
    const loggedOut = !authenticated && (loggedOutByProbe || loggedOutByContent || isLikelyAuthUrl(afterSnapshot?.url));
    sessionStore.appendAgentActivity?.(sessionId, {
      phase: "auth",
      kind: "logout-stage",
      status: loggedOut ? "done" : "failed",
      message: loggedOut
        ? "Final logout stage confirmed authenticated session ended."
        : "Logout action executed but authenticated indicators still appear present.",
      details: {
        step: step ?? null,
        actionLabel: logoutAction.label,
        postUrl: afterSnapshot?.url ?? null,
        authenticatedAfterAction: Boolean(authenticated)
      }
    });

    sessionStore.patchSession(sessionId, {
      currentUrl: afterSnapshot.url,
      currentStep: step,
      frame: `data:image/png;base64,${afterSnapshot.screenshotBase64}`,
      artifactIndex: browserSession.getArtifactIndex()
    });

    return {
      status: loggedOut ? "passed" : "failed",
      reason: loggedOut
        ? "Final-stage logout validation confirmed session ended."
        : "Logout action executed but session still appears authenticated.",
      beforeSnapshot: snapshot,
      afterSnapshot,
      actionResult
    };
  }

  async run({
    session,
    runConfig,
    browserSession,
    sessionStore,
    sessionId,
    testCaseTracker = null,
    emit,
    emitSessionUpdate,
    sessionStartAt,
    shouldStop = null
  }) {
    throwIfRunStopped(shouldStop);
    const graph = new FunctionalFlowGraph();
    const assertionsConfig = runConfig.functional.assertions ?? {};
    const contractsConfig = runConfig.functional.contracts ?? {};
    const checkSelection = resolveFunctionalCheckSelection(runConfig.functional?.checkIds ?? []);
    const runHistory = [];
    const blockers = [];
    const blockerTimeline = [];
    const resumePoints = [];
    const flowResults = [];
    const functionalIssues = [];
    const contractAccumulator = createContractAccumulator();
    const docsAccumulator = createFunctionalDocsAccumulator(session.startUrl);
    const loginAssistSummary = {
      attempted: false,
      success: false,
      timeout: false,
      resumeStrategy: runConfig.functional?.loginAssist?.resumeStrategy ?? "restart-flow",
      profileTag: runConfig.profileTag ?? ""
    };
    let stepCounter = 1;

    let snapshot = await browserSession.capture("functional-start", {
      includeUiuxSignals: false,
      includeFocusProbe: false
    });
    captureContractSnapshot(contractAccumulator, snapshot);
    observeFunctionalDocsSnapshot(docsAccumulator, snapshot);
    observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(snapshot));
    let currentSemantics = extractFormSemantics(snapshot);
    graph.addSnapshot(snapshot);
    runHistory.push({ step: stepCounter, url: snapshot.url });
    sessionStore.patchSession(sessionId, {
      currentUrl: snapshot.url,
      currentStep: stepCounter,
      frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
      artifactIndex: browserSession.getArtifactIndex()
    });
    let flowEntryUrl =
      resolveFunctionalFlowEntryUrl([
        sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
        sessionStore.getSession(sessionId)?.loginAssist?.resumeTargetUrl,
        snapshot.url,
        session.currentUrl,
        session.startUrl
      ]) || session.startUrl;

    const initialGate = await this.gatekeeper.classify({
      goal: session.goal,
      snapshot,
      unchangedSteps: 0
    });
    let initialAuthProbe = await browserSession.collectAuthFormProbe().catch(() => null);
    const initialProbeAuthRequired = Boolean(
      initialAuthProbe &&
      probeHasCredentialEvidence(initialAuthProbe) &&
      probeShowsAuthRequired(initialAuthProbe)
    );
    const initialSnapshotAuthRequired = Boolean(
      !initialAuthProbe &&
      snapshotShowsCredentialLoginWall(snapshot)
    );
    if (initialProbeAuthRequired) {
      initialGate.pageState = "LOGIN_REQUIRED";
      initialGate.rationale =
        "Authentication wall detected from live auth probe. Awaiting dashboard credential/OTP assistance before functional flow continues.";
    } else if (initialSnapshotAuthRequired) {
      initialGate.pageState = "LOGIN_REQUIRED";
      initialGate.rationale =
        "Visible credential form detected. Awaiting dashboard credential/OTP assistance before functional flow continues.";
    } else if (initialGate.pageState === "LOGIN_REQUIRED" && initialAuthProbe) {
      initialGate.pageState = "READY";
      initialGate.rationale =
        "Gatekeeper reported login-required, but live auth probe found no credential wall evidence.";
    }
    if (initialGate.pageState === "LOGIN_REQUIRED") {
      const loginAssistEnabled = runConfig.functional?.loginAssist?.enabled !== false;
      if (!loginAssistEnabled) {
        this.appendFunctionalBlocker({
          blockers,
          blockerTimeline,
          blocker: {
            type: "LOGIN_ASSIST_DISABLED",
            confidence: 0.92,
            rationale: "Login assist is disabled for this functional run.",
            flowId: null,
            step: stepCounter
          },
          step: stepCounter,
          action: "manual-login",
          url: snapshot.url
        });
      } else {
        loginAssistSummary.attempted = true;
        const assistResult = await this.waitForManualLoginAssist({
          session,
          sessionId,
          browserSession,
          sessionStore,
          emitSessionUpdate,
          runConfig,
          step: stepCounter,
          flow: null,
          action: null,
          initialProbe: initialAuthProbe,
          shouldStop
        });

        if (assistResult.status === "resumed") {
          loginAssistSummary.success = true;
          resumePoints.push({
            step: stepCounter,
            flowId: null,
            blockerType: "LOGIN_REQUIRED",
            resumeStrategy: assistResult.resumeStrategy,
            action: "manual-login",
            url: assistResult.snapshot?.url ?? snapshot.url,
            timestamp: nowIso()
          });
          if (assistResult.resumeStrategy === "restart-flow") {
            const restartTargetUrl =
              resolveFunctionalFlowEntryUrl([
                sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
                sessionStore.getSession(sessionId)?.loginAssist?.resumeTargetUrl,
                assistResult.snapshot?.url,
                snapshot.url,
                flowEntryUrl,
                session.startUrl
              ]) || session.startUrl;
            flowEntryUrl = restartTargetUrl;
            await browserSession.goto(restartTargetUrl);
            snapshot = await browserSession.capture("functional-login-assist-initial-reset", {
              includeUiuxSignals: false,
              includeFocusProbe: false
            });
            captureContractSnapshot(contractAccumulator, snapshot);
            observeFunctionalDocsSnapshot(docsAccumulator, snapshot);
            observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(snapshot));
            currentSemantics = extractFormSemantics(snapshot);
            runHistory.push({ step: stepCounter, url: snapshot.url });
            sessionStore.patchSession(sessionId, {
              currentUrl: snapshot.url,
              currentStep: stepCounter,
              frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
              artifactIndex: browserSession.getArtifactIndex()
            });
            flowEntryUrl =
              resolveFunctionalFlowEntryUrl([
                sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
                snapshot.url,
                flowEntryUrl,
                session.startUrl
              ]) || flowEntryUrl;
          } else {
            snapshot = assistResult.snapshot ?? snapshot;
            currentSemantics = extractFormSemantics(snapshot);
            runHistory.push({ step: stepCounter, url: snapshot.url });
            flowEntryUrl =
              resolveFunctionalFlowEntryUrl([
                sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
                snapshot.url,
                flowEntryUrl,
                session.startUrl
              ]) || flowEntryUrl;
          }
        } else {
          if (assistResult.status === "timeout") {
            loginAssistSummary.timeout = true;
          }
          this.appendFunctionalBlocker({
            blockers,
            blockerTimeline,
            blocker: {
              type: assistResult.code,
              confidence: 0.92,
              rationale: assistResult.rationale,
              flowId: null,
              step: stepCounter
            },
            step: stepCounter,
            action: "manual-login",
            url: assistResult.snapshot?.url ?? snapshot.url
          });
        }
      }
    } else if (["CAPTCHA_BOT_DETECTED", "RATE_LIMITED", "REGION_RESTRICTED", "PAYMENT_REQUIRED", "PAYWALL"].includes(initialGate.pageState)) {
      this.appendFunctionalBlocker({
        blockers,
        blockerTimeline,
        blocker: {
          type: initialGate.pageState,
          confidence: initialGate.confidence ?? 0.9,
          rationale: initialGate.rationale ?? "Functional run encountered a blocking page state.",
          flowId: null,
          step: stepCounter
        },
        step: stepCounter,
        action: "initial-scan",
        url: snapshot.url
      });
    }

    if (!blockers.length) {
      const initialFormAssist = await this.waitForFormAssist({
        session,
        sessionId,
        browserSession,
        sessionStore,
        emitSessionUpdate,
        snapshot,
        step: stepCounter,
        flow: null,
        shouldStop
      });

      if (initialFormAssist.status === "timeout") {
        this.appendFunctionalBlocker({
          blockers,
          blockerTimeline,
          blocker: {
            type: initialFormAssist.code ?? "FORM_ASSIST_TIMEOUT",
            confidence: 0.94,
            rationale: initialFormAssist.rationale ?? "Form assist timed out.",
            flowId: null,
            step: stepCounter
          },
          step: stepCounter,
          action: "form-assist",
          url: snapshot.url
        });
      } else if (initialFormAssist.snapshot) {
        snapshot = initialFormAssist.snapshot;
        captureContractSnapshot(contractAccumulator, snapshot);
        observeFunctionalDocsSnapshot(docsAccumulator, snapshot);
        observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(snapshot));
        currentSemantics = extractFormSemantics(snapshot);
        runHistory.push({ step: stepCounter, url: snapshot.url });
        sessionStore.patchSession(sessionId, {
          currentUrl: snapshot.url,
          currentStep: stepCounter,
          frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
          artifactIndex: browserSession.getArtifactIndex()
        });
      }
    }

    const discoveredFlows = discoverFlowCandidates({
      snapshot,
      runConfig,
      formSemantics: currentSemantics
    }).slice(0, runConfig.functional.maxFlows);
    const flows = filterFlowCandidatesBySelection(discoveredFlows, checkSelection);
    const shouldRunFinalLogoutStage = checkSelection.selectionActive
      ? checkSelection.selectedCheckIds.includes("LOGOUT_ENDS_SESSION")
      : false;
    const flowRestartCounts = new Map();

    for (let flowIndex = 0; flowIndex < flows.length; ) {
      throwIfRunStopped(shouldStop);
      if (blockers.length) {
        break;
      }
      const flow = flows[flowIndex];
      const flowCase = startFunctionalTestCase(testCaseTracker, {
        type: "functional",
        pageUrl: snapshot.url,
        canonicalUrl: safeCanonical(snapshot.url),
        deviceLabel: snapshot.viewportLabel ?? "desktop",
        caseKind: "FLOW_EXECUTION",
        expected: `Flow ${flow.flowId} should complete without blockers or assertion failures.`
      });
      const elapsedMs = Date.now() - sessionStartAt;
      if (elapsedMs > runConfig.budgets.timeBudgetMs) {
        this.appendFunctionalBlocker({
          blockers,
          blockerTimeline,
          blocker: {
            type: "TIME_BUDGET_REACHED",
            confidence: 0.78,
            rationale: "Functional runner reached the configured time budget.",
            flowId: flow.flowId,
            step: stepCounter
          },
          step: stepCounter,
          action: "budget-check",
          url: snapshot.url
        });
        failFunctionalTestCase(testCaseTracker, flowCase, {
          severity: "P2",
          actual: "Flow skipped because functional time budget was reached.",
          pageUrl: snapshot.url,
          canonicalUrl: safeCanonical(snapshot.url),
          deviceLabel: snapshot.viewportLabel ?? "desktop",
          evidenceRefs: buildEvidenceRefs(snapshot)
        });
        break;
      }

      flowEntryUrl =
        resolveFunctionalFlowEntryUrl([
          sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
          sessionStore.getSession(sessionId)?.loginAssist?.resumeTargetUrl,
          flowEntryUrl,
          snapshot.url,
          session.startUrl
        ]) || flowEntryUrl;
      if (flowEntryUrl && snapshot.url !== flowEntryUrl) {
        await browserSession.goto(flowEntryUrl);
        snapshot = await browserSession.capture(`functional-flow-reset-${flow.flowId}`, {
          includeUiuxSignals: false,
          includeFocusProbe: false
        });
        captureContractSnapshot(contractAccumulator, snapshot);
        observeFunctionalDocsSnapshot(docsAccumulator, snapshot);
        observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(snapshot));
        currentSemantics = extractFormSemantics(snapshot);
        graph.addSnapshot(snapshot);
        runHistory.push({ step: stepCounter, url: snapshot.url });
        sessionStore.patchSession(sessionId, {
          currentUrl: snapshot.url,
          currentStep: stepCounter,
          frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
          artifactIndex: browserSession.getArtifactIndex()
        });
        flowEntryUrl =
          resolveFunctionalFlowEntryUrl([
            sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
            snapshot.url,
            flowEntryUrl,
            session.startUrl
          ]) || flowEntryUrl;
      }

      const flowBaselineSnapshot = snapshot;
      const flowAssertions = [];
      let flowBlocked = false;
      let restartFlow = false;
      let stepsExecuted = 0;

      for (const action of flow.actions.slice(0, runConfig.functional.maxStepsPerFlow)) {
        throwIfRunStopped(shouldStop);
        if (stepsExecuted >= runConfig.functional.maxStepsPerFlow) {
          break;
        }
        stepsExecuted += 1;
        stepCounter += 1;
        const stepEvidenceBeforeAction = buildEvidenceRefs(snapshot);
        const flowStepCase = startFunctionalTestCase(testCaseTracker, {
          type: "functional",
          pageUrl: snapshot.url,
          canonicalUrl: safeCanonical(snapshot.url),
          deviceLabel: snapshot.viewportLabel ?? "desktop",
          caseKind: "FLOW_STEP",
          selector: action.selector ?? null,
          expected: `Flow step ${stepCounter} (${action.functionalKind ?? action.type}) should execute safely and satisfy assertions.`
        });
        sessionStore.appendAgentActivity?.(sessionId, {
          phase: "flow-selection",
          kind: "next-action",
          status: "planned",
          message: `About to execute ${action.functionalKind ?? action.type} action "${action.label ?? action.type}".`,
          details: {
            flowId: flow.flowId,
            step: stepCounter,
            actionType: action.type,
            selector: action.selector ?? null,
            reason: "Next deterministic step in selected functionality flow."
          }
        });

        if (isLogoutLikeAction(action)) {
          sessionStore.appendTimeline?.(sessionId, {
            type: "functional-logout-guard",
            message: "Logout/sign-out action was blocked during authenticated exploration and deferred to final logout stage."
          });
          sessionStore.appendAgentActivity?.(sessionId, {
            phase: "safety",
            kind: "logout-guard",
            status: "blocked",
            message: "Blocked potential logout/sign-out action during normal exploration.",
            details: {
              flowId: flow.flowId,
              step: stepCounter,
              actionLabel: action.label ?? null,
              selector: action.selector ?? null,
              reason: "reserved_for_final_logout_stage"
            }
          });
          const currentAuthAssist = sessionStore.getSession(sessionId)?.authAssist ?? null;
          if (currentAuthAssist && typeof currentAuthAssist === "object") {
            sessionStore.patchSession(sessionId, {
              authAssist: {
                ...currentAuthAssist,
                runtime: {
                  ...(currentAuthAssist.runtime ?? {}),
                  logoutScheduled: shouldRunFinalLogoutStage,
                  logoutExecuted: false,
                  whyLogoutBlocked: "reserved_for_final_logout_stage",
                  currentFunctionalPhase: "authenticated"
                }
              }
            });
          }
          completeFunctionalTestCase(testCaseTracker, flowStepCase, {
            status: "skipped",
            severity: "P3",
            actual: "Logout actions are deferred until the explicit final logout stage.",
            selector: action.selector ?? null,
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            evidenceRefs: stepEvidenceBeforeAction
          });
          continue;
        }

        const safetyDecision = this.safetyPolicy.evaluateBeforeAction({
          runConfig,
          actionPlan: actionPlanFromAction(action),
          snapshot,
          currentUrl: snapshot.url
        });
        if (!safetyDecision.allowed) {
          sessionStore.appendAgentActivity?.(sessionId, {
            phase: "safety",
            kind: "action-blocked",
            status: "blocked",
            message: `Blocked action "${action.label ?? action.type}" by safety policy.`,
            details: {
              flowId: flow.flowId,
              step: stepCounter,
              code: safetyDecision.code,
              reason: safetyDecision.reason
            }
          });
          this.appendFunctionalBlocker({
            blockers,
            blockerTimeline,
            blocker: {
              type: safetyDecision.code,
              confidence: 0.95,
              rationale: safetyDecision.reason,
              flowId: flow.flowId,
              step: stepCounter
            },
            step: stepCounter,
            action: action.type,
            url: snapshot.url
          });
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: "P2",
            actual: safetyDecision.reason,
            selector: action.selector ?? null,
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            evidenceRefs: stepEvidenceBeforeAction
          });
          flowBlocked = true;
          break;
        }

        const submitGate = evaluateFunctionalSubmitGate({
          action,
          runConfig,
          semantics: currentSemantics,
          safetyAllowed: safetyDecision.allowed
        });
        if (!submitGate.allowed) {
          this.appendFunctionalBlocker({
            blockers,
            blockerTimeline,
            blocker: {
              type: submitGate.code,
              confidence: submitGate.confidence ?? 0.93,
              rationale: submitGate.reason,
              flowId: flow.flowId,
              step: stepCounter
            },
            step: stepCounter,
            action: action.type,
            url: snapshot.url
          });
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: "P2",
            actual: submitGate.reason,
            selector: action.selector ?? null,
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            evidenceRefs: stepEvidenceBeforeAction
          });
          flowBlocked = true;
          break;
        }

        const actionTarget = (snapshot.interactive ?? []).find((item) => item.elementId === action.elementId) ?? null;
        if (String(actionTarget?.type ?? "").toLowerCase() === "file") {
          const uploadDecision = evaluateUploadCapability({
            runConfig,
            target: actionTarget
          });
          if (!uploadDecision.allowed) {
            this.appendFunctionalBlocker({
              blockers,
              blockerTimeline,
              blocker: {
                type: uploadDecision.blockerType ?? "UPLOAD_REQUIRED",
                confidence: uploadDecision.confidence ?? 0.9,
                rationale: uploadDecision.reason,
                flowId: flow.flowId,
                step: stepCounter,
                resolutionHint: uploadDecision.resolutionHint
              },
              step: stepCounter,
              action: action.type,
              url: snapshot.url
            });
            failFunctionalTestCase(testCaseTracker, flowStepCase, {
              severity: "P2",
              actual: uploadDecision.reason,
              selector: action.selector ?? null,
              pageUrl: snapshot.url,
              canonicalUrl: safeCanonical(snapshot.url),
              deviceLabel: snapshot.viewportLabel ?? "desktop",
              evidenceRefs: stepEvidenceBeforeAction
            });
            flowBlocked = true;
            break;
          }
        }

        let nextSnapshot = snapshot;
        let actionResult = null;
        try {
          actionResult = await browserSession.executeAction(action, snapshot);
          nextSnapshot = await browserSession.capture(`functional-${flow.flowId}-${stepCounter}`, {
            includeUiuxSignals: false,
            includeFocusProbe: false
          });
          captureContractSnapshot(contractAccumulator, nextSnapshot);
          observeFunctionalDocsSnapshot(docsAccumulator, nextSnapshot);
          observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(nextSnapshot));
        } catch (error) {
          if (/UPLOAD_REQUIRED/i.test(error?.message ?? "")) {
            this.appendFunctionalBlocker({
              blockers,
              blockerTimeline,
              blocker: {
                type: "UPLOAD_REQUIRED",
                confidence: 0.92,
                rationale: error?.message ?? "Upload required but not allowed.",
                flowId: flow.flowId,
                step: stepCounter
              },
              step: stepCounter,
              action: action.type,
              url: snapshot.url
            });
            failFunctionalTestCase(testCaseTracker, flowStepCase, {
              severity: "P2",
              actual: error?.message ?? "Upload required but not allowed.",
              selector: action.selector ?? null,
              pageUrl: snapshot.url,
              canonicalUrl: safeCanonical(snapshot.url),
              deviceLabel: snapshot.viewportLabel ?? "desktop",
              evidenceRefs: stepEvidenceBeforeAction
            });
            flowBlocked = true;
            break;
          }
          const issue = {
            issueType: "FUNCTIONAL_ACTION_EXECUTION_FAILED",
            severity: "P1",
            title: "Functional action failed to execute",
            expected: `Action ${action.type} should execute successfully.`,
            actual: error?.message ?? "Unknown execution error.",
            confidence: 0.9,
            evidenceRefs: buildEvidenceRefs(snapshot),
            affectedSelector: action.selector ?? null,
            affectedUrl: snapshot.url,
            flowId: flow.flowId,
            flowType: flow.flowType,
            assertionId: "ACTION_EXECUTION",
            step: stepCounter,
            viewportLabel: snapshot.viewportLabel ?? "desktop",
            repro: {
              viewportLabel: snapshot.viewportLabel ?? "desktop",
              step: stepCounter,
              url: snapshot.url,
              canonicalUrl: safeCanonical(snapshot.url),
              targetSelector: action.selector ?? null,
              actionContext: {
                actionType: action.type,
                functionalKind: action.functionalKind ?? null,
                label: action.label ?? null
              },
              evidenceRefs: buildEvidenceRefs(snapshot)
            }
          };
          functionalIssues.push(issue);
          flowAssertions.push({
            ruleId: "ACTION_EXECUTION",
            pass: false,
            expected: issue.expected,
            actual: issue.actual,
            confidence: issue.confidence,
            severity: issue.severity,
            evidenceRefs: issue.evidenceRefs
          });
          const actionExecutionCase = startFunctionalTestCase(testCaseTracker, {
            type: "functional",
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            caseKind: "ASSERTION",
            ruleId: "ACTION_EXECUTION",
            selector: action.selector ?? null,
            expected: issue.expected
          });
          failFunctionalTestCase(testCaseTracker, actionExecutionCase, {
            severity: issue.severity,
            actual: issue.actual,
            selector: action.selector ?? null,
            ruleId: "ACTION_EXECUTION",
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            evidenceRefs: issue.evidenceRefs
          });
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: issue.severity,
            actual: issue.actual,
            selector: action.selector ?? null,
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            evidenceRefs: issue.evidenceRefs
          });
          snapshot = nextSnapshot;
          sessionStore.patchSession(sessionId, {
            currentUrl: snapshot.url,
            currentStep: stepCounter,
            frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
            artifactIndex: browserSession.getArtifactIndex()
          });
          continue;
        }

        graph.addTransition({
          fromSnapshot: snapshot,
          toSnapshot: nextSnapshot,
          actionType: action.type,
          selector: action.selector ?? null,
          label: action.label ?? null
        });

        for (const signal of actionResult?.progressSignals ?? []) {
          if (signal.startsWith("new-tab-opened:")) {
            this.appendFunctionalEvent({
              blockerTimeline,
              step: stepCounter,
              blockerType: "NEW_TAB_OPENED",
              action: action.type,
              url: signal.slice("new-tab-opened:".length) || nextSnapshot.url
            });
            sessionStore.appendObservation(sessionId, {
              step: stepCounter,
              openedNewTab: true,
              newTabUrl: signal.slice("new-tab-opened:".length) || nextSnapshot.url,
              actionType: action.type
            });
          } else if (signal === "popup-blocked") {
            this.appendFunctionalEvent({
              blockerTimeline,
              step: stepCounter,
              blockerType: "POPUP_BLOCKED",
              action: action.type,
              url: nextSnapshot.url
            });
          } else if (signal.startsWith("download-triggered:")) {
            this.appendFunctionalEvent({
              blockerTimeline,
              step: stepCounter,
              blockerType: "DOWNLOAD_TRIGGERED",
              action: action.type,
              url: nextSnapshot.url
            });
          }
        }

        const gate = await this.gatekeeper.classify({
          goal: session.goal,
          snapshot: nextSnapshot,
          unchangedSteps: 0
        });
        let gateAuthProbe = await browserSession.collectAuthFormProbe().catch(() => null);
        const gateProbeAuthRequired = Boolean(
          gateAuthProbe &&
          probeHasCredentialEvidence(gateAuthProbe) &&
          probeShowsAuthRequired(gateAuthProbe)
        );
        const gateSnapshotAuthRequired = Boolean(
          !gateAuthProbe &&
          snapshotShowsCredentialLoginWall(nextSnapshot)
        );
        if (gateProbeAuthRequired) {
          gate.pageState = "LOGIN_REQUIRED";
          gate.rationale =
            "Authentication wall detected from live auth probe. Awaiting dashboard credentials/OTP before flow continuation.";
        } else if (gateSnapshotAuthRequired) {
          gate.pageState = "LOGIN_REQUIRED";
          gate.rationale =
            "Visible credential form detected. Awaiting dashboard credential/OTP assistance before functional flow continues.";
        } else if (gate.pageState === "LOGIN_REQUIRED" && gateAuthProbe) {
          gate.pageState = "READY";
          gate.rationale =
            "Gatekeeper reported login-required, but live auth probe found no credential wall evidence.";
        }
        if (gate.pageState === "CONSENT_REQUIRED") {
          const consentTarget = (nextSnapshot.interactive ?? [])
            .filter((item) => !item.disabled && item.inViewport)
            .find((item) =>
              /accept|agree|allow|dismiss|reject|close|continue/.test(
                [item.text, item.ariaLabel, item.placeholder].join(" ").toLowerCase()
              )
            );
          if (consentTarget) {
            const consentAction = {
              type: "click",
              elementId: consentTarget.elementId,
              functionalKind: "navigation",
              selector: consentTarget.selector ?? null,
              label: consentTarget.text || consentTarget.ariaLabel || "Consent action"
            };
            const consentSafety = this.safetyPolicy.evaluateBeforeAction({
              runConfig,
              actionPlan: actionPlanFromAction(consentAction),
              snapshot: nextSnapshot,
              currentUrl: nextSnapshot.url
            });
            if (consentSafety.allowed) {
              await browserSession.executeAction(consentAction, nextSnapshot);
              nextSnapshot = await browserSession.capture(`functional-consent-${flow.flowId}-${stepCounter}`, {
                includeUiuxSignals: false,
                includeFocusProbe: false
              });
              captureContractSnapshot(contractAccumulator, nextSnapshot);
              observeFunctionalDocsSnapshot(docsAccumulator, nextSnapshot);
              observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(nextSnapshot));
              this.appendFunctionalEvent({
                blockerTimeline,
                step: stepCounter,
                blockerType: "CONSENT_REQUIRED",
                action: "auto-dismiss-consent",
                url: nextSnapshot.url
              });
            } else {
              this.appendFunctionalBlocker({
                blockers,
                blockerTimeline,
                blocker: {
                  type: "CONSENT_REQUIRED",
                  confidence: 0.86,
                  rationale: "Consent overlay detected but safe auto-dismiss was blocked by safety policy.",
                  flowId: flow.flowId,
                  step: stepCounter
                },
                step: stepCounter,
                action: action.type,
                url: nextSnapshot.url
              });
              failFunctionalTestCase(testCaseTracker, flowStepCase, {
                severity: "P2",
                actual: "Consent overlay detected but safe auto-dismiss was blocked by safety policy.",
                selector: action.selector ?? null,
                pageUrl: nextSnapshot.url,
                canonicalUrl: safeCanonical(nextSnapshot.url),
                deviceLabel: nextSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
                evidenceRefs: buildEvidenceRefs(nextSnapshot)
              });
              flowBlocked = true;
              break;
            }
          } else {
            this.appendFunctionalBlocker({
              blockers,
              blockerTimeline,
              blocker: {
                type: "CONSENT_REQUIRED",
                confidence: 0.84,
                rationale: "Consent overlay detected without a safe dismiss action.",
                flowId: flow.flowId,
                step: stepCounter
              },
              step: stepCounter,
              action: action.type,
              url: nextSnapshot.url
            });
            failFunctionalTestCase(testCaseTracker, flowStepCase, {
              severity: "P2",
              actual: "Consent overlay detected without a safe dismiss action.",
              selector: action.selector ?? null,
              pageUrl: nextSnapshot.url,
              canonicalUrl: safeCanonical(nextSnapshot.url),
              deviceLabel: nextSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
              evidenceRefs: buildEvidenceRefs(nextSnapshot)
            });
            flowBlocked = true;
            break;
          }
        }
        const authChallengeDetected = AUTH_CHALLENGE_PATTERN.test(nextSnapshot.bodyText ?? "");
        if (authChallengeDetected) {
          const loginAssistEnabled = runConfig.functional?.loginAssist?.enabled !== false;
          if (loginAssistEnabled) {
            gate.pageState = "LOGIN_REQUIRED";
            gate.rationale =
              "Authentication challenge detected (password reset, verification code, or 2FA). Awaiting dashboard credentials/OTP.";
          } else {
            this.appendFunctionalBlocker({
              blockers,
              blockerTimeline,
              blocker: {
                type: "AUTH_CHALLENGE_DETECTED",
                confidence: 0.93,
                rationale:
                  "Authentication challenge (password reset, verification code, or 2FA) detected. Functional runner stops safely.",
                flowId: flow.flowId,
                step: stepCounter
              },
              step: stepCounter,
              action: action.type,
              url: nextSnapshot.url
            });
            snapshot = nextSnapshot;
            currentSemantics = extractFormSemantics(snapshot);
            flowBlocked = true;
            failFunctionalTestCase(testCaseTracker, flowStepCase, {
              severity: "P1",
              actual: "Authentication challenge detected; flow stopped safely.",
              selector: action.selector ?? null,
              pageUrl: snapshot.url,
              canonicalUrl: safeCanonical(snapshot.url),
              deviceLabel: snapshot.viewportLabel ?? "desktop",
              evidenceRefs: buildEvidenceRefs(snapshot)
            });
            sessionStore.patchSession(sessionId, {
              currentUrl: snapshot.url,
              currentStep: stepCounter,
              frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
              artifactIndex: browserSession.getArtifactIndex()
            });
            break;
          }
        }
        if (gate.pageState === "LOGIN_REQUIRED") {
          const loginAssistEnabled = runConfig.functional?.loginAssist?.enabled !== false;
          if (!loginAssistEnabled) {
            this.appendFunctionalBlocker({
              blockers,
              blockerTimeline,
              blocker: {
                type: "LOGIN_ASSIST_DISABLED",
                confidence: 0.9,
                rationale: "Login assist is disabled for this functional run.",
                flowId: flow.flowId,
                step: stepCounter
              },
              step: stepCounter,
              action: "manual-login",
              url: nextSnapshot.url
            });
            failFunctionalTestCase(testCaseTracker, flowStepCase, {
              severity: "P2",
              actual: "Login assist is disabled for this functional run.",
              selector: action.selector ?? null,
              pageUrl: nextSnapshot.url,
              canonicalUrl: safeCanonical(nextSnapshot.url),
              deviceLabel: nextSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
              evidenceRefs: buildEvidenceRefs(nextSnapshot)
            });
            flowBlocked = true;
            break;
          }

          loginAssistSummary.attempted = true;
          const assistResult = await this.waitForManualLoginAssist({
            session,
            sessionId,
            browserSession,
            sessionStore,
            emitSessionUpdate,
            runConfig,
            step: stepCounter,
            flow,
            action,
            initialProbe: gateAuthProbe,
            shouldStop
          });
          snapshot = assistResult.snapshot ?? nextSnapshot;
          currentSemantics = extractFormSemantics(snapshot);
          runHistory.push({ step: stepCounter, url: snapshot.url });

          if (assistResult.status === "resumed") {
            loginAssistSummary.success = true;
            resumePoints.push({
              step: stepCounter,
              flowId: flow.flowId,
              blockerType: "LOGIN_REQUIRED",
              resumeStrategy: assistResult.resumeStrategy,
              action: "manual-login",
              url: snapshot.url,
              timestamp: nowIso()
            });

            if (assistResult.resumeStrategy === "restart-flow") {
              const restartCount = (flowRestartCounts.get(flow.flowId) ?? 0) + 1;
              flowRestartCounts.set(flow.flowId, restartCount);
              if (restartCount > 2) {
                this.appendFunctionalBlocker({
                  blockers,
                  blockerTimeline,
                  blocker: {
                    type: "LOGIN_ASSIST_RETRY_LIMIT",
                    confidence: 0.84,
                    rationale: "Login assist succeeded but flow restart retry limit was reached.",
                    flowId: flow.flowId,
                    step: stepCounter
                  },
                  step: stepCounter,
                  action: "manual-login",
                  url: snapshot.url
                });
                failFunctionalTestCase(testCaseTracker, flowStepCase, {
                  severity: "P2",
                  actual: "Login assist retry limit reached for flow restart.",
                  selector: action.selector ?? null,
                  pageUrl: snapshot.url,
                  canonicalUrl: safeCanonical(snapshot.url),
                  deviceLabel: snapshot.viewportLabel ?? "desktop",
                  evidenceRefs: buildEvidenceRefs(snapshot)
                });
                flowBlocked = true;
                break;
              }
              const restartTargetUrl =
                resolveFunctionalFlowEntryUrl([
                  sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
                  sessionStore.getSession(sessionId)?.loginAssist?.resumeTargetUrl,
                  assistResult.snapshot?.url,
                  snapshot.url,
                  flowEntryUrl,
                  session.startUrl
                ]) || flowEntryUrl || session.startUrl;
              flowEntryUrl = restartTargetUrl;
              await browserSession.goto(restartTargetUrl);
              snapshot = await browserSession.capture(`functional-flow-restart-${flow.flowId}-${stepCounter}`, {
                includeUiuxSignals: false,
                includeFocusProbe: false
              });
              captureContractSnapshot(contractAccumulator, snapshot);
              observeFunctionalDocsSnapshot(docsAccumulator, snapshot);
              observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(snapshot));
              currentSemantics = extractFormSemantics(snapshot);
              runHistory.push({ step: stepCounter, url: snapshot.url });
              sessionStore.patchSession(sessionId, {
                currentUrl: snapshot.url,
                currentStep: stepCounter,
                frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
                artifactIndex: browserSession.getArtifactIndex()
              });
              flowEntryUrl =
                resolveFunctionalFlowEntryUrl([
                  sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
                  snapshot.url,
                  flowEntryUrl,
                  session.startUrl
                ]) || flowEntryUrl;
              restartFlow = true;
              completeFunctionalTestCase(testCaseTracker, flowStepCase, {
                status: "skipped",
                severity: "P3",
                actual: "Step deferred because flow restarted after successful login assist.",
                selector: action.selector ?? null,
                pageUrl: snapshot.url,
                canonicalUrl: safeCanonical(snapshot.url),
                deviceLabel: snapshot.viewportLabel ?? "desktop",
                evidenceRefs: buildEvidenceRefs(snapshot)
              });
              break;
            }

            sessionStore.patchSession(sessionId, {
              currentUrl: snapshot.url,
              currentStep: stepCounter,
              frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
              artifactIndex: browserSession.getArtifactIndex()
            });
            flowEntryUrl =
              resolveFunctionalFlowEntryUrl([
                sessionStore.getSession(sessionId)?.authAssist?.resumeTargetUrl,
                snapshot.url,
                flowEntryUrl,
                session.startUrl
              ]) || flowEntryUrl;
            completeFunctionalTestCase(testCaseTracker, flowStepCase, {
              status: "passed",
              actual: "Manual login assist succeeded and flow continued safely.",
              selector: action.selector ?? null,
              pageUrl: snapshot.url,
              canonicalUrl: safeCanonical(snapshot.url),
              deviceLabel: snapshot.viewportLabel ?? "desktop",
              evidenceRefs: buildEvidenceRefs(snapshot)
            });
            continue;
          }

          if (assistResult.status === "timeout") {
            loginAssistSummary.timeout = true;
          }
          this.appendFunctionalBlocker({
            blockers,
            blockerTimeline,
            blocker: {
              type: assistResult.code,
              confidence: 0.9,
              rationale: assistResult.rationale,
              flowId: flow.flowId,
              step: stepCounter
            },
            step: stepCounter,
            action: "manual-login",
            url: snapshot.url
          });
          flowBlocked = true;
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: "P2",
            actual: assistResult.rationale,
            selector: action.selector ?? null,
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            evidenceRefs: buildEvidenceRefs(snapshot)
          });
          sessionStore.patchSession(sessionId, {
            currentUrl: snapshot.url,
            currentStep: stepCounter,
            frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
            artifactIndex: browserSession.getArtifactIndex()
          });
          break;
        }
        if (FUNCTIONAL_BLOCKER_STATES.has(gate.pageState)) {
          this.appendFunctionalBlocker({
            blockers,
            blockerTimeline,
            blocker: {
              type: gate.pageState,
              confidence: gate.confidence ?? 0.9,
              rationale: gate.rationale ?? "Functional flow encountered a blocking state.",
              flowId: flow.flowId,
              step: stepCounter
            },
            step: stepCounter,
            action: action.type,
            url: nextSnapshot.url
          });
          snapshot = nextSnapshot;
          currentSemantics = extractFormSemantics(snapshot);
          flowBlocked = true;
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: "P2",
            actual: gate.rationale ?? "Functional flow encountered a blocking state.",
            selector: action.selector ?? null,
            pageUrl: snapshot.url,
            canonicalUrl: safeCanonical(snapshot.url),
            deviceLabel: snapshot.viewportLabel ?? "desktop",
            evidenceRefs: buildEvidenceRefs(snapshot)
          });
          sessionStore.patchSession(sessionId, {
            currentUrl: snapshot.url,
            currentStep: stepCounter,
            frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
            artifactIndex: browserSession.getArtifactIndex()
          });
          break;
        }

        const formAssistResult = await this.waitForFormAssist({
          session,
          sessionId,
          browserSession,
          sessionStore,
          emitSessionUpdate,
          snapshot: nextSnapshot,
          step: stepCounter,
          flow,
          shouldStop
        });
        if (formAssistResult.status === "timeout") {
          this.appendFunctionalBlocker({
            blockers,
            blockerTimeline,
            blocker: {
              type: formAssistResult.code ?? "FORM_ASSIST_TIMEOUT",
              confidence: 0.94,
              rationale: formAssistResult.rationale ?? "Form assist timed out before user decision.",
              flowId: flow.flowId,
              step: stepCounter
            },
            step: stepCounter,
            action: "form-assist",
            url: nextSnapshot.url
          });
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: "P2",
            actual: formAssistResult.rationale ?? "Form assist timed out before user decision.",
            selector: action.selector ?? null,
            pageUrl: nextSnapshot.url,
            canonicalUrl: safeCanonical(nextSnapshot.url),
            deviceLabel: nextSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
            evidenceRefs: buildEvidenceRefs(nextSnapshot)
          });
          flowBlocked = true;
          break;
        }
        if (formAssistResult.snapshot) {
          nextSnapshot = formAssistResult.snapshot;
          captureContractSnapshot(contractAccumulator, nextSnapshot);
          observeFunctionalDocsSnapshot(docsAccumulator, nextSnapshot);
          observeFunctionalDocsForms(docsAccumulator, deriveFunctionalFormGroups(nextSnapshot));
        }

        const evidenceRefs = buildEvidenceRefs(nextSnapshot);
        const evaluatedAssertions = evaluateCoreFunctionalRules({
          beforeSnapshot: snapshot,
          afterSnapshot: nextSnapshot,
          action,
          actionResult,
          runHistory,
          flowBaselineSnapshot,
          assertionsConfig,
          contractsConfig,
          evidenceRefs,
          allowedRuleIds: checkSelection.selectionActive ? checkSelection.allowedRuleIds : null
        });
        const verificationResolution = await this.waitForVerificationAssist({
          sessionId,
          sessionStore,
          emitSessionUpdate,
          snapshot: nextSnapshot,
          step: stepCounter,
          flow,
          assertionResults: evaluatedAssertions,
          shouldStop
        });
        docsAccumulator.verificationPrompts += Number(verificationResolution.prompted ?? 0);
        docsAccumulator.verificationOverrides += Number(verificationResolution.overrides ?? 0);
        if (verificationResolution.timedOut) {
          this.appendFunctionalBlocker({
            blockers,
            blockerTimeline,
            blocker: {
              type: "VERIFICATION_CONFIRMATION_TIMEOUT",
              confidence: 0.95,
              rationale: "Verification confirmation timed out before user decision.",
              flowId: flow.flowId,
              step: stepCounter
            },
            step: stepCounter,
            action: action.type,
            url: nextSnapshot.url
          });
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: "P2",
            actual: "Verification confirmation timed out before user decision.",
            selector: action.selector ?? null,
            pageUrl: nextSnapshot.url,
            canonicalUrl: safeCanonical(nextSnapshot.url),
            deviceLabel: nextSnapshot.viewportLabel ?? "desktop",
            evidenceRefs
          });
          flowBlocked = true;
          break;
        }

        const assertionResults = verificationResolution.resolvedAssertions ?? evaluatedAssertions;
        flowAssertions.push(...assertionResults);

        for (const assertion of assertionResults) {
          const assertionCase = startFunctionalTestCase(testCaseTracker, {
            type: "functional",
            pageUrl: nextSnapshot.url,
            canonicalUrl: safeCanonical(nextSnapshot.url),
            deviceLabel: nextSnapshot.viewportLabel ?? "desktop",
            caseKind: "ASSERTION",
            ruleId: assertion.ruleId ?? null,
            selector: action.selector ?? null,
            expected: assertion.expected
          });
          if (assertion.pass) {
            completeFunctionalTestCase(testCaseTracker, assertionCase, {
              status: "passed",
              actual: assertion.actual,
              selector: action.selector ?? null,
              ruleId: assertion.ruleId ?? null,
              pageUrl: nextSnapshot.url,
              canonicalUrl: safeCanonical(nextSnapshot.url),
              deviceLabel: nextSnapshot.viewportLabel ?? "desktop",
              evidenceRefs: assertion.evidenceRefs ?? evidenceRefs
            });
          } else {
            failFunctionalTestCase(testCaseTracker, assertionCase, {
              severity: assertion.severity ?? "P2",
              actual: assertion.actual,
              selector: action.selector ?? null,
              ruleId: assertion.ruleId ?? null,
              pageUrl: nextSnapshot.url,
              canonicalUrl: safeCanonical(nextSnapshot.url),
              deviceLabel: nextSnapshot.viewportLabel ?? "desktop",
              evidenceRefs: assertion.evidenceRefs ?? evidenceRefs
            });
          }
        }

        for (const assertion of assertionResults.filter((item) => !item.pass)) {
          functionalIssues.push(
            buildIssue({
              assertion,
              flow,
              step: stepCounter,
              snapshot: nextSnapshot,
              action
            })
          );
        }

        const failedAssertionsForStep = assertionResults.filter((item) => !item.pass);
        if (failedAssertionsForStep.length > 0) {
          const highestSeverity = failedAssertionsForStep
            .map((item) => item.severity ?? "P2")
            .sort((left, right) => severityRank(left) - severityRank(right))[0];
          failFunctionalTestCase(testCaseTracker, flowStepCase, {
            severity: highestSeverity ?? "P2",
            actual: `Step produced ${failedAssertionsForStep.length} failing assertion(s).`,
            selector: action.selector ?? null,
            pageUrl: nextSnapshot.url,
            canonicalUrl: safeCanonical(nextSnapshot.url),
            deviceLabel: nextSnapshot.viewportLabel ?? "desktop",
            evidenceRefs
          });
        } else {
          completeFunctionalTestCase(testCaseTracker, flowStepCase, {
            status: "passed",
            actual: `Step passed ${assertionResults.length} assertion(s).`,
            selector: action.selector ?? null,
            pageUrl: nextSnapshot.url,
            canonicalUrl: safeCanonical(nextSnapshot.url),
            deviceLabel: nextSnapshot.viewportLabel ?? "desktop",
            evidenceRefs
          });
        }

        snapshot = nextSnapshot;
        currentSemantics = extractFormSemantics(snapshot);
        runHistory.push({ step: stepCounter, url: snapshot.url });
        sessionStore.patchSession(sessionId, {
          currentUrl: snapshot.url,
          currentStep: stepCounter,
          frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
          artifactIndex: browserSession.getArtifactIndex()
        });
      }

      if (restartFlow) {
        completeFunctionalTestCase(testCaseTracker, flowCase, {
          status: "skipped",
          severity: "P3",
          actual: `Flow ${flow.flowId} restarted after login assist.`,
          pageUrl: snapshot.url,
          canonicalUrl: safeCanonical(snapshot.url),
          deviceLabel: snapshot.viewportLabel ?? "desktop",
          evidenceRefs: buildEvidenceRefs(snapshot)
        });
        continue;
      }

      const assertionFailures = flowAssertions.filter((item) => !item.pass).length;
      const assertionPasses = flowAssertions.filter((item) => item.pass).length;

      flowResults.push({
        flowId: flow.flowId,
        flowType: flow.flowType,
        label: flow.label,
        stepsExecuted,
        assertionFailures,
        assertionPasses,
        blocked: flowBlocked
      });

      if (flowBlocked || assertionFailures > 0) {
        const topIssue = functionalIssues.find((issue) => issue.flowId === flow.flowId) ?? null;
        failFunctionalTestCase(testCaseTracker, flowCase, {
          severity: topIssue?.severity ?? "P2",
          actual: flowBlocked
            ? `Flow ${flow.flowId} blocked after ${stepsExecuted} step(s).`
            : `Flow ${flow.flowId} has ${assertionFailures} failing assertion(s).`,
          pageUrl: snapshot.url,
          canonicalUrl: safeCanonical(snapshot.url),
          deviceLabel: snapshot.viewportLabel ?? "desktop",
          evidenceRefs: topIssue?.evidenceRefs ?? buildEvidenceRefs(snapshot)
        });
      } else {
        completeFunctionalTestCase(testCaseTracker, flowCase, {
          status: "passed",
          actual: `Flow ${flow.flowId} passed with ${assertionPasses} assertions.`,
          pageUrl: snapshot.url,
          canonicalUrl: safeCanonical(snapshot.url),
          deviceLabel: snapshot.viewportLabel ?? "desktop",
          evidenceRefs: buildEvidenceRefs(snapshot)
        });
      }

      emit?.("functional.flow.completed", {
        sessionId,
        flowId: flow.flowId,
        label: flow.label,
        stepsExecuted,
        assertionFailures,
        blocked: flowBlocked
      });
      emitSessionUpdate?.();

      if (flowBlocked) {
        break;
      }
      flowIndex += 1;
    }

    if (!blockers.length && shouldRunFinalLogoutStage) {
      const currentAuthAssist = sessionStore.getSession(sessionId)?.authAssist ?? null;
      if (currentAuthAssist && typeof currentAuthAssist === "object") {
        sessionStore.patchSession(sessionId, {
          authAssist: {
            ...currentAuthAssist,
            runtime: {
              ...(currentAuthAssist.runtime ?? {}),
              currentFunctionalPhase: "final_logout",
              logoutScheduled: true,
              logoutExecuted: false
            }
          }
        });
      }
      stepCounter += 1;
      const logoutCase = startFunctionalTestCase(testCaseTracker, {
        type: "functional",
        pageUrl: snapshot.url,
        canonicalUrl: safeCanonical(snapshot.url),
        deviceLabel: snapshot.viewportLabel ?? "desktop",
        caseKind: "ASSERTION",
        ruleId: "LOGOUT_ENDS_SESSION",
        expected: "Logout should terminate the authenticated session after authenticated checks complete."
      });
      const logoutStage = await this.runFinalLogoutStage({
        session,
        sessionId,
        runConfig,
        browserSession,
        sessionStore,
        snapshot,
        step: stepCounter,
        shouldStop
      });
      const logoutSnapshot = logoutStage.afterSnapshot ?? snapshot;
      const logoutEvidence = buildEvidenceRefs(logoutSnapshot);
      flowResults.push({
        flowId: "logout-final",
        flowType: "LOGOUT_FINAL_STAGE",
        label: "Final logout validation",
        stepsExecuted: logoutStage.status === "skipped" ? 0 : 1,
        assertionFailures: logoutStage.status === "failed" ? 1 : 0,
        assertionPasses: logoutStage.status === "passed" ? 1 : 0,
        blocked: false
      });

      if (logoutStage.status === "passed") {
        completeFunctionalTestCase(testCaseTracker, logoutCase, {
          status: "passed",
          actual: logoutStage.reason,
          ruleId: "LOGOUT_ENDS_SESSION",
          pageUrl: logoutSnapshot.url,
          canonicalUrl: safeCanonical(logoutSnapshot.url),
          deviceLabel: logoutSnapshot.viewportLabel ?? "desktop",
          evidenceRefs: logoutEvidence
        });
      } else if (logoutStage.status === "skipped") {
        completeFunctionalTestCase(testCaseTracker, logoutCase, {
          status: "skipped",
          severity: "P3",
          actual: logoutStage.reason,
          ruleId: "LOGOUT_ENDS_SESSION",
          pageUrl: logoutSnapshot.url ?? snapshot.url,
          canonicalUrl: safeCanonical(logoutSnapshot.url ?? snapshot.url),
          deviceLabel: logoutSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
          evidenceRefs: logoutEvidence
        });
      } else {
        const logoutIssue = {
          issueType: "FUNCTIONAL_ASSERTION_FAILED",
          severity: "P2",
          title: "LOGOUT_ENDS_SESSION",
          expected: "Logout should terminate the authenticated session after authenticated checks complete.",
          actual: logoutStage.reason,
          confidence: 0.86,
          evidenceRefs: logoutEvidence,
          affectedSelector: null,
          affectedUrl: logoutSnapshot.url ?? snapshot.url,
          flowId: "logout-final",
          flowType: "LOGOUT_FINAL_STAGE",
          assertionId: "LOGOUT_ENDS_SESSION",
          step: stepCounter,
          viewportLabel: logoutSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
          repro: {
            viewportLabel: logoutSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
            step: stepCounter,
            url: logoutSnapshot.url ?? snapshot.url,
            canonicalUrl: safeCanonical(logoutSnapshot.url ?? snapshot.url),
            targetSelector: null,
            actionContext: {
              actionType: "click",
              functionalKind: "logout",
              label: "Logout"
            },
            evidenceRefs: logoutEvidence
          }
        };
        functionalIssues.push(logoutIssue);
        failFunctionalTestCase(testCaseTracker, logoutCase, {
          severity: "P2",
          actual: logoutStage.reason,
          ruleId: "LOGOUT_ENDS_SESSION",
          pageUrl: logoutSnapshot.url ?? snapshot.url,
          canonicalUrl: safeCanonical(logoutSnapshot.url ?? snapshot.url),
          deviceLabel: logoutSnapshot.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
          evidenceRefs: logoutEvidence
        });
      }

      sessionStore.appendTimeline?.(sessionId, {
        type: "functional-logout-stage",
        message: logoutStage.reason
      });
      const postLogoutAuthAssist = sessionStore.getSession(sessionId)?.authAssist ?? null;
      if (postLogoutAuthAssist && typeof postLogoutAuthAssist === "object") {
        sessionStore.patchSession(sessionId, {
          authAssist: {
            ...postLogoutAuthAssist,
            runtime: {
              ...(postLogoutAuthAssist.runtime ?? {}),
              currentFunctionalPhase: "final_logout",
              logoutScheduled: true,
              logoutExecuted: logoutStage.status !== "skipped"
            }
          }
        });
      }
      snapshot = logoutSnapshot;
      currentSemantics = extractFormSemantics(snapshot);
      runHistory.push({ step: stepCounter, url: snapshot.url });
    }

    const contractSummary = finalizeContractSummary(contractAccumulator, runConfig, functionalIssues);
    const websiteDocumentation = formatWebsiteDocumentation({
      session,
      flows: flowResults,
      issues: functionalIssues,
      blockers,
      loginAssist: loginAssistSummary,
      contractSummary,
      docsAccumulator
    });

    const aggregated = aggregateFunctionalRunnerResult({
      flows: flowResults,
      issues: functionalIssues,
      blockers,
      blockerTimeline,
      resumePoints,
      loginAssist: loginAssistSummary,
      contractSummary,
      websiteDocumentation
    });

    return {
      ...aggregated,
      graph: graph.toJSON(),
      status: blockers.length ? "soft-passed" : functionalIssues.length ? "failed" : "passed"
    };
  }
}
