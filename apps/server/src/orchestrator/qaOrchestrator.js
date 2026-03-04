import { config } from "../lib/config.js";
import { hashText, nowIso, pickLast, sleep } from "../lib/utils.js";
import { BrowserSession } from "../services/browserSession.js";
import { EventBus } from "../services/eventBus.js";
import { Gatekeeper } from "../services/gatekeeper.js";
import { ProfileManager } from "../services/profileManager.js";
import { RingBuffer } from "../services/ringBuffer.js";
import { buildRunReport } from "../services/reportBuilder.js";
import { resolveSkillPack } from "../skills/index.js";

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
    screenshotId: snapshot.screenshotPath,
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
    { type: "screenshot", ref: snapshot.screenshotPath },
    { type: "semantic-map", ref: `semantic:${snapshot.step}` }
  ];

  for (const frame of pickLast(frames, 3)) {
    refs.push({
      type: "screenshot",
      ref: frame.screenshotPath
    });
  }

  return refs;
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
      session.status === "passed" ? "PASS" : session.status === "soft-passed" ? "SOFT-PASS" : session.status === "failed" ? "FAIL" : null,
    primaryBlocker: session.primaryBlocker ?? null,
    nextBestAction: session.outcome?.nextBestAction ?? null,
    evidenceQualityScore: session.outcome?.evidenceQualityScore ?? 0,
    targetAchieved: Boolean(session.outcome?.targetAchieved)
  };
}

function signatureForElement(element) {
  return hashText(`${element.tag}:${element.text}:${element.zone}:${element.landmark}`);
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
    this.activeRuns = new Map();
  }

  async start({ goal, startUrl, providerMode = "auto", profileTag = "", crawlerMode = null }) {
    const profile = this.profileManager.resolveProfile({
      startUrl,
      goal,
      userProvidedTag: profileTag
    });
    const sessionHealth = await this.profileManager.loadHealth(profile);
    const skillPack = resolveSkillPack({ goal, startUrl });
    const session = this.sessionStore.createSession({
      goal,
      startUrl,
      providerMode,
      goalFamily: skillPack.id,
      profileId: profile.profileId,
      profile,
      sessionHealth,
      crawlerMode: crawlerMode ?? isCrawlerGoal(goal),
      crawlerBudget: config.crawlerActionBudget
    });

    this.emit("session.created", {
      sessionId: session.id,
      session
    });

    const run = this.runSession(session.id).catch((error) => {
      this.sessionStore.patchSession(session.id, {
        status: "failed",
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
    });

    this.activeRuns.set(session.id, run);
    return session;
  }

  async runSession(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    const browserSession = new BrowserSession(sessionId, {
      storageStatePath: session.profile?.storageStatePath
    });
    const frameBuffer = new RingBuffer(config.screenshotLimit);
    const recentActions = [];
    let lastHash = "";
    let unchangedSteps = 0;
    let lastAction = null;
    const stepBudget = session.crawler.mode
      ? Math.min(config.maxSteps, config.crawlerActionBudget, config.crawlerDepthLimit)
      : config.maxSteps;

    await browserSession.launch();
    await browserSession.goto(session.startUrl);

    this.sessionStore.patchSession(sessionId, {
      status: "running",
      loginAssist: null
    });
    this.emitSessionUpdate(sessionId);

    for (let step = 1; step <= stepBudget; step += 1) {
      if (
        session.crawler.mode &&
        Date.now() - new Date(session.crawler.startAt).getTime() > config.crawlerTimeBudgetMs
      ) {
        await this.finalizeSoftPass(sessionId, browserSession, frameBuffer.values(), {
          blocker: {
            type: "STAGNATION",
            confidence: 0.7,
            rationale: "Crawler mode reached its configured time budget."
          },
          summary: "Crawler mode reached its configured time budget and is returning the collected coverage artifacts.",
          nextBestAction: "REVIEW_CRAWLER_REPORT",
          evidenceQualityScore: 0.8
        });
        return;
      }

      const snapshot = await browserSession.capture(step);
      frameBuffer.push(snapshot);

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

      if (skillState.pageType === "premium" && isSubscriptionGoal(session.goal)) {
        await this.finalizeSuccess(sessionId, browserSession, {
          summary: "Premium options page is visible and the upgrade funnel was mapped safely.",
          targetAchieved: true,
          blockers: gate.blockers,
          evidenceQualityScore: 0.86,
          nextBestAction: "STOP_SUCCESS"
        });
        return;
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
          domain: session.profile?.domain ?? new URL(snapshot.url).hostname
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

      if (gate.pageState === "PAYMENT_REQUIRED" && isSubscriptionGoal(session.goal)) {
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
        lastAction
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

      if (preAudit.targetAchieved || preAudit.status === "success") {
        await this.finalizeSuccess(sessionId, browserSession, {
          summary: preAudit.thought,
          targetAchieved: true,
          blockers: preAudit.blockers ?? [],
          evidenceQualityScore: preAudit.evidenceQualityScore ?? 0.9,
          nextBestAction: "STOP_SUCCESS"
        });
        return;
      }

      if (preAudit.status === "bug") {
        await this.finalizeBug(sessionId, browserSession, frameBuffer.values(), preAudit.bug, preAudit);
        return;
      }

      const policyPlan = this.planFromGatekeeper({
        gate,
        snapshot,
        skillPack,
        step
      });
      const skillSuggestion = this.planFromSkillPack({
        skillPack,
        snapshot,
        goal: session.goal
      });
      const crawlerPlan = session.crawler.mode
        ? this.planCrawlerAction({
            session: this.sessionStore.getSession(sessionId),
            snapshot,
            recentActions,
            step
          })
        : null;
      const explorerPlan =
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

      const plan =
        policyPlan ??
        (skillSuggestion && (explorerPlan.action?.type === "wait" || gate.pageState === "PAYWALL")
          ? skillSuggestion
          : explorerPlan);

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
      const recoveryAttempts = [];

      try {
        await browserSession.executeAction(plan.action, snapshot);
        postSnapshot = await browserSession.capture(`${step}-post`);
        frameBuffer.push(postSnapshot);
        validation = validatePostConditions(snapshot, postSnapshot, verificationChecks);

        if (!validation.changed && !["wait", "scroll"].includes(plan.action.type)) {
          const fallbackPlan = this.selectFallbackAction({
            skillPack,
            snapshot,
            goal: session.goal,
            originalAction: plan.action
          });

          if (fallbackPlan) {
            recoveryAttempts.push(fallbackPlan.action.type);
            this.emit("action.planned", {
              sessionId,
              step,
              thought: fallbackPlan.thinking,
              action: fallbackPlan.action,
              landmark: fallbackPlan.landmark ?? null,
              targetText: fallbackPlan.targetText ?? null,
              verification: fallbackPlan.verification ?? null
            });
            await browserSession.executeAction(fallbackPlan.action, snapshot);
            postSnapshot = await browserSession.capture(`${step}-retry`);
            frameBuffer.push(postSnapshot);
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
        postConditions: verificationChecks,
        result: validation?.changed ? "advanced" : "no-effect"
      });
      this.emit("action.executed", {
        sessionId,
        step,
        action: plan.action
      });
      this.emitSessionUpdate(sessionId);

      if (validation?.expectedMarkerAppeared) {
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
      summary: `The explorer reached the max step limit of ${config.maxSteps} without completing the goal.`,
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

  async handleLoginAssist({ sessionId, browserSession, domain }) {
    this.sessionStore.patchSession(sessionId, {
      status: "waiting-login",
      loginAssist: {
        state: "WAIT_FOR_USER",
        domain,
        hint: `Complete authentication directly in the controlled browser for ${domain}.`,
        startedAt: nowIso()
      },
      runSummary: {
        outcome: null,
        primaryBlocker: {
          type: "LOGIN_REQUIRED",
          confidence: 0.92,
          rationale: "The current domain requires authentication."
        },
        nextBestAction: "WAIT_FOR_LOGIN",
        evidenceQualityScore: 0.72,
        targetAchieved: false
      }
    });
    this.emitSessionUpdate(sessionId);

    const startedAt = Date.now();
    while (Date.now() - startedAt < config.loginAssistTimeoutMs) {
      await sleep(config.loginAssistPollMs);

      const authenticated = await browserSession.isAuthenticated();
      if (authenticated) {
        const session = this.sessionStore.getSession(sessionId);
        await this.profileManager.saveHealth(session.profile, {
          lastLoginAt: nowIso(),
          lastBlockerType: null
        });
        this.sessionStore.patchSession(sessionId, {
          status: "running",
          loginAssist: {
            state: "AUTH_VALIDATED",
            domain,
            resumedAt: nowIso()
          }
        });
        this.sessionStore.appendTimeline(sessionId, {
          type: "login",
          message: `Authentication validated for ${domain}.`
        });
        this.emitSessionUpdate(sessionId);
        return true;
      }
    }

    return false;
  }

  async resumeSession(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    const updated = this.sessionStore.patchSession(sessionId, {
      loginAssist: {
        ...(session.loginAssist ?? {}),
        resumeRequestedAt: nowIso()
      }
    });
    this.emitSessionUpdate(sessionId);
    return updated;
  }

  recordIncident(sessionId, incident) {
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

  async finalizeSuccess(sessionId, browserSession, outcomeInput) {
    const session = this.sessionStore.getSession(sessionId);
    if (session?.profile) {
      await this.profileManager.saveHealth(session.profile, {
        lastSuccessfulRunAt: nowIso(),
        lastBlockerType: null
      });
    }

    this.sessionStore.patchSession(sessionId, {
      status: "passed",
      success: {
        summary: outcomeInput.summary
      },
      loginAssist: null,
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
    await browserSession.close();
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

    this.sessionStore.patchSession(sessionId, {
      status: "soft-passed",
      evidence,
      primaryBlocker: blockerOrFallback,
      loginAssist: null,
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
    await this.attachDeferredEvidence(sessionId, frames, {
      type: `blocker-${blockerOrFallback.type.toLowerCase()}`,
      severity: "P2",
      summary
    }, evidence);
    await browserSession.close();
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

    this.sessionStore.patchSession(sessionId, {
      status: "failed",
      bug,
      evidence,
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
    await this.attachDeferredEvidence(sessionId, frames, bug, evidence);
    await browserSession.close();
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
          this.sessionStore.patchSession(sessionId, {
            evidence: resolvedEvidence
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

    const next = this.sessionStore.patchSession(sessionId, {
      runSummary: buildRunSummary(session)
    });
    const report = buildRunReport(next);
    return this.sessionStore.patchSession(sessionId, {
      report,
      runSummary: buildRunSummary({
        ...next,
        report
      })
    });
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
