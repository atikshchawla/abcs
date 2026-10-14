"use client";

import { useEffect, useRef } from "react";
import type { SimulationEvent } from "@/lib/model/types";

const TYPE_STYLES: Record<string, string> = {
  PROCESS_ARRIVAL: "text-zinc-600 dark:text-zinc-300",
  DISPATCH: "text-emerald-700 dark:text-emerald-400",
  QUANTUM_EXPIRED: "text-amber-700 dark:text-amber-400",
  CPU_BURST_COMPLETE: "text-blue-700 dark:text-blue-400",
  IO_START: "text-orange-700 dark:text-orange-400",
  IO_COMPLETE: "text-teal-700 dark:text-teal-400",
  PREEMPTION: "text-red-700 dark:text-red-400",
  PROCESS_TERMINATED: "text-zinc-800 dark:text-zinc-200",
  BEHAVIOUR_UPDATE: "text-violet-700 dark:text-violet-400",
  TRANSITION_DETECTED: "text-purple-800 dark:text-purple-300 font-semibold",
  POLICY_ADJUSTMENT: "text-purple-800 dark:text-purple-300 font-semibold",
  IDLE_INTERVAL: "text-zinc-400",
};

export function EventLog(props: {
  events: readonly SimulationEvent[];
  selectedProcess: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const filtered = props.selectedProcess
    ? props.events.filter((e) => e.processId === props.selectedProcess || e.processId === undefined)
    : props.events;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [filtered.length]);

  return (
    <section
      aria-label="Decision and event log"
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Decision log
        </h2>
        <span className="text-xs text-zinc-500">{filtered.length} events</span>
      </div>
      <div className="h-72 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-zinc-500">No events yet — run and step the simulation.</p>
        ) : (
          <ol className="space-y-0.5 font-mono text-[11px] leading-relaxed">
            {filtered.map((e, i) => (
              <li
                key={i}
                className={`flex gap-2 rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                  props.selectedProcess && e.processId === props.selectedProcess
                    ? "bg-yellow-50 dark:bg-yellow-950/30"
                    : ""
                }`}
              >
                <span className="w-12 shrink-0 tabular-nums text-zinc-400">t={e.time}</span>
                <span className={`w-40 shrink-0 ${TYPE_STYLES[e.type] ?? ""}`}>{e.type}</span>
                <span className="w-12 shrink-0 text-zinc-500">{e.processId ?? "—"}</span>
                <span className="min-w-0 flex-1 break-words text-zinc-700 dark:text-zinc-300">
                  {e.reason}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>
      {props.selectedProcess && (
        <p className="mt-2 text-xs text-zinc-500">
          Filtered to {props.selectedProcess} (+ global events). Clear the process
          selection to see everything.
        </p>
      )}
    </section>
  );
}
