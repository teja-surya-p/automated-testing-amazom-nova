import { z } from "zod";
import { config } from "../lib/config.js";
import { resolveFunctionalProfilePolicy } from "../functional/profilePolicy.js";
import { DEFAULT_UIUX_VIEWPORTS } from "../uiux/viewportSweep.js";

export const TEST_MODES = [
  "default",
  "uiux",
  "functional",
  "accessibility",
  "performance",
  "security",
  "api",
  "dataReliability",
  "compatIntl",
  "compliance"
];

export const CAPTURE_VIDEO_MODES = ["never", "fail-only", "always"];
export const EXPLORATION_STRATEGIES = ["goal-driven", "coverage-driven"];
export const UI_READY_STRATEGIES = ["networkidle-only", "stable-layout", "hybrid"];
export const DESTRUCTIVE_ACTION_POLICIES = ["strict", "relaxed"];
export const FUNCTIONAL_STRATEGIES = ["goal-driven", "smoke-pack", "explore-flows"];
export const ACCESSIBILITY_STRATEGIES = ["coverage-a11y"];

const sanitizedDomain = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase());

const stringList = z.array(sanitizedDomain).default([]);

const budgetsSchema = z
  .object({
    maxSteps: z.coerce.number().int().min(1).max(200).default(config.maxSteps),
    timeBudgetMs: z.coerce.number().int().min(1_000).max(3_600_000).default(config.crawlerTimeBudgetMs),
    stagnationLimit: z.coerce.number().int().min(1).max(20).default(config.stagnationLimit),
    actionRetryCount: z.coerce.number().int().min(1).max(10).default(config.actionRetryCount)
  })
  .default({
    maxSteps: config.maxSteps,
    timeBudgetMs: config.crawlerTimeBudgetMs,
    stagnationLimit: config.stagnationLimit,
    actionRetryCount: config.actionRetryCount
  });

const artifactsSchema = z
  .object({
    captureHtml: z.coerce.boolean().default(false),
    captureA11ySnapshot: z.coerce.boolean().default(false),
    captureHar: z.coerce.boolean().default(false),
    captureTraceOnFail: z.coerce.boolean().default(false),
    captureVideo: z.enum(CAPTURE_VIDEO_MODES).default("fail-only")
  })
  .default({
    captureHtml: false,
    captureA11ySnapshot: false,
    captureHar: false,
    captureTraceOnFail: false,
    captureVideo: "fail-only"
  });

const safetySchema = z
  .object({
    allowlistDomains: stringList,
    blocklistDomains: stringList,
    destructiveActionPolicy: z.enum(DESTRUCTIVE_ACTION_POLICIES).default("strict"),
    paymentWallStop: z.coerce.boolean().default(true)
  })
  .default({
    allowlistDomains: [],
    blocklistDomains: [],
    destructiveActionPolicy: "strict",
    paymentWallStop: true
  });

const explorationSchema = z
  .object({
    strategy: z.enum(EXPLORATION_STRATEGIES).default("goal-driven"),
    depthLimit: z.coerce.number().int().min(1).max(50).default(config.crawlerDepthLimit),
    urlFrontierEnabled: z.coerce.boolean().default(false),
    canonicalizeUrls: z.coerce.boolean().default(false)
  })
  .default({
    strategy: "goal-driven",
    depthLimit: config.crawlerDepthLimit,
    urlFrontierEnabled: false,
    canonicalizeUrls: false
  });

const readinessSchema = z
  .object({
    uiReadyStrategy: z.enum(UI_READY_STRATEGIES).default("networkidle-only"),
    readyTimeoutMs: z.coerce.number().int().min(500).max(120_000).default(config.networkIdleTimeoutMs)
  })
  .default({
    uiReadyStrategy: "networkidle-only",
    readyTimeoutMs: config.networkIdleTimeoutMs
  });

const viewportSchema = z.object({
  label: z.string().trim().min(1),
  width: z.coerce.number().int().min(240).max(2400),
  height: z.coerce.number().int().min(320).max(2400)
});

const uiuxArtifactRetentionSchema = z
  .object({
    maxSnapshotsPerViewport: z.coerce.number().int().min(1).max(200).default(12),
    keepOnlyFailedOrFlaggedSteps: z.coerce.boolean().default(false),
    keepDomForIssuesOnly: z.coerce.boolean().default(false)
  })
  .default({
    maxSnapshotsPerViewport: 12,
    keepOnlyFailedOrFlaggedSteps: false,
    keepDomForIssuesOnly: false
  });

const uiuxBaselineSchema = z
  .object({
    baselineId: z.string().trim().max(120).default(""),
    mode: z.enum(["off", "write", "compare"]).default("off")
  })
  .default({
    baselineId: "",
    mode: "off"
  });

const uiuxSchema = z
  .object({
    viewports: z.array(viewportSchema).min(1).max(6).default(DEFAULT_UIUX_VIEWPORTS),
    artifactRetention: uiuxArtifactRetentionSchema,
    baseline: uiuxBaselineSchema
  })
  .default({
    viewports: DEFAULT_UIUX_VIEWPORTS,
    artifactRetention: {
      maxSnapshotsPerViewport: 12,
      keepOnlyFailedOrFlaggedSteps: false,
      keepDomForIssuesOnly: false
    },
    baseline: {
      baselineId: "",
      mode: "off"
    }
  });

const functionalAssertionsSchema = z
  .object({
    failOnConsoleError: z.coerce.boolean().default(true),
    failOn5xx: z.coerce.boolean().default(true)
  })
  .default({
    failOnConsoleError: true,
    failOn5xx: true
  });

const functionalContractsSchema = z
  .object({
    failOnApi5xx: z.coerce.boolean().default(true),
    warnOnThirdPartyFailures: z.coerce.boolean().default(true),
    endpointAllowlistPatterns: z.array(z.string().trim().min(1)).default([]),
    endpointBlocklistPatterns: z.array(z.string().trim().min(1)).default([])
  })
  .default({
    failOnApi5xx: true,
    warnOnThirdPartyFailures: true,
    endpointAllowlistPatterns: [],
    endpointBlocklistPatterns: []
  });

const functionalLoginAssistSchema = z
  .object({
    enabled: z.coerce.boolean().default(true),
    timeoutMs: z.coerce.number().int().min(5_000).max(900_000).default(180_000),
    resumeStrategy: z.enum(["continue-flow", "restart-flow"]).default("restart-flow")
  })
  .default({
    enabled: true,
    timeoutMs: 180_000,
    resumeStrategy: "restart-flow"
  });

const functionalCapabilitiesSchema = z
  .object({
    allowNewTabs: z.coerce.boolean().default(true),
    allowDownloads: z.coerce.boolean().default(true),
    allowUploads: z.coerce.boolean().default(false),
    uploadFixturePath: z.string().trim().min(1).default("fixtures/upload.txt")
  })
  .default({
    allowNewTabs: true,
    allowDownloads: true,
    allowUploads: false,
    uploadFixturePath: "fixtures/upload.txt"
  });

const functionalReadinessSchema = z
  .object({
    strategy: z.enum(["networkidle-only", "hybrid"]).default("hybrid"),
    postClickSettleMs: z.coerce.number().int().min(0).max(10_000).default(800)
  })
  .default({
    strategy: "hybrid",
    postClickSettleMs: 800
  });

const functionalProfileSchema = z
  .object({
    requireProfileTag: z.coerce.boolean().default(true),
    reuseProfileAcrossRuns: z.coerce.boolean().default(true)
  })
  .default({
    requireProfileTag: true,
    reuseProfileAcrossRuns: true
  });

const functionalSchema = z
  .object({
    strategy: z.enum(FUNCTIONAL_STRATEGIES).default("smoke-pack"),
    maxFlows: z.coerce.number().int().min(1).max(20).default(6),
    maxStepsPerFlow: z.coerce.number().int().min(1).max(40).default(12),
    allowFormSubmit: z.coerce.boolean().default(false),
    allowedSubmitTypes: z
      .array(z.enum(["search", "filter", "pagination"]))
      .default(["search", "filter", "pagination"]),
    testDataProfile: z.literal("synthetic").default("synthetic"),
    loginAssist: functionalLoginAssistSchema,
    capabilities: functionalCapabilitiesSchema,
    readiness: functionalReadinessSchema,
    profile: functionalProfileSchema,
    assertions: functionalAssertionsSchema,
    contracts: functionalContractsSchema,
    baseline: z
      .object({
        baselineId: z.string().trim().max(120).default(""),
        mode: z.enum(["off", "write", "compare"]).default("off")
      })
      .default({
        baselineId: "",
        mode: "off"
      })
  })
  .default({
    strategy: "smoke-pack",
    maxFlows: 6,
    maxStepsPerFlow: 12,
    allowFormSubmit: false,
    allowedSubmitTypes: ["search", "filter", "pagination"],
    testDataProfile: "synthetic",
    loginAssist: {
      enabled: true,
      timeoutMs: 180_000,
      resumeStrategy: "restart-flow"
    },
    capabilities: {
      allowNewTabs: true,
      allowDownloads: true,
      allowUploads: false,
      uploadFixturePath: "fixtures/upload.txt"
    },
    readiness: {
      strategy: "hybrid",
      postClickSettleMs: 800
    },
    profile: {
      requireProfileTag: true,
      reuseProfileAcrossRuns: true
    },
    assertions: {
      failOnConsoleError: true,
      failOn5xx: true
    },
    contracts: {
      failOnApi5xx: true,
      warnOnThirdPartyFailures: true,
      endpointAllowlistPatterns: [],
      endpointBlocklistPatterns: []
    },
    baseline: {
      baselineId: "",
      mode: "off"
    }
  });

const accessibilitySchema = z
  .object({
    strategy: z.enum(ACCESSIBILITY_STRATEGIES).default("coverage-a11y"),
    maxPages: z.coerce.number().int().min(1).max(200).default(20),
    ruleset: z.enum(["wcag-lite"]).default("wcag-lite"),
    failOnCritical: z.coerce.boolean().default(true),
    baseline: z
      .object({
        baselineId: z.string().trim().max(120).default(""),
        mode: z.enum(["off", "write", "compare"]).default("off")
      })
      .default({
        baselineId: "",
        mode: "off"
      })
  })
  .default({
    strategy: "coverage-a11y",
    maxPages: 20,
    ruleset: "wcag-lite",
    failOnCritical: true,
    baseline: {
      baselineId: "",
      mode: "off"
    }
  });

export const runConfigSchema = z.object({
  startUrl: z.string().trim().url(),
  goal: z.string().trim().min(1),
  testMode: z.enum(TEST_MODES).default("default"),
  providerMode: z.string().trim().min(1).default("auto"),
  profileTag: z.string().trim().default(""),
  crawlerMode: z.coerce.boolean().default(false),
  budgets: budgetsSchema,
  artifacts: artifactsSchema,
  safety: safetySchema,
  exploration: explorationSchema,
  readiness: readinessSchema,
  uiux: uiuxSchema,
  functional: functionalSchema,
  accessibility: accessibilitySchema
});

function mergeForValidation(body = {}, defaultStartUrl = config.targetAppUrl) {
  const source = body.runConfig && typeof body.runConfig === "object" ? body.runConfig : body;

  return {
    startUrl: source.startUrl ?? defaultStartUrl,
    goal: source.goal ?? body.goal,
    testMode: source.testMode,
    providerMode: source.providerMode,
    profileTag: source.profileTag,
    crawlerMode: source.crawlerMode,
    budgets: source.budgets,
    artifacts: source.artifacts,
    safety: source.safety,
    exploration: source.exploration,
    readiness: source.readiness,
    uiux: source.uiux,
    functional: source.functional,
    accessibility: source.accessibility
  };
}

export function parseRunConfig(body = {}, options = {}) {
  const candidate = mergeForValidation(body, options.defaultStartUrl);
  const parsed = runConfigSchema.parse(candidate);
  const rawSource = body.runConfig && typeof body.runConfig === "object" ? body.runConfig : body;

  if (parsed.testMode === "uiux") {
    parsed.exploration.strategy =
      rawSource?.exploration?.strategy ?? "coverage-driven";
    parsed.exploration.urlFrontierEnabled =
      rawSource?.exploration?.urlFrontierEnabled ?? true;
    parsed.exploration.canonicalizeUrls =
      rawSource?.exploration?.canonicalizeUrls ?? true;
  }

  if (parsed.testMode === "functional") {
    const policy = resolveFunctionalProfilePolicy({ runConfig: parsed });
    if (!policy.ok) {
      throw new Error(policy.errorMessage);
    }
  }

  if (parsed.testMode === "accessibility") {
    parsed.exploration.strategy =
      rawSource?.exploration?.strategy ?? "coverage-driven";
    parsed.exploration.urlFrontierEnabled =
      rawSource?.exploration?.urlFrontierEnabled ?? true;
    parsed.exploration.canonicalizeUrls =
      rawSource?.exploration?.canonicalizeUrls ?? true;
    parsed.artifacts.captureA11ySnapshot = true;
    parsed.uiux.artifactRetention.maxSnapshotsPerViewport =
      rawSource?.uiux?.artifactRetention?.maxSnapshotsPerViewport ?? 8;
    parsed.uiux.artifactRetention.keepDomForIssuesOnly =
      rawSource?.uiux?.artifactRetention?.keepDomForIssuesOnly ?? true;
  }

  return parsed;
}

export function getDefaultRunConfig(overrides = {}) {
  return runConfigSchema.parse({
    startUrl: overrides.startUrl ?? config.targetAppUrl,
    goal: overrides.goal ?? "Investigate the target flow",
    ...overrides
  });
}
