import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "../lib/config.js";
import { hashText, sleep } from "../lib/utils.js";

export class BrowserSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.sessionDir = path.join(config.artifactsDir, sessionId);
    this.framesDir = path.join(this.sessionDir, "frames");
  }

  async launch() {
    await fs.mkdir(this.framesDir, { recursive: true });
    this.browser = await chromium.launch({
      headless: config.headless
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    this.page = await this.context.newPage();
  }

  async goto(url) {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await this.page.waitForTimeout(1_000);
  }

  async capture(step) {
    const screenshotPath = path.join(this.framesDir, `step-${String(step).padStart(3, "0")}.png`);
    await this.page.screenshot({
      path: screenshotPath,
      fullPage: true
    });

    const base64 = await fs.readFile(screenshotPath, "base64");
    const pageState = await this.page.evaluate(() => {
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
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
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

        return null;
      }

      const interactive = Array.from(
        document.querySelectorAll("button, a, input, textarea, select, [role='button']")
      )
        .filter((element) => isElementVisible(element))
        .slice(0, 60)
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          return {
            elementId: `el-${index + 1}`,
            tag: element.tagName.toLowerCase(),
            text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
            selector: makeSelector(element),
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
        pressed: pageState.interactive.map((item) => item.pressed),
        overlays: pageState.overlays.map((item) => item.text),
        spinnerVisible: pageState.spinnerVisible
      })
    );

    return {
      ...pageState,
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

    const target = snapshot.interactive.find((item) => item.elementId === action.elementId) ?? null;

    if (!target) {
      throw new Error(`Target element ${action.elementId} was not present in the current snapshot`);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= config.actionRetryCount; attempt += 1) {
      try {
        if (target.selector) {
          const locator = this.page.locator(target.selector).first();
          await locator.waitFor({ state: "visible", timeout: 1_500 });

          if (action.type === "type") {
            await locator.click({ timeout: 2_000 });
            await locator.fill(action.text ?? "");
          } else {
            await locator.click({ timeout: 2_000 });
          }
        } else {
          await this.page.mouse.click(target.bounds.centerX, target.bounds.centerY);
          if (action.type === "type" && action.text) {
            await this.page.keyboard.press("Meta+A").catch(() => {});
            await this.page.keyboard.type(action.text);
          }
        }

        await this.page.waitForLoadState("domcontentloaded", { timeout: 4_000 }).catch(() => {});
        await this.page.waitForTimeout(800);
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

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
