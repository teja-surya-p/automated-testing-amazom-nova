import { config } from "../lib/config.js";
import { nowIso, sleep } from "../lib/utils.js";
import { canonicalizeUrl } from "../services/urlFrontier.js";
import { getBlockerResolutionHint, toFunctionalBlocker } from "./blockerTaxonomy.js";
import { evaluateUploadCapability } from "./capabilityPolicy.js";
import { FunctionalFlowGraph } from "./flowGraph.js";
import { discoverFlowCandidates } from "./flowDiscovery.js";
import { extractFormSemantics } from "./formSemantics.js";
import { evaluateCoreFunctionalRules } from "./assertions/coreRules.js";
import {
  decideLoginAssistTransition,
  detectNonLoginUrlWithAuthMarkers
} from "./loginAssistState.js";
import { evaluateFunctionalSubmitGate } from "./submitGating.js";

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

function severityRank(level = "P2") {
  return {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3
  }[level] ?? 9;
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

  return {
    flows,
    flowsRun: flows.length,
    issues: issuesSorted,
    blockers: blockersSorted,
    summary: blockersSorted.length
      ? `Functional run ended early due to blocker ${blockersSorted[0].type}.`
      : issuesSorted.length
        ? `Functional run completed with ${issuesSorted.length} failing assertions.`
        : "Functional smoke-pack passed with no assertion failures.",
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
    action
  }) {
    const loginAssistConfig = runConfig?.functional?.loginAssist ?? {};
    const timeoutMs = loginAssistConfig.timeoutMs ?? 180_000;
    const resumeStrategy = loginAssistConfig.resumeStrategy ?? "restart-flow";
    const startedAt = Date.now();
    const domain = session.profile?.domain ?? new URL(session.startUrl).hostname;

    sessionStore.patchSession(sessionId, {
      status: "login-assist",
      loginAssist: {
        state: "WAIT_FOR_USER",
        domain,
        startedAt: nowIso(),
        timeoutMs,
        resumeStrategy,
        hint: "Please log in manually in the controlled browser window."
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
      message: "Please log in manually in the controlled browser window."
    });
    emitSessionUpdate?.();

    let latestSnapshot = await browserSession.capture(`functional-login-assist-${step}-start`, {
      includeUiuxSignals: false,
      includeFocusProbe: false
    });

    while (true) {
      const elapsedMs = Date.now() - startedAt;
      const authenticated = await browserSession.isAuthenticated();
      const nonLoginAuthMarker = detectNonLoginUrlWithAuthMarkers(latestSnapshot);
      const gate = await this.gatekeeper.classify({
        goal: session.goal,
        snapshot: latestSnapshot,
        unchangedSteps: 0
      });
      const decision = decideLoginAssistTransition({
        enabled: loginAssistConfig.enabled !== false,
        headless: config.headless,
        elapsedMs,
        timeoutMs,
        authenticated,
        nonLoginAuthMarker,
        captchaDetected: gate.pageState === "CAPTCHA_BOT_DETECTED"
      });

      sessionStore.patchSession(sessionId, {
        currentUrl: latestSnapshot.url,
        currentStep: step,
        frame: `data:image/png;base64,${latestSnapshot.screenshotBase64}`,
        artifactIndex: browserSession.getArtifactIndex(),
        loginAssist: {
          state: "WAIT_FOR_USER",
          domain,
          startedAt: sessionStore.getSession(sessionId)?.loginAssist?.startedAt ?? nowIso(),
          timeoutMs,
          resumeStrategy,
          remainingMs: Math.max(timeoutMs - elapsedMs, 0),
          hint: "Please log in manually in the controlled browser window."
        }
      });
      emitSessionUpdate?.();

      if (decision.outcome === "RESUME") {
        await browserSession.persistStorageState();
        sessionStore.patchSession(sessionId, {
          status: "running",
          loginAssist: {
            state: "AUTH_VALIDATED",
            domain,
            resumedAt: nowIso(),
            timeoutMs,
            resumeStrategy
          }
        });
        emitSessionUpdate?.();
        return {
          status: "resumed",
          code: decision.code,
          rationale: decision.reason,
          snapshot: latestSnapshot,
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
          }
        });
        emitSessionUpdate?.();
        return {
          status: "timeout",
          code: decision.code,
          rationale: decision.reason,
          snapshot: latestSnapshot,
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
          }
        });
        emitSessionUpdate?.();
        return {
          status: "blocked",
          code: decision.code,
          rationale: decision.reason,
          snapshot: latestSnapshot,
          resumeStrategy
        };
      }

      await sleep(config.loginAssistPollMs);
      latestSnapshot = await browserSession.capture(`functional-login-assist-${step}-poll`, {
        includeUiuxSignals: false,
        includeFocusProbe: false
      });
    }
  }

  async run({
    session,
    runConfig,
    browserSession,
    sessionStore,
    sessionId,
    emit,
    emitSessionUpdate,
    sessionStartAt
  }) {
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
          action: null
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
      if (blockers.length) {
        break;
      }
      const flow = flows[flowIndex];
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
        if (stepsExecuted >= runConfig.functional.maxStepsPerFlow) {
          break;
        }
        stepsExecuted += 1;
        stepCounter += 1;

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
            flowBlocked = true;
            break;
          }
        }
        if (AUTH_CHALLENGE_PATTERN.test(nextSnapshot.bodyText ?? "")) {
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
          sessionStore.patchSession(sessionId, {
            currentUrl: snapshot.url,
            currentStep: stepCounter,
            frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
            artifactIndex: browserSession.getArtifactIndex()
          });
          break;
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
            action
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
              break;
            }

            sessionStore.patchSession(sessionId, {
              currentUrl: snapshot.url,
              currentStep: stepCounter,
              frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
              artifactIndex: browserSession.getArtifactIndex()
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
