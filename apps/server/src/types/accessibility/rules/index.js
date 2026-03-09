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
    viewportLabel: issue.viewportLabel ?? snapshot?.viewportLabel ?? null
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

export const baselineA11yRules = [
  missingFormLabelRule,
  imageMissingAltRule,
  buttonNameMissingRule,
  headingOrderSuspiciousRule,
  landmarksMissingRule,
  focusableHiddenRule
];
