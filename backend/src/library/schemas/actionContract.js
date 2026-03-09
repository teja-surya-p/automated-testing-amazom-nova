import { z } from "zod";

const ACTION_TYPES = [
  "click",
  "type",
  "wait",
  "scroll",
  "goto",
  "back",
  "refresh",
  "done",
  "bug"
];

export const actionTargetSchema = z.object({
  semanticId: z.string().trim().min(1).nullable().default(null),
  locator: z.string().trim().min(1).nullable().default(null),
  fallback: z.string().trim().min(1).nullable().default(null)
});

export const actionPlanSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  target: actionTargetSchema.default({ semanticId: null, locator: null, fallback: null }),
  inputValue: z.string().nullable().optional(),
  rationale: z.string().trim().min(1),
  safetyTags: z.array(z.string().trim().min(1)).default([]),
  expectedStateChange: z.string().trim().min(1)
});

export const actionResultSchema = z.object({
  success: z.boolean(),
  error: z.string().trim().min(1).optional(),
  expected: z.string().trim().min(1),
  actual: z.string().trim().min(1),
  progressSignals: z.array(z.string().trim().min(1)).default([])
});

function targetFromSnapshot(action, snapshot) {
  const semantic = snapshot?.interactive?.find((item) => item.elementId === action?.elementId) ?? null;

  return {
    semanticId: action?.elementId ?? null,
    locator: semantic?.selector ?? null,
    fallback:
      semantic?.text ||
      semantic?.ariaLabel ||
      semantic?.placeholder ||
      semantic?.name ||
      action?.url ||
      null
  };
}

function deriveSafetyTags(action, snapshot) {
  const target = snapshot?.interactive?.find((item) => item.elementId === action?.elementId) ?? null;
  const haystack = [
    action?.type,
    action?.text,
    action?.url,
    target?.text,
    target?.ariaLabel,
    target?.placeholder,
    target?.name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tags = [];
  if (["wait", "scroll", "back", "refresh"].includes(action?.type)) {
    tags.push("read-only");
  }
  if (/delete|remove|purchase|pay|logout|sign out|unsubscribe|reset|wipe/.test(haystack)) {
    tags.push("sensitive");
  }
  if (action?.type === "goto") {
    tags.push("navigation");
  }
  return tags;
}

export function legacyPlanToContract(plan, snapshot) {
  const action = plan?.action ?? {};
  const fallbackExpected =
    plan?.verification ??
    (action.type === "click"
      ? "The click should cause a visible state change."
      : action.type === "type"
        ? "The typed input should be visible or submitted safely."
        : action.type === "goto"
          ? "The browser should navigate to the requested location."
          : action.type === "done"
            ? "The run should be marked complete."
            : "The page should continue safely.");

  return {
    actionType: action.type,
    target: targetFromSnapshot(action, snapshot),
    inputValue: action.text ?? null,
    rationale: plan?.thinking ?? "Fallback heuristic plan.",
    safetyTags: deriveSafetyTags(action, snapshot),
    expectedStateChange: fallbackExpected
  };
}

export function repairLegacyPlan(plan, snapshot) {
  const safeAction = { type: "wait", durationMs: 800 };

  const repairedPlan = {
    thinking: plan?.thinking ?? "Repairing an invalid action plan with a safe fallback.",
    action: safeAction,
    landmark: "System",
    targetText: "Wait briefly",
    verification:
      plan?.verification ?? "Use a safe heuristic fallback because the original plan was invalid.",
    isRepaired: true
  };

  return {
    repairedPlan,
    contract: legacyPlanToContract(repairedPlan, snapshot)
  };
}

export function validateOrRepairActionPlan(plan, snapshot) {
  const contractCandidate = legacyPlanToContract(plan, snapshot);
  const parsed = actionPlanSchema.safeParse(contractCandidate);

  if (parsed.success) {
    return {
      plan: {
        ...plan,
        contract: parsed.data,
        isRepaired: false
      },
      contract: parsed.data,
      incident: null
    };
  }

  const repaired = repairLegacyPlan(plan, snapshot);
  const repairedContract = actionPlanSchema.parse(repaired.contract);

  return {
    plan: {
      ...repaired.repairedPlan,
      contract: repairedContract,
      originalPlan: plan,
      isRepaired: true
    },
    contract: repairedContract,
    incident: {
      type: "PLAN_INVALID_REPAIRED",
      severity: "P3",
      title: "Invalid Plan Repaired",
      details: parsed.error.issues.map((issue) => issue.message).join("; "),
      confidence: 0.92,
      recoveryAttempts: ["safe-heuristic-fallback"]
    }
  };
}

export function validateActionResult(result) {
  return actionResultSchema.parse(result);
}
