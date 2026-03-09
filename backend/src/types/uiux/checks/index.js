import { classifyUiuxElement } from "../../../library/policies/uiControlClassifier.js";
import { normalizePathFromUrl } from "../../../library/reporting/clustering.js";
import {
  jaccardSimilarity,
  normalizeNavLabels,
  resolvePrimaryPageType
} from "../../../library/metrics/similarity.js";

function buildIssue(issue, snapshot) {
  const viewport = {
    width: Math.max(Number(snapshot?.viewportWidth ?? 0), 1),
    height: Math.max(Number(snapshot?.viewportHeight ?? 0), 1)
  };
  const selector = issue.affectedSelector ?? null;
  const selectorInteractiveMatch = selector
    ? (snapshot?.interactive ?? []).find((item) => item.selector === selector) ?? null
    : null;
  const selectorOverlayMatch = selector
    ? (snapshot?.overlays ?? []).find((item) => item.selector === selector) ?? null
    : null;
  const overlayCandidate = (snapshot?.overlays ?? [])
    .filter((entry) => entry?.bounds?.width > 0 && entry?.bounds?.height > 0)
    .sort(
      (left, right) =>
        right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height
    )[0] ?? null;
  const primaryCtaCandidate = findPrimaryCta(snapshot);

  return {
    issueType: issue.issueType,
    severity: issue.severity,
    title: issue.title,
    expected: issue.expected,
    actual: issue.actual,
    confidence: issue.confidence,
    evidenceRefs: issue.evidenceRefs ?? [],
    supportingSignals: issue.supportingSignals ?? [],
    detectorSignals: issue.detectorSignals ?? null,
    llmJudgment: issue.llmJudgment ?? null,
    judgmentPolicy: issue.judgmentPolicy ?? null,
    affectedSelector: selector,
    affectedUrl: issue.affectedUrl ?? snapshot?.url ?? null,
    step: issue.step ?? snapshot?.step ?? null,
    deviceLabel: issue.deviceLabel ?? snapshot?.deviceLabel ?? snapshot?.viewportLabel ?? null,
    deviceId: issue.deviceId ?? snapshot?.deviceId ?? null,
    viewportLabel: issue.viewportLabel ?? snapshot?.viewportLabel ?? null,
    highlightSources: {
      viewport,
      selector,
      selectorBounds:
        selectorInteractiveMatch?.bounds ??
        selectorOverlayMatch?.bounds ??
        null,
      overlayBounds: overlayCandidate?.bounds ?? null,
      primaryCtaBounds: primaryCtaCandidate?.bounds ?? snapshot?.primaryCta?.bounds ?? null
    }
  };
}

function findPrimaryCta(snapshot) {
  if (snapshot.primaryCta?.elementId) {
    return (snapshot.interactive ?? []).find((item) => item.elementId === snapshot.primaryCta.elementId) ?? null;
  }

  return (snapshot.interactive ?? []).find((item) => item.isPrimaryCta) ?? null;
}

function isObviousErrorPage(snapshot) {
  const body = (snapshot.bodyText ?? "").toLowerCase();
  return /404|not found|500|server error|something went wrong/.test(body);
}

function isHeaderNavTarget(target) {
  const landmark = (target?.landmark ?? "").toLowerCase();
  return Boolean(
    target &&
      target.tag === "a" &&
      (target.zone === "Header" || /nav|navigation|banner|header/.test(landmark))
  );
}

function isMobileViewport(snapshot) {
  return (snapshot.viewportWidth ?? 0) <= 480;
}

function hasVisibleCredentialForm(snapshot = {}) {
  const formControls = Array.isArray(snapshot.formControls) ? snapshot.formControls : [];
  const interactive = Array.isArray(snapshot.interactive) ? snapshot.interactive : [];
  const normalize = (value = "") =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const textFromControl = (control = {}) =>
    normalize(
      [
        control.labelText,
        control.placeholder,
        control.ariaLabel,
        control.name,
        control.type,
        control.tag
      ]
        .filter(Boolean)
        .join(" ")
    );
  const textFromInteractive = (entry = {}) =>
    normalize(
      [entry.text, entry.ariaLabel, entry.placeholder, entry.name, entry.id, entry.href]
        .filter(Boolean)
        .join(" ")
    );

  const visibleControls = formControls.filter((control) => control?.inViewport !== false);
  const visibleInteractive = interactive.filter(
    (entry) => entry?.inViewport && !entry?.disabled
  );

  const passwordDetected = visibleControls.some((control) =>
    /\bpassword|passcode|pin\b/i.test(textFromControl(control))
  );
  const identifierDetected = visibleControls.some((control) =>
    /\b(access key|identifier|username|email|login id|account id|user id|member id|portal key|sign[- ]?in id)\b/i.test(
      textFromControl(control)
    )
  );
  const textInputDetected = visibleControls.some((control) => {
    const tag = normalize(control.tag);
    const type = normalize(control.type);
    return ["input", "textarea"].includes(tag) && ["", "text", "email", "search"].includes(type);
  });
  const submitDetected = visibleInteractive.some((entry) =>
    /\b(sign in|log in|login|submit|continue|next|verify|confirm|proceed|access account)\b/i.test(
      textFromInteractive(entry)
    )
  );

  return Boolean(passwordDetected && submitDetected && (identifierDetected || textInputDetected));
}

function intersectionRatio(leftBounds, rightBounds) {
  const xOverlap = Math.max(
    0,
    Math.min(leftBounds.x + leftBounds.width, rightBounds.x + rightBounds.width) - Math.max(leftBounds.x, rightBounds.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(leftBounds.y + leftBounds.height, rightBounds.y + rightBounds.height) - Math.max(leftBounds.y, rightBounds.y)
  );
  const overlapArea = xOverlap * yOverlap;
  if (!overlapArea) {
    return 0;
  }

  const leftArea = leftBounds.width * leftBounds.height;
  const rightArea = rightBounds.width * rightBounds.height;
  return overlapArea / Math.max(Math.min(leftArea, rightArea), 1);
}

function normalizeLabel(value = "") {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlPath(url = "") {
  return normalizePathFromUrl(url ?? "");
}

export const overlayBlockingCheck = {
  id: "OVERLAY_BLOCKING",
  run({ snapshot, evidenceRefs }) {
    const overlays = snapshot.overlays ?? [];
    if (!overlays.length) {
      return null;
    }

    const viewportArea = Math.max((snapshot.viewportWidth ?? 1) * (snapshot.viewportHeight ?? 1), 1);
    const dominant = overlays
      .map((overlay) => ({
        overlay,
        areaRatio: (overlay.bounds.width * overlay.bounds.height) / viewportArea
      }))
      .sort((left, right) => right.areaRatio - left.areaRatio)[0];

    const layoutBlocking = snapshot.layoutSample?.persistentBlockerCount ?? 0;
    if (!dominant || dominant.areaRatio < 0.18) {
      return null;
    }

    const hardBlock = dominant.areaRatio >= 0.65 || layoutBlocking > 0;
    return buildIssue(
      {
        issueType: "OVERLAY_BLOCKING",
        severity: hardBlock ? "P0" : "P2",
        title: hardBlock ? "Blocking overlay covers the main UI" : "Overlay may obstruct the main UI",
        expected: "Primary content should remain interactable without a blocking modal covering the page.",
        actual: `Overlay covers ${Math.round(dominant.areaRatio * 100)}% of the viewport.`,
        confidence: hardBlock ? 0.96 : 0.78,
        evidenceRefs,
        affectedSelector: dominant.overlay.selector ?? null
      },
      snapshot
    );
  }
};

export const horizontalScrollCheck = {
  id: "HORIZONTAL_SCROLL",
  run({ snapshot, evidenceRefs }) {
    const overflow = (snapshot.pageWidth ?? 0) - (snapshot.viewportWidth ?? 0);
    if (overflow <= 24) {
      return null;
    }

    return buildIssue(
      {
        issueType: "HORIZONTAL_SCROLL",
        severity: "P1",
        title: "Horizontal scrolling detected",
        expected: "Pages should fit within the viewport width without requiring horizontal scroll.",
        actual: `Page width exceeds viewport by ${overflow}px.`,
        confidence: 0.91,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const clippedPrimaryCtaCheck = {
  id: "CLIPPED_PRIMARY_CTA",
  run({ snapshot, evidenceRefs }) {
    const viewportWidth = snapshot.viewportWidth ?? 0;
    const viewportHeight = snapshot.viewportHeight ?? 0;
    const primary = findPrimaryCta(snapshot);

    if (!primary) {
      return null;
    }

    const clipped =
      primary.bounds.x < 0 ||
      primary.bounds.y < 0 ||
      primary.bounds.x + primary.bounds.width > viewportWidth ||
      primary.bounds.y + primary.bounds.height > viewportHeight;

    if (!clipped) {
      return null;
    }

    return buildIssue(
      {
        issueType: "CLIPPED_PRIMARY_CTA",
        severity: "P2",
        title: "Primary interactive control is clipped",
        expected: "The primary visible CTA should fit fully within the current viewport.",
        actual: `Primary control \"${primary.text || primary.ariaLabel || primary.tag}\" extends outside the viewport.`,
        confidence: 0.76,
        evidenceRefs,
        affectedSelector: primary.selector ?? snapshot.primaryCta?.selector ?? null
      },
      snapshot
    );
  }
};

export const stuckLoadingCheck = {
  id: "STUCK_LOADING",
  run({ snapshot, evidenceRefs }) {
    if (!snapshot.spinnerVisible && !snapshot.uiReadyState?.timedOut) {
      return null;
    }

    return buildIssue(
      {
        issueType: "STUCK_LOADING",
        severity: "P0",
        title: "Main content appears stuck in loading state",
        expected: "The page should become interactive within the readiness window.",
        actual: snapshot.uiReadyState?.timedOut
          ? "UI readiness timed out while loading indicators remained visible or layout never stabilized."
          : "A loading indicator remained visible when the snapshot was captured.",
        confidence: snapshot.uiReadyState?.timedOut ? 0.95 : 0.82,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const brokenLinkCheck = {
  id: "BROKEN_LINK",
  run({ snapshot, evidenceRefs, actionResult }) {
    const mainDocumentStatus = snapshot.networkSummary?.mainDocumentStatus ?? null;
    const attemptedNavigation = actionResult?.progressSignals?.some((signal) => /navigation/i.test(signal));

    if (!(attemptedNavigation || mainDocumentStatus >= 400 || isObviousErrorPage(snapshot))) {
      return null;
    }

    if ((mainDocumentStatus ?? 0) < 400 && !isObviousErrorPage(snapshot)) {
      return null;
    }

    return buildIssue(
      {
        issueType: "BROKEN_LINK",
        severity: "P1",
        title: "Navigation led to a broken page",
        expected: "Navigation links should resolve to a valid destination page.",
        actual: mainDocumentStatus
          ? `Main document returned HTTP ${mainDocumentStatus}.`
          : "Destination page contains obvious error markers.",
        confidence: mainDocumentStatus ? 0.93 : 0.74,
        evidenceRefs,
        affectedUrl: snapshot.networkSummary?.mainDocumentUrl ?? snapshot.url
      },
      snapshot
    );
  }
};

export const brokenImageCheck = {
  id: "BROKEN_IMAGE",
  run({ snapshot, evidenceRefs }) {
    const brokenImage = (snapshot.images ?? [])
      .filter((image) => image.broken)
      .sort((left, right) => right.areaRatio - left.areaRatio)[0];

    if (!brokenImage) {
      return null;
    }

    const severity = brokenImage.areaRatio >= 0.15 ? "P1" : "P2";
    return buildIssue(
      {
        issueType: "BROKEN_IMAGE",
        severity,
        title: severity === "P1" ? "Broken hero image detected" : "Broken image detected",
        expected: "Visible images should render with a valid source.",
        actual: brokenImage.hadError
          ? `Image failed to load from ${brokenImage.src || "an unknown source"}.`
          : `Image rendered with naturalWidth=0 from ${brokenImage.src || "an unknown source"}.`,
        confidence: 0.94,
        evidenceRefs,
        affectedSelector: brokenImage.selector ?? null
      },
      snapshot
    );
  }
};

export const brokenPrimaryNavCheck = {
  id: "BROKEN_PRIMARY_NAV",
  run({ snapshot, evidenceRefs, actionContext }) {
    const target = actionContext?.target ?? null;
    const action = actionContext?.action ?? null;
    const mainDocumentStatus = snapshot.networkSummary?.mainDocumentStatus ?? null;

    if (action?.type !== "click" || !isHeaderNavTarget(target)) {
      return null;
    }

    if ((mainDocumentStatus ?? 0) < 400) {
      return null;
    }

    return buildIssue(
      {
        issueType: "BROKEN_PRIMARY_NAV",
        severity: "P1",
        title: "Primary navigation link is broken",
        expected: "Header and primary navigation links should open a valid page.",
        actual: `Navigation from \"${target.text || target.ariaLabel || target.href || "nav link"}\" returned HTTP ${mainDocumentStatus}.`,
        confidence: 0.96,
        evidenceRefs,
        affectedSelector: target.selector ?? null,
        affectedUrl: snapshot.networkSummary?.mainDocumentUrl ?? snapshot.url
      },
      snapshot
    );
  }
};

export const unclickableVisibleControlCheck = {
  id: "UNCLICKABLE_VISIBLE_CONTROL",
  run({ snapshot, evidenceRefs }) {
    const candidates = (snapshot.interactive ?? [])
      .filter((item) => !item.disabled)
      .filter((item) => item.inViewport)
      .filter((item) => ["button", "a"].includes(item.tag))
      .sort((left, right) => {
        const primaryWeight = (item) => (item.isPrimaryCta ? 0 : item.zone === "Primary Content" ? 1 : 2);
        if (primaryWeight(left) !== primaryWeight(right)) {
          return primaryWeight(left) - primaryWeight(right);
        }
        if (left.bounds.y !== right.bounds.y) {
          return left.bounds.y - right.bounds.y;
        }
        return left.bounds.x - right.bounds.x;
      })
      .slice(0, 6);

    const failing = candidates.find((candidate) => {
      const probe = candidate.centerProbe;
      return probe?.targetInViewport && (probe.covered || !probe.sameTarget);
    });

    if (!failing) {
      return null;
    }

    const probe = failing.centerProbe;
    const isPrimary = Boolean(
      failing.isPrimaryCta || (failing.zone === "Primary Content" && failing.bounds.y < (snapshot.viewportHeight ?? 0) * 0.55)
    );
    return buildIssue(
      {
        issueType: "UNCLICKABLE_VISIBLE_CONTROL",
        severity: isPrimary ? "P1" : "P2",
        title: isPrimary ? "Primary visible control is obstructed" : "Visible control is obstructed",
        expected: "Visible buttons and links should receive pointer hits at their visual center.",
        actual: `The control \"${failing.text || failing.ariaLabel || failing.tag}\" is covered by ${probe?.topTag || "another element"}${probe?.topText ? ` (${probe.topText})` : ""}.`,
        confidence: 0.92,
        evidenceRefs,
        affectedSelector: failing.selector ?? probe?.topSelector ?? null
      },
      snapshot
    );
  }
};

export const formLabelMissingCheck = {
  id: "FORM_LABEL_MISSING",
  run({ snapshot, evidenceRefs }) {
    const unlabeledControl = (snapshot.formControls ?? []).find((control) => {
      const type = (control.type ?? "").toLowerCase();
      if (!control.inViewport) {
        return false;
      }
      if (["checkbox", "radio", "hidden", "submit", "button", "reset", "range", "color", "file"].includes(type)) {
        return false;
      }
      return !control.placeholder && !control.ariaLabel && !control.hasAssociatedLabel;
    });

    if (!unlabeledControl) {
      return null;
    }

    return buildIssue(
      {
        issueType: "FORM_LABEL_MISSING",
        severity: "P2",
        title: "Visible form control is missing a usable label",
        expected: "Visible form fields should expose either a label, an aria-label, or a placeholder.",
        actual: `The ${unlabeledControl.tag} control${unlabeledControl.name ? ` named \"${unlabeledControl.name}\"` : ""} has no visible or programmatic label signal.`,
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: unlabeledControl.selector ?? null
      },
      snapshot
    );
  }
};

export const toastOrErrorWithoutRecoveryCheck = {
  id: "TOAST_OR_ERROR_WITHOUT_RECOVERY",
  run({ snapshot, evidenceRefs }) {
    const banner = (snapshot.errorBanners ?? []).find((entry) => entry.inViewport && !entry.hasRecoveryAction);
    if (!banner) {
      return null;
    }

    return buildIssue(
      {
        issueType: "TOAST_OR_ERROR_WITHOUT_RECOVERY",
        severity: "P2",
        title: "Error banner is shown without a recovery action",
        expected: "Visible error states should provide a retry, close, dismiss, or other recovery action.",
        actual: `Error banner \"${banner.text}\" is visible without a retry or dismiss control.`,
        confidence: 0.88,
        evidenceRefs,
        affectedSelector: banner.selector ?? null
      },
      snapshot
    );
  }
};

export const textOverflowClipCheck = {
  id: "TEXT_OVERFLOW_CLIP",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.textOverflowItems ?? [])
      .filter((item) => item.inViewport)
      .sort((left, right) => right.overflowPx - left.overflowPx)[0];

    if (!candidate) {
      return null;
    }

    const isElevated = candidate.zone === "Header" || candidate.selector === snapshot.primaryCta?.selector;
    return buildIssue(
      {
        issueType: "TEXT_OVERFLOW_CLIP",
        severity: isElevated ? "P1" : "P2",
        title: isElevated ? "Critical text is clipped" : "Text clipping detected",
        expected: "Visible text should fit its container without being clipped by overflow rules.",
        actual: `Text \"${candidate.text || candidate.selector || "element"}\" overflows its container by ${candidate.overflowPx}px.`,
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const overlappingInteractiveControlsCheck = {
  id: "OVERLAPPING_INTERACTIVE_CONTROLS",
  run({ snapshot, evidenceRefs }) {
    const candidates = (snapshot.interactive ?? [])
      .filter((item) => !item.disabled && item.inViewport)
      .filter((item) => ["button", "a"].includes(item.tag))
      .slice(0, 12);

    let worst = null;
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const overlap = intersectionRatio(candidates[leftIndex].bounds, candidates[rightIndex].bounds);
        if (overlap >= 0.18 && (!worst || overlap > worst.overlap)) {
          worst = {
            left: candidates[leftIndex],
            right: candidates[rightIndex],
            overlap
          };
        }
      }
    }

    if (!worst) {
      return null;
    }

    return buildIssue(
      {
        issueType: "OVERLAPPING_INTERACTIVE_CONTROLS",
        severity: "P1",
        title: "Interactive controls overlap",
        expected: "Interactive controls should have non-overlapping hit targets.",
        actual: `Controls \"${worst.left.text || worst.left.tag}\" and \"${worst.right.text || worst.right.tag}\" overlap by ${Math.round(worst.overlap * 100)}% of the smaller target.`,
        confidence: 0.93,
        evidenceRefs,
        affectedSelector: worst.left.selector ?? worst.right.selector ?? null
      },
      snapshot
    );
  }
};

export const offscreenPrimaryNavCheck = {
  id: "OFFSCREEN_PRIMARY_NAV",
  run({ snapshot, evidenceRefs }) {
    if (!isMobileViewport(snapshot)) {
      return null;
    }

    const headerLinks = (snapshot.interactive ?? []).filter((item) => item.zone === "Header" && item.tag === "a");
    if (!headerLinks.length) {
      return null;
    }

    const menuTrigger = (snapshot.interactive ?? []).find((item) => {
      if (item.zone !== "Header" || !item.inViewport) {
        return false;
      }
      const haystack = [item.text, item.ariaLabel, item.placeholder, item.name].join(" ").toLowerCase();
      return ["button", "a"].includes(item.tag) && /menu|navigation|nav|more|open/.test(haystack);
    });

    const offscreenLinks = headerLinks.filter((item) => !item.inViewport);
    const visibleLinks = headerLinks.filter((item) => item.inViewport);
    if (visibleLinks.length > 0 || offscreenLinks.length === 0 || menuTrigger) {
      return null;
    }

    return buildIssue(
      {
        issueType: "OFFSCREEN_PRIMARY_NAV",
        severity: "P1",
        title: "Primary navigation is offscreen on mobile",
        expected: "Mobile navigation should expose either visible primary links or a visible menu trigger.",
        actual: `Detected ${headerLinks.length} header navigation links, but none are visible in the mobile viewport and no menu trigger is exposed.`,
        confidence: 0.9,
        evidenceRefs,
        affectedSelector: offscreenLinks[0]?.selector ?? null
      },
      snapshot
    );
  }
};

export const nonDismissableModalCheck = {
  id: "NON_DISMISSABLE_MODAL",
  run({ snapshot, evidenceRefs }) {
    const viewportArea = Math.max((snapshot.viewportWidth ?? 1) * (snapshot.viewportHeight ?? 1), 1);
    const dominant = (snapshot.overlays ?? [])
      .map((overlay) => ({
        overlay,
        areaRatio: (overlay.bounds.width * overlay.bounds.height) / viewportArea
      }))
      .sort((left, right) => right.areaRatio - left.areaRatio)[0];

    if (!dominant || dominant.areaRatio < 0.18 || dominant.overlay.hasDismissAction) {
      return null;
    }

    return buildIssue(
      {
        issueType: "NON_DISMISSABLE_MODAL",
        severity: dominant.areaRatio >= 0.65 ? "P0" : "P1",
        title: dominant.areaRatio >= 0.65 ? "Blocking modal cannot be dismissed" : "Modal lacks a dismiss control",
        expected: "Blocking modals should provide a visible dismiss or close control.",
        actual: `Overlay covering ${Math.round(dominant.areaRatio * 100)}% of the viewport exposes no visible dismiss action.`,
        confidence: 0.95,
        evidenceRefs,
        affectedSelector: dominant.overlay.selector ?? null
      },
      snapshot
    );
  }
};

export const deadEndPageCheck = {
  id: "DEAD_END_PAGE",
  run({ snapshot, evidenceRefs }) {
    if (
      snapshot.spinnerVisible ||
      (snapshot.overlays ?? []).length > 0 ||
      snapshot.contentHints?.isStaticContentPage ||
      hasVisibleCredentialForm(snapshot)
    ) {
      return null;
    }

    const safeCount = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => {
        const classification = classifyUiuxElement(item);
        return ["READ_ONLY", "LOW_RISK"].includes(classification.category);
      }).length;

    if (safeCount > 0) {
      return null;
    }

    return buildIssue(
      {
        issueType: "DEAD_END_PAGE",
        severity: "P1",
        title: "Page is a dead end for safe exploration",
        expected: "Interactive application pages should expose at least one safe visible control for continued navigation.",
        actual: "No safe visible interactive elements are available in the current viewport.",
        confidence: 0.87,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const focusVisibilitySmokeCheck = {
  id: "FOCUS_VISIBILITY_SMOKE",
  run({ snapshot, evidenceRefs }) {
    const focusProbe = snapshot.focusProbe;
    if (!focusProbe?.attempted || !focusProbe.anyFocusable || focusProbe.anyVisibleIndicator) {
      return null;
    }

    return buildIssue(
      {
        issueType: "FOCUS_VISIBILITY_SMOKE",
        severity: "P2",
        title: "Keyboard focus is not visibly exposed",
        expected: "Keyboard tab navigation should reveal a visible focus indicator on at least one focused element.",
        actual: `Tabbed through ${focusProbe.steps.length} focusable elements without detecting a visible focus indicator.`,
        confidence: 0.84,
        evidenceRefs,
        affectedSelector: focusProbe.steps[0]?.selector ?? null
      },
      snapshot
    );
  }
};

export const emptyStateWithoutGuidanceCheck = {
  id: "EMPTY_STATE_WITHOUT_GUIDANCE",
  run({ snapshot, evidenceRefs }) {
    const emptyState = (snapshot.stateSignals?.emptyStates ?? []).find((entry) => entry.inViewport);
    if (!emptyState) {
      return null;
    }

    const hasGuidance =
      emptyState.hasGuidanceAction ||
      (snapshot.stateSignals?.guidanceActions ?? []).length > 0;
    if (hasGuidance) {
      return null;
    }

    return buildIssue(
      {
        issueType: "EMPTY_STATE_WITHOUT_GUIDANCE",
        severity: "P2",
        title: "Empty state has no clear next step",
        expected: "Empty states should provide a visible next action such as add, create, retry, reset filters, or help guidance.",
        actual: `Empty state "${emptyState.text}" is visible with no actionable guidance nearby.`,
        confidence: 0.89,
        evidenceRefs,
        affectedSelector: emptyState.selector ?? null
      },
      snapshot
    );
  }
};

export const errorStateWithoutActionCheck = {
  id: "ERROR_STATE_WITHOUT_ACTION",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.stateSignals?.errorStates ?? [])
      .filter((entry) => entry.inViewport)
      .find((entry) => !entry.hasRecoveryAction);

    if (!candidate) {
      return null;
    }

    const severity = candidate.isFullPage || candidate.areaRatio >= 0.35 ? "P1" : "P2";
    return buildIssue(
      {
        issueType: "ERROR_STATE_WITHOUT_ACTION",
        severity,
        title: severity === "P1" ? "Full-page error has no recovery path" : "Error panel has no recovery path",
        expected: "Error states should expose retry, back, dismiss, support, or another actionable recovery path.",
        actual: `Error state "${candidate.text}" is visible without any recovery action.`,
        confidence: 0.92,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const successStateWithoutNextStepCheck = {
  id: "SUCCESS_STATE_WITHOUT_NEXT_STEP",
  run({ snapshot, evidenceRefs }) {
    const successState = (snapshot.stateSignals?.successStates ?? [])
      .filter((entry) => entry.inViewport)
      .find((entry) => !entry.hasNextAction);

    if (!successState) {
      return null;
    }

    return buildIssue(
      {
        issueType: "SUCCESS_STATE_WITHOUT_NEXT_STEP",
        severity: "P2",
        title: "Success state lacks a next-step action",
        expected: "Success confirmations should present a visible next action such as continue, go home, or view details.",
        actual: `Success state "${successState.text}" appears without any recommended follow-up action.`,
        confidence: 0.86,
        evidenceRefs,
        affectedSelector: successState.selector ?? null
      },
      snapshot
    );
  }
};

export const paginationWithoutContextCheck = {
  id: "PAGINATION_WITHOUT_CONTEXT",
  run({ snapshot, evidenceRefs }) {
    const pagination = snapshot.stateSignals?.pagination;
    if (!pagination?.hasPaginationControls || pagination.hasContext) {
      return null;
    }

    const firstControl = pagination.controls?.[0] ?? null;
    return buildIssue(
      {
        issueType: "PAGINATION_WITHOUT_CONTEXT",
        severity: "P2",
        title: "Pagination controls lack result context",
        expected: "Pagination controls should include context such as page count or result totals.",
        actual: "Pagination controls are visible without nearby page/result count context.",
        confidence: 0.88,
        evidenceRefs,
        affectedSelector: firstControl?.selector ?? null
      },
      snapshot
    );
  }
};

export const searchResultsWithoutFeedbackCheck = {
  id: "SEARCH_RESULTS_WITHOUT_FEEDBACK",
  run({ snapshot, evidenceRefs }) {
    const search = snapshot.stateSignals?.search;
    if (!search?.isSearchResultsPage) {
      return null;
    }

    if (
      search.visibleResultCount === 0 &&
      !search.hasNoResultsExplanation &&
      !search.hasRefinementGuidance
    ) {
      return buildIssue(
        {
          issueType: "SEARCH_RESULTS_WITHOUT_FEEDBACK",
          severity: "P2",
          title: "Search page provides no feedback for zero results",
          expected: "Search pages with zero results should provide a no-results explanation or refinement guidance.",
          actual: "No visible search results were detected and no no-results/refinement guidance is shown.",
          confidence: 0.91,
          evidenceRefs
        },
        snapshot
      );
    }

    if (search.searchTerm && !search.searchTermVisible) {
      return buildIssue(
        {
          issueType: "SEARCH_RESULTS_WITHOUT_FEEDBACK",
          severity: "P2",
          title: "Search term is not visible on the results page",
          expected: "Results pages should echo the active search term for context.",
          actual: `Search term "${search.searchTerm}" is not visible in page content.`,
          confidence: 0.67,
          evidenceRefs
        },
        snapshot
      );
    }

    return null;
  }
};

export const duplicatePrimaryCtaLabelsCheck = {
  id: "DUPLICATE_PRIMARY_CTA_LABELS",
  run({ snapshot, evidenceRefs }) {
    const candidates = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => ["button", "a", "input"].includes(item.tag))
      .filter(
        (item) =>
          item.isPrimaryCta ||
          (item.zone === "Primary Content" && item.bounds.y < (snapshot.viewportHeight ?? 0) * 0.7) ||
          item.zone === "Header"
      )
      .slice(0, 30);

    const groups = new Map();
    for (const item of candidates) {
      const normalized = normalizeLabel(item.text || item.ariaLabel || item.placeholder || "");
      if (!normalized || normalized.length < 2) {
        continue;
      }
      const existing = groups.get(normalized) ?? [];
      groups.set(normalized, [...existing, item]);
    }

    for (const [label, entries] of groups.entries()) {
      if (entries.length < 2) {
        continue;
      }

      const destinations = new Set(
        entries.map((entry) => entry.href || entry.selector || `${entry.zone}:${entry.elementId}`)
      );
      if (destinations.size < 2) {
        continue;
      }

      return buildIssue(
        {
          issueType: "DUPLICATE_PRIMARY_CTA_LABELS",
          severity: "P2",
          title: "Duplicate primary CTA labels point to different actions",
          expected: "Primary CTAs with the same label should map to the same destination or action.",
          actual: `Detected ${entries.length} visible primary-looking controls labeled "${label}" with different targets.`,
          confidence: 0.84,
          evidenceRefs,
          affectedSelector: entries[0]?.selector ?? null
        },
        snapshot
      );
    }

    return null;
  }
};

export const visualStabilityShiftSmokeCheck = {
  id: "VISUAL_STABILITY_SHIFT_SMOKE",
  run({ snapshot, evidenceRefs }) {
    const probe = snapshot.layoutStabilityProbe;
    if (!probe || probe.sampleCount < 2 || !Array.isArray(probe.unstableAnchors) || !probe.unstableAnchors.length) {
      return null;
    }

    const worst = [...probe.unstableAnchors].sort((left, right) => right.shiftPx - left.shiftPx)[0];
    if (!worst || worst.shiftPx < 24) {
      return null;
    }

    const severity = worst.shiftPx >= 64 ? "P1" : "P2";
    return buildIssue(
      {
        issueType: "VISUAL_STABILITY_SHIFT_SMOKE",
        severity,
        title: severity === "P1" ? "Critical controls shift position after ready state" : "UI shifts after ready state",
        expected: "Primary CTAs and header navigation should remain positionally stable after UI readiness.",
        actual: `${worst.anchor} anchor shifted by ${worst.shiftPx}px without user interaction.`,
        confidence: severity === "P1" ? 0.9 : 0.8,
        evidenceRefs,
        affectedSelector: worst.selector ?? null
      },
      snapshot
    );
  }
};

export const inconsistentPrimaryNavCheck = {
  id: "INCONSISTENT_PRIMARY_NAV",
  run({ snapshot, evidenceRefs, runHistory = [] }) {
    const currentLabels = normalizeNavLabels(snapshot.primaryNavLabels ?? []);
    if (currentLabels.length < 2) {
      return null;
    }

    const currentType = resolvePrimaryPageType(snapshot.pageTypeHints ?? {});
    const comparable = runHistory
      .filter((entry) => resolvePrimaryPageType(entry.pageTypeHints ?? {}) === currentType)
      .map((entry) => ({
        ...entry,
        similarity: jaccardSimilarity(currentLabels, entry.primaryNavLabels ?? [])
      }))
      .filter((entry) => (entry.primaryNavLabels ?? []).length >= 2);

    if (!comparable.length) {
      return null;
    }

    const mismatches = comparable.filter((entry) => entry.similarity < 0.34);
    if (!mismatches.length) {
      return null;
    }

    const uniquePaths = new Set([
      normalizePathFromUrl(snapshot.url),
      ...mismatches.map((entry) => normalizePathFromUrl(entry.url))
    ]);
    const severity = uniquePaths.size >= 3 ? "P1" : "P2";

    return buildIssue(
      {
        issueType: "INCONSISTENT_PRIMARY_NAV",
        severity,
        title:
          severity === "P1"
            ? "Primary navigation is inconsistent across multiple pages"
            : "Primary navigation labels changed unexpectedly",
        expected: "Pages of the same type should keep a stable primary navigation label set.",
        actual: `Primary nav similarity dropped below threshold for ${mismatches.length} comparable page(s) in ${currentType} context.`,
        confidence: severity === "P1" ? 0.9 : 0.8,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const missingPageHeadingCheck = {
  id: "MISSING_PAGE_HEADING",
  run({ snapshot, evidenceRefs }) {
    const pageType = resolvePrimaryPageType(snapshot.pageTypeHints ?? {});
    const contentPage = ["search", "product", "docs", "checkout", "generic"].includes(pageType);
    if (!contentPage) {
      return null;
    }

    if ((snapshot.h1Text ?? "").trim()) {
      return null;
    }

    return buildIssue(
      {
        issueType: "MISSING_PAGE_HEADING",
        severity: "P2",
        title: "Content page is missing a primary heading",
        expected: "Non-home content pages should expose a clear primary heading (H1 or equivalent).",
        actual: `No primary heading was detected on a ${pageType} page.`,
        confidence: 0.87,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const searchBarInconsistentCheck = {
  id: "SEARCH_BAR_INCONSISTENT",
  run({ snapshot, evidenceRefs, runHistory = [] }) {
    const pageType = resolvePrimaryPageType(snapshot.pageTypeHints ?? {});
    if (["auth", "checkout"].includes(pageType)) {
      return null;
    }

    const comparable = runHistory.filter((entry) => {
      const entryType = resolvePrimaryPageType(entry.pageTypeHints ?? {});
      return entryType === pageType && !["auth", "checkout"].includes(entryType);
    });
    if (comparable.length < 2) {
      return null;
    }

    const presentCount = comparable.filter((entry) => entry.hasSearchBar).length;
    const absentCount = comparable.length - presentCount;
    const expectedSearchBar = presentCount >= absentCount;
    const currentHasSearchBar = Boolean(snapshot.hasSearchBar);
    if (currentHasSearchBar === expectedSearchBar) {
      return null;
    }

    return buildIssue(
      {
        issueType: "SEARCH_BAR_INCONSISTENT",
        severity: "P2",
        title: "Search bar availability is inconsistent across similar pages",
        expected: `Search bar presence should remain stable across ${pageType} pages.`,
        actual: `Current page hasSearchBar=${currentHasSearchBar}, while prior ${pageType} pages mostly had hasSearchBar=${expectedSearchBar}.`,
        confidence: 0.78,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const duplicateBrandHeaderCheck = {
  id: "DUPLICATE_BRAND_HEADER",
  run({ snapshot, evidenceRefs }) {
    const landmarks = (snapshot.headerLandmarks ?? [])
      .filter((entry) => entry.inViewport)
      .filter((entry) => entry.bounds?.width >= (snapshot.viewportWidth ?? 0) * 0.55)
      .filter((entry) => entry.bounds?.y <= 220)
      .sort((left, right) => left.bounds.y - right.bounds.y);

    if (landmarks.length < 2) {
      return null;
    }

    for (let leftIndex = 0; leftIndex < landmarks.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < landmarks.length; rightIndex += 1) {
        const left = landmarks[leftIndex];
        const right = landmarks[rightIndex];
        const similarity = jaccardSimilarity(
          (left.text ?? "").split(/\s+/).slice(0, 14),
          (right.text ?? "").split(/\s+/).slice(0, 14)
        );
        const overlap = intersectionRatio(left.bounds, right.bounds);
        const stacked = Math.abs(right.bounds.y - left.bounds.y) <= Math.max(left.bounds.height, 40);

        if ((similarity >= 0.45 && stacked) || overlap >= 0.25) {
          return buildIssue(
            {
              issueType: "DUPLICATE_BRAND_HEADER",
              severity: "P1",
              title: "Duplicate brand headers are visible",
              expected: "Only one primary header/banner should be visible in the viewport.",
              actual: `Detected overlapping or stacked header landmarks with similarity ${Math.round(similarity * 100)}%.`,
              confidence: 0.88,
              evidenceRefs,
              affectedSelector: left.selector ?? right.selector ?? null
            },
            snapshot
          );
        }
      }
    }

    return null;
  }
};

export const ctaPriorityConflictCheck = {
  id: "CTA_PRIORITY_CONFLICT",
  run({ snapshot, evidenceRefs }) {
    const topFoldCandidates = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => ["button", "a", "input"].includes(item.tag))
      .filter((item) => item.zone === "Primary Content")
      .filter((item) => (item.bounds.viewportY ?? item.bounds.y) <= (snapshot.viewportHeight ?? 0) * 0.62)
      .filter((item) => item.bounds.width * item.bounds.height >= 2_800)
      .filter((item) => normalizeLabel(item.text || item.ariaLabel || item.placeholder || "").length >= 2)
      .slice(0, 8);

    const uniqueLabels = [
      ...new Set(
        topFoldCandidates.map((item) =>
          normalizeLabel(item.text || item.ariaLabel || item.placeholder || "")
        )
      )
    ];

    if (topFoldCandidates.length < 2 || uniqueLabels.length < 2) {
      return null;
    }

    const candidatesByArea = [...topFoldCandidates].sort(
      (left, right) =>
        right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height
    );
    const primaryCandidate = candidatesByArea[0];
    const secondaryCandidate = candidatesByArea[1];
    const primaryArea = Math.max(primaryCandidate.bounds.width * primaryCandidate.bounds.height, 1);
    const secondaryArea = Math.max(secondaryCandidate.bounds.width * secondaryCandidate.bounds.height, 1);
    const prominenceRatio = secondaryArea / primaryArea;

    const taggedPrimaryCount = topFoldCandidates.filter((item) => item.isPrimaryCta).length;
    const hasTaggedClearPrimary = taggedPrimaryCount === 1;

    const sortedByX = [...topFoldCandidates]
      .filter((item) => Number.isFinite(item.bounds.x))
      .sort((left, right) => left.bounds.x - right.bounds.x);
    const minHorizontalGap = sortedByX.reduce((minGap, entry, index) => {
      if (index === 0) {
        return minGap;
      }
      const previous = sortedByX[index - 1];
      const gap =
        entry.bounds.x -
        (previous.bounds.x + previous.bounds.width);
      return Math.min(minGap, gap);
    }, Number.POSITIVE_INFINITY);
    const crampedSpacing = Number.isFinite(minHorizontalGap) && minHorizontalGap < 14;

    const overlapDetected = (() => {
      for (let leftIndex = 0; leftIndex < topFoldCandidates.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < topFoldCandidates.length; rightIndex += 1) {
          const overlap = intersectionRatio(
            topFoldCandidates[leftIndex].bounds,
            topFoldCandidates[rightIndex].bounds
          );
          if (overlap >= 0.12) {
            return true;
          }
        }
      }
      return false;
    })();

    const ctaVerbStem = (label = "") => normalizeLabel(label).split(" ").filter(Boolean)[0] ?? "";
    const uniqueVerbStems = new Set(uniqueLabels.map((label) => ctaVerbStem(label)).filter(Boolean));
    const conflictingLabels = uniqueVerbStems.size >= 2;

    const equalProminence = prominenceRatio >= 0.86;
    const unclearPrimary = !hasTaggedClearPrimary && prominenceRatio >= 0.82;
    const hasClearPrimaryBySize = prominenceRatio <= 0.72 && !crampedSpacing && !overlapDetected;
    const clearPrimary = hasTaggedClearPrimary || hasClearPrimaryBySize;

    if (clearPrimary && !conflictingLabels && !crampedSpacing && !overlapDetected) {
      return null;
    }

    const strongSignals = [];
    const mediumSignals = [];
    const weakSignals = [];

    if (equalProminence) {
      strongSignals.push({
        id: "equal-visual-prominence",
        label: "Multiple CTAs share near-equal visual prominence.",
        value: Number(prominenceRatio.toFixed(3))
      });
    }

    if (unclearPrimary) {
      strongSignals.push({
        id: "unclear-primary-action",
        label: "No clear primary-vs-secondary CTA distinction was detected.",
        value: taggedPrimaryCount
      });
    }

    if (overlapDetected) {
      strongSignals.push({
        id: "cta-overlap-or-hit-conflict",
        label: "Top-fold CTA hit regions overlap or conflict."
      });
    }

    if (conflictingLabels) {
      mediumSignals.push({
        id: "competing-cta-labels",
        label: "CTA labels point to different competing intents.",
        value: [...uniqueVerbStems]
      });
    }

    if (crampedSpacing) {
      mediumSignals.push({
        id: "cramped-cta-spacing",
        label: "CTA spacing is cramped, increasing decision friction.",
        value: Math.round(minHorizontalGap)
      });
    }

    if (topFoldCandidates.length >= 3) {
      weakSignals.push({
        id: "many-top-fold-ctas",
        label: "Top fold contains more than two CTA-like controls.",
        value: topFoldCandidates.length
      });
    }

    if (strongSignals.length === 0 && mediumSignals.length < 2) {
      return null;
    }

    const confidence = Math.min(0.98, 0.68 + strongSignals.length * 0.11 + mediumSignals.length * 0.06);
    const supportingSignals = [...strongSignals, ...mediumSignals, ...weakSignals].map((signal) => ({
      ...signal,
      strength: strongSignals.includes(signal)
        ? "strong"
        : mediumSignals.includes(signal)
          ? "medium"
          : "weak"
    }));

    return buildIssue(
      {
        issueType: "CTA_PRIORITY_CONFLICT",
        severity: "P2",
        title: "Top-fold CTAs conflict in priority",
        expected: "Top-fold primary content should emphasize a single dominant CTA.",
        actual: `Detected ${topFoldCandidates.length} CTA candidates with ${strongSignals.length} strong and ${mediumSignals.length} medium ambiguity signal(s).`,
        confidence,
        evidenceRefs,
        affectedSelector: primaryCandidate?.selector ?? topFoldCandidates[0]?.selector ?? null,
        supportingSignals,
        detectorSignals: {
          ctaHasClearPrimary: clearPrimary,
          prominenceRatio: Number(prominenceRatio.toFixed(3)),
          minHorizontalGapPx: Number.isFinite(minHorizontalGap) ? Math.round(minHorizontalGap) : null,
          uniqueLabelCount: uniqueLabels.length,
          signalSet: {
            strong: strongSignals,
            medium: mediumSignals,
            weak: weakSignals
          }
        }
      },
      snapshot
    );
  }
};

export const brokenIconCheck = {
  id: "BROKEN_ICON",
  run({ snapshot, evidenceRefs }) {
    const brokenIcon = (snapshot.images ?? [])
      .filter((image) => image.broken && image.inViewport)
      .filter((image) => (image.areaRatio ?? 0) <= 0.03)
      .sort((left, right) => (right.areaRatio ?? 0) - (left.areaRatio ?? 0))[0];

    if (!brokenIcon) {
      return null;
    }

    return buildIssue(
      {
        issueType: "BROKEN_ICON",
        severity: "P2",
        title: "Broken icon-like asset detected",
        expected: "Icon assets used in visible controls should render reliably.",
        actual: brokenIcon.hadError
          ? `Icon asset failed to load from ${brokenIcon.src || "unknown source"}.`
          : `Icon asset rendered with naturalWidth=0 from ${brokenIcon.src || "unknown source"}.`,
        confidence: 0.88,
        evidenceRefs,
        affectedSelector: brokenIcon.selector ?? null
      },
      snapshot
    );
  }
};

export const stickyOverlayHidesContentCheck = {
  id: "STICKY_OVERLAY_HIDES_CONTENT",
  run({ snapshot, evidenceRefs }) {
    const coveredTopFoldControls = (snapshot.interactive ?? [])
      .filter((item) => !item.disabled && item.inViewport)
      .filter((item) => item.zone === "Primary Content" || item.zone === "Header")
      .filter((item) => (item.bounds.viewportY ?? item.bounds.y ?? 0) <= (snapshot.viewportHeight ?? 0) * 0.66)
      .filter((item) => item.centerProbe?.targetInViewport && item.centerProbe?.covered)
      .slice(0, 20);

    if (coveredTopFoldControls.length < 2) {
      return null;
    }

    const grouped = coveredTopFoldControls.reduce((map, control) => {
      const key = control.centerProbe?.topSelector || control.centerProbe?.topTag || "unknown-top";
      const current = map.get(key) ?? [];
      map.set(key, [...current, control]);
      return map;
    }, new Map());

    const dominant = [...grouped.entries()]
      .map(([topSelector, controls]) => ({
        topSelector,
        controls
      }))
      .sort((left, right) => right.controls.length - left.controls.length)[0];

    if (!dominant || dominant.controls.length < 2) {
      return null;
    }

    const first = dominant.controls[0];
    return buildIssue(
      {
        issueType: "STICKY_OVERLAY_HIDES_CONTENT",
        severity: dominant.controls.length >= 3 ? "P1" : "P2",
        title: "Top content appears hidden behind a persistent overlay",
        expected: "Important top-fold controls should remain visibly actionable.",
        actual: `${dominant.controls.length} top-fold controls appear covered by ${dominant.topSelector || first.centerProbe?.topTag || "another layer"}.`,
        confidence: dominant.controls.length >= 3 ? 0.9 : 0.78,
        evidenceRefs,
        affectedSelector: first.selector ?? first.centerProbe?.topSelector ?? null
      },
      snapshot
    );
  }
};

export const severeAlignmentBreakCheck = {
  id: "SEVERE_ALIGNMENT_BREAK",
  run({ snapshot, evidenceRefs }) {
    const headerItems = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => item.zone === "Header")
      .filter((item) => ["a", "button"].includes(item.tag))
      .slice(0, 16);

    if (headerItems.length < 3) {
      return null;
    }

    const yPositions = headerItems.map((item) => Number(item.bounds.viewportY ?? item.bounds.y ?? 0));
    const minY = Math.min(...yPositions);
    const maxY = Math.max(...yPositions);
    const spread = maxY - minY;
    if (spread < 42) {
      return null;
    }

    return buildIssue(
      {
        issueType: "SEVERE_ALIGNMENT_BREAK",
        severity: "P2",
        title: "Header controls are severely misaligned",
        expected: "Header/navigation controls should share stable row alignment.",
        actual: `Header control vertical spread reached ${Math.round(spread)}px in one viewport row.`,
        confidence: 0.81,
        evidenceRefs,
        affectedSelector: headerItems[0]?.selector ?? null
      },
      snapshot
    );
  }
};

export const interactiveNoOpCheck = {
  id: "INTERACTIVE_NO_OP",
  run({ snapshot, evidenceRefs, actionContext, actionResult, runHistory = [] }) {
    const actionType = actionContext?.action?.type ?? "";
    if (!["click", "type"].includes(actionType)) {
      return null;
    }

    if (!actionResult?.success) {
      return null;
    }

    const signals = actionResult.progressSignals ?? [];
    const navigationSignal = signals.some((signal) => /navigation/.test(String(signal)));
    if (navigationSignal) {
      return null;
    }

    const previous = runHistory.at(-1) ?? null;
    if (!previous) {
      return null;
    }

    const noVisibleChange = previous.url === snapshot.url && previous.hash && snapshot.hash && previous.hash === snapshot.hash;
    if (!noVisibleChange) {
      return null;
    }

    const targetLabel =
      actionContext?.target?.text ||
      actionContext?.target?.ariaLabel ||
      actionContext?.target?.selector ||
      "interactive control";

    return buildIssue(
      {
        issueType: "INTERACTIVE_NO_OP",
        severity: "P2",
        title: "Interactive element appears to have no visible effect",
        expected: "Interactive controls should trigger a visible state change or explicit feedback.",
        actual: `Action "${actionType}" on ${targetLabel} completed with no detectable URL or DOM state change.`,
        confidence: 0.77,
        evidenceRefs,
        affectedSelector: actionContext?.target?.selector ?? null
      },
      snapshot
    );
  }
};

export const navigationTrapPatternCheck = {
  id: "NAVIGATION_TRAP_PATTERN",
  run({ snapshot, evidenceRefs, runHistory = [] }) {
    const recentPaths = [
      ...runHistory.slice(-6).map((entry) => normalizeUrlPath(entry.url)),
      normalizeUrlPath(snapshot.url)
    ].filter(Boolean);
    if (recentPaths.length < 6) {
      return null;
    }

    const uniquePaths = [...new Set(recentPaths)];
    if (uniquePaths.length > 2) {
      return null;
    }

    let transitions = 0;
    for (let index = 1; index < recentPaths.length; index += 1) {
      if (recentPaths[index] !== recentPaths[index - 1]) {
        transitions += 1;
      }
    }

    if (transitions < 4) {
      return null;
    }

    return buildIssue(
      {
        issueType: "NAVIGATION_TRAP_PATTERN",
        severity: "P1",
        title: "Navigation appears trapped in a short URL cycle",
        expected: "Navigation should move users forward instead of repeatedly cycling across the same routes.",
        actual: `Recent navigation cycled across ${uniquePaths.length} path(s): ${uniquePaths.join(", ")}.`,
        confidence: 0.86,
        evidenceRefs,
        affectedUrl: snapshot.url
      },
      snapshot
    );
  }
};

export const touchHoverOnlyCriticalActionCheck = {
  id: "TOUCH_HOVER_ONLY_CRITICAL_ACTION",
  run({ snapshot, evidenceRefs }) {
    const isTouchViewport = (snapshot.viewportWidth ?? 0) <= 1024;
    if (!isTouchViewport) {
      return null;
    }

    const hasPrimaryCta = Boolean(findPrimaryCta(snapshot));
    if (hasPrimaryCta) {
      return null;
    }

    const hiddenCritical = (snapshot.focusableHiddenElements ?? [])
      .filter((entry) =>
        /buy|checkout|continue|add to cart|apply|submit|details|open/i.test(
          String(entry.text ?? "")
        )
      )
      .slice(0, 6);

    if (hiddenCritical.length === 0) {
      return null;
    }

    return buildIssue(
      {
        issueType: "TOUCH_HOVER_ONLY_CRITICAL_ACTION",
        severity: "P1",
        title: "Critical action appears hidden in touch viewport",
        expected: "Critical actions should remain explicitly visible and actionable on touch devices.",
        actual: `${hiddenCritical.length} critical-looking focusable controls are hidden while no primary CTA is visible.`,
        confidence: 0.73,
        evidenceRefs,
        affectedSelector: hiddenCritical[0]?.selector ?? null
      },
      snapshot
    );
  }
};

export const disabledSubmitNoExplanationCheck = {
  id: "DISABLED_SUBMIT_NO_EXPLANATION",
  run({ snapshot, evidenceRefs }) {
    const disabledSubmit = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && item.disabled)
      .find((item) => {
        const type = String(item.type ?? "").toLowerCase();
        const haystack = [item.text, item.ariaLabel, item.placeholder, type].join(" ").toLowerCase();
        return /submit|continue|place order|checkout|save|send|apply/.test(haystack);
      });

    if (!disabledSubmit) {
      return null;
    }

    const hasGuidanceText =
      /required|missing|complete|invalid|fix|correct|fill|must/i.test(snapshot.bodyText ?? "") ||
      (snapshot.visibleErrorMessages ?? []).length > 0 ||
      (snapshot.stateSignals?.guidanceActions ?? []).length > 0;
    if (hasGuidanceText) {
      return null;
    }

    return buildIssue(
      {
        issueType: "DISABLED_SUBMIT_NO_EXPLANATION",
        severity: "P2",
        title: "Disabled submit control lacks explanation",
        expected: "Disabled submit controls should include clear guidance on how to enable submission.",
        actual: `Submit-like control "${disabledSubmit.text || disabledSubmit.ariaLabel || disabledSubmit.selector}" is disabled with no nearby guidance.`,
        confidence: 0.82,
        evidenceRefs,
        affectedSelector: disabledSubmit.selector ?? null
      },
      snapshot
    );
  }
};

export const fieldErrorNotVisibleCheck = {
  id: "FIELD_ERROR_NOT_VISIBLE",
  run({ snapshot, evidenceRefs }) {
    const requiredControls = (snapshot.formControlDescriptors ?? []).filter(
      (entry) => entry.requiredAttr || entry.ariaRequired
    );
    if (requiredControls.length === 0) {
      return null;
    }

    const hasErrorSignal =
      (snapshot.visibleErrorMessages ?? []).length > 0 ||
      /invalid|required|must|error|failed/.test((snapshot.bodyText ?? "").toLowerCase());
    if (!hasErrorSignal) {
      return null;
    }

    const associatedErrors = (snapshot.visibleErrorMessages ?? []).filter(
      (entry) => Boolean(entry.associatedFieldSelector)
    );
    if (associatedErrors.length > 0) {
      return null;
    }

    return buildIssue(
      {
        issueType: "FIELD_ERROR_NOT_VISIBLE",
        severity: "P2",
        title: "Field-level error feedback is not clearly visible",
        expected: "Invalid/required fields should surface visible per-field error guidance.",
        actual: `Detected required/error signals with no field-associated visible error message.`,
        confidence: 0.75,
        evidenceRefs,
        affectedSelector: requiredControls[0]?.selector ?? null
      },
      snapshot
    );
  }
};

export const successStateMissingConfirmationCheck = {
  id: "SUCCESS_STATE_MISSING_CONFIRMATION",
  run({ snapshot, evidenceRefs, actionResult, actionContext }) {
    if (!actionResult?.success || actionContext?.action?.type === "goto") {
      return null;
    }

    const hasSuccessState = (snapshot.stateSignals?.successStates ?? []).length > 0;
    if (hasSuccessState) {
      return null;
    }

    const looksLikeMutationAction = /submit|save|apply|checkout|continue|create|update|send/i.test(
      [actionContext?.target?.text, actionContext?.target?.ariaLabel, actionContext?.action?.type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    );
    if (!looksLikeMutationAction) {
      return null;
    }

    return buildIssue(
      {
        issueType: "SUCCESS_STATE_MISSING_CONFIRMATION",
        severity: "P2",
        title: "Mutation-like action completed without confirmation",
        expected: "Successful mutation actions should show explicit confirmation feedback.",
        actual: "Action completed successfully, but no explicit success confirmation state was detected.",
        confidence: 0.7,
        evidenceRefs,
        affectedSelector: actionContext?.target?.selector ?? null
      },
      snapshot
    );
  }
};

export const partialRenderSilentFailureCheck = {
  id: "PARTIAL_RENDER_SILENT_FAILURE",
  run({ snapshot, evidenceRefs }) {
    if (snapshot.spinnerVisible || snapshot.uiReadyState?.timedOut) {
      return null;
    }

    const bodyText = String(snapshot.bodyText ?? "").trim();
    const hasKnownState =
      (snapshot.stateSignals?.emptyStates ?? []).length > 0 ||
      (snapshot.stateSignals?.errorStates ?? []).length > 0 ||
      (snapshot.stateSignals?.successStates ?? []).length > 0;
    if (hasKnownState) {
      return null;
    }

    const mainDocumentStatus = snapshot.networkSummary?.mainDocumentStatus;
    if (Number.isFinite(mainDocumentStatus) && mainDocumentStatus >= 400) {
      return null;
    }

    const sparseInteractiveCount = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .length;
    const likelyPartial =
      (!snapshot.hasMainLandmark && sparseInteractiveCount <= 2) ||
      (bodyText.length < 80 && sparseInteractiveCount <= 2);
    if (!likelyPartial) {
      return null;
    }

    return buildIssue(
      {
        issueType: "PARTIAL_RENDER_SILENT_FAILURE",
        severity: "P1",
        title: "Page appears partially rendered without explicit error",
        expected: "Key page regions should render or expose explicit fallback/recovery messaging.",
        actual: "Main content appears sparse or missing while no explicit error state is shown.",
        confidence: 0.79,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const localizationOverflowHintCheck = {
  id: "LOCALIZATION_OVERFLOW_HINT",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.textOverflowItems ?? [])
      .filter((item) => item.inViewport)
      .find((item) => {
        const text = String(item.text ?? "");
        const hasLongToken = text.length >= 26;
        const hasLocaleSignal = /[%$€£¥]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|am|pm/i.test(
          text.toLowerCase()
        );
        return item.overflowPx >= 14 && hasLongToken && hasLocaleSignal;
      });

    if (!candidate) {
      return null;
    }

    return buildIssue(
      {
        issueType: "LOCALIZATION_OVERFLOW_HINT",
        severity: "P2",
        title: "Possible localization/text formatting overflow",
        expected: "Localized date/currency/text strings should fit target containers at this breakpoint.",
        actual: `Localized or formatted text appears clipped by ${candidate.overflowPx}px.`,
        confidence: 0.68,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const baselineUiuxChecks = [
  overlayBlockingCheck,
  horizontalScrollCheck,
  clippedPrimaryCtaCheck,
  stuckLoadingCheck,
  brokenLinkCheck,
  brokenImageCheck,
  brokenIconCheck,
  brokenPrimaryNavCheck,
  unclickableVisibleControlCheck,
  stickyOverlayHidesContentCheck,
  severeAlignmentBreakCheck,
  interactiveNoOpCheck,
  navigationTrapPatternCheck,
  touchHoverOnlyCriticalActionCheck,
  formLabelMissingCheck,
  disabledSubmitNoExplanationCheck,
  fieldErrorNotVisibleCheck,
  toastOrErrorWithoutRecoveryCheck,
  textOverflowClipCheck,
  localizationOverflowHintCheck,
  overlappingInteractiveControlsCheck,
  offscreenPrimaryNavCheck,
  nonDismissableModalCheck,
  deadEndPageCheck,
  focusVisibilitySmokeCheck,
  emptyStateWithoutGuidanceCheck,
  errorStateWithoutActionCheck,
  successStateWithoutNextStepCheck,
  successStateMissingConfirmationCheck,
  partialRenderSilentFailureCheck,
  paginationWithoutContextCheck,
  searchResultsWithoutFeedbackCheck,
  duplicatePrimaryCtaLabelsCheck,
  visualStabilityShiftSmokeCheck,
  inconsistentPrimaryNavCheck,
  missingPageHeadingCheck,
  searchBarInconsistentCheck,
  duplicateBrandHeaderCheck,
  ctaPriorityConflictCheck
];
