import { config } from "../../lib/config.js";
import { nowIso, sleep } from "../../lib/utils.js";
import { canonicalizeUrl } from "../../library/url/urlFrontier.js";
import { getBlockerResolutionHint, toFunctionalBlocker } from "./blockerTaxonomy.js";
import { evaluateUploadCapability } from "./capabilityPolicy.js";
import { FunctionalFlowGraph } from "./flowGraph.js";
import { discoverFlowCandidates } from "./flowDiscovery.js";
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
  const refs = [{ type: "screenshot", ref: snapshot.screenshotUrl ?? snapshot.screenshotPath }];
  const domArtifacts = snapshot.artifacts?.dom ?? [];
  const a11yArtifacts = snapshot.artifacts?.a11y ?? [];
  const dom = domArtifacts.at(-1);
  const a11y = a11yArtifacts.at(-1);
  if (dom?.url) {
    refs.push({ type: "dom", ref: dom.url });
  }
  if (a11y?.url) {
    refs.push({ type: "a11y", ref: a11y.url });
  }
  return refs;
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

export function aggregateFunctionalRunnerResult({
  flows = [],
  issues = [],
  blockers = [],
  blockerTimeline = [],
  resumePoints = [],
  loginAssist = null,
  contractSummary = null
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
    }
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
        pageUrl: browserSession.page?.url?.() ?? session.currentUrl ?? session.startUrl,
        loginRequired: true,
        form: {
          usernameFieldDetected: false,
          passwordFieldDetected: false,
          otpFieldDetected: false,
          submitControlDetected: false
        },
        startedAt: nowIso(),
        timeoutMs,
        remainingMs: timeoutMs,
        profileTag: runConfig.profileTag ?? "",
        source: "probe",
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
            form: {
              usernameFieldDetected: Boolean(probe.usernameFieldDetected),
              passwordFieldDetected: Boolean(probe.passwordFieldDetected),
              otpFieldDetected: Boolean(probe.otpFieldDetected),
              submitControlDetected: Boolean(probe.submitControlDetected)
            },
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
          form: {
            usernameFieldDetected: Boolean(probe.usernameFieldDetected),
            passwordFieldDetected: Boolean(probe.passwordFieldDetected),
            otpFieldDetected: Boolean(probe.otpFieldDetected),
            submitControlDetected: Boolean(probe.submitControlDetected)
          },
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
            form: {
              usernameFieldDetected: Boolean(probe.usernameFieldDetected),
              passwordFieldDetected: Boolean(probe.passwordFieldDetected),
              otpFieldDetected: Boolean(probe.otpFieldDetected),
              submitControlDetected: Boolean(probe.submitControlDetected)
            },
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
            form: {
              usernameFieldDetected: Boolean(probe.usernameFieldDetected),
              passwordFieldDetected: Boolean(probe.passwordFieldDetected),
              otpFieldDetected: Boolean(probe.otpFieldDetected),
              submitControlDetected: Boolean(probe.submitControlDetected)
            },
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
            form: {
              usernameFieldDetected: Boolean(probe.usernameFieldDetected),
              passwordFieldDetected: Boolean(probe.passwordFieldDetected),
              otpFieldDetected: Boolean(probe.otpFieldDetected),
              submitControlDetected: Boolean(probe.submitControlDetected)
            },
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
    const runHistory = [];
    const blockers = [];
    const blockerTimeline = [];
    const resumePoints = [];
    const flowResults = [];
    const functionalIssues = [];
    const contractAccumulator = createContractAccumulator();
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
    let currentSemantics = extractFormSemantics(snapshot);
    graph.addSnapshot(snapshot);
    runHistory.push({ step: stepCounter, url: snapshot.url });
    sessionStore.patchSession(sessionId, {
      currentUrl: snapshot.url,
      currentStep: stepCounter,
      frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
      artifactIndex: browserSession.getArtifactIndex()
    });

    const initialGate = await this.gatekeeper.classify({
      goal: session.goal,
      snapshot,
      unchangedSteps: 0
    });
    if (initialGate.pageState === "LOGIN_REQUIRED") {
      const loginAssistEnabled = runConfig.functional?.loginAssist?.enabled !== false;
      if (!loginAssistEnabled || config.headless) {
        this.appendFunctionalBlocker({
          blockers,
          blockerTimeline,
          blocker: {
            type: loginAssistEnabled ? "LOGIN_ASSIST_HEADLESS_UNSUPPORTED" : "LOGIN_ASSIST_DISABLED",
            confidence: 0.92,
            rationale: loginAssistEnabled
              ? "Manual login assist requires PLAYWRIGHT_HEADLESS=false."
              : "Login assist is disabled for this functional run.",
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
            await browserSession.goto(session.startUrl);
            snapshot = await browserSession.capture("functional-login-assist-initial-reset", {
              includeUiuxSignals: false,
              includeFocusProbe: false
            });
            captureContractSnapshot(contractAccumulator, snapshot);
            currentSemantics = extractFormSemantics(snapshot);
            runHistory.push({ step: stepCounter, url: snapshot.url });
            sessionStore.patchSession(sessionId, {
              currentUrl: snapshot.url,
              currentStep: stepCounter,
              frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
              artifactIndex: browserSession.getArtifactIndex()
            });
          } else {
            snapshot = assistResult.snapshot ?? snapshot;
            currentSemantics = extractFormSemantics(snapshot);
            runHistory.push({ step: stepCounter, url: snapshot.url });
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

    const flows = discoverFlowCandidates({
      snapshot,
      runConfig,
      formSemantics: currentSemantics
    }).slice(0, runConfig.functional.maxFlows);
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

      if (snapshot.url !== session.startUrl) {
        await browserSession.goto(session.startUrl);
        snapshot = await browserSession.capture(`functional-flow-reset-${flow.flowId}`, {
          includeUiuxSignals: false,
          includeFocusProbe: false
        });
        captureContractSnapshot(contractAccumulator, snapshot);
        currentSemantics = extractFormSemantics(snapshot);
        graph.addSnapshot(snapshot);
        runHistory.push({ step: stepCounter, url: snapshot.url });
        sessionStore.patchSession(sessionId, {
          currentUrl: snapshot.url,
          currentStep: stepCounter,
          frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
          artifactIndex: browserSession.getArtifactIndex()
        });
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

        const safetyDecision = this.safetyPolicy.evaluateBeforeAction({
          runConfig,
          actionPlan: actionPlanFromAction(action),
          snapshot,
          currentUrl: snapshot.url
        });
        if (!safetyDecision.allowed) {
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
          if (loginAssistEnabled && !config.headless) {
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
          if (!loginAssistEnabled || config.headless) {
            this.appendFunctionalBlocker({
              blockers,
              blockerTimeline,
              blocker: {
                type: loginAssistEnabled ? "LOGIN_ASSIST_HEADLESS_UNSUPPORTED" : "LOGIN_ASSIST_DISABLED",
                confidence: 0.9,
                rationale: loginAssistEnabled
                  ? "Manual login assist requires PLAYWRIGHT_HEADLESS=false."
                  : "Login assist is disabled for this functional run.",
                flowId: flow.flowId,
                step: stepCounter
              },
              step: stepCounter,
              action: "manual-login",
              url: nextSnapshot.url
            });
            failFunctionalTestCase(testCaseTracker, flowStepCase, {
              severity: "P2",
              actual: loginAssistEnabled
                ? "Manual login assist requires PLAYWRIGHT_HEADLESS=false."
                : "Login assist is disabled for this functional run.",
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
              await browserSession.goto(session.startUrl);
              snapshot = await browserSession.capture(`functional-flow-restart-${flow.flowId}-${stepCounter}`, {
                includeUiuxSignals: false,
                includeFocusProbe: false
              });
              captureContractSnapshot(contractAccumulator, snapshot);
              currentSemantics = extractFormSemantics(snapshot);
              runHistory.push({ step: stepCounter, url: snapshot.url });
              sessionStore.patchSession(sessionId, {
                currentUrl: snapshot.url,
                currentStep: stepCounter,
                frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
                artifactIndex: browserSession.getArtifactIndex()
              });
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

        const evidenceRefs = buildEvidenceRefs(nextSnapshot);
        const assertionResults = evaluateCoreFunctionalRules({
          beforeSnapshot: snapshot,
          afterSnapshot: nextSnapshot,
          action,
          actionResult,
          runHistory,
          flowBaselineSnapshot,
          assertionsConfig,
          contractsConfig,
          evidenceRefs
        });
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

    const aggregated = aggregateFunctionalRunnerResult({
      flows: flowResults,
      issues: functionalIssues,
      blockers,
      blockerTimeline,
      resumePoints,
      loginAssist: loginAssistSummary,
      contractSummary: finalizeContractSummary(contractAccumulator, runConfig, functionalIssues)
    });

    return {
      ...aggregated,
      graph: graph.toJSON(),
      status: blockers.length ? "soft-passed" : functionalIssues.length ? "failed" : "passed"
    };
  }
}
