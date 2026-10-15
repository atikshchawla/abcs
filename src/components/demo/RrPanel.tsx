"use client";

import { useMemo, useState } from "react";
import type { SimulationEvent, SimulationResult } from "@/lib/model/types";
import { colorFor } from "@/lib/demo/colors";
import { MiniTimeline } from "@/components/demo/MiniTimeline";
import { reconstructRrQueue, nearestDispatchAt } from "@/lib/demo/queueReplay";
import { completedBy } from "@/lib/demo/timelineUtils";

const RR_QUANTUM = 4;

/**
 * Round Robin panel: single-lane Gantt + FIFO ready-queue token row with
 * the running process shown separately. Queue state is reconstructed from
 * the recorded event stream (not fabricated). An explanation strip
 * surfaces the last dispatch reason and any nearby decision-relevant
 * events (quantum expiry / IO completion / arrival).
 */
export function RrPanel({
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
  const [showHistory, setShowHistory] = useState(false);

  const snapshot = useMemo(
    () => reconstructRrQueue(result, selectedTime),
    [result, selectedTime],
  );

  const nearestDispatch = useMemo(
    () => nearestDispatchAt(result, selectedTime),
    [result, selectedTime],
  );

  const history = useMemo(
    () => buildQueueHistory(result, selectedTime),
    [result, selectedTime],
  );

  const done = useMemo(
    () => completedBy(result, selectedTime),
    [result, selectedTime],
  );

  const lastDispatchQuantum =
    typeof nearestDispatch?.metadata?.quantum === "number"
      ? nearestDispatch.metadata.quantum
      : RR_QUANTUM;

  const runningPid = snapshot.running;
  const runningColor = runningPid ? colorFor(runningPid, processIds) : null;

  return (
    <section
      aria-label="Round Robin panel"
      className="flex flex-col rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold">Round Robin</h3>
        <span className="text-[10px] tabular-nums text-zinc-400">t = {selectedTime}</span>
      </div>

      <MiniTimeline
        result={result}
        processIds={processIds}
        duration={duration}
        selectedTime={selectedTime}
        onSelectTime={onSelectTime}
        label="RR"
      />

      {/* Running process */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] font-medium text-zinc-500">Running</span>
        {runningPid ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-white"
            style={{ backgroundColor: runningColor ?? "#52525b" }}
          >
            {runningPid}
            {snapshot.runningQuantum !== null && (
              <span className="text-[9px] font-normal opacity-80">
                q={snapshot.runningQuantum} left
              </span>
            )}
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

      {/* FIFO ready queue */}
      <div className="mt-1.5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-medium text-zinc-500">FIFO ready queue</span>
          <span className="text-[9px] text-zinc-400">(head → tail)</span>
        </div>
        <div className="flex min-h-[32px] flex-wrap items-center gap-1.5 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
          {snapshot.ready.length === 0 ? (
            <span className="text-[10px] text-zinc-400">empty — no process is READY</span>
          ) : (
            <>
              {snapshot.ready.map((pid, i) => (
                <span key={`${pid}-${i}`} className="inline-flex items-center gap-1">
                  {i > 0 && (
                    <span className="text-[9px] text-zinc-300 dark:text-zinc-600">→</span>
                  )}
                  <span
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
                    style={{ backgroundColor: colorFor(pid, processIds) }}
                  >
                    {pid}
                  </span>
                  {i === 0 && (
                    <span className="text-[8px] font-medium uppercase text-zinc-400">
                      head
                    </span>
                  )}
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Completed tasks */}
      <div className="mt-1.5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-medium text-zinc-500">Completed</span>
          <span className="text-[9px] text-zinc-400">
            {done.length}/{processIds.length} finished by t={selectedTime}
          </span>
        </div>
        <div className="flex min-h-[26px] flex-wrap items-center gap-1.5 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950">
          {done.length === 0 ? (
            <span className="text-[10px] text-zinc-400">none yet — no process has finished</span>
          ) : (
            done.map((c) => (
              <span
                key={c.processId}
                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                title={`${c.processId} completed all work at t=${c.time}`}
              >
                <span aria-hidden>✓</span>
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: colorFor(c.processId, processIds) }}
                />
                {c.processId}
                <span className="tabular-nums opacity-70">@{c.time}</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Decision explanation */}
      <div className="mt-2 space-y-1 border-t border-zinc-100 pt-1.5 text-[10px] leading-snug text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <p>
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">Policy:</span>{" "}
          FIFO ready queue, fixed quantum {lastDispatchQuantum} ticks. A process that
          exhausts its quantum and still has CPU work returns to the queue tail. No
          preemption on arrivals or I/O completions.
        </p>
        {nearestDispatch && (
          <p>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              Last dispatch (t={nearestDispatch.time}):
            </span>{" "}
            {nearestDispatch.processId ?? "—"} selected because it is the FIFO head of
            the ready queue.
          </p>
        )}
        {snapshot.lastTrigger && snapshot.lastTrigger.type !== "DISPATCH" && (
          <p className="text-zinc-500">
            <span className="font-medium">Last trigger:</span>{" "}
            {describeEvent(snapshot.lastTrigger)}
          </p>
        )}
        {/* ABCS comparison */}
        <p className="text-[9px] text-zinc-500">
          {abcsSelectedProcess && abcsSelectedProcess !== runningPid
            ? `At t=${selectedTime} ABCS chose ${abcsSelectedProcess} — different because ABCS ranks by behaviour-weighted priority, not FIFO order.`
            : abcsSelectedProcess
              ? `At t=${selectedTime} RR and ABCS both run ${abcsSelectedProcess}.`
              : `ABCS idle or not dispatched at t=${selectedTime}.`}
        </p>
      </div>

      {/* Step-by-step queue history */}
      <div className="mt-1.5 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setShowHistory((s) => !s)}
          className="flex w-full items-center gap-1.5 text-left text-[10px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          aria-expanded={showHistory}
        >
          <span className={`inline-block transition-transform ${showHistory ? "rotate-90" : ""}`}>
            ▸
          </span>
          Queue history ({history.length} transitions)
        </button>
        {showHistory && (
          <ol className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
            {history.map((h, i) => (
              <li key={i} className="flex items-baseline gap-1.5 text-[9px] text-zinc-500">
                <span className="w-8 shrink-0 tabular-nums text-zinc-400">t={h.time}</span>
                <span className="font-medium">{h.event}</span>
                <span className="truncate">{h.detail}</span>
              </li>
            ))}
            {history.length === 0 && (
              <li className="text-[9px] text-zinc-400">No transitions before t={selectedTime}.</li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Queue history — derived from actual events, ordered by time
// ---------------------------------------------------------------------------

interface QueueHistoryEntry {
  readonly time: number;
  readonly event: string;
  readonly detail: string;
}

function buildQueueHistory(
  result: SimulationResult,
  until: number,
): QueueHistoryEntry[] {
  const out: QueueHistoryEntry[] = [];
  for (const e of result.events) {
    if (e.time > until) break;
    switch (e.type) {
      case "DISPATCH":
        out.push({
          time: e.time,
          event: "DISPATCH",
          detail: `${e.processId ?? "?"} selected (q=${
            typeof e.metadata?.quantum === "number" ? e.metadata.quantum : "?"
          })`,
        });
        break;
      case "QUANTUM_EXPIRED":
        out.push({
          time: e.time,
          event: "QUANTUM EXPIRED",
          detail: `${e.processId ?? "?"} returned to tail`,
        });
        break;
      case "IO_COMPLETE":
        out.push({
          time: e.time,
          event: "IO COMPLETE",
          detail: `${e.processId ?? "?"} re-entered READY`,
        });
        break;
      case "PROCESS_ARRIVAL":
        out.push({
          time: e.time,
          event: "ARRIVAL",
          detail: `${e.processId ?? "?"} entered READY`,
        });
        break;
      case "PREEMPTION":
        out.push({
          time: e.time,
          event: "PREEMPTED",
          detail: `${e.processId ?? "?"} requeued`,
        });
        break;
      default:
        break;
    }
  }
  // Most recent first.
  return out.reverse();
}

function describeEvent(e: SimulationEvent): string {
  const pid = e.processId ?? "?";
  switch (e.type) {
    case "QUANTUM_EXPIRED":
      return `${pid} quantum expired at t=${e.time}; returned to FIFO tail.`;
    case "IO_COMPLETE":
      return `${pid} I/O completed at t=${e.time}; re-entered READY queue.`;
    case "PROCESS_ARRIVAL":
      return `${pid} arrived at t=${e.time}; entered READY queue.`;
    case "PREEMPTION":
      return `${pid} preempted at t=${e.time}; requeued.`;
    case "CPU_BURST_COMPLETE":
      return `${pid} CPU burst completed at t=${e.time}.`;
    case "PROCESS_TERMINATED":
      return `${pid} terminated at t=${e.time}.`;
    default:
      return `${e.type} at t=${e.time}.`;
  }
}
