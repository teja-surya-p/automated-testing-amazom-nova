import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseBestUiuxCandidate,
  classifyUiuxElement,
  rankUiuxCandidate
} from "../../../library/policies/uiControlClassifier.js";

test("classifyUiuxElement marks destructive actions correctly", () => {
  const destructive = classifyUiuxElement({
    elementId: "el-1",
    tag: "button",
    text: "Delete account",
    ariaLabel: "",
    placeholder: "",
    name: "",
    href: ""
  });

  assert.equal(destructive.category, "DESTRUCTIVE");
});

test("chooseBestUiuxCandidate prefers safe navigation over risky submit", () => {
  const snapshot = {
    interactive: [
      {
        elementId: "el-submit",
        tag: "button",
        text: "Create account",
        ariaLabel: "",
        placeholder: "",
        name: "",
        href: "",
        disabled: false,
        zone: "Primary Content",
        pressed: false
      },
      {
        elementId: "el-nav",
        tag: "a",
        text: "Pricing",
        ariaLabel: "",
        placeholder: "",
        name: "",
        href: "https://example.com/pricing",
        disabled: false,
        zone: "Header",
        pressed: false
      }
    ]
  };

  const best = chooseBestUiuxCandidate(snapshot, []);
  assert.equal(best.candidate.elementId, "el-nav");
  assert.equal(best.classification.category, "LOW_RISK");
});

test("classifyUiuxElement treats auth entry controls as low risk", () => {
  const result = classifyUiuxElement({
    elementId: "el-login",
    tag: "button",
    text: "Sign in",
    ariaLabel: "",
    placeholder: "",
    name: "",
    href: ""
  });

  assert.equal(result.category, "LOW_RISK");
  assert.equal(result.suggestedAction?.type, "click");
});

test("rankUiuxCandidate applies repeat penalty deterministically", () => {
  const repeatedLabels = new Set(["Pricing"]);
  const withPenalty = rankUiuxCandidate({
    candidate: {
      elementId: "el-nav",
      tag: "a",
      text: "Pricing",
      ariaLabel: "",
      placeholder: "",
      name: "",
      href: "https://example.com/pricing",
      disabled: false,
      zone: "Header",
      pressed: false
    },
    repeatedLabels
  });
  const withoutPenalty = rankUiuxCandidate({
    candidate: {
      elementId: "el-menu",
      tag: "button",
      text: "Menu",
      ariaLabel: "",
      placeholder: "",
      name: "",
      href: "",
      disabled: false,
      zone: "Header",
      pressed: false
    },
    repeatedLabels: new Set()
  });

  assert.equal(withPenalty.score < withoutPenalty.score, true);
});

test("chooseBestUiuxCandidate skips covered visible controls", () => {
  const snapshot = {
    interactive: [
      {
        elementId: "el-covered",
        tag: "a",
        text: "Home",
        ariaLabel: "",
        placeholder: "",
        name: "",
        href: "https://example.com/home",
        disabled: false,
        zone: "Header",
        pressed: false,
        inViewport: true,
        centerProbe: {
          targetInViewport: true,
          sameTarget: false,
          covered: true
        }
      },
      {
        elementId: "el-safe",
        tag: "a",
        text: "Pricing",
        ariaLabel: "",
        placeholder: "",
        name: "",
        href: "https://example.com/pricing",
        disabled: false,
        zone: "Header",
        pressed: false,
        inViewport: true,
        centerProbe: {
          targetInViewport: true,
          sameTarget: true,
          covered: false
        }
      }
    ]
  };

  const best = chooseBestUiuxCandidate(snapshot, []);
  assert.equal(best.candidate.elementId, "el-safe");
});
