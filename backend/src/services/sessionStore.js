import { createId, nowIso } from "../lib/utils.js";
import { upsertA11yIssueClusters } from "../types/accessibility/clustering.js";
import { upsertUiuxIssueClusters } from "../library/reporting/clustering.js";
import {
  createEmptyTestCaseStats,
  TEST_CASE_BUFFER_LIMIT
} from "../library/reporting/testCaseTracker.js";

function createEmptyArtifactIndex() {
  return {
    frames: [],
    dom: [],
    a11y: [],
    console: [],
    network: [],
    downloads: [],
    har: null,
    trace: null,
    video: []
  };
}

function createDefaultTestCases(existing = []) {
  if (!Array.isArray(existing)) {
    return [];
  }
  return existing.slice(-TEST_CASE_BUFFER_LIMIT);
}

function createDefaultAccessibilityState(existing = {}) {
  return {
    enabled: false,
    currentCanonicalUrl: null,
    pagesScanned: [],
    blockedForFurtherProgress: [],
    deviceSummary: [],
    failedDevices: [],
    issues: [],
    clusters: [],
    interactionsAttempted: 0,
    interactionsSkippedBySafety: 0,
    artifactsPrunedCount: 0,
    artifactsRetainedCount: 0,
    contrastSummary: {
      enabled: false,
      pagesEvaluated: 0,
      sampleLimit: 40,
      minRatioNormalText: 4.5,
      minRatioLargeText: 3.0,
      sampledCount: 0,
      offenderCount: 0,
      worstRatio: null,
      worstOffenders: []
    },
    textScaleSummary: {
      enabled: false,
      scales: [1, 1.25, 1.5],
      pagesEvaluated: 0,
      pagesWithBreaks: 0,
      breakByScale: [],
      worstBreak: null
    },
    reducedMotionSummary: {
      enabled: false,
      pagesEvaluated: 0,
      pagesWithPersistentMotion: 0,
      maxLongAnimationCount: 0,
      worstCase: null
    },
    formSummary: {
      enabled: false,
      mode: "observe-only",
      safeSubmitTypes: ["search"],
      pagesEvaluated: 0,
      controlsObserved: 0,
      visibleErrorsObserved: 0,
      requiredNotAnnouncedCount: 0,
      errorNotAssociatedCount: 0,
      errorNotAnnouncedCount: 0,
      describedByMissingTargetCount: 0,
      invalidFieldNotFocusedCount: 0,
      safeSubmitAttempts: 0,
      safeSubmitSkips: 0,
      sampleFieldSelectors: []
    },
    ...existing
  };
}

function createDefaultUiuxState(existing = {}) {
  return {
    enabled: false,
    effectiveBudget: null,
    currentCanonicalUrl: null,
    pagesVisited: [],
    uniqueStateHashes: [],
    blockedForFurtherProgress: [],
    pageDeviceMatrix: [],
    deviceSummary: [],
    failingDevices: [],
    issues: [],
    clusters: [],
    interactionsAttempted: 0,
    interactionsSkippedBySafety: 0,
    artifactsPrunedCount: 0,
    artifactsRetainedCount: 0,
    ...existing
  };
}

function resolveSessionSummary(existing = {}) {
  if (typeof existing.summary === "string" && existing.summary.trim().length > 0) {
    return existing.summary;
  }
  if (typeof existing.success?.summary === "string" && existing.success.summary.trim().length > 0) {
    return existing.success.summary;
  }
  if (typeof existing.bug?.summary === "string" && existing.bug.summary.trim().length > 0) {
    return existing.bug.summary;
  }
  return null;
}

function resolveEffectiveBudgets(existing = {}) {
  return existing.effectiveBudgets ?? null;
}

function createDefaultAuthAssist(existing = null) {
  if (!existing) {
    return null;
  }

  return {
    state: existing.state ?? "awaiting_credentials",
    code: existing.code ?? null,
    source: existing.source ?? null,
    reason: existing.reason ?? "",
    site: existing.site ?? "",
    pageUrl: existing.pageUrl ?? "",
    loginRequired: existing.loginRequired !== false,
    form: {
      identifierFieldDetected: Boolean(existing.form?.identifierFieldDetected),
      usernameFieldDetected: Boolean(existing.form?.usernameFieldDetected ?? existing.form?.identifierFieldDetected),
      passwordFieldDetected: Boolean(existing.form?.passwordFieldDetected),
      otpFieldDetected: Boolean(existing.form?.otpFieldDetected),
      submitControlDetected: Boolean(existing.form?.submitControlDetected),
      identifierFilled: Boolean(existing.form?.identifierFilled),
      usernameFilled: Boolean(existing.form?.usernameFilled),
      passwordFilled: Boolean(existing.form?.passwordFilled),
      submitTriggered: Boolean(existing.form?.submitTriggered),
      submitControlType: existing.form?.submitControlType ?? "none",
      postSubmitUrlChanged: Boolean(existing.form?.postSubmitUrlChanged),
      postSubmitProbeState: existing.form?.postSubmitProbeState ?? null,
      visibleStep: existing.form?.visibleStep ?? null,
      identifierFieldVisibleCount: Number(existing.form?.identifierFieldVisibleCount ?? 0),
      identifierLabelCandidates: Array.isArray(existing.form?.identifierLabelCandidates)
        ? existing.form.identifierLabelCandidates.slice(0, 5)
        : [],
      usernameFieldVisibleCount: Number(existing.form?.usernameFieldVisibleCount ?? 0),
      passwordFieldVisibleCount: Number(existing.form?.passwordFieldVisibleCount ?? 0),
      otpFieldVisibleCount: Number(existing.form?.otpFieldVisibleCount ?? 0),
      nextRecommendedAction: existing.form?.nextRecommendedAction ?? null
    },
    runtime: {
      browserActionExecuted: Boolean(existing.runtime?.browserActionExecuted),
      identifierFilled: Boolean(existing.runtime?.identifierFilled),
      usernameFilled: Boolean(existing.runtime?.usernameFilled),
      passwordFilled: Boolean(existing.runtime?.passwordFilled),
      submitTriggered: Boolean(existing.runtime?.submitTriggered),
      submitControlType: existing.runtime?.submitControlType ?? "none",
      postSubmitUrlChanged: Boolean(existing.runtime?.postSubmitUrlChanged),
      postSubmitProbeState: existing.runtime?.postSubmitProbeState ?? null
    },
    startedAt: existing.startedAt ?? null,
    timeoutMs: existing.timeoutMs ?? null,
    remainingMs: existing.remainingMs ?? null,
    endedAt: existing.endedAt ?? null,
    resumedAt: existing.resumedAt ?? null,
    resumeTargetUrl: existing.resumeTargetUrl ?? null,
    resumeCheckpoint: existing.resumeCheckpoint ?? null,
    profileTag: existing.profileTag ?? "",
    submitAttempted: existing.submitAttempted === true,
    resumeTriggered: existing.resumeTriggered === true,
    updatedAt: existing.updatedAt ?? null,
    resumeRequestedAt: existing.resumeRequestedAt ?? null
  };
}

export class SessionStore {
  constructor({ persistence } = {}) {
    this.sessions = new Map();
    this.persistence = persistence ?? null;
    this.hydrate();
  }

  hydrate() {
    if (!this.persistence) {
      return;
    }

    for (const session of this.persistence.loadAllSessions()) {
      this.sessions.set(session.id, {
        ...session,
        summary: resolveSessionSummary(session),
        effectiveBudgets: resolveEffectiveBudgets(session),
        authAssist: createDefaultAuthAssist(session.authAssist ?? null),
        testCaseStats: createEmptyTestCaseStats(session.testCaseStats ?? {}),
        testCases: createDefaultTestCases(session.testCases ?? []),
        uiux: createDefaultUiuxState(session.uiux ?? {}),
        accessibility: createDefaultAccessibilityState(session.accessibility ?? {}),
        functional: {
          enabled: false,
          flowsRun: 0,
          flows: [],
          assertionCounts: {
            evaluated: 0,
            passed: 0,
            failed: 0
          },
          deviceSummary: [],
          issues: [],
          blockers: [],
          blockerTimeline: [],
          resumePoints: [],
          loginAssist: {
            attempted: false,
            success: false,
            timeout: false,
            resumeStrategy: "restart-flow",
            profileTag: ""
          },
          summary: "",
          reproBundles: [],
          contractSummary: {
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
          graph: {
            nodes: [],
            edges: []
          },
          ...(session.functional ?? {})
        },
        artifactIndex: {
          ...createEmptyArtifactIndex(),
          ...(session.artifactIndex ?? {})
        }
      });
    }
  }

  ensureSessionLoaded(id) {
    if (this.sessions.has(id) || !this.persistence) {
      return this.sessions.get(id) ?? null;
    }

    const loaded = this.persistence.loadSession(id);
    if (loaded) {
      this.sessions.set(id, {
        ...loaded,
        summary: resolveSessionSummary(loaded),
        effectiveBudgets: resolveEffectiveBudgets(loaded),
        authAssist: createDefaultAuthAssist(loaded.authAssist ?? null),
        testCaseStats: createEmptyTestCaseStats(loaded.testCaseStats ?? {}),
        testCases: createDefaultTestCases(loaded.testCases ?? []),
        uiux: createDefaultUiuxState(loaded.uiux ?? {}),
        accessibility: createDefaultAccessibilityState(loaded.accessibility ?? {}),
        functional: {
          enabled: false,
          flowsRun: 0,
          flows: [],
          assertionCounts: {
            evaluated: 0,
            passed: 0,
            failed: 0
          },
          deviceSummary: [],
          issues: [],
          blockers: [],
          blockerTimeline: [],
          resumePoints: [],
          loginAssist: {
            attempted: false,
            success: false,
            timeout: false,
            resumeStrategy: "restart-flow",
            profileTag: ""
          },
          summary: "",
          reproBundles: [],
          contractSummary: {
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
          graph: {
            nodes: [],
            edges: []
          },
          ...(loaded.functional ?? {})
        },
        artifactIndex: {
          ...createEmptyArtifactIndex(),
          ...(loaded.artifactIndex ?? {})
        }
      });
    }

    return this.sessions.get(id) ?? null;
  }

  syncPersist(session) {
    if (this.persistence && session) {
      this.persistence.saveSession(session);
    }
  }

  createSession(input) {
    const id = createId("qa");
    const session = {
      id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "queued",
      goal: input.goal,
      startUrl: input.startUrl,
      runConfig: input.runConfig,
      providerMode: input.providerMode,
      goalFamily: input.goalFamily ?? "generic",
      profileId: input.profileId ?? null,
      profile: input.profile ?? null,
      sessionHealth: input.sessionHealth ?? null,
      currentUrl: input.startUrl,
      currentStep: 0,
      lastThought: "",
      lastAudit: "",
      evidence: null,
      bug: null,
      success: null,
      frame: null,
      currentHighlight: null,
      gateState: "READY",
      primaryBlocker: null,
      outcome: null,
      summary: input.summary ?? null,
      effectiveBudgets: input.effectiveBudgets ?? null,
      runSummary: null,
      loginAssist: null,
      authAssist: null,
      testCaseStats: createEmptyTestCaseStats(),
      testCases: [],
      history: [],
      timeline: [],
      observations: [],
      incidents: [],
      uiux: createDefaultUiuxState({
        enabled:
          input.runConfig?.testMode === "uiux" ||
          (input.runConfig?.testMode === "default" &&
            input.runConfig?.exploration?.strategy === "coverage-driven")
      }),
      accessibility: createDefaultAccessibilityState({
        enabled: input.runConfig?.testMode === "accessibility"
      }),
      functional: {
        enabled: input.runConfig?.testMode === "functional",
        flowsRun: 0,
        flows: [],
        assertionCounts: {
          evaluated: 0,
          passed: 0,
          failed: 0
        },
        deviceSummary: [],
        issues: [],
        blockers: [],
        blockerTimeline: [],
        resumePoints: [],
        loginAssist: {
          attempted: false,
          success: false,
          timeout: false,
          resumeStrategy: input.runConfig?.functional?.loginAssist?.resumeStrategy ?? "restart-flow",
          profileTag: input.runConfig?.profileTag ?? ""
        },
        summary: "",
        reproBundles: [],
        contractSummary: {
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
        graph: {
          nodes: [],
          edges: []
        }
      },
      steps: [],
      artifactIndex: createEmptyArtifactIndex(),
      graph: {
        nodes: [],
        edges: []
      },
      crawler: {
        mode: input.runConfig?.crawlerMode ?? false,
        actionBudget: input.runConfig?.budgets?.maxSteps ?? null,
        startAt: nowIso()
      },
      report: null
    };

    this.sessions.set(id, session);
    this.syncPersist(session);
    return session;
  }

  getSession(id) {
    return this.ensureSessionLoaded(id);
  }

  listSessions() {
    this.hydrate();
    return Array.from(this.sessions.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
  }

  patchSession(id, patch) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      ...patch,
      testCaseStats: createEmptyTestCaseStats({
        ...(current.testCaseStats ?? {}),
        ...(patch.testCaseStats ?? {})
      }),
      authAssist:
        patch.authAssist === undefined
          ? createDefaultAuthAssist(current.authAssist ?? null)
          : patch.authAssist === null
            ? null
            : createDefaultAuthAssist({
                ...(current.authAssist ?? {}),
                ...(patch.authAssist ?? {})
              }),
      testCases: createDefaultTestCases(
        Array.isArray(patch.testCases) ? patch.testCases : current.testCases
      ),
      artifactIndex: {
        ...createEmptyArtifactIndex(),
        ...(current.artifactIndex ?? {}),
        ...(patch.artifactIndex ?? {})
      },
      updatedAt: nowIso()
    };

    this.sessions.set(id, updated);
    this.syncPersist(updated);
    return updated;
  }

  appendTimeline(id, entry) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.timeline = [...current.timeline, { ...entry, at: nowIso() }].slice(-120);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendObservation(id, observation) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.observations = [...current.observations, observation].slice(-160);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendIncident(id, incident) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.incidents = [...current.incidents, incident].slice(-80);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendUiuxIssue(id, issue) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.uiux = {
      ...(current.uiux ?? {}),
      issues: [...(current.uiux?.issues ?? []), issue].slice(-200),
      clusters: upsertUiuxIssueClusters(current.uiux?.clusters ?? [], issue).slice(0, 120)
    };
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendAccessibilityIssue(id, issue) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.accessibility = {
      ...(current.accessibility ?? createDefaultAccessibilityState()),
      issues: [...(current.accessibility?.issues ?? []), issue].slice(-240),
      clusters: upsertA11yIssueClusters(current.accessibility?.clusters ?? [], issue).slice(0, 140)
    };
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  upsertStep(id, stepRecord) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    const existingIndex = current.steps.findIndex((entry) => entry.stepId === stepRecord.stepId);
    if (existingIndex >= 0) {
      current.steps[existingIndex] = {
        ...current.steps[existingIndex],
        ...stepRecord
      };
    } else {
      current.steps = [...current.steps, stepRecord];
    }

    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendGraphNode(id, node) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    if (!current.graph.nodes.some((entry) => entry.nodeId === node.nodeId)) {
      current.graph.nodes = [...current.graph.nodes, node].slice(-200);
    }

    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }

  appendGraphEdge(id, edge) {
    const current = this.ensureSessionLoaded(id);
    if (!current) {
      return null;
    }

    current.graph.edges = [...current.graph.edges, edge].slice(-200);
    current.updatedAt = nowIso();
    this.sessions.set(id, current);
    this.syncPersist(current);
    return current;
  }
}
