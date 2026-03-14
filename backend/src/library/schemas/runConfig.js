import { z } from "zod";
import { config } from "../../lib/config.js";
import { resolveFunctionalProfilePolicy } from "../../types/functional/profilePolicy.js";
import {
  resolveUiuxAllDeviceCap,
  resolveUiuxTimeBudgetMs,
  shouldCapUiuxAllDeviceSelection
} from "../../types/uiux/budget.js";
import { DEFAULT_UIUX_BREAKPOINT_SETTINGS } from "../../types/uiux/componentBreakpointAnalysis.js";

const UIUX_MAX_PAGES_CAP = Math.max(50, Number(config.uiuxMaxPagesCap ?? 2000) || 2000);
const UIUX_DEFAULT_MAX_PAGES = Math.min(
  Math.max(1, Number(config.uiuxDefaultMaxPages ?? 120) || 120),
  UIUX_MAX_PAGES_CAP
);

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
export const ACCESSIBILITY_FORM_MODES = ["observe-only", "safe-submit"];
export const ACCESSIBILITY_SAFE_SUBMIT_TYPES = ["search", "filter", "pagination"];

function normalizeOptionalGoal(value) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function autoGoalForMode(testMode, startUrl) {
  return `${testMode} scan for ${startUrl}`;
}

const sanitizedDomain = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase());

const stringList = z.array(sanitizedDomain).default([]);

const budgetsSchema = z
  .object({
    maxSteps: z.coerce.number().int().min(1).max(200).default(config.maxSteps),
    timeBudgetMs: z.coerce.number().int().min(1_000).max(7_200_000).default(config.crawlerTimeBudgetMs),
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

const uiuxMaxDevicesSchema = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().int().min(0).max(3000).nullable());

const uiuxDevicesSchema = z
  .object({
    mode: z.enum(["quick", "full"]).default("quick"),
    selection: z.enum(["cap", "all"]).optional(),
    maxDevices: uiuxMaxDevicesSchema.optional().default(null),
    allowlist: z.array(z.string().trim().min(1)).default([]),
    blocklist: z.array(z.string().trim().min(1)).default([]),
    includeUserAgents: z.coerce.boolean().default(false)
  })
  .default({
    mode: "quick",
    selection: undefined,
    maxDevices: null,
    allowlist: [],
    blocklist: [],
    includeUserAgents: false
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

const uiuxBreakpointsSchema = z
  .object({
    enabled: z.coerce.boolean().default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.enabled),
    autonomous: z.coerce.boolean().default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.autonomous),
    minWidth: z.coerce.number().int().min(240).max(2200).default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.minWidth),
    maxWidth: z.coerce.number().int().min(320).max(2560).default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxWidth),
    coarseStep: z.coerce.number().int().min(8).max(220).default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.coarseStep),
    fineStep: z.coerce.number().int().min(4).max(120).default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.fineStep),
    refineTransitions: z.coerce.boolean().default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.refineTransitions),
    representativeWidthsPerRange: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.representativeWidthsPerRange),
    maxConcurrentWorkers: z.coerce
      .number()
      .int()
      .min(1)
      .max(8)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxConcurrentWorkers),
    maxComponentsPerPage: z.coerce
      .number()
      .int()
      .min(4)
      .max(60)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxComponentsPerPage),
    maxWidthsPerPage: z.coerce
      .number()
      .int()
      .min(4)
      .max(96)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxWidthsPerPage),
    minHeight: z.coerce.number().int().min(320).max(1400).default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.minHeight),
    maxHeight: z.coerce.number().int().min(480).max(2200).default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxHeight),
    heightFineStep: z.coerce
      .number()
      .int()
      .min(24)
      .max(180)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.heightFineStep),
    maxHeightsPerPage: z.coerce
      .number()
      .int()
      .min(2)
      .max(8)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxHeightsPerPage),
    maxViewportsPerPage: z.coerce
      .number()
      .int()
      .min(24)
      .max(300)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxViewportsPerPage),
    nearbyValidationRadius: z.coerce
      .number()
      .int()
      .min(12)
      .max(120)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.nearbyValidationRadius),
    maxNearbyViewportProbes: z.coerce
      .number()
      .int()
      .min(4)
      .max(32)
      .default(DEFAULT_UIUX_BREAKPOINT_SETTINGS.maxNearbyViewportProbes)
  })
  .superRefine((value, ctx) => {
    if (value.maxWidth <= value.minWidth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxWidth"],
        message: "maxWidth must be greater than minWidth."
      });
    }
    if (value.fineStep > value.coarseStep) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fineStep"],
        message: "fineStep cannot be greater than coarseStep."
      });
    }
    if (value.maxHeight <= value.minHeight) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxHeight"],
        message: "maxHeight must be greater than minHeight."
      });
    }
  })
  .default({
    ...DEFAULT_UIUX_BREAKPOINT_SETTINGS
  });

const uiuxSchema = z
  .object({
    maxPages: z.coerce.number().int().min(1).max(UIUX_MAX_PAGES_CAP).default(UIUX_DEFAULT_MAX_PAGES),
    depthLimit: z.coerce.number().int().min(1).max(50).default(config.crawlerDepthLimit),
    perDomainCap: z.coerce.number().int().min(1).max(2_000).default(120),
    maxInteractionsPerPage: z.coerce.number().int().min(0).max(20).default(6),
    timeBudgetMs: z.coerce.number().int().min(10_000).max(7_200_000).optional(),
    viewports: z.array(viewportSchema).min(1).max(6).optional(),
    devices: uiuxDevicesSchema,
    breakpoints: uiuxBreakpointsSchema,
    artifactRetention: uiuxArtifactRetentionSchema,
    baseline: uiuxBaselineSchema
  })
  .default({
    maxPages: UIUX_DEFAULT_MAX_PAGES,
    depthLimit: config.crawlerDepthLimit,
    perDomainCap: 120,
    maxInteractionsPerPage: 6,
    timeBudgetMs: undefined,
    viewports: undefined,
    devices: {
      mode: "quick",
      selection: undefined,
      maxDevices: null,
      allowlist: [],
      blocklist: [],
      includeUserAgents: false
    },
    breakpoints: {
      ...DEFAULT_UIUX_BREAKPOINT_SETTINGS
    },
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

const functionalCheckIdsSchema = z
  .array(z.string().trim().min(1).regex(/^[A-Z0-9_]+$/))
  .min(1)
  .max(1000)
  .transform((entries) => [...new Set(entries)]);

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
    checkIds: functionalCheckIdsSchema.optional(),
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
    focusProbeTabSteps: z.coerce.number().int().min(1).max(12).default(10),
    forms: z
      .object({
        enabled: z.coerce.boolean().default(true),
        mode: z.enum(ACCESSIBILITY_FORM_MODES).default("observe-only"),
        safeSubmitTypes: z
          .array(z.enum(ACCESSIBILITY_SAFE_SUBMIT_TYPES))
          .min(1)
          .default(["search"])
          .transform((entries) => [...new Set(entries)]),
        maxValidationAttemptsPerPage: z.coerce.number().int().min(1).max(3).default(1)
      })
      .default({
        enabled: true,
        mode: "observe-only",
        safeSubmitTypes: ["search"],
        maxValidationAttemptsPerPage: 1
      }),
    contrast: z
      .object({
        enabled: z.coerce.boolean().default(true),
        sampleLimit: z.coerce.number().int().min(5).max(120).default(40),
        minRatioNormalText: z.coerce.number().min(3).max(7).default(4.5),
        minRatioLargeText: z.coerce.number().min(2).max(4.5).default(3.0)
      })
      .default({
        enabled: true,
        sampleLimit: 40,
        minRatioNormalText: 4.5,
        minRatioLargeText: 3.0
      }),
    textScale: z
      .object({
        enabled: z.coerce.boolean().default(true),
        scales: z
          .array(z.coerce.number().min(1).max(2))
          .min(1)
          .max(6)
          .default([1, 1.25, 1.5])
          .transform((values) =>
            [...new Set(values.map((value) => Number(value.toFixed(2))))].sort((left, right) => left - right)
          )
      })
      .default({
        enabled: true,
        scales: [1, 1.25, 1.5]
      }),
    reducedMotion: z
      .object({
        enabled: z.coerce.boolean().default(true)
      })
      .default({
        enabled: true
      }),
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
    focusProbeTabSteps: 10,
    forms: {
      enabled: true,
      mode: "observe-only",
      safeSubmitTypes: ["search"],
      maxValidationAttemptsPerPage: 1
    },
    contrast: {
      enabled: true,
      sampleLimit: 40,
      minRatioNormalText: 4.5,
      minRatioLargeText: 3.0
    },
    textScale: {
      enabled: true,
      scales: [1, 1.25, 1.5]
    },
    reducedMotion: {
      enabled: true
    },
    ruleset: "wcag-lite",
    failOnCritical: true,
    baseline: {
      baselineId: "",
      mode: "off"
    }
  });

const performanceSchema = z
  .object({
    sampleCount: z.coerce.number().int().min(1).max(8).default(3),
    warmupDelayMs: z.coerce.number().int().min(0).max(5_000).default(600),
    baseline: z
      .object({
        baselineId: z.string().trim().max(120).default(""),
        mode: z.enum(["off", "write", "compare"]).default("off")
      })
      .default({
        baselineId: "",
        mode: "off"
      }),
    budgets: z
      .object({
        ttfbMs: z.coerce.number().int().min(250).max(20_000).default(1800),
        fcpMs: z.coerce.number().int().min(300).max(20_000).default(2500),
        lcpMs: z.coerce.number().int().min(500).max(30_000).default(4000),
        cls: z.coerce.number().min(0.01).max(1).default(0.1),
        domContentLoadedMs: z.coerce.number().int().min(500).max(30_000).default(3500),
        loadEventMs: z.coerce.number().int().min(800).max(60_000).default(7000),
        failedRequests: z.coerce.number().int().min(0).max(200).default(2)
      })
      .default({
        ttfbMs: 1800,
        fcpMs: 2500,
        lcpMs: 4000,
        cls: 0.1,
        domContentLoadedMs: 3500,
        loadEventMs: 7000,
        failedRequests: 2
      })
  })
  .default({
    sampleCount: 3,
    warmupDelayMs: 600,
    baseline: {
      baselineId: "",
      mode: "off"
    },
    budgets: {
      ttfbMs: 1800,
      fcpMs: 2500,
      lcpMs: 4000,
      cls: 0.1,
      domContentLoadedMs: 3500,
      loadEventMs: 7000,
      failedRequests: 2
    }
  });

export const runConfigSchema = z
  .object({
    startUrl: z.string().trim().url(),
    goal: z.preprocess(normalizeOptionalGoal, z.string().trim().min(1).optional()),
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
    accessibility: accessibilitySchema,
    performance: performanceSchema
  })
  .superRefine((value, ctx) => {
    if (value.testMode === "default" && !value.goal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Goal is required when testMode is default.",
        path: ["goal"]
      });
    }
  });

function withRunConfigPath(path = []) {
  return ["runConfig", ...path];
}

function toValidationIssue(issue = {}) {
  return {
    path: withRunConfigPath(issue.path ?? []),
    message: issue.message ?? "Invalid value",
    code: issue.code ?? "custom"
  };
}

export class RunConfigValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "RunConfigValidationError";
    this.error = "VALIDATION_ERROR";
    this.issues = issues;
  }
}

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
    accessibility: source.accessibility,
    performance: source.performance
  };
}

function resolveUiuxDeviceDefaults(parsedDevices = {}, rawDevices = {}) {
  const mode = parsedDevices.mode === "full" ? "full" : "quick";
  const selection =
    rawDevices?.selection === "all"
      ? "all"
      : "cap";
  const defaultCap = mode === "full" ? 250 : 3;
  const hasExplicitMax = Object.prototype.hasOwnProperty.call(rawDevices ?? {}, "maxDevices");
  let maxDevices = parsedDevices.maxDevices;

  if (!hasExplicitMax || maxDevices === null || maxDevices === undefined) {
    maxDevices = defaultCap;
  } else {
    maxDevices = Math.max(0, Math.floor(Number(maxDevices) || 0));
    if (selection === "all" && mode === "full" && maxDevices === 0) {
      maxDevices = 0;
    } else if (maxDevices <= 0) {
      maxDevices = defaultCap;
    }
  }

  return {
    mode,
    selection,
    maxDevices,
    allowlist: parsedDevices.allowlist ?? [],
    blocklist: parsedDevices.blocklist ?? [],
    includeUserAgents: Boolean(parsedDevices.includeUserAgents)
  };
}

export function parseRunConfig(body = {}, options = {}) {
  const candidate = mergeForValidation(body, options.defaultStartUrl);
  const parsedResult = runConfigSchema.safeParse(candidate);
  if (!parsedResult.success) {
    throw new RunConfigValidationError(
      "RunConfig validation failed.",
      (parsedResult.error?.issues ?? []).map((issue) => toValidationIssue(issue))
    );
  }

  const parsed = parsedResult.data;
  const rawSource = body.runConfig && typeof body.runConfig === "object" ? body.runConfig : body;
  parsed.uiux.devices = resolveUiuxDeviceDefaults(
    parsed.uiux.devices,
    rawSource?.uiux?.devices ?? {}
  );

  if (parsed.testMode === "uiux") {
    const effectiveUiuxTimeBudgetMs = resolveUiuxTimeBudgetMs(parsed, rawSource ?? {});

    if (
      shouldCapUiuxAllDeviceSelection({
        runConfig: parsed,
        timeBudgetMs: effectiveUiuxTimeBudgetMs
      })
    ) {
      parsed.uiux.devices.selection = "cap";
      parsed.uiux.devices.maxDevices = resolveUiuxAllDeviceCap({
        runConfig: parsed
      });
    }

    parsed.exploration.strategy =
      rawSource?.exploration?.strategy ?? "coverage-driven";
    parsed.exploration.urlFrontierEnabled =
      rawSource?.exploration?.urlFrontierEnabled ?? true;
    parsed.exploration.canonicalizeUrls =
      rawSource?.exploration?.canonicalizeUrls ?? true;
    parsed.exploration.depthLimit =
      rawSource?.uiux?.depthLimit ??
      rawSource?.exploration?.depthLimit ??
      parsed.exploration.depthLimit;
    parsed.budgets.timeBudgetMs = effectiveUiuxTimeBudgetMs;
    parsed.uiux.timeBudgetMs = effectiveUiuxTimeBudgetMs;
  }

  if (parsed.testMode === "functional") {
    const policy = resolveFunctionalProfilePolicy({ runConfig: parsed });
    if (!policy.ok) {
      throw new RunConfigValidationError(policy.errorMessage, [
        {
          path: ["runConfig", "profileTag"],
          message: policy.errorMessage,
          code: "custom"
        }
      ]);
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

  if (!parsed.goal && parsed.testMode !== "default") {
    parsed.goal = autoGoalForMode(parsed.testMode, parsed.startUrl);
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
