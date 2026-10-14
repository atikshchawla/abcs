"use client";

import type { AlgorithmId, MetricsSummary } from "@/lib/model/types";
import type { DemoResults } from "@/lib/demo/compare";
import { algorithmLabel, bestAlgorithmForMetric } from "@/lib/demo/compare";

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

interface CardMetric {
  readonly label: string;
  readonly key: keyof Pick<
    MetricsSummary,
    "avgResponseTime" | "avgWaitingTime" | "avgTurnaroundTime" | "completedCount"
  >;
  readonly lowerBetter: boolean;
  readonly unit?: string;
}

const CARD_METRICS: readonly CardMetric[] = [
  { label: "Avg response", key: "avgResponseTime", lowerBetter: true, unit: "ticks" },
  { label: "Avg waiting", key: "avgWaitingTime", lowerBetter: true, unit: "ticks" },
  { label: "Avg turnaround", key: "avgTurnaroundTime", lowerBetter: true, unit: "ticks" },
  { label: "Completed", key: "completedCount", lowerBetter: false },
];

export function ResultCards({ results }: { results: DemoResults }) {
  const algorithms: AlgorithmId[] = ["RR", "MLFQ", "ABCS"];
  const best: Record<string, AlgorithmId | null> = {
    avgResponseTime: bestAlgorithmForMetric(results, "avgResponseTime"),
    avgWaitingTime: bestAlgorithmForMetric(results, "avgWaitingTime"),
    avgTurnaroundTime: bestAlgorithmForMetric(results, "avgTurnaroundTime"),
    completedCount: bestAlgorithmForMetric(results, "completedCount"),
  };

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {algorithms.map((alg) => {
        const m = results[alg].metrics;
        const isAbcs = alg === "ABCS";
        return (
          <section
            key={alg}
            aria-label={`${algorithmLabel(alg)} results`}
            className={`rounded-lg border bg-white p-3 dark:bg-zinc-900 ${
              isAbcs
                ? "border-zinc-400 dark:border-zinc-500"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">{algorithmLabel(alg)}</h3>
              {isAbcs && (
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                  adaptive
                </span>
              )}
            </div>
            <dl className="space-y-1">
              {CARD_METRICS.map((cm) => {
                const raw = m[cm.key];
                const value =
                  cm.key === "completedCount"
                    ? `${raw}/${m.processCount}`
                    : fmt(raw as number | null);
                const isBest = best[cm.key] === alg;
                return (
                  <div
                    key={cm.key}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <dt className="text-zinc-500">
                      {cm.label}
                      {cm.unit && (
                        <span className="ml-0.5 text-[10px] text-zinc-400">
                          ({cm.unit})
                        </span>
                      )}
                    </dt>
                    <dd
                      className={`tabular-nums ${
                        isBest
                          ? "font-semibold text-emerald-700 dark:text-emerald-400"
                          : "text-zinc-800 dark:text-zinc-200"
                      }`}
                      title={
                        isBest
                          ? "Best among the three algorithms on this workload (subtle highlight; not a universal claim)"
                          : undefined
                      }
                    >
                      {value}
                      {isBest && (
                        <span className="ml-1 text-[9px] font-normal text-emerald-600 dark:text-emerald-500">
                          ★
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
