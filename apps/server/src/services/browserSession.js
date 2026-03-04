import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "../lib/config.js";
import { hashText, sleep } from "../lib/utils.js";

export class BrowserSession {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.storageStatePath = options.storageStatePath ?? config.storageStatePath;
    this.sessionDir = path.join(config.artifactsDir, sessionId);
    this.framesDir = path.join(this.sessionDir, "frames");
    this.consoleBuffer = [];
    this.networkSummary = {
      totalRequests: 0,
      failedRequests: 0,
      status4xx: 0,
      status5xx: 0,
      lastFailures: []
    };
  }

  async launch() {
    await fs.mkdir(this.framesDir, { recursive: true });
    this.browser = await chromium.launch({
      headless: config.headless
    });
    const contextOptions = {
      viewport: { width: 1440, height: 900 }
    };

    if (this.storageStatePath && (await this.hasStorageState(this.storageStatePath))) {
      contextOptions.storageState = this.storageStatePath;
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    this.attachTelemetry();
  }

  attachTelemetry() {
    this.page.on("console", (message) => {
      if (!["error", "warning"].includes(message.type())) {
        return;
      }

      this.consoleBuffer = [
        ...this.consoleBuffer,
        `${message.type().toUpperCase()}: ${message.text().slice(0, 240)}`
      ].slice(-20);
    });

    this.page.on("requestfailed", (request) => {
      this.networkSummary.totalRequests += 1;
      this.networkSummary.failedRequests += 1;
      this.networkSummary.lastFailures = [
        ...this.networkSummary.lastFailures,
        `${request.method()} ${request.url().slice(0, 180)}`
      ].slice(-12);
    });

    this.page.on("response", (response) => {
      this.networkSummary.totalRequests += 1;
      const status = response.status();
      if (status >= 400 && status < 500) {
        this.networkSummary.status4xx += 1;
      }
      if (status >= 500) {
        this.networkSummary.status5xx += 1;
        this.networkSummary.lastFailures = [
          ...this.networkSummary.lastFailures,
          `${status} ${response.url().slice(0, 180)}`
        ].slice(-12);
      }
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

  async goto(url) {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await this.waitForInteractiveReady();
    await this.applySiteGuards(url);
    await this.page.waitForTimeout(config.postActionDelayMs);
  }

  async waitForInteractiveReady() {
    await this.page.waitForLoadState("domcontentloaded", { timeout: config.domReadyTimeoutMs }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: config.networkIdleTimeoutMs }).catch(() => {});
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

  async capture(step) {
    await this.applySiteGuards();

    const screenshotPath = path.join(this.framesDir, `step-${String(step).padStart(3, "0")}.png`);
    await this.page.screenshot({
      path: screenshotPath,
      fullPage: true
    });

    const base64 = await fs.readFile(screenshotPath, "base64");
    const accessibilitySnapshot =
      typeof this.page.accessibility?.snapshot === "function"
        ? await this.page.accessibility.snapshot({ interestingOnly: true }).catch(() => null)
        : null;
    const pageState = await this.page.evaluate(() => {
      const genericIds = new Set(["button", "content", "text", "icon", "img", "endpoint", "title"]);

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

      const interactive = Array.from(
        document.querySelectorAll("button, a, input, textarea, select, [role='button']")
      )
        .filter((element) => isElementVisible(element))
        .slice(0, 60)
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          const label = getElementLabel(element);
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
            disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
            pressed: element.getAttribute("aria-pressed") === "true",
            checked: element instanceof HTMLInputElement ? element.checked : false,
            value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "",
            bounds: {
              x: rect.x + window.scrollX,
              y: rect.y + window.scrollY,
              width: rect.width,
              height: rect.height,
              centerX: rect.x + window.scrollX + rect.width / 2,
              centerY: rect.y + window.scrollY + rect.height / 2
            }
          };
        });

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
          center: [Math.round(element.bounds.centerX), Math.round(element.bounds.centerY)]
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
          const rect = element.getBoundingClientRect();
          return {
            overlayId: `overlay-${index + 1}`,
            text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160) ?? "",
            selector: makeSelector(element),
            bounds: {
              x: rect.x + window.scrollX,
              y: rect.y + window.scrollY,
              width: rect.width,
              height: rect.height
            }
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

      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 2400),
        readyState: document.readyState,
        pageWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
          window.innerWidth
        ),
        pageHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          window.innerHeight
        ),
        interactive,
        semanticMap,
        accessibilityTree,
        overlays,
        spinnerVisible,
        spinnerBounds
      };
    });

    const hash = hashText(
      JSON.stringify({
        title: pageState.title,
        bodyText: pageState.bodyText,
        interactive: pageState.interactive.map((item) => [item.text, item.tag, item.disabled]),
        semanticMap: pageState.semanticMap.map((item) => [item.text, item.zone, item.center.join(",")]),
        pressed: pageState.interactive.map((item) => item.pressed),
        overlays: pageState.overlays.map((item) => item.text),
        spinnerVisible: pageState.spinnerVisible
      })
    );

    return {
      step,
      ...pageState,
      accessibilitySnapshot,
      consoleErrors: [...this.consoleBuffer],
      networkSummary: { ...this.networkSummary },
      hash,
      screenshotPath,
      screenshotBase64: base64
    };
  }

  async executeAction(action, snapshot) {
    if (action.type === "wait") {
      await this.page.waitForTimeout(action.durationMs ?? 1_000);
      return { ok: true, mode: "wait" };
    }

    if (action.type === "scroll") {
      await this.page.mouse.wheel(0, action.deltaY ?? 500);
      await this.page.waitForTimeout(500);
      return { ok: true, mode: "scroll" };
    }

    if (action.type === "goto") {
      await this.goto(action.url);
      return { ok: true, mode: "goto" };
    }

    if (action.type === "back") {
      await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
      await this.waitForInteractiveReady();
      return { ok: true, mode: "back" };
    }

    if (action.type === "refresh") {
      await this.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      await this.waitForInteractiveReady();
      return { ok: true, mode: "refresh" };
    }

    const target = snapshot.interactive.find((item) => item.elementId === action.elementId) ?? null;

    if (!target) {
      throw new Error(`Target element ${action.elementId} was not present in the current snapshot`);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= config.actionRetryCount; attempt += 1) {
      try {
        await this.waitForInteractiveReady();
        await this.applySiteGuards(snapshot.url);

        if (await this.handleSpecialAction(action, target, snapshot)) {
          await this.waitForInteractiveReady();
          await this.page.waitForTimeout(config.postActionDelayMs);
          return {
            ok: true,
            mode: action.type,
            attempt
          };
        }

        const locator = this.resolveLocator(target);
        if (locator) {
          await locator.waitFor({ state: "visible", timeout: config.selectorVisibleTimeoutMs });
          await locator.scrollIntoViewIfNeeded().catch(() => {});
          const targetCoords = await this.getLocatorCenter(locator);

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

        await this.waitForInteractiveReady();
        await this.page.waitForTimeout(config.postActionDelayMs);
        return {
          ok: true,
          mode: action.type,
          attempt
        };
      } catch (error) {
        lastError = error;
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

  async isAuthenticated() {
    return this.page
      .evaluate(() => {
        const body = document.body?.innerText?.toLowerCase?.() ?? "";
        const profileButton =
          document.querySelector("button[aria-label*='Account']") ||
          document.querySelector("button[aria-label*='Google Account']") ||
          document.querySelector("img[alt*='avatar']");
        const signIn = Array.from(document.querySelectorAll("button, a"))
          .map((element) => (element.textContent || element.getAttribute("aria-label") || "").toLowerCase())
          .some((text) => /\bsign in\b|\blog in\b/.test(text));

        return Boolean(profileButton) || (!signIn && !/accounts\.google\.com/.test(window.location.href) && !/\bsign in\b/.test(body));
      })
      .catch(() => false);
  }

  async close() {
    if (this.context && this.storageStatePath) {
      await fs.mkdir(path.dirname(this.storageStatePath), { recursive: true }).catch(() => {});
      await this.context.storageState({ path: this.storageStatePath }).catch(() => {});
    }
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
