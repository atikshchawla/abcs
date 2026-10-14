import type {
  AbcsDecisionRecord,
  AlgorithmId,
  BehaviourHistorySample,
  BehaviourScores,
  ProcessDefinition,
  ReadyProcessView,
} from "@/lib/model/types";

export type { ReadyProcessView };

/**
 * Common scheduler interface.
 *
 * Information boundary (critical): schedulers may only use
 * - public process info (id, arrivalTime) provided at `init`,
 * - the current ready set (`ReadyProcessView`) with observed runtime
 *   state (ready waits, CPU service so far, completed burst count),
 * - feedback notifications about things that have already happened
 *   (dispatch, executed time, completed bursts, IO waits).
 *
 * Schedulers must never inspect future CPU/IO phase durations.
 */

export interface Selection {
  readonly processId: string | null;
  readonly quantum: number;
  readonly reason: string;
}

export interface PreemptionDecision {
  readonly preempt: boolean;
  readonly reason: string;
}

export interface ProcessDisplayMeta {
  readonly queueLevel?: number;
  readonly effectivePriority?: number;
  readonly scores?: BehaviourScores;
  readonly adaptiveQuantum?: number;
}

export interface Scheduler {
  readonly algorithm: AlgorithmId;

  /** Called once before the run. Only public process info is provided. */
  init(processes: readonly Pick<ProcessDefinition, "id" | "arrivalTime">[]): void;

  /** A process arrived (NEW → READY). It is already in the engine ready queue. */
  onArrival(time: number, processId: string): void;

  /**
   * Select the next process to run from the ready set, or request idle
   * (processId: null) when the policy deliberately keeps the CPU idle
   * (not expected in v1 policies). `ready` is the engine-ready set in
   * FIFO insertion order.
   */
  selectProcess(time: number, ready: readonly ReadyProcessView[]): Selection;

  /** CPU has just started executing `processId` for `quantum` ticks. */
  onDispatch(time: number, processId: string, quantum: number): void;

  /** `executed` ticks of CPU time were consumed by `processId` since the last call. */
  onCpuExecuted(time: number, processId: string, executed: number): void;

  /**
   * A CPU burst of `burstLength` ticks completed. If `enteredIO` is true
   * the process immediately blocked for the IO phase that follows.
   */
  onBurstComplete(
    time: number,
    processId: string,
    burstLength: number,
    enteredIO: boolean,
  ): void;

  /** An IO wait of `ioWaitDuration` ticks completed; the process is READY again. */
  onIOComplete(time: number, processId: string, ioWaitDuration: number): void;

  /** The process's quantum expired while it still had CPU work (now READY). */
  onQuantumExpired(time: number, processId: string): void;

  /** The process terminated. */
  onProcessEnd(time: number, processId: string): void;

  /**
   * Called when the CPU is running and an exogenous event may warrant
   * preemption (arrival or IO completion). Return whether to preempt.
   */
  shouldPreempt(
    time: number,
    currentProcessId: string,
    ready: readonly ReadyProcessView[],
  ): PreemptionDecision;

  /** Optional per-process display metadata (queues, scores, priorities). */
  getProcessDisplay?(processId: string): ProcessDisplayMeta | undefined;

  /** Optional behaviour/observation history (ABCS and ablations). */
  getBehaviourHistory?(): BehaviourHistorySample[];

  /** Optional full decision records (ABCS only; one per dispatch). */
  getDecisionRecords?(): AbcsDecisionRecord[];
}
