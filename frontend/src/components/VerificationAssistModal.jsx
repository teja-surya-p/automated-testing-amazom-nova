import { useState } from "react";

function toneForVerdict(pass = false) {
  return pass
    ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
    : "border-rose-400/35 bg-rose-500/10 text-rose-100";
}

export default function VerificationAssistModal({
  open,
  verificationAssist,
  onDecision,
  onDecisionAll
}) {
  const [loadingKey, setLoadingKey] = useState("");
  const [error, setError] = useState("");
  const prompts = Array.isArray(verificationAssist?.prompts) ? verificationAssist.prompts : [];

  if (!open || !verificationAssist) {
    return null;
  }

  const withLoading = async (key, callback) => {
    setError("");
    setLoadingKey(key);
    try {
      await callback();
    } catch (actionError) {
      setError(actionError?.message ?? "Unable to submit verification decision.");
    } finally {
      setLoadingKey("");
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/80 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-amber-300/30 bg-slate-950 p-4 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-100">
            Verification Confirmation Required
          </h2>
          <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-xs text-slate-300">
            pending {verificationAssist.pendingPromptIds?.length ?? prompts.length}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-300">
          Agent confidence is below 100%. Confirm or override each verification before execution continues.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              withLoading("global-accept", () =>
                onDecisionAll?.({
                  decision: "accept-agent"
                })
              )
            }
            disabled={Boolean(loadingKey)}
            className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-60"
          >
            Accept All Agent Verdicts
          </button>
          <button
            type="button"
            onClick={() =>
              withLoading("global-pass", () =>
                onDecisionAll?.({
                  decision: "override-pass"
                })
              )
            }
            disabled={Boolean(loadingKey)}
            className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-60"
          >
            Mark All As PASS
          </button>
          <button
            type="button"
            onClick={() =>
              withLoading("global-fail", () =>
                onDecisionAll?.({
                  decision: "override-fail"
                })
              )
            }
            disabled={Boolean(loadingKey)}
            className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-60"
          >
            Mark All As FAIL
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {prompts.map((prompt) => (
            <section key={prompt.promptId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs text-slate-300">{prompt.ruleId ?? "UNKNOWN_RULE"}</p>
                <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${toneForVerdict(prompt.proposedPass)}`}>
                  agent says {prompt.proposedPass ? "PASS" : "FAIL"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">confidence: {Number(prompt.confidence ?? 0).toFixed(2)}</p>
              <p className="mt-2 text-xs text-slate-300">
                <span className="font-semibold text-slate-200">Expected:</span> {prompt.expected || "-"}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                <span className="font-semibold text-slate-200">Actual:</span> {prompt.actual || "-"}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    withLoading(`accept-${prompt.promptId}`, () =>
                      onDecision?.(prompt.promptId, {
                        decision: "accept-agent"
                      })
                    )
                  }
                  disabled={Boolean(loadingKey)}
                  className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-60"
                >
                  Accept Agent
                </button>
                <button
                  type="button"
                  onClick={() =>
                    withLoading(`pass-${prompt.promptId}`, () =>
                      onDecision?.(prompt.promptId, {
                        decision: "override-pass"
                      })
                    )
                  }
                  disabled={Boolean(loadingKey)}
                  className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                >
                  Override PASS
                </button>
                <button
                  type="button"
                  onClick={() =>
                    withLoading(`fail-${prompt.promptId}`, () =>
                      onDecision?.(prompt.promptId, {
                        decision: "override-fail"
                      })
                    )
                  }
                  disabled={Boolean(loadingKey)}
                  className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-60"
                >
                  Override FAIL
                </button>
              </div>
            </section>
          ))}
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

