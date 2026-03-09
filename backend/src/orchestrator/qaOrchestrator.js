import { config } from "../lib/config.js";
import { A11yRunner } from "../types/accessibility/a11yRunner.js";
import { hashText, nowIso, pickLast, sleep } from "../lib/utils.js";
import { validateOrRepairActionPlan } from "../library/schemas/actionContract.js";
import { TestCaseTracker } from "../library/reporting/testCaseTracker.js";
import { BrowserSession } from "../services/browserSession.js";
import { EventBus } from "../services/eventBus.js";
import { FunctionalRunner } from "../types/functional/functionalRunner.js";
import { resolveFunctionalProfilePolicy } from "../types/functional/profilePolicy.js";
import { Gatekeeper } from "../services/gatekeeper.js";
import { ProfileManager } from "../services/profileManager.js";
import { RingBuffer } from "../services/ringBuffer.js";
import { buildRunReport } from "../services/reportBuilder.js";
import { SafetyPolicy } from "../library/policies/safetyPolicy.js";
import { chooseBestUiuxCandidate, classifyUiuxAction } from "../library/policies/uiControlClassifier.js";
import { UrlFrontier } from "../library/url/urlFrontier.js";
import { resolveSkillPack } from "../skills/index.js";
import { decideUiuxPaymentWall } from "../types/uiux/paymentWallPolicy.js";
import { UiuxRunner } from "../types/uiux/uiuxRunner.js";
import { baselineUiuxChecks } from "../types/uiux/checks/index.js";
import { baselineA11yRules } from "../types/accessibility/rules/index.js";
import {
  estimateUiuxPlannedCases,
  planUiuxCasesForPage,
  selectUiuxSafeInteractionCandidates
} from "../types/uiux/uiuxCasePlanner.js";
import { buildUiuxEffectiveBudget } from "../types/uiux/budget.js";
import {
  computeUiuxArtifactRetentionPlan,
  removePrunedArtifactFiles,
  resolveUiuxArtifactRetention
} from "../types/uiux/artifactRetention.js";
import {
  matchViewportLabel,
  resolveUiuxViewports,
  selectViewportSweepCandidates
} from "../types/uiux/viewportSweep.js";
import { resolveUiuxDeviceProfiles } from "../types/uiux/deviceMatrix.js";
import { ReportSummarizer } from "../services/reportSummarizer.js";
import {
  deriveAuthAssistStateFromProbe as deriveAuthAssistState,
  isAuthAssistSkipRequested,
  isAuthAssistReadyToResume,
  mergeDerivedAuthAssistState
} from "../services/authAssistState.js";

function summarizeSemanticAction(snapshot, action) {
  const target = snapshot.interactive.find((item) => item.elementId === action?.elementId) ?? null;
  if (!target) {
    return null;
  }

  return {
    elementId: target.elementId,
    label: target.text || target.ariaLabel || target.placeholder || target.name || target.id || target.tag,
    zone: target.zone,
    landmark: target.landmark,
    center: [Math.round(target.bounds.centerX), Math.round(target.bounds.centerY)]
  };
}

function deriveParsedGoal(goal) {
  const match = goal.match(/["“”'‘’]([^"“”'‘’]{1,120})["“”'‘’]/);
  return {
    rawGoal: goal,
    searchIntent: match?.[1]?.trim() ?? "",
    conciseGoal: goal
  };
}

function isSubscriptionGoal(goal) {
  return /(premium|subscription|upgrade|plan|trial|pricing)/i.test(goal);
}

function isCrawlerGoal(goal) {
  return /(crawler|crawl|coverage|explore hidden|discover issues|bounded exploration|systematic exploration)/i.test(
    goal
  );
}

function buildLandmarkSignature(snapshot) {
  return hashText(
    JSON.stringify(
      (snapshot.semanticMap ?? []).slice(0, 24).map((item) => ({
        text: item.text,
        landmark: item.landmark,
        zone: item.zone
      }))
    )
  );
}

function buildObservation(snapshot) {
  return {
    url: snapshot.url,
    domHash: snapshot.hash,
    screenshotId: snapshot.screenshotUrl ?? snapshot.screenshotPath,
    semanticMapId: `semantic:${snapshot.step}`,
    consoleErrors: snapshot.consoleErrors ?? [],
    networkSummary: snapshot.networkSummary ?? {}
  };
}

function buildGraphNode(snapshot) {
  return {
    nodeId: hashText(`${snapshot.url}:${snapshot.hash}`),
    url: snapshot.url,
    domHash: snapshot.hash,
    landmarkSignature: buildLandmarkSignature(snapshot)
  };
}

function buildGraphEdge(fromNode, toNode, actionSummary, targetSignature) {
  return {
    edgeId: hashText(`${fromNode.nodeId}:${toNode.nodeId}:${actionSummary}:${targetSignature}`),
    fromNodeId: fromNode.nodeId,
    toNodeId: toNode.nodeId,
    actionSummary,
    targetElementSignature: targetSignature
  };
}

function buildEvidenceRefs(snapshot, frames = []) {
  const refs = [
    {
      type: "screenshot",
      ref: snapshot.screenshotUrl ?? snapshot.screenshotPath,
      ...(snapshot.screenshotCaptureMode ? { captureMode: snapshot.screenshotCaptureMode } : {}),
      ...(snapshot.viewportWidth && snapshot.viewportHeight
        ? {
            viewport: {
              width: snapshot.viewportWidth,
              height: snapshot.viewportHeight
            }
          }
        : {})
    },
    { type: "semantic-map", ref: `semantic:${snapshot.step}` }
  ];

  for (const frame of pickLast(frames, 3)) {
    refs.push({
      type: "screenshot",
      ref: frame.screenshotUrl ?? frame.screenshotPath,
      ...(frame.screenshotCaptureMode ? { captureMode: frame.screenshotCaptureMode } : {}),
      ...(frame.viewportWidth && frame.viewportHeight
        ? {
            viewport: {
              width: frame.viewportWidth,
              height: frame.viewportHeight
            }
          }
        : {})
    });
  }

  return refs;
}

function ensureScreenshotEvidenceRefs(primary = [], fallback = []) {
  const merged = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(fallback) ? fallback : [])]
    .filter((entry) => entry?.ref);
  const hasScreenshot = merged.some((entry) => entry.type === "screenshot");
  if (hasScreenshot) {
    return merged;
  }
  const fallbackScreenshot = (fallback ?? []).find((entry) => entry?.type === "screenshot" && entry.ref);
  if (fallbackScreenshot) {
    return [...merged, fallbackScreenshot];
  }
  return merged;
}

function summarizeIncidentTitle(type) {
  return type
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function verificationMatched(check, snapshot) {
  const normalizedCheck = check.toLowerCase();
  const body = snapshot.bodyText.toLowerCase();
  if (/premium options page visible/.test(normalizedCheck)) {
    return /premium|individual|family|student|trial|plan/i.test(snapshot.bodyText);
  }
  if (/payment wall or plan cards visible/.test(normalizedCheck)) {
    return /payment|billing|plan|trial|subscribe|get premium/i.test(snapshot.bodyText);
  }
  if (/video playback page visible/.test(normalizedCheck)) {
    return /youtube\.com\/watch|youtu\.be\//i.test(snapshot.url);
  }
  if (/checkout page visible/.test(normalizedCheck)) {
    return /checkout/i.test(snapshot.url) || /review order|shipping address|complete the order/i.test(snapshot.bodyText);
  }
  if (/order result visible/.test(normalizedCheck)) {
    return /order placed|invoice approved|thanks for your order|purchase complete/i.test(snapshot.bodyText);
  }
  if (/account created state visible/.test(normalizedCheck)) {
    return /account created|registration complete|profile is ready|welcome,/i.test(snapshot.bodyText);
  }

  return body.includes(normalizedCheck);
}

function validatePostConditions(preSnapshot, postSnapshot, verificationChecks = []) {
  const matchedChecks = verificationChecks.filter((check) => verificationMatched(check, postSnapshot));
  const urlChangedMeaningfully = preSnapshot.url !== postSnapshot.url;
  const domChanged = preSnapshot.hash !== postSnapshot.hash;
  const landmarkChanged = buildLandmarkSignature(preSnapshot) !== buildLandmarkSignature(postSnapshot);
  const expectedMarkerAppeared = matchedChecks.length > 0;

  return {
    urlChangedMeaningfully,
    domChanged,
    landmarkChanged,
    expectedMarkerAppeared,
    matchedChecks,
    changed: urlChangedMeaningfully || domChanged || landmarkChanged || expectedMarkerAppeared
  };
}

function buildRunSummary(session) {
  return {
    outcome:
      session.status === "passed"
        ? "PASS"
        : session.status === "soft-passed"
          ? "SOFT-PASS"
          : session.status === "cancelled"
            ? "STOPPED"
            : session.status === "failed"
              ? "FAIL"
              : null,
    primaryBlocker: session.primaryBlocker ?? null,
    nextBestAction: session.outcome?.nextBestAction ?? null,
    evidenceQualityScore: session.outcome?.evidenceQualityScore ?? 0,
    targetAchieved: Boolean(session.outcome?.targetAchieved)
  };
}

function signatureForElement(element) {
  return hashText(`${element.tag}:${element.text}:${element.zone}:${element.landmark}`);
}

function isUiuxMode(runConfig) {
  return (
    runConfig?.testMode === "uiux" ||
    (runConfig?.testMode === "default" && runConfig?.exploration?.strategy === "coverage-driven")
  );
}

function isAccessibilityMode(runConfig) {
  return runConfig?.testMode === "accessibility";
}

function isCoverageMode(runConfig) {
  return isUiuxMode(runConfig) || isAccessibilityMode(runConfig);
}

function isFunctionalMode(runConfig) {
  return runConfig?.testMode === "functional";
}

function normalizeIssueSeverity(severity) {
  return severity ?? "P2";
}

function countIndexedArtifacts(artifactIndex = {}) {
  return Object.values(artifactIndex).reduce((count, value) => {
    if (!value) {
      return count;
    }
    if (Array.isArray(value)) {
      return count + value.length;
    }
    return count + 1;
  }, 0);
}

function severityRank(level = "P3") {
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

function sortDeviceSummary(entries = []) {
  return [...entries].sort((left, right) => {
    const severityDiff = severityRank(left.worstSeverity) - severityRank(right.worstSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    if ((right.totalChecksFailed ?? 0) !== (left.totalChecksFailed ?? 0)) {
      return (right.totalChecksFailed ?? 0) - (left.totalChecksFailed ?? 0);
    }
    return String(left.deviceLabel).localeCompare(String(right.deviceLabel));
  });
}

function isTerminalStatus(status = "") {
  return ["passed", "failed", "soft-passed", "cancelled"].includes(status);
}

class RunStopRequestedError extends Error {
  constructor(message = "Run stop requested by user.") {
    super(message);
    this.name = "RunStopRequestedError";
    this.code = "RUN_STOPPED";
  }
}

function isRunStopRequestedError(error) {
  return error instanceof RunStopRequestedError || error?.code === "RUN_STOPPED";
}

function isLikelyAuthUrl(url = "") {
  return /\/(login|sign[-_]?in|auth|verify|otp|two[-_]?factor)\b/i.test(String(url));
}

function resolveFirstCredentialAlias(credentials = {}) {
  const aliases = [
    credentials?.identifier,
    credentials?.accessKey,
    credentials?.access_key,
    credentials?.username,
    credentials?.email,
    credentials?.loginId,
    credentials?.login_id,
    credentials?.accountId,
    credentials?.account_id,
    credentials?.userId,
    credentials?.user_id
  ];

  for (const alias of aliases) {
    const normalized = String(alias ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export class QaOrchestrator {
  constructor({ eventBus, sessionStore, explorerProvider, auditorProvider, documentarianProvider }) {
    this.eventBus = eventBus ?? new EventBus();
    this.sessionStore = sessionStore;
    this.explorerProvider = explorerProvider;
    this.auditorProvider = auditorProvider;
    this.documentarianProvider = documentarianProvider;
    this.profileManager = new ProfileManager();
    this.gatekeeper = new Gatekeeper({ auditorProvider });
    this.safetyPolicy = new SafetyPolicy();
    this.functionalRunner = new FunctionalRunner({
      safetyPolicy: this.safetyPolicy,
      gatekeeper: this.gatekeeper
    });
    this.reportSummarizer = new ReportSummarizer();
    this.pendingSummaryJobs = new Map();
    this.activeRuns = new Map();
    this.activeRunControls = new Map();
    this.activeBrowserSessions = new Map();
    this.authSubmissionLocks = new Set();
    this.testCaseTrackers = new Map();
  }

  getTestCaseTracker(sessionId) {
    if (!sessionId) {
      return null;
    }
    if (!this.testCaseTrackers.has(sessionId)) {
      this.testCaseTrackers.set(
        sessionId,
        new TestCaseTracker({
          sessionId,
          sessionStore: this.sessionStore,
          emit: this.emit.bind(this)
        })
      );
    }
    return this.testCaseTrackers.get(sessionId) ?? null;
  }

  releaseTestCaseTracker(sessionId) {
    if (!sessionId) {
      return;
    }
    this.testCaseTrackers.delete(sessionId);
  }

  ensureRunControl(sessionId) {
    if (!sessionId) {
      return null;
    }
    if (!this.activeRunControls.has(sessionId)) {
      this.activeRunControls.set(sessionId, {
        stopRequested: false,
        stopReason: null,
        stopRequestedAt: null
      });
    }
    return this.activeRunControls.get(sessionId);
  }

  clearRunControl(sessionId) {
    if (!sessionId) {
      return;
    }
    this.activeRunControls.delete(sessionId);
  }

  isStopRequested(sessionId) {
    const control = this.activeRunControls.get(sessionId);
    return Boolean(control?.stopRequested);
  }

  throwIfStopRequested(sessionId) {
    if (!this.isStopRequested(sessionId)) {
      return;
    }
    const control = this.activeRunControls.get(sessionId);
    throw new RunStopRequestedError(control?.stopReason ?? "Run stop requested by user.");
  }

  resolveResumeTargetUrl(sessionId, fallbackUrl = "") {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return fallbackUrl || "";
    }

    const candidateUrls = [
      session?.authAssist?.resumeTargetUrl ?? "",
      session?.loginAssist?.resumeTargetUrl ?? "",
      fallbackUrl ?? "",
      session?.currentUrl ?? "",
      session?.startUrl ?? ""
    ];

    const recentObservationUrls = [...(session?.observations ?? [])]
      .slice(-20)
      .reverse()
      .map((entry) => entry?.url ?? "")
      .filter(Boolean);
    candidateUrls.push(...recentObservationUrls);

    for (const value of candidateUrls) {
      const url = String(value ?? "").trim();
      if (!url) {
        continue;
      }
      if (!/^https?:/i.test(url)) {
        continue;
      }
      if (!isLikelyAuthUrl(url)) {
        return url;
      }
    }

    return String(session?.startUrl ?? fallbackUrl ?? "").trim();
  }

  buildEffectiveBudgets(runConfig = {}) {
    const generic = {
      timeBudgetMs: runConfig?.budgets?.timeBudgetMs ?? null,
      maxSteps: runConfig?.budgets?.maxSteps ?? null,
      stagnationLimit: runConfig?.budgets?.stagnationLimit ?? null,
      actionRetryCount: runConfig?.budgets?.actionRetryCount ?? null
    };

    if (!isUiuxMode(runConfig)) {
      return { generic };
    }

    const uiuxBudget = buildUiuxEffectiveBudget({ runConfig });
    const deviceCount = resolveUiuxDeviceProfiles(runConfig).length;
    return {
      generic,
      uiux: {
        ...uiuxBudget,
        deviceCount
      }
    };
  }

  buildQueuedSummary(runConfig = {}, effectiveBudgets = {}) {
    if (!isUiuxMode(runConfig)) {
      return `Queued ${runConfig?.testMode ?? "default"} run.`;
    }
    const uiuxBudget = effectiveBudgets?.uiux ?? {};
    return `Queued UI/UX run with timeBudgetMs=${uiuxBudget.timeBudgetMs ?? "n/a"}, maxPages=${uiuxBudget.maxPages ?? "n/a"}, maxInteractionsPerPage=${uiuxBudget.maxInteractionsPerPage ?? "n/a"}, devices=${uiuxBudget.deviceCount ?? "n/a"}.`;
  }

  async start({ runConfig }) {
    const functionalProfilePolicy = resolveFunctionalProfilePolicy({ runConfig });
    if (!functionalProfilePolicy.ok) {
      throw new Error(functionalProfilePolicy.errorMessage);
    }

    const profile = this.profileManager.resolveProfile({
      startUrl: runConfig.startUrl,
      goal: runConfig.goal,
      userProvidedTag: runConfig.profileTag
    });
    if (!functionalProfilePolicy.storageStateEnabled) {
      profile.storageStatePath = "";
    }
    const sessionHealth = await this.profileManager.loadHealth(profile);
    const skillPack = resolveSkillPack({ goal: runConfig.goal, startUrl: runConfig.startUrl });
    const effectiveBudgets = this.buildEffectiveBudgets(runConfig);
    const session = this.sessionStore.createSession({
      goal: runConfig.goal,
      startUrl: runConfig.startUrl,
      runConfig,
      providerMode: runConfig.providerMode,
      goalFamily: skillPack.id,
      profileId: profile.profileId,
      profile,
      sessionHealth,
      effectiveBudgets,
      summary: this.buildQueuedSummary(runConfig, effectiveBudgets),
      crawlerMode: runConfig.crawlerMode ?? isCrawlerGoal(runConfig.goal)
    });

    this.emit("session.created", {
      sessionId: session.id,
      session
    });

    this.ensureRunControl(session.id);
    const run = this.runSession(session.id).catch(async (error) => {
      if (isRunStopRequestedError(error) || this.isStopRequested(session.id)) {
        if (this.sessionStore.getSession(session.id)?.status !== "cancelled") {
          await this.finalizeStopped(session.id, this.getActiveBrowserSession(session.id), {
            reason: error?.message ?? "Run stop requested by user."
          });
        }
        return;
      }

      this.sessionStore.patchSession(session.id, {
        status: "failed",
        summary: error.message,
        bug: {
          type: "orchestrator-error",
          severity: "P0",
          summary: error.message
        },
        outcome: {
          targetAchieved: false,
          blockers: [
            {
              type: "UI_CHANGED",
              confidence: 0.7,
              rationale: error.message
            }
          ],
          evidenceQualityScore: 0.68,
          nextBestAction: "RETRY_WITH_NEW_PROFILE"
        }
      });
      const failedSession = this.finalizeSessionReport(session.id);
      this.emit("session.failed", {
        sessionId: session.id,
        summary: error.message,
        session: failedSession
      });
      this.emitSessionUpdate(session.id);
      this.activeRuns.delete(session.id);
      this.activeBrowserSessions.delete(session.id);
      this.authSubmissionLocks.delete(session.id);
      this.releaseTestCaseTracker(session.id);
      this.clearRunControl(session.id);
    });

    this.activeRuns.set(session.id, run);
    return session;
  }

  async runSession(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    const runConfig = session.runConfig;
    this.throwIfStopRequested(sessionId);
    const testCaseTracker = this.getTestCaseTracker(sessionId);
    const uiuxMode = isUiuxMode(runConfig);
    const accessibilityMode = isAccessibilityMode(runConfig);
    const coverageMode = isCoverageMode(runConfig);
    const browserSession = new BrowserSession(sessionId, {
      storageStatePath: session.profile?.storageStatePath,
      runConfig
    });
    const urlFrontier = this.createUiuxFrontier(runConfig, coverageMode);
    const uiuxRunner = uiuxMode ? new UiuxRunner() : null;
    const a11yRunner = accessibilityMode ? new A11yRunner() : null;
    const frameBuffer = new RingBuffer(Math.min(Math.max(runConfig.budgets.maxSteps, 6), 24));
    const recentActions = [];
    let lastHash = "";
    let unchangedSteps = 0;
    let lastAction = null;
    const sessionStartAt = new Date(session.crawler.startAt).getTime();
    const accessibilityRuleCount = baselineA11yRules.length;
    const accessibilityStepCap = accessibilityMode
      ? Math.min(runConfig.budgets.maxSteps, runConfig.accessibility?.maxPages ?? runConfig.budgets.maxSteps)
      : runConfig.budgets.maxSteps;
    const stepBudget = session.crawler.mode
      ? Math.min(accessibilityStepCap, runConfig.exploration.depthLimit)
      : accessibilityStepCap;

    if (uiuxMode) {
      testCaseTracker?.planCases(estimateUiuxPlannedCases(runConfig));
    } else if (isFunctionalMode(runConfig)) {
      const maxFlows = Math.max(1, Number(runConfig.functional?.maxFlows ?? 1));
      const maxStepsPerFlow = Math.max(1, Number(runConfig.functional?.maxStepsPerFlow ?? 1));
      const estimatedAssertionsPerStep = 8;
      testCaseTracker?.planCases(
        maxFlows +
          maxFlows * maxStepsPerFlow +
          maxFlows * maxStepsPerFlow * estimatedAssertionsPerStep
      );
    } else if (accessibilityMode) {
      const maxPages = Math.max(1, Number(runConfig.accessibility?.maxPages ?? accessibilityStepCap));
      testCaseTracker?.planCases(maxPages * Math.max(accessibilityRuleCount, 1));
    } else {
      testCaseTracker?.planCases(stepBudget);
    }

    await browserSession.launch();
    this.throwIfStopRequested(sessionId);
    await browserSession.goto(session.startUrl);
    this.throwIfStopRequested(sessionId);
    this.activeBrowserSessions.set(sessionId, browserSession);

    this.sessionStore.patchSession(sessionId, {
      status: "running",
      summary: "Run in progress.",
      loginAssist: null,
      authAssist: null
    });
    this.emitSessionUpdate(sessionId);

    if (uiuxMode) {
      this.throwIfStopRequested(sessionId);
      await this.runUiuxAutonomousSession({
        sessionId,
        session,
        runConfig,
        browserSession,
        uiuxRunner,
        testCaseTracker,
        sessionStartAt
      });
      return;
    }

    if (isFunctionalMode(runConfig)) {
      this.throwIfStopRequested(sessionId);
      const functionalResult = await this.functionalRunner.run({
        session,
        runConfig,
        browserSession,
        sessionStore: this.sessionStore,
        sessionId,
        testCaseTracker,
        emit: this.emit.bind(this),
        emitSessionUpdate: this.emitSessionUpdate.bind(this, sessionId),
        sessionStartAt,
        shouldStop: () => this.isStopRequested(sessionId)
      });
      this.throwIfStopRequested(sessionId);

      this.sessionStore.patchSession(sessionId, {
        functional: {
          enabled: true,
          flowsRun: functionalResult.flowsRun,
          flows: functionalResult.flows ?? [],
          assertionCounts: functionalResult.assertionCounts ?? {
            evaluated: 0,
            passed: 0,
            failed: 0
          },
          deviceSummary: functionalResult.deviceSummary ?? [],
          issues: functionalResult.issues,
          blockers: functionalResult.blockers,
          blockerTimeline: functionalResult.blockerTimeline ?? [],
          resumePoints: functionalResult.resumePoints ?? [],
          loginAssist: functionalResult.loginAssist ?? {
            attempted: false,
            success: false,
            timeout: false,
            resumeStrategy: runConfig.functional?.loginAssist?.resumeStrategy ?? "restart-flow",
            profileTag: runConfig.profileTag ?? ""
          },
          summary: functionalResult.summary,
          reproBundles: functionalResult.reproBundles,
          contractSummary: functionalResult.contractSummary ?? {
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
          baselineDiff: null,
          graph: functionalResult.graph
        },
        graph: functionalResult.graph,
        currentUrl: this.sessionStore.getSession(sessionId)?.currentUrl ?? session.startUrl,
        currentStep:
          Math.max(
            this.sessionStore.getSession(sessionId)?.currentStep ?? 0,
            ...(functionalResult.issues ?? []).map((issue) => issue.step ?? 0)
          ) || 0
      });

      for (const issue of functionalResult.issues) {
        this.recordIncident(sessionId, {
          type: issue.assertionId ?? issue.issueType,
          severity: issue.severity,
          title: issue.title,
          details: issue.actual,
          confidence: issue.confidence,
          evidenceRefs: issue.evidenceRefs ?? [],
          affectedSelector: issue.affectedSelector ?? null,
          affectedUrl: issue.affectedUrl ?? null,
          viewportLabel: issue.viewportLabel ?? null,
          recoveryAttempts: []
        });
      }

      for (const blocker of functionalResult.blockers) {
        this.recordIncident(sessionId, {
          type: blocker.type,
          severity: "P2",
          title: summarizeIncidentTitle(blocker.type),
          details: blocker.rationale,
          confidence: blocker.confidence ?? 0.85,
          evidenceRefs: [],
          recoveryAttempts: []
        });
      }

      if (functionalResult.status === "soft-passed") {
        const primary = functionalResult.blockers[0] ?? {
          type: "FUNCTIONAL_BLOCKED",
          confidence: 0.8,
          rationale: "Functional flow blocked."
        };
        await this.finalizeSoftPass(sessionId, browserSession, [], {
          blocker: primary,
          summary: functionalResult.summary,
          nextBestAction: "REVIEW_FUNCTIONAL_BLOCKERS",
          evidenceQualityScore: 0.82
        });
        return;
      }

      if (functionalResult.status === "failed") {
        const topIssue = functionalResult.issues[0];
        await this.finalizeBug(
          sessionId,
          browserSession,
          [],
          {
            type: "functional-assertion-failure",
            severity: topIssue?.severity ?? "P1",
            summary: functionalResult.summary,
            evidencePrompt: "Review functional assertion failures and repro bundle evidence."
          },
          {
            targetAchieved: false,
            blockers: (functionalResult.issues ?? []).slice(0, 4).map((issue) => ({
              type: issue.assertionId ?? "FUNCTIONAL_ASSERTION_FAILED",
              confidence: issue.confidence ?? 0.85,
              rationale: issue.actual
            })),
            evidenceQualityScore: 0.86,
            nextBestAction: "REVIEW_FUNCTIONAL_REPORT"
          }
        );
        return;
      }

      await this.finalizeSuccess(sessionId, browserSession, {
        summary: functionalResult.summary,
        targetAchieved: true,
        blockers: [],
        evidenceQualityScore: 0.9,
        nextBestAction: "REVIEW_FUNCTIONAL_REPORT"
      });
      return;
    }

    for (let step = 1; step <= stepBudget; step += 1) {
      this.throwIfStopRequested(sessionId);
      const elapsedMs = Date.now() - sessionStartAt;
      if (elapsedMs > runConfig.budgets.timeBudgetMs) {
        await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
          blocker: {
            type: uiuxMode ? "UIUX_TIME_BUDGET_REACHED" : accessibilityMode ? "A11Y_TIME_BUDGET_REACHED" : "STAGNATION",
            confidence: 0.7,
            rationale: uiuxMode
              ? "UI/UX coverage mode reached its configured time budget."
              : accessibilityMode
                ? "Accessibility coverage mode reached its configured time budget."
              : "Crawler mode reached its configured time budget."
          },
          summary: uiuxMode
            ? "UI/UX coverage mode reached its configured time budget and is returning the collected evidence."
            : accessibilityMode
              ? "Accessibility coverage mode reached its configured time budget and is returning the collected evidence."
            : "Crawler mode reached its configured time budget and is returning the collected coverage artifacts.",
          nextBestAction: uiuxMode ? "REVIEW_UIUX_REPORT" : accessibilityMode ? "REVIEW_ACCESSIBILITY_REPORT" : "REVIEW_CRAWLER_REPORT",
          evidenceQualityScore: 0.8
        });
        return;
      }

      this.throwIfStopRequested(sessionId);
      await browserSession.waitForUIReady(
        runConfig.readiness.uiReadyStrategy,
        runConfig.readiness.readyTimeoutMs
      );
      const snapshot = await browserSession.capture(step, {
        viewportLabel: coverageMode ? this.resolveUiuxViewportLabel(browserSession, runConfig) : null,
        includeFocusProbe: uiuxMode,
        includeFocusA11yProbe: accessibilityMode,
        includeUiuxSignals: uiuxMode,
        includeA11ySignals: accessibilityMode
      });
      frameBuffer.push(snapshot);
      this.sessionStore.patchSession(sessionId, {
        artifactIndex: browserSession.getArtifactIndex()
      });
      testCaseTracker?.discoverCases(1);
      const stepCase = testCaseTracker?.startCase({
        type: runConfig.testMode,
        pageUrl: snapshot.url,
        canonicalUrl: snapshot.canonicalUrl ?? snapshot.url,
        deviceLabel: snapshot.viewportLabel ?? null,
        caseKind: coverageMode ? "COVERAGE_SNAPSHOT" : "STEP_SNAPSHOT",
        expected: coverageMode
          ? "Capture one coverage snapshot and continue safe exploration."
          : "Capture one execution snapshot and continue deterministic evaluation.",
        evidenceRefs: buildEvidenceRefs(snapshot, frameBuffer.values())
      });
      if (stepCase?.id) {
        testCaseTracker?.completeCase(stepCase.id, {
          status: "passed",
          actual: "Snapshot and readiness signals captured for this step.",
          pageUrl: snapshot.url,
          canonicalUrl: snapshot.canonicalUrl ?? snapshot.url,
          deviceLabel: snapshot.viewportLabel ?? null,
          evidenceRefs: buildEvidenceRefs(snapshot, frameBuffer.values())
        });
      }
      if (coverageMode) {
        if (uiuxMode) {
          this.updateUiuxCoverage(sessionId, snapshot, urlFrontier);
        }
        if (accessibilityMode) {
          this.updateAccessibilityCoverage(sessionId, snapshot, urlFrontier);
          this.updateAccessibilityProbeSummaries(sessionId, snapshot);
        }
        const discoveredLinks = this.collectCandidateLinks(snapshot, runConfig);
        const nextDepth = (urlFrontier?.getDepth(snapshot.url) ?? 0) + 1;
        urlFrontier?.pushMany(discoveredLinks, (url) => ({ discoveredFrom: snapshot.url, step, url, depth: nextDepth }));
        const initialUiuxIssues = uiuxMode
          ? await this.runResponsiveUiuxChecks({
              browserSession,
              uiuxRunner,
              runConfig,
              baseSnapshot: snapshot,
              stage: step === 1 ? "initial" : "loop",
              sessionStartAt
            })
          : [];
        const initialA11yIssues = accessibilityMode
          ? this.runAccessibilityChecks({
              a11yRunner,
              snapshot,
              stage: step === 1 ? "initial" : "loop"
            })
          : [];
        this.sessionStore.patchSession(sessionId, {
          artifactIndex: browserSession.getArtifactIndex()
        });
        if (uiuxMode) {
          this.recordUiuxIssues(sessionId, initialUiuxIssues);
          await this.applyUiuxArtifactRetention({
            sessionId,
            browserSession,
            runConfig
          });
        }
        if (accessibilityMode) {
          this.recordAccessibilityRuleTestCases({
            sessionId,
            testCaseTracker,
            snapshot,
            issues: initialA11yIssues
          });
          this.recordAccessibilityIssues(sessionId, initialA11yIssues);
          await this.applyAccessibilityArtifactRetention({
            sessionId,
            browserSession,
            runConfig
          });
        }
      }

      unchangedSteps = snapshot.hash === lastHash ? unchangedSteps + 1 : 0;
      lastHash = snapshot.hash;

      const skillPack = resolveSkillPack({
        goal: session.goal,
        startUrl: session.startUrl,
        snapshot
      });
      const skillState = skillPack.classify?.(snapshot) ?? {
        pageType: "generic",
        blockers: [],
        confidence: 0.5
      };
      const verificationChecks = skillPack.verify?.({ snapshot, goal: session.goal }) ?? [];
      const observation = buildObservation(snapshot);
      const graphNode = buildGraphNode(snapshot);

      this.sessionStore.appendObservation(sessionId, observation);
      this.sessionStore.appendGraphNode(sessionId, graphNode);
      this.sessionStore.upsertStep(sessionId, {
        goalId: session.id,
        stepId: step,
        actionPlan: null,
        actionAttempted: null,
        postConditions: verificationChecks,
        result: "observed"
      });

      this.sessionStore.patchSession(sessionId, {
        goalFamily: skillPack.id,
        currentStep: step,
        currentUrl: snapshot.url,
        frame: `data:image/png;base64,${snapshot.screenshotBase64}`
      });
      this.sessionStore.appendTimeline(sessionId, {
        type: "frame",
        message: `${snapshot.title} @ ${snapshot.url}`
      });
      this.emit("frame", {
        sessionId,
        step,
        url: snapshot.url,
        title: snapshot.title,
        frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
        spinnerVisible: snapshot.spinnerVisible,
        overlays: snapshot.overlays,
        elements: snapshot.interactive.slice(0, 18)
      });

      const gate = await this.gatekeeper.classify({
        goal: session.goal,
        snapshot,
        unchangedSteps
      });

      this.sessionStore.patchSession(sessionId, {
        gateState: gate.pageState,
        primaryBlocker: gate.primaryBlocker ?? null,
        runSummary: {
          outcome: null,
          primaryBlocker: gate.primaryBlocker ?? null,
          nextBestAction: gate.policy.nextBestAction,
          evidenceQualityScore: 0,
          targetAchieved: false
        }
      });
      if (gate.pageState !== "READY") {
        this.sessionStore.appendTimeline(sessionId, {
          type: "gatekeeper",
          message: `${gate.pageState}: ${gate.rationale}`
        });
      }
      this.emitSessionUpdate(sessionId);

      if (!coverageMode && skillState.pageType === "premium" && isSubscriptionGoal(session.goal)) {
        await this.finalizeSuccess(sessionId, browserSession, {
          summary: "Premium options page is visible and the upgrade funnel was mapped safely.",
          targetAchieved: true,
          blockers: gate.blockers,
          evidenceQualityScore: 0.86,
          nextBestAction: "STOP_SUCCESS"
        });
        return;
      }

      const paymentWallDetected = this.safetyPolicy.shouldStopForPaymentWall(snapshot, runConfig);
      if (paymentWallDetected) {
        if (coverageMode) {
          const safeCandidateAvailable = this.hasSafeUiuxCandidate(snapshot, recentActions);
          const paymentDecision = decideUiuxPaymentWall({
            paymentWallDetected,
            frontierHasQueuedUrls: urlFrontier?.hasNext() ?? false,
            hasSafeCandidates: safeCandidateAvailable
          });
          const blockedCanonicalUrl = this.markCoverageBlockedUrl(
            sessionId,
            snapshot.url,
            urlFrontier,
            coverageMode
          );
          const currentSession = this.sessionStore.getSession(sessionId);
          const alreadyRecorded = uiuxMode
            ? (currentSession?.uiux?.issues ?? []).some(
                (issue) => issue.issueType === "PAYMENT_WALL" && issue.affectedUrl === snapshot.url
              )
            : false;

          if (uiuxMode && paymentDecision.shouldRecordIssue && !alreadyRecorded) {
            this.recordUiuxIssues(sessionId, [this.buildUiuxPaymentWallIssue(snapshot, frameBuffer.values())]);
          }

          if (paymentDecision.shouldStopRun) {
            await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
              blocker: gate.primaryBlocker ?? {
                type: "PAYMENT_REQUIRED",
                confidence: 0.9,
                rationale: "Payment or subscription wall detected."
              },
              summary: "Payment walls block all remaining safe exploration paths, so the UI/UX run stopped with recorded evidence.",
              nextBestAction: "STOP_PAYMENT_REQUIRED",
              evidenceQualityScore: 0.86
            });
            return;
          }

          this.sessionStore.appendTimeline(sessionId, {
            type: coverageMode ? "coverage" : "uiux",
            message: `Payment wall recorded for ${blockedCanonicalUrl}. Continuing with alternate safe coverage paths.`
          });
          this.emitSessionUpdate(sessionId);
        } else {
          await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
            blocker: gate.primaryBlocker ?? {
              type: "PAYMENT_REQUIRED",
              confidence: 0.9,
              rationale: "Payment or subscription wall detected."
            },
            summary: "The run stopped safely at a payment or subscription wall.",
            nextBestAction: "STOP_PAYMENT_REQUIRED",
            evidenceQualityScore: 0.86
          });
          return;
        }
      }

      if (
        ["CAPTCHA_BOT_DETECTED", "RATE_LIMITED", "REGION_RESTRICTED", "UNSUPPORTED_FLOW"].includes(gate.pageState)
      ) {
        await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
          blocker: gate.primaryBlocker,
          summary: gate.rationale,
          nextBestAction: gate.policy.nextBestAction,
          evidenceQualityScore: 0.82
        });
        return;
      }

      if (gate.pageState === "LOGIN_REQUIRED") {
        const resumed = await this.handleLoginAssist({
          sessionId,
          browserSession,
          domain: session.profile?.domain ?? new URL(snapshot.url).hostname,
          resumeTargetUrl: this.resolveResumeTargetUrl(sessionId, snapshot.url),
          resumeCheckpoint: {
            mode: runConfig?.testMode ?? "default",
            step,
            url: snapshot.url
          }
        });

        if (!resumed) {
          await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
            blocker: gate.primaryBlocker,
            summary: "Manual login is required before the run can continue.",
            nextBestAction: "WAIT_FOR_LOGIN",
            evidenceQualityScore: 0.79
          });
          return;
        }

        continue;
      }

      if (!coverageMode && gate.pageState === "PAYMENT_REQUIRED" && isSubscriptionGoal(session.goal)) {
        await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
          blocker: gate.primaryBlocker,
          summary: "Payment is required to continue the upgrade funnel, so the run stopped safely before purchase.",
          nextBestAction: "STOP_PAYMENT_REQUIRED",
          evidenceQualityScore: 0.88
        });
        return;
      }

      this.emit("audit.starting", {
        sessionId,
        step,
        phase: "before-action",
        status: "thinking",
        title: "Analyzing current view...",
        details: "Nova Auditor is reviewing the latest screenshot for blockers, loaders, goal progress, and safe next actions.",
        timestamp: nowIso()
      });

      this.throwIfStopRequested(sessionId);
      await browserSession.waitForUIReady(
        runConfig.readiness.uiReadyStrategy,
        runConfig.readiness.readyTimeoutMs
      );
      const preAudit = await this.auditorProvider.audit({
        goal: session.goal,
        phase: "before-action",
        step,
        snapshot,
        recentFrames: pickLast(frameBuffer.values().slice(0, -1), 4).map((frame) => ({
          step: frame.step ?? null,
          screenshotBase64: frame.screenshotBase64
        })),
        recentActions,
        unchangedSteps,
        lastAction,
        stagnationLimit: runConfig.budgets.stagnationLimit
      });

      this.sessionStore.patchSession(sessionId, {
        lastAudit: preAudit.thought,
        currentHighlight: preAudit.highlight ?? null,
        outcome: {
          targetAchieved: Boolean(preAudit.targetAchieved),
          blockers: preAudit.blockers ?? gate.blockers,
          evidenceQualityScore: preAudit.evidenceQualityScore ?? 0.72,
          nextBestAction: preAudit.nextBestAction ?? gate.policy.nextBestAction
        },
        runSummary: {
          outcome: null,
          primaryBlocker: preAudit.blockers?.[0] ?? gate.primaryBlocker ?? null,
          nextBestAction: preAudit.nextBestAction ?? gate.policy.nextBestAction,
          evidenceQualityScore: preAudit.evidenceQualityScore ?? 0.72,
          targetAchieved: Boolean(preAudit.targetAchieved)
        }
      });
      this.sessionStore.appendTimeline(sessionId, {
        type: "audit",
        message: preAudit.thought
      });
      this.emit("audit", {
        sessionId,
        step,
        phase: "before-action",
        timestamp: nowIso(),
        landmark: preAudit.landmark ?? null,
        ...preAudit
      });
      this.emitSessionUpdate(sessionId);

      if (!coverageMode && (preAudit.targetAchieved || preAudit.status === "success")) {
        await this.finalizeSuccess(sessionId, browserSession, {
          summary: preAudit.thought,
          targetAchieved: true,
          blockers: preAudit.blockers ?? [],
          evidenceQualityScore: preAudit.evidenceQualityScore ?? 0.9,
          nextBestAction: "STOP_SUCCESS"
        });
        return;
      }

      if (!coverageMode && preAudit.status === "bug") {
        await this.finalizeBug(sessionId, browserSession, frameBuffer.values(), preAudit.bug, preAudit);
        return;
      }

      const policyPlan = this.planFromGatekeeper({
        gate,
        snapshot,
        skillPack,
        step
      });
      const skillSuggestion = coverageMode
        ? null
        : this.planFromSkillPack({
            skillPack,
            snapshot,
            goal: session.goal
          });
      const crawlerPlan = session.crawler.mode && !coverageMode
        ? this.planCrawlerAction({
            session: this.sessionStore.getSession(sessionId),
            snapshot,
            recentActions,
            step
          })
        : null;
      let explorerPlan = null;
      if (!coverageMode) {
        explorerPlan =
          crawlerPlan ??
          (await this.explorerProvider.plan({
            goal: session.goal,
            step,
            snapshot,
            recentActions: pickLast(recentActions, 3),
            recentSemanticActions: pickLast(recentActions, 3)
              .map((entry) => entry.semanticAction)
              .filter(Boolean),
            auditorInstruction: preAudit.nextInstruction
          }));
      }

      const candidatePlan = coverageMode
        ? this.planUiuxAction({
            session: this.sessionStore.getSession(sessionId),
            snapshot,
            gate,
            frontier: urlFrontier,
            recentActions,
            step
          })
        : policyPlan ??
          (skillSuggestion && (explorerPlan.action?.type === "wait" || gate.pageState === "PAYWALL")
            ? skillSuggestion
            : explorerPlan);
      const planValidation = validateOrRepairActionPlan(candidatePlan, snapshot);
      const plan = planValidation.plan;

      if (planValidation.incident) {
        this.recordIncident(sessionId, {
          ...planValidation.incident,
          evidenceRefs: buildEvidenceRefs(snapshot, frameBuffer.values())
        });
      }

      this.sessionStore.upsertStep(sessionId, {
        goalId: session.id,
        stepId: step,
        actionPlan: plan,
        postConditions: verificationChecks,
        result: "planned"
      });
      this.sessionStore.patchSession(sessionId, {
        lastThought: plan.thinking
      });
      this.sessionStore.appendTimeline(sessionId, {
        type: "explorer",
        message: plan.thinking
      });
      this.emit("action.planned", {
        sessionId,
        step,
        thought: plan.thinking,
        action: plan.action,
        landmark:
          plan.landmark ??
          snapshot.interactive.find((item) => item.elementId === plan.action?.elementId)?.zone ??
          null,
        targetText:
          plan.targetText ??
          snapshot.interactive.find((item) => item.elementId === plan.action?.elementId)?.text ??
          null,
        verification:
          plan.verification ??
          snapshot.interactive.find((item) => item.elementId === plan.action?.elementId)?.landmark ??
          null
      });

      if (plan.action.type === "done" || plan.isDone) {
        await this.finalizeSuccess(sessionId, browserSession, {
          summary: plan.thinking,
          targetAchieved: true,
          blockers: [],
          evidenceQualityScore: 0.84,
          nextBestAction: "STOP_SUCCESS"
        });
        return;
      }

      if (plan.action.type === "bug") {
        await this.finalizeBug(
          sessionId,
          browserSession,
          frameBuffer.values(),
          plan.bug ?? {
            type: "explorer-bug",
            severity: "P1",
            summary: plan.thinking,
            evidencePrompt: plan.thinking
          }
        );
        return;
      }

      let postSnapshot = null;
      let validation = null;
      let actionResult = null;
      const recoveryAttempts = [];

      const safetyDecision = this.safetyPolicy.evaluateBeforeAction({
        runConfig,
        actionPlan: plan.contract,
        snapshot,
        currentUrl: snapshot.url
      });

      if (!safetyDecision.allowed) {
        await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
          blocker: {
            type: safetyDecision.code,
            confidence: 0.95,
            rationale: safetyDecision.reason
          },
          summary: safetyDecision.reason,
          nextBestAction: "REVIEW_SAFETY_POLICY",
          evidenceQualityScore: 0.84
        });
        return;
      }

      if (coverageMode) {
        const uiuxActionClass = classifyUiuxAction(plan.contract, snapshot);
        if (!["READ_ONLY", "LOW_RISK"].includes(uiuxActionClass.category)) {
          const currentSession = this.sessionStore.getSession(sessionId);
          if (uiuxMode) {
            this.sessionStore.patchSession(sessionId, {
              uiux: {
                ...(currentSession?.uiux ?? {}),
                interactionsSkippedBySafety: (currentSession?.uiux?.interactionsSkippedBySafety ?? 0) + 1
              }
            });
          }
          if (accessibilityMode) {
            this.sessionStore.patchSession(sessionId, {
              accessibility: {
                ...(currentSession?.accessibility ?? {}),
                interactionsSkippedBySafety: (currentSession?.accessibility?.interactionsSkippedBySafety ?? 0) + 1
              }
            });
          }
          await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
            blocker: {
              type: "UIUX_UNSAFE_ACTION_BLOCKED",
              confidence: 0.95,
              rationale: `Coverage mode only allows read-only or low-risk actions. Rejected: ${uiuxActionClass.reason}`
            },
            summary: `Coverage mode blocked an unsafe exploration action: ${uiuxActionClass.reason}.`,
            nextBestAction: "REVIEW_UIUX_POLICY",
            evidenceQualityScore: 0.82
          });
          return;
        }
      }

      try {
        if (coverageMode) {
          const currentSession = this.sessionStore.getSession(sessionId);
          if (uiuxMode) {
            this.sessionStore.patchSession(sessionId, {
              uiux: {
                ...(currentSession?.uiux ?? {}),
                interactionsAttempted: (currentSession?.uiux?.interactionsAttempted ?? 0) + 1
              }
            });
          }
          if (accessibilityMode) {
            this.sessionStore.patchSession(sessionId, {
              accessibility: {
                ...(currentSession?.accessibility ?? {}),
                interactionsAttempted: (currentSession?.accessibility?.interactionsAttempted ?? 0) + 1
              }
            });
          }
        }
        this.throwIfStopRequested(sessionId);
        actionResult = await browserSession.executeAction(plan.action, snapshot);
        this.throwIfStopRequested(sessionId);
        postSnapshot = await browserSession.capture(`${step}-post`, {
          viewportLabel: coverageMode ? this.resolveUiuxViewportLabel(browserSession, runConfig) : null,
          includeFocusProbe: uiuxMode,
          includeFocusA11yProbe: accessibilityMode,
          includeUiuxSignals: uiuxMode,
          includeA11ySignals: accessibilityMode
        });
        frameBuffer.push(postSnapshot);
        this.sessionStore.patchSession(sessionId, {
          artifactIndex: browserSession.getArtifactIndex()
        });
        if (coverageMode) {
          if (uiuxMode) {
            this.updateUiuxCoverage(sessionId, postSnapshot, urlFrontier);
          }
          if (accessibilityMode) {
            this.updateAccessibilityCoverage(sessionId, postSnapshot, urlFrontier);
            this.updateAccessibilityProbeSummaries(sessionId, postSnapshot);
          }
          const actionContext = {
            action: plan.action,
            target: snapshot.interactive.find((item) => item.elementId === plan.action?.elementId) ?? null,
            sourceUrl: snapshot.url
          };
          if (uiuxMode) {
            const postIssues = await this.runResponsiveUiuxChecks({
              browserSession,
              uiuxRunner,
              runConfig,
              baseSnapshot: postSnapshot,
              stage: plan.action.type === "goto" ? "navigation" : "interaction",
              actionResult,
              actionContext,
              sessionStartAt
            });
            this.recordUiuxIssues(sessionId, postIssues);
            await this.applyUiuxArtifactRetention({
              sessionId,
              browserSession,
              runConfig
            });
          }
          if (accessibilityMode) {
            const a11yIssues = this.runAccessibilityChecks({
              a11yRunner,
              snapshot: postSnapshot,
              stage: plan.action.type === "goto" ? "navigation" : "interaction",
              actionResult,
              actionContext
            });
            this.recordAccessibilityRuleTestCases({
              sessionId,
              testCaseTracker,
              snapshot: postSnapshot,
              issues: a11yIssues
            });
            this.recordAccessibilityIssues(sessionId, a11yIssues);
            await this.applyAccessibilityArtifactRetention({
              sessionId,
              browserSession,
              runConfig
            });
          }
          this.sessionStore.patchSession(sessionId, {
            artifactIndex: browserSession.getArtifactIndex()
          });
          const discoveredLinks = this.collectCandidateLinks(postSnapshot, runConfig);
          const nextDepth = (urlFrontier?.getDepth(postSnapshot.url) ?? 0) + 1;
          urlFrontier?.pushMany(discoveredLinks, (url) => ({
            discoveredFrom: postSnapshot.url,
            step,
            url,
            depth: nextDepth
          }));
        }
        validation = validatePostConditions(snapshot, postSnapshot, verificationChecks);

        if (!coverageMode && !validation.changed && !["wait", "scroll"].includes(plan.action.type)) {
          const fallbackPlan = this.selectFallbackAction({
            skillPack,
            snapshot,
            goal: session.goal,
            originalAction: plan.action
          });

          if (fallbackPlan) {
            const fallbackValidation = validateOrRepairActionPlan(fallbackPlan, snapshot);
            const safeFallbackPlan = fallbackValidation.plan;
            recoveryAttempts.push(fallbackPlan.action.type);
            if (fallbackValidation.incident) {
              this.recordIncident(sessionId, {
                ...fallbackValidation.incident,
                evidenceRefs: buildEvidenceRefs(snapshot, frameBuffer.values())
              });
            }
            this.emit("action.planned", {
              sessionId,
              step,
              thought: safeFallbackPlan.thinking,
              action: safeFallbackPlan.action,
              landmark: safeFallbackPlan.landmark ?? null,
              targetText: safeFallbackPlan.targetText ?? null,
              verification: safeFallbackPlan.verification ?? null
            });
            const fallbackSafetyDecision = this.safetyPolicy.evaluateBeforeAction({
              runConfig,
              actionPlan: safeFallbackPlan.contract,
              snapshot,
              currentUrl: snapshot.url
            });
            if (!fallbackSafetyDecision.allowed) {
              await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
                blocker: {
                  type: fallbackSafetyDecision.code,
                  confidence: 0.95,
                  rationale: fallbackSafetyDecision.reason
                },
                summary: fallbackSafetyDecision.reason,
                nextBestAction: "REVIEW_SAFETY_POLICY",
                evidenceQualityScore: 0.84
              });
              return;
            }
            this.throwIfStopRequested(sessionId);
            actionResult = await browserSession.executeAction(safeFallbackPlan.action, snapshot);
            postSnapshot = await browserSession.capture(`${step}-retry`);
            frameBuffer.push(postSnapshot);
            this.sessionStore.patchSession(sessionId, {
              artifactIndex: browserSession.getArtifactIndex()
            });
            validation = validatePostConditions(snapshot, postSnapshot, verificationChecks);
          }

          if (!validation.changed) {
            this.recordIncident(sessionId, {
              type: "ACTION_NO_EFFECT",
              severity: "P2",
              title: "Action Had No Effect",
              details: "The action completed without a meaningful URL, DOM, or landmark change.",
              confidence: 0.88,
              evidenceRefs: buildEvidenceRefs(postSnapshot ?? snapshot, frameBuffer.values()),
              recoveryAttempts
            });
          }
        }
      } catch (error) {
        if (isRunStopRequestedError(error) || this.isStopRequested(sessionId)) {
          throw error;
        }
        await this.captureFailureFrame(browserSession, frameBuffer, step);
        await this.finalizeBug(
          sessionId,
          browserSession,
          frameBuffer.values(),
          this.buildActionErrorBug(plan, error),
          {
            targetAchieved: false,
            blockers: [
              {
                type: /timeout/i.test(error?.message ?? "") ? "STAGNATION" : "UI_CHANGED",
                confidence: 0.81,
                rationale: error.message
              }
            ],
            evidenceQualityScore: 0.85,
            nextBestAction: "REPLAN"
          }
        );
        return;
      }

      const finalSnapshot = postSnapshot ?? snapshot;
      const finalNode = buildGraphNode(finalSnapshot);
      this.sessionStore.appendGraphNode(sessionId, finalNode);
      this.sessionStore.appendGraphEdge(
        sessionId,
        buildGraphEdge(
          graphNode,
          finalNode,
          plan.thinking,
          plan.targetText ?? summarizeSemanticAction(snapshot, plan.action)?.label ?? plan.action.type
        )
      );

      const semanticAction = summarizeSemanticAction(snapshot, plan.action);
      lastAction = plan.action;
      recentActions.push({
        step,
        action: plan.action,
        thought: plan.thinking,
        semanticAction,
        changed: validation?.changed ?? false
      });
      this.sessionStore.patchSession(sessionId, {
        history: pickLast(recentActions, 12)
      });
      this.sessionStore.upsertStep(sessionId, {
        goalId: session.id,
        stepId: step,
        actionPlan: plan,
        actionAttempted: plan.action,
        actionResult,
        postConditions: verificationChecks,
        result: validation?.changed ? "advanced" : "no-effect"
      });
      this.emit("action.executed", {
        sessionId,
        step,
        action: plan.action
      });
      this.emitSessionUpdate(sessionId);

      if (!coverageMode && validation?.expectedMarkerAppeared) {
        await this.finalizeSuccess(sessionId, browserSession, {
          summary: validation.matchedChecks.join(", "),
          targetAchieved: true,
          blockers: [],
          evidenceQualityScore: 0.88,
          nextBestAction: "STOP_SUCCESS"
        });
        return;
      }
    }

    await this.finalizeBug(sessionId, browserSession, frameBuffer.values(), {
      type: "max-steps",
      severity: "P1",
      summary: `The explorer reached the max step limit of ${runConfig.budgets.maxSteps} without completing the goal.`,
      evidencePrompt: "Show the last visible state before the test was terminated for exceeding the step budget."
    });
  }

  planFromGatekeeper({ gate, snapshot, step }) {
    if (gate.pageState === "CONSENT_REQUIRED") {
      const closeTarget = snapshot.interactive.find((item) => {
        const haystack = [item.text, item.ariaLabel, item.placeholder].join(" ").toLowerCase();
        return /accept|reject|close|dismiss|not now|skip|agree|continue/.test(haystack) && !item.disabled;
      });

      if (closeTarget) {
        return {
          thinking: "Resolving consent or blocking overlay.",
          action: { type: "click", elementId: closeTarget.elementId },
          landmark: closeTarget.zone,
          targetText: closeTarget.text,
          verification: "Consent-related control is visible and actionable.",
          step
        };
      }
    }

    if (gate.pageState === "STUCK_LOADING") {
      return {
        thinking: "Recovering from a persistent loading state.",
        action: { type: "refresh" },
        landmark: "Page Shell",
        targetText: "Refresh",
        verification: "Refreshing the page is the safest recovery step for a stuck loader.",
        step
      };
    }

    return null;
  }

  planFromSkillPack({ skillPack, snapshot, goal }) {
    const suggestions =
      skillPack.suggestNextActions?.({
        snapshot,
        goal,
        parsedGoal: deriveParsedGoal(goal)
      }) ?? [];

    const top = suggestions[0];
    if (!top) {
      return null;
    }

    return {
      thinking: top.verification || `Using ${skillPack.id} skill-pack guidance.`,
      action: top.action,
      landmark: top.landmark ?? null,
      targetText: top.targetText ?? null,
      verification: top.verification ?? null
    };
  }

  selectFallbackAction({ skillPack, snapshot, goal, originalAction }) {
    const suggestions =
      skillPack.suggestNextActions?.({
        snapshot,
        goal,
        parsedGoal: deriveParsedGoal(goal)
      }) ?? [];

    const fallback = suggestions.find((entry) => entry.action.elementId !== originalAction.elementId);
    if (!fallback) {
      return null;
    }

    return {
      thinking: `Recovery attempt: ${fallback.verification ?? "trying an alternate candidate"}`,
      action: fallback.action,
      landmark: fallback.landmark ?? null,
      targetText: fallback.targetText ?? null,
      verification: fallback.verification ?? null
    };
  }

  planCrawlerAction({ session, snapshot, recentActions, step }) {
    const seenNodeIds = new Set((session.graph?.nodes ?? []).map((node) => node.nodeId));
    const recentTargets = new Set(
      pickLast(recentActions, 6)
        .map((entry) => entry.semanticAction?.label)
        .filter(Boolean)
    );

    const candidates = snapshot.interactive
      .filter((element) => !element.disabled)
      .filter((element) => !/delete account|remove|logout|sign out|purchase|buy now|confirm purchase|pay/i.test(element.text))
      .map((element) => {
        let score = 0;
        const signature = signatureForElement(element);
        if (!seenNodeIds.has(hashText(`${snapshot.url}:${signature}`))) {
          score += 6;
        }
        if (!recentTargets.has(element.text)) {
          score += 4;
        }
        if (element.zone === "Primary Content") {
          score += 2;
        }
        if (["button", "a", "input"].includes(element.tag)) {
          score += 1;
        }

        return {
          element,
          score
        };
      })
      .sort((left, right) => right.score - left.score);

    const selected = candidates[0]?.element ?? null;
    if (!selected) {
      return {
        thinking: "Crawler mode found no safe novel action, waiting briefly.",
        action: { type: "wait", durationMs: 900 },
        landmark: "Crawler",
        verification: "No safe novel actions were available on the current page.",
        targetText: null,
        step
      };
    }

    return {
      thinking: `Crawler exploring "${selected.text || selected.ariaLabel || selected.tag}" for novel coverage.`,
      action: {
        type: selected.tag === "input" ? "click" : "click",
        elementId: selected.elementId
      },
      landmark: selected.zone,
      verification: "Candidate ranked highest for novelty and safe exploration.",
      targetText: selected.text || selected.ariaLabel || selected.placeholder || selected.tag,
      step
    };
  }

  getActiveBrowserSession(sessionId) {
    if (!sessionId) {
      return null;
    }
    return this.activeBrowserSessions.get(sessionId) ?? null;
  }

  deriveAuthAssistStateFromProbe(probe = {}) {
    return deriveAuthAssistState(probe);
  }

  patchAuthAssistState(sessionId, {
    state,
    code,
    reason,
    probe = null,
    source = null,
    timeoutMs = null,
    startedAt = null,
    remainingMs = null,
    endedAt = null,
    status = null,
    resumeTargetUrl = null,
    resumeCheckpoint = null,
    resumedAt = null,
    resumeRequestedAt = null,
    submitAttempted = null,
    resumeTriggered = null,
    runtimeMeta = null
  }) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    const current = session.authAssist ?? {};
    const site = probe?.site || current.site || session.profile?.domain || (() => {
      try {
        return new URL(session.currentUrl || session.startUrl || "").hostname;
      } catch {
        return "";
      }
    })();
    const pageUrl = probe?.pageUrl || session.currentUrl || session.startUrl || "";
    const normalizedState = String(state || current.state || "awaiting_credentials");
    const effectiveResumeTargetUrl =
      (resumeTargetUrl && String(resumeTargetUrl).trim()) ||
      String(current.resumeTargetUrl || session.loginAssist?.resumeTargetUrl || session.currentUrl || session.startUrl || "").trim();
    const effectiveResumeCheckpoint = resumeCheckpoint ?? current.resumeCheckpoint ?? null;
    const effectiveResumedAt =
      resumedAt ??
      (["authenticated", "resumed"].includes(normalizedState) ? nowIso() : current.resumedAt ?? null);
    const loginAssistStates = new Set([
      "awaiting_username",
      "awaiting_password",
      "awaiting_credentials",
      "awaiting_otp",
      "auth_step_advanced",
      "auth_unknown_state",
      "submitting_credentials",
      "submitting_otp",
      "auth_failed"
    ]);
    const nextStatus = status
      ?? (loginAssistStates.has(normalizedState) ? "login-assist" : "running");
    const next = {
      state: normalizedState,
      code: code ?? current.code ?? null,
      source: source ?? current.source ?? null,
      reason: reason ?? current.reason ?? "",
      site,
      pageUrl,
      loginRequired: !["running", "authenticated", "resumed"].includes(normalizedState),
      form: {
        identifierFieldDetected: Boolean(
          probe?.identifierFieldDetected ??
            probe?.usernameFieldDetected ??
            current.form?.identifierFieldDetected
        ),
        usernameFieldDetected: Boolean(probe?.usernameFieldDetected ?? probe?.identifierFieldDetected),
        passwordFieldDetected: Boolean(probe?.passwordFieldDetected),
        otpFieldDetected: Boolean(probe?.otpFieldDetected),
        submitControlDetected: Boolean(probe?.submitControlDetected),
        identifierFilled: Boolean(runtimeMeta?.identifierFilled ?? current.form?.identifierFilled),
        usernameFilled: Boolean(runtimeMeta?.usernameFilled ?? current.form?.usernameFilled),
        passwordFilled: Boolean(runtimeMeta?.passwordFilled ?? current.form?.passwordFilled),
        submitTriggered: Boolean(runtimeMeta?.submitTriggered ?? current.form?.submitTriggered),
        submitControlType: runtimeMeta?.submitControlType ?? current.form?.submitControlType ?? "none",
        postSubmitUrlChanged: Boolean(
          runtimeMeta?.postSubmitUrlChanged ?? current.form?.postSubmitUrlChanged
        ),
        postSubmitProbeState:
          runtimeMeta?.postSubmitProbeState ?? current.form?.postSubmitProbeState ?? null,
        visibleStep: probe?.visibleStep ?? current.form?.visibleStep ?? null,
        identifierFieldVisibleCount: Number(
          probe?.identifierFieldVisibleCount ?? current.form?.identifierFieldVisibleCount ?? 0
        ),
        identifierLabelCandidates: Array.isArray(probe?.identifierLabelCandidates)
          ? probe.identifierLabelCandidates.slice(0, 5)
          : (current.form?.identifierLabelCandidates ?? []),
        usernameFieldVisibleCount: Number(probe?.usernameFieldVisibleCount ?? current.form?.usernameFieldVisibleCount ?? 0),
        passwordFieldVisibleCount: Number(probe?.passwordFieldVisibleCount ?? current.form?.passwordFieldVisibleCount ?? 0),
        otpFieldVisibleCount: Number(probe?.otpFieldVisibleCount ?? current.form?.otpFieldVisibleCount ?? 0),
        nextRecommendedAction: probe?.nextRecommendedAction ?? current.form?.nextRecommendedAction ?? null
      },
      runtime: {
        browserActionExecuted: Boolean(
          runtimeMeta?.browserActionExecuted ?? current.runtime?.browserActionExecuted
        ),
        identifierFilled: Boolean(runtimeMeta?.identifierFilled ?? current.runtime?.identifierFilled),
        usernameFilled: Boolean(runtimeMeta?.usernameFilled ?? current.runtime?.usernameFilled),
        passwordFilled: Boolean(runtimeMeta?.passwordFilled ?? current.runtime?.passwordFilled),
        submitTriggered: Boolean(runtimeMeta?.submitTriggered ?? current.runtime?.submitTriggered),
        submitControlType: runtimeMeta?.submitControlType ?? current.runtime?.submitControlType ?? "none",
        postSubmitUrlChanged: Boolean(
          runtimeMeta?.postSubmitUrlChanged ?? current.runtime?.postSubmitUrlChanged
        ),
        postSubmitProbeState:
          runtimeMeta?.postSubmitProbeState ?? current.runtime?.postSubmitProbeState ?? null
      },
      startedAt: current.startedAt ?? startedAt ?? nowIso(),
      timeoutMs: timeoutMs ?? current.timeoutMs ?? null,
      remainingMs: remainingMs ?? current.remainingMs ?? null,
      endedAt: endedAt ?? null,
      resumedAt: effectiveResumedAt,
      resumeTargetUrl: effectiveResumeTargetUrl || null,
      resumeCheckpoint: effectiveResumeCheckpoint,
      profileTag: session.runConfig?.profileTag ?? "",
      submitAttempted: submitAttempted ?? current.submitAttempted ?? false,
      resumeTriggered: resumeTriggered ?? current.resumeTriggered ?? false,
      resumeRequestedAt: resumeRequestedAt ?? current.resumeRequestedAt ?? null,
      updatedAt: nowIso()
    };

    const legacyLoginAssist = {
      ...(session.loginAssist ?? {}),
      state: normalizedState.toUpperCase(),
      domain: next.site,
      hint: next.reason,
      startedAt: next.startedAt,
      timeoutMs: next.timeoutMs,
      remainingMs: next.remainingMs,
      resumedAt: normalizedState === "resumed" ? next.updatedAt : (session.loginAssist?.resumedAt ?? null),
      endedAt: next.endedAt,
      resumeTargetUrl: next.resumeTargetUrl,
      resumeCheckpoint: next.resumeCheckpoint
    };

    this.sessionStore.patchSession(sessionId, {
      status: nextStatus,
      currentUrl: pageUrl || session.currentUrl,
      authAssist: next,
      loginAssist: legacyLoginAssist,
      runSummary: {
        outcome: null,
        primaryBlocker: normalizedState === "running" || normalizedState === "resumed" || normalizedState === "authenticated"
          ? null
          : {
              type: "LOGIN_REQUIRED",
              confidence: 0.92,
              rationale: next.reason
            },
        nextBestAction:
          loginAssistStates.has(normalizedState)
            ? "WAIT_FOR_LOGIN"
            : "CONTINUE",
        evidenceQualityScore: session.runSummary?.evidenceQualityScore ?? 0.72,
        targetAchieved: false
      }
    });
    this.emitSessionUpdate(sessionId);
    return this.sessionStore.getSession(sessionId)?.authAssist ?? next;
  }

  canAcceptCredentialSubmission(session) {
    const state = String(session?.authAssist?.state ?? "").trim();
    if (!state) {
      return true;
    }
    if (["awaiting_otp", "submitting_otp", "authenticated", "resumed", "running"].includes(state)) {
      return false;
    }
    return [
      "awaiting_username",
      "awaiting_password",
      "awaiting_credentials",
      "auth_step_advanced",
      "auth_unknown_state",
      "submitting_credentials",
      "auth_failed"
    ].includes(state);
  }

  canAcceptOtpSubmission(session) {
    const state = String(session?.authAssist?.state ?? "").trim();
    if (!state) {
      return false;
    }
    return ["awaiting_otp", "submitting_otp", "auth_failed"].includes(state);
  }

  canSkipAuthAssist(session) {
    const state = String(session?.authAssist?.state ?? "").trim();
    if (!state) {
      return ["login-assist", "waiting-login"].includes(session?.status ?? "");
    }
    if (["authenticated", "resumed", "running"].includes(state)) {
      return false;
    }
    return [
      "awaiting_username",
      "awaiting_password",
      "awaiting_credentials",
      "awaiting_otp",
      "auth_step_advanced",
      "auth_unknown_state",
      "submitting_credentials",
      "submitting_otp",
      "auth_failed",
      "auth_skipped"
    ].includes(state);
  }

  async skipSessionAuth(sessionId, { reason = "Credential submission was skipped by user." } = {}) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return {
        ok: false,
        code: "SESSION_NOT_FOUND",
        message: "Session not found."
      };
    }

    if (isTerminalStatus(session.status)) {
      return {
        ok: false,
        code: "SESSION_NOT_ACTIVE",
        message: "Session is already complete.",
        authAssist: session.authAssist ?? null
      };
    }

    if (session.status === "cancelled" || this.isStopRequested(sessionId)) {
      return {
        ok: false,
        code: "RUN_STOPPED",
        message: "Run has been stopped and cannot skip auth assist.",
        authAssist: session.authAssist ?? null
      };
    }

    if (!this.canSkipAuthAssist(session)) {
      return {
        ok: false,
        code: "AUTH_STATE_INVALID",
        message: "Session is not in a state that can skip authentication.",
        authAssist: session.authAssist ?? null
      };
    }

    const skipReason = String(reason ?? "").trim() || "Credential submission was skipped by user.";
    const currentProbe = this.getActiveBrowserSession(sessionId)
      ? await this.getActiveBrowserSession(sessionId).collectAuthFormProbe().catch(() => null)
      : null;

    const authState = this.patchAuthAssistState(sessionId, {
      state: "auth_failed",
      code: "LOGIN_SKIPPED",
      reason: skipReason,
      probe: currentProbe,
      source: "api",
      endedAt: nowIso(),
      status: "running",
      resumeTargetUrl:
        session.authAssist?.resumeTargetUrl ??
        session.loginAssist?.resumeTargetUrl ??
        this.resolveResumeTargetUrl(sessionId, session.currentUrl ?? session.startUrl),
      resumeCheckpoint:
        session.authAssist?.resumeCheckpoint ??
        session.loginAssist?.resumeCheckpoint ??
        {
          mode: session.runConfig?.testMode ?? "default",
          step: session.currentStep ?? 0
        },
      submitAttempted: Boolean(session.authAssist?.submitAttempted),
      resumeTriggered: false,
      resumeRequestedAt: nowIso()
    });

    this.sessionStore.appendTimeline(sessionId, {
      type: "auth-assist",
      message: "Credential entry skipped by user."
    });
    this.emitSessionUpdate(sessionId);
    return {
      ok: true,
      code: "LOGIN_SKIPPED",
      message: "Authentication step skipped by user.",
      authAssist: authState
    };
  }

  async submitSessionCredentials(sessionId, credentials = {}) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return {
        ok: false,
        code: "SESSION_NOT_FOUND",
        message: "Session not found."
      };
    }

    if (isTerminalStatus(session.status)) {
      return {
        ok: false,
        code: "SESSION_NOT_ACTIVE",
        message: "Session is already complete.",
        authAssist: session.authAssist ?? null
      };
    }

    if (session.status === "cancelled" || this.isStopRequested(sessionId)) {
      return {
        ok: false,
        code: "RUN_STOPPED",
        message: "Run has been stopped and cannot accept credentials.",
        authAssist: session.authAssist ?? null
      };
    }

    const browserSession = this.getActiveBrowserSession(sessionId);
    if (!browserSession) {
      return {
        ok: false,
        code: "SESSION_NOT_ACTIVE",
        message: "The session is not active."
      };
    }

    if (!this.canAcceptCredentialSubmission(session)) {
      return {
        ok: false,
        code: "AUTH_STATE_INVALID",
        message: "Session is not waiting for credentials.",
        authAssist: session.authAssist ?? null
      };
    }

    if (this.authSubmissionLocks.has(sessionId)) {
      return {
        ok: false,
        code: "AUTH_SUBMISSION_IN_PROGRESS",
        message: "Authentication submission is already in progress."
      };
    }

    const normalizedIdentifier = resolveFirstCredentialAlias(credentials);
    const normalizedPassword = String(credentials?.password ?? "");
    if (!normalizedIdentifier || !normalizedPassword) {
      return {
        ok: false,
        code: "INVALID_AUTH_INPUT",
        message: "Both first credential (identifier/username/email) and password are required."
      };
    }

    this.authSubmissionLocks.add(sessionId);
    try {
      const submissionRequestedAt = nowIso();
      const resumeTargetUrl = this.resolveResumeTargetUrl(
        sessionId,
        session.authAssist?.resumeTargetUrl || session.loginAssist?.resumeTargetUrl || session.currentUrl || session.startUrl
      );
      const resumeCheckpoint =
        session.authAssist?.resumeCheckpoint ??
        session.loginAssist?.resumeCheckpoint ??
        {
          mode: session.runConfig?.testMode ?? "default",
          step: session.currentStep ?? 0
        };
      const currentProbe = await browserSession.collectAuthFormProbe();
      this.patchAuthAssistState(sessionId, {
        state: "submitting_credentials",
        code: "SUBMITTING_CREDENTIALS",
        reason: "Submitting credentials to the active login form.",
        probe: currentProbe,
        source: "api",
        resumeTargetUrl,
        resumeCheckpoint,
        submitAttempted: true,
        resumeTriggered: false,
        resumeRequestedAt: submissionRequestedAt
      });

      const submission = await browserSession.submitAuthCredentials({
        identifier: normalizedIdentifier,
        username: normalizedIdentifier,
        email: normalizedIdentifier,
        password: normalizedPassword
      });
      const submissionRuntimeMeta = {
        browserActionExecuted: Boolean(submission?.browserActionExecuted),
        identifierFilled: Boolean(submission?.identifierFilled ?? submission?.usernameFilled),
        usernameFilled: Boolean(submission?.usernameFilled),
        passwordFilled: Boolean(submission?.passwordFilled),
        submitTriggered: Boolean(submission?.submitTriggered),
        submitControlType: submission?.submitControlType ?? "none",
        postSubmitUrlChanged: Boolean(submission?.postSubmitUrlChanged),
        postSubmitProbeState: submission?.postSubmitProbeState ?? null
      };
      this.sessionStore.appendTimeline(sessionId, {
        type: "auth-assist",
        message: [
          "Credential submit runtime:",
          `identifierFilled=${submissionRuntimeMeta.identifierFilled ? "yes" : "no"}`,
          `passwordFilled=${submissionRuntimeMeta.passwordFilled ? "yes" : "no"}`,
          `submitTriggered=${submissionRuntimeMeta.submitTriggered ? "yes" : "no"}`,
          `submitControlType=${submissionRuntimeMeta.submitControlType}`,
          `postSubmitProbeState=${submissionRuntimeMeta.postSubmitProbeState ?? "unknown"}`,
          `postSubmitUrlChanged=${submissionRuntimeMeta.postSubmitUrlChanged ? "yes" : "no"}`
        ].join(" ")
      });
      const nextProbe = submission.probe ?? (await browserSession.collectAuthFormProbe());
      const confirmation =
        typeof browserSession.confirmAuthenticatedSession === "function"
          ? await browserSession.confirmAuthenticatedSession({
              resumeTargetUrl,
              timeoutMs: 9_000,
              pollMs: Math.max(config.loginAssistPollMs, 240)
            })
          : null;
      const effectiveProbe = confirmation?.probe ?? nextProbe;
      const authenticated = Boolean(
        confirmation?.state === "authenticated" || submission.authenticated
      );

      if (authenticated) {
        await browserSession.persistStorageState();
        if (session.profile) {
          await this.profileManager.saveHealth(session.profile, {
            lastLoginAt: nowIso(),
            lastBlockerType: null
          });
        }
        const authState = this.patchAuthAssistState(sessionId, {
          state: "authenticated",
          code: "AUTH_VALIDATED",
          reason: "Credentials accepted and authentication detected.",
          probe: effectiveProbe,
          source: "api",
          endedAt: nowIso(),
          status: "running",
          resumeTargetUrl,
          resumeCheckpoint,
          resumedAt: nowIso(),
          submitAttempted: true,
          resumeTriggered: true,
          resumeRequestedAt: nowIso(),
          runtimeMeta: submissionRuntimeMeta
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: `Credentials accepted and authentication validated. Resuming run target ${resumeTargetUrl}.`
        });
        return {
          ok: true,
          code: "AUTH_VALIDATED",
          message: "Credentials accepted.",
          authAssist: authState
        };
      }

      if (confirmation?.state === "awaiting_otp") {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "awaiting_otp",
          code: "OTP_REQUIRED",
          reason: confirmation.reason || "OTP challenge detected. Enter the verification code to continue.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          resumeRequestedAt: nowIso(),
          runtimeMeta: submissionRuntimeMeta
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: "OTP challenge detected after credential submission."
        });
        return {
          ok: true,
          code: "OTP_REQUIRED",
          message: "OTP challenge detected.",
          authAssist: authState
        };
      }

      const derived = deriveAuthAssistState(effectiveProbe, {
        previousProbe: currentProbe,
        submission
      });
      if (derived.state === "awaiting_otp") {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "awaiting_otp",
          code: "OTP_REQUIRED",
          reason: "OTP challenge detected. Enter the verification code to continue.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          resumeRequestedAt: nowIso(),
          runtimeMeta: submissionRuntimeMeta
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: "OTP challenge detected after credential submission."
        });
        return {
          ok: true,
          code: "OTP_REQUIRED",
          message: "OTP challenge detected.",
          authAssist: authState
        };
      }

      if (derived.code === "CAPTCHA_BOT_DETECTED") {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "auth_failed",
          code: "CAPTCHA_BOT_DETECTED",
          reason: "CAPTCHA challenge detected. Complete the challenge manually to continue.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          runtimeMeta: submissionRuntimeMeta
        });
        return {
          ok: false,
          code: "CAPTCHA_BOT_DETECTED",
          message: "CAPTCHA challenge detected.",
          authAssist: authState
        };
      }

      if (
        ["awaiting_username", "awaiting_password", "auth_step_advanced"].includes(
          derived.state
        ) ||
        (derived.state === "awaiting_credentials" && derived.code === "AUTH_STEP_ADVANCED")
      ) {
        const authState = this.patchAuthAssistState(sessionId, {
          state: derived.state,
          code: derived.code,
          reason: derived.reason,
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          resumeRequestedAt: nowIso(),
          runtimeMeta: submissionRuntimeMeta
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: derived.reason || "Authentication step advanced."
        });
        return {
          ok: true,
          code: derived.code ?? "AUTH_STEP_ADVANCED",
          message: derived.reason ?? "Authentication step advanced.",
          authAssist: authState
        };
      }

      if (derived.code === "INVALID_CREDENTIALS") {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "auth_failed",
          code: "INVALID_CREDENTIALS",
          reason: derived.reason || "Credentials were rejected by the authentication form.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          runtimeMeta: submissionRuntimeMeta
        });
        return {
          ok: false,
          code: "INVALID_CREDENTIALS",
          message: derived.reason || "Credentials were rejected by the authentication form.",
          authAssist: authState
        };
      }

      if (
        Boolean(submission?.submitTriggered) &&
        ["awaiting_credentials", "auth_unknown_state", "running"].includes(derived.state)
      ) {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "submitting_credentials",
          code: "CREDENTIALS_SUBMITTED",
          reason:
            "Credentials were submitted to the active login form. Waiting for authentication transition.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          resumeRequestedAt: nowIso(),
          runtimeMeta: submissionRuntimeMeta
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: "Credentials submitted to active login form. Waiting for auth transition."
        });
        return {
          ok: true,
          code: "CREDENTIALS_SUBMITTED",
          message: "Credentials submitted. Waiting for authentication transition.",
          authAssist: authState
        };
      }

      if (!submissionRuntimeMeta.submitTriggered && derived.state === "awaiting_credentials") {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "awaiting_credentials",
          code: "AUTH_SUBMIT_NOT_TRIGGERED",
          reason:
            submission?.reason ||
            "Credentials were entered but no actionable submit transition was triggered.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          runtimeMeta: submissionRuntimeMeta
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message:
            "Credential entry completed but no deterministic submit trigger was detected; remaining in awaiting_credentials."
        });
        return {
          ok: false,
          code: "AUTH_SUBMIT_NOT_TRIGGERED",
          message:
            submission?.reason ||
            "Credentials were entered but no actionable submit transition was triggered.",
          authAssist: authState
        };
      }

      const authState = this.patchAuthAssistState(sessionId, {
        state: derived.state === "running" ? "auth_unknown_state" : (derived.state || "auth_unknown_state"),
        code: derived.code ?? "AUTH_UNKNOWN_STATE",
        reason:
          derived.reason ||
          "Authentication did not complete yet and no explicit invalid-credential error was detected.",
        probe: effectiveProbe,
        source: "api",
        resumeTargetUrl,
        resumeCheckpoint,
        submitAttempted: true,
        resumeTriggered: false,
        runtimeMeta: submissionRuntimeMeta
      });
      return {
        ok: false,
        code: derived.code ?? "AUTH_UNKNOWN_STATE",
        message:
          derived.reason ||
          "Authentication did not complete yet and no explicit invalid-credential error was detected.",
        authAssist: authState
      };
    } finally {
      this.authSubmissionLocks.delete(sessionId);
    }
  }

  async submitSessionOtp(sessionId, { otp }) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return {
        ok: false,
        code: "SESSION_NOT_FOUND",
        message: "Session not found."
      };
    }

    if (isTerminalStatus(session.status)) {
      return {
        ok: false,
        code: "SESSION_NOT_ACTIVE",
        message: "Session is already complete.",
        authAssist: session.authAssist ?? null
      };
    }

    if (session.status === "cancelled" || this.isStopRequested(sessionId)) {
      return {
        ok: false,
        code: "RUN_STOPPED",
        message: "Run has been stopped and cannot accept OTP.",
        authAssist: session.authAssist ?? null
      };
    }

    const browserSession = this.getActiveBrowserSession(sessionId);
    if (!browserSession) {
      return {
        ok: false,
        code: "SESSION_NOT_ACTIVE",
        message: "The session is not active."
      };
    }

    if (!this.canAcceptOtpSubmission(session)) {
      return {
        ok: false,
        code: "AUTH_STATE_INVALID",
        message: "Session is not waiting for OTP.",
        authAssist: session.authAssist ?? null
      };
    }

    if (this.authSubmissionLocks.has(sessionId)) {
      return {
        ok: false,
        code: "AUTH_SUBMISSION_IN_PROGRESS",
        message: "Authentication submission is already in progress."
      };
    }

    const normalizedOtp = String(otp ?? "").trim();
    if (!normalizedOtp) {
      return {
        ok: false,
        code: "INVALID_OTP_INPUT",
        message: "OTP value is required."
      };
    }

    this.authSubmissionLocks.add(sessionId);
    try {
      const otpSubmissionRequestedAt = nowIso();
      const resumeTargetUrl = this.resolveResumeTargetUrl(
        sessionId,
        session.authAssist?.resumeTargetUrl || session.loginAssist?.resumeTargetUrl || session.currentUrl || session.startUrl
      );
      const resumeCheckpoint =
        session.authAssist?.resumeCheckpoint ??
        session.loginAssist?.resumeCheckpoint ??
        {
          mode: session.runConfig?.testMode ?? "default",
          step: session.currentStep ?? 0
        };
      const currentProbe = await browserSession.collectAuthFormProbe();
      this.patchAuthAssistState(sessionId, {
        state: "submitting_otp",
        code: "SUBMITTING_OTP",
        reason: "Submitting OTP verification code.",
        probe: currentProbe,
        source: "api",
        resumeTargetUrl,
        resumeCheckpoint,
        submitAttempted: true,
        resumeTriggered: false,
        resumeRequestedAt: otpSubmissionRequestedAt
      });

      const submission = await browserSession.submitAuthOtp({
        otp: normalizedOtp
      });
      const nextProbe = submission.probe ?? (await browserSession.collectAuthFormProbe());
      const confirmation =
        typeof browserSession.confirmAuthenticatedSession === "function"
          ? await browserSession.confirmAuthenticatedSession({
              resumeTargetUrl,
              timeoutMs: 9_000,
              pollMs: Math.max(config.loginAssistPollMs, 240)
            })
          : null;
      const effectiveProbe = confirmation?.probe ?? nextProbe;
      const authenticated = Boolean(
        confirmation?.state === "authenticated" || submission.authenticated
      );

      if (authenticated) {
        await browserSession.persistStorageState();
        if (session.profile) {
          await this.profileManager.saveHealth(session.profile, {
            lastLoginAt: nowIso(),
            lastBlockerType: null
          });
        }
        const authState = this.patchAuthAssistState(sessionId, {
          state: "authenticated",
          code: "AUTH_VALIDATED",
          reason: "OTP accepted and authentication detected.",
          probe: effectiveProbe,
          source: "api",
          endedAt: nowIso(),
          status: "running",
          resumeTargetUrl,
          resumeCheckpoint,
          resumedAt: nowIso(),
          submitAttempted: true,
          resumeTriggered: true,
          resumeRequestedAt: nowIso()
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: `OTP accepted and authentication validated. Resuming run target ${resumeTargetUrl}.`
        });
        return {
          ok: true,
          code: "AUTH_VALIDATED",
          message: "OTP accepted.",
          authAssist: authState
        };
      }

      if (effectiveProbe.captchaDetected) {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "auth_failed",
          code: "CAPTCHA_BOT_DETECTED",
          reason: "CAPTCHA challenge detected. Complete the challenge manually to continue.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false
        });
        return {
          ok: false,
          code: "CAPTCHA_BOT_DETECTED",
          message: "CAPTCHA challenge detected.",
          authAssist: authState
        };
      }

      if (effectiveProbe.otpChallengeDetected || effectiveProbe.otpFieldDetected || confirmation?.state === "awaiting_otp") {
        if (effectiveProbe.invalidOtpErrorDetected) {
          const authState = this.patchAuthAssistState(sessionId, {
            state: "auth_failed",
            code: "OTP_INVALID",
            reason: "OTP challenge reported an invalid or expired code.",
            probe: effectiveProbe,
            source: "api",
            resumeTargetUrl,
            resumeCheckpoint,
            submitAttempted: true,
            resumeTriggered: false
          });
          return {
            ok: false,
            code: "OTP_INVALID",
            message: "OTP was not accepted.",
            authAssist: authState
          };
        }
        const authState = this.patchAuthAssistState(sessionId, {
          state: "awaiting_otp",
          code: "OTP_REQUIRED",
          reason: "OTP challenge is still pending.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false,
          resumeRequestedAt: nowIso()
        });
        return {
          ok: false,
          code: "OTP_REQUIRED",
          message: "OTP challenge is still pending.",
          authAssist: authState
        };
      }

      const derived = this.deriveAuthAssistStateFromProbe(effectiveProbe);
      if (derived.state === "awaiting_credentials") {
        const authState = this.patchAuthAssistState(sessionId, {
          state: "auth_failed",
          code: "LOGIN_REQUIRED",
          reason: "OTP step returned to login prompt. Submit credentials again.",
          probe: effectiveProbe,
          source: "api",
          resumeTargetUrl,
          resumeCheckpoint,
          submitAttempted: true,
          resumeTriggered: false
        });
        return {
          ok: false,
          code: "LOGIN_REQUIRED",
          message: "Login credentials are required again.",
          authAssist: authState
        };
      }

      const authState = this.patchAuthAssistState(sessionId, {
        state: "awaiting_otp",
        code: "OTP_REQUIRED",
        reason: "OTP challenge is still pending.",
        probe: effectiveProbe,
        source: "api",
        resumeTargetUrl,
        resumeCheckpoint,
        submitAttempted: true,
        resumeTriggered: false,
        resumeRequestedAt: nowIso()
      });
      return {
        ok: false,
        code: "OTP_REQUIRED",
        message: "OTP challenge is still pending.",
        authAssist: authState
      };
    } finally {
      this.authSubmissionLocks.delete(sessionId);
    }
  }

  async handleLoginAssist({ sessionId, browserSession, domain, resumeTargetUrl = null, resumeCheckpoint = null }) {
    const session = this.sessionStore.getSession(sessionId);
    const timeoutMs = session?.runConfig?.functional?.loginAssist?.timeoutMs ?? config.loginAssistTimeoutMs;
    const startedAt = Date.now();
    const resolvedResumeTargetUrl = this.resolveResumeTargetUrl(
      sessionId,
      resumeTargetUrl ?? session?.currentUrl ?? session?.startUrl ?? ""
    );
    const resolvedResumeCheckpoint = resumeCheckpoint ?? {
      mode: session?.runConfig?.testMode ?? "default",
      step: session?.currentStep ?? 0
    };
    const initialProbe = await browserSession.collectAuthFormProbe();
    const initial = this.deriveAuthAssistStateFromProbe(initialProbe);

    const attemptResume = async (reason = "Authentication validated and run resumed.") => {
      const authAssistBeforeResume = this.sessionStore.getSession(sessionId)?.authAssist ?? null;
      if (isAuthAssistSkipRequested(authAssistBeforeResume)) {
        return false;
      }
      let probe = await browserSession.collectAuthFormProbe();
      if (typeof browserSession.confirmAuthenticatedSession === "function") {
        const confirmation = await browserSession.confirmAuthenticatedSession({
          resumeTargetUrl: resolvedResumeTargetUrl,
          timeoutMs: Math.min(Math.max(timeoutMs, 2_500), 9_000),
          pollMs: Math.max(config.loginAssistPollMs, 240)
        });
        probe = confirmation?.probe ?? probe;

        if (confirmation?.state === "awaiting_otp") {
          this.patchAuthAssistState(sessionId, {
            state: "awaiting_otp",
            code: "OTP_REQUIRED",
            reason: confirmation.reason || "OTP challenge detected while resuming authentication.",
            probe: {
              ...probe,
              site: probe.site || domain
            },
            timeoutMs,
            status: "login-assist",
            source: "probe",
            resumeTargetUrl: resolvedResumeTargetUrl,
            resumeCheckpoint: resolvedResumeCheckpoint,
            submitAttempted: true,
            resumeTriggered: false
          });
          return false;
        }

        if (confirmation?.state !== "authenticated") {
          return false;
        }
      }

      const currentSession = this.sessionStore.getSession(sessionId);
      if (currentSession?.profile) {
        await this.profileManager.saveHealth(currentSession.profile, {
          lastLoginAt: nowIso(),
          lastBlockerType: null
        });
      }
      this.patchAuthAssistState(sessionId, {
        state: "resumed",
        code: "AUTH_VALIDATED",
        reason: reason || "Authentication validated and run resumed.",
        probe: {
          ...probe,
          site: probe.site || domain
        },
        timeoutMs,
        endedAt: nowIso(),
        resumedAt: nowIso(),
        status: "running",
        source: "probe",
        resumeTargetUrl: resolvedResumeTargetUrl,
        resumeCheckpoint: resolvedResumeCheckpoint,
        resumeTriggered: true
      });
      this.sessionStore.appendTimeline(sessionId, {
        type: "auth-assist",
        message: `Authentication validated for ${domain}; resuming run at ${resolvedResumeTargetUrl}.`
      });
      return true;
    };

    this.patchAuthAssistState(sessionId, {
      state: initial.state === "running" ? "awaiting_credentials" : initial.state,
      code: initial.code === "AUTH_NOT_REQUIRED" ? "LOGIN_REQUIRED" : initial.code,
      reason:
        initial.code === "AUTH_NOT_REQUIRED"
          ? `Authentication is required for ${domain}.`
          : initial.reason,
      probe: {
        ...initialProbe,
        site: initialProbe.site || domain
      },
      timeoutMs,
      startedAt: nowIso(),
      remainingMs: timeoutMs,
      status: "login-assist",
      source: "probe",
      resumeTargetUrl: resolvedResumeTargetUrl,
      resumeCheckpoint: resolvedResumeCheckpoint,
      resumeTriggered: false
    });
    this.sessionStore.patchSession(sessionId, {
      loginAssist: {
        ...(this.sessionStore.getSession(sessionId)?.loginAssist ?? {}),
        resumeTargetUrl: resolvedResumeTargetUrl,
        resumeCheckpoint: resolvedResumeCheckpoint
      }
    });
    this.sessionStore.appendTimeline(sessionId, {
      type: "auth-assist",
      message: `Authentication required for ${domain}. Awaiting secure dashboard input.`
    });

    let lastResumeRequestAt = null;
    while (Date.now() - startedAt < timeoutMs) {
      this.throwIfStopRequested(sessionId);
      const currentSession = this.sessionStore.getSession(sessionId);
      const currentAuthAssist = currentSession?.authAssist ?? null;
      if (isAuthAssistSkipRequested(currentAuthAssist)) {
        this.patchAuthAssistState(sessionId, {
          state: "auth_failed",
          code: "LOGIN_SKIPPED",
          reason:
            currentAuthAssist?.reason ||
            "Credential submission was skipped by user.",
          probe: await browserSession.collectAuthFormProbe().catch(() => null),
          timeoutMs,
          remainingMs: Math.max(timeoutMs - (Date.now() - startedAt), 0),
          endedAt: nowIso(),
          status: "running",
          source: currentAuthAssist?.source ?? "api",
          resumeTargetUrl: resolvedResumeTargetUrl,
          resumeCheckpoint: resolvedResumeCheckpoint,
          submitAttempted: Boolean(currentAuthAssist?.submitAttempted),
          resumeTriggered: false
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: "Login assist skipped by user. Continuing without authenticated access."
        });
        return false;
      }
      const resumeRequestAt =
        currentAuthAssist?.resumeRequestedAt ??
        currentSession?.loginAssist?.resumeRequestedAt ??
        null;
      const forceResumeCheck = Boolean(resumeRequestAt && resumeRequestAt !== lastResumeRequestAt);
      if (forceResumeCheck) {
        lastResumeRequestAt = resumeRequestAt;
        this.sessionStore.appendTimeline(sessionId, {
          type: "auth-assist",
          message: "Resume check requested; re-validating authentication state."
        });
      } else {
        await sleep(config.loginAssistPollMs);
      }
      this.throwIfStopRequested(sessionId);

      const latestAuthAssist = this.sessionStore.getSession(sessionId)?.authAssist ?? null;
      if (isAuthAssistSkipRequested(latestAuthAssist)) {
        continue;
      }
      if (isAuthAssistReadyToResume(latestAuthAssist)) {
        if (await attemptResume(latestAuthAssist?.reason || "Authentication validated and run resumed.")) {
          return true;
        }
      }

      const authAssistBeforeAuthCheck = this.sessionStore.getSession(sessionId)?.authAssist ?? null;
      if (isAuthAssistSkipRequested(authAssistBeforeAuthCheck)) {
        continue;
      }
      const elapsedMs = Date.now() - startedAt;
      const passiveResumeDelayMs = Math.max(Math.min(config.loginAssistPollMs, 3_000), 200);
      const allowPassiveAuthResume = forceResumeCheck || elapsedMs >= passiveResumeDelayMs;
      if (allowPassiveAuthResume) {
        const authenticated = await browserSession.isAuthenticated();
        if (authenticated) {
          if (await attemptResume("Authentication validated and run resumed.")) {
            return true;
          }
        }
      }

      const probe = await browserSession.collectAuthFormProbe();
      const freshestAuthAssist = this.sessionStore.getSession(sessionId)?.authAssist ?? latestAuthAssist;
      if (isAuthAssistSkipRequested(freshestAuthAssist)) {
        continue;
      }
      if (isAuthAssistReadyToResume(freshestAuthAssist)) {
        if (await attemptResume(freshestAuthAssist?.reason || "Authentication validated and run resumed.")) {
          return true;
        }
      }
      const derived = mergeDerivedAuthAssistState({
        currentAuthAssist: freshestAuthAssist,
        derivedState: this.deriveAuthAssistStateFromProbe(probe)
      });
      const elapsedSinceStartMs = Date.now() - startedAt;
      const preserveApiState =
        freshestAuthAssist?.source === "api" &&
        freshestAuthAssist?.state === derived?.state &&
        freshestAuthAssist?.code === derived?.code;
      this.patchAuthAssistState(sessionId, {
        state: derived.state === "running" ? "awaiting_credentials" : derived.state,
        code: derived.code === "AUTH_NOT_REQUIRED" ? "LOGIN_REQUIRED" : derived.code,
        reason: derived.reason,
        probe: {
          ...probe,
          site: probe.site || domain
        },
        timeoutMs,
        remainingMs: Math.max(timeoutMs - elapsedSinceStartMs, 0),
        status: "login-assist",
        source: preserveApiState ? "api" : "probe",
        resumeTargetUrl: resolvedResumeTargetUrl,
        resumeCheckpoint: resolvedResumeCheckpoint
      });

      if (derived.code === "CAPTCHA_BOT_DETECTED") {
        return false;
      }
    }

    this.patchAuthAssistState(sessionId, {
      state: "auth_failed",
      code: "LOGIN_ASSIST_TIMEOUT",
      reason: "Authentication assist timed out before login was completed.",
      probe: {
        ...(await browserSession.collectAuthFormProbe()),
        site: domain
      },
      timeoutMs,
      remainingMs: 0,
      endedAt: nowIso(),
      status: "login-assist",
      source: "probe",
      resumeTargetUrl: resolvedResumeTargetUrl,
      resumeCheckpoint: resolvedResumeCheckpoint
    });
    return false;
  }

  async resumeSession(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (session.status === "cancelled" || this.isStopRequested(sessionId)) {
      return session;
    }

    const updated = this.sessionStore.patchSession(sessionId, {
      loginAssist: {
        ...(session.loginAssist ?? {}),
        resumeRequestedAt: nowIso()
      },
      authAssist: {
        ...(session.authAssist ?? {}),
        source: "manual",
        resumeRequestedAt: nowIso()
      }
    });
    this.emitSessionUpdate(sessionId);
    return updated;
  }

  async stopSession(sessionId, { reason = "Run stop requested by user." } = {}) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return {
        ok: false,
        code: "SESSION_NOT_FOUND",
        message: "Session not found.",
        session: null
      };
    }

    if (isTerminalStatus(session.status)) {
      return {
        ok: false,
        code: "SESSION_NOT_ACTIVE",
        message: "Session is already complete.",
        session
      };
    }

    const control = this.ensureRunControl(sessionId);
    const requestedAt = nowIso();
    control.stopRequested = true;
    control.stopReason = reason;
    control.stopRequestedAt = requestedAt;

    const patched = this.sessionStore.patchSession(sessionId, {
      status: "cancelling",
      summary: reason,
      loginAssist: {
        ...(session.loginAssist ?? {}),
        state: "STOP_REQUESTED",
        resumeRequestedAt: requestedAt,
        endedAt: session.loginAssist?.endedAt ?? null
      },
      authAssist: session.authAssist
        ? {
            ...session.authAssist,
            source: "manual",
            code: "RUN_STOP_REQUESTED",
            reason,
            resumeRequestedAt: requestedAt,
            updatedAt: requestedAt
          }
        : null
    });
    this.sessionStore.appendTimeline(sessionId, {
      type: "stop",
      message: reason
    });
    this.emitSessionUpdate(sessionId);

    const hasActiveExecution = this.activeRuns.has(sessionId) || this.activeBrowserSessions.has(sessionId);
    if (!hasActiveExecution) {
      await this.finalizeStopped(sessionId, null, { reason });
      return {
        ok: true,
        code: "SESSION_STOPPED",
        message: reason,
        session: this.sessionStore.getSession(sessionId)
      };
    }

    return {
      ok: true,
      code: "SESSION_STOP_REQUESTED",
      message: reason,
      session: patched ?? session
    };
  }

  buildUiuxActionContract(action, actionKind = "NAV_CLICK") {
    return {
      actionType: action?.type ?? "click",
      target: {
        semanticId: action?.elementId ?? null,
        locator: null,
        fallback: action?.url ?? null
      },
      inputValue: action?.text ?? null,
      rationale: `UI/UX safe interaction (${actionKind})`,
      safetyTags: [`uiux:${String(actionKind).toLowerCase()}`],
      expectedStateChange: "Reveal additional UI state while preserving safety constraints."
    };
  }

  buildOptionalUiuxVideoEvidence(sessionId, severity) {
    if (!["P0", "P1"].includes(severity ?? "")) {
      return [];
    }
    const video = this.sessionStore.getSession(sessionId)?.artifactIndex?.video?.at(-1) ?? null;
    if (!video?.url && !video?.relativePath) {
      return [];
    }
    return [
      {
        type: "video",
        ref: video.url ?? video.relativePath
      }
    ];
  }

  async maybeHandleUiuxLoginAssist({
    sessionId,
    browserSession,
    frontier,
    currentUrl,
    discoveredFrom = null,
    snapshot = null,
    step = 0,
    depth = 0
  }) {
    const authProbe = await browserSession.collectAuthFormProbe().catch(() => null);
    const authState = authProbe ? this.deriveAuthAssistStateFromProbe(authProbe) : null;
    const loginRequiredStates = new Set([
      "awaiting_credentials",
      "awaiting_username",
      "awaiting_password",
      "awaiting_otp"
    ]);
    const loginRequiredCodes = new Set([
      "LOGIN_REQUIRED",
      "LOGIN_USERNAME_REQUIRED",
      "LOGIN_PASSWORD_REQUIRED",
      "OTP_REQUIRED"
    ]);
    const loginWallDetectedFromProbe = Boolean(
      authProbe &&
        (authProbe.loginWallDetected ||
          authProbe.identifierFieldDetected ||
          authProbe.usernameFieldDetected ||
          authProbe.passwordFieldDetected ||
          authProbe.otpFieldDetected)
    );
    const loginStateFromProbe = Boolean(
      authState &&
        (loginRequiredStates.has(authState.state) || loginRequiredCodes.has(authState.code))
    );
    const loginWallDetectedFromSnapshot = Boolean(
      snapshot &&
        this.snapshotShowsLoginCredentialStep(snapshot)
    );

    if (
      !(loginWallDetectedFromProbe || loginWallDetectedFromSnapshot) ||
      !(loginStateFromProbe || loginWallDetectedFromSnapshot)
    ) {
      return {
        handled: false,
        resumed: false,
        authState
      };
    }

    const safeCurrentUrl = String(currentUrl || browserSession.getCurrentUrl?.() || "").trim();
    const resumed = await this.handleLoginAssist({
      sessionId,
      browserSession,
      domain: (() => {
        try {
          return new URL(safeCurrentUrl).hostname;
        } catch {
          return "target";
        }
      })(),
      resumeTargetUrl: this.resolveResumeTargetUrl(sessionId, safeCurrentUrl),
      resumeCheckpoint: {
        mode: "uiux",
        step,
        url: safeCurrentUrl
      }
    });

    if (resumed && frontier) {
      const resumedUrl = String(browserSession.getCurrentUrl?.() || safeCurrentUrl).trim();
      if (resumedUrl) {
        frontier.push(resumedUrl, {
          discoveredFrom: discoveredFrom || safeCurrentUrl,
          step,
          url: resumedUrl,
          depth
        });
      }
    }

    return {
      handled: true,
      resumed,
      authState
    };
  }

  snapshotShowsLoginCredentialStep(snapshot = {}) {
    const formControls = Array.isArray(snapshot.formControls) ? snapshot.formControls : [];
    const interactive = Array.isArray(snapshot.interactive) ? snapshot.interactive : [];
    const normalize = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const controlText = (control = {}) =>
      normalize(
        [
          control.labelText,
          control.placeholder,
          control.ariaLabel,
          control.name,
          control.type,
          control.tag
        ]
          .filter(Boolean)
          .join(" ")
      );
    const interactiveText = (entry = {}) =>
      normalize(
        [entry.text, entry.ariaLabel, entry.placeholder, entry.name, entry.id, entry.href]
          .filter(Boolean)
          .join(" ")
      );

    const identifierPattern =
      /\b(access key|identifier|username|email|login id|account id|user id|member id|portal key|sign[- ]?in id)\b/i;
    const passwordPattern = /\bpassword|passcode|pin\b/i;
    const submitPattern =
      /\b(sign in|log in|login|submit|continue|next|verify|confirm|proceed|access account)\b/i;

    const visibleControls = formControls.filter((control) => control?.inViewport !== false);
    const visibleInteractive = interactive.filter(
      (entry) => entry?.inViewport && !entry?.disabled
    );

    const passwordFieldDetected = visibleControls.some((control) =>
      passwordPattern.test(controlText(control))
    );
    const identifierFieldDetected = visibleControls.some((control) =>
      identifierPattern.test(controlText(control))
    );
    const textLikeFieldDetected = visibleControls.some((control) => {
      const type = normalize(control.type);
      const tag = normalize(control.tag);
      return ["input", "textarea"].includes(tag) && ["", "text", "email", "search"].includes(type);
    });
    const submitControlDetected = visibleInteractive.some((entry) =>
      submitPattern.test(interactiveText(entry))
    );

    return Boolean(
      passwordFieldDetected &&
        submitControlDetected &&
        (identifierFieldDetected || textLikeFieldDetected)
    );
  }

  upsertUiuxPageDeviceResult(sessionId, nextEntry) {
    const session = this.sessionStore.getSession(sessionId);
    const currentUiux = session?.uiux ?? {};
    const matrix = [...(currentUiux.pageDeviceMatrix ?? [])];
    const key = `${nextEntry.pageUrl}|${nextEntry.deviceLabel}`;
    const existingIndex = matrix.findIndex(
      (entry) => `${entry.pageUrl}|${entry.deviceLabel}` === key
    );

    const failedChecks = [...new Set(nextEntry.failedChecks ?? [])].sort((left, right) =>
      left.localeCompare(right)
    );
    const existing = existingIndex >= 0 ? matrix[existingIndex] : null;
    const merged = {
      pageUrl: nextEntry.pageUrl,
      canonicalUrl: nextEntry.canonicalUrl ?? nextEntry.pageUrl,
      deviceLabel: nextEntry.deviceLabel,
      status:
        nextEntry.status === "failed" || existing?.status === "failed"
          ? "failed"
          : "passed",
      failedChecks:
        nextEntry.status === "failed" || existing?.status === "failed"
          ? [...new Set([...(existing?.failedChecks ?? []), ...failedChecks])].sort((left, right) =>
              left.localeCompare(right)
            )
          : [],
      worstSeverity: worstSeverity(existing?.worstSeverity ?? null, nextEntry.worstSeverity ?? "P3"),
      screenshotRef:
        nextEntry.screenshotRef ??
        existing?.screenshotRef ??
        null
    };

    if (existingIndex >= 0) {
      matrix[existingIndex] = merged;
    } else {
      matrix.push(merged);
    }

    const boundedMatrix = matrix
      .sort((left, right) => {
        if (left.pageUrl !== right.pageUrl) {
          return left.pageUrl.localeCompare(right.pageUrl);
        }
        return left.deviceLabel.localeCompare(right.deviceLabel);
      })
      .slice(-900);

    const summaryMap = boundedMatrix.reduce((map, entry) => {
      const current = map.get(entry.deviceLabel) ?? {
        deviceLabel: entry.deviceLabel,
        pagesPassed: 0,
        pagesFailed: 0,
        totalChecksFailed: 0,
        worstSeverity: "P3"
      };
      if (entry.status === "failed") {
        current.pagesFailed += 1;
        current.totalChecksFailed += entry.failedChecks.length;
        current.worstSeverity = worstSeverity(current.worstSeverity, entry.worstSeverity ?? "P2") ?? "P2";
      } else {
        current.pagesPassed += 1;
      }
      map.set(entry.deviceLabel, current);
      return map;
    }, new Map());

    const deviceSummary = sortDeviceSummary([...summaryMap.values()]);
    this.sessionStore.patchSession(sessionId, {
      uiux: {
        ...currentUiux,
        pageDeviceMatrix: boundedMatrix,
        deviceSummary,
        failingDevices: deviceSummary
          .filter((entry) => entry.pagesFailed > 0)
          .map((entry) => entry.deviceLabel)
      }
    });
  }

  async runUiuxAutonomousSession({
    sessionId,
    session,
    runConfig,
    browserSession,
    uiuxRunner,
    testCaseTracker,
    sessionStartAt
  }) {
    const frontier = this.createUiuxFrontier(runConfig, true);
    const deviceProfiles = resolveUiuxDeviceProfiles(runConfig);
    const checkIds = baselineUiuxChecks.map((check) => check.id);
    const effectiveBudget = buildUiuxEffectiveBudget({ runConfig });
    const maxPages = effectiveBudget.maxPages;
    const maxInteractionsPerPage = effectiveBudget.maxInteractionsPerPage;
    const timeBudgetMs = effectiveBudget.timeBudgetMs;
    const frameBuffer = new RingBuffer(Math.min(Math.max(runConfig.budgets.maxSteps, 8), 40));
    let stepCounter = 0;
    let scannedPages = 0;
    let stoppedByTimeBudget = false;

    const sessionUiux = this.sessionStore.getSession(sessionId)?.uiux ?? {};
    this.sessionStore.patchSession(sessionId, {
      uiux: {
        ...sessionUiux,
        effectiveBudget: {
          ...effectiveBudget,
          deviceCount: deviceProfiles.length,
          startedAt: nowIso()
        }
      },
      effectiveBudgets: {
        ...(this.sessionStore.getSession(sessionId)?.effectiveBudgets ?? {}),
        uiux: {
          ...effectiveBudget,
          deviceCount: deviceProfiles.length,
          startedAt: nowIso()
        }
      },
      summary: `UI/UX run started with timeBudgetMs=${timeBudgetMs}, maxPages=${maxPages}, maxInteractionsPerPage=${maxInteractionsPerPage}, devices=${deviceProfiles.length}.`
    });
    this.sessionStore.appendTimeline(sessionId, {
      type: "uiux-budget",
      message: `UI/UX effective budget: timeBudgetMs=${timeBudgetMs}, maxPages=${maxPages}, maxInteractionsPerPage=${maxInteractionsPerPage}, devices=${deviceProfiles.length}, checks=${checkIds.length}.`
    });
    this.emitSessionUpdate(sessionId);

    const shouldStop = () => {
      this.throwIfStopRequested(sessionId);
      return Date.now() - sessionStartAt >= timeBudgetMs;
    };

    while (frontier?.hasNext() && scannedPages < maxPages) {
      if (shouldStop()) {
        stoppedByTimeBudget = true;
        break;
      }
      const next = frontier.next();
      if (!next?.canonicalUrl) {
        continue;
      }

      const navigationDecision = this.safetyPolicy.evaluateNavigation(next.canonicalUrl, runConfig);
      if (!navigationDecision.allowed) {
        continue;
      }

      try {
        await browserSession.goto(next.canonicalUrl);
        await browserSession.waitForUIReady(
          runConfig.readiness.uiReadyStrategy,
          runConfig.readiness.readyTimeoutMs
        );
      } catch (error) {
        let failureEvidenceRefs = [];
        try {
          stepCounter += 1;
          const failureSnapshot = await browserSession.capture(
            `uiux-nav-fail-${scannedPages + 1}-${stepCounter}`,
            {
              artifactLabel: `uiux-nav-fail-${scannedPages + 1}-${stepCounter}`,
              includeUiuxSignals: true
            }
          );
          frameBuffer.push(failureSnapshot);
          failureEvidenceRefs = buildEvidenceRefs(failureSnapshot, frameBuffer.values());
        } catch {
          failureEvidenceRefs = [];
        }
        testCaseTracker?.discoverCases(1);
        const failedNavigationCase = testCaseTracker?.startCase({
          type: "uiux",
          pageUrl: next.canonicalUrl,
          canonicalUrl: next.canonicalUrl,
          deviceLabel: deviceProfiles[0]?.label ?? null,
          deviceId: deviceProfiles[0]?.id ?? null,
          caseKind: "VIEWPORT_RENDER",
          expected: "Page should be reachable during UI/UX crawl."
        });
        if (failedNavigationCase?.id) {
          testCaseTracker?.failCase(failedNavigationCase.id, {
            severity: "P1",
            actual: error?.message ?? "Navigation failed.",
            pageUrl: next.canonicalUrl,
            canonicalUrl: next.canonicalUrl,
            deviceLabel: deviceProfiles[0]?.label ?? null,
            deviceId: deviceProfiles[0]?.id ?? null,
            evidenceRefs: failureEvidenceRefs
          });
        }
        continue;
      }

      let preAuthSnapshot = null;
      try {
        stepCounter += 1;
        preAuthSnapshot = await browserSession.capture(
          `uiux-preauth-${scannedPages + 1}-${stepCounter}`,
          {
            artifactLabel: `uiux-preauth-${scannedPages + 1}-${stepCounter}`,
            includeFocusProbe: true,
            includeUiuxSignals: true
          }
        );
        frameBuffer.push(preAuthSnapshot);
        this.sessionStore.patchSession(sessionId, {
          currentUrl: preAuthSnapshot.url,
          currentStep: stepCounter,
          frame: `data:image/png;base64,${preAuthSnapshot.screenshotBase64}`,
          artifactIndex: browserSession.getArtifactIndex()
        });
        this.updateUiuxCoverage(sessionId, preAuthSnapshot, frontier);
        this.emitSessionUpdate(sessionId);
      } catch {
        preAuthSnapshot = null;
      }

      const authGate = await this.maybeHandleUiuxLoginAssist({
        sessionId,
        browserSession,
        frontier,
        currentUrl: browserSession.getCurrentUrl?.() || next.canonicalUrl,
        discoveredFrom: next.canonicalUrl,
        snapshot: preAuthSnapshot,
        step: stepCounter,
        depth: next.meta?.depth ?? frontier.getDepth(next.canonicalUrl) ?? 0
      });
      if (authGate.handled) {
        if (!authGate.resumed) {
          const latestSession = this.sessionStore.getSession(sessionId);
          const authAssist = latestSession?.authAssist ?? null;
          const blockerType = authAssist?.code === "LOGIN_SKIPPED" ? "LOGIN_SKIPPED" : "LOGIN_REQUIRED";
          await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
            blocker: {
              type: blockerType,
              confidence: 0.9,
              rationale:
                authAssist?.reason ||
                "Authentication is required and was not completed for UI/UX coverage."
            },
            summary:
              blockerType === "LOGIN_SKIPPED"
                ? "UI/UX run stopped because credential entry was skipped."
                : "UI/UX run stopped because authentication is required before safe exploration can continue.",
            nextBestAction: blockerType === "LOGIN_SKIPPED" ? "LOGIN_SKIPPED" : "WAIT_FOR_LOGIN",
            evidenceQualityScore: 0.8
          });
          return;
        }

        const resumedCanonical = frontier.canonicalize(
          browserSession.getCurrentUrl?.() || next.canonicalUrl
        );
        const nextCanonical = frontier.canonicalize(next.canonicalUrl);
        if (resumedCanonical !== nextCanonical) {
          frontier.markVisited(next.canonicalUrl);
          continue;
        }
      }

      const visitedCanonical = frontier.markVisited(next.canonicalUrl);
      scannedPages += 1;
      let interactionSnapshot = null;

      testCaseTracker?.discoverCases(
        deviceProfiles.length + deviceProfiles.length * checkIds.length
      );

      const interactionPrimaryDevice =
        deviceProfiles.find((profile) => ["desktop", "laptop"].includes(profile.deviceClass)) ??
        deviceProfiles[0] ??
        null;

      for (const profile of deviceProfiles) {
        if (shouldStop()) {
          stoppedByTimeBudget = true;
          break;
        }

        await browserSession.applyUiuxDeviceProfile(profile);
        await browserSession.waitForUIReady(
          runConfig.readiness.uiReadyStrategy,
          runConfig.readiness.readyTimeoutMs
        );

        stepCounter += 1;
        const snapshot = await browserSession.capture(`uiux-${scannedPages}-${profile.id}-${stepCounter}`, {
          artifactLabel: `uiux-${scannedPages}-${profile.id}-${stepCounter}`,
          viewportLabel: profile.label,
          deviceLabel: profile.label,
          deviceId: profile.id,
          includeFocusProbe: true,
          includeUiuxSignals: true
        });
        frameBuffer.push(snapshot);

        this.sessionStore.patchSession(sessionId, {
          currentUrl: snapshot.url,
          currentStep: stepCounter,
          frame: `data:image/png;base64,${snapshot.screenshotBase64}`,
          artifactIndex: browserSession.getArtifactIndex()
        });

        this.updateUiuxCoverage(sessionId, snapshot, frontier);
        const nextDepth = (next.meta?.depth ?? frontier.getDepth(visitedCanonical) ?? 0) + 1;
        const discoveredLinks = this.collectCandidateLinks(snapshot, runConfig);
        frontier.pushMany(discoveredLinks, (url) => ({
          discoveredFrom: snapshot.url,
          step: stepCounter,
          url,
          depth: nextDepth
        }));

        const renderCase = testCaseTracker?.startCase({
          type: "uiux",
          caseKind: "VIEWPORT_RENDER",
          expected: `Page should render on ${profile.label}.`,
          pageUrl: snapshot.url,
          canonicalUrl: frontier.canonicalize(snapshot.url),
          deviceLabel: profile.label,
          deviceId: profile.id
        });
        const renderEvidence = buildEvidenceRefs(snapshot, frameBuffer.values());
        if (renderCase?.id) {
          if (snapshot.uiReadyState?.timedOut) {
            testCaseTracker?.failCase(renderCase.id, {
              severity: "P1",
              actual: "UI readiness timed out while rendering this viewport.",
              explanation: {
                whatHappened: "Viewport render did not reach ready state in time.",
                whyItFailed: "The readiness gate timed out for this viewport snapshot.",
                whyItMatters: "Checks on unstable UI states are unreliable and users experience a stuck screen.",
                recommendedFix: [
                  "Investigate long-loading resources and blocking overlays.",
                  "Stabilize render timing before running UI checks."
                ]
              },
              pageUrl: snapshot.url,
              canonicalUrl: frontier.canonicalize(snapshot.url),
              deviceLabel: profile.label,
              deviceId: profile.id,
              evidenceRefs: renderEvidence
            });
          } else {
            testCaseTracker?.completeCase(renderCase.id, {
              status: "passed",
              actual: "Viewport rendered and reached ready state.",
              pageUrl: snapshot.url,
              canonicalUrl: frontier.canonicalize(snapshot.url),
              deviceLabel: profile.label,
              deviceId: profile.id,
              evidenceRefs: renderEvidence
            });
          }
        }

        const issues = uiuxRunner.run({
          snapshot,
          stage: scannedPages === 1 ? "initial" : "navigation"
        });
        this.recordUiuxIssues(sessionId, issues);

        const issueByType = new Map();
        for (const issue of issues) {
          if (!issueByType.has(issue.issueType)) {
            issueByType.set(issue.issueType, issue);
          }
        }

        const failedChecks = [];
        let deviceWorstSeverity = null;
        for (const checkId of checkIds) {
          const checkCase = testCaseTracker?.startCase({
            type: "uiux",
            caseKind: "UI_CHECK",
            expected: `${checkId} should not fail on ${profile.label}.`,
            pageUrl: snapshot.url,
            canonicalUrl: frontier.canonicalize(snapshot.url),
            deviceLabel: profile.label,
            deviceId: profile.id
          });

          const issue = issueByType.get(checkId) ?? null;
          if (issue && checkCase?.id) {
            const calibratedVerdict =
              issue.calibratedJudgment?.verdict ??
              issue.calibratedVerdict ??
              "FAIL";
            if (calibratedVerdict === "FAIL") {
              failedChecks.push(checkId);
              deviceWorstSeverity = worstSeverity(deviceWorstSeverity, issue.severity ?? "P2");
              testCaseTracker?.failCase(checkCase.id, {
                severity: issue.severity ?? "P2",
                actual: issue.actual,
                explanation: issue.explanation ?? null,
                pageUrl: issue.affectedUrl ?? snapshot.url,
                canonicalUrl: frontier.canonicalize(issue.affectedUrl ?? snapshot.url),
                deviceLabel: profile.label,
                deviceId: profile.id,
                evidenceRefs: ensureScreenshotEvidenceRefs(
                  [...(issue.evidenceRefs ?? []), ...this.buildOptionalUiuxVideoEvidence(sessionId, issue.severity)],
                  renderEvidence
                )
              });
            } else {
              testCaseTracker?.completeCase(checkCase.id, {
                status: "passed",
                actual: `${checkId} emitted ${calibratedVerdict} advisory (not a defect).`,
                pageUrl: issue.affectedUrl ?? snapshot.url,
                canonicalUrl: frontier.canonicalize(issue.affectedUrl ?? snapshot.url),
                deviceLabel: profile.label,
                deviceId: profile.id,
                evidenceRefs: ensureScreenshotEvidenceRefs(issue.evidenceRefs ?? [], renderEvidence)
              });
            }
          } else if (checkCase?.id) {
            testCaseTracker?.completeCase(checkCase.id, {
              status: "passed",
              actual: `${checkId} check passed.`,
              pageUrl: snapshot.url,
              canonicalUrl: frontier.canonicalize(snapshot.url),
              deviceLabel: profile.label,
              deviceId: profile.id,
              evidenceRefs: renderEvidence
            });
          }
        }

        this.upsertUiuxPageDeviceResult(sessionId, {
          pageUrl: snapshot.url,
          canonicalUrl: frontier.canonicalize(snapshot.url),
          deviceLabel: profile.label,
          status: failedChecks.length ? "failed" : "passed",
          failedChecks,
          worstSeverity: deviceWorstSeverity ?? "P3",
          screenshotRef: snapshot.screenshotUrl ?? snapshot.screenshotPath
        });
        this.emitSessionUpdate(sessionId);

        if (!interactionSnapshot || profile.id === interactionPrimaryDevice?.id) {
          interactionSnapshot = snapshot;
        }
      }

      if (shouldStop() || !interactionSnapshot) {
        if (shouldStop()) {
          stoppedByTimeBudget = true;
        }
        continue;
      }

      const authBeforeInteractions = await this.maybeHandleUiuxLoginAssist({
        sessionId,
        browserSession,
        frontier,
        currentUrl: interactionSnapshot.url,
        discoveredFrom: visitedCanonical,
        snapshot: interactionSnapshot,
        step: stepCounter,
        depth: next.meta?.depth ?? frontier.getDepth(visitedCanonical) ?? 0
      });
      if (authBeforeInteractions.handled) {
        if (!authBeforeInteractions.resumed) {
          const latestSession = this.sessionStore.getSession(sessionId);
          const authAssist = latestSession?.authAssist ?? null;
          const blockerType = authAssist?.code === "LOGIN_SKIPPED" ? "LOGIN_SKIPPED" : "LOGIN_REQUIRED";
          await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
            blocker: {
              type: blockerType,
              confidence: 0.9,
              rationale:
                authAssist?.reason ||
                "Authentication is required and was not completed for UI/UX coverage."
            },
            summary:
              blockerType === "LOGIN_SKIPPED"
                ? "UI/UX run stopped because credential entry was skipped."
                : "UI/UX run stopped because authentication is required before safe exploration can continue.",
            nextBestAction: blockerType === "LOGIN_SKIPPED" ? "LOGIN_SKIPPED" : "WAIT_FOR_LOGIN",
            evidenceQualityScore: 0.8
          });
          return;
        }
        continue;
      }

      const interactionCandidates = selectUiuxSafeInteractionCandidates({
        snapshot: interactionSnapshot,
        runConfig,
        maxInteractionsPerPage
      }).slice(0, maxInteractionsPerPage);
      const interactionPlan = planUiuxCasesForPage({
        pageUrl: interactionSnapshot.url,
        canonicalUrl: frontier.canonicalize(interactionSnapshot.url),
        runConfig,
        deviceLabels: [],
        checkIds: [],
        interactionCandidates
      });
      testCaseTracker?.discoverCases(interactionPlan.interactionCases.length);
      let authTransitionHandled = false;

      for (let index = 0; index < interactionCandidates.length; index += 1) {
        if (shouldStop()) {
          stoppedByTimeBudget = true;
          break;
        }
        const candidate = interactionCandidates[index];
        const interactionCaseTemplate = interactionPlan.interactionCases[index];
        const interactionCase = testCaseTracker?.startCase({
          ...(interactionCaseTemplate ?? {
            type: "uiux",
            caseKind: "SAFE_INTERACTION",
            expected: `${candidate.actionKind} should execute safely.`
          }),
          pageUrl: interactionSnapshot.url,
          canonicalUrl: frontier.canonicalize(interactionSnapshot.url),
          deviceLabel: interactionSnapshot.deviceLabel ?? interactionSnapshot.viewportLabel ?? null,
          deviceId: interactionSnapshot.deviceId ?? null
        });

        const currentUiux = this.sessionStore.getSession(sessionId)?.uiux ?? {};
        this.sessionStore.patchSession(sessionId, {
          uiux: {
            ...currentUiux,
            interactionsAttempted: (currentUiux.interactionsAttempted ?? 0) + 1
          }
        });

        const safetyDecision = this.safetyPolicy.evaluateBeforeAction({
          runConfig,
          actionPlan: this.buildUiuxActionContract(candidate.action, candidate.actionKind),
          snapshot: interactionSnapshot,
          currentUrl: interactionSnapshot.url
        });
        if (!safetyDecision.allowed) {
          const latestUiux = this.sessionStore.getSession(sessionId)?.uiux ?? currentUiux;
          this.sessionStore.patchSession(sessionId, {
            uiux: {
              ...latestUiux,
              interactionsSkippedBySafety: (latestUiux.interactionsSkippedBySafety ?? 0) + 1
            }
          });
          if (interactionCase?.id) {
            testCaseTracker?.completeCase(interactionCase.id, {
              status: "skipped",
              severity: "P3",
              actual: safetyDecision.reason,
              pageUrl: interactionSnapshot.url,
              canonicalUrl: frontier.canonicalize(interactionSnapshot.url),
              deviceLabel: interactionSnapshot.deviceLabel ?? interactionSnapshot.viewportLabel ?? null,
              deviceId: interactionSnapshot.deviceId ?? null,
              evidenceRefs: buildEvidenceRefs(interactionSnapshot, frameBuffer.values())
            });
          }
          continue;
        }

        try {
          await browserSession.executeAction(candidate.action, interactionSnapshot);
          stepCounter += 1;
          const postSnapshot = await browserSession.capture(
            `uiux-int-${scannedPages}-${candidate.actionKind}-${stepCounter}`,
            {
              artifactLabel: `uiux-int-${scannedPages}-${candidate.actionKind}-${stepCounter}`,
              viewportLabel: interactionSnapshot.viewportLabel ?? null,
              includeFocusProbe: true,
              includeUiuxSignals: true
            }
          );
          frameBuffer.push(postSnapshot);
          interactionSnapshot = postSnapshot;

          this.sessionStore.patchSession(sessionId, {
            currentUrl: postSnapshot.url,
            currentStep: stepCounter,
            frame: `data:image/png;base64,${postSnapshot.screenshotBase64}`,
            artifactIndex: browserSession.getArtifactIndex()
          });
          this.updateUiuxCoverage(sessionId, postSnapshot, frontier);
          const nextDepth = (next.meta?.depth ?? frontier.getDepth(visitedCanonical) ?? 0) + 1;
          frontier.push(postSnapshot.url, {
            discoveredFrom: visitedCanonical,
            step: stepCounter,
            depth: nextDepth
          });
          const discoveredLinks = this.collectCandidateLinks(postSnapshot, runConfig);
          frontier.pushMany(discoveredLinks, (url) => ({
            discoveredFrom: postSnapshot.url,
            step: stepCounter,
            url,
            depth: nextDepth
          }));

          const authAfterInteraction = await this.maybeHandleUiuxLoginAssist({
            sessionId,
            browserSession,
            frontier,
            currentUrl: postSnapshot.url,
            discoveredFrom: visitedCanonical,
            snapshot: postSnapshot,
            step: stepCounter,
            depth: nextDepth
          });
          if (authAfterInteraction.handled) {
            if (!authAfterInteraction.resumed) {
              const latestSession = this.sessionStore.getSession(sessionId);
              const authAssist = latestSession?.authAssist ?? null;
              const blockerType = authAssist?.code === "LOGIN_SKIPPED" ? "LOGIN_SKIPPED" : "LOGIN_REQUIRED";
              await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
                blocker: {
                  type: blockerType,
                  confidence: 0.9,
                  rationale:
                    authAssist?.reason ||
                    "Authentication is required and was not completed for UI/UX coverage."
                },
                summary:
                  blockerType === "LOGIN_SKIPPED"
                    ? "UI/UX run stopped because credential entry was skipped."
                    : "UI/UX run stopped because authentication is required before safe exploration can continue.",
                nextBestAction: blockerType === "LOGIN_SKIPPED" ? "LOGIN_SKIPPED" : "WAIT_FOR_LOGIN",
                evidenceQualityScore: 0.8
              });
              return;
            }
            authTransitionHandled = true;
            break;
          }

          if (interactionCase?.id) {
            testCaseTracker?.completeCase(interactionCase.id, {
              status: "passed",
              actual: `${candidate.actionKind} executed safely.`,
              pageUrl: postSnapshot.url,
              canonicalUrl: frontier.canonicalize(postSnapshot.url),
              deviceLabel: postSnapshot.deviceLabel ?? postSnapshot.viewportLabel ?? null,
              deviceId: postSnapshot.deviceId ?? null,
              evidenceRefs: buildEvidenceRefs(postSnapshot, frameBuffer.values())
            });
          }
        } catch (error) {
          if (interactionCase?.id) {
            testCaseTracker?.failCase(interactionCase.id, {
              severity: "P2",
              actual: error?.message ?? "Safe interaction execution failed.",
              explanation: {
                whatHappened: "A safe UI interaction failed during execution.",
                whyItFailed: error?.message ?? "Browser action did not complete successfully.",
                whyItMatters: "Interaction failures hide downstream UI states and reduce coverage confidence.",
                recommendedFix: [
                  "Verify target control remains visible and actionable.",
                  "Check for overlays or route changes interrupting the interaction."
                ]
              },
              pageUrl: interactionSnapshot.url,
              canonicalUrl: frontier.canonicalize(interactionSnapshot.url),
              deviceLabel: interactionSnapshot.deviceLabel ?? interactionSnapshot.viewportLabel ?? null,
              deviceId: interactionSnapshot.deviceId ?? null,
              evidenceRefs: buildEvidenceRefs(interactionSnapshot, frameBuffer.values())
            });
          }
        }
      }
      this.emitSessionUpdate(sessionId);

      if (authTransitionHandled) {
        continue;
      }

      if (stoppedByTimeBudget) {
        break;
      }
    }

    if (stoppedByTimeBudget) {
      await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
        blocker: {
          type: "UIUX_TIME_BUDGET_REACHED",
          confidence: 0.9,
          rationale: `UI/UX run reached configured time budget (${timeBudgetMs}ms) before exhausting planned coverage.`
        },
        summary: `UI/UX run reached its time budget (${timeBudgetMs}ms) and returned partial coverage results.`,
        nextBestAction: "REVIEW_UIUX_REPORT",
        evidenceQualityScore: 0.84
      });
      return;
    }

    const finalSession = this.sessionStore.getSession(sessionId);
    const deviceSummary = sortDeviceSummary(finalSession?.uiux?.deviceSummary ?? []);
    const failingDevices = deviceSummary.filter((entry) => entry.pagesFailed > 0);
    const failingNames = failingDevices.map((entry) => entry.deviceLabel);
    const failingList = failingNames.slice(0, 25).join(", ");
    const failingOverflowSuffix =
      failingNames.length > 25 ? ` (+${failingNames.length - 25} more)` : "";
    const summary = [
      `UI/UX scan completed across ${finalSession?.uiux?.pagesVisited?.length ?? scannedPages} page(s).`,
      `Passed on ${deviceSummary.length - failingDevices.length} device(s), failed on ${failingDevices.length} device(s).`,
      failingDevices.length ? `Failing devices: ${failingList}${failingOverflowSuffix}.` : "No failing devices detected."
    ].join(" ");

    await this.finalizeSuccess(sessionId, browserSession, {
      summary,
      targetAchieved: true,
      blockers: [],
      evidenceQualityScore: failingDevices.length ? 0.86 : 0.92,
      nextBestAction: "REVIEW_UIUX_REPORT"
    });
  }

  recordIncident(sessionId, incident) {
    const session = this.sessionStore.getSession(sessionId);
    const testCaseTracker = this.getTestCaseTracker(sessionId);
    if (!incident.skipTestCaseTracking) {
      testCaseTracker?.discoverCases(1);
      const incidentCase = testCaseTracker?.startCase({
        type: session?.runConfig?.testMode ?? "default",
        pageUrl: incident.affectedUrl ?? session?.currentUrl ?? session?.startUrl ?? "",
        canonicalUrl: incident.affectedUrl ?? session?.currentUrl ?? session?.startUrl ?? "",
        deviceLabel: incident.viewportLabel ?? null,
        caseKind: "INCIDENT",
        severity: incident.severity ?? null,
        expected: incident.title ?? "No incident should be detected.",
        evidenceRefs: incident.evidenceRefs ?? []
      });
      if (incidentCase?.id) {
        testCaseTracker?.failCase(incidentCase.id, {
          severity: incident.severity ?? null,
          actual: incident.details ?? "Incident detected during run.",
          pageUrl: incident.affectedUrl ?? session?.currentUrl ?? session?.startUrl ?? "",
          canonicalUrl: incident.affectedUrl ?? session?.currentUrl ?? session?.startUrl ?? "",
          deviceLabel: incident.viewportLabel ?? null,
          evidenceRefs: incident.evidenceRefs ?? []
        });
      }
    }

    this.sessionStore.appendIncident(sessionId, incident);
    this.sessionStore.appendTimeline(sessionId, {
      type: "incident",
      message: `${incident.title}: ${incident.details}`
    });
  }

  async captureFailureFrame(browserSession, frameBuffer, step) {
    try {
      const failureSnapshot = await browserSession.capture(`error-${step}`);
      frameBuffer.push(failureSnapshot);
    } catch {
      return null;
    }

    return null;
  }

  buildActionErrorBug(plan, error) {
    const summary = error?.message?.split("\n")[0]?.trim() || "Browser interaction failed.";
    const isTimeout = /timeout/i.test(error?.message ?? "");

    return {
      type: isTimeout ? "orchestrator-timeout" : "action-execution-error",
      severity: isTimeout ? "P0" : "P1",
      summary,
      evidencePrompt: [
        `Show the failed interaction step: ${plan.thinking}.`,
        "Focus on hidden or obstructed controls, loading states, or overlays that prevented the action."
      ].join(" ")
    };
  }

  createUiuxFrontier(runConfig, coverageMode = isCoverageMode(runConfig)) {
    if (!coverageMode || !runConfig.exploration.urlFrontierEnabled) {
      return null;
    }

    const depthLimit = runConfig.uiux?.depthLimit ?? runConfig.exploration.depthLimit;
    const perDomainCap =
      runConfig.uiux?.perDomainCap ?? Math.max(depthLimit * 4, 12);

    return new UrlFrontier({
      startUrl: runConfig.startUrl,
      perDomainCap,
      maxDepth: depthLimit,
      canonicalizeUrls: runConfig.exploration.canonicalizeUrls,
      stripTrackingParams: true,
      preserveMeaningfulParamsOnly: false
    });
  }

  resolveUiuxViewportLabel(browserSession, runConfig) {
    const activeDevice = browserSession.getCurrentUiuxDeviceProfile?.();
    if (activeDevice?.label) {
      return activeDevice.label;
    }
    const size = browserSession.getViewportSize() ?? null;
    const viewports = resolveUiuxViewports(runConfig);
    return (
      matchViewportLabel(size, viewports) ??
      (size ? `current-${size.width}x${size.height}` : viewports.at(-1)?.label ?? "default")
    );
  }

  async runResponsiveUiuxChecks({
    browserSession,
    uiuxRunner,
    runConfig,
    baseSnapshot,
    stage,
    actionResult = null,
    actionContext = null,
    sessionStartAt
  }) {
    const issues = uiuxRunner.run({
      snapshot: baseSnapshot,
      stage,
      actionResult,
      actionContext
    });

    const originalViewport = browserSession.getViewportSize() ?? {
      width: baseSnapshot.viewportWidth,
      height: baseSnapshot.viewportHeight
    };
    const viewports = resolveUiuxViewports(runConfig);
    const candidates = selectViewportSweepCandidates({
      viewports,
      currentViewportLabel: baseSnapshot.viewportLabel,
      elapsedMs: Date.now() - sessionStartAt,
      timeBudgetMs: runConfig.budgets.timeBudgetMs
    });

    for (const viewport of candidates) {
      await browserSession.setViewportSize(viewport);
      await browserSession.waitForUIReady(
        runConfig.readiness.uiReadyStrategy,
        runConfig.readiness.readyTimeoutMs
      );
      const sweepSnapshot = await browserSession.capture(baseSnapshot.step, {
        artifactLabel: `${baseSnapshot.stepLabel}-${viewport.label}`,
        viewportLabel: viewport.label,
        includeFocusProbe: true,
        includeUiuxSignals: true
      });
      issues.push(
        ...uiuxRunner.run({
          snapshot: sweepSnapshot,
          stage,
          actionResult,
          actionContext
        })
      );
    }

    await browserSession.setViewportSize(originalViewport);
    await browserSession.waitForUIReady(
      runConfig.readiness.uiReadyStrategy,
      runConfig.readiness.readyTimeoutMs
    );

    return issues;
  }

  runAccessibilityChecks({
    a11yRunner,
    snapshot,
    stage,
    actionResult = null,
    actionContext = null
  }) {
    if (!a11yRunner) {
      return [];
    }

    return a11yRunner.run({
      snapshot,
      stage,
      actionResult,
      actionContext
    });
  }

  recordAccessibilityRuleTestCases({
    sessionId,
    testCaseTracker,
    snapshot,
    issues = []
  }) {
    if (!testCaseTracker || !snapshot) {
      return;
    }

    const ruleIds = baselineA11yRules.map((rule) => rule.id);
    if (!ruleIds.length) {
      return;
    }

    const issueByRule = new Map();
    for (const issue of issues) {
      const ruleId = issue?.ruleId ?? issue?.issueType ?? null;
      if (ruleId && !issueByRule.has(ruleId)) {
        issueByRule.set(ruleId, issue);
      }
    }

    for (const ruleId of ruleIds) {
      testCaseTracker.discoverCases(1);
      const issue = issueByRule.get(ruleId) ?? null;
      const ruleCase = testCaseTracker.startCase({
        type: "accessibility",
        pageUrl: snapshot.url,
        canonicalUrl: snapshot.canonicalUrl ?? snapshot.url,
        deviceLabel: snapshot.viewportLabel ?? "desktop",
        caseKind: "A11Y_RULE",
        ruleId,
        selector: issue?.affectedSelector ?? null,
        expected: issue?.expected ?? `${ruleId} should pass for this page and viewport.`
      });
      if (!ruleCase?.id) {
        continue;
      }

      if (issue) {
        testCaseTracker.failCase(ruleCase.id, {
          severity: issue.severity ?? "P2",
          actual: issue.actual ?? `${ruleId} reported an accessibility issue.`,
          selector: issue.affectedSelector ?? null,
          ruleId,
          pageUrl: issue.affectedUrl ?? snapshot.url,
          canonicalUrl: snapshot.canonicalUrl ?? snapshot.url,
          deviceLabel: issue.viewportLabel ?? snapshot.viewportLabel ?? "desktop",
          evidenceRefs: issue.evidenceRefs ?? buildEvidenceRefs(snapshot)
        });
      } else {
        testCaseTracker.completeCase(ruleCase.id, {
          status: "passed",
          actual: `${ruleId} passed on this page and viewport.`,
          selector: null,
          ruleId,
          pageUrl: snapshot.url,
          canonicalUrl: snapshot.canonicalUrl ?? snapshot.url,
          deviceLabel: snapshot.viewportLabel ?? "desktop",
          evidenceRefs: buildEvidenceRefs(snapshot)
        });
      }
    }
  }

  async applyUiuxArtifactRetention({ sessionId, browserSession, runConfig }) {
    if (!isUiuxMode(runConfig)) {
      return;
    }

    const session = this.sessionStore.getSession(sessionId);
    const retention = resolveUiuxArtifactRetention(runConfig);
    const plan = computeUiuxArtifactRetentionPlan({
      artifactIndex: browserSession.getArtifactIndex(),
      issues: session?.uiux?.issues ?? [],
      retention
    });

    if (plan.artifactsPrunedCount > 0) {
      await removePrunedArtifactFiles(plan.prunedArtifacts);
      browserSession.setArtifactIndex(plan.nextArtifactIndex);
    }

    const currentSession = this.sessionStore.getSession(sessionId);
    this.sessionStore.patchSession(sessionId, {
      artifactIndex: plan.nextArtifactIndex,
      uiux: {
        ...(currentSession?.uiux ?? {}),
        artifactsPrunedCount:
          (currentSession?.uiux?.artifactsPrunedCount ?? 0) + plan.artifactsPrunedCount,
        artifactsRetainedCount: plan.artifactsRetainedCount
      }
    });
  }

  async applyAccessibilityArtifactRetention({ sessionId, browserSession, runConfig }) {
    if (!isAccessibilityMode(runConfig)) {
      return;
    }

    const session = this.sessionStore.getSession(sessionId);
    const retention = resolveUiuxArtifactRetention(runConfig);
    const plan = computeUiuxArtifactRetentionPlan({
      artifactIndex: browserSession.getArtifactIndex(),
      issues: session?.accessibility?.issues ?? [],
      retention
    });

    if (plan.artifactsPrunedCount > 0) {
      await removePrunedArtifactFiles(plan.prunedArtifacts);
      browserSession.setArtifactIndex(plan.nextArtifactIndex);
    }

    const currentSession = this.sessionStore.getSession(sessionId);
    this.sessionStore.patchSession(sessionId, {
      artifactIndex: plan.nextArtifactIndex,
      accessibility: {
        ...(currentSession?.accessibility ?? {}),
        artifactsPrunedCount:
          (currentSession?.accessibility?.artifactsPrunedCount ?? 0) + plan.artifactsPrunedCount,
        artifactsRetainedCount: plan.artifactsRetainedCount
      }
    });
  }

  collectCandidateLinks(snapshot, runConfig) {
    const links = [];
    for (const link of snapshot.pageLinks ?? []) {
      if (!link?.href) {
        continue;
      }
      if (!/^https?:/i.test(link.href)) {
        continue;
      }

      const decision = this.safetyPolicy.evaluateNavigation(link.href, runConfig);
      if (decision.allowed) {
        links.push(link.href);
      }
    }

    for (const item of snapshot.interactive ?? []) {
      if (item.tag !== "a" || !item.href || !/^https?:/i.test(item.href)) {
        continue;
      }
      const decision = this.safetyPolicy.evaluateNavigation(item.href, runConfig);
      if (decision.allowed) {
        links.push(item.href);
      }
    }

    return [...new Set(links)];
  }

  mergeAccessibilityContrastSummary(previous = {}, snapshot = {}) {
    const contrast = snapshot.contrastSamples;
    if (!contrast?.enabled) {
      return previous;
    }

    const incomingOffenders = (contrast.offenders ?? []).map((entry) => ({
      selector: entry.selector ?? null,
      textSample: entry.textSample ?? "",
      ratio: Number(entry.ratio ?? 0),
      requiredRatio: Number(entry.requiredRatio ?? 0),
      url: snapshot.url ?? null,
      step: snapshot.step ?? null,
      viewportLabel: snapshot.viewportLabel ?? null
    }));

    const mergedOffenders = [...(previous.worstOffenders ?? []), ...incomingOffenders]
      .sort((left, right) => {
        if (left.ratio !== right.ratio) {
          return left.ratio - right.ratio;
        }
        if ((left.step ?? 0) !== (right.step ?? 0)) {
          return (left.step ?? 0) - (right.step ?? 0);
        }
        return String(left.selector ?? "").localeCompare(String(right.selector ?? ""));
      })
      .slice(0, 10);

    const allWorstRatios = [previous.worstRatio, contrast.worstRatio].filter((value) => Number.isFinite(value));

    return {
      enabled: true,
      pagesEvaluated: (previous.pagesEvaluated ?? 0) + 1,
      sampleLimit: contrast.sampleLimit ?? previous.sampleLimit ?? 40,
      minRatioNormalText: contrast.minRatioNormalText ?? previous.minRatioNormalText ?? 4.5,
      minRatioLargeText: contrast.minRatioLargeText ?? previous.minRatioLargeText ?? 3.0,
      sampledCount: (previous.sampledCount ?? 0) + (contrast.sampledCount ?? 0),
      offenderCount: (previous.offenderCount ?? 0) + incomingOffenders.length,
      worstRatio: allWorstRatios.length ? Math.min(...allWorstRatios) : null,
      worstOffenders: mergedOffenders
    };
  }

  mergeAccessibilityTextScaleSummary(previous = {}, snapshot = {}) {
    const findings = snapshot.textScaleFindings;
    if (!findings?.enabled) {
      return previous;
    }

    const previousBreaks = new Map(
      (previous.breakByScale ?? []).map((entry) => [String(entry.scale), entry])
    );
    const breaking = (findings.results ?? []).filter((entry) => entry.breaksLayout);

    for (const entry of breaking) {
      const key = String(entry.scale);
      const current = previousBreaks.get(key) ?? {
        scale: entry.scale,
        count: 0,
        maxDeltaHorizontalOverflow: 0,
        maxDeltaTextOverflowCount: 0
      };
      current.count += 1;
      current.maxDeltaHorizontalOverflow = Math.max(
        current.maxDeltaHorizontalOverflow,
        Number(entry.deltaHorizontalOverflow ?? 0)
      );
      current.maxDeltaTextOverflowCount = Math.max(
        current.maxDeltaTextOverflowCount,
        Number(entry.deltaTextOverflowCount ?? 0)
      );
      previousBreaks.set(key, current);
    }

    const incomingWorst = [...breaking]
      .sort((left, right) => {
        const leftScore = (left.deltaHorizontalOverflow ?? 0) + (left.deltaTextOverflowCount ?? 0) * 24;
        const rightScore = (right.deltaHorizontalOverflow ?? 0) + (right.deltaTextOverflowCount ?? 0) * 24;
        return rightScore - leftScore;
      })[0];

    const previousWorst = previous.worstBreak ?? null;
    const worstBreakCandidate = [previousWorst, incomingWorst && {
      scale: incomingWorst.scale,
      deltaHorizontalOverflow: Number(incomingWorst.deltaHorizontalOverflow ?? 0),
      deltaTextOverflowCount: Number(incomingWorst.deltaTextOverflowCount ?? 0),
      url: snapshot.url ?? null,
      step: snapshot.step ?? null,
      viewportLabel: snapshot.viewportLabel ?? null
    }]
      .filter(Boolean)
      .sort((left, right) => {
        const leftScore = (left.deltaHorizontalOverflow ?? 0) + (left.deltaTextOverflowCount ?? 0) * 24;
        const rightScore = (right.deltaHorizontalOverflow ?? 0) + (right.deltaTextOverflowCount ?? 0) * 24;
        return rightScore - leftScore;
      })[0] ?? null;

    return {
      enabled: true,
      scales: findings.scales ?? previous.scales ?? [1, 1.25, 1.5],
      pagesEvaluated: (previous.pagesEvaluated ?? 0) + 1,
      pagesWithBreaks: (previous.pagesWithBreaks ?? 0) + (breaking.length > 0 ? 1 : 0),
      breakByScale: [...previousBreaks.values()].sort((left, right) => Number(left.scale) - Number(right.scale)),
      worstBreak: worstBreakCandidate
    };
  }

  mergeAccessibilityReducedMotionSummary(previous = {}, snapshot = {}) {
    const findings = snapshot.reducedMotionFindings;
    if (!findings?.enabled) {
      return previous;
    }

    const currentCount = Number(findings.longAnimationCount ?? 0);
    const previousWorst = previous.worstCase ?? null;
    const currentWorst = {
      longAnimationCount: currentCount,
      selectors: findings.longAnimationSelectors ?? [],
      url: snapshot.url ?? null,
      step: snapshot.step ?? null,
      viewportLabel: snapshot.viewportLabel ?? null
    };
    const worstCase = !previousWorst || currentCount > Number(previousWorst.longAnimationCount ?? 0)
      ? currentWorst
      : previousWorst;

    return {
      enabled: true,
      pagesEvaluated: (previous.pagesEvaluated ?? 0) + 1,
      pagesWithPersistentMotion: (previous.pagesWithPersistentMotion ?? 0) + (currentCount > 0 ? 1 : 0),
      maxLongAnimationCount: Math.max(previous.maxLongAnimationCount ?? 0, currentCount),
      worstCase
    };
  }

  mergeAccessibilityFormSummary(previous = {}, snapshot = {}) {
    const descriptors = snapshot.formControlDescriptors ?? [];
    const errors = snapshot.visibleErrorMessages ?? [];
    const probe = snapshot.formValidationProbe ?? null;
    const mode = probe?.mode ?? previous.mode ?? "observe-only";

    const requiredNotAnnouncedCount = descriptors.filter(
      (entry) => entry.requiredAttr && !entry.ariaRequired && !entry.requiredIndicatorNearLabel
    ).length;
    const describedByMissingTargetCount = descriptors.reduce(
      (total, entry) => total + (entry.ariaDescribedByMissingIds?.length ?? 0),
      0
    );
    const unassociatedErrorsCount = errors.filter((entry) => !entry.associatedFieldSelector).length;
    const unannouncedErrorsCount = errors.filter((entry) => !entry.roleAlert && !entry.ariaLive).length;
    const invalidFocusFailuresCount =
      probe?.attempted &&
      probe?.mode === "safe-submit" &&
      probe?.expectedInvalidSelector &&
      probe?.firstInvalidFocusAfterSubmit?.selector !== probe.expectedInvalidSelector
        ? 1
        : 0;

    const previousSamples = previous.sampleFieldSelectors ?? [];
    const incomingSamples = descriptors
      .map((entry) => entry.selector)
      .filter(Boolean)
      .slice(0, 8);
    const sampleFieldSelectors = [...new Set([...previousSamples, ...incomingSamples])].slice(0, 20);

    return {
      enabled: true,
      mode,
      safeSubmitTypes: probe?.safeSubmitTypes ?? previous.safeSubmitTypes ?? ["search"],
      pagesEvaluated: (previous.pagesEvaluated ?? 0) + 1,
      controlsObserved: (previous.controlsObserved ?? 0) + descriptors.length,
      visibleErrorsObserved: (previous.visibleErrorsObserved ?? 0) + errors.length,
      requiredNotAnnouncedCount: (previous.requiredNotAnnouncedCount ?? 0) + requiredNotAnnouncedCount,
      errorNotAssociatedCount: (previous.errorNotAssociatedCount ?? 0) + unassociatedErrorsCount,
      errorNotAnnouncedCount: (previous.errorNotAnnouncedCount ?? 0) + unannouncedErrorsCount,
      describedByMissingTargetCount: (previous.describedByMissingTargetCount ?? 0) + describedByMissingTargetCount,
      invalidFieldNotFocusedCount: (previous.invalidFieldNotFocusedCount ?? 0) + invalidFocusFailuresCount,
      safeSubmitAttempts: (previous.safeSubmitAttempts ?? 0) + (probe?.attempted ? 1 : 0),
      safeSubmitSkips: (previous.safeSubmitSkips ?? 0) + (!probe?.attempted && mode === "safe-submit" ? 1 : 0),
      sampleFieldSelectors
    };
  }

  updateAccessibilityProbeSummaries(sessionId, snapshot) {
    const session = this.sessionStore.getSession(sessionId);
    const current = session?.accessibility ?? {};

    this.sessionStore.patchSession(sessionId, {
      accessibility: {
        ...current,
        contrastSummary: this.mergeAccessibilityContrastSummary(current.contrastSummary ?? {}, snapshot),
        textScaleSummary: this.mergeAccessibilityTextScaleSummary(current.textScaleSummary ?? {}, snapshot),
        reducedMotionSummary: this.mergeAccessibilityReducedMotionSummary(
          current.reducedMotionSummary ?? {},
          snapshot
        ),
        formSummary: this.mergeAccessibilityFormSummary(current.formSummary ?? {}, snapshot)
      }
    });
  }

  updateUiuxCoverage(sessionId, snapshot, frontier = null) {
    const session = this.sessionStore.getSession(sessionId);
    const currentUiux = session?.uiux ?? {};
    const nextCanonicalUrl = frontier ? frontier.markVisited(snapshot.url) : snapshot.url;
    const pagesVisited = currentUiux.pagesVisited ?? [];
    const uniqueStateHashes = currentUiux.uniqueStateHashes ?? [];

    this.sessionStore.patchSession(sessionId, {
      uiux: {
        ...currentUiux,
        currentCanonicalUrl: nextCanonicalUrl,
        pagesVisited: pagesVisited.includes(nextCanonicalUrl) ? pagesVisited : [...pagesVisited, nextCanonicalUrl],
        uniqueStateHashes: uniqueStateHashes.includes(snapshot.hash)
          ? uniqueStateHashes
          : [...uniqueStateHashes, snapshot.hash]
      }
    });
  }

  updateAccessibilityCoverage(sessionId, snapshot, frontier = null) {
    const session = this.sessionStore.getSession(sessionId);
    const current = session?.accessibility ?? {};
    const nextCanonicalUrl = frontier ? frontier.markVisited(snapshot.url) : snapshot.url;
    const pagesScanned = current.pagesScanned ?? [];

    this.sessionStore.patchSession(sessionId, {
      accessibility: {
        ...current,
        currentCanonicalUrl: nextCanonicalUrl,
        pagesScanned: pagesScanned.includes(nextCanonicalUrl)
          ? pagesScanned
          : [...pagesScanned, nextCanonicalUrl]
      }
    });
  }

  markUiuxBlockedUrl(sessionId, url, frontier = null) {
    const session = this.sessionStore.getSession(sessionId);
    const currentUiux = session?.uiux ?? {};
    const canonicalUrl = frontier ? frontier.canonicalize(url) : url;
    const blocked = currentUiux.blockedForFurtherProgress ?? [];

    this.sessionStore.patchSession(sessionId, {
      uiux: {
        ...currentUiux,
        blockedForFurtherProgress: blocked.includes(canonicalUrl) ? blocked : [...blocked, canonicalUrl]
      }
    });

    return canonicalUrl;
  }

  markCoverageBlockedUrl(sessionId, url, frontier = null, coverageMode = false) {
    const runConfig = this.sessionStore.getSession(sessionId)?.runConfig;
    if (coverageMode && isAccessibilityMode(runConfig)) {
      const session = this.sessionStore.getSession(sessionId);
      const current = session?.accessibility ?? {};
      const canonicalUrl = frontier ? frontier.canonicalize(url) : url;
      const blocked = current.blockedForFurtherProgress ?? [];

      this.sessionStore.patchSession(sessionId, {
        accessibility: {
          ...current,
          blockedForFurtherProgress: blocked.includes(canonicalUrl) ? blocked : [...blocked, canonicalUrl]
        }
      });
      return canonicalUrl;
    }

    return this.markUiuxBlockedUrl(sessionId, url, frontier);
  }

  buildUiuxPaymentWallIssue(snapshot, frames = []) {
    return {
      issueType: "PAYMENT_WALL",
      severity: "P2",
      title: "Payment wall blocks deeper exploration on this page",
      expected: "Coverage mode should record payment walls and continue exploring other safe paths when available.",
      actual: "Payment or subscription controls are visible on the current page.",
      confidence: 0.92,
      evidenceRefs: buildEvidenceRefs(snapshot, frames),
      affectedUrl: snapshot.url,
      step: snapshot.step ?? null,
      deviceLabel: snapshot.deviceLabel ?? snapshot.viewportLabel ?? null,
      deviceId: snapshot.deviceId ?? null,
      viewportLabel: snapshot.viewportLabel ?? null
    };
  }

  recordUiuxIssues(sessionId, issues = []) {
    for (const issue of issues) {
      this.sessionStore.appendUiuxIssue(sessionId, issue);
      const calibratedVerdict =
        issue.calibratedJudgment?.verdict ??
        issue.calibratedVerdict ??
        "FAIL";
      if (calibratedVerdict !== "FAIL") {
        continue;
      }
      this.recordIncident(sessionId, {
        type: issue.issueType,
        severity: normalizeIssueSeverity(issue.severity),
        title: issue.title,
        details: issue.actual,
        confidence: issue.confidence,
        evidenceRefs: issue.evidenceRefs ?? [],
        affectedSelector: issue.affectedSelector ?? null,
        affectedUrl: issue.affectedUrl ?? null,
        viewportLabel: issue.viewportLabel ?? null,
        skipTestCaseTracking: true,
        recoveryAttempts: []
      });
    }
  }

  recordAccessibilityIssues(sessionId, issues = []) {
    for (const issue of issues) {
      this.sessionStore.appendAccessibilityIssue(sessionId, issue);
      this.recordIncident(sessionId, {
        type: issue.ruleId ?? issue.issueType,
        severity: normalizeIssueSeverity(issue.severity),
        title: issue.title,
        details: issue.actual,
        confidence: issue.confidence,
        evidenceRefs: issue.evidenceRefs ?? [],
        affectedSelector: issue.affectedSelector ?? null,
        affectedUrl: issue.affectedUrl ?? null,
        viewportLabel: issue.viewportLabel ?? null,
        skipTestCaseTracking: true,
        recoveryAttempts: []
      });
    }
  }

  hasSafeUiuxCandidate(snapshot, recentActions) {
    const candidate = chooseBestUiuxCandidate(snapshot, recentActions);
    return Boolean(candidate?.classification?.suggestedAction);
  }

  planUiuxAction({ session, snapshot, gate, frontier, recentActions, step }) {
    const gatePlan = this.planFromGatekeeper({ gate, snapshot, step });
    if (gatePlan) {
      return gatePlan;
    }

    if (frontier?.hasNext()) {
      const nextUrl = frontier.next();
      if (nextUrl) {
        return {
          thinking: `Coverage-driven navigation to ${nextUrl.canonicalUrl}.`,
          action: { type: "goto", url: nextUrl.canonicalUrl },
          landmark: "URL Frontier",
          targetText: nextUrl.canonicalUrl,
          verification: "Navigate to a newly discovered canonical URL to expand coverage."
        };
      }
    }

    const bestCandidate = chooseBestUiuxCandidate(snapshot, recentActions);
    if (!bestCandidate?.classification?.suggestedAction) {
      return {
        thinking: "No additional safe UI/UX interaction is available, waiting briefly.",
        action: { type: "wait", durationMs: 800 },
        landmark: "Coverage",
        targetText: "Wait",
        verification: "Pause when no safe low-risk exploration target is available."
      };
    }

    return {
      thinking: `Coverage-driven exploration of ${bestCandidate.label}.`,
      action: bestCandidate.classification.suggestedAction,
      landmark: bestCandidate.candidate.zone,
      targetText: bestCandidate.label,
      verification: bestCandidate.classification.reason
    };
  }

  buildEvidenceArtifactEntry(sessionId, evidence) {
    if (!evidence?.videoUrl && !evidence?.path) {
      return null;
    }

    return {
      path: evidence.path ?? null,
      relativePath: evidence.path ?? null,
      url: evidence.videoUrl ?? `/api/incidents/${sessionId}/video`,
      kind: "evidence-video"
    };
  }

  async finalizeStopped(sessionId, browserSession, { reason = "Run stop requested by user." } = {}) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session || session.status === "cancelled") {
      this.activeRuns.delete(sessionId);
      this.activeBrowserSessions.delete(sessionId);
      this.authSubmissionLocks.delete(sessionId);
      this.releaseTestCaseTracker(sessionId);
      this.clearRunControl(sessionId);
      return;
    }

    let artifactIndex = session.artifactIndex ?? {};
    const activeBrowser = browserSession ?? this.getActiveBrowserSession(sessionId);
    if (activeBrowser) {
      artifactIndex = await activeBrowser.close({ status: "cancelled" }).catch(() => artifactIndex);
    }

    const blocker = {
      type: "USER_STOPPED",
      confidence: 1,
      rationale: reason
    };
    const now = nowIso();
    this.sessionStore.patchSession(sessionId, {
      status: "cancelled",
      summary: reason,
      artifactIndex,
      primaryBlocker: blocker,
      outcome: {
        targetAchieved: false,
        blockers: [blocker],
        evidenceQualityScore: session.outcome?.evidenceQualityScore ?? 0.8,
        nextBestAction: "STOPPED_BY_USER"
      },
      authAssist: session.authAssist
        ? {
            ...session.authAssist,
            state: "auth_failed",
            code: "RUN_STOPPED",
            reason,
            endedAt: now,
            updatedAt: now
          }
        : null
    });
    this.sessionStore.appendTimeline(sessionId, {
      type: "stopped",
      message: reason
    });

    this.finalizeSessionReport(sessionId);
    this.emit("session.cancelled", {
      sessionId,
      summary: reason,
      session: this.sessionStore.getSession(sessionId)
    });
    this.emitSessionUpdate(sessionId);
    this.activeRuns.delete(sessionId);
    this.activeBrowserSessions.delete(sessionId);
    this.authSubmissionLocks.delete(sessionId);
    this.releaseTestCaseTracker(sessionId);
    this.clearRunControl(sessionId);
  }

  async finalizeSuccess(sessionId, browserSession, outcomeInput) {
    const session = this.sessionStore.getSession(sessionId);
    if (session?.profile) {
      await this.profileManager.saveHealth(session.profile, {
        lastSuccessfulRunAt: nowIso(),
        lastBlockerType: null
      });
    }

    const artifactIndex = await browserSession.close({ status: "passed" });
    const uiuxPatch = isUiuxMode(session?.runConfig)
      ? {
          ...(session?.uiux ?? {}),
          artifactsRetainedCount: countIndexedArtifacts(artifactIndex)
        }
      : null;
    const accessibilityPatch = isAccessibilityMode(session?.runConfig)
      ? {
          ...(session?.accessibility ?? {}),
          artifactsRetainedCount: countIndexedArtifacts(artifactIndex)
        }
      : null;
    const authAssistPatch = session?.authAssist
      ? {
          ...session.authAssist,
          state: "resumed",
          code: session.authAssist.code ?? "AUTH_NOT_REQUIRED",
          reason: session.authAssist.reason ?? "Run completed successfully.",
          loginRequired: false,
          endedAt: nowIso(),
          updatedAt: nowIso()
        }
      : null;
    this.sessionStore.patchSession(sessionId, {
      status: "passed",
      success: {
        summary: outcomeInput.summary
      },
      summary: outcomeInput.summary,
      artifactIndex,
      uiux: uiuxPatch ?? session?.uiux,
      accessibility: accessibilityPatch ?? session?.accessibility,
      loginAssist: session?.loginAssist ?? null,
      authAssist: authAssistPatch,
      primaryBlocker: null,
      outcome: {
        targetAchieved: true,
        blockers: outcomeInput.blockers ?? [],
        evidenceQualityScore: outcomeInput.evidenceQualityScore ?? 0.9,
        nextBestAction: outcomeInput.nextBestAction ?? "STOP_SUCCESS"
      }
    });
    this.sessionStore.appendTimeline(sessionId, {
      type: "success",
      message: outcomeInput.summary
    });
    this.finalizeSessionReport(sessionId);
    this.emit("session.passed", {
      sessionId,
      summary: outcomeInput.summary,
      session: this.sessionStore.getSession(sessionId)
    });
    this.emitSessionUpdate(sessionId);
    this.activeRuns.delete(sessionId);
    this.activeBrowserSessions.delete(sessionId);
    this.authSubmissionLocks.delete(sessionId);
    this.releaseTestCaseTracker(sessionId);
    this.clearRunControl(sessionId);
  }

  async finalizeSoftPass(sessionId, browserSession, frames, { blocker, summary, nextBestAction, evidenceQualityScore }) {
    const blockerOrFallback = blocker ?? {
      type: "UNSUPPORTED_FLOW",
      confidence: 0.6,
      rationale: summary
    };
    const session = this.sessionStore.getSession(sessionId);
    if (session?.profile) {
      await this.profileManager.saveHealth(session.profile, {
        lastBlockerType: blockerOrFallback.type
      });
    }

    this.recordIncident(sessionId, {
      type: blockerOrFallback.type,
      severity: "P2",
      title: summarizeIncidentTitle(blockerOrFallback.type),
      details: summary,
      confidence: blockerOrFallback.confidence ?? 0.8,
      evidenceRefs: buildEvidenceRefs(frames.at(-1) ?? { step: "final", screenshotPath: "" }, frames),
      recoveryAttempts: []
    });

    const evidence = await this.documentarianProvider.buildEvidence({
      sessionId,
      frames,
      bug: {
        type: `blocker-${blockerOrFallback.type.toLowerCase()}`,
        severity: "P2",
        summary,
        evidencePrompt: `Summarize the blocker state ${blockerOrFallback.type} with the final frames.`
      }
    });

    const artifactIndex = await browserSession.close({ status: "soft-passed" });
    const evidenceArtifact = this.buildEvidenceArtifactEntry(sessionId, evidence);
    const nextArtifactIndex = {
      ...artifactIndex,
      video: evidenceArtifact ? [...(artifactIndex.video ?? []), evidenceArtifact] : artifactIndex.video ?? []
    };
    const currentSession = this.sessionStore.getSession(sessionId);
    const uiuxPatch = isUiuxMode(currentSession?.runConfig)
      ? {
          ...(currentSession?.uiux ?? {}),
          artifactsRetainedCount: countIndexedArtifacts(nextArtifactIndex)
        }
      : null;
    const accessibilityPatch = isAccessibilityMode(currentSession?.runConfig)
      ? {
          ...(currentSession?.accessibility ?? {}),
          artifactsRetainedCount: countIndexedArtifacts(nextArtifactIndex)
        }
      : null;
    const authAssistPatch = currentSession?.authAssist
      ? {
          ...currentSession.authAssist,
          state: currentSession.authAssist.state === "resumed" ? "resumed" : "auth_failed",
          code: currentSession.authAssist.code ?? blockerOrFallback.type,
          reason: currentSession.authAssist.reason ?? summary,
          endedAt: currentSession.authAssist.endedAt ?? nowIso(),
          updatedAt: nowIso()
        }
      : null;

    this.sessionStore.patchSession(sessionId, {
      status: "soft-passed",
      summary,
      evidence,
      artifactIndex: nextArtifactIndex,
      uiux: uiuxPatch ?? currentSession?.uiux,
      accessibility: accessibilityPatch ?? currentSession?.accessibility,
      primaryBlocker: blockerOrFallback,
      loginAssist: currentSession?.loginAssist ?? null,
      authAssist: authAssistPatch,
      outcome: {
        targetAchieved: false,
        blockers: [blockerOrFallback],
        evidenceQualityScore: evidenceQualityScore ?? 0.82,
        nextBestAction: nextBestAction ?? "ABORT_SOFT_PASS"
      }
    });
    this.finalizeSessionReport(sessionId);
    this.emit("session.soft-passed", {
      sessionId,
      summary,
      session: this.sessionStore.getSession(sessionId)
    });
    this.emitSessionUpdate(sessionId);
    this.activeRuns.delete(sessionId);
    this.activeBrowserSessions.delete(sessionId);
    this.authSubmissionLocks.delete(sessionId);
    this.releaseTestCaseTracker(sessionId);
    this.clearRunControl(sessionId);
    await this.attachDeferredEvidence(sessionId, frames, {
      type: `blocker-${blockerOrFallback.type.toLowerCase()}`,
      severity: "P2",
      summary
    }, evidence);
  }

  async finalizeBug(sessionId, browserSession, frames, bug, audit = null) {
    this.recordIncident(sessionId, {
      type: bug.type,
      severity: bug.severity,
      title: summarizeIncidentTitle(bug.type),
      details: bug.summary,
      confidence: audit?.blockers?.[0]?.confidence ?? 0.86,
      evidenceRefs: buildEvidenceRefs(frames.at(-1) ?? { step: "final", screenshotPath: "" }, frames),
      recoveryAttempts: []
    });

    const evidence = await this.documentarianProvider.buildEvidence({
      sessionId,
      frames,
      bug
    });

    const artifactIndex = await browserSession.close({ status: "failed" });
    const evidenceArtifact = this.buildEvidenceArtifactEntry(sessionId, evidence);
    const nextArtifactIndex = {
      ...artifactIndex,
      video: evidenceArtifact ? [...(artifactIndex.video ?? []), evidenceArtifact] : artifactIndex.video ?? []
    };
    const currentSession = this.sessionStore.getSession(sessionId);
    const uiuxPatch = isUiuxMode(currentSession?.runConfig)
      ? {
          ...(currentSession?.uiux ?? {}),
          artifactsRetainedCount: countIndexedArtifacts(nextArtifactIndex)
        }
      : null;
    const accessibilityPatch = isAccessibilityMode(currentSession?.runConfig)
      ? {
          ...(currentSession?.accessibility ?? {}),
          artifactsRetainedCount: countIndexedArtifacts(nextArtifactIndex)
        }
      : null;

    this.sessionStore.patchSession(sessionId, {
      status: "failed",
      summary: bug.summary,
      bug,
      evidence,
      artifactIndex: nextArtifactIndex,
      uiux: uiuxPatch ?? currentSession?.uiux,
      accessibility: accessibilityPatch ?? currentSession?.accessibility,
      outcome: {
        targetAchieved: false,
        blockers:
          audit?.blockers ??
          [
            {
              type: "STAGNATION",
              confidence: 0.72,
              rationale: bug.summary
            }
          ],
        evidenceQualityScore: audit?.evidenceQualityScore ?? 0.88,
        nextBestAction: audit?.nextBestAction ?? "RETRY_WITH_NEW_PROFILE"
      }
    });
    this.sessionStore.appendTimeline(sessionId, {
      type: "bug",
      message: bug.summary
    });
    this.finalizeSessionReport(sessionId);
    this.emit("bug", {
      sessionId,
      bug,
      evidence
    });
    this.emit("session.failed", {
      sessionId,
      summary: bug.summary,
      session: this.sessionStore.getSession(sessionId)
    });
    this.emitSessionUpdate(sessionId);
    this.activeRuns.delete(sessionId);
    this.activeBrowserSessions.delete(sessionId);
    this.authSubmissionLocks.delete(sessionId);
    this.releaseTestCaseTracker(sessionId);
    this.clearRunControl(sessionId);
    await this.attachDeferredEvidence(sessionId, frames, bug, evidence);
  }

  async attachDeferredEvidence(sessionId, frames, bug, evidence) {
    if (evidence?.status === "generating" && this.documentarianProvider.waitForEvidence) {
      this.documentarianProvider
        .waitForEvidence({
          sessionId,
          frames,
          bug,
          evidence
        })
        .then((resolvedEvidence) => {
          const current = this.sessionStore.getSession(sessionId);
          const videoArtifacts = current?.artifactIndex?.video ?? [];
          const evidenceArtifact = this.buildEvidenceArtifactEntry(sessionId, resolvedEvidence);
          const nextArtifactIndex = {
            ...(current?.artifactIndex ?? {}),
            video: evidenceArtifact ? [...videoArtifacts, evidenceArtifact] : videoArtifacts
          };
          const uiuxPatch = isUiuxMode(current?.runConfig)
            ? {
                ...(current?.uiux ?? {}),
                artifactsRetainedCount: countIndexedArtifacts(nextArtifactIndex)
              }
            : current?.uiux;
          const accessibilityPatch = isAccessibilityMode(current?.runConfig)
            ? {
                ...(current?.accessibility ?? {}),
                artifactsRetainedCount: countIndexedArtifacts(nextArtifactIndex)
              }
            : current?.accessibility;
          this.sessionStore.patchSession(sessionId, {
            evidence: resolvedEvidence,
            artifactIndex: nextArtifactIndex,
            uiux: uiuxPatch,
            accessibility: accessibilityPatch
          });
          this.finalizeSessionReport(sessionId);
          this.emit("bug.updated", {
            sessionId,
            bug,
            evidence: resolvedEvidence
          });
          this.emitSessionUpdate(sessionId);
        })
        .catch((error) => {
          this.sessionStore.appendTimeline(sessionId, {
            type: "evidence",
            message: `Evidence generation failed: ${error.message}`
          });
          this.emit("bug.updated", {
            sessionId,
            bug,
            evidence: {
              ...evidence,
              status: "failed",
              summary: `${bug.summary} Evidence generation failed: ${error.message}`
            }
          });
          this.emitSessionUpdate(sessionId);
        });
    }
  }

  finalizeSessionReport(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    const effectiveBudgets = session.effectiveBudgets ?? this.buildEffectiveBudgets(session.runConfig);
    const next = this.sessionStore.patchSession(sessionId, {
      effectiveBudgets,
      runSummary: buildRunSummary(session)
    });
    const report = buildRunReport(next);
    const updated = this.sessionStore.patchSession(sessionId, {
      report,
      runSummary: buildRunSummary({
        ...next,
        report
      })
    });
    this.queueModeSummary(sessionId);
    return updated;
  }

  queueModeSummary(sessionId) {
    if (!sessionId || !this.reportSummarizer?.isEnabled?.()) {
      return;
    }
    if (this.pendingSummaryJobs.has(sessionId)) {
      return;
    }

    const job = (async () => {
      const session = this.sessionStore.getSession(sessionId);
      const report = session?.report;
      const mode = session?.runConfig?.testMode ?? "default";
      if (!report || report?.summaryText?.llm || mode === "default") {
        return;
      }

      const llmSummary = await this.reportSummarizer.summarize({
        report,
        mode
      });
      if (!llmSummary) {
        return;
      }

      const latest = this.sessionStore.getSession(sessionId);
      if (!latest?.report) {
        return;
      }
      const nextReport = {
        ...latest.report,
        summaryText: {
          ...(latest.report.summaryText ?? {}),
          llm: llmSummary.text,
          llmModel: llmSummary.modelId,
          llmGeneratedAt: nowIso()
        }
      };
      this.sessionStore.patchSession(sessionId, {
        report: nextReport,
        runSummary: buildRunSummary({
          ...latest,
          report: nextReport
        })
      });
      this.emitSessionUpdate(sessionId);
    })()
      .catch(() => null)
      .finally(() => {
        this.pendingSummaryJobs.delete(sessionId);
      });

    this.pendingSummaryJobs.set(sessionId, job);
  }

  emitSessionUpdate(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return;
    }

    this.emit("session.updated", {
      sessionId,
      session
    });
  }

  emit(type, payload) {
    this.eventBus.publish(type, payload);
  }
}
