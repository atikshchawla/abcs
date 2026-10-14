"use client";

import { useMemo, useState } from "react";
import type { SimulationResult } from "@/lib/model/types";
import { colorFor } from "@/lib/demo/colors";
import { MiniTimeline } from "@/components/demo/MiniTimeline";
import { reconstructMlfqQueues, nearestDispatchAt } from "@/lib/demo/queueReplay";
import { DEFAULT_MLFQ_CONFIG } from "@/lib/schedulers/mlfq";

const LEVEL_LABELS = ["Q0 — top (interactive)", "Q1 — middle", "Q2 — bottom (batch)"];
const LEVEL_ACCENTS = ["#059669", "#d97706", "#dc2626"];

/**
 * MLFQ panel: 3-queue lane visualization + single-lane Gantt. Queue levels
 * are reconstructed from the recorded event stream (demotion on full
 * quantum, I/O boost to top, periodic boost). Running process shown
 * separately with its current level and quantum.
 */
export function MlfqPanel({
  result,
  processIds,
  duration,
  selectedTime,
  abcsSelectedProcess,
  onSelectTime,
}: {
  result: SimulationResult;
  processIds: readonly string[];
  duration: number;
  selectedTime: number;
  abcsSelectedProcess: string | null;
  onSelectTime: (time: number) => void;
}) {
  const [showMovements, setShowMovements] = useState(false);

  const snapshot = useMemo(
    () => reconstructMlfqQueues(result, selectedTime),
    [result, selectedTime],
  );

  const nearestDispatch = useMemo(
    () => nearestDispatchAt(result, selectedTime),
    [result, selectedTime],
  );

  const runningLevel = snapshot.runningLevel;
  const runningColor = snapshot.running ? colorFor(snapshot.running, processIds) : null;

  return (
    <section
      aria-label="MLFQ panel"
      className="flex flex-col rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold">MLFQ</h3>
        <span className="text-[10px] tabular-nums text-zinc-400">t = {selectedTime}</span>
      </div>

      <MiniTimeline
        result={result}
        processIds={processIds}
        duration={duration}
        selectedTime={selectedTime}
        onSelectTime={onSelectTime}
        label="MLFQ"
      />

      {/* Running process */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] font-medium text-zinc-500">Running</span>
        {snapshot.running ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-white"
            style={{ backgroundColor: runningColor ?? "#52525b" }}
          >
            {snapshot.running}
            <span className="text-[9px] font-normal opacity-80">
              Q{runningLevel ?? 0}
              {snapshot.runningQuantum !== null && ` · q=${snapshot.runningQuantum}`}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md border border-dashed border-zinc-300 px-2 py-1 text-[11px] text-zinc-400 dark:border-zinc-700">
            idle
          </span>
        )}
        {snapshot.runningSince !== null && (
          <span className="text-[9px] text-zinc-400">
            since t={snapshot.runningSince}
          </span>
        )}
      </div>

      {/* 3 queue lanes */}
      <div className="mt-1.5 space-y-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-[10px] font-medium text-zinc-500">Queues</span>
          <span className="text-[9px] text-zinc-400">
            quanta [{DEFAULT_MLFQ_CONFIG.quanta.join(", ")}] · boost every{" "}
            {DEFAULT_MLFQ_CONFIG.boostInterval} CPU ticks
          </span>
        </div>
        {snapshot.queues.map((q, lvl) => (
          <div key={lvl} className="flex items-center gap-2">
            <span
              className="w-[110px] shrink-0 text-[9px] font-medium"
              style={{ color: LEVEL_ACCENTS[lvl] ?? "#52525b" }}
            >
              {LEVEL_LABELS[lvl] ?? `Q${lvl}`}
            </span>
            <div className="flex min-h-[26px] flex-1 flex-wrap items-center gap-1 rounded border border-zinc-100 bg-zinc-50 px-1.5 py-1 dark:border-zinc-800 dark:bg-zinc-950">
              {q.length === 0 ? (
                <span className="text-[9px] text-zinc-400">empty</span>
              ) : (
                q.map((pid, i) => (
                  <span key={`${pid}-${i}`} className="inline-flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-[8px] text-zinc-300 dark:text-zinc-600">→</span>
                    )}
                    <span
                      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      style={{ backgroundColor: colorFor(pid, processIds) }}
                    >
                      {pid}
                    </span>
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Decision explanation */}
      <div className="mt-2 space-y-1 border-t border-zinc-100 pt-1.5 text-[10px] leading-snug text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <p>
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">Policy:</span>{" "}
          Highest-priority non-empty queue wins. Full-quantum consumption demotes one
          level; I/O blocking boosts to the top; periodic boost prevents starvation.
        </p>
        {nearestDispatch && (
          <p>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              Last dispatch (t={nearestDispatch.time}):
            </span>{" "}
            {nearestDispatch.processId ?? "—"} from highest non-empty queue (quantum{" "}
            {typeof nearestDispatch.metadata?.quantum === "number"
              ? nearestDispatch.metadata.quantum
              : "?"}
            ).
          </p>
        )}
        {snapshot.movements.length > 0 && (
          <p className="text-zinc-500">
            <span className="font-medium">Recent movement:</span>{" "}
            {snapshot.movements[snapshot.movements.length - 1].processId}{" "}
            {describeMovement(snapshot.movements[snapshot.movements.length - 1])}.
          </p>
        )}
        <p className="text-[9px] text-zinc-500">
          {abcsSelectedProcess && abcsSelectedProcess !== snapshot.running
            ? `At t=${selectedTime} ABCS chose ${abcsSelectedProcess} — different because ABCS ranks by behaviour-weighted priority, not queue level.`
            : abcsSelectedProcess
              ? `At t=${selectedTime} MLFQ and ABCS both run ${abcsSelectedProcess}.`
              : `ABCS idle or not dispatched at t=${selectedTime}.`}
        </p>
      </div>

      {/* Movements history */}
      <div className="mt-1.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setShowMovements((s) => !s)}
          className="flex w-full items-center gap-1.5 text-left text-[10px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          aria-expanded={showMovements}
        >
          <span className={`inline-block transition-transform ${showMovements ? "rotate-90" : ""}`}>
            ▸
          </span>
          Queue movements ({snapshot.movements.length})
        </button>
        {showMovements && (
          <ol className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
            {snapshot.movements.map((m, i) => (
              <li key={i} className="text-[9px] text-zinc-500">
                <span className="font-medium">{m.processId}</span>{" "}
                {m.fromLevel === m.toLevel
                  ? `→ Q${m.toLevel} (${m.reason})`
                  : `Q${m.fromLevel} → Q${m.toLevel} (${m.reason})`}
              </li>
            ))}
            {snapshot.movements.length === 0 && (
              <li className="text-[9px] text-zinc-400">
                No queue movements before t={selectedTime}.
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
}

function describeMovement(m: {
  processId: string;
  fromLevel: number;
  toLevel: number;
  reason: string;
}): string {
  switch (m.reason) {
    case "demotion":
      return `demoted Q${m.fromLevel} → Q${m.toLevel} after full quantum`;
    case "io-boost":
      return `boosted Q${m.fromLevel} → Q${m.toLevel} after I/O block`;
    case "periodic-boost":
      return `boosted Q${m.fromLevel} → Q${m.toLevel} by periodic boost`;
    case "arrival":
      return `entered Q${m.toLevel} on arrival`;
    default:
      return `moved Q${m.fromLevel} → Q${m.toLevel}`;
  }
}
