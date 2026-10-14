"use client";

import type { AlgorithmId } from "@/lib/model/types";
import type { AlgorithmDecision, DecisionPoint, DemoResults } from "@/lib/demo/compare";
import { algorithmLabel } from "@/lib/demo/compare";

function scoreBar(label: string, value: number, hint: string) {
  return (
    <div key={label} className="flex items-center gap-1.5 text-[11px]">
      <span className="w-28 shrink-0 text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {value.toFixed(2)}
      </span>
      <span className="sr-only">{hint}</span>
    </div>
  );
}

function DecisionCard({
  algorithm,
  decision,
  isAbcsDetail,
}: {
  algorithm: AlgorithmId;
  decision: AlgorithmDecision;
  isAbcsDetail?: DecisionPoint["abcsDetail"];
}) {
  const pid = decision.processId;
  const kindLabel =
    decision.kind === "dispatch"
      ? "New decision"
      : decision.kind === "continuing"
        ? "Continuing"
        : "Idle";

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold">{algorithmLabel(algorithm)}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            decision.kind === "dispatch"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : decision.kind === "continuing"
                ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {kindLabel}
          {pid ? ` · ${pid}` : ""}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        {decision.reason}
      </p>
      {decision.quantum !== null && decision.kind === "dispatch" && (
        <p className="mt-1 text-[10px] text-zinc-500">
          Quantum granted: {decision.quantum} ticks
          {decision.since !== null && ` · started at t=${decision.since}`}
        </p>
      )}

      {algorithm === "ABCS" && isAbcsDetail && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
            Observed behaviour → decision → outcome
          </p>

          {/* Observation + estimate */}
          {isAbcsDetail.latestSample ? (
            <>
              <p className="text-[10px] text-zinc-500">
                Recent observations for {isAbcsDetail.processId} (EMA-smoothed
                estimates, not ground truth):
              </p>
              {scoreBar(
                "Recent CPU activity",
                isAbcsDetail.latestSample.scores.cpuDemandScore,
                "cpuDemandScore",
              )}
              {scoreBar(
                "I/O blocking",
                isAbcsDetail.latestSample.scores.ioActivityScore,
                "ioActivityScore",
              )}
              {scoreBar(
                "Responsiveness est.",
                isAbcsDetail.latestSample.scores.latencySensitivityScore,
                "latencySensitivityScore",
              )}
              {isAbcsDetail.latestSample.rawBurstLength !== undefined && (
                <p className="text-[10px] text-zinc-500">
                  Last observed CPU burst: {isAbcsDetail.latestSample.rawBurstLength}{" "}
                  ticks
                  {isAbcsDetail.latestSample.emaBurstLength !== undefined &&
                    ` · EMA ${isAbcsDetail.latestSample.emaBurstLength.toFixed(1)}`}
                </p>
              )}
            </>
          ) : (
            <p className="text-[10px] text-zinc-500">
              No behaviour observations recorded for {isAbcsDetail.processId} yet
              (first dispatch — scores start from defaults).
            </p>
          )}

          {/* Policy events near this decision */}
          {isAbcsDetail.nearbyPolicyEvents.length > 0 && (
            <ul className="space-y-0.5">
              {isAbcsDetail.nearbyPolicyEvents.map((e, i) => (
                <li
                  key={i}
                  className="text-[10px] text-violet-700 dark:text-violet-400"
                >
                  t={e.time} {e.type === "TRANSITION_DETECTED" ? "Transition detected" : "Policy adjustment"}:{" "}
                  {e.reason}
                </li>
              ))}
            </ul>
          )}

          {/* Outcome */}
          {isAbcsDetail.outcome ? (
            <p className="text-[10px] text-zinc-600 dark:text-zinc-400">
              Outcome: {isAbcsDetail.processId} ran [{isAbcsDetail.outcome.interval?.start},{" "}
              {isAbcsDetail.outcome.interval?.end}) and ended by{" "}
              {isAbcsDetail.outcome.endedByQuantumExpiry
                ? "quantum expiry (requeued — behaviour may warrant a different quantum next time)"
                : isAbcsDetail.outcome.endedByBurstComplete
                  ? "CPU-burst completion"
                  : "preemption / phase change"}
              .
            </p>
          ) : (
            <p className="text-[10px] text-zinc-500">
              Outcome: no CPU interval recorded for this process at/after the decision
              time (may be idle or still queued).
            </p>
          )}

          {/* Waiting-time fairness note when aging likely active */}
          <p className="text-[10px] text-zinc-500">
            Waiting-time fairness adjustment: long READY waits add a bounded priority
            boost (aging) so no process is starved indefinitely.
          </p>
        </div>
      )}
    </div>
  );
}

export function DecisionPanel({
  point,
  results,
  onPrev,
  onNext,
  onTogglePlay,
  playing,
  onJumpToFirstTransition,
  hasTransition,
}: {
  point: DecisionPoint | null;
  results: DemoResults | null;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  playing: boolean;
  onJumpToFirstTransition: () => void;
  hasTransition: boolean;
}) {
  if (!point || !results) {
    return (
      <section
        aria-label="Scheduling decisions"
        className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Why did each scheduler choose this process?
        </h2>
        <p className="text-xs text-zinc-500">
          Run a comparison to inspect scheduling decisions.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Scheduling decisions"
      className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Why did each scheduler choose this process?
        </h2>
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
          decision {point.index + 1} / {results ? countDecisions(results) : 0} · t=
          {point.time}
        </span>
      </div>

      <div
        className="mb-2 flex flex-wrap items-center gap-1.5"
        role="toolbar"
        aria-label="Decision navigation"
      >
        <button
          type="button"
          onClick={onPrev}
          className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          aria-label="Previous decision"
        >
          ◀ Prev
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          aria-label={playing ? "Pause decision playback" : "Play decision playback"}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          aria-label="Next decision"
        >
          Next ▶
        </button>
        {hasTransition && (
          <button
            type="button"
            onClick={onJumpToFirstTransition}
            className="rounded border border-violet-300 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"
            title="Jump to the first ABCS transition/policy event"
          >
            ↯ First ABCS transition
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        <DecisionCard algorithm="RR" decision={point.RR} />
        <DecisionCard algorithm="MLFQ" decision={point.MLFQ} />
        <DecisionCard
          algorithm="ABCS"
          decision={point.ABCS}
          isAbcsDetail={point.abcsDetail}
        />
      </div>
    </section>
  );
}

function countDecisions(results: DemoResults): number {
  const times = new Set<number>();
  for (const r of [results.RR, results.MLFQ, results.ABCS]) {
    for (const e of r.events) if (e.type === "DISPATCH") times.add(e.time);
  }
  return times.size;
}
