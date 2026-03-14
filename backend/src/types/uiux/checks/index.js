import { classifyUiuxElement } from "../../../library/policies/uiControlClassifier.js";
import { hasVisibleCredentialForm } from "../../../library/common-tests/authFlowSignals.js";
import { normalizePathFromUrl } from "../../../library/reporting/clustering.js";
import {
  jaccardSimilarity,
  normalizeNavLabels,
  resolvePrimaryPageType
} from "../../../library/metrics/similarity.js";
import {
  UIUX_EXPANSION_CHECK_IDS,
  formatUiuxCheckTitle,
  getUiuxCheckById
} from "../../../../../shared/uiuxChecklistCatalog.js";

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
  const selectorImageMatch = selector
    ? (snapshot?.images ?? []).find((item) => item.selector === selector) ?? null
    : null;
  const selectorOverflowMatch = selector
    ? (snapshot?.textOverflowItems ?? []).find((item) => item.selector === selector) ?? null
    : null;
  const selectorFormMatch = selector
    ? (snapshot?.formControls ?? []).find((item) => item.selector === selector) ?? null
    : null;
  const selectorResponsiveMatch = selector
    ? (snapshot?.responsiveSignals?.majorOverflowContainers ?? []).find((item) => item.selector === selector) ??
      (snapshot?.responsiveSignals?.mediaOverflowItems ?? []).find((item) => item.selector === selector) ??
      (snapshot?.responsiveSignals?.severeAlignment?.candidates ?? []).find((item) => item.selector === selector) ??
      null
    : null;
  const selectorTableRegionMatch = selector
    ? (snapshot?.dataDisplaySignals?.problematicRegions ?? []).find((item) => item.selector === selector) ?? null
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
      selectorBounds: issue.selectorBounds ??
        selectorInteractiveMatch?.bounds ??
        selectorOverlayMatch?.bounds ??
        selectorImageMatch?.bounds ??
        selectorOverflowMatch?.bounds ??
        selectorFormMatch?.bounds ??
        selectorResponsiveMatch?.bounds ??
        selectorTableRegionMatch?.bounds ??
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

function isCompactViewport(snapshot) {
  return (snapshot.viewportWidth ?? 0) <= 900;
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
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
    const viewportWidth = Math.max(Number(snapshot.viewportWidth ?? 0), 1);
    const documentOverflowPx = toPositiveNumber(snapshot.pageWidth ?? 0) - viewportWidth;
    const responsiveSignals = snapshot.responsiveSignals ?? {};
    const measuredDocumentOverflowPx = Math.max(
      0,
      documentOverflowPx,
      toPositiveNumber(responsiveSignals.horizontalOverflowPx ?? 0)
    );
    const meaningfulOverflowThresholdPx = Math.max(
      8,
      Math.round(viewportWidth * 0.02),
      toPositiveNumber(responsiveSignals.meaningfulOverflowThresholdPx ?? 0)
    );
    const majorContainerOverflowThresholdPx = Math.max(18, Math.round(viewportWidth * 0.05));
    const majorOverflowContainers = (responsiveSignals.majorOverflowContainers ?? [])
      .filter((entry) => toPositiveNumber(entry?.overflowPx) >= majorContainerOverflowThresholdPx)
      .slice(0, 6);

    if (measuredDocumentOverflowPx < meaningfulOverflowThresholdPx && majorOverflowContainers.length === 0) {
      return null;
    }

    const strongestContainer = majorOverflowContainers[0] ?? null;
    const overflowSource = strongestContainer
      ? `Container ${strongestContainer.selector || "unknown"} overflows by ${Math.round(toPositiveNumber(strongestContainer.overflowPx))}px.`
      : `Page width exceeds viewport by ${Math.round(measuredDocumentOverflowPx)}px.`;
    const strongSignals = [];
    const mediumSignals = [];

    if (measuredDocumentOverflowPx >= Math.max(48, Math.round(viewportWidth * 0.08))) {
      strongSignals.push({
        id: "page-width-overflow",
        label: "Document scroll width materially exceeds viewport width.",
        valuePx: Math.round(measuredDocumentOverflowPx)
      });
    }

    if (majorOverflowContainers.length >= 2) {
      strongSignals.push({
        id: "multiple-overflowing-containers",
        label: "Multiple major containers exceed mobile/tablet width constraints.",
        count: majorOverflowContainers.length
      });
    } else if (majorOverflowContainers.length === 1) {
      mediumSignals.push({
        id: "single-major-container-overflow",
        label: "A major visible container exceeds viewport width.",
        selector: strongestContainer?.selector ?? null
      });
    }

    if (measuredDocumentOverflowPx < meaningfulOverflowThresholdPx && majorOverflowContainers.length > 0) {
      mediumSignals.push({
        id: "nested-overflow-region",
        label: "Nested overflow was detected even though document width remains bounded."
      });
    }

    const severity =
      measuredDocumentOverflowPx >= Math.max(96, Math.round(viewportWidth * 0.16)) ||
      majorOverflowContainers.length >= 2
        ? "P1"
        : "P2";
    const confidence = strongSignals.length > 0 ? 0.93 : 0.84;
    const supportingSignals = [
      ...strongSignals.map((entry) => ({ ...entry, strength: "strong" })),
      ...mediumSignals.map((entry) => ({ ...entry, strength: "medium" }))
    ];

    return buildIssue(
      {
        issueType: "HORIZONTAL_SCROLL",
        severity,
        title: severity === "P1" ? "Horizontal overflow detected on responsive layout" : "Local horizontal overflow detected",
        expected: "Pages should fit within the viewport width without requiring horizontal scroll.",
        actual: `${overflowSource} Viewport width is ${viewportWidth}px.`,
        confidence,
        evidenceRefs,
        supportingSignals,
        detectorSignals: {
          pageOverflowPx: Math.round(measuredDocumentOverflowPx),
          viewportWidth,
          majorOverflowContainerCount: majorOverflowContainers.length,
          majorOverflowContainers: majorOverflowContainers.map((entry) => ({
            selector: entry.selector ?? null,
            overflowPx: Math.round(toPositiveNumber(entry.overflowPx)),
            scrollOverflowPx: Math.round(toPositiveNumber(entry.scrollOverflowPx)),
            rectOverflowPx: Math.round(toPositiveNumber(entry.rectOverflowPx)),
            parentOverflowPx: Math.round(toPositiveNumber(entry.parentOverflowPx)),
            widthPressureRatio: Number(toPositiveNumber(entry.widthPressureRatio).toFixed(3))
          })),
          signalSet: {
            strong: strongSignals,
            medium: mediumSignals,
            weak: []
          }
        },
        affectedSelector: strongestContainer?.selector ?? null,
        selectorBounds: strongestContainer?.bounds ?? null
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
    const viewportWidth = Math.max(Number(snapshot.viewportWidth ?? 0), 1);
    const candidates = (snapshot.textOverflowItems ?? [])
      .filter((item) => item.inViewport)
      .sort((left, right) => right.overflowPx - left.overflowPx);
    const candidate = candidates[0] ?? null;

    if (!candidate) {
      return null;
    }

    const isElevated = candidate.zone === "Header" || candidate.selector === snapshot.primaryCta?.selector;
    const mobileViewport = isCompactViewport(snapshot);
    const severeOverflowThreshold = mobileViewport ? 24 : 36;
    const severeOverflowCount = candidates.filter((entry) => Number(entry.overflowPx ?? 0) >= severeOverflowThreshold).length;
    const severity = isElevated || severeOverflowCount >= 2 ? "P1" : "P2";
    const supportingSignals = [
      {
        id: "text-clipped-pixels",
        strength: severeOverflowCount >= 1 ? "strong" : "medium",
        label: "Clipped text exceeds safe overflow threshold.",
        valuePx: Math.round(Number(candidate.overflowPx ?? 0))
      }
    ];
    if (mobileViewport && severeOverflowCount >= 2) {
      supportingSignals.push({
        id: "multiple-mobile-clips",
        strength: "strong",
        label: "Multiple clipped text regions detected on compact viewport.",
        count: severeOverflowCount
      });
    }

    return buildIssue(
      {
        issueType: "TEXT_OVERFLOW_CLIP",
        severity,
        title: severity === "P1" ? "Critical text is clipped" : "Text clipping detected",
        expected: "Visible text should fit its container without being clipped by overflow rules.",
        actual: `Text \"${candidate.text || candidate.selector || "element"}\" overflows its container by ${candidate.overflowPx}px on a ${viewportWidth}px viewport.`,
        confidence: severity === "P1" ? 0.91 : 0.84,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null,
        selectorBounds: candidate.bounds ?? null,
        supportingSignals,
        detectorSignals: {
          viewportWidth,
          severeOverflowCount,
          largestOverflowPx: Math.round(Number(candidate.overflowPx ?? 0)),
          candidateCount: candidates.length
        }
      },
      snapshot
    );
  }
};

export const overlappingInteractiveControlsCheck = {
  id: "OVERLAPPING_INTERACTIVE_CONTROLS",
  run({ snapshot, evidenceRefs }) {
    const compactViewport = isCompactViewport(snapshot);
    const overlapThreshold = compactViewport ? 0.12 : 0.18;
    const candidates = (snapshot.interactive ?? [])
      .filter((item) => !item.disabled && item.inViewport)
      .filter((item) => ["button", "a"].includes(item.tag))
      .slice(0, compactViewport ? 24 : 14);

    let worst = null;
    let overlapCount = 0;
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const overlap = intersectionRatio(candidates[leftIndex].bounds, candidates[rightIndex].bounds);
        if (overlap >= overlapThreshold) {
          overlapCount += 1;
        }
        if (overlap >= overlapThreshold && (!worst || overlap > worst.overlap)) {
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

    const severity =
      overlapCount >= (compactViewport ? 2 : 3) || worst.overlap >= (compactViewport ? 0.22 : 0.28)
        ? "P1"
        : "P2";
    const supportingSignals = [
      {
        id: "control-overlap",
        strength: "strong",
        label: "Interactive controls overlap in the same hit area.",
        overlapRatio: Number(worst.overlap.toFixed(3))
      }
    ];
    if (compactViewport) {
      supportingSignals.push({
        id: "compact-viewport-overlap",
        strength: "medium",
        label: "Overlap occurred on a compact viewport where tap collisions are higher risk."
      });
    }

    return buildIssue(
      {
        issueType: "OVERLAPPING_INTERACTIVE_CONTROLS",
        severity,
        title: "Interactive controls overlap",
        expected: "Interactive controls should have non-overlapping hit targets.",
        actual: `Controls \"${worst.left.text || worst.left.tag}\" and \"${worst.right.text || worst.right.tag}\" overlap by ${Math.round(worst.overlap * 100)}% of the smaller target.`,
        confidence: severity === "P1" ? 0.93 : 0.82,
        evidenceRefs,
        affectedSelector: worst.left.selector ?? worst.right.selector ?? null,
        selectorBounds: worst.left.bounds ?? worst.right.bounds ?? null,
        supportingSignals,
        detectorSignals: {
          overlapThreshold,
          overlapCount,
          compactViewport,
          worstOverlapRatio: Number(worst.overlap.toFixed(3))
        }
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

    const viewportWidth = Math.max(Number(snapshot.viewportWidth ?? 0), 1);
    const headerNavControls = (snapshot.interactive ?? [])
      .filter((item) => item.zone === "Header")
      .filter((item) => ["a", "button"].includes(item.tag));
    if (!headerNavControls.length) {
      return null;
    }

    const menuTrigger = (snapshot.interactive ?? []).find((item) => {
      if (item.zone !== "Header" || !item.inViewport) {
        return false;
      }
      const haystack = [item.text, item.ariaLabel, item.placeholder, item.name].join(" ").toLowerCase();
      return ["button", "a"].includes(item.tag) && /menu|navigation|nav|more|open/.test(haystack);
    });

    const clippedOrOffscreen = headerNavControls.filter((item) => {
      const bounds = item.bounds ?? {};
      const fullyVisible =
        item.inViewport &&
        Number(bounds.x ?? 0) >= -4 &&
        Number(bounds.x ?? 0) + Number(bounds.width ?? 0) <= viewportWidth + 4;
      return !fullyVisible;
    });
    const visibleControls = headerNavControls.filter((item) => !clippedOrOffscreen.includes(item));
    const hiddenRatio = headerNavControls.length > 0 ? clippedOrOffscreen.length / headerNavControls.length : 0;
    const navUnavailable = visibleControls.length === 0 && clippedOrOffscreen.length > 0;
    const navMostlyOffscreen = hiddenRatio >= 0.6 && clippedOrOffscreen.length >= 2;
    if ((!navUnavailable && !navMostlyOffscreen) || menuTrigger) {
      return null;
    }

    const severity = navUnavailable ? "P1" : "P2";
    const primaryOffscreen = clippedOrOffscreen[0] ?? null;

    return buildIssue(
      {
        issueType: "OFFSCREEN_PRIMARY_NAV",
        severity,
        title:
          severity === "P1"
            ? "Primary navigation is offscreen on mobile"
            : "Most header navigation controls are offscreen on mobile",
        expected: "Mobile navigation should expose either visible primary links or a visible menu trigger.",
        actual: `Detected ${headerNavControls.length} header navigation controls with ${clippedOrOffscreen.length} clipped/offscreen and no visible menu trigger.`,
        confidence: severity === "P1" ? 0.9 : 0.8,
        evidenceRefs,
        affectedSelector: primaryOffscreen?.selector ?? null,
        selectorBounds: primaryOffscreen?.bounds ?? null,
        supportingSignals: [
          {
            id: "mobile-nav-offscreen-controls",
            strength: severity === "P1" ? "strong" : "medium",
            label: "Header navigation controls extend outside the mobile viewport.",
            hiddenRatio: Number(hiddenRatio.toFixed(3))
          }
        ],
        detectorSignals: {
          viewportWidth,
          headerControlCount: headerNavControls.length,
          clippedControlCount: clippedOrOffscreen.length,
          hiddenRatio: Number(hiddenRatio.toFixed(3)),
          navUnavailable
        }
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
    if (!isCompactViewport(snapshot)) {
      return null;
    }

    const alignmentSignals = snapshot.responsiveSignals?.severeAlignment ?? {};
    const candidateCount = Number(alignmentSignals.candidateCount ?? 0);
    const stackedCandidateCount = Number(alignmentSignals.stackedCandidateCount ?? 0);
    const dominantLaneShare = Number(alignmentSignals.dominantLaneShare ?? 0);
    const maxLeftDeltaPx = Number(alignmentSignals.maxLeftDeltaPx ?? 0);
    const thresholdPx = Math.max(18, Number(alignmentSignals.thresholdPx ?? 24));
    const overlappingBlockPairCount = Number(alignmentSignals.overlappingBlockPairCount ?? 0);

    const severeBySignals =
      candidateCount >= 2 && maxLeftDeltaPx >= thresholdPx + 6;
    const severeByLaneChaos =
      candidateCount >= 3 &&
      maxLeftDeltaPx >= thresholdPx &&
      dominantLaneShare > 0 &&
      dominantLaneShare < 0.56;
    const severeByCollision = overlappingBlockPairCount >= 1 && maxLeftDeltaPx >= thresholdPx;

    const headerItems = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => item.zone === "Header")
      .filter((item) => ["a", "button"].includes(item.tag))
      .slice(0, 16);
    const headerSpread = headerItems.length >= 3
      ? Math.max(...headerItems.map((item) => Number(item.bounds.viewportY ?? item.bounds.y ?? 0))) -
        Math.min(...headerItems.map((item) => Number(item.bounds.viewportY ?? item.bounds.y ?? 0)))
      : 0;
    const severeByHeaderFallback = headerItems.length >= 3 && headerSpread >= 48;

    if (!severeBySignals && !severeByLaneChaos && !severeByCollision && !severeByHeaderFallback) {
      return null;
    }

    const strongestCandidate = (alignmentSignals.candidates ?? [])[0] ?? null;
    const severity =
      severeBySignals || severeByLaneChaos || severeByCollision
        ? "P1"
        : "P2";
    const signalSummary = [];
    if (severeBySignals) {
      signalSummary.push({
        id: "stack-left-drift",
        strength: "strong",
        label: "Primary stacked content drifts off a common alignment lane.",
        candidateCount,
        maxLeftDeltaPx: Math.round(maxLeftDeltaPx)
      });
      signalSummary.push({
        id: "stack-drift-repetition",
        strength: "strong",
        label: "Multiple stacked blocks repeat the same lane drift pattern.",
        stackedCandidateCount,
        candidateCount
      });
    }
    if (severeByLaneChaos) {
      signalSummary.push({
        id: "lane-chaos",
        strength: "strong",
        label: "No stable alignment lane remains for stacked mobile blocks.",
        dominantLaneShare: Number(dominantLaneShare.toFixed(3)),
        candidateCount
      });
    }
    if (severeByCollision) {
      signalSummary.push({
        id: "block-collision",
        strength: "strong",
        label: "Adjacent content blocks overlap in compact viewport.",
        overlapPairs: overlappingBlockPairCount
      });
      signalSummary.push({
        id: "collision-density",
        strength: "strong",
        label: "Overlapping blocks indicate structurally unstable responsive composition.",
        overlapPairs: overlappingBlockPairCount,
        candidateCount
      });
    }
    if (!severeBySignals && severeByHeaderFallback) {
      signalSummary.push({
        id: "header-row-drift-fallback",
        strength: "medium",
        label: "Header controls diverge vertically beyond stable row bounds.",
        spreadPx: Math.round(headerSpread)
      });
    }

    return buildIssue(
      {
        issueType: "SEVERE_ALIGNMENT_BREAK",
        severity,
        title:
          severity === "P1"
            ? "Mobile layout shows severe alignment break"
            : "Mobile layout shows notable alignment inconsistency",
        expected: "Responsive mobile layout should keep primary sections and controls in stable alignment lanes.",
        actual: severeBySignals || severeByLaneChaos || severeByCollision
          ? `Detected ${candidateCount} misaligned content block(s) with max left drift ${Math.round(maxLeftDeltaPx)}px${overlappingBlockPairCount > 0 ? ` and ${overlappingBlockPairCount} overlap pair(s)` : ""}${severeByLaneChaos ? ` while only ${(dominantLaneShare * 100).toFixed(0)}% of blocks align to a dominant lane` : ""}.`
          : `Header controls show ${Math.round(headerSpread)}px vertical spread in a compact viewport.`,
        confidence: severity === "P1" ? 0.9 : 0.81,
        evidenceRefs,
        affectedSelector: strongestCandidate?.selector ?? headerItems[0]?.selector ?? null,
        selectorBounds: strongestCandidate?.bounds ?? headerItems[0]?.bounds ?? null,
        supportingSignals: signalSummary,
        detectorSignals: {
          candidateCount,
          stackedCandidateCount,
          dominantLaneShare: Number(dominantLaneShare.toFixed(3)),
          maxLeftDeltaPx: Number(maxLeftDeltaPx.toFixed(1)),
          thresholdPx: Number(thresholdPx.toFixed(1)),
          overlappingBlockPairCount,
          headerSpread: Number(headerSpread.toFixed(1))
        }
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

export const requiredOptionalUnclearCheck = {
  id: "REQUIRED_OPTIONAL_UNCLEAR",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.formControlDescriptors ?? []).find(
      (descriptor) =>
        descriptor.requiredAttr &&
        !descriptor.ariaRequired &&
        !descriptor.requiredIndicatorNearLabel
    );

    if (!candidate) {
      return null;
    }

    return buildIssue(
      {
        issueType: "REQUIRED_OPTIONAL_UNCLEAR",
        severity: "P2",
        title: "Required form field is not explicitly marked",
        expected:
          "Required fields should be explicitly marked through aria-required or visible required indicators near labels.",
        actual: `Required field ${candidate.selector || candidate.name || candidate.type} is not explicitly marked for users.`,
        confidence: 0.86,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const inputFormatHelpMissingCheck = {
  id: "INPUT_FORMAT_HELP_MISSING",
  run({ snapshot, evidenceRefs }) {
    const constrainedTypes = new Set([
      "password",
      "tel",
      "date",
      "datetime-local",
      "time",
      "month",
      "week",
      "number"
    ]);
    const descriptorsBySelector = new Map(
      (snapshot.formControlDescriptors ?? []).map((entry) => [entry.selector, entry])
    );

    const candidate = (snapshot.formControls ?? [])
      .filter((control) => control.inViewport)
      .find((control) => {
        const type = String(control.type ?? "").toLowerCase();
        if (!constrainedTypes.has(type)) {
          return false;
        }
        const descriptor = descriptorsBySelector.get(control.selector);
        const helperSnippet = String(descriptor?.describedByTextSnippet ?? "").trim();
        if (helperSnippet.length >= 4) {
          return false;
        }
        const hintText = [
          control.placeholder,
          control.labelText,
          descriptor?.ariaLabel
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return !/\b(example|format|mm\/dd|dd\/mm|yyyy|e\.?g\.?|at least|country code|timezone|letters|numbers)\b/.test(
          hintText
        );
      });

    if (!candidate) {
      return null;
    }

    return buildIssue(
      {
        issueType: "INPUT_FORMAT_HELP_MISSING",
        severity: "P2",
        title: "Constrained input has no format guidance",
        expected:
          "Inputs with strict formatting should provide helper text or format examples before users submit.",
        actual: `Input ${candidate.selector || candidate.name || candidate.type} appears constrained but no visible format guidance was detected.`,
        confidence: 0.78,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const touchTargetTooSmallCheck = {
  id: "TOUCH_TARGET_TOO_SMALL",
  run({ snapshot, evidenceRefs }) {
    if ((snapshot.viewportWidth ?? 0) > 1024) {
      return null;
    }

    const candidate = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => ["button", "a", "input"].includes(item.tag))
      .map((item) => ({
        ...item,
        minTargetSize: Math.min(item.bounds.width ?? 0, item.bounds.height ?? 0)
      }))
      .filter((item) => item.minTargetSize > 0 && item.minTargetSize < 40)
      .sort((left, right) => left.minTargetSize - right.minTargetSize)[0];

    if (!candidate) {
      return null;
    }

    const severity = candidate.minTargetSize < 32 ? "P1" : "P2";
    return buildIssue(
      {
        issueType: "TOUCH_TARGET_TOO_SMALL",
        severity,
        title: "Touch target is smaller than recommended size",
        expected: "Touch controls should provide at least ~40px hit area on mobile and tablet viewports.",
        actual: `Control "${candidate.text || candidate.ariaLabel || candidate.tag}" has min hit size ${Math.round(candidate.minTargetSize)}px.`,
        confidence: severity === "P1" ? 0.9 : 0.8,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const mediaScalingBrokenCheck = {
  id: "MEDIA_SCALING_BROKEN",
  run({ snapshot, evidenceRefs }) {
    const viewportWidth = snapshot.viewportWidth ?? 0;
    const viewportHeight = snapshot.viewportHeight ?? 0;
    const responsiveMediaOverflow = (snapshot.responsiveSignals?.mediaOverflowItems ?? [])
      .sort((left, right) => toPositiveNumber(right?.maxOverflowPx) - toPositiveNumber(left?.maxOverflowPx));
    const candidateFromSignals = responsiveMediaOverflow[0] ?? null;

    const candidateFromImages = (snapshot.images ?? [])
      .filter((image) => image.inViewport)
      .find((image) => {
        const bounds = image.bounds ?? {};
        return (
          bounds.x < -4 ||
          bounds.y < -4 ||
          bounds.x + bounds.width > viewportWidth + 4 ||
          bounds.y + bounds.height > viewportHeight + 4
        );
      });
    const candidate = candidateFromSignals ?? candidateFromImages ?? null;

    if (!candidate) {
      return null;
    }

    const signalOverflowPx = Math.round(toPositiveNumber(candidate.maxOverflowPx ?? 0));
    const widthRatio = toPositiveNumber(candidate.widthRatio ?? 0);
    const mediaAreaRatio = toPositiveNumber(candidate.areaRatio ?? 0);
    const severe =
      signalOverflowPx >= Math.max(24, Math.round(viewportWidth * 0.06)) ||
      widthRatio >= 1.12 ||
      mediaAreaRatio >= 0.18;
    const severity = severe ? "P1" : "P2";
    const selector = candidate.selector ?? null;
    const mediaTag = candidate.tag ?? "media";
    return buildIssue(
      {
        issueType: "MEDIA_SCALING_BROKEN",
        severity,
        title: severity === "P1" ? "Media element overflows viewport bounds" : "Media scaling is unstable on compact viewport",
        expected: "Media should scale responsively without clipping or overflowing the visible viewport.",
        actual: signalOverflowPx > 0
          ? `${mediaTag} ${selector || candidate.src || candidate.imageId || "element"} exceeds viewport bounds by ${signalOverflowPx}px.`
          : `Media ${selector || candidate.src || candidate.imageId || "element"} overflows viewport bounds.`,
        confidence: severe ? 0.9 : 0.84,
        evidenceRefs,
        affectedSelector: selector,
        selectorBounds: candidate.bounds ?? null,
        supportingSignals: [
          {
            id: "media-overflow",
            strength: severe ? "strong" : "medium",
            label: "Visible media exceeds responsive width/height constraints.",
            overflowPx: signalOverflowPx
          }
        ],
        detectorSignals: {
          viewportWidth,
          viewportHeight,
          overflowPx: signalOverflowPx,
          widthRatio: Number(widthRatio.toFixed(3)),
          mediaTag
        }
      },
      snapshot
    );
  }
};

export const genericActionLabelsCheck = {
  id: "GENERIC_ACTION_LABELS",
  run({ snapshot, evidenceRefs }) {
    const genericPattern =
      /^(submit|click here|here|continue|next|more|learn more|read more|get started)$/i;
    const actions = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => ["button", "a", "input"].includes(item.tag))
      .slice(0, 20);
    const candidate = actions.find((item) => {
      const label = (item.text || item.ariaLabel || item.placeholder || "").replace(/\s+/g, " ").trim();
      return label && genericPattern.test(label);
    });

    if (!candidate) {
      return null;
    }

    return buildIssue(
      {
        issueType: "GENERIC_ACTION_LABELS",
        severity: "P2",
        title: "Action label is too generic",
        expected: "Primary and secondary action labels should be specific about the resulting outcome.",
        actual: `Action label "${candidate.text || candidate.ariaLabel || candidate.placeholder}" is generic and may not explain outcome clearly.`,
        confidence: 0.72,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const imageMissingAltUiuxCheck = {
  id: "IMAGE_MISSING_ALT_UIUX",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.images ?? [])
      .filter((image) => image.inViewport && !image.broken)
      .find((image) => {
        const alt = String(image.alt ?? "").trim();
        const role = String(image.role ?? "").toLowerCase();
        if (image.ariaHidden || role === "presentation" || role === "none") {
          return false;
        }
        if ((image.areaRatio ?? 0) < 0.01) {
          return false;
        }
        return alt.length === 0;
      });

    if (!candidate) {
      return null;
    }

    const severity = (candidate.areaRatio ?? 0) >= 0.15 ? "P1" : "P2";
    return buildIssue(
      {
        issueType: "IMAGE_MISSING_ALT_UIUX",
        severity,
        title: "Informative image appears to be missing alt text",
        expected: "Non-decorative images should expose alternative text for assistive technologies.",
        actual: `Visible image ${candidate.selector || candidate.src || candidate.imageId} has empty alt text.`,
        confidence: 0.83,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const headingOrderSuspiciousUiuxCheck = {
  id: "HEADING_ORDER_SUSPICIOUS_UIUX",
  run({ snapshot, evidenceRefs }) {
    const headings = (snapshot.headings ?? [])
      .filter((entry) => Number.isInteger(entry.level))
      .slice(0, 20);
    if (headings.length < 2) {
      return null;
    }

    for (let index = 1; index < headings.length; index += 1) {
      const previous = headings[index - 1];
      const current = headings[index];
      if ((current.level ?? 0) > (previous.level ?? 0) + 1) {
        return buildIssue(
          {
            issueType: "HEADING_ORDER_SUSPICIOUS_UIUX",
            severity: "P2",
            title: "Heading hierarchy skips levels",
            expected: "Heading structure should progress logically without abrupt level jumps.",
            actual: `Heading order jumps from h${previous.level} to h${current.level}.`,
            confidence: 0.8,
            evidenceRefs,
            affectedSelector: current.selector ?? null
          },
          snapshot
        );
      }
    }
    return null;
  }
};

export const interactiveNameMissingUiuxCheck = {
  id: "INTERACTIVE_NAME_MISSING_UIUX",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => ["button", "a", "input"].includes(item.tag))
      .find((item) => {
        const text = (item.text || item.ariaLabel || item.placeholder || "").trim();
        return text.length === 0;
      });

    if (!candidate) {
      return null;
    }

    const severity = candidate.isPrimaryCta ? "P1" : "P2";
    return buildIssue(
      {
        issueType: "INTERACTIVE_NAME_MISSING_UIUX",
        severity,
        title: "Interactive control has no clear name",
        expected: "Visible interactive controls should expose a clear text or aria label.",
        actual: `Interactive control ${candidate.selector || candidate.elementId || candidate.tag} is visible without a meaningful label.`,
        confidence: 0.88,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

export const aboveFoldOverloadCheck = {
  id: "ABOVE_FOLD_OVERLOAD",
  run({ snapshot, evidenceRefs }) {
    const topFoldActions = (snapshot.interactive ?? [])
      .filter((item) => item.inViewport && !item.disabled)
      .filter((item) => ["button", "a"].includes(item.tag))
      .filter((item) => (item.bounds.viewportY ?? item.bounds.y ?? 0) <= (snapshot.viewportHeight ?? 0) * 0.62);
    const topFoldOverlays = (snapshot.overlays ?? [])
      .filter((overlay) => overlay.bounds?.y <= (snapshot.viewportHeight ?? 0) * 0.62);
    const topFoldErrorBanners = (snapshot.errorBanners ?? []).filter((banner) => banner.inViewport);
    const overloadScore = topFoldActions.length + topFoldOverlays.length * 2 + topFoldErrorBanners.length;

    if (overloadScore < 9) {
      return null;
    }

    return buildIssue(
      {
        issueType: "ABOVE_FOLD_OVERLOAD",
        severity: "P2",
        title: "Above-the-fold area appears overloaded",
        expected: "The first visible viewport should keep messaging and actions focused and uncluttered.",
        actual: `Top fold contains ${topFoldActions.length} action controls, ${topFoldOverlays.length} overlays, and ${topFoldErrorBanners.length} banners.`,
        confidence: 0.74,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const contentScannabilityPoorCheck = {
  id: "CONTENT_SCANNABILITY_POOR",
  run({ snapshot, evidenceRefs }) {
    const wordCount = String(snapshot.bodyText ?? "")
      .split(/\s+/)
      .filter(Boolean).length;
    const headingCount = (snapshot.headings ?? []).filter((entry) => entry.inViewport).length;
    if (wordCount < 280 || headingCount >= 2) {
      return null;
    }

    return buildIssue(
      {
        issueType: "CONTENT_SCANNABILITY_POOR",
        severity: "P2",
        title: "Content appears difficult to scan",
        expected: "Long content should be segmented with clear headings or scannable structure.",
        actual: `Detected approximately ${wordCount} words in viewport text with only ${headingCount} visible heading marker(s).`,
        confidence: 0.71,
        evidenceRefs
      },
      snapshot
    );
  }
};

export const tableChartMobileUsabilityCheck = {
  id: "TABLE_CHART_MOBILE_USABILITY",
  run({ snapshot, evidenceRefs }) {
    if ((snapshot.viewportWidth ?? 0) > 900) {
      return null;
    }

    const dataSignals = snapshot.dataDisplaySignals ?? {
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
    const hasDenseData = (dataSignals.tableCount ?? 0) + (dataSignals.chartCount ?? 0) > 0;
    const poorCount = Number(dataSignals.poorMobileUsabilityCount ?? 0);
    const severeCount = Number(dataSignals.severePoorMobileUsabilityCount ?? 0);
    const maxHiddenWidthPx = Number(dataSignals.maxHiddenWidthPx ?? 0);
    const problematicRegions = Array.isArray(dataSignals.problematicRegions)
      ? dataSignals.problematicRegions.slice(0, 8)
      : [];
    if (!hasDenseData || poorCount === 0) {
      return null;
    }

    const strongestRegion = problematicRegions[0] ?? null;
    const borderline = severeCount === 0 && maxHiddenWidthPx < 220;
    const severity = borderline ? "P2" : "P1";
    const judgmentPolicy = borderline ? "advisory" : "hard-fail";
    const tableProblems = Number(dataSignals.problematicTableCount ?? 0);
    const chartProblems = Number(dataSignals.problematicChartCount ?? 0);
    const supportingSignals = [];
    const strongSignals = [];
    const mediumSignals = [];

    if (maxHiddenWidthPx >= 220 || severeCount > 0) {
      strongSignals.push({
        id: "excessive-horizontal-pan-distance",
        label: "User must pan a large hidden width to interpret dense data.",
        hiddenWidthPx: Math.round(maxHiddenWidthPx)
      });
    }

    if (tableProblems > 0) {
      mediumSignals.push({
        id: "table-mobile-usability-pressure",
        label: "Table region remains wider than mobile viewport without strong compact adaptation.",
        count: tableProblems
      });
    }

    if (chartProblems > 0) {
      mediumSignals.push({
        id: "chart-mobile-clip-pressure",
        label: "Chart region is clipped or over-wide in compact viewport.",
        count: chartProblems
      });
    }

    supportingSignals.push(
      ...strongSignals.map((entry) => ({ ...entry, strength: "strong" })),
      ...mediumSignals.map((entry) => ({ ...entry, strength: "medium" }))
    );

    return buildIssue(
      {
        issueType: "TABLE_CHART_MOBILE_USABILITY",
        severity,
        judgmentPolicy,
        title:
          severity === "P1"
            ? "Dense data display is not usable on smaller viewport"
            : "Dense data display may be difficult to use on smaller viewport",
        expected: "Tables and charts should remain interpretable and navigable on tablet/mobile screens.",
        actual: `${poorCount} dense data region(s) show poor mobile usability (${tableProblems} table, ${chartProblems} chart); maximum hidden horizontal width is ${Math.round(maxHiddenWidthPx)}px.`,
        confidence: severity === "P1" ? 0.9 : 0.76,
        evidenceRefs,
        affectedSelector:
          strongestRegion?.selector ??
          dataSignals.firstProblematicSelector ??
          dataSignals.firstOverflowingTableSelector ??
          null,
        selectorBounds: strongestRegion?.bounds ?? null,
        supportingSignals,
        detectorSignals: {
          tableCount: Number(dataSignals.tableCount ?? 0),
          chartCount: Number(dataSignals.chartCount ?? 0),
          problematicTableCount: tableProblems,
          problematicChartCount: chartProblems,
          poorMobileUsabilityCount: poorCount,
          severePoorMobileUsabilityCount: severeCount,
          maxHiddenWidthPx: Math.round(maxHiddenWidthPx),
          problematicRegions: problematicRegions.map((entry) => ({
            selector: entry.selector ?? null,
            kind: entry.kind ?? "table",
            hiddenWidthPx: Math.round(Number(entry.hiddenWidthPx ?? 0)),
            rowCount: Number(entry.rowCount ?? 0),
            columnCount: Number(entry.columnCount ?? 0),
            visibleHeaderCount: Number(entry.visibleHeaderCount ?? 0),
            stackedFallback: Boolean(entry.stackedFallback),
            poorMobileUsability: Boolean(entry.poorMobileUsability),
            severePoorMobileUsability: Boolean(entry.severePoorMobileUsability)
          })),
          signalSet: {
            strong: strongSignals,
            medium: mediumSignals,
            weak: []
          }
        }
      },
      snapshot
    );
  }
};

export const consentBannerBlockingTaskCheck = {
  id: "CONSENT_BANNER_BLOCKING_TASK",
  run({ snapshot, evidenceRefs }) {
    const candidate = (snapshot.overlays ?? []).find((overlay) =>
      /cookie|consent|privacy|gdpr|terms/i.test(String(overlay.text ?? ""))
    );
    if (!candidate) {
      return null;
    }

    const severity =
      candidate.isBlocking || (candidate.areaRatio ?? 0) >= 0.35 || !candidate.hasDismissAction
        ? "P1"
        : "P2";
    return buildIssue(
      {
        issueType: "CONSENT_BANNER_BLOCKING_TASK",
        severity,
        title: "Consent/legal overlay interferes with core task",
        expected: "Consent and legal banners should be clear, dismissible, and should not block primary user actions.",
        actual: `Consent/legal overlay covers ${Math.round((candidate.areaRatio ?? 0) * 100)}% of the viewport${candidate.hasDismissAction ? "" : " without a clear dismiss action"}.`,
        confidence: severity === "P1" ? 0.9 : 0.78,
        evidenceRefs,
        affectedSelector: candidate.selector ?? null
      },
      snapshot
    );
  }
};

function selectProxyBaseChecks(checkId = "") {
  if (/(TABLE|CHART|DATA_VIZ|MATRIX|HEATMAP|SPARKLINE|COLUMN|ROW|LEGEND|AXIS|SCROLLABLE_DATA_REGION)/.test(checkId)) {
    return [tableChartMobileUsabilityCheck, horizontalScrollCheck, mediaScalingBrokenCheck];
  }
  if (/(OVERFLOW|SCROLL|CLIP|WIDTH|SAFE_AREA|100VH|KEYBOARD|MOBILE|RESPONSIVE|ORIENTATION|OFFSCREEN)/.test(checkId)) {
    return [horizontalScrollCheck, textOverflowClipCheck, offscreenPrimaryNavCheck, mediaScalingBrokenCheck];
  }
  if (/(ALIGNMENT|GRID|SPACING|PADDING|SECTION_|VIEWPORT_HEIGHT|FLOATING_ACTION|STICKY|BOTTOM_BAR|NESTED_SCROLL|VISUAL_GROUPING|READING_LINE|DENSITY)/.test(checkId)) {
    return [severeAlignmentBreakCheck, overlappingInteractiveControlsCheck, stickyOverlayHidesContentCheck];
  }
  if (/(NAV|BREADCRUMB|LOGO_HOME|WAYFINDING|TAB_STATE|ACCORDION|STEP_PROGRESS|WIZARD|BACK_TO_TOP|IN_PAGE_ANCHOR|OPEN_IN_NEW_TAB)/.test(checkId)) {
    return [offscreenPrimaryNavCheck, inconsistentPrimaryNavCheck, paginationWithoutContextCheck, deadEndPageCheck];
  }
  if (/(BUTTON|CONTROL|CLICK|TOOLTIP|POPOVER|DROPDOWN|CAROUSEL|CARD_CLICKABILITY|ICON_ONLY|DRAG|AFFORDANCE)/.test(checkId)) {
    return [unclickableVisibleControlCheck, interactiveNoOpCheck, touchTargetTooSmallCheck, overlappingInteractiveControlsCheck];
  }
  if (/(FORM|FIELD|INPUT|PASSWORD|ERROR_SUMMARY|AUTOCOMPLETE|DATE_PICKER|MULTI_SELECT|RADIO|CHECKBOX|AUTOSAVE|UPLOAD_STATUS)/.test(checkId)) {
    return [formLabelMissingCheck, requiredOptionalUnclearCheck, inputFormatHelpMissingCheck, fieldErrorNotVisibleCheck, disabledSubmitNoExplanationCheck];
  }
  if (/(SEARCH|FILTER|SORT|RESULT|FACET|BULK_SELECTION|DENSE_TABLE|COMPARISON|KPI|EXPORT_ACTION)/.test(checkId)) {
    return [searchResultsWithoutFeedbackCheck, paginationWithoutContextCheck, tableChartMobileUsabilityCheck, contentScannabilityPoorCheck];
  }
  if (/(STATE|SKELETON|PROCESSING|LONG_TASK|UNSAVED|OFFLINE|RECONNECT|SESSION_TIMEOUT|STALE_DATA|404|MAINTENANCE|RECOVERY)/.test(checkId)) {
    return [stuckLoadingCheck, toastOrErrorWithoutRecoveryCheck, emptyStateWithoutGuidanceCheck, errorStateWithoutActionCheck, partialRenderSilentFailureCheck];
  }
  if (/(CONTENT|COPY|HIERARCHY|READABILITY|HEADING|BADGE|ABBREVIATION|UNIT|CURRENCY|DATE_TIME|TRUST_SIGNAL|LINK_STYLE|VISITED_LINK|META_INFORMATION|CTA_COPY)/.test(checkId)) {
    return [contentScannabilityPoorCheck, genericActionLabelsCheck, textOverflowClipCheck, missingPageHeadingCheck];
  }
  if (/(MODAL|DRAWER|SHEET|OVERLAY|TOAST_STACK|SCROLL_LOCK|DISMISS|MULTI_LAYER|POPOVER_CLIPPED)/.test(checkId)) {
    return [overlayBlockingCheck, nonDismissableModalCheck, stickyOverlayHidesContentCheck, consentBannerBlockingTaskCheck];
  }
  if (/(PRICE|CHECKOUT|PROMO|POLICY|DELETE|DESTRUCTIVE|FINAL_ACTION|SURPRISE_ACCOUNT|PAYMENT|ADDRESS|SHIPPING|CONVERSION)/.test(checkId)) {
    return [ctaPriorityConflictCheck, clippedPrimaryCtaCheck, contentScannabilityPoorCheck];
  }
  if (/(COLOR_ONLY|FOCUS|KEYBOARD|REDUCED_MOTION|TEXT_RESIZE|SCREEN_READER|STATUS_MESSAGE|PLACEHOLDER_CONTRAST)/.test(checkId)) {
    return [focusVisibilitySmokeCheck, headingOrderSuspiciousUiuxCheck, interactiveNameMissingUiuxCheck, imageMissingAltUiuxCheck];
  }
  return [contentScannabilityPoorCheck, textOverflowClipCheck];
}

function createExpansionProxyCheck(checkId = "") {
  const checkTitle = getUiuxCheckById(checkId)?.title ?? formatUiuxCheckTitle(checkId);
  const expected = `${checkTitle} should satisfy UI/UX quality expectations at this viewport.`;
  return {
    id: checkId,
    run(context = {}) {
      for (const baseCheck of selectProxyBaseChecks(checkId)) {
        const baseIssue = baseCheck?.run?.(context);
        if (!baseIssue) {
          continue;
        }
        return buildIssue(
          {
            issueType: checkId,
            severity: baseIssue.severity ?? "P2",
            title: checkTitle,
            expected,
            actual: `${baseIssue.actual} (Mapped from runtime signal ${baseIssue.issueType}.)`,
            confidence: Math.max(0.72, Math.min(Number(baseIssue.confidence ?? 0.8), 0.9)),
            evidenceRefs: baseIssue.evidenceRefs ?? context.evidenceRefs ?? [],
            affectedSelector: baseIssue.affectedSelector ?? null,
            detectorSignals: {
              proxyMappedFrom: baseIssue.issueType,
              sourceSeverity: baseIssue.severity ?? null
            }
          },
          context.snapshot
        );
      }
      return null;
    }
  };
}

const expansionUiuxProxyChecks = UIUX_EXPANSION_CHECK_IDS.map((checkId) =>
  createExpansionProxyCheck(checkId)
);

export const baselineUiuxChecks = [
  overlayBlockingCheck,
  consentBannerBlockingTaskCheck,
  aboveFoldOverloadCheck,
  contentScannabilityPoorCheck,
  horizontalScrollCheck,
  clippedPrimaryCtaCheck,
  stuckLoadingCheck,
  brokenLinkCheck,
  brokenImageCheck,
  imageMissingAltUiuxCheck,
  brokenIconCheck,
  brokenPrimaryNavCheck,
  unclickableVisibleControlCheck,
  touchTargetTooSmallCheck,
  stickyOverlayHidesContentCheck,
  severeAlignmentBreakCheck,
  interactiveNoOpCheck,
  navigationTrapPatternCheck,
  touchHoverOnlyCriticalActionCheck,
  formLabelMissingCheck,
  requiredOptionalUnclearCheck,
  inputFormatHelpMissingCheck,
  disabledSubmitNoExplanationCheck,
  fieldErrorNotVisibleCheck,
  interactiveNameMissingUiuxCheck,
  genericActionLabelsCheck,
  headingOrderSuspiciousUiuxCheck,
  toastOrErrorWithoutRecoveryCheck,
  textOverflowClipCheck,
  localizationOverflowHintCheck,
  mediaScalingBrokenCheck,
  tableChartMobileUsabilityCheck,
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
  ctaPriorityConflictCheck,
  ...expansionUiuxProxyChecks
];
