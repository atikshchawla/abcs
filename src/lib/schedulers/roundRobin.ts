import type { AlgorithmId } from "@/lib/model/types";
import type {
  PreemptionDecision,
  ProcessDisplayMeta,
  ReadyProcessView,
  Scheduler,
  Selection,
} from "@/lib/schedulers/types";

export const DEFAULT_RR_QUANTUM = 4;

/**
 * Round Robin: FIFO ready queue, fixed quantum.
 *
 * - The engine ready queue is FIFO insertion order; RR always selects
 *   the front process.
 * - A process that exhausts its quantum and remains READY returns to
 *   the queue tail (handled by the engine via requeue + this policy
 *   simply reading the front).
 * - Arrivals never preempt the running process.
 */
export class RoundRobinScheduler implements Scheduler {
  readonly algorithm: AlgorithmId = "RR";
  private readonly quantum: number;

  constructor(quantum: number = DEFAULT_RR_QUANTUM) {
    if (!Number.isInteger(quantum) || quantum < 1) {
      throw new Error(`RR quantum must be a positive integer, got ${quantum}`);
    }
    this.quantum = quantum;
  }

  init(): void {
    // RR keeps no per-process state.
  }

  onArrival(): void {}
  onDispatch(): void {}
  onCpuExecuted(): void {}
  onBurstComplete(): void {}
  onIOComplete(): void {}
  onQuantumExpired(): void {}
  onProcessEnd(): void {}

  selectProcess(time: number, ready: readonly ReadyProcessView[]): Selection {
    if (ready.length === 0) {
      return { processId: null, quantum: 0, reason: "ready queue empty" };
    }
    const next = ready[0];
    return {
      processId: next.id,
      quantum: this.quantum,
      reason: `selected: FIFO head of ready queue (fixed quantum ${this.quantum}) at t=${time}`,
    };
  }

  shouldPreempt(): PreemptionDecision {
    return { preempt: false, reason: "RR never preempts on arrival/IO events" };
  }

  getProcessDisplay(): ProcessDisplayMeta {
    return {};
  }
}
