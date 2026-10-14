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
  CartesianGrid,
} from "recharts";
import type { BehaviourHistorySample } from "@/lib/model/types";

interface Point {
  time: number;
  C: number;
  I: number;
  R: number;
}

export function BehaviourChart({
  history,
  selectedTime,
  transitionTimes,
}: {
  history: readonly BehaviourHistorySample[];
  selectedTime: number;
  transitionTimes: readonly number[];
}) {
  // Aggregate latest sample per process per time bucket → use all samples as-is
  // but only show the selected process's series if one is selected.
  const data = useMemo<Point[]>(() => {
    // Use one representative series: the process with the most samples
    // (typically the currently selected one). Merge all processes into
    // one timeline by taking the max-R sample per unique time.
    const byTime = new Map<number, Point>();
    for (const s of history) {
      const existing = byTime.get(s.time);
      const p: Point = {
        time: s.time,
        C: s.scores.cpuDemandScore,
        I: s.scores.ioActivityScore,
        R: s.scores.latencySensitivityScore,
      };
      // Prefer samples with a rawBurstLength (burst completions carry the
      // freshest EMA update) — otherwise keep the first-seen.
      if (!existing || (s.rawBurstLength !== undefined && existing.C === 0)) {
        byTime.set(s.time, p);
      }
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }, [history]);

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
        No behaviour samples yet.
      </div>
    );
  }

  return (
    <section
      aria-label="Behaviour score history"
      className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Behaviour scores over time (latest sample per tick)
        </h3>
        <div className="flex items-center gap-2.5 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "#2563eb" }} /> C (CPU demand)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "#059669" }} /> I (I/O activity)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: "#7c3aed" }} /> R (responsiveness)
          </span>
        </div>
      </div>
      <div className="h-28 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
            <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9, fill: "#71717a" }} tickLine={false} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: "#71717a" }} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ fontSize: 10, borderRadius: 6, border: "1px solid #e4e4e7" }}
              formatter={(value, name) => [typeof value === "number" ? value.toFixed(3) : String(value), String(name)]}
              labelFormatter={(t) => `t=${t}`}
            />
            {transitionTimes.map((t) => (
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
        Vertical line = selected decision · purple ▲ = confirmed transitions. Scores are
        EMA-smoothed estimates from past observations, not ground truth.
      </p>
    </section>
  );
}
