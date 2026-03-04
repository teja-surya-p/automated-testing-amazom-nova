import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { clamp, extractJsonObject } from "../lib/utils.js";
import { config, hasBedrockRuntime } from "../lib/config.js";

const auditorClient = hasBedrockRuntime()
  ? new BedrockRuntimeClient({
      region: config.awsRegion
    })
  : null;

function limitWords(value, count = 5) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function repeatedActionCount(recentActions) {
  const normalized = recentActions
    .filter((entry) => (entry.action ?? entry).type !== "wait")
    .map((entry) => {
      const semantic = entry.semanticAction ?? null;
      if (semantic?.center) {
        return JSON.stringify({
          label: semantic.label,
          zone: semantic.zone,
          center: semantic.center
        });
      }

      return JSON.stringify(entry.action ?? entry);
    })
    .slice(-4);
  if (normalized.length < 3) {
    return 0;
  }

  const [last] = normalized.slice(-1);
  return normalized.filter((entry) => entry === last).length;
}

function serializeAudit(audit) {
  return JSON.stringify(
    {
      status: audit.status,
      stepTitle: audit.stepTitle,
      action: audit.action,
      details: audit.details,
      reasoning: audit.reasoning,
      targetReasoning: audit.targetReasoning,
      targetText: audit.targetText,
      targetCoordinates: audit.targetCoordinates,
      confidenceScore: audit.confidenceScore,
      targetAchieved: audit.targetAchieved,
      blockers: audit.blockers,
      evidenceQualityScore: audit.evidenceQualityScore,
      nextBestAction: audit.nextBestAction,
      highlight: audit.highlight,
      nextInstruction: audit.nextInstruction,
      obstruction: audit.obstruction,
      bug: audit.bug
    },
    null,
    2
  );
}

function enrichAudit(audit) {
  const candidateStepTitle = audit.stepTitle ?? audit.title ?? audit.action ?? audit.nextInstruction;
  const targetReasoning = audit.targetReasoning ?? "";
  const enriched = {
    stepTitle: limitWords(candidateStepTitle || "Analyzing current view"),
    action: audit.action ?? audit.nextInstruction ?? "Inspecting current UI state",
    details: audit.details ?? targetReasoning ?? audit.reasoning ?? audit.thought ?? "Evaluating the latest browser state.",
    reasoning:
      audit.reasoning ??
      (targetReasoning ? `${targetReasoning} ${audit.thought ?? ""}`.trim() : audit.thought) ??
      "Evaluating the latest browser state.",
    targetReasoning,
    targetText: audit.targetText ?? "",
    targetCoordinates: Array.isArray(audit.targetCoordinates) ? audit.targetCoordinates : null,
    confidenceScore: clamp(Number(audit.confidenceScore ?? 72), 0, 100),
    targetAchieved: Boolean(audit.targetAchieved),
    blockers: Array.isArray(audit.blockers) ? audit.blockers : [],
    evidenceQualityScore: clamp(Number(audit.evidenceQualityScore ?? 0.72), 0, 1),
    nextBestAction: audit.nextBestAction ?? "CONTINUE",
    ...audit
  };

  return {
    ...enriched,
    raw: audit.raw ?? serializeAudit(enriched)
  };
}

function normalizeBounds(bounds, snapshot) {
  if (!bounds || !snapshot.pageWidth || !snapshot.pageHeight) {
    return null;
  }

  const widthPct = Math.max((bounds.width / snapshot.pageWidth) * 100, 4);
  const heightPct = Math.max((bounds.height / snapshot.pageHeight) * 100, 4);
  const xPct = Math.min((bounds.x / snapshot.pageWidth) * 100, 100 - widthPct);
  const yPct = Math.min((bounds.y / snapshot.pageHeight) * 100, 100 - heightPct);

  return {
    xPct,
    yPct,
    widthPct,
    heightPct
  };
}

function deriveHighlight(context, audit) {
  if (audit.status === "success") {
    return null;
  }

  if ((audit.status === "bug" || audit.status === "recoverable") && context.snapshot.overlays.length) {
    const normalized = normalizeBounds(context.snapshot.overlays[0].bounds, context.snapshot);
    if (normalized) {
      return {
        kind: "circle",
        tone: "rose",
        label: audit.status === "bug" ? "Blocking issue" : "Obstruction",
        ...normalized
      };
    }
  }

  if (context.snapshot.spinnerVisible && context.snapshot.spinnerBounds) {
    const normalized = normalizeBounds(context.snapshot.spinnerBounds, context.snapshot);
    if (normalized) {
      return {
        kind: "circle",
        tone: audit.status === "bug" ? "amber" : "cyan",
        label: "Loader stall",
        ...normalized
      };
    }
  }

  if (audit.status === "bug" && context.lastAction?.elementId) {
    const element = context.snapshot.interactive.find((item) => item.elementId === context.lastAction.elementId);
    const normalized = normalizeBounds(element?.bounds, context.snapshot);
    if (normalized) {
      return {
        kind: "circle",
        tone: "violet",
        label: "Repeated target",
        ...normalized
      };
    }
  }

  return null;
}

function heuristicAudit(context) {
  const blockers = [];
  const thought = [];
  const signupSuccess =
    !/\bno account created\b/i.test(context.snapshot.bodyText) &&
    /(welcome,\s|profile is ready|registration complete|account created\b)/i.test(context.snapshot.bodyText);
  const checkoutSuccess =
    /order placed without a credit card|thanks for your order|purchase complete|invoice approved/i.test(
      context.snapshot.bodyText
    );
  const youtubeAdOrMixVisible =
    /youtube mix|\bad\b/.test(context.snapshot.bodyText.toLowerCase()) && /results\?search_query=/i.test(context.snapshot.url);

  if (context.snapshot.overlays.length) {
    thought.push("Visible modal or overlay detected.");
    blockers.push({
      type: "CONSENT_REQUIRED",
      confidence: 0.71,
      rationale: "A visible overlay or modal is blocking part of the interface."
    });
  }

  if (context.snapshot.spinnerVisible) {
    thought.push("A loader is visible.");
    blockers.push({
      type: "STUCK_LOADING",
      confidence: 0.56,
      rationale: "A loading indicator is visible on the current page."
    });
  }

  if (context.snapshot.spinnerVisible && context.unchangedSteps >= config.stagnationLimit) {
    thought.push("The page has stalled with the same visible state.");
    return enrichAudit({
      status: "bug",
      thought: thought.join(" "),
      stepTitle: "Reporting Loader Hang",
      action: "Declaring performance hang",
      details: "The loader is still visible and the screen has stopped changing, so the session should be terminated and documented.",
      reasoning: "The loader remains visible and the screen hash has not changed for multiple audit cycles.",
      confidenceScore: 96,
      targetAchieved: false,
      blockers: [
        {
          type: "STUCK_LOADING",
          confidence: 0.96,
          rationale: "The loader remains visible while the DOM hash and visible state stay unchanged."
        }
      ],
      evidenceQualityScore: 0.96,
      nextBestAction: "ABORT_SOFT_PASS",
      nextInstruction: "Stop the session and report a hang bug.",
      obstruction: {
        present: false,
        summary: ""
      },
      bug: {
        type: "performance-hang",
        severity: "P1",
        summary: "The screen did not change while a loader remained visible.",
        evidencePrompt: "Create a short video showing the loader never resolves."
      }
    });
  }

  if (repeatedActionCount(context.recentActions) >= 3) {
    thought.push("The session is repeating the same action.");
    return enrichAudit({
      status: "bug",
      thought: thought.join(" "),
      stepTitle: "Stopping Repeat Loop",
      action: "Declaring state amnesia",
      details: "The agent is repeating the same interaction and is no longer making forward progress.",
      reasoning: "The agent is repeating the same non-progressing action pattern without changing the screen.",
      confidenceScore: 94,
      targetAchieved: false,
      blockers: [
        {
          type: "STAGNATION",
          confidence: 0.94,
          rationale: "The same non-progressing action pattern repeated multiple times."
        }
      ],
      evidenceQualityScore: 0.92,
      nextBestAction: "ABORT_SOFT_PASS",
      nextInstruction: "Stop retrying the same interaction.",
      obstruction: {
        present: false,
        summary: ""
      },
      bug: {
        type: "state-amnesia",
        severity: "P1",
        summary: "The explorer repeated the same action without progress.",
        evidencePrompt: "Show repeated attempts that do not change the page."
      }
    });
  }

  if (repeatedActionCount(context.recentActions) >= 2 && context.unchangedSteps >= 1) {
    thought.push("The same semantic target was attempted without changing the page.");
    return enrichAudit({
      status: "recoverable",
      thought: thought.join(" "),
      stepTitle: "Triggering UI Recovery",
      action: "Requesting alternate target",
      details: "The same labeled target was chosen again without a page change, so the explorer should pivot to a different semantic match.",
      reasoning: "Recent semantic actions show duplicate target coordinates while the screen hash is unchanged.",
      targetReasoning: "Reject the previous target from the semantic map and choose a different visible element in the correct landmark.",
      confidenceScore: 91,
      targetAchieved: false,
      blockers: [
        {
          type: "STAGNATION",
          confidence: 0.88,
          rationale: "The same semantic target was retried without a meaningful state transition."
        }
      ],
      evidenceQualityScore: 0.82,
      nextBestAction: "REPLAN",
      nextInstruction: "UI-RECOVERY: avoid the previous semantic target and choose a different labeled element or selector.",
      obstruction: {
        present: false,
        summary: ""
      },
      bug: null
    });
  }

  if (context.snapshot.overlays.length) {
    return enrichAudit({
      status: "recoverable",
      thought: thought.join(" "),
      stepTitle: "Clearing Blocking Popup",
      action: "Dismissing blocking overlay",
      details: "A visible modal is covering the controls needed for the next user action.",
      reasoning: "The current UI contains a visible modal that obstructs interactive controls.",
      confidenceScore: 89,
      targetAchieved: false,
      blockers: [
        {
          type: "CONSENT_REQUIRED",
          confidence: 0.89,
          rationale: "A visible dialog or modal is obstructing the interaction path."
        }
      ],
      evidenceQualityScore: 0.84,
      nextBestAction: "DISMISS_OVERLAY",
      nextInstruction: "Dismiss the popup before the next action.",
      obstruction: {
        present: true,
        summary: context.snapshot.overlays[0].text
      },
      bug: null
    });
  }

  if (youtubeAdOrMixVisible) {
    thought.push("Promoted or mixed-content results are visible.");
  }

  if (signupSuccess) {
    return enrichAudit({
      status: "success",
      thought: "The registration flow is complete.",
      stepTitle: "Confirming Signup Success",
      action: "Declaring success",
      details: "The page now shows a completed account-creation state.",
      reasoning: "The screen contains a clear account-created success state.",
      confidenceScore: 98,
      targetAchieved: true,
      blockers: [],
      evidenceQualityScore: 0.9,
      nextBestAction: "STOP_SUCCESS",
      nextInstruction: "Goal reached.",
      obstruction: {
        present: false,
        summary: ""
      },
      bug: null
    });
  }

  if (checkoutSuccess) {
    return enrichAudit({
      status: "success",
      thought: "Checkout completed successfully.",
      stepTitle: "Confirming Checkout Success",
      action: "Declaring success",
      details: "The checkout flow has reached a successful order or invoice state.",
      reasoning: "The checkout state shows invoice approval or order completion without a card.",
      confidenceScore: 97,
      targetAchieved: true,
      blockers: [],
      evidenceQualityScore: 0.91,
      nextBestAction: "STOP_SUCCESS",
      nextInstruction: "Goal reached.",
      obstruction: {
        present: false,
        summary: ""
      },
      bug: null
    });
  }

  return enrichAudit({
    status: "proceed",
    thought: thought.join(" ") || "The page looks usable.",
    stepTitle: context.snapshot.spinnerVisible ? "Waiting on Active Loader" : "Scanning Current State",
    action: "Proceeding with the next move",
    details:
      context.snapshot.overlays.length > 0
        ? "The auditor sees an obstruction and is steering the explorer toward clearing it first."
        : "No blocking conditions are visible, so the agent can continue the current intent path.",
    reasoning:
      context.snapshot.overlays.length > 0
        ? "A visible overlay exists and should be handled first."
        : youtubeAdOrMixVisible
          ? "Search results include ad or mix labels, so the explorer should prefer standard video results in the primary content zone."
          : "No blocking conditions are visible on the current screen.",
    confidenceScore: context.snapshot.spinnerVisible ? 61 : 78,
    targetAchieved: false,
    blockers,
    evidenceQualityScore: blockers.length ? 0.78 : 0.72,
    nextBestAction: context.snapshot.overlays.length
      ? "DISMISS_OVERLAY"
      : youtubeAdOrMixVisible
        ? "SELECT_PRIMARY_CONTENT_RESULT"
        : "CONTINUE",
    nextInstruction: context.snapshot.overlays.length
      ? "Close the popup."
      : youtubeAdOrMixVisible
        ? "Ignore results labeled Ad or YouTube Mix and choose a standard video title in the primary content zone."
        : "Proceed with the next best interaction.",
    obstruction: {
      present: false,
      summary: ""
    },
    bug: null
  });
}

function normalizeAuditorResponse(raw, fallback) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const normalized = {
    status: typeof parsed.status === "string" ? parsed.status : fallback.status,
    stepTitle:
      typeof parsed.step_title === "string"
        ? parsed.step_title
        : typeof parsed.stepTitle === "string"
          ? parsed.stepTitle
          : typeof parsed.title === "string"
            ? parsed.title
            : fallback.stepTitle,
    thought:
      typeof parsed.thought === "string"
        ? parsed.thought
        : typeof parsed.reasoning === "string"
          ? parsed.reasoning
          : fallback.thought,
    action:
      typeof parsed.action === "string"
        ? parsed.action
        : typeof parsed.nextInstruction === "string"
          ? parsed.nextInstruction
          : fallback.action,
    details:
      typeof parsed.details === "string"
        ? parsed.details
        : typeof parsed.reasoning === "string"
          ? parsed.reasoning
          : typeof parsed.thought === "string"
            ? parsed.thought
            : fallback.details,
    reasoning:
      typeof parsed.reasoning === "string"
        ? parsed.reasoning
        : typeof parsed.thought === "string"
          ? parsed.thought
          : fallback.reasoning,
    targetReasoning:
      typeof parsed.targetReasoning === "string"
        ? parsed.targetReasoning
        : typeof parsed.target_reasoning === "string"
          ? parsed.target_reasoning
          : "",
    targetText:
      typeof parsed.targetText === "string"
        ? parsed.targetText
        : typeof parsed.target_text === "string"
          ? parsed.target_text
          : "",
    targetCoordinates:
      Array.isArray(parsed.targetCoordinates) && parsed.targetCoordinates.length >= 2
        ? parsed.targetCoordinates.slice(0, 2)
        : Array.isArray(parsed.target_coordinates) && parsed.target_coordinates.length >= 2
          ? parsed.target_coordinates.slice(0, 2)
          : null,
    confidenceScore:
      typeof parsed.confidenceScore === "number"
        ? parsed.confidenceScore
        : typeof parsed.confidence === "number"
          ? parsed.confidence
          : fallback.confidenceScore,
    targetAchieved:
      typeof parsed.targetAchieved === "boolean"
        ? parsed.targetAchieved
        : typeof parsed.target_achieved === "boolean"
          ? parsed.target_achieved
          : fallback.targetAchieved,
    blockers:
      Array.isArray(parsed.blockers) && parsed.blockers.length
        ? parsed.blockers
            .map((blocker) => ({
              type: typeof blocker?.type === "string" ? blocker.type : "UNKNOWN",
              confidence: clamp(Number(blocker?.confidence ?? 0.5), 0, 1),
              rationale: typeof blocker?.rationale === "string" ? blocker.rationale : ""
            }))
            .filter((blocker) => blocker.type)
        : fallback.blockers,
    evidenceQualityScore:
      typeof parsed.evidenceQualityScore === "number"
        ? parsed.evidenceQualityScore
        : typeof parsed.evidence_quality_score === "number"
          ? parsed.evidence_quality_score
          : fallback.evidenceQualityScore,
    nextBestAction:
      typeof parsed.nextBestAction === "string"
        ? parsed.nextBestAction
        : typeof parsed.next_best_action === "string"
          ? parsed.next_best_action
          : fallback.nextBestAction,
    nextInstruction:
      typeof parsed.nextInstruction === "string" ? parsed.nextInstruction : fallback.nextInstruction,
    obstruction:
      parsed.obstruction && typeof parsed.obstruction === "object"
        ? {
            present: Boolean(parsed.obstruction.present),
            summary: typeof parsed.obstruction.summary === "string" ? parsed.obstruction.summary : ""
          }
        : fallback.obstruction,
    bug:
      parsed.bug && typeof parsed.bug === "object" && typeof parsed.bug.summary === "string"
        ? {
            type: typeof parsed.bug.type === "string" ? parsed.bug.type : "ui-defect",
            severity: typeof parsed.bug.severity === "string" ? parsed.bug.severity : "P2",
            summary: parsed.bug.summary,
            evidencePrompt:
              typeof parsed.bug.evidencePrompt === "string"
                ? parsed.bug.evidencePrompt
                : "Show the visible UI failure."
          }
        : null,
    raw
  };

  return enrichAudit(normalized);
}

export async function auditUserInterface(context) {
  if (!auditorClient) {
    return null;
  }

  const fallback = heuristicAudit(context);
  const command = new ConverseCommand({
    modelId: config.auditorModelId,
    system: [
      {
        text: [
          "You are a High-Precision QA Auditor.",
          "Before recommending any next instruction, cross-reference all visible elements that could satisfy the user intent.",
          "If multiple controls match the intent, prefer the one contained in the primary navigation, header, or search landmark before using sidebar or decorative controls.",
          "If two search icons exist, prefer the one with a visible input field immediately to its left.",
          "Verify that the intended control is not obscured by an overlay, dialog, sign-in wall, consent prompt, or loading skeleton.",
          "State why you chose one target region over the competing options, including the landmark or approximate coordinates when relevant.",
          "Return strict JSON only and keep the step_title under five words."
        ].join("\n")
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            text: [
              "Analyze this UI screenshot.",
              "Identify any Chaos edge cases like overlapping elements, broken loaders, or poor accessibility.",
              "If a bug is found, explain why it is a failure.",
              `Goal: ${context.goal}`,
              `Phase: ${context.phase}`,
              `Current URL: ${context.snapshot.url}`,
              `Current step: ${context.step}`,
              `Last action: ${JSON.stringify(context.lastAction ?? null)}`,
              `Recent actions: ${JSON.stringify(context.recentActions)}`,
              `Recent semantic actions: ${JSON.stringify((context.recentActions ?? []).map((entry) => entry.semanticAction).filter(Boolean))}`,
              `Semantic map: ${JSON.stringify(context.snapshot.semanticMap ?? [])}`,
              `Accessibility tree: ${JSON.stringify(context.snapshot.accessibilityTree ?? [])}`,
              `Unchanged screen count: ${context.unchangedSteps}`,
              `Visible overlays: ${JSON.stringify(context.snapshot.overlays)}`,
              `Interactive elements: ${JSON.stringify(context.snapshot.interactive.slice(0, 20))}`,
              `Spinner visible: ${context.snapshot.spinnerVisible}`,
              `Visible text summary: ${context.snapshot.bodyText}`,
              `Recent screenshot memory length: ${(context.recentFrames ?? []).length}`,
              "Return strict JSON only.",
              "For every step, provide a user-friendly step_title with at most 5 words that describes the actual intent.",
              "Never use generic titles like Proceeding, Continue, Review, or Next Step.",
              "Use concrete summaries such as Navigating To Checkout, Filling Shipping Address, or Clearing Blocking Popup.",
              "In details and reasoning, explain why the selected target is correct and why competing matches were rejected.",
              "Cross-check the screenshot and the semantic map before recommending a target.",
              "If you recommend a YouTube video target, it must be in the Primary Content landmark and should use the center coordinates from the semantic map bounds.",
              "Ignore any result labeled Ad or YouTube Mix. Only prefer individual video-title results that match the user's request.",
              'JSON shape: {"status":"proceed|recoverable|bug|success","step_title":"Navigating to Checkout","action":"short next action label","details":"user-friendly explanation with target choice","reasoning":"technical reason with landmark or coordinate context","targetReasoning":"why this target beat similar candidates","targetText":"selected element label","targetCoordinates":[640,180],"confidenceScore":87,"targetAchieved":false,"blockers":[{"type":"LOGIN_REQUIRED","confidence":0.91,"rationale":"why blocked"}],"evidenceQualityScore":0.76,"nextBestAction":"CONTINUE","thought":"optional detailed summary","nextInstruction":"short instruction","obstruction":{"present":false,"summary":""},"bug":null}',
              "If there is a bug, set bug to { type, severity, summary, evidencePrompt }."
            ].join("\n")
          },
          ...(context.recentFrames ?? []).flatMap((frame, index, frames) => [
            {
              text: `Historical screenshot ${index + 1} of ${frames.length} from step ${frame.step ?? "prior"}`
            },
            {
              image: {
                format: "png",
                source: {
                  bytes: Buffer.from(frame.screenshotBase64, "base64")
                }
              }
            }
          ]),
          {
            image: {
              format: "png",
              source: {
                bytes: Buffer.from(context.snapshot.screenshotBase64, "base64")
              }
            }
          }
        ]
      }
    ],
    inferenceConfig: {
      maxTokens: 700,
      temperature: 0
    }
  });

  const response = await auditorClient.send(command);
  const rawText =
    response.output?.message?.content?.map((item) => item.text ?? "").filter(Boolean).join("\n").trim() ?? "";

  return normalizeAuditorResponse(rawText, fallback);
}

function normalizeGateStateResponse(raw) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const pageState =
    typeof parsed.pageState === "string"
      ? parsed.pageState
      : typeof parsed.page_state === "string"
        ? parsed.page_state
        : null;

  if (!pageState) {
    return null;
  }

  return {
    pageState,
    confidence: clamp(Number(parsed.confidence ?? 0.75), 0, 1),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : ""
  };
}

async function classifyGateStateWithModel(context) {
  if (!auditorClient) {
    return null;
  }

  const command = new ConverseCommand({
    modelId: config.auditorModelId,
    system: [
      {
        text: [
          "You classify page gate states for a QA orchestration engine.",
          "Use only these states: READY, CONSENT_REQUIRED, LOGIN_REQUIRED, CAPTCHA_BOT_DETECTED, RATE_LIMITED, REGION_RESTRICTED, PAYMENT_REQUIRED, PAYWALL, STUCK_LOADING, UI_CHANGED, UNSUPPORTED_FLOW.",
          "Return strict JSON only."
        ].join("\n")
      }
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            text: [
              `Goal: ${context.goal}`,
              `URL: ${context.url}`,
              `Title: ${context.title}`,
              `Top CTAs: ${JSON.stringify(context.topCtas ?? [])}`,
              `Overlays: ${JSON.stringify(context.overlays ?? [])}`,
              `Console errors: ${JSON.stringify(context.consoleErrors ?? [])}`,
              `Network summary: ${JSON.stringify(context.networkSummary ?? {})}`,
              'Return {"pageState":"READY","confidence":0.88,"rationale":"brief reason"}.'
            ].join("\n")
          }
        ]
      }
    ],
    inferenceConfig: {
      maxTokens: 180,
      temperature: 0
    }
  });

  const response = await auditorClient.send(command);
  const rawText =
    response.output?.message?.content?.map((item) => item.text ?? "").filter(Boolean).join("\n").trim() ?? "";
  return normalizeGateStateResponse(rawText);
}

export function createAuditorProvider() {
  return {
    async audit(context) {
      const fallback = heuristicAudit(context);

      if (config.auditorProvider === "bedrock") {
        const response = await auditUserInterface(context).catch(() => null);
        if (response?.status) {
          if (fallback.status === "bug" || fallback.status === "success") {
            return enrichAudit({
              ...response,
              ...fallback,
              thought: [response.thought, fallback.thought].filter(Boolean).join(" ").trim(),
              reasoning: [response.reasoning, fallback.reasoning].filter(Boolean).join(" ").trim(),
              nextInstruction: fallback.nextInstruction,
              obstruction: fallback.obstruction.present ? fallback.obstruction : response.obstruction,
              bug: fallback.bug ?? response.bug,
              raw: response.raw,
              highlight: deriveHighlight(context, fallback)
            });
          }

          return enrichAudit({
            ...response,
            highlight: deriveHighlight(context, response)
          });
        }
      }

      return enrichAudit({
        ...fallback,
        highlight: deriveHighlight(context, fallback)
      });
    },
    async classifyGateState(context) {
      return classifyGateStateWithModel(context).catch(() => null);
    }
  };
}
