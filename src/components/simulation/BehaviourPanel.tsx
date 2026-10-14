"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import type { BehaviourHistorySample } from "@/lib/model/types";

export function BehaviourPanel(props: {
  history: readonly BehaviourHistorySample[];
  currentTime: number;
  selectedProcess: string | null;
  show: boolean;
}) {
  const processIds = useMemo(() => {
    const set = new Set<string>();
    for (const h of props.history) set.add(h.processId);
    return [...set].sort();
  }, [props.history]);

  const visibleIds = props.selectedProcess
    ? processIds.filter((id) => id === props.selectedProcess)
    : processIds.slice(0, 4);

  const transitionTimes = useMemo(
    () =>
      props.history
        .filter((h) => h.event === "TRANSITION_DETECTED")
        .map((h) => h.time),
    [props.history],
  );

  if (!props.show) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        Behaviour scores are produced by ABCS only. Select the ABCS algorithm and run a
        simulation to inspect CPU-demand, I/O-activity, and latency-sensitivity
        estimates.
      </section>
    );
  }

  if (props.history.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        No behaviour observations recorded yet.
      </section>
    );
  }

  const series = (key: "cpuDemandScore" | "ioActivityScore" | "latencySensitivityScore") =>
    processIds.flatMap((id) => {
      const pts = props.history
        .filter((h) => h.processId === id)
        .map((h) => ({
          time: h.time,
          [`${id}:${key}`]: h.scores[key],
        }));
      // Merge points with the same time.
      const byTime = new Map<number, Record<string, number>>();
      for (const p of pts) {
        const existing = byTime.get(p.time) ?? { time: p.time };
        Object.assign(existing, p);
        byTime.set(p.time, existing);
      }
      return [...byTime.values()].sort((a, b) => a.time - b.time);
    });

  // Build a unified x-domain dataset for each metric.
  const buildData = (key: "cpuDemandScore" | "ioActivityScore" | "latencySensitivityScore") => {
    const byTime = new Map<number, Record<string, number | string>>();
    for (const h of props.history) {
      const row = byTime.get(h.time) ?? { time: h.time };
      row[`${h.processId}`] = h.scores[key];
      byTime.set(h.time, row);
    }
    return [...byTime.values()].sort((a, b) => Number(a.time) - Number(b.time));
  };

  void series;

  const metrics: { key: "cpuDemandScore" | "ioActivityScore" | "latencySensitivityScore"; label: string; color: string }[] = [
    { key: "cpuDemandScore", label: "CPU demand", color: "#2563eb" },
    { key: "ioActivityScore", label: "I/O activity", color: "#d97706" },
    { key: "latencySensitivityScore", label: "Latency sensitivity", color: "#059669" },
  ];

  return (
    <section
      aria-label="Behaviour scores"
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Behaviour panel (ABCS)
        </h2>
        <p className="text-xs text-zinc-500">
          EMA-smoothed score estimates in [0,1] — not ground truth.{" "}
          {props.selectedProcess
            ? `Showing ${props.selectedProcess}.`
            : `Showing first ${visibleIds.length} of ${processIds.length} process(es); select one to focus.`}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.key}>
            <h3 className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {m.label}
            </h3>
            <LineChart width={340} height={160} data={buildData(m.key)} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} type="number" domain={["dataMin", "dataMax"]} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v) => [Number(v).toFixed(3), ""]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {transitionTimes.map((t, i) => (
                <ReferenceLine key={i} x={t} stroke="#9333ea" strokeDasharray="4 2" />
              ))}
              <ReferenceLine x={props.currentTime} stroke="#18181b" />
              {visibleIds.map((id) => (
                <Line
                  key={id}
                  type="stepAfter"
                  dataKey={id}
                  name={id}
                  stroke={m.color}
                  dot={false}
                  strokeWidth={1.8}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </div>
        ))}
      </div>

      <p className="mt-1 text-xs text-zinc-500">
        Purple dashed lines = detected workload transitions. Black line = replay cursor.
        Raw observations (burst lengths) are shown in the decision log reasons.
      </p>
    </section>
  );
}
