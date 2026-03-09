import { evaluateContrastSample } from "../contrastMath.js";

function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toLower(value = "") {
  return normalizeText(value).toLowerCase();
}

function buildIssue(issue, snapshot) {
  const ruleId = issue.ruleId ?? issue.issueType ?? "A11Y_RULE";
  return {
    ruleId,
    issueType: ruleId,
    severity: issue.severity ?? "P2",
    title: issue.title,
    expected: issue.expected,
    actual: issue.actual,
    confidence: issue.confidence ?? 0.8,
    evidenceRefs: issue.evidenceRefs ?? [],
    affectedSelector: issue.affectedSelector ?? null,
    affectedUrl: issue.affectedUrl ?? snapshot?.url ?? null,
    step: issue.step ?? snapshot?.step ?? null,
    viewportLabel: issue.viewportLabel ?? snapshot?.viewportLabel ?? null,
    focusProbe: issue.focusProbe ?? null,
    formProbe: issue.formProbe ?? null
  };
}

function summarizeFocusProbe(probe = {}) {
  return {
    maxTabs: probe.maxTabs ?? 0,
    totalFocusableCount: probe.totalFocusableCount ?? 0,
    uniqueFocusedCount: probe.uniqueFocusedCount ?? 0,
    anyVisibleIndicator: Boolean(probe.anyVisibleIndicator),
    loopDetected: Boolean(probe.loopDetected),
    potentialTrap: Boolean(probe.potentialTrap),
    repeatedSelectors: (probe.repeatedSelectors ?? []).slice(0, 6),
    sampleSteps: (probe.steps ?? []).slice(0, 6).map((step) => ({
      step: step.step,
      selector: step.selector ?? null,
      role: step.role ?? "",
      accessibleName: step.accessibleName ?? "",
      visibleFocusIndicator: Boolean(step.visibleFocusIndicator)
    }))
  };
}

function traverseA11yTree(node, visit) {
  if (!node || typeof node !== "object") {
    return;
  }
  visit(node);
  for (const child of node.children ?? []) {
    traverseA11yTree(child, visit);
  }
}

function collectA11yRoles(root) {
  const roles = new Set();
  traverseA11yTree(root, (node) => {
    const role = toLower(node.role);
    if (role) {
      roles.add(role);
    }
  });
  return roles;
}

function collectHeadingLevels(snapshot = {}) {
  if (Array.isArray(snapshot.headings) && snapshot.headings.length > 0) {
    return snapshot.headings
      .map((heading) => Number.parseInt(String(heading.level ?? ""), 10))
      .filter((level) => Number.isInteger(level) && level >= 1 && level <= 6);
  }

  const levels = [];
  traverseA11yTree(snapshot.accessibilitySnapshot, (node) => {
    const role = toLower(node.role);
    if (role !== "heading") {
      return;
    }
    const level = Number.parseInt(String(node.level ?? ""), 10);
    if (Number.isInteger(level) && level >= 1 && level <= 6) {
      levels.push(level);
    }
  });
  return levels;
}

function isDecorativeImage(image = {}) {
  const role = toLower(image.role);
  return role === "presentation" || role === "none" || image.ariaHidden === true;
}

function isVisibleFormControl(control = {}) {
  return control.inViewport !== false;
}

function isLabelMissing(control = {}) {
  const type = toLower(control.type);
  if (["hidden", "submit", "button", "reset", "image", "range", "color", "file", "checkbox", "radio"].includes(type)) {
    return false;
  }

  return !normalizeText(control.name) && !normalizeText(control.labelText) && !normalizeText(control.ariaLabel);
}

function isLikelyLargeHeader(snapshot = {}) {
  const viewportWidth = Math.max(Number(snapshot.viewportWidth ?? 0), 1);
  const viewportHeight = Math.max(Number(snapshot.viewportHeight ?? 0), 1);
  const viewportArea = viewportWidth * viewportHeight;
  const landmarks = snapshot.headerLandmarks ?? [];

  return landmarks.some((landmark) => {
    const bounds = landmark.bounds ?? {};
    const width = Number(bounds.width ?? 0);
    const height = Number(bounds.height ?? 0);
    const areaRatio = (width * height) / viewportArea;
    return landmark.inViewport !== false && ((width >= viewportWidth * 0.6 && height >= 56) || areaRatio >= 0.08);
  });
}

function normalizeContext(value = "") {
  return toLower(value).replace(/\s+/g, " ").trim();
}

export const missingFormLabelRule = {
  id: "MISSING_FORM_LABEL",
  run({ snapshot, evidenceRefs }) {
    const control = (snapshot.formControls ?? [])
      .filter((item) => isVisibleFormControl(item))
      .find((item) => isLabelMissing(item));

    if (!control) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "MISSING_FORM_LABEL",
        severity: "P1",
        title: "Visible form input is missing a usable label",
        expected: "Visible form inputs should expose a name, label text, or aria-label.",
        actual: `Input${control.selector ? ` ${control.selector}` : ""} is missing name/label/aria-label.`,
        confidence: 0.93,
        evidenceRefs,
        affectedSelector: control.selector ?? null
      },
      snapshot
    );
  }
};

export const imageMissingAltRule = {
  id: "IMAGE_MISSING_ALT",
  run({ snapshot, evidenceRefs }) {
    const missingAlt = (snapshot.images ?? []).find((image) => {
      if (image.inViewport === false) {
        return false;
      }
      if (isDecorativeImage(image)) {
        return false;
      }
      return normalizeText(image.alt).length === 0;
    });

    if (!missingAlt) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "IMAGE_MISSING_ALT",
        severity: "P2",
        title: "Visible image is missing alt text",
        expected: "Non-decorative visible images should provide meaningful alt text.",
        actual: `Image${missingAlt.selector ? ` ${missingAlt.selector}` : ""} has empty/missing alt text.`,
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: missingAlt.selector ?? null
      },
      snapshot
    );
  }
};

export const buttonNameMissingRule = {
  id: "BUTTON_NAME_MISSING",
  run({ snapshot, evidenceRefs }) {
    const target = (snapshot.interactive ?? []).find((item) => {
      if (item.inViewport === false || item.disabled) {
        return false;
      }
      if (!["button", "a"].includes(item.tag)) {
        return false;
      }
      const label = normalizeText(item.text || item.ariaLabel || item.placeholder || "");
      return label.length === 0;
    });

    if (!target) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "BUTTON_NAME_MISSING",
        severity: "P1",
        title: "Interactive control is missing an accessible name",
        expected: "Visible buttons and links should expose a non-empty accessible name.",
        actual: `Control${target.selector ? ` ${target.selector}` : ""} has no discernible label text.`,
        confidence: 0.91,
        evidenceRefs,
        affectedSelector: target.selector ?? null
      },
      snapshot
    );
  }
};

export const headingOrderSuspiciousRule = {
  id: "HEADING_ORDER_SUSPICIOUS",
  run({ snapshot, evidenceRefs }) {
    const levels = collectHeadingLevels(snapshot);
    if (levels.length < 2) {
      return null;
    }

    let jumpIndex = -1;
    for (let index = 1; index < levels.length; index += 1) {
      const previous = levels[index - 1];
      const current = levels[index];
      if (current > previous + 1) {
        jumpIndex = index;
        break;
      }
    }

    if (jumpIndex < 0) {
      return null;
    }

    const previous = levels[jumpIndex - 1];
    const current = levels[jumpIndex];
    return buildIssue(
      {
        ruleId: "HEADING_ORDER_SUSPICIOUS",
        severity: "P2",
        title: "Heading level order appears inconsistent",
        expected: "Heading levels should not jump by more than one level in document order.",
        actual: `Detected heading jump from h${previous} to h${current}.`,
        confidence: 0.8,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const landmarksMissingRule = {
  id: "LANDMARKS_MISSING",
  run({ snapshot, evidenceRefs }) {
    const hasMainFromDom = snapshot.hasMainLandmark === true;
    const roles = collectA11yRoles(snapshot.accessibilitySnapshot);
    const hasMainFromA11y = roles.has("main");

    if (hasMainFromDom || hasMainFromA11y) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "LANDMARKS_MISSING",
        severity: "P2",
        title: "Main landmark is missing",
        expected: "Pages should expose a main landmark for assistive navigation.",
        actual: "No main landmark was found in DOM or accessibility tree signals.",
        confidence: 0.89,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const focusableHiddenRule = {
  id: "FOCUSABLE_HIDDEN",
  run({ snapshot, evidenceRefs }) {
    const hidden = (snapshot.focusableHiddenElements ?? []).find((entry) => entry?.selector);
    if (!hidden) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "FOCUSABLE_HIDDEN",
        severity: "P1",
        title: "Focusable element is hidden",
        expected: "Focusable controls should be visible when they can receive keyboard focus.",
        actual: `Focusable element ${hidden.selector} is hidden or off-screen.`,
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: hidden.selector
      },
      snapshot
    );
  }
};

export const keyboardFocusNotVisibleRule = {
  id: "KEYBOARD_FOCUS_NOT_VISIBLE",
  run({ snapshot, evidenceRefs }) {
    const probe = snapshot.focusA11yProbe;
    if (!probe?.attempted || !probe.anyFocusable || probe.anyVisibleIndicator) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "KEYBOARD_FOCUS_NOT_VISIBLE",
        severity: "P1",
        title: "Keyboard focus indicator is not visible",
        expected: "TAB navigation should produce a visible focus indicator for at least one focusable element.",
        actual: `Focus probe tabbed through ${probe.steps?.length ?? 0} elements without detecting a visible focus indicator.`,
        confidence: 0.92,
        evidenceRefs,
        affectedSelector: probe.steps?.[0]?.selector ?? null,
        focusProbe: summarizeFocusProbe(probe)
      },
      snapshot
    );
  }
};

export const focusTrapDetectedRule = {
  id: "FOCUS_TRAP_DETECTED",
  run({ snapshot, evidenceRefs }) {
    const probe = snapshot.focusA11yProbe;
    if (!probe?.attempted || !probe.anyFocusable) {
      return null;
    }

    const trapDetected =
      Boolean(probe.potentialTrap) ||
      (Boolean(probe.loopDetected) &&
        Number(probe.uniqueFocusedCount ?? 0) <= 3 &&
        Number(probe.totalFocusableCount ?? 0) > Number(probe.uniqueFocusedCount ?? 0));

    if (!trapDetected) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "FOCUS_TRAP_DETECTED",
        severity: "P1",
        title: "Keyboard focus appears trapped",
        expected: "TAB navigation should progress beyond a tiny repeating focus loop when more focusable elements exist.",
        actual:
          `Focus loop repeated within ${probe.uniqueFocusedCount ?? 0} elements while ` +
          `${probe.totalFocusableCount ?? 0} focusable elements were detected on the page.`,
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: probe.repeatedSelectors?.[0] ?? probe.steps?.[0]?.selector ?? null,
        focusProbe: summarizeFocusProbe(probe)
      },
      snapshot
    );
  }
};

export const modalMissingAccessibleNameRule = {
  id: "MODAL_MISSING_ACCESSIBLE_NAME",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.overlays ?? [])
      .filter((overlay) => overlay?.isModalDialog)
      .find((overlay) => !overlay.hasAccessibleName && (overlay.areaRatio ?? 0) >= 0.12);

    if (!candidate) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "MODAL_MISSING_ACCESSIBLE_NAME",
        severity: "P1",
        title: "Modal dialog is missing an accessible name",
        expected: "Modal dialogs should expose an accessible name via aria-label, aria-labelledby, or a clear heading.",
        actual: "Detected modal/dialog has no accessible name signal.",
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const modalNotDismissableRule = {
  id: "MODAL_NOT_DISMISSABLE",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.overlays ?? [])
      .filter((overlay) => overlay?.isModalDialog)
      .find((overlay) => (overlay.isBlocking || (overlay.areaRatio ?? 0) >= 0.25) && !overlay.hasDismissAction);

    if (!candidate) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "MODAL_NOT_DISMISSABLE",
        severity: "P1",
        title: "Blocking modal has no dismiss control",
        expected: "Blocking modals should provide a visible dismiss action (close/cancel/not now).",
        actual: `Modal covering ${Math.round((candidate.areaRatio ?? 0) * 100)}% of viewport exposes no dismiss control.`,
        confidence: 0.94,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const skipLinkMissingRule = {
  id: "SKIP_LINK_MISSING",
  run({ snapshot, evidenceRefs }) {
    if (!snapshot.hasMainLandmark || snapshot.hasSkipLink || !isLikelyLargeHeader(snapshot)) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "SKIP_LINK_MISSING",
        severity: "P2",
        title: "Skip link is missing on page with large header/nav",
        expected: "Pages with large persistent header/navigation should expose a skip link to main content.",
        actual: "No skip-to-content link was detected while a large header/navigation landmark is present.",
        confidence: 0.72,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const genericLinkTextRule = {
  id: "GENERIC_LINK_TEXT",
  run({ snapshot, evidenceRefs }) {
    const genericPattern = /^(click here|read more|learn more|more|details|here|view)$/i;

    const candidate = (snapshot.interactive ?? [])
      .filter((item) => item.tag === "a" && item.inViewport && !item.disabled)
      .filter((item) => item.zone !== "Header")
      .find((item) => {
        const label = normalizeText(item.text || item.ariaLabel || "");
        if (!label || !genericPattern.test(label)) {
          return false;
        }

        const context = normalizeContext(item.contextText || "");
        const normalizedLabel = normalizeContext(label);
        const trimmedContext = context.replace(normalizedLabel, "").trim();
        return trimmedContext.length < 25;
      });

    if (!candidate) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "GENERIC_LINK_TEXT",
        severity: "P2",
        title: "Generic link text without meaningful nearby context",
        expected: "Links should provide descriptive text or be paired with nearby context that clarifies destination/purpose.",
        actual: `Link label "${candidate.text}" appears generic without sufficient contextual text.`,
        confidence: 0.58,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const lowContrastTextRule = {
  id: "LOW_CONTRAST_TEXT",
  run({ snapshot, evidenceRefs }) {
    const contrast = snapshot.contrastSamples;
    if (!contrast?.enabled) {
      return null;
    }

    const worst = (contrast.offenders ?? [])
      .map((sample) => ({
        ...sample,
        evaluation: evaluateContrastSample(sample, {
          minRatioNormalText: contrast.minRatioNormalText,
          minRatioLargeText: contrast.minRatioLargeText
        })
      }))
      .sort((left, right) => left.evaluation.ratio - right.evaluation.ratio)[0];

    if (!worst || worst.evaluation.passes) {
      return null;
    }

    const gap = worst.evaluation.requiredRatio - worst.evaluation.ratio;
    const severity = gap >= 1.5 ? "P1" : "P2";
    return buildIssue(
      {
        ruleId: "LOW_CONTRAST_TEXT",
        severity,
        title: severity === "P1" ? "Critical low contrast text detected" : "Low contrast text detected",
        expected:
          `Visible text should meet contrast ratio ${contrast.minRatioNormalText}:1 (normal) or ` +
          `${contrast.minRatioLargeText}:1 (large).`,
        actual:
          `Text "${worst.textSample}" has contrast ${worst.evaluation.ratio}:1 ` +
          `but requires ${worst.evaluation.requiredRatio}:1.`,
        confidence: 0.91,
        evidenceRefs,
        affectedSelector: worst.selector ?? null
      },
      snapshot
    );
  }
};

export const textScaleBreaksLayoutRule = {
  id: "TEXT_SCALE_BREAKS_LAYOUT",
  run({ snapshot, evidenceRefs }) {
    const findings = snapshot.textScaleFindings;
    if (!findings?.enabled) {
      return null;
    }

    const breaking = (findings.results ?? [])
      .filter((entry) => entry.breaksLayout)
      .sort((left, right) => {
        const leftScore = (left.deltaHorizontalOverflow ?? 0) + (left.deltaTextOverflowCount ?? 0) * 24;
        const rightScore = (right.deltaHorizontalOverflow ?? 0) + (right.deltaTextOverflowCount ?? 0) * 24;
        return rightScore - leftScore;
      })[0];

    if (!breaking) {
      return null;
    }

    const severity =
      (breaking.deltaHorizontalOverflow ?? 0) >= 80 || (breaking.deltaTextOverflowCount ?? 0) >= 5
        ? "P1"
        : "P2";

    return buildIssue(
      {
        ruleId: "TEXT_SCALE_BREAKS_LAYOUT",
        severity,
        title: "Text scaling introduces layout breakage",
        expected: "Increasing text scale should not introduce major horizontal overflow or clipped text content.",
        actual:
          `At scale ${breaking.scale}x, horizontal overflow increased by ${breaking.deltaHorizontalOverflow ?? 0}px ` +
          `and text overflow count changed by ${breaking.deltaTextOverflowCount ?? 0}.`,
        confidence: 0.88,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const reducedMotionNotRespectedRule = {
  id: "REDUCED_MOTION_NOT_RESPECTED",
  run({ snapshot, evidenceRefs }) {
    const findings = snapshot.reducedMotionFindings;
    if (!findings?.enabled) {
      return null;
    }

    if ((findings.longAnimationCount ?? 0) < 5) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "REDUCED_MOTION_NOT_RESPECTED",
        severity: "P2",
        title: "Prefers-reduced-motion appears to be ignored",
        expected: "With reduced-motion preference, long-running animations should be significantly reduced.",
        actual: `Detected ${findings.longAnimationCount} long animations while reduced-motion was emulated.`,
        confidence: 0.79,
        evidenceRefs,
        affectedSelector: findings.longAnimationSelectors?.[0]?.selector ?? null
      },
      snapshot
    );
  }
};

export const requiredNotAnnouncedRule = {
  id: "REQUIRED_NOT_ANNOUNCED",
  run({ snapshot, evidenceRefs }) {
    const descriptor = (snapshot.formControlDescriptors ?? []).find(
      (entry) => entry.requiredAttr && !entry.ariaRequired && !entry.requiredIndicatorNearLabel
    );
    if (!descriptor) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "REQUIRED_NOT_ANNOUNCED",
        severity: "P1",
        title: "Required field is not announced clearly",
        expected: "Required fields should expose aria-required or a clear required indicator near the label.",
        actual: `Field${descriptor.selector ? ` ${descriptor.selector}` : ""} is required but missing aria-required and label indicator.`,
        confidence: 0.86,
        evidenceRefs,
        affectedSelector: descriptor.selector ?? null
      },
      snapshot
    );
  }
};

export const errorNotAssociatedRule = {
  id: "ERROR_NOT_ASSOCIATED",
  run({ snapshot, evidenceRefs }) {
    const error = (snapshot.visibleErrorMessages ?? []).find((entry) => !entry.associatedFieldSelector);
    if (!error) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "ERROR_NOT_ASSOCIATED",
        severity: "P1",
        title: "Error message is not associated with a field",
        expected: "Visible form errors should associate with a control via aria-describedby or clear proximity mapping.",
        actual: `Error${error.selector ? ` ${error.selector}` : ""} has no associated form control.`,
        confidence: 0.87,
        evidenceRefs,
        affectedSelector: error.selector ?? null
      },
      snapshot
    );
  }
};

export const errorNotAnnouncedRule = {
  id: "ERROR_NOT_ANNOUNCED",
  run({ snapshot, evidenceRefs }) {
    const error = (snapshot.visibleErrorMessages ?? []).find((entry) => !entry.roleAlert && !entry.ariaLive);
    if (!error) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "ERROR_NOT_ANNOUNCED",
        severity: "P2",
        title: "Error message is not announced to assistive tech",
        expected: "Visible form errors should use role=alert or aria-live to announce updates.",
        actual: `Error${error.selector ? ` ${error.selector}` : ""} has no role=alert or aria-live signal.`,
        confidence: 0.79,
        evidenceRefs,
        affectedSelector: error.selector ?? null
      },
      snapshot
    );
  }
};

export const invalidFieldNotFocusedRule = {
  id: "INVALID_FIELD_NOT_FOCUSED",
  run({ snapshot, evidenceRefs }) {
    const probe = snapshot.formValidationProbe;
    if (!probe?.attempted || probe.mode !== "safe-submit") {
      return null;
    }
    if (!probe.expectedInvalidSelector) {
      return null;
    }

    const focusedSelector = snapshot.firstInvalidFocusAfterSubmit?.selector ?? probe.firstInvalidFocusAfterSubmit?.selector ?? null;
    if (focusedSelector === probe.expectedInvalidSelector) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "INVALID_FIELD_NOT_FOCUSED",
        severity: "P1",
        title: "Validation did not focus the first invalid field",
        expected: `After safe submit, focus should move to ${probe.expectedInvalidSelector}.`,
        actual: `Focus moved to ${focusedSelector ?? "none"} after validation.`,
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: probe.expectedInvalidSelector,
        formProbe: {
          expectedInvalidSelector: probe.expectedInvalidSelector,
          focusedSelector,
          submitType: probe.submitType ?? "search"
        }
      },
      snapshot
    );
  }
};

export const describedByMissingTargetRule = {
  id: "DESCRIBEDBY_MISSING_TARGET",
  run({ snapshot, evidenceRefs }) {
    const descriptor = (snapshot.formControlDescriptors ?? []).find(
      (entry) => (entry.ariaDescribedByMissingIds ?? []).length > 0
    );
    if (!descriptor) {
      return null;
    }

    return buildIssue(
      {
        ruleId: "DESCRIBEDBY_MISSING_TARGET",
        severity: "P2",
        title: "aria-describedby references missing target",
        expected: "aria-describedby should reference existing IDs in the current document.",
        actual:
          `Field${descriptor.selector ? ` ${descriptor.selector}` : ""} references missing ids: ` +
          `${(descriptor.ariaDescribedByMissingIds ?? []).join(", ")}.`,
        confidence: 0.85,
        evidenceRefs,
        affectedSelector: descriptor.selector ?? null
      },
      snapshot
    );
  }
};

export const baselineA11yRules = [
  missingFormLabelRule,
  imageMissingAltRule,
  buttonNameMissingRule,
  headingOrderSuspiciousRule,
  landmarksMissingRule,
  focusableHiddenRule,
  keyboardFocusNotVisibleRule,
  focusTrapDetectedRule,
  modalMissingAccessibleNameRule,
  modalNotDismissableRule,
  skipLinkMissingRule,
  genericLinkTextRule,
  lowContrastTextRule,
  textScaleBreaksLayoutRule,
  reducedMotionNotRespectedRule,
  requiredNotAnnouncedRule,
  errorNotAssociatedRule,
  errorNotAnnouncedRule,
  invalidFieldNotFocusedRule,
  describedByMissingTargetRule
];
