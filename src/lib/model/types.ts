/**
 * Core domain types for the ABCS discrete-event CPU scheduler simulator.
 *
 * Time is integer simulated time ("ticks"). The simulator engine knows
 * future phase durations in order to advance time, but that information
 * must never be exposed to scheduler policies (see `ReadyProcessView`
 * and `Scheduler.init` — schedulers only ever see arrival/public state
 * and observations that have already occurred).
 */

export type PhaseType = "CPU" | "IO";

export interface Phase {
  readonly type: PhaseType;
  /** Duration in simulated ticks. Must be a positive integer. */
  readonly duration: number;
}

export interface ProcessDefinition {
  readonly id: string;
  /** Tick at which the process becomes eligible (NEW → READY). */
  readonly arrivalTime: number;
  /** Ordered CPU/IO phases. Must be non-empty. */
  readonly phases: readonly Phase[];
}

export interface Workload {
  readonly name: string;
  readonly description?: string;
  readonly processes: readonly ProcessDefinition[];
  /**
   * Optional ground-truth transition timestamps for *evaluation only*
   * (e.g. computing adaptation delay). Never visible to schedulers.
   */
  readonly evaluationOnlyTransitionTimes?: readonly number[];
}

export type ProcessState = "NEW" | "READY" | "RUNNING" | "BLOCKED" | "TERMINATED";

export type AlgorithmId = "RR" | "MLFQ" | "ABCS";

export const ALGORITHM_IDS: readonly AlgorithmId[] = ["RR", "MLFQ", "ABCS"];

export type SimulationEventType =
  | "PROCESS_ARRIVAL"
  | "DISPATCH"
  | "QUANTUM_EXPIRED"
  | "CPU_BURST_COMPLETE"
  | "IO_START"
  | "IO_COMPLETE"
  | "PREEMPTION"
  | "PROCESS_TERMINATED"
  | "BEHAVIOUR_UPDATE"
  | "TRANSITION_DETECTED"
  | "POLICY_ADJUSTMENT"
  | "IDLE_INTERVAL";

export interface SimulationEvent {
  readonly time: number;
  readonly type: SimulationEventType;
  readonly processId?: string;
  readonly algorithm: AlgorithmId;
  /** Human-readable, truthful decision reason. */
  readonly reason: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface GanttInterval {
  readonly start: number;
  readonly end: number;
  /** null means the CPU was idle during [start, end). */
  readonly processId: string | null;
  /** True if this interval ended because the quantum expired. */
  readonly endedByQuantumExpiry: boolean;
  /** True if this interval ended because the CPU burst completed. */
  readonly endedByBurstComplete: boolean;
}

/** Public per-process info passed to schedulers (no future phases). */
export interface ReadyProcessView {
  readonly id: string;
  /** Continuous time this process has spent READY as of `time`. */
  readonly currentReadyWait: number;
  /** Total accumulated READY time so far. */
  readonly totalReadyWait: number;
  /** Total CPU service so far. */
  readonly cpuService: number;
  /** Number of completed CPU bursts so far. */
  readonly completedBursts: number;
}

export interface ProcessFinalState {
  readonly id: string;
  readonly state: ProcessState;
  readonly arrivalTime: number;
  readonly firstStartTime: number | null;
  readonly completionTime: number | null;
  readonly cpuService: number;
  readonly totalCpuDemand: number;
  readonly readyWaitTime: number;
  readonly ioBlockedTime: number;
  readonly completed: boolean;
}

export interface BehaviourScores {
  readonly cpuDemandScore: number;
  readonly ioActivityScore: number;
  readonly latencySensitivityScore: number;
}

export interface BehaviourHistorySample {
  readonly time: number;
  readonly processId: string;
  readonly scores: BehaviourScores;
  readonly rawBurstLength?: number;
  readonly emaBurstLength?: number;
  readonly event?: "TRANSITION_DETECTED" | "POLICY_ADJUSTMENT";
  readonly note?: string;
}

export interface MetricsSummary {
  readonly processCount: number;
  readonly completedCount: number;
  readonly incompleteCount: number;
  readonly makespan: number;
  readonly measurementStart: number;
  readonly measurementEnd: number;
  readonly avgResponseTime: number | null;
  readonly medianResponseTime: number | null;
  readonly p95ResponseTime: number | null;
  readonly avgWaitingTime: number | null;
  readonly avgTurnaroundTime: number | null;
  readonly maxReadyWait: number;
  readonly throughput: number;
  readonly cpuUtilization: number;
  readonly busyTime: number;
  readonly idleTime: number;
  readonly contextSwitches: number;
  readonly fairnessJainIndex: number | null;
  readonly policyChangeCount: number;
  readonly policyChangesPerTick: number;
  readonly adaptationDelays: readonly { transitionTime: number; delay: number }[];
}

export interface ProcessMetricsRow {
  readonly id: string;
  readonly completed: boolean;
  readonly arrivalTime: number;
  readonly firstStartTime: number | null;
  readonly completionTime: number | null;
  readonly responseTime: number | null;
  readonly turnaroundTime: number | null;
  readonly waitingTime: number;
  readonly cpuService: number;
  readonly totalCpuDemand: number;
  readonly ioBlockedTime: number;
}

export interface SimulationResult {
  readonly runId: string;
  readonly algorithm: AlgorithmId;
  readonly workloadName: string;
  readonly events: readonly SimulationEvent[];
  readonly gantt: readonly GanttInterval[];
  readonly processFinalStates: readonly ProcessFinalState[];
  readonly processMetrics: readonly ProcessMetricsRow[];
  readonly metrics: MetricsSummary;
  readonly behaviourHistory: readonly BehaviourHistorySample[];
  readonly completed: boolean;
}

/** Aggregate configuration accepted by the simulation entrypoints. */
export interface SimulationConfigInput {
  readonly algorithm: AlgorithmId;
  readonly rrQuantum?: number;
  readonly abcs?: Partial<AbcsConfigInput>;
}

export interface AbcsConfigInput {
  readonly emaAlpha: number;
  readonly burstNormCap: number;
  readonly ioNormCap: number;
  readonly latencyBlockingBoost: number;
  readonly quantumLevels: readonly number[];
  readonly cpuDemandQuantumThreshold: number;
  readonly latencyQuantumThreshold: number;
  readonly agingWeight: number;
  readonly agingCap: number;
  readonly latencyPriorityWeight: number;
  readonly transitionThreshold: number;
  readonly transitionPersistence: number;
  readonly transitionCooldown: number;
  readonly transitionBaselineAlpha: number;
  readonly stabilitySettlePeriod: number;
  readonly enableTransitionDetection: boolean;
  readonly enableStabilityControls: boolean;
}
