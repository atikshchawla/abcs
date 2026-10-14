import type {
  AlgorithmId,
  BehaviourHistorySample,
  GanttInterval,
  MetricsSummary,
  SimulationEvent,
  SimulationResult,
  Workload,
} from "@/lib/model/types";
import { runSimulation } from "@/lib/simulation/engine";

/**
 * Single-page demo comparison: run RR, MLFQ, and ABCS on the same
 * immutable workload and extract aligned decision points for the
 * educational decision panel.
 */

export interface DemoResults {
  readonly RR: SimulationResult;
  readonly MLFQ: SimulationResult;
  readonly ABCS: SimulationResult;
  /** Shared time scale: max end time across all three gantt traces. */
  readonly duration: number;
  /** Sorted union of process ids (same workload → same ids). */
  readonly processIds: readonly string[];
}

export function runDemoComparison(workload: Workload): DemoResults {
  // Deep-clone per run so no algorithm can observe another's mutation.
  const rr = runSimulation(structuredClone(workload), { algorithm: "RR" });
  const mlfq = runSimulation(structuredClone(workload), { algorithm: "MLFQ" });
  const abcs = runSimulation(structuredClone(workload), { algorithm: "ABCS" });

  const duration = Math.max(
    endOf(rr.gantt),
    endOf(mlfq.gantt),
    endOf(abcs.gantt),
    rr.metrics.measurementEnd,
    mlfq.metrics.measurementEnd,
    abcs.metrics.measurementEnd,
  );

  const ids = new Set<string>();
  for (const p of rr.processFinalStates) ids.add(p.id);

  return {
    RR: rr,
    MLFQ: mlfq,
    ABCS: abcs,
    duration,
    processIds: [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  };
}

function endOf(gantt: readonly GanttInterval[]): number {
  let max = 0;
  for (const g of gantt) if (g.end > max) max = g.end;
  return max;
}

// ---------------------------------------------------------------------------
// Decision points — one per unique DISPATCH time across all three algorithms.
// ---------------------------------------------------------------------------

export type DecisionKind = "dispatch" | "continuing" | "idle";

export interface AlgorithmDecision {
  readonly kind: DecisionKind;
  readonly processId: string | null;
  readonly reason: string;
  /** Quantum granted at dispatch (if this is a fresh dispatch). */
  readonly quantum: number | null;
  /** For continuing decisions: when the current CPU occupancy began. */
  readonly since: number | null;
  /** Raw scheduler reason (for expandable debugging). */
  readonly rawReason: string | null;
  /** For continuing: the dispatch that started this occupancy. */
  readonly originatingDispatch: SimulationEvent | null;
}

export interface AbcsDecisionDetail {
  readonly processId: string;
  /** Latest behaviour sample at or before the decision time. */
  readonly latestSample: BehaviourHistorySample | null;
  /** Transition / policy events within [-8, +2] ticks of the decision. */
  readonly nearbyPolicyEvents: readonly SimulationEvent[];
  /** What happened after: the gantt interval that started at/after decision time for this process. */
  readonly outcome: {
    readonly interval: GanttInterval | null;
    readonly endedByQuantumExpiry: boolean;
    readonly endedByBurstComplete: boolean;
  } | null;
}

export interface DecisionPoint {
  readonly time: number;
  readonly index: number;
  readonly RR: AlgorithmDecision;
  readonly MLFQ: AlgorithmDecision;
  readonly ABCS: AlgorithmDecision;
  readonly abcsDetail: AbcsDecisionDetail | null;
}

export function extractDecisionPoints(results: DemoResults): DecisionPoint[] {
  const times = new Set<number>();
  for (const r of [results.RR, results.MLFQ, results.ABCS]) {
    for (const e of r.events) {
      if (e.type === "DISPATCH") times.add(e.time);
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  return sorted.map((time, index) => ({
    time,
    index,
    RR: findDecision(results.RR, time),
    MLFQ: findDecision(results.MLFQ, time),
    ABCS: findDecision(results.ABCS, time),
    abcsDetail: buildAbcsDetail(results.ABCS, time),
  }));
}

function findDecision(result: SimulationResult, time: number): AlgorithmDecision {
  const exact = result.events.find(
    (e) => e.type === "DISPATCH" && e.time === time,
  );
  if (exact) {
    const quantum =
      typeof exact.metadata?.quantum === "number" ? exact.metadata.quantum : null;
    return {
      kind: "dispatch",
      processId: exact.processId ?? null,
      reason: plainDispatchReason(result.algorithm, exact, quantum),
      quantum,
      since: time,
      rawReason: exact.reason,
      originatingDispatch: exact,
    };
  }

  const covering = result.gantt.find((g) => g.start <= time && time < g.end);
  if (covering && covering.processId !== null) {
    const origin = lastDispatchAtOrBefore(result, covering.start);
    return {
      kind: "continuing",
      processId: covering.processId,
      reason: `${covering.processId} is still running (started at t=${covering.start}). ${
        result.algorithm === "RR"
          ? "Round Robin does not preempt on arrivals or I/O completions."
          : result.algorithm === "MLFQ"
            ? "No higher-priority MLFQ process became ready, so the current process keeps the CPU."
            : "No READY process exceeded the current effective priority plus the preemption margin."
      }`,
      quantum: null,
      since: covering.start,
      rawReason: origin?.reason ?? null,
      originatingDispatch: origin,
    };
  }

  return {
    kind: "idle",
    processId: null,
    reason: "CPU is idle — no process is READY at this time.",
    quantum: null,
    since: null,
    rawReason: null,
    originatingDispatch: null,
  };
}

function lastDispatchAtOrBefore(
  result: SimulationResult,
  time: number,
): SimulationEvent | null {
  let best: SimulationEvent | null = null;
  for (const e of result.events) {
    if (e.type === "DISPATCH" && e.time <= time) best = e;
  }
  return best;
}

/**
 * Translate the scheduler's raw reason into a short plain-language
 * sentence without inventing anything the scheduler did not decide.
 */
function plainDispatchReason(
  algorithm: AlgorithmId,
  event: SimulationEvent,
  quantum: number | null,
): string {
  const pid = event.processId ?? "?";
  if (algorithm === "RR") {
    return `${pid} was selected because it is next in the FIFO ready queue. Each process receives a fixed time quantum of ${quantum ?? "?"} ticks.`;
  }
  if (algorithm === "MLFQ") {
    return `${pid} was selected because it is in the highest-priority non-empty MLFQ queue (quantum ${quantum ?? "?"} ticks).`;
  }
  // ABCS: keep it truthful to what the scheduler actually used.
  return `${pid} was selected because its effective priority (responsiveness estimate + waiting-time fairness adjustment) was the highest among READY processes. Quantum ${quantum ?? "?"} ticks, chosen from recent behaviour observations.`;
}

function buildAbcsDetail(
  abcs: SimulationResult,
  time: number,
): AbcsDecisionDetail | null {
  const dispatch = abcs.events.find(
    (e) => e.type === "DISPATCH" && e.time === time,
  );
  const processId = dispatch?.processId;
  if (!processId) return null;

  let latestSample: BehaviourHistorySample | null = null;
  for (const s of abcs.behaviourHistory) {
    if (s.processId === processId && s.time <= time) {
      if (!latestSample || s.time >= latestSample.time) latestSample = s;
    }
  }

  const nearbyPolicyEvents = abcs.events.filter(
    (e) =>
      (e.type === "TRANSITION_DETECTED" || e.type === "POLICY_ADJUSTMENT") &&
      e.time >= time - 8 &&
      e.time <= time + 2,
  );

  const interval =
    abcs.gantt.find((g) => g.start === time && g.processId === processId) ??
    abcs.gantt.find((g) => g.start >= time && g.processId === processId) ??
    null;

  return {
    processId,
    latestSample,
    nearbyPolicyEvents,
    outcome: interval
      ? {
          interval,
          endedByQuantumExpiry: interval.endedByQuantumExpiry,
          endedByBurstComplete: interval.endedByBurstComplete,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Comparison sentence — generated strictly from actual metrics.
// ---------------------------------------------------------------------------

export interface MetricDelta {
  readonly metric: keyof Pick<
    MetricsSummary,
    "avgResponseTime" | "avgWaitingTime" | "avgTurnaroundTime"
  >;
  readonly label: string;
  readonly abcsValue: number;
  readonly rrValue: number;
  readonly mlfqValue: number;
  readonly pctVsRr: number | null;
  readonly pctVsMlfq: number | null;
}

export function computeMetricDeltas(results: DemoResults): MetricDelta[] {
  const a = results.ABCS.metrics;
  const r = results.RR.metrics;
  const m = results.MLFQ.metrics;
  const defs: {
    metric: MetricDelta["metric"];
    label: string;
  }[] = [
    { metric: "avgResponseTime", label: "average response time" },
    { metric: "avgWaitingTime", label: "average waiting time" },
    { metric: "avgTurnaroundTime", label: "average turnaround time" },
  ];
  return defs.map(({ metric, label }) => {
    const abcsValue = a[metric];
    const rrValue = r[metric];
    const mlfqValue = m[metric];
    return {
      metric,
      label,
      abcsValue: abcsValue ?? 0,
      rrValue: rrValue ?? 0,
      mlfqValue: mlfqValue ?? 0,
      pctVsRr: pctChange(rrValue, abcsValue),
      pctVsMlfq: pctChange(mlfqValue, abcsValue),
    };
  });
}

/** Percent change from baseline → newValue. Negative = improvement for latency metrics. */
export function pctChange(
  baseline: number | null,
  newValue: number | null,
): number | null {
  if (baseline === null || newValue === null) return null;
  if (baseline === 0) return newValue === 0 ? 0 : null;
  return ((newValue - baseline) / baseline) * 100;
}

/**
 * Build an honest one-sentence comparison from actual results. Never
 * claims ABCS wins if the numbers disagree; reports trade-offs.
 */
export function buildComparisonSentence(results: DemoResults): string {
  const deltas = computeMetricDeltas(results);
  const resp = deltas.find((d) => d.metric === "avgResponseTime");
  const wait = deltas.find((d) => d.metric === "avgWaitingTime");
  const turn = deltas.find((d) => d.metric === "avgTurnaroundTime");

  const parts: string[] = [];

  const describe = (d: MetricDelta | undefined): string | null => {
    if (!d || d.pctVsRr === null) return null;
    const abs = Math.abs(d.pctVsRr);
    if (abs < 0.5) {
      return `${d.label} is about the same as Round Robin (±${abs.toFixed(1)}%)`;
    }
    const dir = d.pctVsRr < 0 ? "reduced" : "increased";
    return `${d.label} ${dir} by ${abs.toFixed(1)}% vs Round Robin`;
  };

  const respDesc = describe(resp);
  const waitDesc = describe(wait);

  if (respDesc) parts.push(`ABCS ${respDesc}`);
  if (waitDesc && respDesc) parts.push(`${waitDesc}`);
  else if (waitDesc) parts.push(`ABCS ${waitDesc}`);

  // Include turnaround only when it moves opposite to response (trade-off).
  const turnDesc = describe(turn);
  if (
    turnDesc &&
    resp &&
    turn &&
    resp.pctVsRr !== null &&
    turn.pctVsRr !== null &&
    Math.sign(resp.pctVsRr) !== Math.sign(turn.pctVsRr) &&
    Math.abs(turn.pctVsRr) >= 2
  ) {
    parts.push(`turnaround ${turn.pctVsRr < 0 ? "fell" : "rose"} ${Math.abs(turn.pctVsRr).toFixed(1)}%`);
  }

  let sentence = parts.length > 0 ? parts.join(", while ") + "." : "";

  // Trade-off note vs MLFQ when directionally opposed to RR comparison.
  if (
    resp &&
    wait &&
    resp.pctVsRr !== null &&
    wait.pctVsRr !== null &&
    Math.sign(resp.pctVsRr) !== Math.sign(wait.pctVsRr) &&
    Math.abs(resp.pctVsRr) >= 0.5 &&
    Math.abs(wait.pctVsRr) >= 0.5
  ) {
    sentence +=
      " This is a latency/waiting trade-off: improving one metric came at a cost to the other.";
  }

  if (!sentence) {
    sentence =
      "On this workload ABCS performs about the same as Round Robin on the headline latency metrics.";
  }

  // Completed counts (honest reporting if anything incomplete).
  const completedNote = ((): string => {
    const r = results.RR.metrics.completedCount;
    const m = results.MLFQ.metrics.completedCount;
    const a = results.ABCS.metrics.completedCount;
    const total = results.RR.metrics.processCount;
    if (r === total && m === total && a === total) return "";
    return ` Completed: RR ${r}/${total}, MLFQ ${m}/${total}, ABCS ${a}/${total}.`;
  })();

  // Vs MLFQ one-liner when notably different.
  let mlfqNote = "";
  if (resp && resp.pctVsMlfq !== null && Math.abs(resp.pctVsMlfq) >= 5) {
    const dir = resp.pctVsMlfq < 0 ? "lower" : "higher";
    mlfqNote = ` Response time vs MLFQ: ${Math.abs(resp.pctVsMlfq).toFixed(1)}% ${dir}.`;
  }

  return sentence + mlfqNote + completedNote;
}

/** Subtle per-metric best-of highlight among the three algorithms. */
export function bestAlgorithmForMetric(
  results: DemoResults,
  metric: "avgResponseTime" | "avgWaitingTime" | "avgTurnaroundTime" | "completedCount",
): AlgorithmId | null {
  const vals: { id: AlgorithmId; v: number | null }[] = [
    { id: "RR", v: results.RR.metrics[metric] as number | null },
    { id: "MLFQ", v: results.MLFQ.metrics[metric] as number | null },
    { id: "ABCS", v: results.ABCS.metrics[metric] as number | null },
  ];
  const numeric = vals.filter((x) => x.v !== null) as { id: AlgorithmId; v: number }[];
  if (numeric.length === 0) return null;
  // Lower is better for latency; higher for completed count.
  const lower = metric !== "completedCount";
  let best = numeric[0];
  for (const x of numeric) {
    if (lower ? x.v < best.v : x.v > best.v) best = x;
  }
  // Only highlight when meaningfully better than the runner-up.
  const sorted = [...numeric].sort((a, b) => (lower ? a.v - b.v : b.v - a.v));
  if (sorted.length >= 2) {
    const margin = Math.abs(sorted[1].v - sorted[0].v);
    const scale = Math.max(Math.abs(sorted[0].v), 1);
    if (margin / scale < 0.02) return null; // too close to call
  }
  return best.id;
}

export function algorithmLabel(id: AlgorithmId): string {
  return id === "RR" ? "Round Robin" : id === "MLFQ" ? "MLFQ" : "ABCS";
}
