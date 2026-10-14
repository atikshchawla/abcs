import type {
  MetricsSummary,
  ProcessFinalState,
  ProcessMetricsRow,
  SimulationEvent,
} from "@/lib/model/types";

/**
 * Metrics module — single source of truth for every algorithm.
 *
 * Definitions (process p): arrival A_p, first CPU start S_p,
 * completion C_p, total CPU demand B_p.
 * - Response time    = S_p - A_p
 * - Turnaround time  = C_p - A_p
 * - Waiting time     = total time spent READY (not BLOCKED)
 * - CPU service      = time actually executed
 * - I/O blocked time = total time spent BLOCKED
 *
 * Context-switch rule (identical for every algorithm): a context switch
 * is counted each time the CPU's current occupant changes, where the
 * idle CPU counts as an occupant. So idle→P = 1, P→Q = 1, P→idle = 1.
 *
 * Fairness: Jain's index over normalized CPU service share
 * x_p = cpuService_p / totalCpuDemand_p (only over processes that
 * started). Limitation: equal normalized share is "fair" regardless of
 * process count or workload composition; it does not measure response
 * fairness.
 *
 * Throughput: completed processes / (measurementEnd - measurementStart).
 * CPU utilization: busyTime / (measurementEnd - measurementStart).
 */

export function percentile(sortedValues: readonly number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedValues[lo];
  const frac = rank - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Jain's fairness index over non-negative shares. Returns null for empty. */
export function jainFairnessIndex(shares: readonly number[]): number | null {
  if (shares.length === 0) return null;
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum === 0) return null;
  const sumSq = shares.reduce((a, b) => a + b * b, 0);
  if (sumSq === 0) return null;
  return (sum * sum) / (shares.length * sumSq);
}

export function buildProcessMetricsRows(
  finals: readonly ProcessFinalState[],
): ProcessMetricsRow[] {
  return finals.map((f) => ({
    id: f.id,
    completed: f.completed,
    arrivalTime: f.arrivalTime,
    firstStartTime: f.firstStartTime,
    completionTime: f.completionTime,
    responseTime: f.firstStartTime !== null ? f.firstStartTime - f.arrivalTime : null,
    turnaroundTime: f.completionTime !== null ? f.completionTime - f.arrivalTime : null,
    waitingTime: f.readyWaitTime,
    cpuService: f.cpuService,
    totalCpuDemand: f.totalCpuDemand,
    ioBlockedTime: f.ioBlockedTime,
  }));
}

export function countContextSwitches(events: readonly SimulationEvent[]): number {
  // Derived from DISPATCH events: each dispatch onto the CPU is one
  // context switch per the documented occupant-change rule (idle→P and
  // P→Q both produce a dispatch; P→idle produces none until the next
  // dispatch, which then counts).
  return events.filter((e) => e.type === "DISPATCH").length;
}

export function countPolicyChanges(events: readonly SimulationEvent[]): number {
  return events.filter((e) => e.type === "POLICY_ADJUSTMENT").length;
}

export function computeMetrics(
  finals: readonly ProcessFinalState[],
  events: readonly SimulationEvent[],
  options?: {
    /** Ground-truth transition times (evaluation only). */
    transitionTimes?: readonly number[];
    /**
     * Adaptation condition: called with (transitionTime, events) and
     * returning the first time >= transitionTime at which the policy
     * measurably adapted, or null. Optional; when absent, no adaptation
     * delays are reported.
     */
    findAdaptationTime?: (
      transitionTime: number,
      events: readonly SimulationEvent[],
    ) => number | null;
  },
): MetricsSummary {
  const started = finals.filter((f) => f.firstStartTime !== null);
  const completed = finals.filter((f) => f.completed && f.completionTime !== null);

  const responseTimes = started.map((f) => (f.firstStartTime as number) - f.arrivalTime);
  const turnaroundTimes = completed.map(
    (f) => (f.completionTime as number) - f.arrivalTime,
  );
  const waitingTimes = started.map((f) => f.readyWaitTime);
  const maxReadyWait = finals.reduce((m, f) => Math.max(m, f.readyWaitTime), 0);

  const arrivalMin = finals.length > 0 ? Math.min(...finals.map((f) => f.arrivalTime)) : 0;
  const completionMax =
    completed.length > 0 ? Math.max(...completed.map((f) => f.completionTime as number)) : 0;

  // Measurement interval: first arrival → max(completion of completed
  // processes, last event time). Ensures idle tails are included.
  const lastEventTime = events.length > 0 ? Math.max(...events.map((e) => e.time)) : 0;
  const measurementStart = arrivalMin;
  const measurementEnd = Math.max(completionMax, lastEventTime);
  const elapsed = Math.max(measurementEnd - measurementStart, 0);

  // Busy/idle from Gantt-like DISPATCH/burst accounting is computed by
  // the engine and passed via events metadata; recompute busy time as
  // sum of CPU service (equivalent under single-CPU no-overlap).
  const busyTime = finals.reduce((a, f) => a + f.cpuService, 0);
  const idleTime = Math.max(elapsed - busyTime, 0);

  const fairnessShares = finals
    .filter((f) => f.firstStartTime !== null && f.totalCpuDemand > 0)
    .map((f) => f.cpuService / f.totalCpuDemand);

  const policyChangeCount = countPolicyChanges(events);

  const adaptationDelays: { transitionTime: number; delay: number }[] = [];
  if (options?.transitionTimes && options.findAdaptationTime) {
    for (const t of options.transitionTimes) {
      const adaptedAt = options.findAdaptationTime(t, events);
      if (adaptedAt !== null) {
        adaptationDelays.push({ transitionTime: t, delay: adaptedAt - t });
      }
    }
  }

  return {
    processCount: finals.length,
    completedCount: completed.length,
    incompleteCount: finals.length - completed.length,
    makespan: measurementEnd,
    measurementStart,
    measurementEnd,
    avgResponseTime: mean(responseTimes),
    medianResponseTime: median(responseTimes),
    p95ResponseTime: percentile([...responseTimes].sort((a, b) => a - b), 95),
    avgWaitingTime: mean(waitingTimes),
    avgTurnaroundTime: mean(turnaroundTimes),
    maxReadyWait,
    throughput: elapsed > 0 ? completed.length / elapsed : completed.length > 0 ? Infinity : 0,
    cpuUtilization: elapsed > 0 ? busyTime / elapsed : 0,
    busyTime,
    idleTime,
    contextSwitches: countContextSwitches(events),
    fairnessJainIndex: jainFairnessIndex(fairnessShares),
    policyChangeCount,
    policyChangesPerTick: elapsed > 0 ? policyChangeCount / elapsed : 0,
    adaptationDelays,
  };
}
