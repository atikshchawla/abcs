"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { BehaviourHistorySample } from "@/lib/model/types";
import { colorFor } from "@/lib/demo/colors";

interface Point {
  time: number;
  C: number;
  I: number;
  R: number;
}

/**
 * Compact C/I/R behaviour-history chart for a single selected process.
 * A process selector picks which process's series is displayed — samples
 * from different processes are never merged into one line (that would
 * fabricate step changes that are process switches, not behaviour
 * transitions).
 */
export function BehaviourChart({
  history,
  processIds,
  selectedProcess,
  selectedTime,
  transitionTimes,
  onSelectProcess,
}: {
  history: readonly BehaviourHistorySample[];
  processIds: readonly string[];
  /** Process whose series to show; falls back to first with samples. */
  selectedProcess: string | null;
  selectedTime: number;
  transitionTimes: readonly number[];
  onSelectProcess?: (pid: string) => void;
}) {
  // Default to the selected process, or the process with the most samples.
  const fallbackPid = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of history) {
      counts.set(s.processId, (counts.get(s.processId) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [pid, n] of counts) {
      if (n > bestN) {
        best = pid;
        bestN = n;
      }
    }
    return best;
  }, [history]);

  const activePid = selectedProcess ?? fallbackPid;

  const data = useMemo<Point[]>(() => {
    if (!activePid) return [];
    // Only samples for the active process, sorted by time.
    const rows = history
      .filter((s) => s.processId === activePid)
      .sort((a, b) => a.time - b.time);
    // Deduplicate: keep the last sample at each time (most informative).
    const byTime = new Map<number, Point>();
    for (const s of rows) {
      byTime.set(s.time, {
        time: s.time,
        C: s.scores.cpuDemandScore,
        I: s.scores.ioActivityScore,
        R: s.scores.latencySensitivityScore,
      });
    }
    return [...byTime.values()];
  }, [history, activePid]);

  // Transition times relevant to the active process (from its samples).
  const pidTransitions = useMemo(() => {
    if (!activePid) return [];
    const set = new Set<number>();
    for (const s of history) {
      if (s.processId === activePid && s.event === "TRANSITION_DETECTED") {
        set.add(s.time);
      }
    }
    // Also include the global transitionTimes that fall within this
    // process's sample range (detector is global but the marker is
    // still meaningful).
    for (const t of transitionTimes) set.add(t);
    return [...set].sort((a, b) => a - b);
  }, [history, activePid, transitionTimes]);

  if (data.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
        No behaviour samples yet.
      </div>
    );
  }

  return (
    <section
      aria-label="Behaviour score history"
      className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Behaviour scores
          </h3>
          {/* Process selector */}
          <div className="flex items-center gap-1" role="group" aria-label="Select process for behaviour chart">
            {processIds.map((pid) => {
              const has = history.some((s) => s.processId === pid);
              if (!has) return null;
              const active = pid === activePid;
              return (
                <button
                  key={pid}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectProcess?.(pid)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                    active
                      ? "text-white"
                      : "border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                  style={active ? { backgroundColor: colorFor(pid, processIds) } : undefined}
                >
                  {pid}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "#2563eb" }} /> C
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "#059669" }} /> I
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "#7c3aed" }} /> R
          </span>
        </div>
      </div>
      <div className="h-24 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
            <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9, fill: "#71717a" }} tickLine={false} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: "#71717a" }} tickLine={false} width={30} />
            <Tooltip
              contentStyle={{ fontSize: 10, borderRadius: 6, border: "1px solid #e4e4e7" }}
              formatter={(value, name) => [typeof value === "number" ? value.toFixed(3) : String(value), String(name)]}
              labelFormatter={(t) => `t=${t} · ${activePid ?? ""}`}
            />
            {pidTransitions.map((t) => (
              <ReferenceLine key={t} x={t} stroke="#9333ea" strokeDasharray="3 2" label={{ value: "▲", position: "top", fontSize: 8, fill: "#9333ea" }} />
            ))}
            <ReferenceLine x={selectedTime} stroke="#18181b" strokeWidth={1} />
            <Line type="stepAfter" dataKey="C" stroke="#2563eb" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="I" stroke="#059669" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="R" stroke="#7c3aed" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-0.5 text-[9px] text-zinc-400">
        EMA-smoothed estimates from past observations for {activePid ?? "—"} only. Vertical line = selected decision · purple ▲ = confirmed transitions.
      </p>
    </section>
  );
}
