import { useEffect, useMemo, useRef, useState } from "react";
import { resolvePrimaryEvidenceKind } from "../lib/evidencePresentation";

const UIUX_EXPLANATIONS = {
  OVERLAY_BLOCKING: {
    whatsWrong: "A blocking overlay covers key content or actions.",
    whyItMatters: "Users cannot proceed, which causes abandonment and failed journeys.",
    howToFix: [
      "Limit overlay size to non-critical regions.",
      "Provide a visible dismiss or accept control.",
      "Ensure primary actions remain reachable."
    ]
  },
  HORIZONTAL_SCROLL: {
    whatsWrong: "The page overflows horizontally in the tested viewport.",
    whyItMatters: "Content gets clipped off-screen and touch navigation becomes error-prone.",
    howToFix: [
      "Constrain wide containers with responsive max-width rules.",
      "Allow long strings to wrap or truncate safely."
    ]
  },
  CLIPPED_PRIMARY_CTA: {
    whatsWrong: "A primary call-to-action appears partially outside visible bounds.",
    whyItMatters: "Critical conversions drop when the main action is not fully visible.",
    howToFix: [
      "Adjust layout constraints for primary buttons.",
      "Avoid fixed positioning that clips CTA containers."
    ]
  },
  STUCK_LOADING: {
    whatsWrong: "The interface remains in a loading state beyond readiness thresholds.",
    whyItMatters: "Users perceive the app as broken and cannot continue workflows.",
    howToFix: [
      "Add robust loading timeouts and error transitions.",
      "Remove indefinite spinners when requests fail."
    ]
  },
  BROKEN_LINK: {
    whatsWrong: "A navigation action led to an error destination.",
    whyItMatters: "Broken navigation interrupts key user flows.",
    howToFix: [
      "Fix target routes and redirect rules.",
      "Add link health checks in CI."
    ]
  },
  BROKEN_IMAGE: {
    whatsWrong: "A visible image failed to render.",
    whyItMatters: "Missing visual context reduces trust and can hide key information.",
    howToFix: [
      "Validate image URLs and caching rules.",
      "Provide resilient fallbacks for missing media."
    ]
  },
  UNCLICKABLE_VISIBLE_CONTROL: {
    whatsWrong: "A visible control is obstructed or not actually clickable.",
    whyItMatters: "Users think the app is unresponsive and cannot progress.",
    howToFix: [
      "Fix z-index stacking so controls are not covered.",
      "Match visual affordance with real click target."
    ]
  },
  TEXT_OVERFLOW_CLIP: {
    whatsWrong: "Text content is clipped by overflow constraints.",
    whyItMatters: "Labels become unreadable, causing navigation and decision errors.",
    howToFix: [
      "Allow wrapping where possible.",
      "Use responsive typography and container sizing."
    ]
  },
  NON_DISMISSABLE_MODAL: {
    whatsWrong: "A blocking modal appears without a clear dismiss action.",
    whyItMatters: "Users can get trapped and abandon the session.",
    howToFix: [
      "Add a visible close action and keyboard escape support.",
      "Avoid hard-blocking flows without a recovery path."
    ]
  },
  DEAD_END_PAGE: {
    whatsWrong: "The page exposes no safe interactive path forward.",
    whyItMatters: "Users reach a dead end and cannot complete their task.",
    howToFix: [
      "Provide clear next-step actions.",
      "Add navigational exits from terminal states."
    ]
  },
  PAYMENT_WALL: {
    whatsWrong: "A payment or subscription wall blocks further progress on this path.",
    whyItMatters: "Coverage is limited and key content cannot be validated.",
    howToFix: [
      "Provide non-blocking preview or test route coverage.",
      "Expose core navigation before payment gating."
    ]
  }
};

const DEFAULT_EXPLANATION = {
  whatsWrong: "An objective UI issue was detected for this state.",
  whyItFailed: "The visible state did not satisfy one or more deterministic UI/UX checks.",
  whyItMatters: "It can degrade reliability, usability, or completion rates.",
  howToFix: [
    "Inspect the highlighted region and associated selector.",
    "Confirm expected behavior in this viewport and state."
  ]
};

function severityBadgeTone(severity = "P2") {
  if (severity === "P0") {
    return "bg-rose-500/25 text-rose-100 border-rose-400/40";
  }
  if (severity === "P1") {
    return "bg-amber-500/25 text-amber-100 border-amber-400/40";
  }
  if (severity === "P2") {
    return "bg-cyan-500/20 text-cyan-100 border-cyan-400/30";
  }
  return "bg-slate-700/30 text-slate-200 border-slate-400/30";
}

function toAbsoluteUrl(apiBase, value) {
  if (!value) {
    return null;
  }
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  return `${apiBase}${value}`;
}

function normalizeEvidenceRefs(evidenceRefs = []) {
  return (Array.isArray(evidenceRefs) ? evidenceRefs : [])
    .map((entry) => ({
      type: String(entry?.type ?? "").toLowerCase(),
      ref: entry?.ref ?? entry?.url ?? entry?.path ?? null,
      captureMode: entry?.captureMode ?? null,
      viewport: entry?.viewport ?? null
    }))
    .filter((entry) => entry.ref);
}

function findEvidenceRef(evidenceRefs = [], kind) {
  const normalized = normalizeEvidenceRefs(evidenceRefs);
  const byType = normalized.find((entry) => entry.type === kind);
  if (byType?.ref) {
    return byType.ref;
  }

  if (kind === "screenshot") {
    return (
      normalized.find((entry) => /\.(png|jpe?g|webp)$/i.test(String(entry.ref)))?.ref ??
      null
    );
  }

  if (kind === "video") {
    return (
      normalized.find((entry) => /\.(mp4|webm|mov)$/i.test(String(entry.ref)))?.ref ??
      null
    );
  }

  return null;
}

function findEvidenceEntry(evidenceRefs = [], kind) {
  const normalized = normalizeEvidenceRefs(evidenceRefs);
  const byType = normalized.find((entry) => entry.type === kind);
  if (byType) {
    return byType;
  }

  if (kind === "screenshot") {
    return normalized.find((entry) => /\.(png|jpe?g|webp)$/i.test(String(entry.ref))) ?? null;
  }

  if (kind === "video") {
    return normalized.find((entry) => /\.(mp4|webm|mov)$/i.test(String(entry.ref))) ?? null;
  }

  return null;
}

function normalizePrimaryEvidence(primaryEvidence = null) {
  if (!primaryEvidence || typeof primaryEvidence !== "object") {
    return null;
  }
  const type = String(
    primaryEvidence.type ??
      (primaryEvidence.videoRef ? "video" : "screenshot")
  ).toLowerCase();
  const ref = primaryEvidence.ref ?? primaryEvidence.videoRef ?? primaryEvidence.screenshotRef ?? null;
  if (!ref) {
    return null;
  }
  return {
    type: type === "video" ? "video" : "screenshot",
    ref,
    captureMode: primaryEvidence.captureMode ?? "viewport",
    viewport: primaryEvidence.viewport ?? primaryEvidence.highlight?.viewport ?? null,
    highlight: primaryEvidence.highlight ?? null
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function useElementSize(ref, deps = []) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      setSize({ width: 0, height: 0 });
      return undefined;
    }

    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: rect.width,
        height: rect.height
      });
    };

    update();
    window.addEventListener("resize", update);

    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => update());
      observer.observe(node);
    }

    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return size;
}

function resolveExplanation(failure) {
  const functionalDescription = failure?.description ?? null;
  if (failure?.mode === "functional" && functionalDescription && typeof functionalDescription === "object") {
    const expected = String(functionalDescription.expected ?? failure?.expected ?? "").trim();
    const actual = String(functionalDescription.actual ?? failure?.actual ?? "").trim();
    const whyItFailed = String(
      functionalDescription.whyItFailed ??
        failure?.whyItFailed ??
        failure?.actual ??
        "Observed behavior did not match expected behavior."
    ).trim();
    const whatFailed = String(
      functionalDescription.whatFailed ?? failure?.title ?? failure?.issueType ?? "Functional assertion failed."
    ).trim();
    return {
      whatHappened: whatFailed,
      whyItFailed,
      whyItMatters: "This indicates a functional behavior defect that blocks expected user outcomes.",
      recommendedFix: [
        "Replay the attached failure video to reproduce the exact sequence.",
        "Validate route/state transitions against the expected assertion.",
        "Fix the failing logic and rerun the functional suite."
      ],
      expected,
      actual
    };
  }

  const structured = failure?.explanation ?? null;
  if (structured && typeof structured === "object") {
    const recommendedFix = Array.isArray(structured.recommendedFix)
      ? structured.recommendedFix.filter(Boolean).slice(0, 3)
      : [];
    return {
      whatHappened: structured.whatHappened ?? structured.whatsWrong ?? DEFAULT_EXPLANATION.whatsWrong,
      whyItFailed:
        structured.whyItFailed ??
        structured.actual ??
        failure?.actual ??
        DEFAULT_EXPLANATION.whyItFailed,
      whyItMatters: structured.whyItMatters ?? DEFAULT_EXPLANATION.whyItMatters,
      recommendedFix: recommendedFix.length ? recommendedFix : DEFAULT_EXPLANATION.howToFix,
      expected: failure?.expected ?? "",
      actual: failure?.actual ?? ""
    };
  }
  if (failure?.mode === "uiux") {
    const mapped = UIUX_EXPLANATIONS[failure?.issueType] ?? DEFAULT_EXPLANATION;
    return {
      whatHappened: mapped.whatsWrong ?? DEFAULT_EXPLANATION.whatsWrong,
      whyItFailed: failure?.actual ?? mapped.whyItFailed ?? DEFAULT_EXPLANATION.whyItFailed,
      whyItMatters: mapped.whyItMatters ?? DEFAULT_EXPLANATION.whyItMatters,
      recommendedFix: mapped.howToFix ?? DEFAULT_EXPLANATION.howToFix,
      expected: failure?.expected ?? "",
      actual: failure?.actual ?? ""
    };
  }
  return {
    whatHappened: DEFAULT_EXPLANATION.whatsWrong,
    whyItFailed: failure?.actual ?? DEFAULT_EXPLANATION.whyItFailed,
    whyItMatters: DEFAULT_EXPLANATION.whyItMatters,
    recommendedFix: DEFAULT_EXPLANATION.howToFix,
    expected: failure?.expected ?? "",
    actual: failure?.actual ?? ""
  };
}

export default function EvidenceViewer({ open, onClose, failure, apiBase }) {
  const imageRef = useRef(null);
  const [showHighlight, setShowHighlight] = useState(true);
  const imageSize = useElementSize(imageRef, [open, failure?.id]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  useEffect(() => {
    setShowHighlight(true);
  }, [failure?.id, open]);

  const primaryEvidence = useMemo(
    () => normalizePrimaryEvidence(failure?.primaryEvidence ?? null),
    [failure?.primaryEvidence]
  );
  const isFunctionalFailure = failure?.mode === "functional";
  const screenshotRef = useMemo(
    () =>
      primaryEvidence?.type === "screenshot"
        ? primaryEvidence.ref
        : findEvidenceRef(failure?.evidenceRefs ?? [], "screenshot"),
    [failure?.evidenceRefs, primaryEvidence?.ref, primaryEvidence?.type]
  );
  const screenshotEntry = useMemo(
    () =>
      primaryEvidence?.type === "screenshot"
        ? primaryEvidence
        : findEvidenceEntry(failure?.evidenceRefs ?? [], "screenshot"),
    [failure?.evidenceRefs, primaryEvidence]
  );
  const videoRef = useMemo(
    () =>
      primaryEvidence?.type === "video"
        ? primaryEvidence.ref
        : findEvidenceRef(failure?.evidenceRefs ?? [], "video"),
    [failure?.evidenceRefs, primaryEvidence?.ref, primaryEvidence?.type]
  );
  const screenshotUrl = toAbsoluteUrl(apiBase, screenshotRef);
  const videoUrl = toAbsoluteUrl(apiBase, videoRef);
  const primaryMediaKind = resolvePrimaryEvidenceKind({
    mode: failure?.mode ?? "",
    videoRef: videoUrl,
    screenshotRef: screenshotUrl
  });
  const explanation = resolveExplanation(failure);
  const highlight = primaryMediaKind === "screenshot"
    ? (failure?.primaryEvidence?.highlight ?? failure?.highlight ?? null)
    : null;

  const overlayStyle = useMemo(() => {
    if (!showHighlight) {
      return null;
    }

    if (!highlight || highlight.kind !== "box" || !highlight.box || !highlight.viewport) {
      return null;
    }

    const renderedWidth = Number(imageSize.width ?? 0);
    const renderedHeight = Number(imageSize.height ?? 0);
    const viewportWidth = Math.max(Number(highlight.viewport.width ?? 0), 1);
    const viewportHeight = Math.max(Number(highlight.viewport.height ?? 0), 1);
    if (renderedWidth <= 0 || renderedHeight <= 0) {
      return null;
    }

    const ratioX = renderedWidth / viewportWidth;
    const ratioY = renderedHeight / viewportHeight;
    const left = clamp(Number(highlight.box.x ?? 0) * ratioX, 0, Math.max(renderedWidth - 1, 0));
    const top = clamp(Number(highlight.box.y ?? 0) * ratioY, 0, Math.max(renderedHeight - 1, 0));
    const width = clamp(Number(highlight.box.width ?? 0) * ratioX, 1, Math.max(renderedWidth - left, 1));
    const height = clamp(Number(highlight.box.height ?? 0) * ratioY, 1, Math.max(renderedHeight - top, 1));

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    };
  }, [highlight, imageSize.height, imageSize.width, showHighlight]);

  if (!open || !failure) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex">
      <button
        type="button"
        aria-label="Close evidence viewer"
        className="h-full flex-1 bg-slate-950/75"
        onClick={onClose}
      />

      <aside className="h-full w-full max-w-6xl border-l border-white/10 bg-slate-950 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">
            Evidence Viewer
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.04]"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid h-[calc(100vh-110px)] min-h-0 gap-4 lg:grid-cols-[minmax(0,1.5fr)_360px]">
          <section className="min-h-0 rounded-2xl border border-white/10 bg-slate-900/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                {primaryMediaKind === "video" ? "Video Evidence" : "Screenshot"}
              </p>
              <div className="flex items-center gap-2">
                {primaryMediaKind === "screenshot" ? (
                  <button
                    type="button"
                    onClick={() => setShowHighlight((value) => !value)}
                    className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/[0.04]"
                  >
                    {showHighlight ? "Hide highlight" : "Show highlight"}
                  </button>
                ) : null}
                {primaryMediaKind === "video" && videoUrl ? (
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    Open raw video
                  </a>
                ) : null}
                {primaryMediaKind === "screenshot" && screenshotUrl ? (
                  <a
                    href={screenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  >
                    Open raw screenshot
                  </a>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex h-[calc(100%-34px)] min-h-0 items-center justify-center overflow-auto rounded-xl border border-white/10 bg-slate-950">
              {primaryMediaKind === "video" && videoUrl ? (
                <video
                  controls
                  className="max-h-[72vh] w-full max-w-full rounded-lg bg-black"
                  src={videoUrl}
                />
              ) : screenshotUrl ? (
                <div className="relative inline-block max-w-full">
                  <img
                    ref={imageRef}
                    src={screenshotUrl}
                    alt={`${failure.issueType} screenshot`}
                    className="max-h-[72vh] w-auto max-w-full object-contain"
                  />
                  {overlayStyle ? (
                    <>
                      <div
                        className="pointer-events-none absolute border-2 border-rose-400 bg-rose-500/15 shadow-[0_0_0_9999px_rgba(15,23,42,0.12)]"
                        style={overlayStyle}
                      />
                      <div
                        className="pointer-events-none absolute -translate-y-full rounded-md border border-rose-300/40 bg-rose-500/90 px-2 py-0.5 text-[10px] font-semibold text-white"
                        style={{
                          left: overlayStyle.left,
                          top: overlayStyle.top
                        }}
                      >
                        {highlight?.label ?? failure?.issueType ?? "issue"}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="px-4 text-center text-sm text-slate-500">
                  {primaryMediaKind === "video"
                    ? "No video evidence was captured for this case."
                    : "No screenshot evidence was captured for this case."}
                </div>
              )}
            </div>
          </section>

          <section className="min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${severityBadgeTone(failure.severity)}`}>
                {failure.severity}
              </span>
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100">
                {failure.deviceLabel ?? "default"}
              </span>
              <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-slate-300">
                {failure.issueType}
              </span>
            </div>

            <h3 className="mt-3 text-sm font-semibold text-white">{failure.title}</h3>
            <div className="mt-2 space-y-1 text-xs text-slate-400">
              <p className="truncate">URL: {failure.pageUrl || "-"}</p>
              <p>Step: {failure.step ?? "-"}</p>
              <p>Selector: {failure.affectedSelector ?? "-"}</p>
              {primaryMediaKind === "screenshot" && screenshotEntry?.captureMode ? (
                <p>Capture mode: {screenshotEntry.captureMode}</p>
              ) : null}
              {highlight?.confidence ? (
                <p>Highlight confidence: {Math.round(Number(highlight.confidence) * 100)}%</p>
              ) : null}
              {failure.grouped ? (
                <p>
                  Affected devices: {failure.affectedDeviceCount ?? failure.devices?.length ?? 1}
                </p>
              ) : null}
              {failure.grouped && failure.sourceIssueTypes?.length > 1 ? (
                <p>Merged issue types: {failure.sourceIssueTypes.join(", ")}</p>
              ) : null}
              {failure.judgmentPolicy ? <p>Judgment policy: {failure.judgmentPolicy}</p> : null}
              {failure.supportingSignalCounts ? (
                <p>
                  Signals: {failure.supportingSignalCounts.strong ?? 0} strong / {failure.supportingSignalCounts.medium ?? 0} medium / {failure.supportingSignalCounts.weak ?? 0} weak
                </p>
              ) : null}
            </div>

            {(failure.rawDetectorResult || failure.llmJudgment || failure.calibratedJudgment) ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                <p className="uppercase tracking-[0.18em] text-slate-500">Judgment Calibration</p>
                <p className="mt-1 text-slate-200">
                  Raw detector verdict: {failure.rawDetectorResult?.verdict ?? "n/a"}
                </p>
                <p className="mt-1 text-slate-200">
                  Model verdict: {failure.llmJudgment?.verdict ?? "n/a"}
                </p>
                <p className="mt-1 text-slate-200">
                  Calibrated final verdict: {failure.calibratedJudgment?.verdict ?? "n/a"}
                </p>
                {failure.downgradeReason ? (
                  <p className="mt-1 text-amber-100">Downgrade reason: {failure.downgradeReason}</p>
                ) : null}
              </div>
            ) : null}

            {failure.grouped && failure.devices?.length ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Affected devices</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {failure.devices.map((device) => (
                    <span
                      key={`${device.deviceId ?? "device"}-${device.deviceLabel ?? device.viewportLabel}`}
                      className="rounded-full border border-cyan-300/20 px-2 py-0.5 text-[11px] text-cyan-100"
                    >
                      {device.deviceLabel ?? device.viewportLabel}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">What happened</p>
              <p className="mt-1 text-sm text-slate-200">{explanation.whatHappened}</p>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Why it failed</p>
              <p className="mt-1 text-sm text-slate-200">{explanation.whyItFailed}</p>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Why it matters</p>
              <p className="mt-1 text-sm text-slate-200">{explanation.whyItMatters}</p>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">How to fix</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-200">
                {(explanation.recommendedFix ?? []).slice(0, 3).map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>

            {isFunctionalFailure ? (
              <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-500/10 p-3 text-xs text-cyan-50">
                <p className="uppercase tracking-[0.18em] text-cyan-200">Functional Failure Description</p>
                <p className="mt-2">
                  <span className="font-semibold text-cyan-100">What failed:</span>{" "}
                  {failure.description?.whatFailed ?? failure.title ?? failure.issueType}
                </p>
                <p className="mt-2">
                  <span className="font-semibold text-cyan-100">Expected:</span>{" "}
                  {failure.description?.expected ?? explanation.expected ?? failure.expected ?? "-"}
                </p>
                <p className="mt-2">
                  <span className="font-semibold text-cyan-100">Actual:</span>{" "}
                  {failure.description?.actual ?? explanation.actual ?? failure.actual ?? "-"}
                </p>
                <p className="mt-2">
                  <span className="font-semibold text-cyan-100">Why this is a bug:</span>{" "}
                  {failure.description?.whyItFailed ?? explanation.whyItFailed}
                </p>
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
              <p className="uppercase tracking-[0.18em] text-slate-500">Observed</p>
              <p className="mt-1 text-slate-200">{failure.actual ?? "No observation available."}</p>
              {failure.expected ? (
                <>
                  <p className="mt-3 uppercase tracking-[0.18em] text-slate-500">Expected</p>
                  <p className="mt-1 text-slate-200">{failure.expected}</p>
                </>
              ) : null}
            </div>

            {videoUrl && primaryMediaKind !== "video" ? (
              <div className="mt-3">
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  Open related video evidence
                </a>
              </div>
            ) : null}

            <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300">
              <summary className="cursor-pointer select-none text-[11px] uppercase tracking-[0.18em] text-slate-500">
                Raw Artifact Metadata
              </summary>
              <div className="mt-2 space-y-1">
                {(failure.evidenceRefs ?? []).map((entry, index) => (
                  <p key={`${entry.type ?? "artifact"}-${entry.ref ?? index}`} className="break-all">
                    <span className="font-mono text-slate-400">{entry.type ?? "artifact"}:</span>{" "}
                    {entry.ref ?? "-"}
                  </p>
                ))}
                {!(failure.evidenceRefs ?? []).length ? <p className="text-slate-500">No raw evidence refs.</p> : null}
              </div>
            </details>
          </section>
        </div>
      </aside>
    </div>
  );
}
