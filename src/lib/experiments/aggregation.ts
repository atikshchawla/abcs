import type { MetricsSummary } from "@/lib/model/types";
import type { BenchmarkOutcome, BenchmarkVariantId, SingleRunRecord } from "@/lib/experiments/benchmarkRunner";

/**
 * Aggregation of repeated benchmark runs into mean/std/median/percentile
 * summaries per (variant, metric).
 */

export type MetricKey =
  | "avgResponseTime"
  | "medianResponseTime"
  | "p95ResponseTime"
  | "avgWaitingTime"
  | "avgTurnaroundTime"
  | "maxReadyWait"
  | "throughput"
  | "cpuUtilization"
  | "contextSwitches"
  | "fairnessJainIndex"
  | "policyChangeCount"
  | "policyChangesPerTick";

/** Metrics where lower is better (null-safe). */
export const LOWER_IS_BETTER: readonly MetricKey[] = [
  "avgResponseTime",
  "medianResponseTime",
  "p95ResponseTime",
  "avgWaitingTime",
  "avgTurnaroundTime",
  "maxReadyWait",
  "contextSwitches",
  "policyChangesPerTick",
];

/** Metrics where higher is better. */
export const HIGHER_IS_BETTER: readonly MetricKey[] = [
  "throughput",
  "cpuUtilization",
  "fairnessJainIndex",
];

export const ALL_METRIC_KEYS: readonly MetricKey[] = [
  ...LOWER_IS_BETTER,
  ...HIGHER_IS_BETTER,
  "policyChangeCount",
];

export interface MetricAggregate {
  readonly n: number;
  readonly mean: number | null;
  readonly std: number | null;
  readonly median: number | null;
  readonly p05: number | null;
  readonly p95: number | null;
  readonly min: number | null;
  readonly max: number | null;
  /** Raw per-run values (aligned with run order). */
  readonly values: readonly number[];
}

export interface VariantAggregate {
  readonly variantId: BenchmarkVariantId;
  readonly label: string;
  readonly metrics: Readonly<Record<MetricKey, MetricAggregate>>;
  readonly completedRuns: number;
  readonly failedRuns: number;
}

export interface ComparisonTable {
  readonly variants: readonly VariantAggregate[];
  /** Percentage change of each variant vs baseline, per metric. */
  readonly baselineVariantId: BenchmarkVariantId;
  readonly deltas: Readonly<
    Record<BenchmarkVariantId, Readonly<Record<MetricKey, number | null>>>
  >;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance =
    values.reduce((a, v) => a + (v - m) * (v - m), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentileSorted(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (rank - lo)) + sorted[hi] * (rank - lo);
}

export function aggregateValues(values: readonly number[]): MetricAggregate {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: mean(values),
    std: std(values),
    median: median(values),
    p05: percentileSorted(sorted, 5),
    p95: percentileSorted(sorted, 95),
    min: sorted.length > 0 ? sorted[0] : null,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    values,
  };
}

function metricValue(m: MetricsSummary, key: MetricKey): number | null {
  const v = m[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function aggregateOutcome(
  outcome: BenchmarkOutcome,
  variantLabels: Readonly<Record<string, string>>,
  baselineVariantId: BenchmarkVariantId = "RR",
): ComparisonTable {
  const byVariant = new Map<BenchmarkVariantId, SingleRunRecord[]>();
  for (const run of outcome.runs) {
    const list = byVariant.get(run.variantId) ?? [];
    list.push(run);
    byVariant.set(run.variantId, list);
  }

  const variants: VariantAggregate[] = [];
  for (const [variantId, runs] of byVariant) {
    const metrics = {} as Record<MetricKey, MetricAggregate>;
    for (const key of ALL_METRIC_KEYS) {
      const values = runs
        .map((r) => metricValue(r.result.metrics, key))
        .filter((v): v is number => v !== null);
      metrics[key] = aggregateValues(values);
    }
    variants.push({
      variantId,
      label: variantLabels[variantId] ?? variantId,
      metrics,
      completedRuns: runs.length,
      failedRuns: outcome.errors.filter((e) => e.variantId === variantId).length,
    });
  }

  const baseline = variants.find((v) => v.variantId === baselineVariantId);
  const deltas = {} as Record<BenchmarkVariantId, Record<MetricKey, number | null>>;
  for (const v of variants) {
    const row = {} as Record<MetricKey, number | null>;
    for (const key of ALL_METRIC_KEYS) {
      const baseMean = baseline?.metrics[key].mean ?? null;
      const meanVal = v.metrics[key].mean;
      if (baseMean === null || meanVal === null || baseMean === 0) {
        row[key] = null;
      } else {
        row[key] = ((meanVal - baseMean) / Math.abs(baseMean)) * 100;
      }
    }
    deltas[v.variantId] = row;
  }

  return {
    variants,
    baselineVariantId,
    deltas,
  };
}

/** Compact per-run row for raw CSV/JSON export. */
export interface RawRunRow {
  readonly variantId: string;
  readonly algorithm: string;
  readonly workloadName: string;
  readonly seed: number | null;
  readonly metrics: Record<string, number | null>;
}

export function toRawRows(outcome: BenchmarkOutcome): RawRunRow[] {
  return outcome.runs.map((r) => {
    const m = r.result.metrics as unknown as Record<string, unknown>;
    const metrics: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(m)) {
      metrics[k] = typeof v === "number" ? v : null;
    }
    return {
      variantId: r.variantId,
      algorithm: r.algorithm,
      workloadName: r.workloadName,
      seed: r.seed,
      metrics,
    };
  });
}
