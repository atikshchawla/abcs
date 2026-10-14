"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlgorithmId, SimulationEvent } from "@/lib/model/types";
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
import { AlignedGantts } from "@/components/demo/AlignedGantts";
import { DecisionPanel } from "@/components/demo/DecisionPanel";
import { BehaviourPanel } from "@/components/simulation/BehaviourPanel";
import { ProcessTable } from "@/components/simulation/ProcessTable";
import { EventLog } from "@/components/simulation/EventLog";
import { ReplayTimeline } from "@/lib/simulation/replay";

type OpenSection = "none" | "scores" | "events" | "processes" | "methodology";

export function DemoApp() {
  const workloads = useMemo(() => listDemoWorkloads(), []);
  const [workloadId, setWorkloadId] = useState("changing");
  const [results, setResults] = useState<DemoResults | null>(null);
  const [decisionPoints, setDecisionPoints] = useState<DecisionPoint[]>([]);
  const [decisionIdx, setDecisionIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [openSection, setOpenSection] = useState<OpenSection>("none");
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const meta = getDemoWorkloadMeta(workloadId);

  const run = useCallback(() => {
    setRunning(true);
    setError(null);
    // Defer so the UI can paint the running state before the sync sim.
    setTimeout(() => {
      try {
        const workload = getDemoWorkload(workloadId);
        if (!workload) throw new Error(`Unknown workload: ${workloadId}`);
        const r = runDemoComparison(workload);
        const points = extractDecisionPoints(r);
        setResults(r);
        setDecisionPoints(points);
        setDecisionIdx(0);
        setPlaying(false);
      } catch (err) {
        setResults(null);
        setDecisionPoints([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 10);
  }, [workloadId]);

  // Auto-run on first mount so the page is never empty (deferred one tick
  // so setState is not called synchronously inside the effect body).
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
    }, 900);
    return () => {
      if (playTimer.current) clearInterval(playTimer.current);
    };
  }, [playing, decisionPoints.length]);

  const point = decisionPoints[decisionIdx] ?? null;
  const selectedTime = point?.time ?? 0;

  const onSelectTime = useCallback(
    (time: number) => {
      // Snap to the nearest decision point at or before `time`.
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

  const sentence = results ? buildComparisonSentence(results) : "";

  // Replay snapshots for the progressive-disclosure process table.
  const rrTimeline = useMemo(
    () => (results ? new ReplayTimeline(results.RR) : null),
    [results],
  );
  const abcsTimeline = useMemo(
    () => (results ? new ReplayTimeline(results.ABCS) : null),
    [results],
  );
  const rrSnapshot = rrTimeline?.stateAt(selectedTime) ?? null;
  const abcsSnapshot = abcsTimeline?.stateAt(selectedTime) ?? null;

  const toggleSection = (s: OpenSection) =>
    setOpenSection((cur) => (cur === s ? "none" : s));

  const eventLogAlgo = "ABCS" as AlgorithmId;
  const abcsEventsUpTo = results
    ? results.ABCS.events.filter((e: SimulationEvent) => e.time <= selectedTime)
    : [];

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-2.5">
      {/* Section A — workload controls */}
      <section
        aria-label="Workload controls"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:max-w-xs">
          <span className="text-[11px] font-medium text-zinc-500">Workload</span>
          <select
            value={workloadId}
            onChange={(e) => setWorkloadId(e.target.value)}
            className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            aria-label="Select workload"
          >
            {workloads.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <p className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={meta?.description}>
          {meta?.description}
        </p>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="h-8 shrink-0 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {running ? "Running…" : "Run Comparison"}
        </button>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          Simulation failed: {error}
        </div>
      )}

      {results && (
        <>
          {/* Section B — three scheduler result cards + comparison sentence */}
          <ResultCards results={results} />
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {sentence}
          </p>

          {/* Section C — aligned timelines + decision panel */}
          <div className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0">
              <AlignedGantts
                results={results}
                selectedTime={selectedTime}
                onSelectTime={onSelectTime}
              />
            </div>
            <DecisionPanel
              point={point}
              results={results}
              onPrev={() => {
                setDecisionIdx((i) => Math.max(0, i - 1));
                setPlaying(false);
              }}
              onNext={() => {
                setDecisionIdx((i) => Math.min(decisionPoints.length - 1, i + 1));
                setPlaying(false);
              }}
              onTogglePlay={() => setPlaying((p) => !p)}
              playing={playing}
              onJumpToFirstTransition={onJumpToFirstTransition}
              hasTransition={hasTransition}
            />
          </div>

          {/* Section D — progressive disclosure */}
          <section
            aria-label="Additional details"
            className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap gap-1 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
              {(
                [
                  ["scores", "ABCS behaviour scores"],
                  ["events", "ABCS event log (to t=" + selectedTime + ")"],
                  ["processes", "Per-process state at t=" + selectedTime],
                  ["methodology", "Methodology & definitions"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSection(key)}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    openSection === key
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                  aria-expanded={openSection === key}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="p-2.5">
              {openSection === "scores" && (
                <BehaviourPanel
                  history={results.ABCS.behaviourHistory}
                  currentTime={selectedTime}
                  selectedProcess={point?.ABCS.processId ?? null}
                  show
                />
              )}
              {openSection === "events" && (
                <EventLog
                  events={abcsEventsUpTo}
                  selectedProcess={point?.ABCS.processId ?? null}
                />
              )}
              {openSection === "processes" && rrSnapshot && abcsSnapshot && (
                <div className="grid gap-2.5 xl:grid-cols-2">
                  <ProcessTable
                    processes={rrSnapshot.processes}
                    selectedProcess={point?.ABCS.processId ?? null}
                    onSelectProcess={() => {}}
                    algorithm="RR"
                  />
                  <ProcessTable
                    processes={abcsSnapshot.processes}
                    selectedProcess={point?.ABCS.processId ?? null}
                    onSelectProcess={() => {}}
                    algorithm={eventLogAlgo}
                  />
                </div>
              )}
              {openSection === "processes" && (!rrSnapshot || !abcsSnapshot) && (
                <p className="text-xs text-zinc-500">
                  Run a comparison to inspect per-process state.
                </p>
              )}
              {openSection === "methodology" && <MethodologyBrief />}
            </div>
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

function MethodologyBrief() {
  return (
    <div className="grid gap-4 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 md:grid-cols-2">
      <div>
        <h3 className="mb-1 font-semibold text-zinc-800 dark:text-zinc-100">
          What is simulated
        </h3>
        <p>
          A deterministic discrete-event simulator with a single CPU and integer
          time ticks. Processes arrive, execute ordered CPU/I/O phases, and
          terminate. This is <strong>not</strong> a real OS scheduler — it never
          changes how your computer schedules processes.
        </p>
        <h3 className="mt-2 mb-1 font-semibold text-zinc-800 dark:text-zinc-100">
          Round Robin
        </h3>
        <p>
          Fixed quantum (4 ticks), FIFO ready queue. A process that exhausts its
          quantum and still has CPU work returns to the queue tail.
        </p>
        <h3 className="mt-2 mb-1 font-semibold text-zinc-800 dark:text-zinc-100">
          MLFQ
        </h3>
        <p>
          Three feedback queues with quanta [2, 4, 8]. New processes enter the
          top queue; full-quantum consumption demotes one level; I/O blocking
          boosts back to the top; a periodic boost returns all processes to the
          top queue.
        </p>
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-zinc-800 dark:text-zinc-100">
          ABCS (adaptive behaviour-aware)
        </h3>
        <p>
          Per-process EMA scores for CPU demand, I/O activity, and latency
          sensitivity. Effective priority = responsiveness weight × latency
          score + bounded READY-wait aging. Adaptive quantum from {""}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">[2, 4, 8]</code>{" "}
          based on past observations. Transition detection (fast vs baseline EMA,
          threshold + persistence + cooldown) resets the quantum; stability
          controls freeze further changes briefly.
        </p>
        <h3 className="mt-2 mb-1 font-semibold text-zinc-800 dark:text-zinc-100">
          Metrics
        </h3>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <strong>Response time</strong> = first CPU start − arrival (↓ better)
          </li>
          <li>
            <strong>Waiting time</strong> = total READY time (↓ better)
          </li>
          <li>
            <strong>Turnaround</strong> = completion − arrival (↓ better)
          </li>
          <li>
            <strong>Completed</strong> = processes finished (↑ better)
          </li>
        </ul>
        <p className="mt-1 text-[10px] text-zinc-500">
          All three algorithms run on the same immutable workload object (deep-
          cloned per run). Percentages in the comparison sentence are computed
          from the actual simulation output, never hard-coded.
        </p>
      </div>
    </div>
  );
}
