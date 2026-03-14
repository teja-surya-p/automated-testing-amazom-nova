import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  evaluateUploadCapability,
  resolveFunctionalCapabilities,
  resolveFunctionalReadiness
} from "../types/functional/capabilityPolicy.js";
import {
  groupFailingEndpoints,
  normalizeEndpointPath
} from "../types/functional/networkTelemetry.js";
import { config } from "../lib/config.js";
import { hashText, sleep } from "../lib/utils.js";
import { validateActionResult } from "../library/schemas/actionContract.js";
import {
  AUTH_CONTROL_QUERY_SELECTOR,
  AUTH_FIELD_QUERY_SELECTOR,
  OTP_HINT_PATTERN_SOURCE,
  OTP_SELECTOR,
  PASSWORD_SELECTOR,
  SEARCH_HINT_PATTERN_SOURCE,
  SUBMIT_CONTROL_PATTERN_SOURCE,
  SUBMIT_SELECTOR,
  USERNAME_HINT_PATTERN_SOURCE,
  USERNAME_SELECTOR,
  buildCredentialActionPlan,
  deriveAuthInputFieldsFromContext,
  deriveAuthSubmitActionFromControls,
  normalizeSubmittedInputFieldValues,
  resolveFirstCredentialAlias
} from "../library/auth-fields/index.js";
import {
  detectAuthStepAdvance,
  inferAuthVisibleStep
} from "./authAssistState.js";

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

function toRelativeArtifactPath(filePath) {
  return path.relative(config.artifactsDir, filePath).split(path.sep).join("/");
}

function sanitizeStepId(step) {
  return String(step).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function sanitizeFilename(name = "download.bin") {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export class BrowserSession {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.storageStatePath = options.storageStatePath ?? config.storageStatePath;
    this.runConfig = options.runConfig;
    this.sessionDir = path.join(config.artifactsDir, sessionId);
    this.framesDir = path.join(this.sessionDir, "frames");
    this.domDir = path.join(this.sessionDir, "dom");
    this.a11yDir = path.join(this.sessionDir, "a11y");
    this.consoleDir = path.join(this.sessionDir, "console");
    this.networkDir = path.join(this.sessionDir, "network");
    this.downloadsDir = path.join(this.sessionDir, "downloads");
    this.videoDir = path.join(this.sessionDir, "video");
    this.harPath = path.join(this.networkDir, "run.har");
    this.tracePath = path.join(this.sessionDir, "trace.zip");
    this.consoleEntries = [];
    this.networkSummary = {
      totalRequests: 0,
      failedRequests: 0,
      abortedRequests: 0,
      status4xx: 0,
      status429: 0,
      status5xx: 0,
      lastFailures: [],
      downloads: [],
      openedNewTab: false,
      newTabUrl: null,
      mainDocumentStatus: null,
      mainDocumentUrl: null,
      mainDocumentContentType: null,
      mainDocumentFailed: false
    };
    this.functionalNetworkRecords = [];
    this.functionalNetworkCursor = 0;
    this.requestStartTimes = new Map();
    this.artifactIndex = createEmptyArtifactIndex();
    this.traceStarted = false;
    this.videoHandle = null;
    this.currentUiuxDeviceProfile = null;
    this.currentUiuxUserAgent = null;
    this.lastUiReadyState = {
      strategy: this.runConfig?.readiness?.uiReadyStrategy ?? "networkidle-only",
      timedOut: false,
      completed: true
    };
    this.accessibilityValidationAttempts = new Map();
  }

  buildArtifactRef(filePath, extra = {}) {
    const relativePath = toRelativeArtifactPath(filePath);
    return {
      path: filePath,
      relativePath,
      url: `/artifacts/${relativePath}`,
      ...extra
    };
  }

  appendArtifact(kind, value) {
    if (!value) {
      return;
    }

    if (Array.isArray(this.artifactIndex[kind])) {
      this.artifactIndex[kind] = [...this.artifactIndex[kind], value];
      return;
    }

    this.artifactIndex[kind] = value;
  }

  getArtifactIndex() {
    return JSON.parse(JSON.stringify(this.artifactIndex));
  }

  setArtifactIndex(artifactIndex = {}) {
    this.artifactIndex = JSON.parse(JSON.stringify(artifactIndex));
  }

  isFunctionalMode() {
    return this.runConfig?.testMode === "functional";
  }

  isUiuxMode() {
    return this.runConfig?.testMode === "uiux";
  }

  isAccessibilityMode() {
    return this.runConfig?.testMode === "accessibility";
  }

  accessibilityContrastConfig() {
    const contrast = this.runConfig?.accessibility?.contrast ?? {};
    return {
      enabled: contrast.enabled !== false,
      sampleLimit: Math.min(Math.max(Number(contrast.sampleLimit ?? 40) || 40, 5), 120),
      minRatioNormalText: Number(contrast.minRatioNormalText ?? 4.5) || 4.5,
      minRatioLargeText: Number(contrast.minRatioLargeText ?? 3.0) || 3.0
    };
  }

  accessibilityTextScaleConfig() {
    const textScale = this.runConfig?.accessibility?.textScale ?? {};
    const scales = Array.isArray(textScale.scales) ? textScale.scales : [1, 1.25, 1.5];
    const normalizedScales = [...new Set(
      scales
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Number(value.toFixed(2)))
        .filter((value) => value >= 1 && value <= 2)
    )].sort((left, right) => left - right);

    return {
      enabled: textScale.enabled !== false,
      scales: normalizedScales.length ? normalizedScales : [1, 1.25, 1.5]
    };
  }

  accessibilityReducedMotionConfig() {
    const reducedMotion = this.runConfig?.accessibility?.reducedMotion ?? {};
    return {
      enabled: reducedMotion.enabled !== false
    };
  }

  accessibilityFormsConfig() {
    const forms = this.runConfig?.accessibility?.forms ?? {};
    const mode = forms.mode === "safe-submit" ? "safe-submit" : "observe-only";
    const safeSubmitTypes = [...new Set(
      (Array.isArray(forms.safeSubmitTypes) ? forms.safeSubmitTypes : ["search"])
        .map((entry) => String(entry).trim().toLowerCase())
        .filter((entry) => ["search", "filter", "pagination"].includes(entry))
    )];

    return {
      enabled: forms.enabled !== false,
      mode,
      safeSubmitTypes: safeSubmitTypes.length ? safeSubmitTypes : ["search"],
      maxValidationAttemptsPerPage: Math.min(
        Math.max(Number(forms.maxValidationAttemptsPerPage ?? 1) || 1, 1),
        3
      )
    };
  }

  getAccessibilityValidationAttemptKey(url = this.page?.url?.() ?? this.runConfig?.startUrl ?? "") {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return String(url);
    }
  }

  functionalCapabilities() {
    return resolveFunctionalCapabilities(this.runConfig);
  }

  actionReadinessConfig() {
    if (this.isFunctionalMode()) {
      const readiness = resolveFunctionalReadiness(this.runConfig);
      return {
        strategy: readiness.strategy,
        timeoutMs: this.runConfig?.readiness?.readyTimeoutMs ?? config.networkIdleTimeoutMs,
        settleMs: readiness.postClickSettleMs
      };
    }
    return {
      strategy: this.runConfig?.readiness?.uiReadyStrategy,
      timeoutMs: this.runConfig?.readiness?.readyTimeoutMs,
      settleMs: config.postActionDelayMs
    };
  }

  resolveUploadFixturePath() {
    const fixture = this.functionalCapabilities().uploadFixturePath || "fixtures/upload.txt";
    if (path.isAbsolute(fixture)) {
      return fixture;
    }
    return path.resolve(config.profileDir, "..", fixture);
  }

  safetyAllowsDomain(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const allowlist = (this.runConfig?.safety?.allowlistDomains ?? []).map((entry) => entry.toLowerCase());
      const blocklist = (this.runConfig?.safety?.blocklistDomains ?? []).map((entry) => entry.toLowerCase());

      if (allowlist.length > 0) {
        const allowed = allowlist.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
        if (!allowed) {
          return false;
        }
      }

      if (blocklist.length > 0) {
        const blocked = blocklist.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
        if (blocked) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  isApiResourceType(resourceType) {
    return resourceType === "xhr" || resourceType === "fetch";
  }

  isThirdPartyUrl(url) {
    try {
      const targetHost = new URL(url).hostname.toLowerCase();
      const pageHost = new URL(this.page?.url?.() ?? this.runConfig?.startUrl ?? "").hostname.toLowerCase();
      return targetHost !== pageHost;
    } catch {
      return false;
    }
  }

  appendFunctionalNetworkRecord(record) {
    if (!this.isFunctionalMode() || !record) {
      return;
    }
    this.functionalNetworkRecords = [...this.functionalNetworkRecords, record].slice(-600);
  }

  async readGraphqlErrorSignal(response) {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!this.isApiResourceType(resourceType)) {
      return false;
    }

    const responseContentType = response.headers()?.["content-type"] ?? "";
    const urlPath = normalizeEndpointPath(response.url());
    const isGraphql = /graphql/i.test(urlPath) || /graphql/i.test(responseContentType);
    if (!isGraphql || !/json/i.test(responseContentType)) {
      return false;
    }

    try {
      const body = await response.json();
      if (Array.isArray(body)) {
        return body.some((entry) => Array.isArray(entry?.errors) && entry.errors.length > 0);
      }
      return Array.isArray(body?.errors) && body.errors.length > 0;
    } catch {
      return false;
    }
  }

  buildFunctionalStepNetworkSummary() {
    if (!this.isFunctionalMode()) {
      return {
        apiCalls: [],
        apiErrorCounts: {
          "4xx": 0,
          "5xx": 0,
          timeouts: 0
        },
        topFailingEndpoints: [],
        graphqlErrorsDetected: 0
      };
    }

    const nextRecords = this.functionalNetworkRecords.slice(this.functionalNetworkCursor);
    this.functionalNetworkCursor = this.functionalNetworkRecords.length;
    const apiRecords = nextRecords
      .filter((record) => this.isApiResourceType(record?.resourceType))
      .sort((left, right) => left.atMs - right.atMs);

    const apiCalls = apiRecords.slice(-30).map((record) => ({
      method: record.method,
      urlPath: record.urlPath,
      status: record.status,
      durationMs: record.durationMs,
      isThirdParty: record.isThirdParty,
      isGraphql: record.isGraphql,
      contentType: record.contentType
    }));

    const apiErrorCounts = apiRecords.reduce(
      (counts, record) => {
        const status = Number.parseInt(String(record.status ?? ""), 10);
        if (record.timedOut) {
          counts.timeouts += 1;
        } else if (!Number.isNaN(status) && status >= 400 && status < 500) {
          counts["4xx"] += 1;
        } else if (!Number.isNaN(status) && status >= 500) {
          counts["5xx"] += 1;
        }
        return counts;
      },
      {
        "4xx": 0,
        "5xx": 0,
        timeouts: 0
      }
    );

    const topFailingEndpoints = groupFailingEndpoints(apiRecords, { limit: 10 });
    const graphqlErrorsDetected = apiRecords.filter((record) => record.graphqlHasErrors).length;

    return {
      apiCalls,
      apiErrorCounts,
      topFailingEndpoints,
      graphqlErrorsDetected
    };
  }

  async launch() {
    const captureVideoMode = this.runConfig?.artifacts?.captureVideo ?? "fail-only";
    const shouldRecordVideo =
      captureVideoMode === "always" ||
      (captureVideoMode === "fail-only" && this.isFunctionalMode());

    await fs.mkdir(this.framesDir, { recursive: true });
    await fs.mkdir(this.consoleDir, { recursive: true });
    await fs.mkdir(this.networkDir, { recursive: true });
    if (this.isFunctionalMode() && this.functionalCapabilities().allowDownloads) {
      await fs.mkdir(this.downloadsDir, { recursive: true });
    }
    if (this.runConfig?.artifacts?.captureHtml) {
      await fs.mkdir(this.domDir, { recursive: true });
    }
    if (this.runConfig?.artifacts?.captureA11ySnapshot) {
      await fs.mkdir(this.a11yDir, { recursive: true });
    }
    if (shouldRecordVideo) {
      await fs.mkdir(this.videoDir, { recursive: true });
    }

    this.browser = await chromium.launch({
      headless: config.headless
    });

    const contextOptions = {
      viewport: { width: 1440, height: 900 }
    };

    if (this.storageStatePath && (await this.hasStorageState(this.storageStatePath))) {
      contextOptions.storageState = this.storageStatePath;
    }

    if (this.runConfig?.artifacts?.captureHar) {
      contextOptions.recordHar = {
        path: this.harPath,
        mode: "minimal"
      };
    }

    if (shouldRecordVideo) {
      contextOptions.recordVideo = {
        dir: this.videoDir,
        size: { width: 1440, height: 900 }
      };
    }

    this.context = await this.browser.newContext(contextOptions);
    await this.context
      .addInitScript(() => {
        window.addEventListener(
          "error",
          (event) => {
            const target = event.target;
            if (target instanceof HTMLImageElement) {
              target.dataset.qaImageError = "1";
            }
          },
          true
        );
      })
      .catch(() => {});
    if (this.runConfig?.artifacts?.captureTraceOnFail) {
      await this.context.tracing.start({ screenshots: true, snapshots: true });
      this.traceStarted = true;
    }

    this.page = await this.context.newPage();
    this.videoHandle = typeof this.page.video === "function" ? this.page.video() : null;
    this.attachTelemetry();
  }

  attachTelemetry() {
    this.page.on("request", (request) => {
      if (!this.isFunctionalMode()) {
        return;
      }
      this.requestStartTimes.set(request, Date.now());
    });

    this.page.on("console", (message) => {
      this.consoleEntries = [
        ...this.consoleEntries,
        {
          type: message.type(),
          text: message.text().slice(0, 400),
          location: message.location?.() ?? null,
          timestamp: new Date().toISOString()
        }
      ].slice(-80);
    });

    this.page.on("requestfailed", (request) => {
      this.networkSummary.totalRequests += 1;
      const failureText = request.failure()?.errorText ?? "request failed";
      const isAbortedFailure = /err_aborted|aborted/i.test(failureText);
      if (isAbortedFailure) {
        this.networkSummary.abortedRequests += 1;
      } else {
        this.networkSummary.failedRequests += 1;
      }
      const requestStartedAt = this.requestStartTimes.get(request) ?? Date.now();
      this.requestStartTimes.delete(request);
      if (request.isNavigationRequest() && request.resourceType() === "document" && !isAbortedFailure) {
        this.networkSummary.mainDocumentFailed = true;
        this.networkSummary.mainDocumentUrl = request.url().slice(0, 280);
        this.networkSummary.mainDocumentContentType = null;
      }

      if (this.isFunctionalMode() && this.isApiResourceType(request.resourceType())) {
        const timedOut = /timed out|timeout|net::err_timed_out/i.test(failureText);
        const durationMs = Math.max(Date.now() - requestStartedAt, 0);
        this.appendFunctionalNetworkRecord({
          atMs: Date.now(),
          method: request.method(),
          url: request.url(),
          urlPath: normalizeEndpointPath(request.url()),
          status: null,
          durationMs,
          isThirdParty: this.isThirdPartyUrl(request.url()),
          isGraphql: /graphql/i.test(request.url()),
          contentType: null,
          timedOut,
          graphqlHasErrors: false,
          resourceType: request.resourceType()
        });
      }

      this.networkSummary.lastFailures = [
        ...this.networkSummary.lastFailures,
        {
          type: "requestfailed",
          method: request.method(),
          url: request.url().slice(0, 280),
          status: null,
          timestamp: new Date().toISOString(),
          failureText,
          isAbortedFailure
        }
      ].slice(-20);
    });

    this.page.on("response", async (response) => {
      this.networkSummary.totalRequests += 1;
      const status = response.status();
      const responseHeaders = response.headers?.() ?? {};
      const contentType = responseHeaders["content-type"] ?? null;
      const request = response.request();
      const requestStartedAt = this.requestStartTimes.get(request) ?? Date.now();
      this.requestStartTimes.delete(request);
      if (response.request().isNavigationRequest() && response.request().resourceType() === "document") {
        this.networkSummary.mainDocumentStatus = status;
        this.networkSummary.mainDocumentUrl = response.url().slice(0, 280);
        this.networkSummary.mainDocumentContentType = contentType ? contentType.slice(0, 120) : null;
        this.networkSummary.mainDocumentFailed = status >= 400;
      }
      if (status >= 400 && status < 500) {
        this.networkSummary.status4xx += 1;
        if (status === 429) {
          this.networkSummary.status429 += 1;
        }
      }
      if (status >= 500) {
        this.networkSummary.status5xx += 1;
      }
      if (status >= 400) {
        this.networkSummary.lastFailures = [
          ...this.networkSummary.lastFailures,
          {
            type: "response",
            method: response.request().method(),
            url: response.url().slice(0, 280),
            status,
            timestamp: new Date().toISOString()
          }
        ].slice(-20);
      }

      if (!this.isFunctionalMode() || !this.isApiResourceType(request.resourceType())) {
        return;
      }

      const durationMs = Math.max(Date.now() - requestStartedAt, 0);
      const url = response.url();
      const urlPath = normalizeEndpointPath(url);
      const normalizedContentType = contentType ? contentType.split(";")[0].trim().slice(0, 80) : null;
      const isGraphql = /graphql/i.test(urlPath) || /graphql/i.test(normalizedContentType ?? "");
      const graphqlHasErrors = isGraphql ? await this.readGraphqlErrorSignal(response) : false;

      this.appendFunctionalNetworkRecord({
        atMs: Date.now(),
        method: request.method(),
        url,
        urlPath,
        status,
        durationMs,
        isThirdParty: this.isThirdPartyUrl(url),
        isGraphql,
        contentType: normalizedContentType,
        timedOut: false,
        graphqlHasErrors,
        resourceType: request.resourceType()
      });
    });
  }

  async hasStorageState(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async hasFile(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getViewportSize() {
    return this.page?.viewportSize?.() ?? null;
  }

  getCurrentUiuxDeviceProfile() {
    return this.currentUiuxDeviceProfile ? { ...this.currentUiuxDeviceProfile } : null;
  }

  resolveScreenshotCaptureMode() {
    return this.isUiuxMode() ? "viewport" : "full-page";
  }

  resolveScreenshotCaptureOptions() {
    const captureMode = this.resolveScreenshotCaptureMode();
    return {
      captureMode,
      fullPage: captureMode === "full-page"
    };
  }

  async setViewportSize(viewport) {
    await this.page.setViewportSize({
      width: viewport.width,
      height: viewport.height
    });
    if (this.currentUiuxDeviceProfile) {
      this.currentUiuxDeviceProfile = {
        ...this.currentUiuxDeviceProfile,
        width: Number(viewport.width),
        height: Number(viewport.height)
      };
    }
  }

  async applyUiuxDeviceProfile(profile = {}) {
    if (!this.page) {
      return null;
    }

    const width = Math.max(Math.round(Number(profile.width) || 0), 240);
    const height = Math.max(Math.round(Number(profile.height) || 0), 320);
    const dpr = Math.min(Math.max(Number(profile.dpr) || 1, 1), 4);
    const normalized = {
      id: String(profile.id ?? `uiux-${width}x${height}-${dpr}x`),
      label: String(profile.label ?? `${width}x${height}`).trim() || `${width}x${height}`,
      width,
      height,
      dpr,
      deviceClass: profile.deviceClass ?? (width <= 640 ? "mobile" : width <= 1024 ? "tablet" : "desktop"),
      isMobile: Boolean(profile.isMobile ?? width <= 1024),
      userAgent: profile.userAgent ? String(profile.userAgent) : null
    };

    await this.setViewportSize({
      width: normalized.width,
      height: normalized.height
    });

    if (
      this.isUiuxMode() &&
      this.runConfig?.uiux?.devices?.includeUserAgents &&
      normalized.userAgent &&
      this.currentUiuxUserAgent !== normalized.userAgent
    ) {
      await this.context
        ?.setExtraHTTPHeaders({
          "user-agent": normalized.userAgent
        })
        .catch(() => {});
      this.currentUiuxUserAgent = normalized.userAgent;
    }

    this.currentUiuxDeviceProfile = normalized;
    return { ...normalized };
  }

  resetNavigationTracking() {
    this.networkSummary.mainDocumentStatus = null;
    this.networkSummary.mainDocumentUrl = null;
    this.networkSummary.mainDocumentContentType = null;
    this.networkSummary.mainDocumentFailed = false;
  }

  recordMainDocumentResponse(response, fallbackUrl = null) {
    if (response) {
      const status = response.status();
      this.networkSummary.mainDocumentStatus = status;
      this.networkSummary.mainDocumentUrl = response.url().slice(0, 280);
      const contentType = response.headers?.()?.["content-type"] ?? null;
      this.networkSummary.mainDocumentContentType = contentType ? contentType.slice(0, 120) : null;
      this.networkSummary.mainDocumentFailed = status >= 400;
      return;
    }

    if (fallbackUrl && !this.networkSummary.mainDocumentUrl) {
      this.networkSummary.mainDocumentUrl = fallbackUrl.slice(0, 280);
    }
  }

  async goto(url) {
    const readiness = this.actionReadinessConfig();
    this.resetNavigationTracking();
    const response = await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    this.recordMainDocumentResponse(response, url);
    await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
    await this.applySiteGuards(url);
    await this.page.waitForTimeout(readiness.settleMs);
  }

  async goForward() {
    const readiness = this.actionReadinessConfig();
    this.resetNavigationTracking();
    const response = await this.page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
    this.recordMainDocumentResponse(response, this.page.url());
    await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
    await this.page.waitForTimeout(readiness.settleMs);
  }

  async waitForInteractiveReady() {
    await this.page.waitForLoadState("domcontentloaded", { timeout: config.domReadyTimeoutMs }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: config.networkIdleTimeoutMs }).catch(() => {});
  }

  async waitForUIReady(strategy = "networkidle-only", timeoutMs = config.networkIdleTimeoutMs) {
    const selectedStrategy = strategy ?? "networkidle-only";
    let completed = true;
    if (selectedStrategy === "networkidle-only") {
      completed = await this.waitForNetworkIdleReady(timeoutMs);
    } else if (selectedStrategy === "stable-layout") {
      completed = await this.waitForStableLayout(timeoutMs);
    } else {
      const networkCompleted = await this.waitForNetworkIdleReady(Math.max(Math.floor(timeoutMs * 0.6), 1_000));
      const stableCompleted = await this.waitForStableLayout(timeoutMs);
      completed = networkCompleted && stableCompleted;
    }
    this.lastUiReadyState = {
      strategy: selectedStrategy,
      timedOut: !completed,
      completed,
      checkedAt: new Date().toISOString()
    };
    return this.lastUiReadyState;
  }

  async waitForNetworkIdleReady(timeoutMs) {
    const domReady = await this.page
      .waitForLoadState("domcontentloaded", { timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    const networkReady = await this.page
      .waitForLoadState("networkidle", { timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    return domReady && networkReady;
  }

  async sampleLayoutState() {
    return this.page.evaluate(() => {
      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0 &&
          rect.width > 4 &&
          rect.height > 4
        );
      }

      function summarizeBounds(element) {
        const rect = element.getBoundingClientRect();
        return [
          Math.round(rect.x),
          Math.round(rect.y),
          Math.round(rect.width),
          Math.round(rect.height)
        ];
      }

      const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
      const landmarks = Array.from(
        document.querySelectorAll(
          "header, nav, main, aside, footer, [role='banner'], [role='navigation'], [role='main'], [role='dialog']"
        )
      )
        .filter(isVisible)
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          label: (
            element.getAttribute("aria-label") ||
            element.getAttribute("id") ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          bounds: summarizeBounds(element)
        }));

      const blockingElements = Array.from(
        document.querySelectorAll(
          [
            "dialog",
            "[role='dialog']",
            "[aria-modal='true']",
            ".modal",
            ".spinner",
            ".loader",
            "[aria-busy='true']",
            "[role='progressbar']"
          ].join(",")
        )
      ).filter(isVisible);

      const persistentBlockers = blockingElements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const area = rect.width * rect.height;
          return {
            areaRatio: area / viewportArea,
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120)
          };
        })
        .filter((entry) => entry.areaRatio >= 0.18);

      return {
        signature: JSON.stringify(landmarks),
        persistentBlockerCount: persistentBlockers.length,
        persistentBlockers
      };
    });
  }

  async waitForStableLayout(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let previousSignature = null;
    let stableFrames = 0;

    while (Date.now() < deadline) {
      const sample = await this.sampleLayoutState().catch(() => null);
      if (!sample) {
        await this.page.waitForTimeout(120);
        continue;
      }

      if (sample.signature === previousSignature) {
        stableFrames += 1;
      } else {
        stableFrames = 1;
        previousSignature = sample.signature;
      }

      if (stableFrames >= 3 && sample.persistentBlockerCount === 0) {
        return true;
      }

      await this.page.waitForTimeout(120);
    }
    return false;
  }

  async applySiteGuards(url = this.page?.url?.() ?? "") {
    if (!this.isYouTubeUrl(url)) {
      return;
    }

    await this.page
      .addStyleTag({
        content: `
          #primary { filter: none !important; }
          #guide,
          ytd-guide-renderer,
          #sections.ytd-guide-renderer {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
            width: 0 !important;
            min-width: 0 !important;
            max-width: 0 !important;
          }
          ytd-app {
            --ytd-persistent-guide-width: 0px !important;
          }
          #masthead-container {
            border: 5px solid rgba(59, 130, 246, 0.95) !important;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important;
          }
          ytd-guide-signin-promo-renderer,
          ytd-consent-bump-v2-lightbox,
          ytd-modal-with-title-and-button-renderer,
          yt-upsell-dialog-renderer,
          ytd-ad-slot-renderer,
          ytd-display-ad-renderer,
          ytd-promoted-sparkles-web-renderer {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
        `
      })
      .catch(() => {});

    if (/results\?search_query=/i.test(url)) {
      await this.page
        .waitForSelector("ytd-video-renderer", {
          state: "visible",
          timeout: Math.max(config.selectorVisibleTimeoutMs, 10_000)
        })
        .catch(() => {});
    }

    await this.page
      .evaluate(() => {
        const blockers = Array.from(
          document.querySelectorAll(
            [
              "tp-yt-paper-dialog",
              "ytd-guide-signin-promo-renderer",
              "ytd-consent-bump-v2-lightbox",
              "ytd-modal-with-title-and-button-renderer",
              "yt-upsell-dialog-renderer"
            ].join(",")
          )
        );

        for (const element of blockers) {
          const text = (element.textContent || "").toLowerCase();
          if (
            /sign in|try searching to get started|before you continue|cookies|personalized|get started/.test(text)
          ) {
            element.style.setProperty("display", "none", "important");
            element.style.setProperty("visibility", "hidden", "important");
            element.style.setProperty("opacity", "0", "important");
            element.style.setProperty("pointer-events", "none", "important");
          }
        }

        document.body.style.removeProperty("overflow");
        document.documentElement.style.removeProperty("overflow");
      })
      .catch(() => {});
  }

  async collectFocusVisibilityProbe(maxTabs = 8) {
    if (!this.page) {
      return null;
    }

    const originalScroll = await this.page
      .evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
      }))
      .catch(() => ({ x: 0, y: 0 }));

    const steps = [];
    let anyFocusable = false;
    let anyVisibleIndicator = false;

    await this.page
      .evaluate(() => {
        document.activeElement?.blur?.();
      })
      .catch(() => {});

    for (let index = 0; index < maxTabs; index += 1) {
      await this.page.keyboard.press("Tab").catch(() => {});
      await this.page.waitForTimeout(40);

      const focusState = await this.page
        .evaluate(() => {
          function makeSelector(element) {
            if (!element || !(element instanceof Element)) {
              return null;
            }

            const testId = element.getAttribute("data-testid");
            if (testId) {
              return `[data-testid="${CSS.escape(testId)}"]`;
            }

            const ariaLabel = element.getAttribute("aria-label");
            if (ariaLabel) {
              return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
            }

            if (element.id) {
              return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
            }

            return element.tagName.toLowerCase();
          }

          const active = document.activeElement;
          if (!active || active === document.body || active === document.documentElement) {
            return {
              selector: null,
              text: "",
              inViewport: false,
              visibleIndicator: false
            };
          }

          const rect = active.getBoundingClientRect();
          const style = window.getComputedStyle(active);
          const visibleIndicator =
            active.matches(":focus-visible") ||
            (style.outlineStyle && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth || "0") >= 1) ||
            (style.boxShadow && style.boxShadow !== "none");

          return {
            selector: makeSelector(active),
            text: (
              active.getAttribute("aria-label") ||
              active.getAttribute("title") ||
              active.textContent ||
              active.getAttribute("placeholder") ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120),
            inViewport:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.top < window.innerHeight &&
              rect.left < window.innerWidth,
            visibleIndicator
          };
        })
        .catch(() => null);

      if (!focusState?.selector) {
        continue;
      }

      anyFocusable = true;
      anyVisibleIndicator = anyVisibleIndicator || Boolean(focusState.visibleIndicator);
      steps.push({
        step: index + 1,
        ...focusState
      });
    }

    await this.page
      .evaluate((scroll) => {
        document.activeElement?.blur?.();
        window.scrollTo(scroll.x, scroll.y);
      }, originalScroll)
      .catch(() => {});

    return {
      attempted: true,
      maxTabs,
      anyFocusable,
      anyVisibleIndicator,
      steps
    };
  }

  async collectAccessibilityFocusProbe(maxTabs = 10) {
    if (!this.page || !this.isAccessibilityMode()) {
      return null;
    }

    const boundedMaxTabs = Math.min(Math.max(Number(maxTabs) || 10, 1), 12);
    const originalScroll = await this.page
      .evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
      }))
      .catch(() => ({ x: 0, y: 0 }));

    const steps = [];
    let anyFocusable = false;
    let anyVisibleIndicator = false;

    await this.page
      .evaluate(() => {
        document.activeElement?.blur?.();
      })
      .catch(() => {});

    const totalFocusableCount = await this.page
      .evaluate(() => {
        function isVisible(element) {
          if (!element) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        const selector = [
          "a[href]",
          "button",
          "input:not([type='hidden'])",
          "select",
          "textarea",
          "[tabindex]:not([tabindex='-1'])",
          "[role='button']",
          "[role='link']",
          "[role='menuitem']",
          "[role='option']"
        ].join(",");

        return Array.from(document.querySelectorAll(selector))
          .filter((element) => !element.matches(":disabled"))
          .filter((element) => isVisible(element)).length;
      })
      .catch(() => 0);

    for (let index = 0; index < boundedMaxTabs; index += 1) {
      await this.page.keyboard.press("Tab").catch(() => {});
      await this.page.waitForTimeout(40);

      const focusState = await this.page
        .evaluate(() => {
          function makeSelector(element) {
            if (!element || !(element instanceof Element)) {
              return null;
            }

            const testId = element.getAttribute("data-testid");
            if (testId) {
              return `[data-testid="${CSS.escape(testId)}"]`;
            }

            const ariaLabel = element.getAttribute("aria-label");
            if (ariaLabel) {
              return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
            }

            if (element.id) {
              return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
            }

            return element.tagName.toLowerCase();
          }

          function accessibleNameFor(element) {
            if (!element) {
              return "";
            }

            const ariaLabel = element.getAttribute("aria-label");
            if (ariaLabel?.trim()) {
              return ariaLabel.trim().slice(0, 140);
            }

            const labelledBy = element.getAttribute("aria-labelledby");
            if (labelledBy) {
              const labelText = labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
              if (labelText) {
                return labelText.slice(0, 140);
              }
            }

            const title = element.getAttribute("title");
            if (title?.trim()) {
              return title.trim().slice(0, 140);
            }

            const placeholder = element.getAttribute("placeholder");
            if (placeholder?.trim()) {
              return placeholder.trim().slice(0, 140);
            }

            const value =
              "value" in element && typeof element.value === "string" ? element.value.trim() : "";
            if (value) {
              return value.replace(/\s+/g, " ").slice(0, 140);
            }

            return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140);
          }

          function resolveRole(element) {
            if (!element) {
              return "";
            }
            const explicitRole = element.getAttribute("role");
            if (explicitRole) {
              return explicitRole.toLowerCase();
            }
            const tag = element.tagName.toLowerCase();
            if (tag === "a") {
              return "link";
            }
            if (tag === "button") {
              return "button";
            }
            if (tag === "input") {
              return (element.getAttribute("type") || "textbox").toLowerCase();
            }
            return tag;
          }

          const active = document.activeElement;
          if (!active || active === document.body || active === document.documentElement) {
            return {
              selector: null,
              role: "",
              accessibleName: "",
              inViewport: false,
              visibleFocusIndicator: false
            };
          }

          const rect = active.getBoundingClientRect();
          const style = window.getComputedStyle(active);
          const visibleFocusIndicator =
            active.matches(":focus-visible") ||
            (style.outlineStyle &&
              style.outlineStyle !== "none" &&
              Number.parseFloat(style.outlineWidth || "0") >= 1) ||
            (style.boxShadow && style.boxShadow !== "none");

          return {
            selector: makeSelector(active),
            role: resolveRole(active),
            accessibleName: accessibleNameFor(active),
            inViewport:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.top < window.innerHeight &&
              rect.left < window.innerWidth,
            visibleFocusIndicator
          };
        })
        .catch(() => null);

      if (!focusState?.selector) {
        continue;
      }

      anyFocusable = true;
      anyVisibleIndicator = anyVisibleIndicator || Boolean(focusState.visibleFocusIndicator);
      steps.push({
        step: index + 1,
        selector: focusState.selector,
        role: focusState.role,
        accessibleName: focusState.accessibleName,
        inViewport: focusState.inViewport,
        visibleFocusIndicator: Boolean(focusState.visibleFocusIndicator)
      });
    }

    await this.page
      .evaluate((scroll) => {
        document.activeElement?.blur?.();
        window.scrollTo(scroll.x, scroll.y);
      }, originalScroll)
      .catch(() => {});

    const selectorCounts = steps.reduce((map, entry) => {
      if (!entry.selector) {
        return map;
      }
      map.set(entry.selector, (map.get(entry.selector) ?? 0) + 1);
      return map;
    }, new Map());
    const repeatedSelectors = [...selectorCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([selector]) => selector)
      .slice(0, 6);
    const uniqueFocusedCount = selectorCounts.size;
    const loopDetected = repeatedSelectors.length > 0 && uniqueFocusedCount <= 3 && steps.length >= 5;
    const potentialTrap = loopDetected && totalFocusableCount > uniqueFocusedCount;

    return {
      attempted: true,
      maxTabs: boundedMaxTabs,
      totalFocusableCount,
      anyFocusable,
      anyVisibleIndicator,
      uniqueFocusedCount,
      repeatedSelectors,
      loopDetected,
      potentialTrap,
      steps
    };
  }

  async collectAccessibilityContrastSamples() {
    if (!this.page || !this.isAccessibilityMode()) {
      return null;
    }

    const contrastConfig = this.accessibilityContrastConfig();
    if (!contrastConfig.enabled) {
      return {
        enabled: false,
        sampleLimit: contrastConfig.sampleLimit,
        minRatioNormalText: contrastConfig.minRatioNormalText,
        minRatioLargeText: contrastConfig.minRatioLargeText,
        sampledCount: 0,
        totalCandidates: 0,
        offenders: [],
        worstRatio: null
      };
    }

    return this.page
      .evaluate((config) => {
        function parseCssColor(value) {
          const raw = String(value || "").trim().toLowerCase();
          if (!raw || raw === "transparent") {
            return { r: 0, g: 0, b: 0, a: 0 };
          }

          const match = raw.match(/rgba?\\(([^)]+)\\)/i);
          if (!match) {
            return { r: 0, g: 0, b: 0, a: 1 };
          }

          const parts = match[1].split(",").map((part) => part.trim());
          const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part) || 0);
          const a = parts[3] !== undefined ? Number.parseFloat(parts[3]) || 0 : 1;
          return {
            r: Math.min(Math.max(r, 0), 255),
            g: Math.min(Math.max(g, 0), 255),
            b: Math.min(Math.max(b, 0), 255),
            a: Math.min(Math.max(a, 0), 1)
          };
        }

        function blend(foreground, background) {
          const alpha = foreground.a + background.a * (1 - foreground.a);
          if (alpha <= 0) {
            return { r: 0, g: 0, b: 0, a: 0 };
          }
          return {
            r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
            g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
            b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
            a: alpha
          };
        }

        function srgbToLinear(channel) {
          const value = channel / 255;
          return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        }

        function relativeLuminance(color) {
          return (
            0.2126 * srgbToLinear(color.r) +
            0.7152 * srgbToLinear(color.g) +
            0.0722 * srgbToLinear(color.b)
          );
        }

        function contrastRatio(foreground, background) {
          const lum1 = relativeLuminance(foreground);
          const lum2 = relativeLuminance(background);
          const lighter = Math.max(lum1, lum2);
          const darker = Math.min(lum1, lum2);
          return (lighter + 0.05) / (darker + 0.05);
        }

        function isVisible(element) {
          if (!element) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
          );
        }

        function selectorFor(element) {
          if (!element || !(element instanceof Element)) {
            return null;
          }
          const testId = element.getAttribute("data-testid");
          if (testId) {
            return `[data-testid="${CSS.escape(testId)}"]`;
          }
          const ariaLabel = element.getAttribute("aria-label");
          if (ariaLabel) {
            return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
          }
          if (element.id) {
            return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
          }
          return element.tagName.toLowerCase();
        }

        function ownTextContent(element) {
          let text = "";
          for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              text += ` ${node.textContent || ""}`;
            }
          }
          const normalized = text.replace(/\s+/g, " ").trim();
          if (normalized) {
            return normalized;
          }
          return (element.textContent || "").replace(/\s+/g, " ").trim();
        }

        function resolveBackgroundColor(element) {
          let current = element;
          while (current && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            const bg = parseCssColor(style.backgroundColor);
            if (bg.a > 0) {
              return bg;
            }
            current = current.parentElement;
          }

          const htmlBg = parseCssColor(window.getComputedStyle(document.documentElement).backgroundColor);
          if (htmlBg.a > 0) {
            return htmlBg;
          }
          const bodyBg = parseCssColor(window.getComputedStyle(document.body).backgroundColor);
          if (bodyBg.a > 0) {
            return bodyBg;
          }

          return { r: 255, g: 255, b: 255, a: 1 };
        }

        function parseFontWeight(value) {
          const normalized = String(value || "").trim().toLowerCase();
          if (normalized === "bold") {
            return 700;
          }
          const parsed = Number.parseInt(normalized, 10);
          return Number.isFinite(parsed) ? parsed : 400;
        }

        function isLargeText(fontSizePx, fontWeight) {
          return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
        }

        const sampleLimit = Math.min(Math.max(Number(config.sampleLimit || 40), 5), 120);
        const textSelector = [
          "p",
          "span",
          "a",
          "button",
          "label",
          "li",
          "td",
          "th",
          "small",
          "strong",
          "em",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6"
        ].join(",");

        const candidates = Array.from(document.querySelectorAll(textSelector))
          .filter((element) => isVisible(element))
          .map((element) => ({
            element,
            text: ownTextContent(element)
          }))
          .filter((entry) => entry.text.length >= 3)
          .slice(0, sampleLimit * 4);

        const white = { r: 255, g: 255, b: 255, a: 1 };
        const samples = candidates
          .map(({ element, text }) => {
            const style = window.getComputedStyle(element);
            const fontSizePx = Number.parseFloat(style.fontSize || "0") || 0;
            const fontWeight = parseFontWeight(style.fontWeight);
            const largeText = isLargeText(fontSizePx, fontWeight);
            const requiredRatio = largeText ? Number(config.minRatioLargeText || 3) : Number(config.minRatioNormalText || 4.5);
            const foregroundRaw = parseCssColor(style.color);
            const backgroundRaw = resolveBackgroundColor(element);
            const background = backgroundRaw.a < 1 ? blend(backgroundRaw, white) : { ...backgroundRaw, a: 1 };
            const foreground = foregroundRaw.a < 1 ? blend(foregroundRaw, background) : { ...foregroundRaw, a: 1 };
            const ratio = contrastRatio(foreground, background);

            return {
              selector: selectorFor(element),
              textSample: text.slice(0, 140),
              ratio: Number(ratio.toFixed(2)),
              requiredRatio: Number(requiredRatio.toFixed(2)),
              fontSizePx: Number(fontSizePx.toFixed(2)),
              fontWeight,
              isLargeText: largeText,
              passes: ratio >= requiredRatio
            };
          })
          .slice(0, sampleLimit);

        const offenders = samples
          .filter((sample) => !sample.passes)
          .sort((left, right) => left.ratio - right.ratio)
          .slice(0, 15);

        return {
          enabled: true,
          sampleLimit,
          minRatioNormalText: Number(config.minRatioNormalText || 4.5),
          minRatioLargeText: Number(config.minRatioLargeText || 3),
          sampledCount: samples.length,
          totalCandidates: candidates.length,
          offenders,
          worstRatio: offenders.length ? offenders[0].ratio : null
        };
      }, contrastConfig)
      .catch(() => null);
  }

  async measureAccessibilityTextScaleSignals() {
    if (!this.page) {
      return null;
    }

    return this.page
      .evaluate(() => {
        function isVisible(element) {
          if (!element) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        const viewportWidth = window.innerWidth;
        const pageWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
          viewportWidth
        );
        const horizontalOverflowPx = Math.max(0, pageWidth - viewportWidth);

        const textOverflowItemsCount = Array.from(
          document.querySelectorAll("a, button, label, h1, h2, h3, h4, p, span, div")
        )
          .filter((element) => isVisible(element))
          .slice(0, 240)
          .filter((element) => {
            const style = window.getComputedStyle(element);
            const overflowX = style.overflowX || style.overflow;
            const textOverflow = style.textOverflow || "";
            const overflowPx = element.scrollWidth - element.clientWidth;
            if (element.clientWidth <= 0 || overflowPx < 12) {
              return false;
            }
            if (!["hidden", "clip"].includes(overflowX) && textOverflow === "clip") {
              return false;
            }
            return true;
          }).length;

        return {
          viewportWidth,
          pageWidth,
          horizontalOverflowPx,
          textOverflowItemsCount
        };
      })
      .catch(() => null);
  }

  async collectAccessibilityTextScaleFindings() {
    if (!this.page || !this.isAccessibilityMode()) {
      return null;
    }

    const textScaleConfig = this.accessibilityTextScaleConfig();
    if (!textScaleConfig.enabled) {
      return {
        enabled: false,
        scales: textScaleConfig.scales,
        baseline: null,
        results: []
      };
    }

    const baseline = await this.measureAccessibilityTextScaleSignals();
    if (!baseline) {
      return null;
    }

    const originalInlineFontSize = await this.page
      .evaluate(() => document.documentElement.style.fontSize || null)
      .catch(() => null);

    const results = [];
    const scales = textScaleConfig.scales;
    const scalesToProbe = scales.filter((scale) => scale > 1);
    try {
      for (const scale of scalesToProbe) {
        await this.page
          .evaluate((nextScale) => {
            document.documentElement.style.setProperty("font-size", `${Math.round(nextScale * 100)}%`, "important");
            document.documentElement.setAttribute("data-qa-text-scale", String(nextScale));
          }, scale)
          .catch(() => {});

        await this.waitForUIReady(
          this.runConfig?.readiness?.uiReadyStrategy,
          this.runConfig?.readiness?.readyTimeoutMs
        );

        const measurement = await this.measureAccessibilityTextScaleSignals();
        if (!measurement) {
          continue;
        }

        const deltaHorizontalOverflow = measurement.horizontalOverflowPx - baseline.horizontalOverflowPx;
        const deltaTextOverflowCount = measurement.textOverflowItemsCount - baseline.textOverflowItemsCount;
        const breaksLayout = deltaHorizontalOverflow > 24 || deltaTextOverflowCount >= 3;

        results.push({
          scale,
          ...measurement,
          deltaHorizontalOverflow,
          deltaTextOverflowCount,
          breaksLayout
        });
      }
    } finally {
      await this.page
        .evaluate((originalFontSize) => {
          document.documentElement.removeAttribute("data-qa-text-scale");
          if (originalFontSize === null || originalFontSize === undefined || originalFontSize === "") {
            document.documentElement.style.removeProperty("font-size");
          } else {
            document.documentElement.style.fontSize = originalFontSize;
          }
        }, originalInlineFontSize)
        .catch(() => {});

      await this.waitForUIReady(
        this.runConfig?.readiness?.uiReadyStrategy,
        this.runConfig?.readiness?.readyTimeoutMs
      );
    }

    return {
      enabled: true,
      scales,
      baseline,
      results
    };
  }

  async collectAccessibilityReducedMotionFindings() {
    if (!this.page || !this.isAccessibilityMode()) {
      return null;
    }

    const reducedMotionConfig = this.accessibilityReducedMotionConfig();
    if (!reducedMotionConfig.enabled) {
      return {
        enabled: false,
        emulated: false,
        scannedCount: 0,
        longAnimationCount: 0,
        longAnimationSelectors: []
      };
    }

    try {
      await this.page.emulateMedia({ reducedMotion: "reduce" });
      await this.waitForUIReady(
        this.runConfig?.readiness?.uiReadyStrategy,
        this.runConfig?.readiness?.readyTimeoutMs
      );

      return await this.page
        .evaluate(() => {
          function parseDurationMs(value = "") {
            return String(value)
              .split(",")
              .map((part) => part.trim())
              .map((part) => {
                if (!part) {
                  return 0;
                }
                if (part.endsWith("ms")) {
                  return Number.parseFloat(part.slice(0, -2)) || 0;
                }
                if (part.endsWith("s")) {
                  return (Number.parseFloat(part.slice(0, -1)) || 0) * 1000;
                }
                return Number.parseFloat(part) || 0;
              })
              .reduce((max, next) => Math.max(max, next), 0);
          }

          function isVisibleInViewport(element) {
            if (!element) {
              return false;
            }
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number.parseFloat(style.opacity || "1") > 0 &&
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.top < window.innerHeight &&
              rect.left < window.innerWidth
            );
          }

          function selectorFor(element) {
            const testId = element.getAttribute("data-testid");
            if (testId) {
              return `[data-testid="${CSS.escape(testId)}"]`;
            }
            const ariaLabel = element.getAttribute("aria-label");
            if (ariaLabel) {
              return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
            }
            if (element.id) {
              return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
            }
            return element.tagName.toLowerCase();
          }

          const scannedElements = Array.from(document.querySelectorAll("*"))
            .filter((element) => isVisibleInViewport(element))
            .slice(0, 300);

          const longAnimations = scannedElements
            .map((element) => {
              const style = window.getComputedStyle(element);
              const animationDurationMs = parseDurationMs(style.animationDuration);
              const transitionDurationMs = parseDurationMs(style.transitionDuration);
              const animationName = String(style.animationName || "").toLowerCase();
              const longAnimation =
                (animationName !== "none" && animationDurationMs > 1000) ||
                transitionDurationMs > 1000;
              if (!longAnimation) {
                return null;
              }
              return {
                selector: selectorFor(element),
                animationDurationMs: Math.round(animationDurationMs),
                transitionDurationMs: Math.round(transitionDurationMs),
                animationName
              };
            })
            .filter(Boolean);

          return {
            enabled: true,
            emulated: true,
            scannedCount: scannedElements.length,
            longAnimationCount: longAnimations.length,
            longAnimationSelectors: longAnimations.slice(0, 20)
          };
        })
        .catch(() => null);
    } finally {
      await this.page.emulateMedia({ reducedMotion: "no-preference" }).catch(() => {});
      await this.waitForUIReady(
        this.runConfig?.readiness?.uiReadyStrategy,
        this.runConfig?.readiness?.readyTimeoutMs
      );
    }
  }

  async collectAccessibilityFormValidationProbe() {
    if (!this.page || !this.isAccessibilityMode()) {
      return null;
    }

    const formsConfig = this.accessibilityFormsConfig();
    const baseResult = {
      enabled: formsConfig.enabled,
      mode: formsConfig.mode,
      safeSubmitTypes: formsConfig.safeSubmitTypes,
      maxValidationAttemptsPerPage: formsConfig.maxValidationAttemptsPerPage,
      attempted: false,
      submitType: null,
      skippedReason: null,
      targetSelector: null,
      expectedInvalidSelector: null,
      firstInvalidFocusAfterSubmit: null,
      visibleErrorCountAfterSubmit: 0,
      associatedErrorCountAfterSubmit: 0,
      submitEventTriggered: false
    };

    if (!formsConfig.enabled || formsConfig.mode !== "safe-submit") {
      return baseResult;
    }

    if (!formsConfig.safeSubmitTypes.includes("search")) {
      return {
        ...baseResult,
        skippedReason: "submit-type-not-allowed"
      };
    }

    const pageKey = this.getAccessibilityValidationAttemptKey();
    const attempts = this.accessibilityValidationAttempts.get(pageKey) ?? 0;
    if (attempts >= formsConfig.maxValidationAttemptsPerPage) {
      return {
        ...baseResult,
        skippedReason: "max-validation-attempts-reached"
      };
    }

    const probeResult = await this.page
      .evaluate(() => {
        function normalize(value = "") {
          return String(value ?? "").replace(/\s+/g, " ").trim();
        }

        function toLower(value = "") {
          return normalize(value).toLowerCase();
        }

        const identifierHintPattern =
          /\b(email|e-mail|username|user name|user|login|identifier|account|phone|mobile|access key|account id|employee id|user id|member id|workspace id|tenant id|organization id|organisation id|customer id|login id|sign[-\s]?in id|handle|short code|portal key|staff id|staff portal key)\b/;
        const searchHintPattern = /\b(search|query|find)\b/;
        const otpHintPattern = /\b(otp|verification|verify|code|2fa|two[-\s]?factor|one[-\s]?time|security code)\b/;

        function isVisible(element) {
          if (!element || !(element instanceof HTMLElement)) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        function getLabel(element) {
          if (!element) {
            return "";
          }
          const aria = element.getAttribute("aria-label");
          if (aria) {
            return normalize(aria);
          }
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            const labels = Array.from(element.labels ?? []);
            const labelText = labels
              .map((label) => normalize(label.textContent || ""))
              .filter(Boolean)
              .join(" ");
            if (labelText) {
              return labelText;
            }
          }
          return normalize(element.textContent || element.getAttribute("placeholder") || element.getAttribute("name") || "");
        }

        function selectorFor(element) {
          if (!element || !(element instanceof Element)) {
            return null;
          }
          const testId = element.getAttribute("data-testid");
          if (testId) {
            return `[data-testid="${CSS.escape(testId)}"]`;
          }
          const ariaLabel = element.getAttribute("aria-label");
          if (ariaLabel) {
            return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
          }
          const name = element.getAttribute("name");
          if (name) {
            return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
          }
          if (element.id) {
            return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
          }
          return element.tagName.toLowerCase();
        }

        function roleFor(element) {
          if (!element || !(element instanceof Element)) {
            return "";
          }
          const explicitRole = element.getAttribute("role");
          if (explicitRole) {
            return explicitRole.toLowerCase();
          }
          const tag = element.tagName.toLowerCase();
          if (tag === "a") {
            return "link";
          }
          if (tag === "button") {
            return "button";
          }
          if (tag === "input") {
            return (element.getAttribute("type") || "textbox").toLowerCase();
          }
          return tag;
        }

        function accessibleNameFor(element) {
          if (!element || !(element instanceof Element)) {
            return "";
          }
          const ariaLabel = element.getAttribute("aria-label");
          if (ariaLabel) {
            return normalize(ariaLabel);
          }
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            const labels = Array.from(element.labels ?? []);
            const labelText = labels
              .map((label) => normalize(label.textContent || ""))
              .filter(Boolean)
              .join(" ");
            if (labelText) {
              return labelText;
            }
          }
          return normalize(element.textContent || element.getAttribute("placeholder") || element.getAttribute("name") || "");
        }

        function isRiskyFormText(value) {
          return /\b(sign up|signup|register|create account|checkout|payment|billing|place order|buy now|contact us|send message|newsletter|subscribe)\b/i.test(
            value
          );
        }

        function findSearchCandidate() {
          const forms = Array.from(document.querySelectorAll("form"));
          for (const form of forms) {
            if (!isVisible(form)) {
              continue;
            }
            const formText = toLower(
              [
                form.getAttribute("id"),
                form.getAttribute("name"),
                form.getAttribute("aria-label"),
                form.textContent
              ]
                .filter(Boolean)
                .join(" ")
            );
            if (isRiskyFormText(formText)) {
              continue;
            }

            const inputs = Array.from(form.querySelectorAll("input:not([type='hidden']), textarea"))
              .filter((input) => isVisible(input));
            const searchInput = inputs.find((input) => {
              const type = toLower(input.getAttribute("type") || "");
              const hint = toLower(
                [
                  input.getAttribute("name"),
                  input.getAttribute("placeholder"),
                  input.getAttribute("aria-label"),
                  input.getAttribute("id"),
                  getLabel(input)
                ]
                  .filter(Boolean)
                  .join(" ")
              );
              return type === "search" || /\bsearch\b|\bquery\b|\bfind\b/.test(hint);
            });

            if (!searchInput) {
              continue;
            }

            const submitControl = Array.from(
              form.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")
            )
              .filter((control) => isVisible(control))
              .find((control) => {
                const hint = toLower(getLabel(control));
                const inputType = toLower(control.getAttribute("type") || "");
                return /\bsearch\b|\bgo\b|\bsubmit\b|\bapply\b/.test(hint) || inputType === "submit";
              }) ?? null;

            return {
              form,
              searchInput,
              submitControl
            };
          }
          return null;
        }

        const candidate = findSearchCandidate();
        if (!candidate) {
          return {
            attempted: false,
            skippedReason: "no-safe-search-form"
          };
        }

        const { form, searchInput, submitControl } = candidate;
        const originalValue = searchInput.value;
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.dispatchEvent(new Event("change", { bubbles: true }));

        let forcedCustomValidity = false;
        if (searchInput.checkValidity()) {
          searchInput.setCustomValidity("Please complete this field.");
          forcedCustomValidity = true;
        }

        const expectedInvalidElement =
          form.querySelector("input:invalid, textarea:invalid, select:invalid") ?? searchInput;
        const expectedInvalidSelector = selectorFor(expectedInvalidElement);

        let submitEventTriggered = false;
        const submitHandler = (event) => {
          submitEventTriggered = true;
          event.preventDefault();
          event.stopPropagation();
        };
        form.addEventListener("submit", submitHandler, { capture: true, once: true });

        try {
          if (typeof form.requestSubmit === "function") {
            if (submitControl && submitControl instanceof HTMLElement) {
              form.requestSubmit(submitControl);
            } else {
              form.requestSubmit();
            }
          } else if (submitControl && submitControl instanceof HTMLElement) {
            submitControl.click();
          } else {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          }
        } catch {
          // Keep the probe best-effort and deterministic.
        }

        if (forcedCustomValidity) {
          searchInput.setCustomValidity("");
        }
        searchInput.value = originalValue;
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.dispatchEvent(new Event("change", { bubbles: true }));

        const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
        const focusedSelector = selectorFor(activeElement);
        const firstInvalidFocusAfterSubmit = activeElement
          ? {
              selector: focusedSelector,
              role: roleFor(activeElement),
              name: accessibleNameFor(activeElement)
            }
          : null;

        const describedByToField = new Map();
        const fields = Array.from(form.querySelectorAll("input:not([type='hidden']), textarea, select"));
        for (const field of fields) {
          const selector = selectorFor(field);
          if (!selector) {
            continue;
          }
          const ids = (field.getAttribute("aria-describedby") || "")
            .split(/\s+/)
            .map((id) => id.trim())
            .filter(Boolean);
          for (const id of ids) {
            describedByToField.set(id, selector);
          }
        }

        const errorPattern = /error|invalid|required|must|please|missing|failed|incorrect|not allowed|cannot|unable|try again/i;
        const visibleErrorMessages = Array.from(
          form.querySelectorAll("[role='alert'], [aria-live], .error, .field-error, .invalid-feedback, [data-error]")
        )
          .filter((element) => isVisible(element))
          .map((element) => {
            const text = normalize(element.textContent || "").slice(0, 220);
            if (!text || !errorPattern.test(text)) {
              return null;
            }
            const selector = selectorFor(element);
            const id = element.getAttribute("id");
            const role = toLower(element.getAttribute("role") || "");
            const ariaLive = normalize(element.getAttribute("aria-live") || "");
            const associatedFieldSelector =
              (id && describedByToField.get(id)) ||
              selectorFor(element.closest("label")?.querySelector("input, textarea, select")) ||
              null;
            return {
              selector,
              text,
              associatedFieldSelector: associatedFieldSelector ?? null,
              roleAlert: role === "alert" || role === "alertdialog",
              ariaLive: ariaLive || null
            };
          })
          .filter(Boolean)
          .slice(0, 20);

        const associatedErrorCount = visibleErrorMessages.filter((entry) => Boolean(entry.associatedFieldSelector)).length;

        return {
          attempted: true,
          submitType: "search",
          targetSelector: selectorFor(searchInput),
          expectedInvalidSelector,
          firstInvalidFocusAfterSubmit,
          focusMovedToInvalid:
            Boolean(expectedInvalidSelector) &&
            Boolean(firstInvalidFocusAfterSubmit?.selector) &&
            firstInvalidFocusAfterSubmit.selector === expectedInvalidSelector,
          submitEventTriggered,
          visibleErrorCountAfterSubmit: visibleErrorMessages.length,
          associatedErrorCountAfterSubmit: associatedErrorCount,
          skippedReason: null
        };
      })
      .catch(() => null);

    if (!probeResult) {
      return {
        ...baseResult,
        skippedReason: "probe-failed"
      };
    }

    if (probeResult.attempted) {
      this.accessibilityValidationAttempts.set(pageKey, attempts + 1);
    }

    return {
      ...baseResult,
      ...probeResult
    };
  }

  async sampleUiuxStabilityAnchors() {
    if (!this.page) {
      return null;
    }

    return this.page
      .evaluate(() => {
        function isVisible(element) {
          if (!element) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 8 &&
            rect.height > 8
          );
        }

        function selectorFor(element) {
          if (!element) {
            return null;
          }
          const testId = element.getAttribute("data-testid");
          if (testId) {
            return `[data-testid="${CSS.escape(testId)}"]`;
          }
          const ariaLabel = element.getAttribute("aria-label");
          if (ariaLabel) {
            return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
          }
          if (element.id) {
            return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
          }
          return element.tagName.toLowerCase();
        }

        function asBounds(element) {
          const rect = element.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            inViewport:
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.top < window.innerHeight &&
              rect.left < window.innerWidth
          };
        }

        const primaryCandidate = Array.from(
          document.querySelectorAll("main button, main a, [role='main'] button, [role='main'] a, #primary button, #primary a")
        )
          .filter((element) => isVisible(element))
          .slice(0, 12)
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            if (leftRect.y !== rightRect.y) {
              return leftRect.y - rightRect.y;
            }
            return leftRect.x - rightRect.x;
          })[0] ?? null;

        const headerNavCandidate = Array.from(
          document.querySelectorAll(
            "header a, header button, nav a, nav button, [role='navigation'] a, [role='navigation'] button"
          )
        )
          .filter((element) => isVisible(element))
          .slice(0, 16)
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            if (leftRect.y !== rightRect.y) {
              return leftRect.y - rightRect.y;
            }
            return leftRect.x - rightRect.x;
          })[0] ?? null;

        return {
          sampledAt: Date.now(),
          primary: primaryCandidate
            ? {
                selector: selectorFor(primaryCandidate),
                bounds: asBounds(primaryCandidate)
              }
            : null,
          headerNav: headerNavCandidate
            ? {
                selector: selectorFor(headerNavCandidate),
                bounds: asBounds(headerNavCandidate)
              }
            : null
        };
      })
      .catch(() => null);
  }

  deriveLayoutStabilityProbe(beforeSample, afterSample) {
    if (!beforeSample || !afterSample) {
      return {
        sampleCount: 0,
        unstableAnchors: [],
        maxShiftPx: 0
      };
    }

    const unstableAnchors = [];
    const anchorKeys = ["primary", "headerNav"];
    let maxShiftPx = 0;

    for (const anchorKey of anchorKeys) {
      const before = beforeSample?.[anchorKey];
      const after = afterSample?.[anchorKey];
      if (!before?.bounds || !after?.bounds) {
        continue;
      }

      const deltaX = after.bounds.x - before.bounds.x;
      const deltaY = after.bounds.y - before.bounds.y;
      const shiftPx = Math.round(Math.hypot(deltaX, deltaY));
      if (shiftPx > maxShiftPx) {
        maxShiftPx = shiftPx;
      }

      if (shiftPx >= 20) {
        unstableAnchors.push({
          anchor: anchorKey,
          selector: before.selector ?? after.selector ?? null,
          shiftPx,
          deltaX,
          deltaY,
          before: before.bounds,
          after: after.bounds
        });
      }
    }

    return {
      sampleCount: 2,
      unstableAnchors,
      maxShiftPx
    };
  }

  async saveStructuredArtifacts(stepLabel, { html, accessibilitySnapshot, viewportLabel = null, networkSummary = null }) {
    const consolePath = path.join(this.consoleDir, `step-${stepLabel}.json`);
    const networkPath = path.join(this.networkDir, `step-${stepLabel}.json`);

    await fs.writeFile(
      consolePath,
      JSON.stringify(
        {
          step: stepLabel,
          viewportLabel,
          entries: this.consoleEntries
        },
        null,
        2
      )
    );
    await fs.writeFile(
      networkPath,
      JSON.stringify(
        {
          step: stepLabel,
          viewportLabel,
          summary: networkSummary ?? this.networkSummary
        },
        null,
        2
      )
    );

    this.appendArtifact(
      "console",
      this.buildArtifactRef(consolePath, { step: stepLabel, viewportLabel })
    );
    this.appendArtifact(
      "network",
      this.buildArtifactRef(networkPath, { step: stepLabel, viewportLabel })
    );

    if (this.runConfig?.artifacts?.captureHtml) {
      const domPath = path.join(this.domDir, `step-${stepLabel}.html`);
      await fs.writeFile(domPath, html, "utf8");
      this.appendArtifact(
        "dom",
        this.buildArtifactRef(domPath, { step: stepLabel, viewportLabel })
      );
    }

    if (this.runConfig?.artifacts?.captureA11ySnapshot && accessibilitySnapshot) {
      const a11yPath = path.join(this.a11yDir, `step-${stepLabel}.json`);
      await fs.writeFile(a11yPath, JSON.stringify(accessibilitySnapshot, null, 2));
      this.appendArtifact(
        "a11y",
        this.buildArtifactRef(a11yPath, { step: stepLabel, viewportLabel })
      );
    }
  }

  async capture(step, options = {}) {
    await this.applySiteGuards();

    const stepLabel = sanitizeStepId(options.artifactLabel ?? step);
    const viewportLabel = options.viewportLabel ?? null;
    const deviceLabel = options.deviceLabel ?? this.currentUiuxDeviceProfile?.label ?? viewportLabel ?? null;
    const deviceId = options.deviceId ?? this.currentUiuxDeviceProfile?.id ?? null;
    const includeUiuxSignals = Boolean(options.includeUiuxSignals ?? options.includeFocusProbe);
    const includeA11ySignals = Boolean(options.includeA11ySignals);
    const includeFocusA11yProbe = Boolean(options.includeFocusA11yProbe);
    const formsConfig = includeA11ySignals ? this.accessibilityFormsConfig() : null;
    const formValidationProbe = includeA11ySignals
      ? await this.collectAccessibilityFormValidationProbe().catch(() => null)
      : null;
    const screenshotFileName =
      options.artifactLabel || typeof step !== "number"
        ? `step-${stepLabel}.png`
        : `step-${String(step).padStart(3, "0")}.png`;
    const screenshotPath = path.join(this.framesDir, screenshotFileName);
    const screenshotCapture = this.resolveScreenshotCaptureOptions();
    await this.page.screenshot({
      path: screenshotPath,
      fullPage: screenshotCapture.fullPage
    });
    const screenshotArtifact = this.buildArtifactRef(screenshotPath, {
      step: stepLabel,
      viewportLabel,
      captureMode: screenshotCapture.captureMode
    });
    this.appendArtifact("frames", screenshotArtifact);

    const base64 = await fs.readFile(screenshotPath, "base64");
    const html = this.runConfig?.artifacts?.captureHtml ? await this.page.content().catch(() => "") : "";
    const accessibilitySnapshot =
      this.runConfig?.artifacts?.captureA11ySnapshot && typeof this.page.accessibility?.snapshot === "function"
        ? await this.page.accessibility.snapshot({ interestingOnly: true }).catch(() => null)
        : null;
    const layoutSample = await this.sampleLayoutState().catch(() => null);
    const layoutStabilityBefore = includeUiuxSignals
      ? await this.sampleUiuxStabilityAnchors().catch(() => null)
      : null;
    if (includeUiuxSignals) {
      await this.page.waitForTimeout(120);
    }
    const layoutStabilityAfter = includeUiuxSignals
      ? await this.sampleUiuxStabilityAnchors().catch(() => null)
      : null;
    const layoutStabilityProbe = this.deriveLayoutStabilityProbe(
      layoutStabilityBefore,
      layoutStabilityAfter
    );
    const viewportSize = this.page.viewportSize?.() ?? null;
    const pageState = await this.page.evaluate((signals) => {
      const uiuxSignalsEnabled = Boolean(signals?.uiuxSignalsEnabled);
      const a11ySignalsEnabled = Boolean(signals?.a11ySignalsEnabled);
      const genericIds = new Set(["button", "content", "text", "icon", "img", "endpoint", "title"]);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const viewportArea = Math.max(viewportWidth * viewportHeight, 1);

      function isElementVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number.parseFloat(style.opacity || "1") > 0 &&
          rect.width > 8 &&
          rect.height > 8
        );
      }

      function getBounds(element) {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          viewportX: rect.x,
          viewportY: rect.y,
          width: rect.width,
          height: rect.height,
          centerX: rect.x + window.scrollX + rect.width / 2,
          centerY: rect.y + window.scrollY + rect.height / 2
        };
      }

      function isInViewport(bounds) {
        const localLeft = bounds.x - window.scrollX;
        const localTop = bounds.y - window.scrollY;
        const localRight = localLeft + bounds.width;
        const localBottom = localTop + bounds.height;
        return localRight > 0 && localBottom > 0 && localLeft < viewportWidth && localTop < viewportHeight;
      }

      function makeSelector(element) {
        const testId = element.getAttribute("data-testid");
        if (testId) {
          return `[data-testid="${CSS.escape(testId)}"]`;
        }

        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) {
          return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
        }

        const name = element.getAttribute("name");
        if (name) {
          return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        }

        if (element.id && !genericIds.has(element.id.toLowerCase())) {
          return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
        }

        return null;
      }

      function getElementLabel(element) {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel?.trim()) {
          return ariaLabel.trim();
        }

        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const labelText = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (labelText) {
            return labelText;
          }
        }

        const title = element.getAttribute("title");
        if (title?.trim()) {
          return title.trim();
        }

        const placeholder = element.getAttribute("placeholder");
        if (placeholder?.trim()) {
          return placeholder.trim();
        }

        const labels = element instanceof HTMLElement && "labels" in element ? Array.from(element.labels ?? []) : [];
        const labelText = labels
          .map((label) => label.textContent?.trim() ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (labelText) {
          return labelText;
        }

        return element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ?? "";
      }

      function describeLandmark(element) {
        const landmark = element.closest(
          "header, nav, main, aside, form, [role='banner'], [role='navigation'], [role='main'], [role='search'], [role='dialog']"
        );
        if (!landmark) {
          return "";
        }

        const role = landmark.getAttribute("role");
        const label =
          landmark.getAttribute("aria-label") ||
          landmark.getAttribute("aria-labelledby") ||
          landmark.tagName.toLowerCase();

        return role ? `${role}:${label}` : label;
      }

      function describeZone(element) {
        if (
          element.closest(
            "#masthead, #masthead-container, ytd-masthead, header, [role='banner'], [role='search']"
          )
        ) {
          return "Header";
        }

        if (element.closest("#guide, ytd-guide-renderer, aside, [role='navigation']")) {
          return "Sidebar";
        }

        if (
          element.closest(
            "#contents, #primary, ytd-item-section-renderer, ytd-two-column-search-results-renderer, main, [role='main']"
          )
        ) {
          return "Primary Content";
        }

        return "Unknown";
      }

      function getTopElementText(element) {
        return (
          element?.getAttribute?.("aria-label") ||
          element?.getAttribute?.("alt") ||
          element?.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);
      }

      function buildCenterProbe(element) {
        const rect = element.getBoundingClientRect();
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const targetInViewport =
          centerX >= 0 &&
          centerY >= 0 &&
          centerX <= viewportWidth &&
          centerY <= viewportHeight;

        if (!targetInViewport) {
          return {
            targetInViewport: false,
            sameTarget: false,
            covered: false,
            topTag: "",
            topText: "",
            topSelector: null
          };
        }

        const hit = document.elementFromPoint(centerX, centerY);
        const sameTarget = Boolean(hit) && (hit === element || element.contains(hit));
        const topElement = hit?.closest(
          "button, a, input, textarea, select, img, [role='button'], [role='link'], [role='alert'], [role='dialog']"
        ) ?? hit;

        return {
          targetInViewport: true,
          sameTarget,
          covered: Boolean(hit) && !sameTarget,
          topTag: topElement?.tagName?.toLowerCase?.() ?? "",
          topText: getTopElementText(topElement),
          topSelector: topElement ? makeSelector(topElement) : null
        };
      }

      function controlKind(element) {
        if (element.tagName.toLowerCase() === "a") {
          return "link";
        }
        if (element.tagName.toLowerCase() === "button" || element.getAttribute("role") === "button") {
          return "button";
        }
        return "control";
      }

      function contextTextFor(element) {
        const container = element.closest("p, li, article, section, main, [role='main'], div");
        if (!container) {
          return "";
        }
        return (container.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220);
      }

      const interactive = Array.from(
        document.querySelectorAll("button, a, input, textarea, select, [role='button']")
      )
        .filter((element) => isElementVisible(element))
        .slice(0, 60)
        .map((element, index) => {
          const label = getElementLabel(element);
          const bounds = getBounds(element);
          const inViewport = isInViewport(bounds);
          return {
            elementId: `el-${index + 1}`,
            tag: element.tagName.toLowerCase(),
            text: label.slice(0, 120),
            selector: makeSelector(element),
            id: element.id ?? "",
            ariaLabel: element.getAttribute("aria-label") ?? "",
            landmark: describeLandmark(element),
            zone: describeZone(element),
            type: element.getAttribute("type") ?? "",
            placeholder: element.getAttribute("placeholder") ?? "",
            name: element.getAttribute("name") ?? "",
            href: element instanceof HTMLAnchorElement ? element.href : "",
            disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
            pressed: element.getAttribute("aria-pressed") === "true",
            checked: element instanceof HTMLInputElement ? element.checked : false,
            value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "",
            contextText: element.tagName.toLowerCase() === "a" ? contextTextFor(element) : "",
            inViewport,
            bounds,
            centerProbe: inViewport ? buildCenterProbe(element) : null
          };
        });

      const primaryCtaCandidate = interactive
        .filter((element) => !element.disabled)
        .filter((element) => ["button", "a", "input"].includes(element.tag))
        .filter((element) => element.zone === "Primary Content" || element.zone === "Header")
        .filter((element) => element.inViewport)
        .sort((left, right) => {
          const zoneWeight = (value) => (value.zone === "Primary Content" ? 0 : value.zone === "Header" ? 1 : 2);
          if (zoneWeight(left) !== zoneWeight(right)) {
            return zoneWeight(left) - zoneWeight(right);
          }
          if (left.bounds.y !== right.bounds.y) {
            return left.bounds.y - right.bounds.y;
          }
          return left.bounds.x - right.bounds.x;
        })[0] ?? null;

      const semanticMap = interactive
        .filter((element) => element.text && !element.disabled)
        .map((element) => ({
          elementId: element.elementId,
          text: element.text,
          role: element.tag.toUpperCase(),
          landmark: element.landmark,
          zone: element.zone,
          disabled: element.disabled,
          bounds: [
            Math.round(element.bounds.x),
            Math.round(element.bounds.y),
            Math.round(element.bounds.width),
            Math.round(element.bounds.height)
          ],
          center: [Math.round(element.bounds.centerX), Math.round(element.bounds.centerY)],
          href: element.href || ""
        }));

      const accessibilityTree = semanticMap.map((element) => ({
        name: element.text,
        role: element.role,
        landmark: element.landmark,
        zone: element.zone,
        center: element.center
      }));

      const overlays = Array.from(
        document.querySelectorAll("dialog, [role='dialog'], .modal, [data-modal], [aria-modal='true']")
      )
        .filter((element) => isElementVisible(element))
        .map((element, index) => {
          const bounds = getBounds(element);
          const ariaLabel = (element.getAttribute("aria-label") || "").trim();
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledByText = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim()
            : "";
          const title = (element.getAttribute("title") || "").trim();
          const headingText = (
            element.querySelector("h1, h2, h3, h4, [role='heading']")?.textContent || ""
          )
            .replace(/\s+/g, " ")
            .trim();
          const accessibleName = [ariaLabel, labelledByText, title, headingText].find((value) => value.length > 0) ?? "";
          const role = (element.getAttribute("role") || (element.tagName.toLowerCase() === "dialog" ? "dialog" : ""))
            .toLowerCase();
          const areaRatio = (bounds.width * bounds.height) / viewportArea;
          const actions = Array.from(element.querySelectorAll("button, a, [role='button']"))
            .filter((action) => isElementVisible(action))
            .map((action) => ({
              text: getElementLabel(action).slice(0, 80),
              selector: makeSelector(action),
              kind: controlKind(action)
            }));
          return {
            overlayId: `overlay-${index + 1}`,
            text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160) ?? "",
            selector: makeSelector(element),
            bounds,
            role,
            ariaModal: element.getAttribute("aria-modal") === "true",
            isModalDialog:
              role === "dialog" ||
              role === "alertdialog" ||
              element.tagName.toLowerCase() === "dialog" ||
              element.getAttribute("aria-modal") === "true",
            accessibleName,
            hasAccessibleName: accessibleName.length > 0,
            areaRatio,
            isBlocking: areaRatio >= 0.35,
            actions,
            hasDismissAction: actions.some((action) => /close|dismiss|cancel|not now|skip|x/i.test(action.text))
          };
        });

      const spinnerSelectors = [
        "[aria-busy='true']",
        "[role='progressbar']",
        ".spinner",
        ".loader",
        "[data-loader='true']"
      ];

      let spinnerBounds = null;
      const spinnerVisible = spinnerSelectors.some((selector) => {
        const element = document.querySelector(selector);
        if (!element || !isElementVisible(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        spinnerBounds = {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height
        };
        return true;
      });

      const pageLinks = Array.from(document.querySelectorAll("a[href]"))
        .map((element) => ({
          href: element.href,
          text: (element.textContent || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 140)
        }))
        .filter((item) => item.href);

      const images = Array.from(document.querySelectorAll("img"))
        .filter((element) => isElementVisible(element))
        .map((element, index) => {
          const bounds = getBounds(element);
          return {
            imageId: `img-${index + 1}`,
            selector: makeSelector(element),
            src: element.currentSrc || element.getAttribute("src") || "",
            alt: (element.getAttribute("alt") || "").slice(0, 160),
            role: element.getAttribute("role") || "",
            ariaHidden: element.getAttribute("aria-hidden") === "true",
            inViewport: isInViewport(bounds),
            naturalWidth: element.naturalWidth,
            naturalHeight: element.naturalHeight,
            complete: element.complete,
            hadError: element.dataset.qaImageError === "1",
            broken: (element.complete && element.naturalWidth === 0) || element.dataset.qaImageError === "1",
            areaRatio: (bounds.width * bounds.height) / viewportArea,
            bounds
          };
        });

      const headings = a11ySignalsEnabled || uiuxSignalsEnabled ? Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, h6")
      )
        .map((element, index) => {
          if (!isElementVisible(element)) {
            return null;
          }
          const level = Number.parseInt(element.tagName.slice(1), 10);
          const bounds = getBounds(element);
          return {
            headingId: `heading-${index + 1}`,
            level: Number.isInteger(level) ? level : null,
            selector: makeSelector(element),
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180),
            inViewport: isInViewport(bounds)
          };
        })
        .filter(Boolean)
        .slice(0, 40) : [];

      const focusableSelector = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "[tabindex]:not([tabindex='-1'])",
        "[role='button']",
        "[role='link']"
      ].join(",");

      const focusableHiddenElements = a11ySignalsEnabled || uiuxSignalsEnabled ? Array.from(
        document.querySelectorAll(focusableSelector)
      )
        .filter((element) => {
          if (element.matches(":disabled")) {
            return false;
          }
          return !isElementVisible(element);
        })
        .map((element, index) => ({
          hiddenId: `focus-hidden-${index + 1}`,
          selector: makeSelector(element),
          tag: element.tagName.toLowerCase(),
          text: getElementLabel(element).slice(0, 120)
        }))
        .filter((entry) => Boolean(entry.selector))
        .slice(0, 30) : [];

      const hasMainLandmark = Boolean(
        document.querySelector("main, [role='main']")
      );

      const formControlElements = Array.from(
        document.querySelectorAll("input:not([type='hidden']), textarea, select")
      ).filter((element) => isElementVisible(element));

      const formControlDescriptors = formControlElements.map((element) => {
        const labels = element instanceof HTMLElement && "labels" in element ? Array.from(element.labels ?? []) : [];
        const labelText = labels
          .map((label) => (label.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" ")
          .trim();
        const ariaDescribedByIds = (element.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .map((id) => id.trim())
          .filter(Boolean)
          .slice(0, 10);
        const describedByTexts = ariaDescribedByIds
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((target) => (target.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const describedByTextSnippet = describedByTexts.join(" ").slice(0, 80);
        const missingIds = ariaDescribedByIds.filter((id) => !document.getElementById(id));
        const requiredAttr = element.hasAttribute("required");
        const ariaRequired = element.getAttribute("aria-required") === "true";
        const requiredIndicatorNearLabel = /\brequired\b|\*/i.test(
          [labelText, element.getAttribute("aria-label"), element.getAttribute("placeholder")]
            .filter(Boolean)
            .join(" ")
        );

        return {
          selector: makeSelector(element),
          type: element.getAttribute("type") ?? element.tagName.toLowerCase(),
          name: element.getAttribute("name") ?? "",
          ariaLabel: element.getAttribute("aria-label") ?? "",
          hasAssociatedLabel: Boolean(labelText),
          requiredAttr,
          ariaRequired,
          requiredIndicatorNearLabel,
          ariaDescribedByIds,
          ariaDescribedByMissingIds: missingIds,
          describedByTextSnippet
        };
      });

      function resolveFormName(element) {
        const form = element.closest("form");
        if (!form) {
          return "";
        }
        const headingText = (
          form.querySelector("h1, h2, h3, h4, legend, [role='heading']")?.textContent || ""
        )
          .replace(/\s+/g, " ")
          .trim();
        return (
          form.getAttribute("aria-label") ||
          form.getAttribute("name") ||
          headingText ||
          form.getAttribute("id") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
      }

      function resolveNearestHeading(element) {
        const heading = element
          .closest("form, section, article, main, [role='main'], div")
          ?.querySelector("h1, h2, h3, h4, legend, [role='heading']");
        return (heading?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
      }

      const formControls = formControlElements
        .map((element, index) => {
          const bounds = getBounds(element);
          const descriptor = formControlDescriptors[index] ?? null;
          const closestForm = element.closest("form");
          const labels = element instanceof HTMLElement && "labels" in element ? Array.from(element.labels ?? []) : [];
          const labelText = labels
            .map((label) => label.textContent?.trim() ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          const options = element.tagName.toLowerCase() === "select"
            ? Array.from(element.querySelectorAll("option"))
                .slice(0, 15)
                .map((option) => ({
                  value: option.value ?? "",
                  text: (option.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120)
                }))
            : [];
          return {
            controlId: `fc-${index + 1}`,
            selector: makeSelector(element),
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute("type") ?? "",
            name: element.getAttribute("name") ?? "",
            placeholder: element.getAttribute("placeholder") ?? "",
            ariaLabel: element.getAttribute("aria-label") ?? "",
            labelText,
            labelOrPlaceholder:
              labelText ||
              element.getAttribute("placeholder") ||
              element.getAttribute("aria-label") ||
              element.getAttribute("name") ||
              "",
            hasAssociatedLabel: Boolean(labelText),
            requiredAttr: descriptor?.requiredAttr ?? false,
            ariaRequired: descriptor?.ariaRequired ?? false,
            formSelector: closestForm ? makeSelector(closestForm) : "",
            formName: resolveFormName(element),
            nearestHeading: resolveNearestHeading(element),
            options,
            inViewport: isInViewport(bounds),
            bounds
          };
        });

      const controlByDescribedById = new Map();
      for (const descriptor of formControlDescriptors) {
        for (const describedById of descriptor.ariaDescribedByIds ?? []) {
          if (!controlByDescribedById.has(describedById)) {
            controlByDescribedById.set(describedById, descriptor.selector ?? null);
          }
        }
      }

      const recoveryPattern = /retry|try again|refresh|reload|close|dismiss|back|return|cancel/i;
      const errorPattern = /error|failed|failure|unable|cannot|could not|went wrong|unavailable|problem/i;
      const errorBanners = Array.from(
        document.querySelectorAll("[role='alert'], [aria-live='assertive'], .toast, .alert, .error, [data-toast], [data-error]")
      )
        .filter((element) => isElementVisible(element))
        .map((element, index) => {
          const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
          if (!errorPattern.test(text)) {
            return null;
          }
          const bounds = getBounds(element);
          const actions = Array.from(element.querySelectorAll("button, a, [role='button']"))
            .filter((action) => isElementVisible(action))
            .map((action) => ({
              text: getElementLabel(action).slice(0, 80),
              selector: makeSelector(action),
              kind: controlKind(action)
            }));
          return {
            bannerId: `err-${index + 1}`,
            selector: makeSelector(element),
            text,
            bounds,
            inViewport: isInViewport(bounds),
            actions,
            hasRecoveryAction: actions.some((action) => recoveryPattern.test(action.text))
          };
        })
        .filter(Boolean);

      const visibleErrorMessages = a11ySignalsEnabled ? Array.from(
        document.querySelectorAll(
          "[role='alert'], [aria-live], .error, .field-error, .invalid-feedback, .form-error, [data-error], [aria-invalid='true']"
        )
      )
        .filter((element) => isElementVisible(element))
        .map((element) => {
          const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220);
          const hasErrorSignal = errorPattern.test(text) || /invalid|required|must|please/i.test(text);
          if (!hasErrorSignal || !text) {
            return null;
          }
          const id = element.getAttribute("id");
          const role = (element.getAttribute("role") || "").toLowerCase();
          const ariaLive = (element.getAttribute("aria-live") || "").trim();
          let associatedFieldSelector = null;

          if (id && controlByDescribedById.has(id)) {
            associatedFieldSelector = controlByDescribedById.get(id);
          }

          if (!associatedFieldSelector) {
            const enclosingLabelField = element.closest("label")?.querySelector("input, textarea, select") ?? null;
            if (enclosingLabelField) {
              associatedFieldSelector = makeSelector(enclosingLabelField);
            }
          }

          if (!associatedFieldSelector) {
            const nearest = formControls
              .filter((control) => control.selector)
              .map((control) => {
                const field = document.querySelector(control.selector);
                if (!field || !(field instanceof HTMLElement)) {
                  return null;
                }
                const fieldRect = field.getBoundingClientRect();
                const errorRect = element.getBoundingClientRect();
                const sameForm =
                  (field.closest("form") && element.closest("form") && field.closest("form") === element.closest("form")) ||
                  !field.closest("form") ||
                  !element.closest("form");
                if (!sameForm) {
                  return null;
                }
                const dy = Math.abs((fieldRect.top + fieldRect.height / 2) - (errorRect.top + errorRect.height / 2));
                const dx = Math.abs((fieldRect.left + fieldRect.width / 2) - (errorRect.left + errorRect.width / 2));
                if (dy > 140 || dx > Math.max(220, viewportWidth * 0.35)) {
                  return null;
                }
                return {
                  selector: control.selector,
                  score: dy * 2 + dx
                };
              })
              .filter(Boolean)
              .sort((left, right) => left.score - right.score)[0];
            associatedFieldSelector = nearest?.selector ?? null;
          }

          return {
            selector: makeSelector(element),
            text,
            associatedFieldSelector,
            roleAlert: role === "alert" || role === "alertdialog",
            ariaLive: ariaLive || null
          };
        })
        .filter(Boolean)
        .slice(0, 30) : [];

      const textOverflowItems = Array.from(
        document.querySelectorAll("a, button, label, h1, h2, h3, h4, p, span, div")
      )
        .filter((element) => isElementVisible(element))
        .map((element, index) => {
          const style = window.getComputedStyle(element);
          const overflowX = style.overflowX || style.overflow;
          const textOverflow = style.textOverflow || "";
          const overflowPx = element.scrollWidth - element.clientWidth;
          if (element.clientWidth <= 0 || overflowPx < 12) {
            return null;
          }
          if (!["hidden", "clip"].includes(overflowX) && textOverflow === "clip") {
            return null;
          }
          const bounds = getBounds(element);
          return {
            overflowId: `overflow-${index + 1}`,
            selector: makeSelector(element),
            text: getElementLabel(element).slice(0, 160),
            zone: describeZone(element),
            landmark: describeLandmark(element),
            inViewport: isInViewport(bounds),
            overflowPx,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            textOverflow,
            overflowX,
            bounds
          };
        })
        .filter(Boolean)
        .slice(0, 40);

      const interactiveWithPrimary = interactive.map((element) => ({
        ...element,
        isPrimaryCta: element.elementId === primaryCtaCandidate?.elementId
      }));

      const bodyText = document.body.innerText.replace(/\s+/g, " ").trim();

      const contentHints = (() => {
        const articleLike = Boolean(
          document.querySelector("article, [role='article'], .docs, .documentation, .markdown-body")
        );
        const documentationLike = Boolean(
          document.querySelector("nav[aria-label*='table of contents'], .table-of-contents, [data-docs-nav]")
        );
        const wordCount = document.body.innerText.trim().split(/\s+/).filter(Boolean).length;
        const visibleInteractiveCount = interactiveWithPrimary.filter((item) => item.inViewport && !item.disabled).length;
        return {
          articleLike,
          documentationLike,
          wordCount,
          isStaticContentPage: (articleLike || documentationLike) && wordCount >= 300 && visibleInteractiveCount <= 3
        };
      })();

      const responsiveSignals = uiuxSignalsEnabled ? (() => {
        const computedPageWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
          viewportWidth
        );
        const horizontalOverflowPx = Math.max(0, computedPageWidth - viewportWidth);
        const meaningfulOverflowThresholdPx = Math.max(4, Math.round(viewportWidth * 0.01));
        const majorOverflowThresholdPx = Math.max(18, Math.round(viewportWidth * 0.05));

        function median(values = []) {
          const sorted = [...values].sort((left, right) => left - right);
          if (!sorted.length) {
            return 0;
          }
          const center = Math.floor(sorted.length / 2);
          return sorted.length % 2 === 0
            ? (sorted[center - 1] + sorted[center]) / 2
            : sorted[center];
        }

        const overflowCandidates = Array.from(
          document.querySelectorAll(
            "main, [role='main'], section, article, form, nav, header, footer, .container, .content, .layout, .card, [data-testid], [data-qa], [data-component]"
          )
        )
          .filter((element) => isElementVisible(element))
          .slice(0, 220)
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const bounds = getBounds(element);
            const leftOverflowPx = Math.max(0, 0 - rect.left);
            const rightOverflowPx = Math.max(0, rect.right - viewportWidth);
            const rectOverflowPx = Math.max(leftOverflowPx, rightOverflowPx);
            const scrollOverflowPx = Math.max(0, element.scrollWidth - Math.max(Math.min(element.clientWidth, viewportWidth), 1));
            const parent = element.parentElement;
            const parentOverflowPx = parent
              ? Math.max(0, parent.scrollWidth - Math.max(Math.min(parent.clientWidth, viewportWidth), 1))
              : 0;
            const overflowPx = Math.max(rectOverflowPx, scrollOverflowPx, parentOverflowPx);
            const widthPressureRatio = viewportWidth > 0 ? rect.width / viewportWidth : 0;
            return {
              id: `overflow-container-${index + 1}`,
              selector: makeSelector(element),
              bounds,
              overflowPx,
              rectOverflowPx,
              scrollOverflowPx,
              parentOverflowPx,
              widthPressureRatio,
              clientWidth: Math.round(element.clientWidth),
              scrollWidth: Math.round(element.scrollWidth)
            };
          })
          .filter((entry) => entry.overflowPx >= meaningfulOverflowThresholdPx)
          .sort((left, right) => right.overflowPx - left.overflowPx);

        const majorOverflowContainers = overflowCandidates
          .filter((entry) => entry.overflowPx >= majorOverflowThresholdPx && entry.widthPressureRatio >= 0.32)
          .slice(0, 8);

        const stackedLayoutCandidates = Array.from(
          document.querySelectorAll(
            "main > *, [role='main'] > *, section, article, form, .card, [data-card], .list-item, [data-list-item], [data-row], [class*='grid'] > *, [class*='row'] > *, [data-component], [data-testid]"
          )
        )
          .filter((element) => isElementVisible(element))
          .slice(0, 220)
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const widthRatio = viewportWidth > 0 ? rect.width / viewportWidth : 0;
            if (rect.height < 20) {
              return null;
            }
            if (widthRatio < 0.28 && rect.width < 140) {
              return null;
            }
            if (rect.bottom < -48 || rect.top > viewportHeight + 48) {
              return null;
            }
            return {
              id: `layout-${index + 1}`,
              selector: makeSelector(element),
              bounds: getBounds(element),
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
              widthRatio
            };
          })
          .filter(Boolean)
          .sort((left, right) => left.y - right.y)
          .slice(0, 120);

        const alignmentBaselineCandidates = stackedLayoutCandidates
          .slice(0, Math.min(8, stackedLayoutCandidates.length))
          .map((entry) => entry.x);
        const laneBucketPx = Math.max(12, Math.round(viewportWidth * 0.03));
        const laneBuckets = new Map();
        for (const entry of stackedLayoutCandidates) {
          const lane = Math.round(entry.x / laneBucketPx) * laneBucketPx;
          laneBuckets.set(lane, (laneBuckets.get(lane) ?? 0) + 1);
        }
        const dominantLane = [...laneBuckets.entries()].sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1];
          }
          return left[0] - right[0];
        })[0] ?? null;
        const dominantLaneLeftPx = Number(dominantLane?.[0] ?? median(alignmentBaselineCandidates));
        const dominantLaneShare = stackedLayoutCandidates.length
          ? Number(((dominantLane?.[1] ?? 0) / stackedLayoutCandidates.length).toFixed(3))
          : 0;
        const baselineLeftPx = dominantLaneShare >= 0.34
          ? dominantLaneLeftPx
          : median(alignmentBaselineCandidates);
        const alignmentDeltaThresholdPx = Math.max(16, Math.round(viewportWidth * 0.055));
        const severeAlignmentCandidates = stackedLayoutCandidates
          .map((entry) => ({
            ...entry,
            leftDeltaPx: Math.abs(entry.x - baselineLeftPx)
          }))
          .filter((entry) =>
            entry.leftDeltaPx >= alignmentDeltaThresholdPx &&
            (entry.widthRatio >= 0.3 || entry.height >= 44)
          )
          .sort((left, right) => right.leftDeltaPx - left.leftDeltaPx)
          .slice(0, 8);

        let overlappingBlockPairCount = 0;
        for (let leftIndex = 0; leftIndex < stackedLayoutCandidates.length; leftIndex += 1) {
          const left = stackedLayoutCandidates[leftIndex];
          for (let rightIndex = leftIndex + 1; rightIndex < stackedLayoutCandidates.length; rightIndex += 1) {
            const right = stackedLayoutCandidates[rightIndex];
            const overlapX = Math.max(
              0,
              Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
            );
            const overlapY = Math.max(
              0,
              Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
            );
            if (!overlapX || !overlapY) {
              continue;
            }
            const overlapArea = overlapX * overlapY;
            const smallerArea = Math.max(Math.min(left.width * left.height, right.width * right.height), 1);
            if (overlapArea / smallerArea >= 0.14) {
              overlappingBlockPairCount += 1;
            }
          }
        }

        const mediaOverflowItems = Array.from(
          document.querySelectorAll("img, video, canvas, svg, iframe, [role='img'], .hero, [data-media]")
        )
          .filter((element) => isElementVisible(element))
          .slice(0, 80)
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const overflowLeftPx = Math.max(0, 0 - rect.left);
            const overflowRightPx = Math.max(0, rect.right - viewportWidth);
            const overflowTopPx = Math.max(0, 0 - rect.top);
            const overflowBottomPx = Math.max(0, rect.bottom - viewportHeight);
            const maxOverflowPx = Math.max(overflowLeftPx, overflowRightPx, overflowTopPx, overflowBottomPx);
            return {
              mediaId: `media-overflow-${index + 1}`,
              selector: makeSelector(element),
              tag: element.tagName.toLowerCase(),
              bounds: getBounds(element),
              maxOverflowPx,
              overflowLeftPx,
              overflowRightPx,
              overflowTopPx,
              overflowBottomPx,
              widthRatio: viewportWidth > 0 ? Number((rect.width / viewportWidth).toFixed(3)) : 0
            };
          })
          .filter((entry) => entry.maxOverflowPx >= 8 || entry.widthRatio >= 1.05)
          .sort((left, right) => right.maxOverflowPx - left.maxOverflowPx)
          .slice(0, 12);

        return {
          viewportWidth,
          viewportHeight,
          pageWidth: computedPageWidth,
          horizontalOverflowPx,
          meaningfulOverflowThresholdPx,
          majorOverflowContainers,
          overflowingContainerCount: overflowCandidates.length,
          severeAlignment: {
            stackedCandidateCount: stackedLayoutCandidates.length,
            candidateCount: severeAlignmentCandidates.length,
            baselineLeftPx: Number(baselineLeftPx.toFixed(1)),
            dominantLaneLeftPx: Number(dominantLaneLeftPx.toFixed(1)),
            dominantLaneShare,
            thresholdPx: alignmentDeltaThresholdPx,
            maxLeftDeltaPx: Number((severeAlignmentCandidates[0]?.leftDeltaPx ?? 0).toFixed(1)),
            candidates: severeAlignmentCandidates.map((entry) => ({
              selector: entry.selector,
              leftDeltaPx: Number(entry.leftDeltaPx.toFixed(1)),
              bounds: entry.bounds
            })),
            overlappingBlockPairCount
          },
          mediaOverflowItems
        };
      })() : {
        viewportWidth: viewportWidth ?? 0,
        viewportHeight: viewportHeight ?? 0,
        pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, viewportWidth),
        horizontalOverflowPx: 0,
        meaningfulOverflowThresholdPx: 4,
        majorOverflowContainers: [],
        overflowingContainerCount: 0,
        severeAlignment: {
          stackedCandidateCount: 0,
          candidateCount: 0,
          baselineLeftPx: 0,
          dominantLaneLeftPx: 0,
          dominantLaneShare: 0,
          thresholdPx: 0,
          maxLeftDeltaPx: 0,
          candidates: [],
          overlappingBlockPairCount: 0
        },
        mediaOverflowItems: []
      };

      const dataDisplaySignals = uiuxSignalsEnabled ? (() => {
        const mobileViewport = viewportWidth <= 900;
        const tableElements = Array.from(
          document.querySelectorAll(
            "table, [role='table'], .table, [data-table], .data-table"
          )
        ).filter((element) => isElementVisible(element));
        const chartElements = Array.from(
          document.querySelectorAll(
            "canvas, svg, [role='img'], .chart, [data-chart]"
          )
        ).filter((element) => isElementVisible(element));
        const overflowingTables = tableElements.filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            element.scrollWidth > element.clientWidth + 24 ||
            rect.width > viewportWidth + 24
          );
        });

        const tableRegions = tableElements
          .slice(0, 20)
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const bounds = getBounds(element);
            const container = element.closest(".table-responsive, .overflow-x-auto, .overflow-auto, [data-scroll-container]");
            const containerOverflowPx = container
              ? Math.max(0, container.scrollWidth - Math.max(Math.min(container.clientWidth, viewportWidth), 1))
              : 0;
            const elementScrollOverflowPx = Math.max(0, element.scrollWidth - Math.max(Math.min(element.clientWidth, viewportWidth), 1));
            const rectOverflowPx = Math.max(
              0,
              Math.max(rect.right - viewportWidth, 0, 0 - rect.left)
            );
            const hiddenWidthPx = Math.max(containerOverflowPx, elementScrollOverflowPx, rectOverflowPx);
            const headerCells = Array.from(element.querySelectorAll("thead th, [role='columnheader']"));
            const visibleHeaderCount = headerCells.filter((header) => isElementVisible(header)).length;
            const rowCount = element.querySelectorAll("tbody tr, [role='row']").length;
            const columnCount = Math.max(
              Array.from(element.querySelectorAll("tr"))
                .slice(0, 4)
                .reduce((max, row) => Math.max(max, row.querySelectorAll("th, td").length), 0),
              headerCells.length
            );
            const bodyCells = Array.from(element.querySelectorAll("tbody td, [role='cell']")).slice(0, 40);
            const labeledBodyCellCount = bodyCells.filter((cell) => {
              const dataLabel = cell.getAttribute("data-label") || cell.getAttribute("aria-label");
              return String(dataLabel || "").trim().length > 0;
            }).length;
            const rowDisplayBlock = Array.from(element.querySelectorAll("tbody tr")).some((row) => {
              const style = window.getComputedStyle(row);
              return style.display === "block" || style.display === "grid" || style.display === "flex";
            });
            const stackedFallback =
              element.matches(".table-stacked, .table-cards, [data-mobile-table='stacked'], [data-mobile-table='cards']") ||
              (labeledBodyCellCount >= Math.max(2, Math.floor(bodyCells.length * 0.35)) && rowDisplayBlock);
            const poorMobileUsability =
              mobileViewport &&
              (
                (hiddenWidthPx >= 120 && !stackedFallback) ||
                (columnCount >= 5 && hiddenWidthPx >= 72 && !stackedFallback) ||
                (visibleHeaderCount === 0 && columnCount >= 4 && !stackedFallback)
              );
            const severePoorMobileUsability =
              poorMobileUsability &&
              (
                hiddenWidthPx >= 240 ||
                (visibleHeaderCount === 0 && hiddenWidthPx >= 120) ||
                (columnCount >= 8 && hiddenWidthPx >= 120)
              );

            return {
              regionId: `table-region-${index + 1}`,
              selector: makeSelector(element),
              kind: "table",
              bounds,
              hiddenWidthPx,
              containerOverflowPx,
              elementScrollOverflowPx,
              rectOverflowPx,
              rowCount,
              columnCount,
              visibleHeaderCount,
              stackedFallback,
              poorMobileUsability,
              severePoorMobileUsability
            };
          });

        const chartRegions = chartElements
          .slice(0, 20)
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const bounds = getBounds(element);
            const overflowLeftPx = Math.max(0, 0 - rect.left);
            const overflowRightPx = Math.max(0, rect.right - viewportWidth);
            const hiddenWidthPx = Math.max(overflowLeftPx, overflowRightPx);
            const poorMobileUsability = mobileViewport && hiddenWidthPx >= 72;
            const severePoorMobileUsability = mobileViewport && hiddenWidthPx >= 180;
            return {
              regionId: `chart-region-${index + 1}`,
              selector: makeSelector(element),
              kind: "chart",
              bounds,
              hiddenWidthPx,
              poorMobileUsability,
              severePoorMobileUsability
            };
          });

        const problematicRegions = [...tableRegions, ...chartRegions]
          .filter((entry) => entry.poorMobileUsability)
          .sort((left, right) => (right.hiddenWidthPx ?? 0) - (left.hiddenWidthPx ?? 0))
          .slice(0, 8);

        return {
          tableCount: tableElements.length,
          chartCount: chartElements.length,
          overflowingTableCount: overflowingTables.length,
          firstOverflowingTableSelector: overflowingTables[0] ? makeSelector(overflowingTables[0]) : null,
          problematicTableCount: tableRegions.filter((entry) => entry.poorMobileUsability).length,
          problematicChartCount: chartRegions.filter((entry) => entry.poorMobileUsability).length,
          poorMobileUsabilityCount: problematicRegions.length,
          severePoorMobileUsabilityCount: problematicRegions.filter((entry) => entry.severePoorMobileUsability).length,
          firstProblematicSelector: problematicRegions[0]?.selector ?? null,
          maxHiddenWidthPx: problematicRegions.reduce(
            (max, entry) => Math.max(max, Number(entry.hiddenWidthPx ?? 0)),
            0
          ),
          problematicRegions
        };
      })() : {
        tableCount: 0,
        chartCount: 0,
        overflowingTableCount: 0,
        firstOverflowingTableSelector: null,
        problematicTableCount: 0,
        problematicChartCount: 0,
        poorMobileUsabilityCount: 0,
        severePoorMobileUsabilityCount: 0,
        firstProblematicSelector: null,
        maxHiddenWidthPx: 0,
        problematicRegions: []
      };

      const stateSignals = uiuxSignalsEnabled ? (() => {
        const textFor = (item) =>
          [item.text, item.ariaLabel, item.placeholder, item.name].join(" ").toLowerCase();
        const actionKeywordPattern =
          /add|create|new|retry|try again|reset|clear|filter|help|search|browse|continue|next|view|details|home|support|contact|dismiss|close|back|return/i;
        const guidanceActions = interactiveWithPrimary
          .filter((item) => item.inViewport && !item.disabled)
          .filter((item) => actionKeywordPattern.test(textFor(item)))
          .map((item) => ({
            text: item.text || item.ariaLabel || item.placeholder || item.name || item.tag,
            selector: item.selector,
            zone: item.zone
          }))
          .slice(0, 20);

        const emptyPattern =
          /no results|no items|no data|no records|nothing here|nothing to show|empty state|0 results|no matches/i;
        const emptyStates = Array.from(
          document.querySelectorAll("main, [role='main'], section, article, [role='status'], .empty, .empty-state, [data-empty-state]")
        )
          .filter((element) => isElementVisible(element))
          .map((element, index) => {
            const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 260);
            if (!emptyPattern.test(text)) {
              return null;
            }
            const bounds = getBounds(element);
            return {
              stateId: `empty-${index + 1}`,
              selector: makeSelector(element),
              text,
              inViewport: isInViewport(bounds),
              areaRatio: (bounds.width * bounds.height) / viewportArea,
              hasGuidanceAction: guidanceActions.length > 0
            };
          })
          .filter(Boolean)
          .slice(0, 10);

        const errorPattern =
          /error|failed|failure|unable|cannot|could not|went wrong|unavailable|problem|denied|forbidden/i;
        const recoveryPattern =
          /retry|try again|refresh|reload|close|dismiss|back|return|cancel|contact|support|home|alternative|continue/i;
        const errorStates = Array.from(
          document.querySelectorAll(
            "[role='alert'], [aria-live='assertive'], main, [role='main'], section, article, .error, .error-state, [data-error-state]"
          )
        )
          .filter((element) => isElementVisible(element))
          .map((element, index) => {
            const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 320);
            if (!errorPattern.test(text)) {
              return null;
            }
            const bounds = getBounds(element);
            const actions = Array.from(element.querySelectorAll("button, a, [role='button']"))
              .filter((action) => isElementVisible(action))
              .map((action) => ({
                text: getElementLabel(action).slice(0, 120),
                selector: makeSelector(action)
              }));
            return {
              stateId: `error-${index + 1}`,
              selector: makeSelector(element),
              text,
              inViewport: isInViewport(bounds),
              areaRatio: (bounds.width * bounds.height) / viewportArea,
              isFullPage: bounds.height >= viewportHeight * 0.62 || bounds.width >= viewportWidth * 0.88,
              hasRecoveryAction:
                actions.some((action) => recoveryPattern.test(action.text)) ||
                guidanceActions.some((action) => recoveryPattern.test(action.text)),
              actions
            };
          })
          .filter(Boolean)
          .slice(0, 10);

        const successPattern =
          /success|completed|all set|done|saved|submitted|thank you|created|updated successfully|payment complete/i;
        const nextStepPattern =
          /continue|next|go home|home|view details|details|open|dashboard|finish|back to|see more/i;
        const successStates = Array.from(
          document.querySelectorAll(
            "[role='status'], [aria-live='polite'], main, [role='main'], section, article, .success, .success-state, [data-success-state]"
          )
        )
          .filter((element) => isElementVisible(element))
          .map((element, index) => {
            const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 320);
            if (!successPattern.test(text)) {
              return null;
            }
            const bounds = getBounds(element);
            return {
              stateId: `success-${index + 1}`,
              selector: makeSelector(element),
              text,
              inViewport: isInViewport(bounds),
              areaRatio: (bounds.width * bounds.height) / viewportArea,
              hasNextAction: guidanceActions.some((action) => nextStepPattern.test(action.text))
            };
          })
          .filter(Boolean)
          .slice(0, 10);

        const paginationControlPattern = /^(\d+|next|previous|prev|older|newer|more)$/i;
        const paginationControls = interactiveWithPrimary
          .filter((item) => item.inViewport && !item.disabled)
          .filter((item) => {
            const token = (item.text || item.ariaLabel || "").trim();
            const href = item.href || "";
            return (
              paginationControlPattern.test(token) ||
              /\bnext\b|\bprevious\b|\bprev\b/.test(token.toLowerCase()) ||
              /[?&](page|p)=/i.test(href)
            );
          })
          .map((item) => ({
            text: item.text || item.ariaLabel || item.tag,
            selector: item.selector,
            zone: item.zone
          }))
          .slice(0, 20);

        const paginationContextPattern =
          /page\s+\d+\s*(of|\/)\s*\d+|showing\s+\d+\s*-\s*\d+\s*(of|out of)\s*\d+|results?\s+\d+|total\s+\d+/i;
        const hasPaginationContext = paginationContextPattern.test(bodyText);

        const currentUrl = new URL(window.location.href);
        const searchTerm =
          currentUrl.searchParams.get("q") ||
          currentUrl.searchParams.get("query") ||
          currentUrl.searchParams.get("search_query") ||
          "";
        const hasSearchInput = interactiveWithPrimary.some((item) => {
          if (!item.inViewport || item.tag !== "input") {
            return false;
          }
          const haystack = textFor(item);
          return /search|find|query/.test(haystack);
        });
        const searchResultsPattern = /search|results/i;
        const isSearchResultsPage =
          Boolean(searchTerm) || searchResultsPattern.test(currentUrl.pathname) || (hasSearchInput && /results/i.test(bodyText));
        const visibleResultCount = interactiveWithPrimary.filter((item) => {
          if (!item.inViewport || item.zone !== "Primary Content" || item.tag !== "a") {
            return false;
          }
          const text = (item.text || "").toLowerCase();
          if (!text || text.length < 3) {
            return false;
          }
          return !/next|previous|prev|menu|home|about|contact|privacy|terms/.test(text);
        }).length;
        const hasNoResultsExplanation = /no results|did not match|0 results|nothing found|no matches/i.test(bodyText);
        const hasRefinementGuidance =
          /check spelling|different keyword|refine|adjust filter|try another|search tips|clear filter/i.test(bodyText) ||
          guidanceActions.some((action) => /search|filter|clear|retry|help/.test(action.text));
        const searchTermVisible = searchTerm ? bodyText.toLowerCase().includes(searchTerm.toLowerCase()) : true;

        return {
          guidanceActions,
          emptyStates,
          errorStates,
          successStates,
          pagination: {
            controls: paginationControls,
            hasPaginationControls: paginationControls.length > 0,
            hasContext: hasPaginationContext
          },
          search: {
            isSearchResultsPage,
            searchTerm,
            visibleResultCount,
            hasNoResultsExplanation,
            hasRefinementGuidance,
            searchTermVisible
          }
        };
      })() : {
        guidanceActions: [],
        emptyStates: [],
        errorStates: [],
        successStates: [],
        pagination: {
          controls: [],
          hasPaginationControls: false,
          hasContext: false
        },
        search: {
          isSearchResultsPage: false,
          searchTerm: "",
          visibleResultCount: 0,
          hasNoResultsExplanation: false,
          hasRefinementGuidance: false,
          searchTermVisible: true
        }
      };

      const primaryNavLabels = uiuxSignalsEnabled || a11ySignalsEnabled ? (() => {
        const labels = Array.from(
          document.querySelectorAll(
            "header a, nav a, [role='navigation'] a, header button, nav button, [role='navigation'] button"
          )
        )
          .filter((element) => isElementVisible(element))
          .map((element) => getElementLabel(element).replace(/\s+/g, " ").trim())
          .filter((value) => value.length >= 2);

        return [...new Set(labels)].slice(0, 8);
      })() : [];

      const headerLandmarks = uiuxSignalsEnabled || a11ySignalsEnabled ? Array.from(
        document.querySelectorAll("header, nav, [role='banner'], [role='navigation']")
      )
        .filter((element) => isElementVisible(element))
        .map((element, index) => {
          const bounds = getBounds(element);
          return {
            landmarkId: `hdr-${index + 1}`,
            selector: makeSelector(element),
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
            inViewport: isInViewport(bounds),
            bounds
          };
        })
        .slice(0, 6) : [];

      const skipLinks = a11ySignalsEnabled ? Array.from(document.querySelectorAll("a[href]"))
        .map((element) => {
          const text = getElementLabel(element).replace(/\s+/g, " ").trim();
          const href = element.getAttribute("href") || "";
          const selector = makeSelector(element);
          const skipText = /skip\s+(to\s+)?(main|content|navigation)|skip link/i.test(text.toLowerCase());
          const skipHref = /^#(main|content|primary|app|root)/i.test(href.trim());
          if (!skipText && !skipHref) {
            return null;
          }
          return {
            selector,
            text: text.slice(0, 140),
            href: href.slice(0, 180),
            inViewport: isElementVisible(element)
          };
        })
        .filter(Boolean)
        .slice(0, 12) : [];

      const hasSkipLink = skipLinks.length > 0;

      const brandHeaderSignatureSource = [
        ...headerLandmarks.map((entry) => entry.text),
        primaryNavLabels.join("|")
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const headingCandidate = uiuxSignalsEnabled ? (
        Array.from(
          document.querySelectorAll("h1, [role='heading'][aria-level='1'], main h2, [role='main'] h2")
        ).find((element) => isElementVisible(element)) ?? null
      ) : null;
      const h1Text = uiuxSignalsEnabled && headingCandidate
        ? (headingCandidate.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180)
        : "";

      const hasSearchBar = uiuxSignalsEnabled && Array.from(
        document.querySelectorAll(
          "header input, main input, [role='search'] input, input[type='search'], input[name*='search' i], input[placeholder*='search' i]"
        )
      )
        .filter((element) => isElementVisible(element))
        .some((element) => {
          const type = (element.getAttribute("type") || "").toLowerCase();
          const haystack = [
            element.getAttribute("name"),
            element.getAttribute("placeholder"),
            element.getAttribute("aria-label")
          ]
            .join(" ")
            .toLowerCase();
          return type === "search" || /search|find|query/.test(haystack);
        });

      const pageTypeHints = uiuxSignalsEnabled ? (() => {
        const currentUrl = new URL(window.location.href);
        const path = currentUrl.pathname.toLowerCase();
        const hasSearchParam = ["q", "query", "search_query"].some((key) =>
          currentUrl.searchParams.has(key)
        );
        const hasPasswordField = Array.from(document.querySelectorAll("input[type='password']")).some((element) =>
          isElementVisible(element)
        );

        const isSearch = /search|results/.test(path) || hasSearchParam;
        const isProduct =
          /product|products|item|sku|\/p\//.test(path) ||
          /\badd to cart\b|\bbuy now\b/.test(bodyText.toLowerCase());
        const isCheckout = /checkout|cart|payment|billing|order/.test(path);
        const isAuth = /login|sign[- ]?in|sign[- ]?up|register|auth/.test(path) || hasPasswordField;
        const isDocs = /docs|documentation|guide|help/.test(path) || contentHints.documentationLike;
        const isHome = (path === "/" || /home/.test(path)) && !isSearch && !isProduct && !isCheckout && !isAuth;

        return {
          isHome,
          isSearch,
          isProduct,
          isCheckout,
          isAuth,
          isDocs
        };
      })() : {
        isHome: false,
        isSearch: false,
        isProduct: false,
        isCheckout: false,
        isAuth: false,
        isDocs: false
      };

      const primaryCta = primaryCtaCandidate
        ? {
            elementId: primaryCtaCandidate.elementId,
            selector: primaryCtaCandidate.selector,
            text: primaryCtaCandidate.text,
            bounds: primaryCtaCandidate.bounds
          }
        : null;

      return {
        title: document.title,
        url: window.location.href,
        bodyText: bodyText.slice(0, 2400),
        readyState: document.readyState,
        viewportWidth,
        viewportHeight,
        pageWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
          viewportWidth
        ),
        pageHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          viewportHeight
        ),
        interactive: interactiveWithPrimary,
        semanticMap,
        accessibilityTree,
        pageLinks,
        primaryCta,
        images,
        formControls,
        formControlDescriptors,
        visibleErrorMessages,
        errorBanners,
        textOverflowItems,
        contentHints,
        dataDisplaySignals,
        responsiveSignals,
        stateSignals,
        pageTypeHints,
        primaryNavLabels,
        brandHeaderSignatureSource,
        headerLandmarks,
        skipLinks,
        hasSkipLink,
        h1Text,
        hasSearchBar,
        hasMainLandmark,
        headings,
        focusableHiddenElements,
        overlays,
        spinnerVisible,
        spinnerBounds
      };
    }, {
      uiuxSignalsEnabled: includeUiuxSignals,
      a11ySignalsEnabled: includeA11ySignals
    });

    const focusProbe = options.includeFocusProbe ? await this.collectFocusVisibilityProbe(8).catch(() => null) : null;
    const focusA11yProbe = includeFocusA11yProbe
      ? await this.collectAccessibilityFocusProbe(
          Math.min(Math.max(Number(this.runConfig?.accessibility?.focusProbeTabSteps ?? 10), 1), 12)
        ).catch(() => null)
      : null;
    const contrastSamples = includeA11ySignals ? await this.collectAccessibilityContrastSamples().catch(() => null) : null;
    const textScaleFindings = includeA11ySignals ? await this.collectAccessibilityTextScaleFindings().catch(() => null) : null;
    const reducedMotionFindings = includeA11ySignals
      ? await this.collectAccessibilityReducedMotionFindings().catch(() => null)
      : null;
    const brandHeaderSignature = hashText(
      pageState.brandHeaderSignatureSource ||
      (pageState.primaryNavLabels ?? []).join("|") ||
      pageState.title ||
      "header-empty"
    );

    const hash = hashText(
      JSON.stringify({
        title: pageState.title,
        bodyText: pageState.bodyText,
        interactive: pageState.interactive.map((item) => [item.text, item.tag, item.disabled]),
        semanticMap: pageState.semanticMap.map((item) => [item.text, item.zone, item.center.join(",")]),
        pressed: pageState.interactive.map((item) => item.pressed),
        overlays: pageState.overlays.map((item) => item.text),
        spinnerVisible: pageState.spinnerVisible,
        brokenImages: pageState.images.filter((item) => item.broken).map((item) => item.src || item.selector || item.imageId),
        errorBanners: pageState.errorBanners.map((item) => item.text),
        primaryCta: pageState.primaryCta?.selector ?? pageState.primaryCta?.elementId ?? null,
        textOverflow: pageState.textOverflowItems.map((item) => item.selector || item.text),
        dataDisplaySignals: pageState.dataDisplaySignals,
        responsiveSignals: pageState.responsiveSignals,
        pageTypeHints: pageState.pageTypeHints,
        primaryNavLabels: pageState.primaryNavLabels,
        h1Text: pageState.h1Text,
        hasSearchBar: pageState.hasSearchBar,
        brandHeaderSignature,
        viewportLabel,
        deviceLabel,
        deviceId
      })
    );

    const functionalNetworkSummary = this.isFunctionalMode() ? this.buildFunctionalStepNetworkSummary() : null;
    const networkSummaryForStep = this.isFunctionalMode()
      ? {
          ...this.networkSummary,
          ...functionalNetworkSummary
        }
      : { ...this.networkSummary };

    await this.saveStructuredArtifacts(stepLabel, {
      html,
      accessibilitySnapshot,
      viewportLabel,
      networkSummary: networkSummaryForStep
    });

    return {
      step,
      stepLabel,
      viewportLabel,
      deviceLabel,
      deviceId,
      ...pageState,
      viewportWidth: viewportSize?.width ?? pageState.viewportWidth,
      viewportHeight: viewportSize?.height ?? pageState.viewportHeight,
      accessibilitySnapshot,
      consoleErrors: this.consoleEntries
        .filter((entry) => ["error", "warning"].includes(entry.type))
        .map((entry) => `${entry.type.toUpperCase()}: ${entry.text}`)
        .slice(-20),
      consoleEntries: [...this.consoleEntries],
      networkSummary: networkSummaryForStep,
      layoutSample,
      layoutStabilityProbe,
      focusProbe,
      focusA11yProbe,
      contrastSamples,
      textScaleFindings,
      reducedMotionFindings,
      firstInvalidFocusAfterSubmit: formValidationProbe?.firstInvalidFocusAfterSubmit ?? null,
      formValidationProbe: formValidationProbe
        ? {
            ...formValidationProbe,
            mode: formsConfig?.mode ?? formValidationProbe.mode ?? "observe-only",
            safeSubmitTypes: formsConfig?.safeSubmitTypes ?? formValidationProbe.safeSubmitTypes ?? ["search"]
          }
        : {
            enabled: formsConfig?.enabled ?? false,
            mode: formsConfig?.mode ?? "observe-only",
            safeSubmitTypes: formsConfig?.safeSubmitTypes ?? ["search"],
            maxValidationAttemptsPerPage: formsConfig?.maxValidationAttemptsPerPage ?? 1,
            attempted: false,
            submitType: null,
            skippedReason: "not-collected",
            targetSelector: null,
            expectedInvalidSelector: null,
            firstInvalidFocusAfterSubmit: null,
            visibleErrorCountAfterSubmit: 0,
            associatedErrorCountAfterSubmit: 0,
            submitEventTriggered: false
          },
      brandHeaderSignature,
      uiReadyState: { ...this.lastUiReadyState },
      hash,
      screenshotPath,
      screenshotUrl: screenshotArtifact.url,
      screenshotCaptureMode: screenshotCapture.captureMode,
      screenshotBase64: base64,
      artifacts: this.getArtifactIndex()
    };
  }

  startFunctionalActionMonitors(action) {
    const monitors = {
      popupPages: [],
      downloadPromise: null,
      cleanup: () => {}
    };

    if (!this.isFunctionalMode()) {
      return monitors;
    }

    const capabilities = this.functionalCapabilities();
    const listeners = [];

    if (action?.type === "click") {
      const onPopup = (popupPage) => {
        monitors.popupPages.push(popupPage);
      };
      const onContextPage = (contextPage) => {
        if (contextPage !== this.page) {
          monitors.popupPages.push(contextPage);
        }
      };
      this.page.on("popup", onPopup);
      this.context.on("page", onContextPage);
      listeners.push(() => this.page.off("popup", onPopup));
      listeners.push(() => this.context.off("page", onContextPage));
    }

    if (capabilities.allowDownloads && action?.type === "click") {
      monitors.downloadPromise = this.page.waitForEvent("download", { timeout: 2_500 }).catch(() => null);
    }

    monitors.cleanup = () => {
      for (const cleanup of listeners) {
        cleanup();
      }
    };
    return monitors;
  }

  async finalizeFunctionalActionMonitors(monitors) {
    const signals = [];
    if (!this.isFunctionalMode()) {
      monitors?.cleanup?.();
      return signals;
    }

    const capabilities = this.functionalCapabilities();
    const readiness = this.actionReadinessConfig();

    if (capabilities.allowDownloads && monitors?.downloadPromise) {
      const download = await monitors.downloadPromise;
      if (download) {
        await fs.mkdir(this.downloadsDir, { recursive: true }).catch(() => {});
        const suggested = sanitizeFilename(download.suggestedFilename?.() ?? "download.bin");
        const savedPath = path.join(this.downloadsDir, `${Date.now()}-${suggested}`);
        await download.saveAs(savedPath).catch(() => {});
        const exists = await this.hasFile(savedPath);
        const downloadEntry = {
          fileName: suggested,
          path: savedPath,
          relativePath: exists ? toRelativeArtifactPath(savedPath) : null,
          url: download.url?.() ?? null,
          exists,
          at: new Date().toISOString()
        };
        this.networkSummary.downloads = [...(this.networkSummary.downloads ?? []), downloadEntry].slice(-20);
        if (exists) {
          this.appendArtifact("downloads", this.buildArtifactRef(savedPath));
        }
        signals.push(`download-triggered:${suggested}`);
      }
    }

    if (monitors?.popupPages?.length) {
      if (!capabilities.allowNewTabs) {
        for (const popupPage of monitors.popupPages) {
          await popupPage.close().catch(() => {});
        }
        signals.push("popup-blocked");
        monitors?.cleanup?.();
        return signals;
      }

      let switched = false;
      for (const popupPage of monitors.popupPages) {
        await popupPage.waitForLoadState("domcontentloaded", { timeout: 6_000 }).catch(() => {});
        const popupUrl = popupPage.url();
        if (!this.safetyAllowsDomain(popupUrl)) {
          await popupPage.close().catch(() => {});
          signals.push("popup-blocked");
          continue;
        }
        this.page = popupPage;
        this.attachTelemetry();
        this.networkSummary.openedNewTab = true;
        this.networkSummary.newTabUrl = popupUrl;
        this.networkSummary.mainDocumentUrl = popupUrl.slice(0, 280);
        await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
        await this.page.waitForTimeout(readiness.settleMs);
        await this.applySiteGuards(popupUrl);
        signals.push(`new-tab-opened:${popupUrl}`);
        switched = true;
        break;
      }
      if (!switched && !signals.includes("popup-blocked")) {
        signals.push("popup-blocked");
      }
    } else {
      this.networkSummary.openedNewTab = false;
      this.networkSummary.newTabUrl = null;
    }

    monitors?.cleanup?.();
    return signals;
  }

  async handleFunctionalUpload(locator, target) {
    const decision = evaluateUploadCapability({
      runConfig: this.runConfig,
      target
    });
    if (!decision.allowed) {
      throw new Error(`UPLOAD_REQUIRED: ${decision.reason}`);
    }

    const fixturePath = this.resolveUploadFixturePath();
    const fixtureExists = await this.hasFile(fixturePath);
    if (!fixtureExists) {
      throw new Error(`UPLOAD_REQUIRED: Upload fixture not found at ${fixturePath}`);
    }

    await locator.setInputFiles(fixturePath);
    const attached = await locator
      .evaluate((element) => Boolean(element?.files && element.files.length > 0))
      .catch(() => false);
    if (!attached) {
      throw new Error("UPLOAD_REQUIRED: File upload did not attach correctly.");
    }
    return validateActionResult({
      success: true,
      expected: "A safe fixture file should be attached to the file input.",
      actual: `Attached fixture ${path.basename(fixturePath)} to file input.`,
      progressSignals: ["upload-attached"]
    });
  }

  async executeAction(action, snapshot) {
    const readiness = this.actionReadinessConfig();
    this.networkSummary.openedNewTab = false;
    this.networkSummary.newTabUrl = null;
    if (action.type === "wait") {
      await this.page.waitForTimeout(action.durationMs ?? 1_000);
      return validateActionResult({
        success: true,
        expected: "The browser should pause briefly.",
        actual: `Waited for ${action.durationMs ?? 1_000}ms.`,
        progressSignals: ["wait-complete"]
      });
    }

    if (action.type === "scroll") {
      await this.page.mouse.wheel(0, action.deltaY ?? 500);
      await this.page.waitForTimeout(500);
      return validateActionResult({
        success: true,
        expected: "The viewport should scroll.",
        actual: `Scrolled by ${action.deltaY ?? 500}px.`,
        progressSignals: ["scroll-complete"]
      });
    }

    if (action.type === "goto") {
      this.resetNavigationTracking();
      await this.goto(action.url);
      return validateActionResult({
        success: true,
        expected: `Navigate to ${action.url}`,
        actual: `Browser navigated to ${this.page.url()}`,
        progressSignals: ["navigation-complete"]
      });
    }

    if (action.type === "back") {
      this.resetNavigationTracking();
      const response = await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
      this.recordMainDocumentResponse(response, this.page.url());
      await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
      return validateActionResult({
        success: true,
        expected: "The browser should navigate back.",
        actual: `Current URL is ${this.page.url()}`,
        progressSignals: ["navigation-back"]
      });
    }

    if (action.type === "forward") {
      await this.goForward();
      return validateActionResult({
        success: true,
        expected: "The browser should navigate forward.",
        actual: `Current URL is ${this.page.url()}`,
        progressSignals: ["navigation-forward"]
      });
    }

    if (action.type === "refresh") {
      this.resetNavigationTracking();
      const response = await this.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
      this.recordMainDocumentResponse(response, this.page.url());
      await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
      return validateActionResult({
        success: true,
        expected: "The current page should refresh.",
        actual: `Page reloaded at ${this.page.url()}`,
        progressSignals: ["refresh-complete"]
      });
    }

    const target = snapshot.interactive.find((item) => item.elementId === action.elementId) ?? null;

    if (!target) {
      throw new Error(`Target element ${action.elementId} was not present in the current snapshot`);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= (this.runConfig?.budgets?.actionRetryCount ?? config.actionRetryCount); attempt += 1) {
      const monitors = this.startFunctionalActionMonitors(action);
      try {
        await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
        await this.applySiteGuards(snapshot.url);

        if (await this.handleSpecialAction(action, target, snapshot)) {
          const capabilitySignals = await this.finalizeFunctionalActionMonitors(monitors);
          await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
          await this.page.waitForTimeout(readiness.settleMs);
          return validateActionResult({
            success: true,
            expected: `Perform ${action.type} on ${target.text || target.ariaLabel || target.tag}`,
            actual: `Special action ${action.type} completed after ${attempt} attempt(s).`,
            progressSignals: ["special-action-complete", `attempt-${attempt}`, ...capabilitySignals]
          });
        }

        const locator = this.resolveLocator(target);
        if (locator) {
          await locator.waitFor({ state: "visible", timeout: config.selectorVisibleTimeoutMs });
          await locator.scrollIntoViewIfNeeded().catch(() => {});
          const targetCoords = await this.getLocatorCenter(locator);

          if (this.isFunctionalMode() && String(target.type ?? "").toLowerCase() === "file") {
            monitors.cleanup();
            return this.handleFunctionalUpload(locator, target);
          }

          if (action.type === "type") {
            await this.validateAndClick(targetCoords, target);
            await locator.fill(action.text ?? "");
            if (this.shouldSubmitWithEnter(action, target)) {
              await this.page.keyboard.press("Enter");
            }
          } else {
            await this.clickWithRecovery(targetCoords, target, snapshot);
          }
        } else {
          const targetCoords = await this.getAbsoluteCenter(target);
          await this.clickWithRecovery(targetCoords, target, snapshot);
          if (action.type === "type" && action.text) {
            await this.page.keyboard.press("Meta+A").catch(() => {});
            await this.page.keyboard.type(action.text);
            if (this.shouldSubmitWithEnter(action, target)) {
              await this.page.keyboard.press("Enter");
            }
          }
        }

        const capabilitySignals = await this.finalizeFunctionalActionMonitors(monitors);
        await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
        await this.page.waitForTimeout(readiness.settleMs);
        return validateActionResult({
          success: true,
          expected: `Perform ${action.type} on ${target.text || target.ariaLabel || target.tag}`,
          actual: `${action.type} completed after ${attempt} attempt(s).`,
          progressSignals: ["action-complete", `attempt-${attempt}`, ...capabilitySignals]
        });
      } catch (error) {
        lastError = error;
        monitors.cleanup();
        await sleep(config.actionRetryDelayMs);
      }
    }

    throw lastError;
  }

  async getLocatorCenter(locator) {
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error("Resolved locator has no clickable bounding box");
    }

    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      viewport: true
    };
  }

  async getAbsoluteCenter(target) {
    const scroll = await this.page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY
    }));

    return {
      x: target.bounds.centerX - scroll.x,
      y: target.bounds.centerY - scroll.y,
      viewport: true
    };
  }

  async validateAndClick(targetCoords, target) {
    const probe = await this.page.evaluate(
      ({ x, y, expected }) => {
        const hit = document.elementFromPoint(x, y);
        const candidate = hit?.closest("button, input, a, textarea, select, [role='button']") ?? null;
        const blocker = hit?.closest(
          "dialog, [role='dialog'], .modal, [data-modal], [aria-modal='true'], tp-yt-paper-dialog, ytd-guide-signin-promo-renderer, ytd-consent-bump-v2-lightbox, ytd-modal-with-title-and-button-renderer, yt-upsell-dialog-renderer"
        );
        const subject = candidate ?? hit;

        if (!subject) {
          return {
            ok: false,
            tagName: "NONE",
            reason: "No DOM element was present at the suggested coordinates.",
            text: ""
          };
        }

        const rect = subject.getBoundingClientRect();
        const style = window.getComputedStyle(subject);
        const text = (
          candidate?.textContent ||
          candidate?.getAttribute("aria-label") ||
          candidate?.getAttribute("placeholder") ||
          hit?.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);

        const normalizedExpected = [
          expected.text,
          expected.placeholder,
          expected.name,
          expected.ariaLabel,
          expected.id
        ]
          .join(" ")
          .toLowerCase()
          .trim();
        const normalizedActual = [
          candidate?.textContent || "",
          candidate?.getAttribute("placeholder") || "",
          candidate?.getAttribute("name") || "",
          candidate?.getAttribute("aria-label") || "",
          candidate?.id || "",
          hit?.textContent || ""
        ]
          .join(" ")
          .toLowerCase();
        const actualTrimmed = normalizedActual.trim();

        const matchesExpected =
          !normalizedExpected ||
          normalizedActual.includes(normalizedExpected) ||
          (actualTrimmed && normalizedExpected.includes(actualTrimmed)) ||
          (expected.tag && candidate?.tagName?.toLowerCase() === expected.tag);

        const isVisible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number.parseFloat(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0;

        return {
          ok: Boolean(candidate) && isVisible && !blocker && matchesExpected,
          tagName: candidate?.tagName || hit?.tagName || "UNKNOWN",
          reason: blocker
            ? "The target coordinates are currently obscured by an overlay."
            : !candidate
              ? "The top-most element is not actionable."
              : !isVisible
                ? "The resolved target is hidden."
                : !matchesExpected
                  ? "The top-most actionable element does not match the intended control."
                  : "",
          text
        };
      },
      {
        x: targetCoords.x,
        y: targetCoords.y,
        expected: {
          tag: target.tag,
          text: target.text ?? "",
          placeholder: target.placeholder ?? "",
          name: target.name ?? "",
          ariaLabel: target.ariaLabel ?? "",
          id: target.id ?? ""
        }
      }
    );

    if (!probe.ok) {
      throw new Error(
        `Target at ${Math.round(targetCoords.x)}, ${Math.round(targetCoords.y)} is obscured by a ${probe.tagName}. ${probe.reason}${probe.text ? ` Top element: ${probe.text}.` : ""}`
      );
    }

    await this.page.mouse.click(targetCoords.x, targetCoords.y);
  }

  async clickWithRecovery(targetCoords, target, snapshot) {
    try {
      await this.validateAndClick(targetCoords, target);
    } catch (error) {
      if (await this.tryYouTubeResultFallback(target, snapshot)) {
        return;
      }

      throw error;
    }
  }

  async tryYouTubeResultFallback(target, snapshot) {
    if (!this.isYouTubeUrl(snapshot.url)) {
      return false;
    }

    if (target.zone !== "Primary Content" && !/watch|video|result/i.test(target.landmark ?? "")) {
      return false;
    }

    const fallback = this.page
      .locator(
        [
          "ytd-video-renderer a#video-title:not([aria-label*='Ad']):not([title*='Mix'])",
          "ytd-video-renderer a[href*='/watch']:not([aria-label*='Ad']):not([title*='Mix'])"
        ].join(",")
      )
      .first();

    const count = await fallback.count().catch(() => 0);
    if (!count) {
      return false;
    }

    await fallback.scrollIntoViewIfNeeded().catch(() => {});
    await fallback.click({ timeout: config.clickTimeoutMs });
    return true;
  }

  resolveLocator(target) {
    if (this.isYouTubeSearchField(target)) {
      return this.page.locator('input#search, textarea#search, input[name="search_query"]').first();
    }

    if (target.selector) {
      return this.page.locator(target.selector).first();
    }

    const ariaLabel = target.ariaLabel?.trim();
    if (ariaLabel) {
      return this.page.locator(`${target.tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`).first();
    }

    const name = target.name?.trim();
    if (name) {
      return this.page.locator(`${target.tag}[name="${name.replace(/"/g, '\\"')}"]`).first();
    }

    return null;
  }

  async handleSpecialAction(action, target, snapshot) {
    if (this.isYouTubeSearchAction(action, target, snapshot)) {
      await this.searchAndSubmitYouTube(action.text ?? "");
      return true;
    }

    return false;
  }

  isYouTubeSearchAction(action, target, snapshot) {
    return this.isYouTubeUrl(snapshot.url) && action.type === "type" && this.isYouTubeSearchField(target);
  }

  isYouTubeSearchField(target) {
    const haystack = [target.id, target.ariaLabel, target.text, target.placeholder, target.name, target.type]
      .join(" ")
      .toLowerCase();

    return /\bsearch\b|what do you want to watch|search_query/.test(haystack);
  }

  isYouTubeUrl(url) {
    return /(^https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\b/i.test(url ?? "");
  }

  async searchAndSubmitYouTube(songName) {
    const searchSelector = "input#search, textarea#search, input[name='search_query']";

    await this.page.waitForSelector(searchSelector, {
      state: "visible",
      timeout: Math.max(config.selectorVisibleTimeoutMs, 10_000)
    });

    const searchBar = this.page.locator(searchSelector).first();
    await searchBar.scrollIntoViewIfNeeded().catch(() => {});
    await searchBar.click({ timeout: Math.max(config.clickTimeoutMs, 5_000) });
    await searchBar.fill(songName);
    await this.page.keyboard.press("Enter");
  }

  shouldSubmitWithEnter(action, target) {
    if (action.pressEnter || action.submitOnEnter) {
      return true;
    }

    if (action.type !== "type") {
      return false;
    }

    const haystack = [target.id, target.ariaLabel, target.text, target.placeholder, target.name, target.type]
      .join(" ")
      .toLowerCase();
    return /\bsearch\b|what do you want to watch|query/.test(haystack);
  }

  normalizeBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = String(value ?? "")
      .trim()
      .toLowerCase();
    return ["1", "true", "yes", "on", "checked"].includes(normalized);
  }

  resolveAutoFormValue(field = {}, context = {}) {
    const label = [
      field.label,
      field.placeholder,
      field.ariaLabel,
      field.name,
      field.type
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const now = Date.now();
    const date = new Date();
    const isoDate = date.toISOString().slice(0, 10);

    if (field.tag === "select") {
      return field.options?.[1]?.value ?? field.options?.[0]?.value ?? "";
    }
    if (field.tag === "textarea" || /\bmessage|notes?|description|comment\b/.test(label)) {
      return `Automated functional test input for ${context.description || "form validation"}.`;
    }
    if (/\bemail|e-mail\b/.test(label)) {
      return `qa.user+${now}@example.com`;
    }
    if (/\bpassword|passcode|pin\b/.test(label)) {
      return "QaAuto!23456";
    }
    if (/\b(phone|mobile|tel|contact)\b/.test(label)) {
      return "5551234567";
    }
    if (/\bsearch|query|find\b/.test(label)) {
      return "test query";
    }
    if (/\bname|full name|first name|last name\b/.test(label)) {
      return "Test User";
    }
    if (/\baddress|street|city|state|country|zip|postal\b/.test(label)) {
      return "123 Test Street";
    }
    if (/\b(company|organization|organisation|business)\b/.test(label)) {
      return "QA Labs";
    }
    if (/\b(url|website|link)\b/.test(label)) {
      return "https://example.com";
    }
    if (/\b(otp|verification|code|token|access key|invite|id)\b/.test(label)) {
      return "AUTO123456";
    }
    if (/\b(date|dob|birth)\b/.test(label) || field.type === "date") {
      return isoDate;
    }
    if (field.type === "number") {
      return "11";
    }
    if (field.type === "checkbox" || field.type === "radio") {
      return true;
    }
    return "test input";
  }

  pickDecisionValue(field = {}, values = {}) {
    if (!values || typeof values !== "object") {
      return undefined;
    }
    const candidates = [
      field.fieldId,
      field.selector,
      field.name,
      field.label
    ].filter(Boolean);

    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key];
      }
    }
    return undefined;
  }

  async fillFormFieldBySelector(field = {}, value, mode = "submit") {
    if (!field?.selector) {
      return {
        fieldId: field?.fieldId ?? null,
        selector: field?.selector ?? null,
        filled: false,
        skipped: "missing-selector"
      };
    }

    const locator = this.page.locator(field.selector).first();
    await locator.waitFor({ state: "visible", timeout: 2_500 });

    const tag = String(field.tag ?? "").toLowerCase();
    const type = String(field.type ?? "").toLowerCase();

    if (tag === "select") {
      const optionValue = value ?? field.options?.[1]?.value ?? field.options?.[0]?.value ?? "";
      if (!optionValue) {
        return {
          fieldId: field.fieldId ?? null,
          selector: field.selector,
          filled: false,
          skipped: "no-select-option"
        };
      }
      await locator.selectOption(String(optionValue)).catch(async () => {
        const fallback = await locator.locator("option").first().getAttribute("value").catch(() => null);
        if (fallback !== null) {
          await locator.selectOption(String(fallback));
        }
      });
      return {
        fieldId: field.fieldId ?? null,
        selector: field.selector,
        filled: true,
        value: String(optionValue)
      };
    }

    if (type === "checkbox" || type === "radio") {
      const shouldEnable = this.normalizeBoolean(value);
      if (shouldEnable) {
        await locator.check({ force: true }).catch(async () => {
          await locator.click({ force: true });
        });
      } else if (type === "checkbox") {
        await locator.uncheck({ force: true }).catch(() => {});
      }
      return {
        fieldId: field.fieldId ?? null,
        selector: field.selector,
        filled: true,
        value: shouldEnable
      };
    }

    if (type === "file") {
      return {
        fieldId: field.fieldId ?? null,
        selector: field.selector,
        filled: false,
        skipped: "file-input"
      };
    }

    const normalized = value === undefined || value === null ? "" : String(value);
    if (mode === "submit" && normalized.length === 0) {
      return {
        fieldId: field.fieldId ?? null,
        selector: field.selector,
        filled: false,
        skipped: "empty-user-value"
      };
    }

    await locator.fill(normalized);
    return {
      fieldId: field.fieldId ?? null,
      selector: field.selector,
      filled: true,
      value: normalized
    };
  }

  async submitFormAssistGroup(group = {}, decision = {}) {
    if (!this.page) {
      throw new Error("No active page is available for form submission.");
    }

    const mode = decision.action === "auto" ? "auto" : "submit";
    const readiness = this.actionReadinessConfig();
    const fields = Array.isArray(group.fields) ? group.fields : [];
    const values = decision.values ?? {};
    const description = String(decision.description ?? group.description ?? "").trim();
    const fieldResults = [];

    for (const field of fields) {
      const userValue = this.pickDecisionValue(field, values);
      const value = mode === "auto" ? this.resolveAutoFormValue(field, { description }) : userValue;
      try {
        const result = await this.fillFormFieldBySelector(field, value, mode);
        fieldResults.push(result);
      } catch (error) {
        fieldResults.push({
          fieldId: field.fieldId ?? null,
          selector: field.selector ?? null,
          filled: false,
          skipped: "fill-error",
          error: error?.message ?? "Failed to fill form field."
        });
      }
    }

    let submitTriggered = false;
    const submitSelector = decision.submitSelector ?? group.submitSelector ?? null;
    const submitLabel = decision.submitLabel ?? group.submitLabel ?? null;

    const submitFromLocator = async (selector) => {
      if (!selector) {
        return false;
      }
      const locator = this.page.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) {
        return false;
      }
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: config.clickTimeoutMs }).catch(() => {});
      return true;
    };

    if (submitSelector) {
      submitTriggered = await submitFromLocator(submitSelector);
    }

    if (!submitTriggered && group.formSelector) {
      const submitCandidates = [
        `${group.formSelector} button[type='submit']`,
        `${group.formSelector} input[type='submit']`,
        `${group.formSelector} button`,
        `${group.formSelector} [role='button']`
      ];
      for (const selector of submitCandidates) {
        // Attempt deterministic submit selection within the discovered form scope.
        if (await submitFromLocator(selector)) {
          submitTriggered = true;
          break;
        }
      }
    }

    if (!submitTriggered) {
      const genericSubmit = this.page
        .locator("button[type='submit'], input[type='submit'], button, [role='button']")
        .filter({
          hasText: /submit|save|continue|next|go|search|send|apply|login|sign in|verify|confirm/i
        })
        .first();
      const exists = await genericSubmit.count().catch(() => 0);
      if (exists) {
        await genericSubmit.click({ timeout: config.clickTimeoutMs }).catch(() => {});
        submitTriggered = true;
      }
    }

    if (!submitTriggered) {
      const firstFieldSelector = fields[0]?.selector ?? null;
      if (firstFieldSelector) {
        const locator = this.page.locator(firstFieldSelector).first();
        await locator.focus().catch(() => {});
        await this.page.keyboard.press("Enter").catch(() => {});
        submitTriggered = true;
      }
    }

    await this.waitForUIReady(readiness.strategy, readiness.timeoutMs);
    await this.page.waitForTimeout(readiness.settleMs);

    return {
      success: true,
      mode,
      submitTriggered,
      submitSelector,
      submitLabel,
      fieldResults
    };
  }

  async collectAuthFormProbe() {
    if (!this.page) {
      return this.buildAuthProbeFallback("No active page is available.");
    }

    const baseProbe = await this.page
      .evaluate((shared) => {
        function normalize(value = "") {
          return String(value ?? "").replace(/\s+/g, " ").trim();
        }

        const identifierHintPattern = new RegExp(shared.identifierHintPatternSource, "i");
        const searchHintPattern = new RegExp(shared.searchHintPatternSource, "i");
        const otpHintPattern = new RegExp(shared.otpHintPatternSource, "i");
        const usernameSelector = String(shared.usernameSelector || "");
        const passwordSelector = String(shared.passwordSelector || "");
        const otpSelector = String(shared.otpSelector || "");
        const submitSelector = String(shared.submitSelector || "");

        function isActionable(element, { editable = false } = {}) {
          if (!element || !(element instanceof HTMLElement)) {
            return false;
          }

          if (element.hasAttribute("hidden")) {
            return false;
          }

          if (element.closest("[hidden]")) {
            return false;
          }

          if (element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true']")) {
            return false;
          }

          if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
            return false;
          }
          if (
            editable &&
            ("readOnly" in element || element.getAttribute("aria-readonly")) &&
            (element.readOnly || element.getAttribute("aria-readonly") === "true")
          ) {
            return false;
          }

          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.pointerEvents === "none" ||
            Number.parseFloat(style.opacity || "1") <= 0.05 ||
            rect.width <= 0 ||
            rect.height <= 0
          ) {
            return false;
          }

          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) {
            return false;
          }

          const centerX = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(viewportWidth - 1, 0));
          const centerY = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(viewportHeight - 1, 0));
          const topElement = document.elementFromPoint(centerX, centerY);
          if (!topElement) {
            return true;
          }
          return topElement === element || element.contains(topElement) || topElement.contains(element);
        }

        function all(selector) {
          return Array.from(document.querySelectorAll(selector));
        }

        function actionableCount(selector, options = {}) {
          return all(selector).filter((element) => isActionable(element, options)).length;
        }

        function hasActionableSelector(selector, options = {}) {
          return actionableCount(selector, options) > 0;
        }

        function visibleTextFrom(elements) {
          return elements
            .filter((element) => isActionable(element))
            .map((element) =>
              normalize(
                element.textContent ||
                  element.getAttribute("aria-label") ||
                  element.getAttribute("placeholder") ||
                  element.getAttribute("value") ||
                  ""
              )
            )
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        }

        const pageUrl = window.location.href;
        const bodyText = normalize(document.body?.innerText || "").toLowerCase();
        const path = (new URL(pageUrl).pathname || "").toLowerCase();
        const title = normalize(document.title || "").toLowerCase();
        function fieldHaystack(field) {
          return normalize(
            [
              field.getAttribute("aria-label"),
              field.getAttribute("placeholder"),
              field.getAttribute("name"),
              field.getAttribute("id"),
              field.getAttribute("autocomplete"),
              field.getAttribute("type"),
              field.closest("label")?.textContent ?? "",
              Array.from(field.labels ?? []).map((label) => label.textContent).join(" ")
            ]
              .filter(Boolean)
              .join(" ")
          ).toLowerCase();
        }

        function isIdentifierCandidate(field, { requireActionable = true } = {}) {
          if (!(field instanceof HTMLElement)) {
            return false;
          }
          if (requireActionable && !isActionable(field, { editable: true })) {
            return false;
          }

          const inputType = normalize(field.getAttribute("type") || (field.tagName === "TEXTAREA" ? "textarea" : "text")).toLowerCase();
          if (["hidden", "password", "checkbox", "radio", "file", "submit", "button"].includes(inputType)) {
            return false;
          }

          const haystack = fieldHaystack(field);
          const autocomplete = normalize(field.getAttribute("autocomplete")).toLowerCase();
          const nearestForm = field.closest("form");
          const hasPasswordInForm = Boolean(
            nearestForm
              ? nearestForm.querySelector("input[type='password'], input[autocomplete='current-password']")
              : null
          );
          const hasSubmitInForm = Boolean(
            nearestForm
              ? nearestForm.querySelector(
                "button[type='submit'],input[type='submit'],[role='button'],button,input[type='button'],a[role='button']"
              )
              : null
          );
          const authFormProximity = hasPasswordInForm || hasSubmitInForm;
          if (otpHintPattern.test(haystack) || autocomplete.includes("one-time-code")) {
            return false;
          }
          if (identifierHintPattern.test(haystack)) {
            return true;
          }
          if (autocomplete.includes("username") || autocomplete.includes("email")) {
            return true;
          }
          if (inputType === "email") {
            return true;
          }
          if (searchHintPattern.test(haystack) && !hasPasswordInForm) {
            return false;
          }
          if (authFormProximity && ["text", "", "tel", "number", "search", "url", "textarea"].includes(inputType)) {
            return true;
          }
          return false;
        }

        const usernameFieldPresentCountRaw = all(usernameSelector).length;
        const passwordFieldPresentCount = all(passwordSelector).length;
        const otpFieldPresentCount = all(otpSelector).length;
        const identifierFieldsPresent = all(shared.authFieldQuerySelector || "input, textarea").filter((field) =>
          isIdentifierCandidate(field, { requireActionable: false })
        );
        const identifierFieldsVisible = identifierFieldsPresent.filter((field) =>
          isIdentifierCandidate(field, { requireActionable: true })
        );
        const identifierFieldPresentCount = identifierFieldsPresent.length;
        const identifierFieldVisibleCount = identifierFieldsVisible.length;
        const usernameFieldPresentCount = Math.max(usernameFieldPresentCountRaw, identifierFieldPresentCount);
        const usernameFieldVisibleCount = Math.max(
          actionableCount(usernameSelector, { editable: true }),
          identifierFieldVisibleCount
        );
        const passwordFieldVisibleCount = actionableCount(passwordSelector, { editable: true });
        const otpFieldVisibleCount = actionableCount(otpSelector, { editable: true });

        const usernameFieldDetected = usernameFieldVisibleCount > 0;
        const identifierFieldDetected = identifierFieldVisibleCount > 0;
        const passwordFieldDetected = passwordFieldVisibleCount > 0;
        const otpFieldDetected = otpFieldVisibleCount > 0;
        const identifierLabelCandidates = Array.from(
          new Set(
            identifierFieldsVisible
              .map((field) =>
                normalize(
                  field.getAttribute("aria-label") ||
                    field.getAttribute("placeholder") ||
                    field.closest("label")?.textContent ||
                    Array.from(field.labels ?? [])
                      .map((label) => label.textContent)
                      .join(" ") ||
                    field.getAttribute("name") ||
                    field.getAttribute("id") ||
                    ""
                )
              )
              .filter(Boolean)
              .slice(0, 5)
          )
        );

        const keywordControls = all(
          shared.authControlQuerySelector ||
            "button, input[type='button'], input[type='submit'], [role='button'], a[role='button'], a[href]"
        );
        const submitKeywordHit = keywordControls.some((element) => {
          if (!isActionable(element)) {
            return false;
          }
          const text = normalize(
            element.textContent ||
              element.getAttribute("aria-label") ||
              element.getAttribute("value") ||
              ""
          ).toLowerCase();
          return /\bsign in\b|\blog in\b|\bcontinue\b|\bnext\b|\bverify\b|\bsubmit\b|\bcontinue with\b|\bconfirm\b|\ballow\b/.test(
            text
          );
        });
        const authSubmitKeywordHit = keywordControls.some((element) => {
          if (!isActionable(element)) {
            return false;
          }
          const text = normalize(
            element.textContent ||
              element.getAttribute("aria-label") ||
              element.getAttribute("value") ||
              ""
          ).toLowerCase();
          return /\bsign in\b|\blog in\b|\blogin\b|\bverify\b|\bsubmit\b|\bcontinue with account\b|\buse account\b/.test(text);
        });
        const submitControlDetected =
          hasActionableSelector(submitSelector) ||
          authSubmitKeywordHit ||
          (submitKeywordHit && (passwordFieldDetected || usernameFieldDetected || identifierFieldDetected));

        const authHeadingText = visibleTextFrom(all("h1, h2, h3, [role='heading']"));
        const loginIntentTextDetected =
          /\blog in\b|\bsign in\b|\bauthentication required\b|\baccount access\b|\bcontinue with\b/.test(bodyText) ||
          /\blogin\b|\bsign-?in\b|\bauth\b/.test(path) ||
          /\blog in\b|\bsign in\b/.test(title) ||
          /\blog in\b|\bsign in\b|\bverify\b/.test(authHeadingText);
        const authIntentDetected = loginIntentTextDetected || authSubmitKeywordHit;
        const otpChallengeDetected =
          otpFieldDetected ||
          /\bverification code\b|\bone-time code\b|\botp\b|\btwo-factor\b|\b2fa\b|\bsecurity code\b/.test(bodyText);
        const captchaDetected =
          /\bcaptcha\b|\brecaptcha\b|\bi am not a robot\b|\bverify you are human\b/.test(bodyText) ||
          hasActionableSelector(
            [
              "iframe[src*='recaptcha' i]",
              "[id*='captcha' i]",
              "[class*='captcha' i]"
            ].join(",")
          );

        const invalidErrorCandidates = all(
          [
            "[role='alert']",
            "[aria-live='assertive']",
            ".error",
            ".alert",
            ".invalid-feedback",
            "[data-error]",
            "[class*='error' i]",
            "[aria-invalid='true']"
          ].join(",")
        );
        const invalidErrorText = visibleTextFrom(invalidErrorCandidates);
        const invalidCredentialErrorDetected =
          /\binvalid\b|\bincorrect\b|\bwrong\b|\bdoes not match\b|\btry again\b|\bfailed\b/.test(invalidErrorText) &&
          /\bpassword\b|\busername\b|\bemail\b|\bcredential\b|\blog in\b|\bsign in\b|\baccess key\b|\baccount id\b|\buser id\b|\blogin id\b/.test(
            invalidErrorText
          );
        const invalidPasswordErrorDetected =
          /\binvalid\b|\bincorrect\b|\bwrong\b|\btry again\b/.test(invalidErrorText) &&
          /\bpassword\b/.test(invalidErrorText);
        const invalidOtpErrorDetected =
          /\binvalid\b|\bincorrect\b|\bwrong\b|\bexpired\b|\btry again\b|\bfailed\b/.test(invalidErrorText) &&
          /\bcode\b|\botp\b|\bverification\b|\b2fa\b|\btwo-factor\b/.test(invalidErrorText);

        const hasCredentialPair = passwordFieldDetected && (identifierFieldDetected || usernameFieldDetected);
        const hasSingleStepPasswordGate =
          passwordFieldDetected &&
          (authIntentDetected || submitControlDetected || authSubmitKeywordHit);
        const hasUsernameAuthStep =
          !passwordFieldDetected &&
          (identifierFieldDetected || usernameFieldDetected) &&
          (authIntentDetected || authSubmitKeywordHit || submitControlDetected);

        let loginWallStrength = "none";
        let authClassificationReason = "No strong authentication wall detected.";
        if (otpChallengeDetected) {
          loginWallStrength = "strong";
          authClassificationReason = "OTP challenge detected.";
        } else if (captchaDetected) {
          loginWallStrength = "strong";
          authClassificationReason = "CAPTCHA challenge detected.";
        } else if (hasCredentialPair) {
          loginWallStrength = "strong";
          authClassificationReason = "Identifier and password fields are visible in an auth form.";
        } else if (hasSingleStepPasswordGate) {
          loginWallStrength = "strong";
          authClassificationReason = "Password step is visible in an auth context.";
        } else if (hasUsernameAuthStep) {
          loginWallStrength = "medium";
          authClassificationReason = "Identifier step is visible with explicit auth intent.";
        } else if ((identifierFieldDetected || usernameFieldDetected) && !authIntentDetected) {
          loginWallStrength = "weak";
          authClassificationReason = "Identifier-like field detected without strong auth-wall context.";
        } else if (
          authIntentDetected &&
          submitControlDetected &&
          (identifierFieldDetected || usernameFieldDetected || passwordFieldDetected || otpFieldDetected)
        ) {
          loginWallStrength = "medium";
          authClassificationReason = "Auth intent and submit controls are visible with credential field evidence.";
        } else if (authIntentDetected && submitControlDetected) {
          loginWallStrength = "weak";
          authClassificationReason = "Auth-like controls are visible, but credential fields are not confirmed.";
        }
        const loginWallDetected = loginWallStrength === "strong" || loginWallStrength === "medium";

        const profileMarkerVisible = hasActionableSelector(
          [
            "button[aria-label*='account' i]",
            "a[href*='account' i]",
            "a[href*='profile' i]",
            "img[alt*='avatar' i]",
            "a[href*='logout' i]",
            "button[aria-label*='logout' i]"
          ].join(",")
        );
        const authenticatedSignalStrength =
          profileMarkerVisible
            ? "strong"
            : (
                !loginWallDetected &&
                !otpChallengeDetected &&
                !captchaDetected &&
                !invalidCredentialErrorDetected &&
                !/\blogin\b|\bsign-?in\b|\bauth\b/.test(path)
              )
                ? "medium"
                : "weak";
        const authenticatedHint =
          authenticatedSignalStrength === "strong" || authenticatedSignalStrength === "medium";

        const hasCredentialFieldEvidence = Boolean(
          identifierFieldDetected ||
          usernameFieldDetected ||
          passwordFieldDetected ||
          otpFieldDetected
        );

        let visibleStep = "unknown";
        if (otpFieldDetected || otpChallengeDetected) {
          visibleStep = "otp";
        } else if ((usernameFieldDetected || identifierFieldDetected) && passwordFieldDetected) {
          visibleStep = "credentials";
        } else if (passwordFieldDetected) {
          visibleStep = "password";
        } else if ((usernameFieldDetected || identifierFieldDetected) && loginWallDetected) {
          visibleStep = "username";
        } else if (authenticatedHint) {
          visibleStep = "authenticated";
        } else if (loginWallDetected && hasCredentialFieldEvidence) {
          visibleStep = "credentials";
        }

        let nextRecommendedAction = "WAIT_FOR_LOGIN";
        if (visibleStep === "username") {
          nextRecommendedAction = "ENTER_USERNAME";
        } else if (visibleStep === "password") {
          nextRecommendedAction = "ENTER_PASSWORD";
        } else if (visibleStep === "credentials") {
          nextRecommendedAction = "ENTER_CREDENTIALS";
        } else if (visibleStep === "otp") {
          nextRecommendedAction = "ENTER_OTP";
        } else if (visibleStep === "authenticated") {
          nextRecommendedAction = "RESUME_FLOW";
        }

        let reason = authClassificationReason;
        if (captchaDetected) {
          reason = "CAPTCHA challenge detected.";
        } else if (otpChallengeDetected) {
          reason = "OTP challenge detected.";
        } else if (invalidCredentialErrorDetected) {
          reason = "Authentication form shows an invalid credential error.";
        } else if (visibleStep === "password") {
          reason = "Password step is visible.";
        } else if (visibleStep === "username") {
          reason = "Username/email step is visible.";
        } else if (hasCredentialPair) {
          reason = "Identifier and password fields are visible on the same step.";
        } else if (visibleStep === "credentials") {
          reason = authClassificationReason || "Login credentials are required.";
        } else if (authenticatedHint) {
          reason = "Authenticated markers are visible.";
        }

        return {
          pageUrl,
          site: (() => {
            try {
              return new URL(pageUrl).hostname;
            } catch {
              return "";
            }
          })(),
          loginWallDetected,
          otpChallengeDetected,
          captchaDetected,
          usernameFieldDetected,
          identifierFieldDetected,
          passwordFieldDetected,
          otpFieldDetected,
          submitControlDetected,
          authIntentDetected,
          loginWallStrength,
          authenticatedSignalStrength,
          authClassificationReason,
          usernameFieldPresentCount,
          usernameFieldVisibleCount,
          identifierFieldPresentCount,
          identifierFieldVisibleCount,
          identifierLabelCandidates,
          passwordFieldPresentCount,
          passwordFieldVisibleCount,
          otpFieldPresentCount,
          otpFieldVisibleCount,
          visibleStep,
          invalidCredentialErrorDetected,
          invalidPasswordErrorDetected,
          invalidOtpErrorDetected,
          invalidCredentialReason: invalidCredentialErrorDetected ? reason : null,
          authenticatedHint,
          nextRecommendedAction,
          reason
        };
      }, {
        identifierHintPatternSource: USERNAME_HINT_PATTERN_SOURCE,
        searchHintPatternSource: SEARCH_HINT_PATTERN_SOURCE,
        otpHintPatternSource: OTP_HINT_PATTERN_SOURCE,
        usernameSelector: USERNAME_SELECTOR,
        passwordSelector: PASSWORD_SELECTOR,
        otpSelector: OTP_SELECTOR,
        submitSelector: SUBMIT_SELECTOR,
        authFieldQuerySelector: AUTH_FIELD_QUERY_SELECTOR,
        authControlQuerySelector: AUTH_CONTROL_QUERY_SELECTOR
      })
      .catch(() => this.buildAuthProbeFallback("Unable to inspect authentication state."));

    const interactionContext = await this.collectAuthInteractionContext().catch(() => ({
      pageUrl: baseProbe?.pageUrl ?? this.page?.url?.() ?? "",
      stepHint: baseProbe?.visibleStep ?? "unknown",
      fields: [],
      controls: []
    }));
    const contextFields = Array.isArray(interactionContext?.fields)
      ? interactionContext.fields
      : [];
    const contextControls = Array.isArray(interactionContext?.controls)
      ? interactionContext.controls
      : [];
    const catalogWithSelectors = deriveAuthInputFieldsFromContext(contextFields, {
      includeSelectors: true
    });
    const visibleInputFields = catalogWithSelectors.map((field) => ({
      key: field.key,
      label: field.label,
      placeholder: field.placeholder,
      kind: field.kind,
      secret: field.secret,
      required: field.required,
      position: field.position
    }));
    const activeFormSelector =
      catalogWithSelectors.find((field) => field.kind === "password" && field.formSelector)?.formSelector ??
      catalogWithSelectors.find((field) => !field.secret && field.formSelector)?.formSelector ??
      null;
    const submitAction = deriveAuthSubmitActionFromControls(contextControls, {
      activeFormSelector
    });

    return {
      ...baseProbe,
      inputFields: visibleInputFields,
      submitAction
    };
  }

  buildAuthProbeFallback(reason = "Unable to inspect authentication state.") {
    return {
      pageUrl: this.page?.url?.() ?? "",
      site: (() => {
        try {
          return new URL(this.page?.url?.() ?? "").hostname;
        } catch {
          return "";
        }
      })(),
      loginWallDetected: false,
      loginWallStrength: "none",
      authenticatedSignalStrength: "weak",
      authClassificationReason: reason,
      otpChallengeDetected: false,
      captchaDetected: false,
      usernameFieldDetected: false,
      identifierFieldDetected: false,
      passwordFieldDetected: false,
      otpFieldDetected: false,
      submitControlDetected: false,
      authIntentDetected: false,
      usernameFieldPresentCount: 0,
      usernameFieldVisibleCount: 0,
      identifierFieldPresentCount: 0,
      identifierFieldVisibleCount: 0,
      identifierLabelCandidates: [],
      passwordFieldPresentCount: 0,
      passwordFieldVisibleCount: 0,
      otpFieldPresentCount: 0,
      otpFieldVisibleCount: 0,
      visibleStep: "unknown",
      invalidCredentialErrorDetected: false,
      invalidPasswordErrorDetected: false,
      invalidOtpErrorDetected: false,
      invalidCredentialReason: null,
      authenticatedHint: false,
      nextRecommendedAction: "WAIT_FOR_LOGIN",
      inputFields: [],
      submitAction: null,
      reason
    };
  }

  async collectAuthInteractionContext() {
    if (!this.page) {
      return {
        pageUrl: "",
        stepHint: "unknown",
        fields: [],
        controls: []
      };
    }

    return this.page
      .evaluate((shared) => {
        const markerAttribute = "data-sentinel-auth-marker";
        let markerCounter = 0;
        const identifierHintPattern = new RegExp(shared.identifierHintPatternSource, "i");
        const searchHintPattern = new RegExp(shared.searchHintPatternSource, "i");
        const otpHintPattern = new RegExp(shared.otpHintPatternSource, "i");
        const submitControlPattern = new RegExp(shared.submitControlPatternSource, "i");

        function normalize(value = "") {
          return String(value ?? "").replace(/\s+/g, " ").trim();
        }

        function toLower(value = "") {
          return normalize(value).toLowerCase();
        }

        function escapeSelectorValue(value = "") {
          if (typeof window.CSS?.escape === "function") {
            return window.CSS.escape(String(value));
          }
          return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\]^`{|}~\\])/g, "\\$1");
        }

        function elementWithinViewport(rect) {
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          return !(rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth);
        }

        function isActionable(element, { editable = false } = {}) {
          if (!element || !(element instanceof HTMLElement)) {
            return false;
          }
          if (element.hasAttribute("hidden") || element.closest("[hidden]")) {
            return false;
          }
          if (element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true']")) {
            return false;
          }
          if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
            return false;
          }
          if (
            editable &&
            ("readOnly" in element || element.getAttribute("aria-readonly")) &&
            (element.readOnly || element.getAttribute("aria-readonly") === "true")
          ) {
            return false;
          }

          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.pointerEvents === "none" ||
            Number.parseFloat(style.opacity || "1") <= 0.05 ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            !elementWithinViewport(rect)
          ) {
            return false;
          }

          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          const centerX = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(viewportWidth - 1, 0));
          const centerY = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(viewportHeight - 1, 0));
          const topElement = document.elementFromPoint(centerX, centerY);
          if (!topElement) {
            return true;
          }
          return topElement === element || element.contains(topElement) || topElement.contains(element);
        }

        function assignMarker(element) {
          const existing = element.getAttribute(markerAttribute);
          if (existing) {
            return existing;
          }
          const next = `m${markerCounter += 1}`;
          element.setAttribute(markerAttribute, next);
          return next;
        }

        function buildFallbackSelector(element) {
          if (!element || !(element instanceof HTMLElement)) {
            return null;
          }
          const tag = element.tagName.toLowerCase();
          const id = normalize(element.getAttribute("id"));
          if (id) {
            return `#${escapeSelectorValue(id)}`;
          }
          const name = normalize(element.getAttribute("name"));
          const type = normalize(element.getAttribute("type"));
          const dataTestId = normalize(element.getAttribute("data-testid") || element.getAttribute("data-test-id"));
          if (dataTestId) {
            return `${tag}[data-testid="${escapeSelectorValue(dataTestId)}"]`;
          }
          if (name && type) {
            return `${tag}[name="${escapeSelectorValue(name)}"][type="${escapeSelectorValue(type)}"]`;
          }
          if (name) {
            return `${tag}[name="${escapeSelectorValue(name)}"]`;
          }
          if (type) {
            return `${tag}[type="${escapeSelectorValue(type)}"]`;
          }
          return tag;
        }

        function selectorSet(element) {
          const marker = assignMarker(element);
          return {
            primarySelector: `[${markerAttribute}="${escapeSelectorValue(marker)}"]`,
            fallbackSelector: buildFallbackSelector(element)
          };
        }

        function labelForField(field) {
          const labels = [];
          if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
            if (field.labels) {
              for (const label of field.labels) {
                labels.push(label?.textContent || "");
              }
            }
          }
          const parentLabel = field.closest("label");
          if (parentLabel) {
            labels.push(parentLabel.textContent || "");
          }
          return normalize(labels.join(" "));
        }

        function labelForControl(element) {
          return normalize(
            element.textContent ||
              element.getAttribute("aria-label") ||
              element.getAttribute("value") ||
              element.getAttribute("title") ||
              ""
          );
        }

        function formSelector(element) {
          const nearestForm = element.closest("form");
          if (!nearestForm) {
            return null;
          }
          return selectorSet(nearestForm).primarySelector;
        }

        function fieldHaystack(field = {}) {
          return toLower(
            [
              field?.label,
              field?.ariaLabel,
              field?.placeholder,
              field?.name,
              field?.id,
              field?.autocomplete,
              field?.inputType
            ].join(" ")
          );
        }

        function isLikelyIdentifierField(field = {}) {
          if (!field?.actionable) {
            return false;
          }
          const haystack = fieldHaystack(field);
          const inputType = toLower(field?.inputType);
          if (inputType === "password") {
            return false;
          }
          if (otpHintPattern.test(haystack) || toLower(field?.autocomplete).includes("one-time-code")) {
            return false;
          }
          if (identifierHintPattern.test(haystack)) {
            return true;
          }
          if (inputType === "email") {
            return true;
          }
          if (searchHintPattern.test(haystack) && !field?.sameFormHasPassword) {
            return false;
          }
          if (
            field?.sameFormHasPassword &&
            ["text", "", "tel", "number", "search", "url", "textarea"].includes(inputType)
          ) {
            return true;
          }
          return false;
        }

        const fieldNodes = Array.from(
          document.querySelectorAll(shared.authFieldQuerySelector || "input, textarea")
        );
        const fields = fieldNodes.map((field) => {
          const rect = field.getBoundingClientRect();
          const selectors = selectorSet(field);
          const inputType = toLower(field.getAttribute("type") || (field instanceof HTMLTextAreaElement ? "textarea" : "text"));
          const autocomplete = toLower(field.getAttribute("autocomplete"));
          const descriptor = {
            ...selectors,
            label: labelForField(field),
            ariaLabel: normalize(field.getAttribute("aria-label")),
            placeholder: normalize(field.getAttribute("placeholder")),
            name: normalize(field.getAttribute("name")),
            id: normalize(field.getAttribute("id")),
            autocomplete,
            inputType,
            type: inputType,
            actionable: isActionable(field, { editable: true }),
            visible: isActionable(field),
            enabled: !field.matches(":disabled") && field.getAttribute("aria-disabled") !== "true",
            readOnly: field.readOnly || field.getAttribute("aria-readonly") === "true",
            inViewport: elementWithinViewport(rect),
            formSelector: formSelector(field),
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          };
          return descriptor;
        });

        const controlNodes = Array.from(
          document.querySelectorAll(
            shared.authControlQuerySelector ||
              [
                "button",
                "input[type='submit']",
                "input[type='button']",
                "[role='button']",
                "a[role='button']",
                "a[href]",
                "div[role='button']",
                "span[role='button']",
                "div[onclick]",
                "span[onclick]",
                "[tabindex]"
              ].join(",")
          )
        );
        const controls = controlNodes.map((control) => {
          const rect = control.getBoundingClientRect();
          const selectors = selectorSet(control);
          const tag = toLower(control.tagName);
          const role = toLower(control.getAttribute("role"));
          const type = toLower(control.getAttribute("type"));
          const label = labelForControl(control);
          const descriptor = {
            ...selectors,
            label,
            tag,
            role,
            type,
            actionable: isActionable(control),
            visible: isActionable(control),
            enabled: !control.matches(":disabled") && control.getAttribute("aria-disabled") !== "true",
            inViewport: elementWithinViewport(rect),
            isSubmitLike:
              type === "submit" ||
              submitControlPattern.test(label),
            formSelector: formSelector(control),
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          };
          return descriptor;
        });

        const submitLikeForms = new Set(
          controls
            .filter((control) => control.isSubmitLike)
            .map((control) => control.formSelector)
            .filter(Boolean)
        );
        const passwordForms = new Set(
          fields
            .filter((field) => field.inputType === "password")
            .map((field) => field.formSelector)
            .filter(Boolean)
        );
        const enrichedFields = fields.map((field) => ({
          ...field,
          sameFormHasPassword: Boolean(field.formSelector && passwordForms.has(field.formSelector)),
          sameFormHasSubmitControl: Boolean(field.formSelector && submitLikeForms.has(field.formSelector))
        }));

        const hasVisibleOtpField = enrichedFields.some(
          (field) =>
            field.actionable &&
            otpHintPattern.test(
              [field.label, field.ariaLabel, field.placeholder, field.name, field.id, field.autocomplete].join(" ")
            )
        );
        const hasVisiblePasswordField = enrichedFields.some((field) => field.actionable && field.inputType === "password");
        const identifierVisibleFields = enrichedFields.filter((field) => isLikelyIdentifierField(field));
        const hasVisibleUsernameField = identifierVisibleFields.length > 0;
        const identifierLabelCandidates = Array.from(
          new Set(
            identifierVisibleFields
              .map((field) => normalize(field.label || field.ariaLabel || field.placeholder || field.name || field.id || ""))
              .filter(Boolean)
              .slice(0, 5)
          )
        );

        let stepHint = "unknown";
        if (hasVisibleOtpField) {
          stepHint = "otp";
        } else if (hasVisibleUsernameField && hasVisiblePasswordField) {
          stepHint = "credentials";
        } else if (hasVisiblePasswordField) {
          stepHint = "password";
        } else if (hasVisibleUsernameField) {
          stepHint = "username";
        }

        return {
          pageUrl: window.location.href,
          stepHint,
          fields: enrichedFields,
          controls,
          identifierFieldDetected: hasVisibleUsernameField,
          usernameFieldDetected: hasVisibleUsernameField,
          passwordFieldDetected: hasVisiblePasswordField,
          submitControlDetected: controls.some((control) => control.actionable && control.isSubmitLike),
          identifierFieldVisibleCount: identifierVisibleFields.length,
          usernameFieldVisibleCount: identifierVisibleFields.length,
          passwordFieldVisibleCount: enrichedFields.filter(
            (field) => field.actionable && field.inputType === "password"
          ).length,
          identifierLabelCandidates
        };
      }, {
        identifierHintPatternSource: USERNAME_HINT_PATTERN_SOURCE,
        searchHintPatternSource: SEARCH_HINT_PATTERN_SOURCE,
        otpHintPatternSource: OTP_HINT_PATTERN_SOURCE,
        submitControlPatternSource: SUBMIT_CONTROL_PATTERN_SOURCE,
        authFieldQuerySelector: AUTH_FIELD_QUERY_SELECTOR,
        authControlQuerySelector: AUTH_CONTROL_QUERY_SELECTOR
      })
      .catch(() => ({
        pageUrl: this.page?.url?.() ?? "",
        stepHint: "unknown",
        fields: [],
        controls: [],
        identifierFieldDetected: false,
        usernameFieldDetected: false,
        passwordFieldDetected: false,
        submitControlDetected: false,
        identifierFieldVisibleCount: 0,
        usernameFieldVisibleCount: 0,
        passwordFieldVisibleCount: 0,
        identifierLabelCandidates: []
      }));
  }

  async executeCredentialActionPlan({ plan, usernameValue, passwordValue }) {
    if (!this.page) {
      return {
        ok: false,
        code: "NO_ACTIVE_PAGE",
        reason: "No active browser page is available.",
        usernameFilled: false,
        passwordFilled: false,
        submitTriggered: false,
        submitControlDetected: false,
        selectedControlLabel: null,
        explicitInvalidCredentialErrorDetected: false
      };
    }

    return this.page
      .evaluate(({ actionPlan, userValue, passValue, shared }) => {
        function normalize(value = "") {
          return String(value ?? "").replace(/\s+/g, " ").trim();
        }

        const identifierHintPattern = new RegExp(
          shared?.identifierHintPatternSource || "",
          "i"
        );
        const submitControlPattern = new RegExp(
          shared?.submitControlPatternSource || "",
          "i"
        );

        function isActionable(element, { editable = false } = {}) {
          if (!element || !(element instanceof HTMLElement)) {
            return false;
          }
          if (element.hasAttribute("hidden") || element.closest("[hidden]")) {
            return false;
          }
          if (element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true']")) {
            return false;
          }
          if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
            return false;
          }
          if (
            editable &&
            ("readOnly" in element || element.getAttribute("aria-readonly")) &&
            (element.readOnly || element.getAttribute("aria-readonly") === "true")
          ) {
            return false;
          }

          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.pointerEvents === "none" ||
            Number.parseFloat(style.opacity || "1") <= 0.05 ||
            rect.width <= 0 ||
            rect.height <= 0
          ) {
            return false;
          }
          return true;
        }

        function findFirst(selectors = [], { editable = false } = {}) {
          for (const selector of selectors) {
            if (!selector) {
              continue;
            }
            try {
              const candidates = Array.from(document.querySelectorAll(selector));
              if (candidates.length === 0) {
                continue;
              }
              const actionable = candidates.find((candidate) => isActionable(candidate, { editable }));
              if (actionable) {
                return actionable;
              }
            } catch {
              // Ignore invalid selectors and continue fallback resolution.
            }
          }
          return null;
        }

        function findFallbackIdentifierField(preferredForm = null) {
          const candidates = Array.from(
            document.querySelectorAll(
              [
                "input[autocomplete='username']",
                "input[type='email']",
                "input[type='text']",
                "input[type='tel']",
                "input[type='number']",
                "input[type='search']",
                "input:not([type])",
                "textarea"
              ].join(",")
            )
          );
          const keywordPattern = identifierHintPattern;
          let preferredFormCandidate = null;
          let hintedCandidate = null;
          let firstActionable = null;
          for (const field of candidates) {
            if (!isActionable(field, { editable: true })) {
              continue;
            }
            const type = normalize(field.getAttribute("type")).toLowerCase();
            if (type === "password" || type === "hidden") {
              continue;
            }
            if (!firstActionable) {
              firstActionable = field;
            }
            const haystack = normalize(
              [
                field.getAttribute("aria-label"),
                field.getAttribute("placeholder"),
                field.getAttribute("name"),
                field.getAttribute("id"),
                field.closest("label")?.textContent,
                Array.from(field.labels ?? [])
                  .map((label) => label.textContent)
                  .join(" ")
              ].join(" ")
            );
            const form = field.form ?? field.closest("form");
            const hintMatch = keywordPattern.test(haystack);
            const samePreferredForm = Boolean(preferredForm && form && preferredForm === form);
            if (samePreferredForm && hintMatch) {
              return field;
            }
            if (!hintedCandidate && hintMatch) {
              hintedCandidate = field;
            }
            if (!preferredFormCandidate && samePreferredForm) {
              preferredFormCandidate = field;
            }
          }
          if (preferredForm) {
            // Do not leak into unrelated forms when we already know which auth form to target.
            return preferredFormCandidate;
          }
          return hintedCandidate ?? firstActionable;
        }

        function findFallbackPasswordField(preferredForm = null) {
          const candidates = Array.from(document.querySelectorAll("input[type='password']"));
          for (const field of candidates) {
            if (!isActionable(field, { editable: true })) {
              continue;
            }
            const form = field.form ?? field.closest("form");
            if (preferredForm && form && preferredForm !== form) {
              continue;
            }
            return field;
          }
          return candidates.find((field) => isActionable(field, { editable: true })) ?? null;
        }

        function findFallbackSubmitControl(preferredForm = null) {
          const candidates = Array.from(
            document.querySelectorAll(
              [
                "button[type='submit']",
                "input[type='submit']",
                "button",
                "input[type='button']",
                "[role='button']",
                "a[role='button']",
                "a[href]",
                "div[role='button']",
                "span[role='button']",
                "div[onclick]",
                "span[onclick]"
              ].join(",")
            )
          );
          const keywordPattern = submitControlPattern;
          if (preferredForm) {
            let preferredSubmitLike = null;
            let preferredAny = null;
            for (const control of candidates) {
              if (!isActionable(control)) {
                continue;
              }
              const form = control.closest("form");
              if (form !== preferredForm) {
                continue;
              }
              const label = normalize(
                control.textContent ||
                control.getAttribute("aria-label") ||
                control.getAttribute("value") ||
                control.getAttribute("title") ||
                ""
              );
              const type = normalize(control.getAttribute("type")).toLowerCase();
              const submitLike = type === "submit" || keywordPattern.test(label);
              if (submitLike) {
                preferredSubmitLike = preferredSubmitLike ?? control;
              }
              preferredAny = preferredAny ?? control;
            }
            if (preferredSubmitLike || preferredAny) {
              return preferredSubmitLike ?? preferredAny;
            }
          }

          for (const control of candidates) {
            if (!isActionable(control)) {
              continue;
            }
            const label = normalize(
              control.textContent ||
              control.getAttribute("aria-label") ||
              control.getAttribute("value") ||
              control.getAttribute("title") ||
              ""
            );
            const type = normalize(control.getAttribute("type")).toLowerCase();
            if (keywordPattern.test(label) || type === "submit") {
              return control;
            }
          }
          // Avoid clicking arbitrary non-auth controls as a fallback no-op.
          return null;
        }

        function fillField(field, value) {
          if (!field || !isActionable(field, { editable: true })) {
            return false;
          }
          const typedValue = String(value ?? "");
          field.focus();
          if ("value" in field) {
            try {
              if (field instanceof HTMLInputElement) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                if (typeof setter === "function") {
                  setter.call(field, "");
                  setter.call(field, typedValue);
                } else {
                  field.value = "";
                  field.value = typedValue;
                }
              } else if (field instanceof HTMLTextAreaElement) {
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
                if (typeof setter === "function") {
                  setter.call(field, "");
                  setter.call(field, typedValue);
                } else {
                  field.value = "";
                  field.value = typedValue;
                }
              } else {
                field.value = "";
                field.value = typedValue;
              }
            } catch {
              field.value = "";
              field.value = typedValue;
            }
          }
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }

        function labelFor(element) {
          return normalize(
            element?.textContent ||
              element?.getAttribute("aria-label") ||
              element?.getAttribute("value") ||
              element?.getAttribute("title") ||
              ""
          );
        }

        function clickControl(control) {
          if (!control || !isActionable(control)) {
            return false;
          }
          control.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
          control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          control.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, view: window }));
          control.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          control.click();
          return true;
        }

        function submitViaField(field) {
          if (!field) {
            return false;
          }
          const form = field.form ?? field.closest("form");
          if (!form) {
            return false;
          }
          try {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit();
            } else {
              form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            }
            return true;
          } catch {
            return false;
          }
        }

        let usernameField = findFirst([
          actionPlan.usernameFieldSelector,
          actionPlan.usernameFallbackSelector
        ], { editable: true });
        let passwordField = findFirst([
          actionPlan.passwordFieldSelector,
          actionPlan.passwordFallbackSelector
        ], { editable: true });
        let submitControl = findFirst([
          actionPlan.submitControlSelector,
          actionPlan.submitControlFallbackSelector
        ]);

        const preferredForm = passwordField?.form ?? passwordField?.closest?.("form") ?? usernameField?.form ?? usernameField?.closest?.("form") ?? null;
        if (actionPlan.fillUsername && !usernameField) {
          usernameField = findFallbackIdentifierField(preferredForm);
        }
        if (actionPlan.fillPassword && !passwordField) {
          passwordField = findFallbackPasswordField(preferredForm);
        }
        if (!submitControl) {
          submitControl = findFallbackSubmitControl(preferredForm);
        }

        const usernameFilled = actionPlan.fillUsername ? fillField(usernameField, userValue) : false;
        const passwordFilled = actionPlan.fillPassword ? fillField(passwordField, passValue) : false;

        if (!usernameFilled && !passwordFilled) {
          const firstFieldMissing = actionPlan.fillUsername && !usernameField;
          const passwordFieldMissing = actionPlan.fillPassword && !passwordField;
          let code = "AUTH_FILL_BLOCKED";
          let reason = "Detected authentication fields could not be filled for this step.";
          if (firstFieldMissing && passwordFieldMissing) {
            code = "AUTH_FIELDS_MISSING";
            reason = "No actionable first-credential or password field was found.";
          } else if (firstFieldMissing) {
            code = "AUTH_FIRST_FIELD_NOT_FOUND";
            reason = "No actionable first-credential field was found.";
          } else if (passwordFieldMissing) {
            code = "AUTH_PASSWORD_FIELD_MISSING";
            reason = "No actionable password field was found.";
          } else if (!actionPlan.fillUsername && !actionPlan.fillPassword) {
            code = "AUTH_STEP_NOT_ACTIONABLE";
            reason = "No visible actionable authentication fields were found for the current step.";
          }
          return {
            ok: false,
            code,
            reason,
            usernameFilled: false,
            passwordFilled: false,
            identifierFilled: false,
            submitTriggered: false,
            submitControlType: "none",
            submitControlDetected: Boolean(submitControl),
            selectedControlLabel: null,
            explicitInvalidCredentialErrorDetected: false
          };
        }

        let submitTriggered = false;
        let selectedControlLabel = null;
        let submitControlType = "none";
        const activeField = passwordFilled ? passwordField : usernameField;

        if (submitControl && clickControl(submitControl)) {
          submitTriggered = true;
          selectedControlLabel = labelFor(submitControl) || actionPlan.submitControlLabel || null;
          submitControlType = "control-click";
        }

        if (!submitTriggered && submitViaField(activeField)) {
          submitTriggered = true;
          selectedControlLabel = "form-submit";
          submitControlType = "form-submit";
        }

        if (!submitTriggered && activeField) {
          activeField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
          activeField.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
          submitTriggered = true;
          selectedControlLabel = "keyboard-enter";
          submitControlType = "keyboard-enter";
        }

        const explicitInvalidCredentialErrorDetected = Array.from(
          document.querySelectorAll(
            [
              "[role='alert']",
              "[aria-live='assertive']",
              ".error",
              ".invalid-feedback",
              "[data-error]",
              "[class*='error' i]",
              "[aria-invalid='true']"
            ].join(",")
          )
        )
          .filter((element) => isActionable(element))
          .map((element) => labelFor(element).toLowerCase())
          .some(
            (text) =>
              /\b(invalid|incorrect|wrong|does not match|failed|try again)\b/.test(text) &&
              /\b(password|username|email|credential|sign in|log in|access key|account id|user id|login id)\b/.test(
                text
              )
          );

        return {
          ok: submitTriggered,
          code: submitTriggered
            ? "CREDENTIALS_SUBMITTED"
            : submitControl
              ? "AUTH_SUBMIT_BLOCKED"
              : "AUTH_SUBMIT_CONTROL_MISSING",
          reason: submitTriggered
            ? "Credentials were entered and submission was triggered."
            : submitControl
              ? "Credentials were entered, but submit could not be triggered from the detected control or form."
              : "Credentials were entered, but no actionable submit control was found.",
          usernameFilled,
          passwordFilled,
          identifierFilled: usernameFilled,
          submitTriggered,
          submitControlType,
          submitControlDetected: Boolean(submitControl),
          selectedControlLabel,
          explicitInvalidCredentialErrorDetected
        };
      }, {
        actionPlan: plan ?? {},
        userValue: String(usernameValue ?? ""),
        passValue: String(passwordValue ?? ""),
        shared: {
          identifierHintPatternSource: USERNAME_HINT_PATTERN_SOURCE,
          submitControlPatternSource: SUBMIT_CONTROL_PATTERN_SOURCE
        }
      })
      .catch(() => ({
        ok: false,
        code: "SUBMISSION_FAILED",
        reason: "Credential submission failed while interacting with the page.",
        usernameFilled: false,
        passwordFilled: false,
        identifierFilled: false,
        submitTriggered: false,
        submitControlType: "none",
        submitControlDetected: false,
        selectedControlLabel: null,
        explicitInvalidCredentialErrorDetected: false
      }));
  }

  async settleAfterAuthSubmission() {
    await this.page?.waitForLoadState("domcontentloaded", { timeout: 1_500 }).catch(() => {});
    await this.page?.waitForTimeout(320).catch(() => {});
    await this.waitForUIReady(
      this.runConfig?.readiness?.uiReadyStrategy,
      this.runConfig?.readiness?.readyTimeoutMs
    ).catch(() => {});
  }

  async waitForAuthTransition({ previousProbe, submission, timeoutMs = 4_500, pollMs = 280 }) {
    let probe = await this.collectAuthFormProbe();
    const submissionContext = {
      submitTriggered: Boolean(submission?.submitTriggered)
    };
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const progression = detectAuthStepAdvance(previousProbe ?? {}, probe, submissionContext);
      if (
        progression.advanced ||
        probe.authenticatedHint ||
        probe.otpChallengeDetected ||
        probe.otpFieldDetected ||
        probe.invalidCredentialErrorDetected ||
        probe.invalidPasswordErrorDetected ||
        probe.invalidOtpErrorDetected
      ) {
        return probe;
      }

      await this.page?.waitForTimeout(pollMs).catch(() => {});
      await this.waitForUIReady(
        this.runConfig?.readiness?.uiReadyStrategy,
        this.runConfig?.readiness?.readyTimeoutMs
      ).catch(() => {});
      probe = await this.collectAuthFormProbe();
    }

    return probe;
  }

  async confirmAuthenticatedSession({
    resumeTargetUrl = "",
    timeoutMs = 9_000,
    pollMs = 320
  } = {}) {
    if (!this.page) {
      return {
        state: "auth_unknown_state",
        code: "NO_ACTIVE_PAGE",
        reason: "No active browser page is available.",
        probe: this.buildAuthProbeFallback("No active page is available.")
      };
    }

    const likelyAuthUrl = (url = "") => /\/(login|sign[-_]?in|auth|verify|otp|two[-_]?factor)\b/i.test(String(url));
    const canNavigateToResumeTarget =
      typeof resumeTargetUrl === "string" &&
      resumeTargetUrl.trim().length > 0 &&
      /^https?:/i.test(resumeTargetUrl) &&
      !likelyAuthUrl(resumeTargetUrl) &&
      this.safetyAllowsDomain(resumeTargetUrl);

    let attemptedResumeTarget = false;
    let previousProbe = await this.collectAuthFormProbe();
    let probe = previousProbe;
    const startedAt = Date.now();
    const boundedTimeoutMs = Math.min(Math.max(Number(timeoutMs) || 9_000, 1_000), 20_000);
    const boundedPollMs = Math.min(Math.max(Number(pollMs) || 320, 180), 900);

    while (Date.now() - startedAt < boundedTimeoutMs) {
      const visibleStep = inferAuthVisibleStep(probe);
      const explicitInvalid = Boolean(
        probe.invalidCredentialErrorDetected || probe.invalidPasswordErrorDetected
      );
      if (probe.captchaDetected) {
        return {
          state: "auth_failed",
          code: "CAPTCHA_BOT_DETECTED",
          reason: "CAPTCHA challenge detected.",
          probe
        };
      }
      if (probe.otpChallengeDetected || probe.otpFieldDetected || visibleStep === "otp") {
        return {
          state: "awaiting_otp",
          code: "OTP_REQUIRED",
          reason: probe.reason || "OTP challenge detected.",
          probe
        };
      }
      if (explicitInvalid) {
        return {
          state: "invalid_credentials",
          code: "INVALID_CREDENTIALS",
          reason: probe.invalidCredentialReason || "Credentials were rejected by the authentication form.",
          probe
        };
      }

      const authenticatedByRuntime = await this.isAuthenticated();
      const loginWallStrength = String(probe?.loginWallStrength ?? "").trim().toLowerCase();
      const strongLoginWallVisible = ["strong", "medium"].includes(loginWallStrength)
        ? true
        : Boolean(
            probe.passwordFieldDetected ||
              (probe.loginWallDetected &&
                (
                  probe.passwordFieldDetected ||
                  probe.otpFieldDetected ||
                  probe.otpChallengeDetected ||
                  probe.submitControlDetected
                ))
          );
      if ((probe.authenticatedHint || authenticatedByRuntime) && !strongLoginWallVisible) {
        return {
          state: "authenticated",
          code: "AUTH_VALIDATED",
          reason: "Authentication signals are stable and login wall is no longer visible.",
          probe
        };
      }

      const progression = detectAuthStepAdvance(previousProbe, probe, {
        submitTriggered: true
      });
      if (progression.advanced) {
        if (visibleStep === "password") {
          return {
            state: "awaiting_password",
            code: "AUTH_STEP_ADVANCED",
            reason: "Username step completed; password input is now required.",
            probe
          };
        }
        if (visibleStep === "username") {
          return {
            state: "awaiting_username",
            code: "AUTH_STEP_ADVANCED",
            reason: "Authentication flow advanced and now requires username input.",
            probe
          };
        }
      }

      if (
        canNavigateToResumeTarget &&
        !attemptedResumeTarget &&
        (probe.authenticatedHint || authenticatedByRuntime)
      ) {
        attemptedResumeTarget = true;
        await this.goto(resumeTargetUrl).catch(() => {});
        previousProbe = probe;
        probe = await this.collectAuthFormProbe();
        continue;
      }

      await this.page.waitForTimeout(boundedPollMs).catch(() => {});
      await this.waitForUIReady(
        this.runConfig?.readiness?.uiReadyStrategy,
        this.runConfig?.readiness?.readyTimeoutMs
      ).catch(() => {});
      previousProbe = probe;
      probe = await this.collectAuthFormProbe();
    }

    const finalStep = inferAuthVisibleStep(probe);
    if (finalStep === "password") {
      return {
        state: "awaiting_password",
        code: "LOGIN_PASSWORD_REQUIRED",
        reason: probe.reason || "Password step is still visible.",
        probe
      };
    }
    if (finalStep === "username") {
      return {
        state: "awaiting_username",
        code: "LOGIN_USERNAME_REQUIRED",
        reason: probe.reason || "Username step is still visible.",
        probe
      };
    }
    if (finalStep === "credentials" || probe.loginWallDetected) {
      return {
        state: "awaiting_credentials",
        code: "LOGIN_REQUIRED",
        reason: probe.reason || "Login credentials are still required.",
        probe
      };
    }

    return {
      state: "auth_unknown_state",
      code: "AUTH_UNKNOWN_STATE",
      reason: probe.reason || "Authentication state remains inconclusive after bounded verification.",
      probe
    };
  }

  async submitAuthInputFields({ inputFields = {} } = {}) {
    if (!this.page) {
      return {
        success: false,
        code: "NO_ACTIVE_PAGE",
        reason: "No active browser page is available."
      };
    }

    const normalizedInputFields = normalizeSubmittedInputFieldValues(inputFields);
    if (Object.keys(normalizedInputFields).length === 0) {
      return {
        success: false,
        code: "INVALID_AUTH_INPUT_FIELDS",
        reason: "At least one input field value is required."
      };
    }

    await this.waitForUIReady(
      this.runConfig?.readiness?.uiReadyStrategy,
      this.runConfig?.readiness?.readyTimeoutMs
    ).catch(() => {});

    const previousProbe = await this.collectAuthFormProbe();
    const interactionContext = await this.collectAuthInteractionContext();
    const detectedFields = deriveAuthInputFieldsFromContext(interactionContext?.fields ?? [], {
      includeSelectors: true
    });

    if (!Array.isArray(detectedFields) || detectedFields.length === 0) {
      return {
        success: false,
        code: "AUTH_FIELDS_NOT_DETECTED",
        reason: "No actionable input fields were detected on the authentication page.",
        inputFieldsConsumed: false,
        fillExecutionAttempted: false,
        fillExecutionSucceeded: false,
        fieldTargetsResolvedCount: 0,
        fieldTargetsFilledCount: 0,
        fieldTargetsVerifiedCount: 0,
        focusedFieldKeys: [],
        submitTriggered: false,
        submitControlResolved: false,
        submitControlType: "none",
        selectedControlLabel: null,
        explicitInvalidCredentialErrorDetected: false,
        identifierFilled: false,
        usernameFilled: false,
        passwordFilled: false,
        browserActionExecuted: false,
        postSubmitUrlChanged: false,
        postSubmitUrl: previousProbe?.pageUrl ?? null,
        postSubmitProbeState: inferAuthVisibleStep(previousProbe),
        authenticated: false,
        probe: previousProbe,
        form: {
          identifierFieldDetected: Boolean(previousProbe?.identifierFieldDetected || previousProbe?.usernameFieldDetected),
          usernameFieldDetected: Boolean(previousProbe?.usernameFieldDetected || previousProbe?.identifierFieldDetected),
          passwordFieldDetected: Boolean(previousProbe?.passwordFieldDetected),
          otpFieldDetected: Boolean(previousProbe?.otpFieldDetected),
          submitControlDetected: Boolean(previousProbe?.submitControlDetected),
          visibleStep: previousProbe?.visibleStep ?? inferAuthVisibleStep(previousProbe),
          identifierFieldVisibleCount: Number(previousProbe?.identifierFieldVisibleCount ?? previousProbe?.usernameFieldVisibleCount ?? 0),
          identifierLabelCandidates: Array.isArray(previousProbe?.identifierLabelCandidates)
            ? previousProbe.identifierLabelCandidates.slice(0, 5)
            : [],
          usernameFieldVisibleCount: Number(previousProbe?.usernameFieldVisibleCount ?? 0),
          passwordFieldVisibleCount: Number(previousProbe?.passwordFieldVisibleCount ?? 0),
          inputFields: [],
          submitAction: null
        }
      };
    }

    const valueByKey = {};
    const submittedEntries = Object.entries(normalizedInputFields)
      .map(([key, value]) => [String(key ?? "").trim().toLowerCase(), String(value ?? "")])
      .filter(([key, value]) => key.length > 0 && value.length > 0);
    const consumedSubmittedKeys = new Set();

    const takeSubmittedValue = (predicate) => {
      for (const [key, value] of submittedEntries) {
        if (consumedSubmittedKeys.has(key)) {
          continue;
        }
        if (predicate(key, value)) {
          consumedSubmittedKeys.add(key);
          return value;
        }
      }
      return "";
    };

    const isPasswordLikeKey = (key = "") =>
      /\b(pass|password|pwd)\b/.test(String(key ?? "").toLowerCase());
    const isOtpLikeKey = (key = "") =>
      /\b(otp|code|verification|2fa|one_time)\b/.test(String(key ?? "").toLowerCase());
    const isFirstCredentialLikeKey = (key = "") =>
      /\b(user|username|email|identifier|login|account|access|member|tenant|workspace|organization|organisation|customer|portal|id|key)\b/.test(
        String(key ?? "").toLowerCase()
      );

    for (const field of detectedFields) {
      const key = String(field?.key ?? "").trim().toLowerCase();
      if (!key) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(normalizedInputFields, key)) {
        valueByKey[key] = normalizedInputFields[key];
        consumedSubmittedKeys.add(key);
      }
    }

    const firstNonSecretField = detectedFields.find((field) => !field.secret && field.kind !== "otp");
    const passwordField = detectedFields.find((field) => field.kind === "password");
    const otpField = detectedFields.find((field) => field.kind === "otp");

    if (firstNonSecretField && !valueByKey[firstNonSecretField.key]) {
      const firstCredentialAlias = resolveFirstCredentialAlias(normalizedInputFields);
      if (firstCredentialAlias) {
        valueByKey[firstNonSecretField.key] = firstCredentialAlias;
      } else {
        const fallbackFirstCredential = takeSubmittedValue((key) =>
          isFirstCredentialLikeKey(key) && !isPasswordLikeKey(key) && !isOtpLikeKey(key)
        );
        if (fallbackFirstCredential) {
          valueByKey[firstNonSecretField.key] = fallbackFirstCredential;
        }
      }
    }

    if (passwordField && !valueByKey[passwordField.key]) {
      if (normalizedInputFields.password) {
        valueByKey[passwordField.key] = normalizedInputFields.password;
        consumedSubmittedKeys.add("password");
      } else {
        const fallbackPassword = takeSubmittedValue((key) => isPasswordLikeKey(key));
        if (fallbackPassword) {
          valueByKey[passwordField.key] = fallbackPassword;
        }
      }
    }

    const otpAlias = normalizedInputFields.otp ?? normalizedInputFields.code ?? normalizedInputFields.verification_code;
    if (otpField && !valueByKey[otpField.key] && otpAlias) {
      valueByKey[otpField.key] = otpAlias;
      consumedSubmittedKeys.add("otp");
      consumedSubmittedKeys.add("code");
      consumedSubmittedKeys.add("verification_code");
    } else if (otpField && !valueByKey[otpField.key]) {
      const fallbackOtp = takeSubmittedValue((key) => isOtpLikeKey(key));
      if (fallbackOtp) {
        valueByKey[otpField.key] = fallbackOtp;
      }
    }

    for (const field of detectedFields) {
      if (Object.prototype.hasOwnProperty.call(valueByKey, field.key)) {
        continue;
      }
      const fallbackValue =
        field.kind === "password"
          ? takeSubmittedValue((key) => isPasswordLikeKey(key))
          : field.kind === "otp"
            ? takeSubmittedValue((key) => isOtpLikeKey(key))
            : takeSubmittedValue(
                (key) =>
                  (isFirstCredentialLikeKey(key) && !isPasswordLikeKey(key) && !isOtpLikeKey(key)) ||
                  (!isPasswordLikeKey(key) && !isOtpLikeKey(key))
              );
      if (fallbackValue) {
        valueByKey[field.key] = fallbackValue;
      }
    }

    const orderedEntries = detectedFields
      .filter((field) => Object.prototype.hasOwnProperty.call(valueByKey, field.key))
      .map((field) => ({
        key: field.key,
        label: field.label,
        placeholder: field.placeholder,
        kind: field.kind,
        secret: Boolean(field.secret),
        value: String(valueByKey[field.key] ?? ""),
        primarySelector: field.primarySelector ?? null,
        fallbackSelector: field.fallbackSelector ?? null,
        formSelector: field.formSelector ?? null
      }));

    if (orderedEntries.length === 0) {
      return {
        success: false,
        code: "AUTH_INPUT_FIELDS_UNMAPPED",
        reason: "Submitted input fields do not match currently detected login fields.",
        inputFieldsConsumed: false,
        fillExecutionAttempted: false,
        fillExecutionSucceeded: false,
        fieldTargetsResolvedCount: 0,
        fieldTargetsFilledCount: 0,
        fieldTargetsVerifiedCount: 0,
        focusedFieldKeys: [],
        submitTriggered: false,
        submitControlResolved: false,
        submitControlType: "none",
        selectedControlLabel: null,
        explicitInvalidCredentialErrorDetected: false,
        identifierFilled: false,
        usernameFilled: false,
        passwordFilled: false,
        browserActionExecuted: false,
        postSubmitUrlChanged: false,
        postSubmitUrl: previousProbe?.pageUrl ?? null,
        postSubmitProbeState: inferAuthVisibleStep(previousProbe),
        authenticated: false,
        probe: previousProbe,
        form: {
          identifierFieldDetected: Boolean(previousProbe?.identifierFieldDetected || previousProbe?.usernameFieldDetected),
          usernameFieldDetected: Boolean(previousProbe?.usernameFieldDetected || previousProbe?.identifierFieldDetected),
          passwordFieldDetected: Boolean(previousProbe?.passwordFieldDetected),
          otpFieldDetected: Boolean(previousProbe?.otpFieldDetected),
          submitControlDetected: Boolean(previousProbe?.submitControlDetected),
          visibleStep: previousProbe?.visibleStep ?? inferAuthVisibleStep(previousProbe),
          identifierFieldVisibleCount: Number(previousProbe?.identifierFieldVisibleCount ?? previousProbe?.usernameFieldVisibleCount ?? 0),
          identifierLabelCandidates: Array.isArray(previousProbe?.identifierLabelCandidates)
            ? previousProbe.identifierLabelCandidates.slice(0, 5)
            : [],
          usernameFieldVisibleCount: Number(previousProbe?.usernameFieldVisibleCount ?? 0),
          passwordFieldVisibleCount: Number(previousProbe?.passwordFieldVisibleCount ?? 0),
          inputFields: detectedFields.map((field) => ({
            key: field.key,
            label: field.label,
            placeholder: field.placeholder,
            kind: field.kind,
            secret: Boolean(field.secret),
            required: Boolean(field.required),
            position: Number(field.position ?? 0)
          })),
          submitAction: deriveAuthSubmitActionFromControls(interactionContext?.controls ?? [])
        }
      };
    }

    const captureAuthViewerSnapshot = async ({ phase = "unknown" } = {}) => {
      if (!this.page || typeof this.page.screenshot !== "function") {
        return null;
      }
      try {
        const image = await this.page.screenshot({
          type: "png",
          fullPage: false
        });
        const title = await this.page.title().catch(() => null);
        return {
          phase,
          screenshotBase64: Buffer.from(image).toString("base64"),
          url: this.page.url?.() ?? null,
          title: typeof title === "string" ? title : null
        };
      } catch {
        return null;
      }
    };

    const runInPageAuthInputStage = async (stage = "fill-and-submit") =>
      this.page
      .evaluate(({ entries, stage }) => {
        function normalize(value = "") {
          return String(value ?? "").replace(/\s+/g, " ").trim();
        }

        function normalizeLower(value = "") {
          return normalize(value).toLowerCase();
        }

        function isActionable(element, { editable = false } = {}) {
          if (!element || !(element instanceof HTMLElement)) {
            return false;
          }
          if (element.hasAttribute("hidden") || element.closest("[hidden]")) {
            return false;
          }
          if (element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true']")) {
            return false;
          }
          if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
            return false;
          }
          if (
            editable &&
            ("readOnly" in element || element.getAttribute("aria-readonly")) &&
            (element.readOnly || element.getAttribute("aria-readonly") === "true")
          ) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.pointerEvents === "none" ||
            Number.parseFloat(style.opacity || "1") <= 0.05 ||
            rect.width <= 0 ||
            rect.height <= 0
          ) {
            return false;
          }
          return true;
        }

        function firstActionable(selector) {
          if (!selector) {
            return null;
          }
          try {
            return Array.from(document.querySelectorAll(selector)).find((element) => isActionable(element)) ?? null;
          } catch {
            return null;
          }
        }

        function labelFor(element) {
          return normalize(
            element?.textContent ||
              element?.getAttribute("aria-label") ||
              element?.getAttribute("value") ||
              element?.getAttribute("title") ||
              ""
          );
        }

        function formFromSelector(formSelector) {
          if (!formSelector) {
            return null;
          }
          try {
            const candidate = document.querySelector(formSelector);
            if (candidate instanceof HTMLFormElement) {
              return candidate;
            }
            return candidate?.closest?.("form") ?? null;
          } catch {
            return null;
          }
        }

        function fieldHaystack(field) {
          const labels = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
            ? Array.from(field.labels ?? [])
                .map((label) => normalize(label?.textContent ?? ""))
                .join(" ")
            : "";
          return normalizeLower(
            [
              labels,
              field?.closest?.("label")?.textContent ?? "",
              field?.getAttribute?.("aria-label") ?? "",
              field?.getAttribute?.("placeholder") ?? "",
              field?.getAttribute?.("name") ?? "",
              field?.getAttribute?.("id") ?? "",
              field?.getAttribute?.("autocomplete") ?? "",
              field?.getAttribute?.("type") ?? ""
            ].join(" ")
          );
        }

        function kindMatches(field, kind = "") {
          const normalizedKind = normalizeLower(kind);
          const type = normalizeLower(field?.getAttribute?.("type") ?? "");
          const haystack = fieldHaystack(field);
          if (normalizedKind === "password") {
            return type === "password";
          }
          if (normalizedKind === "otp") {
            return (
              normalizeLower(field?.getAttribute?.("autocomplete") ?? "").includes("one-time-code") ||
              /\b(otp|verification|code)\b/.test(haystack)
            );
          }
          if (normalizedKind === "email") {
            return type === "email" || /\bemail\b/.test(haystack);
          }
          if (normalizedKind === "phone") {
            return type === "tel" || /\b(phone|mobile)\b/.test(haystack);
          }
          if (normalizedKind === "search") {
            return type === "search" || /\bsearch\b/.test(haystack);
          }
          if (normalizedKind === "date") {
            return ["date", "datetime-local", "month", "week", "time"].includes(type);
          }
          return type !== "password";
        }

        function resolveField(entry = {}) {
          const preferredForm = formFromSelector(entry.formSelector);
          const selectors = [entry.primarySelector, entry.fallbackSelector].filter(Boolean);
          for (const selector of selectors) {
            try {
              const candidates = Array.from(document.querySelectorAll(selector)).filter((candidate) =>
                isActionable(candidate, { editable: true })
              );
              if (candidates.length === 0) {
                continue;
              }
              if (preferredForm) {
                const inForm = candidates.find((candidate) => {
                  const form = candidate.form ?? candidate.closest?.("form");
                  return form && form === preferredForm;
                });
                if (inForm) {
                  return inForm;
                }
              }
              const kindMatched = candidates.find((candidate) => kindMatches(candidate, entry.kind));
              if (kindMatched) {
                return kindMatched;
              }
              return candidates[0];
            } catch {
              // Ignore invalid selectors and continue with metadata matching.
            }
          }

          const pool = preferredForm
            ? Array.from(preferredForm.querySelectorAll("input, textarea"))
            : Array.from(document.querySelectorAll("input, textarea"));
          const keyHints = [
            normalizeLower(entry.key ?? ""),
            normalizeLower(entry.label ?? ""),
            normalizeLower(entry.placeholder ?? "")
          ].filter(Boolean);
          const scored = [];

          for (const field of pool) {
            if (!isActionable(field, { editable: true })) {
              continue;
            }
            let score = 0;
            if (kindMatches(field, entry.kind)) {
              score += 80;
            }
            const haystack = fieldHaystack(field);
            for (const hint of keyHints) {
              if (hint && haystack.includes(hint)) {
                score += 30;
              }
            }
            if (preferredForm) {
              const form = field.form ?? field.closest?.("form");
              if (form && form === preferredForm) {
                score += 40;
              }
            }
            if (score > 0) {
              scored.push({ field, score });
            }
          }

          scored.sort((left, right) => right.score - left.score);
          return scored[0]?.field ?? null;
        }

        function valueSetterFor(field) {
          if (field instanceof HTMLInputElement) {
            return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set ?? null;
          }
          if (field instanceof HTMLTextAreaElement) {
            return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set ?? null;
          }
          return null;
        }

        function writeValue(field, value) {
          const typed = String(value ?? "");
          if (!("value" in field)) {
            return false;
          }
          try {
            const setter = valueSetterFor(field);
            if (typeof setter === "function") {
              setter.call(field, "");
              setter.call(field, typed);
            } else {
              field.value = "";
              field.value = typed;
            }
            return true;
          } catch {
            try {
              field.value = typed;
              return true;
            } catch {
              return false;
            }
          }
        }

        function dispatchInputLifecycle(field, value) {
          const typed = String(value ?? "");
          try {
            field.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                data: typed.length > 0 ? typed.slice(-1) : "",
                inputType: "insertText"
              })
            );
          } catch {
            field.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
          }
          field.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
        }

        function fieldValueMatches(field, value) {
          const expected = String(value ?? "");
          const actual = String(field?.value ?? "");
          return actual === expected;
        }

        function setValue(field, value) {
          if (!field || !isActionable(field, { editable: true })) {
            return {
              resolved: false,
              actionable: false,
              fillAttempted: false,
              focused: false,
              filled: false,
              verified: false,
              valuePresentAfterFill: false,
              valueLengthAfterFill: 0
            };
          }

          let focused = false;
          try {
            field.focus();
            focused = true;
          } catch {
            focused = false;
          }

          let filled = false;
          let verified = false;
          let valueLengthAfterFill = 0;
          let valuePresentAfterFill = false;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const wrote = writeValue(field, value);
            filled = filled || wrote;
            if (!wrote) {
              continue;
            }

            dispatchInputLifecycle(field, value);
            if (fieldValueMatches(field, value)) {
              verified = true;
              valueLengthAfterFill = String(field?.value ?? "").length;
              valuePresentAfterFill = valueLengthAfterFill > 0;
              break;
            }

            // Second deterministic fallback for controlled inputs that re-render on input.
            if (attempt === 0) {
              try {
                if (typeof field.select === "function") {
                  field.select();
                }
              } catch {
                // Ignore.
              }
            }
          }

          try {
            field.blur();
          } catch {
            // Ignore blur failures.
          }

          return {
            resolved: true,
            actionable: true,
            fillAttempted: true,
            focused,
            filled,
            verified,
            valuePresentAfterFill,
            valueLengthAfterFill
          };
        }

        const submitCandidates = [
          "button[type='submit']",
          "input[type='submit']",
          "button",
          "input[type='button']",
          "[role='button']",
          "a[role='button']",
          "a[href]"
        ];
        const submitKeywordPattern = /\b(sign in|log in|login|submit|verify|continue|next|confirm|allow)\b/i;

        const fieldResults = [];
        const filledElements = [];
        const focusedFieldKeys = [];
        let activeForm = null;
        let fieldTargetsResolvedCount = 0;
        let fieldTargetsFilledCount = 0;
        let fieldTargetsVerifiedCount = 0;

        for (const entry of entries) {
          const element = resolveField(entry);
          const result = setValue(element, entry.value);
          if (result.resolved) {
            fieldTargetsResolvedCount += 1;
          }
          if (result.filled) {
            fieldTargetsFilledCount += 1;
          }
          if (result.verified) {
            fieldTargetsVerifiedCount += 1;
          }
          if (result.focused) {
            focusedFieldKeys.push(String(entry.key ?? ""));
          }
          fieldResults.push({
            key: entry.key,
            kind: entry.kind,
            secret: Boolean(entry.secret),
            actionable: result.actionable,
            fillAttempted: result.fillAttempted,
            resolved: result.resolved,
            filled: result.filled,
            verified: result.verified,
            valuePresentAfterFill: result.valuePresentAfterFill,
            valueLengthAfterFill: result.valueLengthAfterFill
          });
          if (result.verified && element) {
            filledElements.push({
              element,
              kind: entry.kind
            });
            activeForm = activeForm ?? element.form ?? element.closest("form");
          }
        }

        const identifierFilled = fieldResults.some(
          (entry) => entry.verified && entry.kind !== "password" && entry.kind !== "otp"
        );
        const passwordFilled = fieldResults.some((entry) => entry.verified && entry.kind === "password");
        const fillExecutionAttempted = entries.length > 0;
        const fillExecutionSucceeded =
          fieldResults.length > 0 &&
          fieldResults.every((entry) => !entry.resolved || entry.verified);
        const targetedPageUrl = window.location.href;
        const targetedFrameUrl = window.location.href;
        const targetedFrameType = "page";

        if (
          stage === "fill-only" &&
          fieldResults.some((entry) => entry.verified)
        ) {
          return {
            ok: true,
            code: "INPUT_FIELDS_FILLED",
            reason: "Input fields were entered and verified.",
            inputFieldsConsumed: fillExecutionAttempted,
            fillExecutionAttempted,
            fillExecutionSucceeded,
            fieldTargetsResolvedCount,
            fieldTargetsFilledCount,
            fieldTargetsVerifiedCount,
            focusedFieldKeys,
            identifierFilled,
            usernameFilled: identifierFilled,
            passwordFilled,
            submitTriggered: false,
            submitControlResolved: false,
            submitControlType: "none",
            submitControlDetected: false,
            selectedControlLabel: null,
            explicitInvalidCredentialErrorDetected: false,
            fieldResults,
            targetedPageUrl,
            targetedFrameUrl,
            targetedFrameType
          };
        }

        if (!fieldResults.some((entry) => entry.verified)) {
          return {
            ok: false,
            code: "AUTH_FILL_BLOCKED",
            reason: "Detected input fields could not be filled for this step.",
            inputFieldsConsumed: fillExecutionAttempted,
            fillExecutionAttempted,
            fillExecutionSucceeded: false,
            fieldTargetsResolvedCount,
            fieldTargetsFilledCount,
            fieldTargetsVerifiedCount,
            focusedFieldKeys,
            identifierFilled: false,
            usernameFilled: false,
            passwordFilled: false,
            submitTriggered: false,
            submitControlResolved: false,
            submitControlType: "none",
            submitControlDetected: false,
            selectedControlLabel: null,
            explicitInvalidCredentialErrorDetected: false,
            fieldResults,
            targetedPageUrl,
            targetedFrameUrl,
            targetedFrameType
          };
        }

        let submitTriggered = false;
        let submitControlType = "none";
        let selectedControlLabel = null;
        let submitControlDetected = false;
        let submitControlResolved = false;

        if (activeForm) {
          const formControls = [];
          for (const selector of submitCandidates) {
            formControls.push(...Array.from(activeForm.querySelectorAll(selector)));
          }
          const actionableControl = formControls.find(
            (control) =>
              isActionable(control) &&
              (
                String(control.getAttribute("type") || "").toLowerCase() === "submit" ||
                submitKeywordPattern.test(labelFor(control))
              )
          );
          if (actionableControl) {
            submitControlDetected = true;
            submitControlResolved = true;
            actionableControl.click();
            submitTriggered = true;
            submitControlType = "control-click";
            selectedControlLabel = labelFor(actionableControl) || "Submit";
          }
        }

        if (!submitTriggered && activeForm) {
          try {
            if (typeof activeForm.requestSubmit === "function") {
              activeForm.requestSubmit();
            } else {
              activeForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            }
            submitTriggered = true;
            submitControlType = "form-submit";
            selectedControlLabel = "form-submit";
            submitControlDetected = true;
            submitControlResolved = true;
          } catch {
            // Fall through.
          }
        }

        if (!submitTriggered) {
          const globalControl = submitCandidates
            .map((selector) => firstActionable(selector))
            .find(
              (control) =>
                control &&
                (
                  String(control.getAttribute("type") || "").toLowerCase() === "submit" ||
                  submitKeywordPattern.test(labelFor(control))
                )
            );
          if (globalControl) {
            submitControlDetected = true;
            submitControlResolved = true;
            globalControl.click();
            submitTriggered = true;
            submitControlType = "control-click";
            selectedControlLabel = labelFor(globalControl) || "Submit";
          }
        }

        if (!submitTriggered && filledElements.length > 0) {
          const activeField = filledElements[filledElements.length - 1].element;
          activeField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
          activeField.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
          submitTriggered = true;
          submitControlType = "keyboard-enter";
          selectedControlLabel = "keyboard-enter";
        }

        const explicitInvalidCredentialErrorDetected = Array.from(
          document.querySelectorAll(
            [
              "[role='alert']",
              "[aria-live='assertive']",
              ".error",
              ".invalid-feedback",
              "[data-error]",
              "[class*='error' i]",
              "[aria-invalid='true']"
            ].join(",")
          )
        )
          .filter((element) => isActionable(element))
          .map((element) => labelFor(element).toLowerCase())
          .some(
            (text) =>
              /\b(invalid|incorrect|wrong|does not match|failed|try again)\b/.test(text) &&
              /\b(password|username|email|credential|sign in|log in|access key|account id|user id|login id|otp|verification)\b/.test(
                text
              )
          );

        return {
          ok: submitTriggered,
          code: submitTriggered ? "INPUT_FIELDS_SUBMITTED" : "AUTH_SUBMIT_CONTROL_MISSING",
          reason: submitTriggered
            ? "Input fields were entered and submission was triggered."
            : "Input fields were entered, but no actionable submit control was found.",
          inputFieldsConsumed: fillExecutionAttempted,
          fillExecutionAttempted,
          fillExecutionSucceeded,
          fieldTargetsResolvedCount,
          fieldTargetsFilledCount,
          fieldTargetsVerifiedCount,
          focusedFieldKeys,
          identifierFilled,
          usernameFilled: identifierFilled,
          passwordFilled,
          submitTriggered,
          submitControlResolved,
          submitControlType,
          submitControlDetected,
          selectedControlLabel,
          explicitInvalidCredentialErrorDetected,
          fieldResults,
          targetedPageUrl,
          targetedFrameUrl,
          targetedFrameType
        };
      }, {
        entries: orderedEntries,
        stage
      })
      .catch(() => ({
        ok: false,
        code: "SUBMISSION_FAILED",
        reason: "Input-field submission failed while interacting with the page.",
        inputFieldsConsumed: true,
        fillExecutionAttempted: true,
        fillExecutionSucceeded: false,
        fieldTargetsResolvedCount: 0,
        fieldTargetsFilledCount: 0,
        fieldTargetsVerifiedCount: 0,
        focusedFieldKeys: [],
        identifierFilled: false,
        usernameFilled: false,
        passwordFilled: false,
        submitTriggered: false,
        submitControlResolved: false,
        submitControlType: "none",
        submitControlDetected: false,
        selectedControlLabel: null,
        explicitInvalidCredentialErrorDetected: false,
        fieldResults: [],
        targetedPageUrl: this.page?.url?.() ?? null,
        targetedFrameUrl: this.page?.url?.() ?? null,
        targetedFrameType: "unknown"
      }));

    const fillPreview = await runInPageAuthInputStage("fill-only");
    let viewerSnapshotAfterFill = null;
    if (Number(fillPreview?.fieldTargetsVerifiedCount ?? 0) > 0) {
      await this.page.waitForTimeout(140).catch(() => {});
      viewerSnapshotAfterFill = await captureAuthViewerSnapshot({ phase: "after-fill" });
    }

    let submission = await runInPageAuthInputStage("fill-and-submit");

    const shouldAttemptPlaywrightFallback =
      orderedEntries.length > 0 &&
      (
        Number(submission?.fieldTargetsVerifiedCount ?? 0) < orderedEntries.length ||
        submission?.code === "AUTH_FILL_BLOCKED"
      );

    if (shouldAttemptPlaywrightFallback) {
      const alreadyVerifiedKeys = new Set(
        (Array.isArray(submission?.fieldResults) ? submission.fieldResults : [])
          .filter((entry) => entry?.verified)
          .map((entry) => String(entry?.key ?? "").trim().toLowerCase())
      );

      let fallbackResolvedCount = 0;
      let fallbackVerifiedCount = 0;
      let fallbackIdentifierFilled = false;
      let fallbackPasswordFilled = false;
      const fallbackFocusedFieldKeys = [];
      let fallbackSubmitTriggered = false;
      let lastFilledLocator = null;
      const fallbackFieldUpdates = new Map();
      const mainFrame =
        typeof this.page?.mainFrame === "function" ? this.page.mainFrame() : null;
      let fallbackTargetedFrameUrl = submission?.targetedFrameUrl ?? null;
      let fallbackTargetedFrameType = submission?.targetedFrameType ?? "unknown";

      const isEditableLocator = async (locator) => {
        const count = await locator.count().catch(() => 0);
        if (!count) {
          return false;
        }
        const visible = await locator.isVisible().catch(() => false);
        if (!visible) {
          return false;
        }
        const disabled = await locator.isDisabled().catch(() => false);
        if (disabled) {
          return false;
        }
        const readOnly = await locator
          .evaluate(
            (element) =>
              (("readOnly" in element) && Boolean(element.readOnly)) ||
              element.getAttribute?.("aria-readonly") === "true"
          )
          .catch(() => false);
        return !readOnly;
      };

      const resolveEntryLocator = async (entry = {}) => {
        const frameCandidates =
          typeof this.page?.frames === "function"
            ? this.page.frames().filter(Boolean)
            : [];
        const targets =
          frameCandidates.length > 0
            ? frameCandidates
            : [mainFrame].filter(Boolean);
        const normalizedTargets = targets.length > 0 ? targets : [this.page];
        const selectors = [entry.primarySelector, entry.fallbackSelector].filter(Boolean);
        for (const target of normalizedTargets) {
          for (const selector of selectors) {
            if (entry.formSelector) {
              const scoped = target.locator(entry.formSelector).first().locator(selector).first();
              if (await isEditableLocator(scoped)) {
                return {
                  locator: scoped,
                  frame:
                    target === this.page
                      ? mainFrame
                      : target
                };
              }
            }

            const direct = target.locator(selector).first();
            if (await isEditableLocator(direct)) {
              return {
                locator: direct,
                frame:
                  target === this.page
                    ? mainFrame
                    : target
              };
            }
          }
        }
        return null;
      };

      const verifyLocatorValue = async (locator, expectedValue) =>
        locator
          .evaluate(
            (element, expected) => String(element?.value ?? "") === String(expected ?? ""),
            String(expectedValue ?? "")
          )
          .catch(() => false);

      for (const entry of orderedEntries) {
        const key = String(entry?.key ?? "").trim().toLowerCase();
        if (!key || alreadyVerifiedKeys.has(key)) {
          continue;
        }
        const target = await resolveEntryLocator(entry);
        if (!target?.locator) {
          continue;
        }
        const locator = target.locator;
        const frameRef = target.frame;
        const frameUrl =
          frameRef && typeof frameRef.url === "function"
            ? frameRef.url()
            : this.page?.url?.();
        if (frameRef) {
          const isMainFrame = Boolean(mainFrame && frameRef === mainFrame);
          fallbackTargetedFrameType = isMainFrame ? "page" : "iframe";
          if (!isMainFrame && frameUrl) {
            fallbackTargetedFrameUrl = frameUrl;
          } else if (frameUrl && !fallbackTargetedFrameUrl) {
            fallbackTargetedFrameUrl = frameUrl;
          }
        } else if (fallbackTargetedFrameType === "unknown") {
          fallbackTargetedFrameType = "page";
          if (frameUrl && !fallbackTargetedFrameUrl) {
            fallbackTargetedFrameUrl = frameUrl;
          }
        }

        fallbackResolvedCount += 1;
        await locator.focus().catch(() => {});
        fallbackFocusedFieldKeys.push(key);
        await locator.fill(String(entry?.value ?? "")).catch(() => {});
        let verified = await verifyLocatorValue(locator, entry?.value);

        if (!verified) {
          await locator.click({ clickCount: 3 }).catch(() => {});
          await this.page.keyboard.press("Control+A").catch(() => {});
          await this.page.keyboard.press("Meta+A").catch(() => {});
          await this.page.keyboard.type(String(entry?.value ?? ""), { delay: 20 }).catch(() => {});
          verified = await verifyLocatorValue(locator, entry?.value);
        }

        if (verified) {
          fallbackVerifiedCount += 1;
          alreadyVerifiedKeys.add(key);
          if (entry.kind === "password") {
            fallbackPasswordFilled = true;
          } else if (entry.kind !== "otp") {
            fallbackIdentifierFilled = true;
          }
          lastFilledLocator = locator;
        }
        fallbackFieldUpdates.set(key, {
          key,
          kind: entry.kind,
          secret: Boolean(entry.secret),
          actionable: true,
          fillAttempted: true,
          resolved: true,
          filled: verified,
          verified,
          valuePresentAfterFill: verified,
          valueLengthAfterFill: verified ? String(entry?.value ?? "").length : 0
        });
      }

      if (!submission?.submitTriggered && fallbackVerifiedCount > 0 && lastFilledLocator) {
        await lastFilledLocator.focus().catch(() => {});
        await lastFilledLocator.press("Enter").catch(() => {});
        fallbackSubmitTriggered = true;
      }

      if (fallbackResolvedCount > 0 || fallbackSubmitTriggered) {
        const mergedFocusedFieldKeys = Array.from(
          new Set([...(Array.isArray(submission?.focusedFieldKeys) ? submission.focusedFieldKeys : []), ...fallbackFocusedFieldKeys])
        );
        const mergedFieldResults = [];
        const baseFieldResults = Array.isArray(submission?.fieldResults) ? submission.fieldResults : [];
        const existingByKey = new Map();
        for (const fieldResult of baseFieldResults) {
          const key = String(fieldResult?.key ?? "").trim().toLowerCase();
          if (!key) {
            continue;
          }
          existingByKey.set(key, {
            key,
            kind: fieldResult?.kind ?? null,
            secret: Boolean(fieldResult?.secret),
            actionable: Boolean(fieldResult?.actionable),
            fillAttempted: Boolean(fieldResult?.fillAttempted),
            resolved: Boolean(fieldResult?.resolved),
            filled: Boolean(fieldResult?.filled),
            verified: Boolean(fieldResult?.verified),
            valuePresentAfterFill: Boolean(fieldResult?.valuePresentAfterFill),
            valueLengthAfterFill: Number(fieldResult?.valueLengthAfterFill ?? 0)
          });
        }
        for (const [key, update] of fallbackFieldUpdates.entries()) {
          const current = existingByKey.get(key) ?? {
            key,
            kind: update.kind ?? null,
            secret: Boolean(update.secret),
            actionable: false,
            fillAttempted: false,
            resolved: false,
            filled: false,
            verified: false,
            valuePresentAfterFill: false,
            valueLengthAfterFill: 0
          };
          existingByKey.set(key, {
            ...current,
            kind: update.kind ?? current.kind,
            secret: Boolean(update.secret ?? current.secret),
            actionable: Boolean(current.actionable || update.actionable),
            fillAttempted: Boolean(current.fillAttempted || update.fillAttempted),
            resolved: Boolean(current.resolved || update.resolved),
            filled: Boolean(current.filled || update.filled),
            verified: Boolean(current.verified || update.verified),
            valuePresentAfterFill: Boolean(current.valuePresentAfterFill || update.valuePresentAfterFill),
            valueLengthAfterFill: Math.max(
              Number(current.valueLengthAfterFill ?? 0),
              Number(update.valueLengthAfterFill ?? 0)
            )
          });
        }
        for (const field of orderedEntries) {
          const key = String(field?.key ?? "").trim().toLowerCase();
          if (!key) {
            continue;
          }
          if (!existingByKey.has(key)) {
            existingByKey.set(key, {
              key,
              kind: field?.kind ?? null,
              secret: Boolean(field?.secret),
              actionable: false,
              fillAttempted: false,
              resolved: false,
              filled: false,
              verified: false,
              valuePresentAfterFill: false,
              valueLengthAfterFill: 0
            });
          }
          mergedFieldResults.push(existingByKey.get(key));
        }
        const totalResolvedCount = Math.max(
          Number(submission?.fieldTargetsResolvedCount ?? 0),
          Number(submission?.fieldTargetsResolvedCount ?? 0) + fallbackResolvedCount
        );
        const totalFilledCount = Math.max(
          Number(submission?.fieldTargetsFilledCount ?? 0),
          Number(submission?.fieldTargetsFilledCount ?? 0) + fallbackVerifiedCount
        );
        const totalVerifiedCount = Math.max(
          Number(submission?.fieldTargetsVerifiedCount ?? 0),
          Number(submission?.fieldTargetsVerifiedCount ?? 0) + fallbackVerifiedCount
        );

        submission = {
          ...submission,
          ok: Boolean(submission?.ok || fallbackSubmitTriggered || submission?.submitTriggered),
          code:
            submission?.submitTriggered || fallbackSubmitTriggered
              ? "INPUT_FIELDS_SUBMITTED"
              : submission?.code,
          reason:
            submission?.submitTriggered || fallbackSubmitTriggered
              ? "Input fields were entered and submission was triggered."
              : submission?.reason,
          inputFieldsConsumed: true,
          fillExecutionAttempted: true,
          fillExecutionSucceeded: totalVerifiedCount > 0,
          fieldTargetsResolvedCount: totalResolvedCount,
          fieldTargetsFilledCount: totalFilledCount,
          fieldTargetsVerifiedCount: totalVerifiedCount,
          focusedFieldKeys: mergedFocusedFieldKeys,
          fieldResults: mergedFieldResults,
          identifierFilled: Boolean(submission?.identifierFilled || fallbackIdentifierFilled),
          usernameFilled: Boolean(submission?.usernameFilled || fallbackIdentifierFilled),
          passwordFilled: Boolean(submission?.passwordFilled || fallbackPasswordFilled),
          submitTriggered: Boolean(submission?.submitTriggered || fallbackSubmitTriggered),
          submitControlResolved: Boolean(submission?.submitControlResolved || fallbackSubmitTriggered),
          submitControlType:
            submission?.submitTriggered
              ? submission?.submitControlType ?? "none"
              : fallbackSubmitTriggered
                ? "keyboard-enter"
                : submission?.submitControlType ?? "none",
          targetedPageUrl: submission?.targetedPageUrl ?? this.page?.url?.() ?? null,
          targetedFrameUrl: fallbackTargetedFrameUrl ?? submission?.targetedFrameUrl ?? this.page?.url?.() ?? null,
          targetedFrameType: fallbackTargetedFrameType || submission?.targetedFrameType || "unknown"
        };
      }
    }

    let viewerSnapshotAfterSubmit = null;
    if (Boolean(submission?.submitTriggered)) {
      await this.page.waitForTimeout(140).catch(() => {});
      viewerSnapshotAfterSubmit = await captureAuthViewerSnapshot({ phase: "after-submit" });
    }

    await this.settleAfterAuthSubmission();
    const transitionedProbe = await this.waitForAuthTransition({
      previousProbe,
      submission
    });
    const submitSourceUrl = String(previousProbe?.pageUrl ?? "");
    const transitionedUrl = String(transitionedProbe?.pageUrl ?? "");
    const postSubmitUrlChanged =
      submitSourceUrl.length > 0 &&
      transitionedUrl.length > 0 &&
      submitSourceUrl !== transitionedUrl;
    const progression = detectAuthStepAdvance(previousProbe, transitionedProbe, {
      ...submission,
      submitTriggered: Boolean(submission?.submitTriggered)
    });

    return {
      success: Boolean(submission?.ok),
      code: submission?.code ?? "INPUT_FIELDS_SUBMITTED",
      reason: submission?.reason ?? "Input fields were submitted.",
      inputFieldsConsumed: Boolean(submission?.inputFieldsConsumed),
      fillExecutionAttempted: Boolean(submission?.fillExecutionAttempted),
      fillExecutionSucceeded: Boolean(submission?.fillExecutionSucceeded),
      fieldTargetsResolvedCount: Number(submission?.fieldTargetsResolvedCount ?? 0),
      fieldTargetsFilledCount: Number(submission?.fieldTargetsFilledCount ?? 0),
      fieldTargetsVerifiedCount: Number(submission?.fieldTargetsVerifiedCount ?? 0),
      focusedFieldKeys: Array.isArray(submission?.focusedFieldKeys) ? submission.focusedFieldKeys : [],
      submitTriggered: Boolean(submission?.submitTriggered),
      submitControlResolved: Boolean(submission?.submitControlResolved ?? submission?.submitControlDetected),
      submitControlType: submission?.submitControlType ?? "none",
      selectedControlLabel: submission?.selectedControlLabel ?? null,
      stepAdvanced: progression.advanced,
      stepAdvanceReason: progression.reason,
      previousVisibleStep: progression.fromStep,
      currentVisibleStep: progression.toStep,
      explicitInvalidCredentialErrorDetected: Boolean(submission?.explicitInvalidCredentialErrorDetected),
      identifierFilled: Boolean(submission?.identifierFilled ?? submission?.usernameFilled),
      usernameFilled: Boolean(submission?.usernameFilled ?? submission?.identifierFilled),
      passwordFilled: Boolean(submission?.passwordFilled),
      browserActionExecuted: Boolean(
        submission?.browserActionExecuted ||
        Number(submission?.fieldTargetsVerifiedCount ?? 0) > 0 ||
        submission?.identifierFilled ||
        submission?.usernameFilled ||
        submission?.passwordFilled
      ),
      postSubmitUrlChanged,
      postSubmitUrl: transitionedUrl || null,
      postSubmitProbeState: inferAuthVisibleStep(transitionedProbe),
      targetedPageUrl: (submission?.targetedPageUrl ?? submitSourceUrl) || null,
      targetedFrameUrl:
        (submission?.targetedFrameUrl ?? submission?.targetedPageUrl ?? submitSourceUrl) || null,
      targetedFrameType: submission?.targetedFrameType ?? "unknown",
      perField: Array.isArray(submission?.fieldResults)
        ? submission.fieldResults.map((fieldResult) => ({
            key: String(fieldResult?.key ?? "").trim().toLowerCase(),
            resolved: Boolean(fieldResult?.resolved),
            actionable: Boolean(fieldResult?.actionable),
            fillAttempted: Boolean(fieldResult?.fillAttempted),
            filled: Boolean(fieldResult?.filled),
            verified: Boolean(fieldResult?.verified),
            valuePresentAfterFill: Boolean(fieldResult?.valuePresentAfterFill),
            valueLengthAfterFill: Number(fieldResult?.valueLengthAfterFill ?? 0)
          })).filter((fieldResult) => fieldResult.key)
        : [],
      viewerFrameCapturedAfterFill: Boolean(viewerSnapshotAfterFill?.screenshotBase64),
      viewerFrameCapturedAfterSubmit: Boolean(viewerSnapshotAfterSubmit?.screenshotBase64),
      viewerSnapshots: {
        afterFill: viewerSnapshotAfterFill,
        afterSubmit: viewerSnapshotAfterSubmit
      },
      authenticated: Boolean(transitionedProbe?.authenticatedHint || (await this.isAuthenticated())),
      probe: transitionedProbe,
      form: {
        identifierFieldDetected: Boolean(transitionedProbe?.identifierFieldDetected || transitionedProbe?.usernameFieldDetected),
        usernameFieldDetected: Boolean(transitionedProbe?.usernameFieldDetected || transitionedProbe?.identifierFieldDetected),
        passwordFieldDetected: Boolean(transitionedProbe?.passwordFieldDetected),
        otpFieldDetected: Boolean(transitionedProbe?.otpFieldDetected),
        submitControlDetected: Boolean(submission?.submitControlDetected || transitionedProbe?.submitControlDetected),
        visibleStep: transitionedProbe?.visibleStep ?? inferAuthVisibleStep(transitionedProbe),
        identifierFieldVisibleCount: Number(
          transitionedProbe?.identifierFieldVisibleCount ?? transitionedProbe?.usernameFieldVisibleCount ?? 0
        ),
        identifierLabelCandidates: Array.isArray(transitionedProbe?.identifierLabelCandidates)
          ? transitionedProbe.identifierLabelCandidates.slice(0, 5)
          : [],
        usernameFieldVisibleCount: Number(transitionedProbe?.usernameFieldVisibleCount ?? 0),
        passwordFieldVisibleCount: Number(transitionedProbe?.passwordFieldVisibleCount ?? 0),
        inputFields: Array.isArray(transitionedProbe?.inputFields) ? transitionedProbe.inputFields : [],
        submitAction: transitionedProbe?.submitAction ?? null
      }
    };
  }

  async submitAuthCredentials(credentials = {}) {
    if (!this.page) {
      return {
        success: false,
        code: "NO_ACTIVE_PAGE",
        reason: "No active browser page is available."
      };
    }

    const firstCredentialValue = resolveFirstCredentialAlias(credentials);
    const passwordValue = String(credentials?.password ?? "");
    const previousProbe = await this.collectAuthFormProbe();
    let currentProbe = previousProbe;
    let authStepHint = inferAuthVisibleStep(previousProbe);

    await this.waitForUIReady(
      this.runConfig?.readiness?.uiReadyStrategy,
      this.runConfig?.readiness?.readyTimeoutMs
    ).catch(() => {});

    const attempts = [];
    const maxAttempts = 3;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const liveProbe = await this.collectAuthFormProbe().catch(() => null);
      if (liveProbe && typeof liveProbe === "object") {
        currentProbe = liveProbe;
      }

      const context = await this.collectAuthInteractionContext();
      const planningContext = {
        ...context,
        identifierFieldDetected: Boolean(
          context?.identifierFieldDetected ||
            context?.usernameFieldDetected ||
            currentProbe?.identifierFieldDetected ||
            currentProbe?.usernameFieldDetected
        ),
        usernameFieldDetected: Boolean(
          context?.usernameFieldDetected ||
            context?.identifierFieldDetected ||
            currentProbe?.usernameFieldDetected ||
            currentProbe?.identifierFieldDetected
        ),
        passwordFieldDetected: Boolean(
          context?.passwordFieldDetected || currentProbe?.passwordFieldDetected
        ),
        submitControlDetected: Boolean(
          context?.submitControlDetected || currentProbe?.submitControlDetected
        ),
        identifierFieldVisibleCount: Math.max(
          Number(context?.identifierFieldVisibleCount ?? 0),
          Number(context?.usernameFieldVisibleCount ?? 0),
          Number(
            currentProbe?.identifierFieldVisibleCount ??
              currentProbe?.usernameFieldVisibleCount ??
              0
          )
        ),
        usernameFieldVisibleCount: Math.max(
          Number(context?.usernameFieldVisibleCount ?? 0),
          Number(
            currentProbe?.usernameFieldVisibleCount ??
              currentProbe?.identifierFieldVisibleCount ??
              0
          )
        ),
        passwordFieldVisibleCount: Math.max(
          Number(context?.passwordFieldVisibleCount ?? 0),
          Number(currentProbe?.passwordFieldVisibleCount ?? 0)
        )
      };
      const effectiveStepHint =
        planningContext.identifierFieldDetected && planningContext.passwordFieldDetected
          ? "credentials"
          : authStepHint;
      const plan = buildCredentialActionPlan(planningContext, {
        stepHint: effectiveStepHint,
        allowUsername: true,
        allowPassword: true,
        forceSubmitControl: attemptIndex > 0
      });
      const identifierSignalDetected = Boolean(
        planningContext.identifierFieldDetected ||
          planningContext.usernameFieldDetected ||
          Number(planningContext.identifierFieldVisibleCount ?? 0) > 0 ||
          Number(planningContext.usernameFieldVisibleCount ?? 0) > 0
      );
      const passwordSignalDetected = Boolean(
        planningContext.passwordFieldDetected ||
          Number(planningContext.passwordFieldVisibleCount ?? 0) > 0
      );

      let effectivePlan = plan;
      let noFillableFields = !effectivePlan.fillUsername && !effectivePlan.fillPassword;
      if (noFillableFields && (identifierSignalDetected || passwordSignalDetected)) {
        // Planner can occasionally miss actionable selectors while probe-level auth signals are present.
        // Force one deterministic credentials attempt using broad fallback selectors.
        effectivePlan = {
          ...plan,
          stepHint:
            identifierSignalDetected && passwordSignalDetected
              ? "credentials"
              : (passwordSignalDetected ? "password" : "username"),
          fillUsername: identifierSignalDetected,
          fillPassword: passwordSignalDetected,
          usernameFieldSelector: null,
          usernameFallbackSelector: null,
          passwordFieldSelector: null,
          passwordFallbackSelector: null,
          submitControlSelector: null,
          submitControlFallbackSelector: null,
          submitControlLabel: null,
          intent:
            identifierSignalDetected && passwordSignalDetected
              ? "submit-credentials"
              : (passwordSignalDetected ? "submit-password" : "advance-username")
        };
        noFillableFields = !effectivePlan.fillUsername && !effectivePlan.fillPassword;
      }

      if (noFillableFields) {
        const missingFirstField = !planningContext.identifierFieldDetected;
        const missingPasswordField = !planningContext.passwordFieldDetected;
        const noSubmitControl = !planningContext.submitControlDetected;
        let code = "AUTH_STEP_NOT_ACTIONABLE";
        let reason = "No visible actionable authentication fields were found for the current step.";
        if (missingFirstField && missingPasswordField) {
          code = "AUTH_FIELDS_MISSING";
          reason = "No actionable first-credential or password field was found.";
        } else if (missingFirstField) {
          code = "AUTH_FIRST_FIELD_NOT_FOUND";
          reason = "No actionable first-credential field was found.";
        } else if (missingPasswordField) {
          code = "AUTH_PASSWORD_FIELD_MISSING";
          reason = "No actionable password field was found.";
        } else if (noSubmitControl) {
          code = "AUTH_SUBMIT_CONTROL_MISSING";
          reason = "Credential fields were detected but no actionable submit control was found.";
        }
        attempts.push({
          submission: {
            ok: false,
            code,
            reason,
            usernameFilled: false,
            passwordFilled: false,
            identifierFilled: false,
            submitTriggered: false,
            submitControlType: "none",
            submitControlDetected: Boolean(plan.submitControlSelector || plan.submitControlFallbackSelector),
            selectedControlLabel: plan.submitControlLabel,
            explicitInvalidCredentialErrorDetected: false
          },
          plan: effectivePlan,
          probe: currentProbe
        });

        if (attemptIndex < maxAttempts - 1) {
          await this.page?.waitForTimeout(280).catch(() => {});
          await this.waitForUIReady(
            this.runConfig?.readiness?.uiReadyStrategy,
            this.runConfig?.readiness?.readyTimeoutMs
          ).catch(() => {});
          const refreshedProbe = await this.collectAuthFormProbe().catch(() => null);
          if (refreshedProbe && typeof refreshedProbe === "object") {
            currentProbe = refreshedProbe;
            authStepHint = inferAuthVisibleStep(refreshedProbe);
          }
          continue;
        }
      } else {
        const submission = await this.executeCredentialActionPlan({
          plan: effectivePlan,
          usernameValue: firstCredentialValue,
          passwordValue
        });

        await this.settleAfterAuthSubmission();
        const transitionedProbe = await this.waitForAuthTransition({
          previousProbe: currentProbe,
          submission
        });
        const submitSourceUrl = String(currentProbe?.pageUrl ?? "");
        const transitionedUrl = String(transitionedProbe?.pageUrl ?? "");
        const postSubmitUrlChanged =
          submitSourceUrl.length > 0 &&
          transitionedUrl.length > 0 &&
          submitSourceUrl !== transitionedUrl;
        const enrichedSubmission = {
          ...submission,
          postSubmitUrlChanged,
          postSubmitUrl: transitionedUrl || null,
          postSubmitProbeState: inferAuthVisibleStep(transitionedProbe),
          browserActionExecuted: Boolean(submission?.usernameFilled || submission?.passwordFilled)
        };
        currentProbe = transitionedProbe;
        attempts.push({
          submission: enrichedSubmission,
          plan: effectivePlan,
          probe: transitionedProbe
        });
      }

      const latestAttempt = attempts[attempts.length - 1];
      const probeForDecision = latestAttempt?.probe ?? currentProbe;
      const derivedStep = inferAuthVisibleStep(probeForDecision);
      const likelyAuthenticated = probeForDecision?.authenticatedHint || (await this.isAuthenticated());
      if (likelyAuthenticated || derivedStep === "authenticated") {
        currentProbe = probeForDecision;
        break;
      }
      if (probeForDecision?.otpChallengeDetected || probeForDecision?.otpFieldDetected || derivedStep === "otp") {
        currentProbe = probeForDecision;
        break;
      }
      if (latestAttempt?.submission?.explicitInvalidCredentialErrorDetected && !latestAttempt?.submission?.submitTriggered) {
        currentProbe = probeForDecision;
        break;
      }

      const canRetry =
        derivedStep === "password" ||
        derivedStep === "username" ||
        derivedStep === "credentials" ||
        derivedStep === "unknown";
      if (!canRetry) {
        currentProbe = probeForDecision;
        break;
      }

      authStepHint = derivedStep;
      if (!latestAttempt?.submission?.submitTriggered && attemptIndex >= 1) {
        currentProbe = probeForDecision;
        break;
      }
    }

    await this.settleAfterAuthSubmission();
    const intermediateProbe = await this.collectAuthFormProbe();
    await this.page.waitForTimeout(320).catch(() => {});
    await this.waitForUIReady(
      this.runConfig?.readiness?.uiReadyStrategy,
      this.runConfig?.readiness?.readyTimeoutMs
    ).catch(() => {});

    let probe = await this.collectAuthFormProbe();
    const authenticated = probe.authenticatedHint || (await this.isAuthenticated());
    let latestSubmission = attempts[attempts.length - 1]?.submission ?? {
      ok: false,
      code: "LOGIN_FORM_NOT_FOUND",
      reason: "No actionable authentication form was found.",
      submitTriggered: false,
      submitControlType: "none",
      selectedControlLabel: null,
      submitControlDetected: false,
      explicitInvalidCredentialErrorDetected: false,
      usernameFilled: false,
      passwordFilled: false,
      identifierFilled: false,
      postSubmitUrlChanged: false,
      postSubmitUrl: null,
      postSubmitProbeState: null,
      browserActionExecuted: false
    };

    // Final guarded fallback: if late probe clearly shows a single-step credential form
    // but earlier planner attempts produced no actionable fill, execute one deterministic
    // direct submission attempt before returning AUTH_SUBMIT_NOT_TRIGGERED.
    const canAttemptLateCredentialFallback =
      !attempts.some((entry) => entry?.submission?.submitTriggered) &&
      Boolean(
        (probe?.identifierFieldDetected || probe?.usernameFieldDetected) && probe?.passwordFieldDetected
      );
    if (canAttemptLateCredentialFallback) {
      const forcedPlan = {
        stepHint: "credentials",
        fillUsername: true,
        fillPassword: true,
        usernameFieldSelector: null,
        usernameFallbackSelector: null,
        passwordFieldSelector: null,
        passwordFallbackSelector: null,
        submitControlSelector: null,
        submitControlFallbackSelector: null,
        submitControlLabel: null,
        intent: "submit-credentials",
        hasOtpField: false,
        usernameCandidateCount: 0,
        passwordCandidateCount: 0,
        controlCandidateCount: 0
      };
      const forcedSubmission = await this.executeCredentialActionPlan({
        plan: forcedPlan,
        usernameValue: firstCredentialValue,
        passwordValue
      });
      if (forcedSubmission?.submitTriggered) {
        await this.settleAfterAuthSubmission();
        const forcedProbe = await this.waitForAuthTransition({
          previousProbe: probe,
          submission: forcedSubmission
        });
        const submitSourceUrl = String(probe?.pageUrl ?? "");
        const transitionedUrl = String(forcedProbe?.pageUrl ?? "");
        latestSubmission = {
          ...forcedSubmission,
          postSubmitUrlChanged:
            submitSourceUrl.length > 0 && transitionedUrl.length > 0 && submitSourceUrl !== transitionedUrl,
          postSubmitUrl: transitionedUrl || null,
          postSubmitProbeState: inferAuthVisibleStep(forcedProbe),
          browserActionExecuted: Boolean(
            forcedSubmission?.browserActionExecuted ||
              forcedSubmission?.identifierFilled ||
              forcedSubmission?.usernameFilled ||
              forcedSubmission?.passwordFilled
          )
        };
        attempts.push({
          submission: latestSubmission,
          plan: forcedPlan,
          probe: forcedProbe
        });
        probe = forcedProbe;
      } else {
        latestSubmission = {
          ...latestSubmission,
          reason:
            forcedSubmission?.reason ||
            latestSubmission?.reason ||
            "No visible actionable authentication fields were found for the current step."
        };
      }
    }

    const progression = detectAuthStepAdvance(previousProbe, probe, {
      ...latestSubmission,
      submitTriggered: attempts.some((entry) => entry?.submission?.submitTriggered)
    });

    return {
      success: attempts.some((entry) => entry?.submission?.ok),
      code: latestSubmission.code,
      reason: latestSubmission.reason,
      submitTriggered: attempts.some((entry) => entry?.submission?.submitTriggered),
      submitControlType:
        latestSubmission.submitControlType ??
        attempts
          .map((entry) => entry?.submission?.submitControlType)
          .find(Boolean) ??
        "none",
      selectedControlLabel:
        latestSubmission.selectedControlLabel ??
        attempts
          .map((entry) => entry?.submission?.selectedControlLabel)
          .find(Boolean) ??
        null,
      stepAdvanced: progression.advanced,
      stepAdvanceReason: progression.reason,
      previousVisibleStep: progression.fromStep,
      currentVisibleStep: progression.toStep,
      explicitInvalidCredentialErrorDetected: Boolean(
        attempts.some((entry) => entry?.submission?.explicitInvalidCredentialErrorDetected) ||
          probe.invalidCredentialErrorDetected ||
          intermediateProbe.invalidCredentialErrorDetected
      ),
      identifierFilled: Boolean(
        attempts.some((entry) => entry?.submission?.identifierFilled || entry?.submission?.usernameFilled)
      ),
      usernameFilled: Boolean(attempts.some((entry) => entry?.submission?.usernameFilled)),
      passwordFilled: Boolean(attempts.some((entry) => entry?.submission?.passwordFilled)),
      browserActionExecuted: Boolean(attempts.some((entry) => entry?.submission?.browserActionExecuted)),
      postSubmitUrlChanged: Boolean(attempts.some((entry) => entry?.submission?.postSubmitUrlChanged)),
      postSubmitUrl:
        latestSubmission.postSubmitUrl ??
        probe?.pageUrl ??
        null,
      postSubmitProbeState: inferAuthVisibleStep(probe),
      authenticated,
      probe,
      form: {
        identifierFieldDetected: Boolean(probe.identifierFieldDetected || probe.usernameFieldDetected),
        usernameFieldDetected: Boolean(
          attempts.some((entry) => entry?.submission?.usernameFilled) || probe.usernameFieldDetected
        ),
        passwordFieldDetected: Boolean(
          attempts.some((entry) => entry?.submission?.passwordFilled) || probe.passwordFieldDetected
        ),
        otpFieldDetected: Boolean(probe.otpFieldDetected),
        submitControlDetected: Boolean(
          attempts.some((entry) => entry?.submission?.submitControlDetected) || probe.submitControlDetected
        ),
        visibleStep: probe.visibleStep ?? inferAuthVisibleStep(probe),
        identifierFieldVisibleCount: Number(probe.identifierFieldVisibleCount ?? probe.usernameFieldVisibleCount ?? 0),
        identifierLabelCandidates: Array.isArray(probe.identifierLabelCandidates)
          ? probe.identifierLabelCandidates.slice(0, 5)
          : [],
        usernameFieldVisibleCount: Number(probe.usernameFieldVisibleCount ?? 0),
        passwordFieldVisibleCount: Number(probe.passwordFieldVisibleCount ?? 0),
        inputFields: Array.isArray(probe?.inputFields) ? probe.inputFields : [],
        submitAction: probe?.submitAction ?? null
      }
    };
  }

  async submitAuthOtp({ otp }) {
    if (!this.page) {
      return {
        success: false,
        code: "NO_ACTIVE_PAGE",
        reason: "No active browser page is available."
      };
    }

    await this.waitForUIReady(
      this.runConfig?.readiness?.uiReadyStrategy,
      this.runConfig?.readiness?.readyTimeoutMs
    ).catch(() => {});

    const submission = await this.page
      .evaluate(({ otpValue }) => {
        function isVisible(element) {
          if (!element || !(element instanceof HTMLElement)) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        function firstVisible(selector) {
          return Array.from(document.querySelectorAll(selector)).find((element) => isVisible(element)) ?? null;
        }

        const otpField = firstVisible(
          [
            "input[autocomplete='one-time-code']",
            "input[name*='otp' i]",
            "input[id*='otp' i]",
            "input[name*='code' i]",
            "input[id*='code' i]",
            "input[name*='verification' i]",
            "input[id*='verification' i]"
          ].join(",")
        );

        if (!otpField) {
          return {
            ok: false,
            code: "OTP_FIELD_NOT_FOUND",
            reason: "No visible OTP or verification field was detected.",
            otpFieldDetected: false,
            submitTriggered: false
          };
        }

        otpField.focus();
        otpField.value = "";
        otpField.value = String(otpValue ?? "");
        otpField.dispatchEvent(new Event("input", { bubbles: true }));
        otpField.dispatchEvent(new Event("change", { bubbles: true }));

        const form = otpField.form ?? null;
        let submitTriggered = false;
        if (form) {
          try {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit();
            } else {
              form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            }
            submitTriggered = true;
          } catch {
            // Fall through to submit button fallback.
          }
        }

        if (!submitTriggered) {
          const submitControl = firstVisible(
            [
              "button[type='submit']",
              "input[type='submit']",
              "button[aria-label*='verify' i]",
              "button[aria-label*='continue' i]",
              "button[aria-label*='submit' i]"
            ].join(",")
          );
          if (submitControl) {
            submitControl.click();
            submitTriggered = true;
          }
        }

        return {
          ok: true,
          code: "OTP_SUBMITTED",
          reason: submitTriggered
            ? "OTP was filled and submit was triggered."
            : "OTP was filled but no submit control was detected.",
          otpFieldDetected: true,
          submitTriggered
        };
      }, { otpValue: String(otp ?? "") })
      .catch(() => ({
        ok: false,
        code: "OTP_SUBMISSION_FAILED",
        reason: "OTP submission failed while interacting with the page.",
        otpFieldDetected: false,
        submitTriggered: false
      }));

    await this.page.waitForTimeout(450).catch(() => {});
    await this.waitForUIReady(
      this.runConfig?.readiness?.uiReadyStrategy,
      this.runConfig?.readiness?.readyTimeoutMs
    ).catch(() => {});

    const probe = await this.collectAuthFormProbe();
    const authenticated = await this.isAuthenticated();

    return {
      success: Boolean(submission.ok),
      code: submission.code,
      reason: submission.reason,
      submitTriggered: Boolean(submission.submitTriggered),
      authenticated,
      probe,
      form: {
        otpFieldDetected: Boolean(submission.otpFieldDetected || probe.otpFieldDetected)
      }
    };
  }

  async isAuthenticated() {
    return this.page
      .evaluate(() => {
        function normalize(value = "") {
          return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        }

        function isActionable(element) {
          if (!element || !(element instanceof HTMLElement)) {
            return false;
          }
          if (element.hasAttribute("hidden") || element.closest("[hidden]")) {
            return false;
          }
          if (element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true']")) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.visibility !== "collapse" &&
            Number.parseFloat(style.opacity || "1") > 0.05 &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        const body = normalize(document.body?.innerText ?? "");
        const url = normalize(window.location.href);
        const path = normalize(window.location.pathname);
        const loginPath = /\blogin\b|\bsign-?in\b|\bauth\b|\bverify\b|\botp\b/.test(path);
        const visibleIdentifierField = Array.from(
          document.querySelectorAll(
            [
              "input[type='email']",
              "input[autocomplete='username']",
              "input[name*='user' i]",
              "input[name*='email' i]",
              "input[name*='login' i]",
              "input[name*='access' i]",
              "input[name*='account' i]",
              "input[name*='member' i]",
              "input[name*='tenant' i]",
              "input[name*='workspace' i]",
              "input[name*='portal' i]",
              "input[name*='key' i]"
            ].join(",")
          )
        ).some((element) => isActionable(element));
        const visiblePasswordField = Array.from(
          document.querySelectorAll("input[type='password'], input[autocomplete='current-password']")
        ).some((element) => isActionable(element));
        const visibleOtpField = Array.from(
          document.querySelectorAll(
            "input[autocomplete='one-time-code'], input[name*='otp' i], input[name*='verification' i], input[name*='code' i]"
          )
        ).some((element) => isActionable(element));
        const visibleSignInAction = Array.from(document.querySelectorAll("button, a, [role='button'], input[type='submit']"))
          .filter((element) => isActionable(element))
          .map((element) => normalize(element.textContent || element.getAttribute("aria-label") || element.getAttribute("value") || ""))
          .some((text) => /\bsign in\b|\blog in\b|\bcontinue with\b/.test(text));

        const accountMarkerVisible = Array.from(
          document.querySelectorAll(
            [
              "button[aria-label*='account' i]",
              "a[href*='account' i]",
              "a[href*='profile' i]",
              "img[alt*='avatar' i]",
              "a[href*='logout' i]",
              "button[aria-label*='logout' i]",
              "[data-testid*='avatar' i]"
            ].join(",")
          )
        ).some((element) => isActionable(element));
        const visibleLoginHeading = Array.from(
          document.querySelectorAll("h1, h2, h3, [role='heading']")
        )
          .filter((element) => isActionable(element))
          .map((element) => normalize(element.textContent || element.getAttribute("aria-label") || ""))
          .some((text) => /\blog in\b|\bsign in\b|\bauthentication\b|\bverify\b/.test(text));

        const loginIntentInBody =
          /\blog in\b|\bsign in\b|\bauthentication\b|\bverify your identity\b|\bsecurity code\b/.test(body);
        const strongLoginWall =
          visiblePasswordField ||
          visibleOtpField ||
          (
            visibleIdentifierField &&
            (visibleSignInAction || visibleLoginHeading || loginIntentInBody || loginPath)
          ) ||
          (visibleSignInAction && (visibleLoginHeading || loginIntentInBody || loginPath));

        if (accountMarkerVisible && !strongLoginWall) {
          return true;
        }

        if (strongLoginWall) {
          return false;
        }

        if (loginPath || /accounts\.google\.com|auth0|okta|signin/.test(url)) {
          return false;
        }

        if (/\bverify your identity\b|\benter your password\b|\bsecurity code\b/.test(body)) {
          return false;
        }

        return true;
      })
      .catch(() => false);
  }

  async persistStorageState() {
    if (!this.context || !this.storageStatePath) {
      return false;
    }
    await fs.mkdir(path.dirname(this.storageStatePath), { recursive: true }).catch(() => {});
    await this.context.storageState({ path: this.storageStatePath }).catch(() => {});
    return true;
  }

  async close({ status = "passed" } = {}) {
    const captureVideoMode = this.runConfig?.artifacts?.captureVideo ?? "fail-only";
    const shouldRecordVideo =
      captureVideoMode === "always" ||
      (captureVideoMode === "fail-only" && this.isFunctionalMode());
    const shouldKeepVideo =
      captureVideoMode === "always" ||
      (captureVideoMode === "fail-only" && status === "failed");

    if (this.traceStarted) {
      if (this.runConfig?.artifacts?.captureTraceOnFail && status === "failed") {
        await this.context?.tracing.stop({ path: this.tracePath }).catch(() => {});
      } else {
        await this.context?.tracing.stop().catch(() => {});
      }
      this.traceStarted = false;
    }

    await this.persistStorageState();

    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});

    if (this.runConfig?.artifacts?.captureHar && (await this.hasFile(this.harPath))) {
      this.artifactIndex.har = this.buildArtifactRef(this.harPath);
    }

    if (
      this.runConfig?.artifacts?.captureTraceOnFail &&
      status === "failed" &&
      (await this.hasFile(this.tracePath))
    ) {
      this.artifactIndex.trace = this.buildArtifactRef(this.tracePath);
    }

    if (shouldRecordVideo && this.videoHandle) {
      const videoPath = await this.videoHandle.path().catch(() => null);
      if (videoPath && (await this.hasFile(videoPath))) {
        if (shouldKeepVideo) {
          this.appendArtifact("video", this.buildArtifactRef(videoPath));
        } else {
          await fs.unlink(videoPath).catch(() => {});
        }
      }
    }

    return this.getArtifactIndex();
  }
}
