import { classifyUiuxElement } from "../../services/uiuxSafeActionClassifier.js";
import { normalizePathFromUrl } from "../clustering.js";
import {
  jaccardSimilarity,
  normalizeNavLabels,
  resolvePrimaryPageType
} from "./similarity.js";

function buildIssue(issue, snapshot) {
  return {
    issueType: issue.issueType,
    severity: issue.severity,
    title: issue.title,
    expected: issue.expected,
    actual: issue.actual,
    confidence: issue.confidence,
    evidenceRefs: issue.evidenceRefs ?? [],
    affectedSelector: issue.affectedSelector ?? null,
    affectedUrl: issue.affectedUrl ?? snapshot?.url ?? null,
    step: issue.step ?? snapshot?.step ?? null,
    viewportLabel: issue.viewportLabel ?? snapshot?.viewportLabel ?? null
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
    if (snapshot.spinnerVisible || (snapshot.overlays ?? []).length > 0 || snapshot.contentHints?.isStaticContentPage) {
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

    return buildIssue(
      {
        issueType: "CTA_PRIORITY_CONFLICT",
        severity: "P2",
        title: "Top-fold CTAs conflict in priority",
        expected: "Top-fold primary content should emphasize a single dominant CTA.",
        actual: `Detected ${topFoldCandidates.length} primary-looking top-fold CTAs with ${uniqueLabels.length} different labels.`,
        confidence: 0.82,
        evidenceRefs,
        affectedSelector: topFoldCandidates[0]?.selector ?? null
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
  brokenPrimaryNavCheck,
  unclickableVisibleControlCheck,
  formLabelMissingCheck,
  toastOrErrorWithoutRecoveryCheck,
  textOverflowClipCheck,
  overlappingInteractiveControlsCheck,
  offscreenPrimaryNavCheck,
  nonDismissableModalCheck,
  deadEndPageCheck,
  focusVisibilitySmokeCheck,
  emptyStateWithoutGuidanceCheck,
  errorStateWithoutActionCheck,
  successStateWithoutNextStepCheck,
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
