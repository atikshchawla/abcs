"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AbcsConfigInput, SimulationEvent } from "@/lib/model/types";
import {
  listDemoWorkloads,
  getDemoWorkload,
  getDemoWorkloadMeta,
} from "@/lib/workloads/demo";
import {
  runDemoComparison,
  extractDecisionPoints,
  buildComparisonSentence,
  type DemoResults,
  type DecisionPoint,
} from "@/lib/demo/compare";
import { ResultCards } from "@/components/demo/ResultCards";
import { AbcsTimeline } from "@/components/demo/AbcsTimeline";
import { BaselinePanel } from "@/components/demo/BaselinePanel";
import { DecisionFlow, type FlowStage } from "@/components/demo/DecisionFlow";
import { BehaviourChart } from "@/components/demo/BehaviourChart";
import { ConfigPanel } from "@/components/demo/ConfigPanel";
import { EventLog } from "@/components/simulation/EventLog";

export function DemoApp() {
  const workloads = useMemo(() => listDemoWorkloads(), []);
  const [workloadId, setWorkloadId] = useState("changing");
  const [results, setResults] = useState<DemoResults | null>(null);
  const [decisionPoints, setDecisionPoints] = useState<DecisionPoint[]>([]);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [focusedStage, setFocusedStage] = useState<FlowStage>(3);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [lastCustomDiff, setLastCustomDiff] = useState<
    { key: keyof AbcsConfigInput; label: string; from: number; to: number }[] | null
  >(null);
  const [configUsed, setConfigUsed] = useState<Partial<AbcsConfigInput> | null>(null);
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const meta = getDemoWorkloadMeta(workloadId);

  const run = useCallback(
    (abcsOverride?: Partial<AbcsConfigInput>) => {
      setRunning(true);
      setError(null);
      setTimeout(() => {
        try {
          const workload = getDemoWorkload(workloadId);
          if (!workload) throw new Error(`Unknown workload: ${workloadId}`);
          const r = runDemoComparison(workload, abcsOverride);
          const points = extractDecisionPoints(r);
          setResults(r);
          setDecisionPoints(points);
          setDecisionIdx(0);
          setFocusedStage(3);
          setPlaying(false);
          setConfigUsed(abcsOverride && Object.keys(abcsOverride).length > 0 ? abcsOverride : null);
        } catch (err) {
          setResults(null);
          setDecisionPoints([]);
          setLastCustomDiff(null);
          setConfigUsed(null);
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setRunning(false);
        }
      }, 10);
    },
    [workloadId],
  );

  // Auto-run default comparison on first mount.
  useEffect(() => {
    const t = setTimeout(() => run(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decision playback.
  useEffect(() => {
    if (playTimer.current) {
      clearInterval(playTimer.current);
      playTimer.current = null;
    }
    if (!playing || decisionPoints.length === 0) return;
    playTimer.current = setInterval(() => {
      setDecisionIdx((i) => {
        if (i >= decisionPoints.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
      // Cycle focused stage on each playback step for visual variety.
      setFocusedStage((s) => ((s + 1) % 6) as FlowStage);
    }, 900);
    return () => {
      if (playTimer.current) clearInterval(playTimer.current);
    };
  }, [playing, decisionPoints.length]);

  const point = decisionPoints[decisionIdx] ?? null;
  const selectedTime = point?.time ?? 0;

  const onSelectTime = useCallback(
    (time: number) => {
      if (decisionPoints.length === 0) return;
      let idx = 0;
      for (let i = 0; i < decisionPoints.length; i++) {
        if (decisionPoints[i].time <= time) idx = i;
        else break;
      }
      setDecisionIdx(idx);
      setPlaying(false);
    },
    [decisionPoints],
  );

  const onJumpToFirstTransition = useCallback(() => {
    if (!results) return;
    const t = results.ABCS.events.find(
      (e) => e.type === "TRANSITION_DETECTED" || e.type === "POLICY_ADJUSTMENT",
    );
    if (!t) return;
    onSelectTime(t.time);
  }, [results, onSelectTime]);

  const hasTransition = useMemo(() => {
    if (!results) return false;
    return results.ABCS.events.some(
      (e) => e.type === "TRANSITION_DETECTED" || e.type === "POLICY_ADJUSTMENT",
    );
  }, [results]);

  const transitionTimes = useMemo(() => {
    if (!results) return [] as number[];
    return results.ABCS.events
      .filter((e) => e.type === "TRANSITION_DETECTED")
      .map((e) => e.time);
  }, [results]);

  const sentence = results ? buildComparisonSentence(results) : "";

  const abcsRecord = point?.abcsDetail?.record ?? null;
  const abcsSelectedProcess = point?.ABCS.processId ?? null;

  const abcsEventsUpTo = results
    ? results.ABCS.events.filter((e: SimulationEvent) => e.time <= selectedTime)
    : [];

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-2">
      {/* Section A — compact header & controls */}
      <section
        aria-label="Workload controls"
        className="flex flex-wrap items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-tight">ABCS — Adaptive Behaviour-Aware CPU Scheduler</p>
          <p className="text-[10px] text-zinc-500">
            Discrete-event simulator · not a real OS scheduler · integer ticks
          </p>
        </div>
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-medium text-zinc-500">Workload</span>
          <select
            value={workloadId}
            onChange={(e) => setWorkloadId(e.target.value)}
            className="h-7 rounded-md border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            aria-label="Select workload"
          >
            {workloads.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <p className="min-w-0 flex-1 truncate text-[10px] text-zinc-500" title={meta?.description}>
          {meta?.description}
        </p>
        <button
          type="button"
          onClick={() => run(configUsed ?? undefined)}
          disabled={running}
          className="h-7 shrink-0 rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {running ? "Running…" : "Run Comparison"}
        </button>

        {/* Playback controls */}
        <div className="flex items-center gap-1 border-l border-zinc-200 pl-2.5 dark:border-zinc-700" role="toolbar" aria-label="Decision playback">
          <button
            type="button"
            onClick={() => {
              setDecisionIdx((i) => Math.max(0, i - 1));
              setPlaying(false);
            }}
            disabled={decisionPoints.length === 0}
            className="h-7 rounded border border-zinc-300 px-2 text-[10px] font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Previous decision"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={decisionPoints.length === 0}
            className="h-7 rounded border border-zinc-300 px-2 text-[10px] font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDecisionIdx((i) => Math.min(decisionPoints.length - 1, i + 1));
              setPlaying(false);
            }}
            disabled={decisionPoints.length === 0}
            className="h-7 rounded border border-zinc-300 px-2 text-[10px] font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Next decision"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={() => {
              setDecisionIdx(0);
              setPlaying(false);
            }}
            className="h-7 rounded border border-zinc-300 px-2 text-[10px] font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Reset to first decision"
          >
            ⟲
          </button>
          {hasTransition && (
            <button
              type="button"
              onClick={onJumpToFirstTransition}
              className="h-7 rounded border border-violet-300 px-2 text-[10px] font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"
              title="Jump to first ABCS transition"
            >
              ↯ transition
            </button>
          )}
          <span className="ml-1 text-[10px] tabular-nums text-zinc-400">
            {decisionPoints.length > 0 ? `${decisionIdx + 1}/${decisionPoints.length} · t=${selectedTime}` : "—"}
          </span>
        </div>

        {configUsed && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            custom config
          </span>
        )}
      </section>

      {error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Simulation failed: {error}
        </div>
      )}

      <ConfigPanel
        onRunWithConfig={(draft) => {
          run(draft);
          // Compute diff for the compare view (only numeric keys).
          import("@/lib/demo/compare").then(({ diffAbcsConfig }) => {
            setLastCustomDiff(diffAbcsConfig(draft));
          });
        }}
        onRunDefault={() => {
          setLastCustomDiff(null);
          run();
        }}
        running={running}
        lastCustomDiff={lastCustomDiff}
      />

      {results && (
        <>
          {/* Section B — ABCS primary: decision summary + large timeline + flow + behaviour */}
          <section aria-label="ABCS primary" className="space-y-2">
            {/* Decision summary bar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-900">
              <span>
                <span className="text-zinc-500">t =</span>{" "}
                <span className="font-semibold tabular-nums">{selectedTime}</span>
              </span>
              <span>
                <span className="text-zinc-500">selected:</span>{" "}
                <span className="font-semibold text-violet-700 dark:text-violet-400">
                  {abcsSelectedProcess ?? "—"}
                </span>
              </span>
              {abcsRecord && (
                <>
                  <span>
                    <span className="text-zinc-500">priority:</span>{" "}
                    <span className="font-semibold tabular-nums">
                      {abcsRecord.contributions.find((c) => c.processId === abcsRecord.selectedProcessId)?.totalPriority.toFixed(1) ?? "—"}
                    </span>
                  </span>
                  <span>
                    <span className="text-zinc-500">quantum:</span>{" "}
                    <span className="font-semibold tabular-nums">{abcsRecord.quantum ?? "—"}</span>
                  </span>
                </>
              )}
              <span>
                <span className="text-zinc-500">transition:</span>{" "}
                {hasTransition ? (
                  <span className="font-medium text-amber-600 dark:text-amber-400">confirmed</span>
                ) : (
                  <span className="text-zinc-400">none</span>
                )}
              </span>
              {results.ABCS.metrics.policyChangeCount > 0 && (
                <span className="text-zinc-500">
                  policy changes:{" "}
                  <span className="font-medium tabular-nums">{results.ABCS.metrics.policyChangeCount}</span>
                </span>
              )}
            </div>

            {/* Large ABCS timeline */}
            <AbcsTimeline
              result={results.ABCS}
              processIds={results.processIds}
              selectedTime={selectedTime}
              onSelectTime={onSelectTime}
            />

            {/* Interactive decision flow (React Flow) */}
            <DecisionFlow
              record={abcsRecord}
              focusedStage={focusedStage}
              onFocusStage={setFocusedStage}
            />

            {/* Behaviour history */}
            <BehaviourChart
              history={results.ABCS.behaviourHistory}
              selectedTime={selectedTime}
              transitionTimes={transitionTimes}
            />
          </section>

          {/* Section C — RR and MLFQ side by side */}
          <section aria-label="Baseline comparisons" className="grid gap-2 lg:grid-cols-2">
            <BaselinePanel
              algorithm="RR"
              result={results.RR}
              processIds={results.processIds}
              duration={results.duration}
              selectedTime={selectedTime}
              abcsSelectedProcess={abcsSelectedProcess}
              onSelectTime={onSelectTime}
            />
            <BaselinePanel
              algorithm="MLFQ"
              result={results.MLFQ}
              processIds={results.processIds}
              duration={results.duration}
              selectedTime={selectedTime}
              abcsSelectedProcess={abcsSelectedProcess}
              onSelectTime={onSelectTime}
            />
          </section>

          {/* Section D — results summary */}
          <ResultCards results={results} />
          <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{sentence}</p>

          {/* Section E — expandable event log */}
          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setShowEvents((s) => !s)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              aria-expanded={showEvents}
            >
              <span className={`inline-block transition-transform ${showEvents ? "rotate-90" : ""}`}>▸</span>
              ABCS event log (to t={selectedTime}) — {abcsEventsUpTo.length} events
            </button>
            {showEvents && (
              <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
                <EventLog events={abcsEventsUpTo} selectedProcess={abcsSelectedProcess} />
              </div>
            )}
          </section>
        </>
      )}

      {!results && !error && (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
          Select a workload and press Run Comparison.
        </div>
      )}
    </div>
  );
}
