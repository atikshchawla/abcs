import type { AlgorithmId, ProcessDefinition } from "@/lib/model/types";
import type {
  PreemptionDecision,
  ProcessDisplayMeta,
  ReadyProcessView,
  Scheduler,
  Selection,
} from "@/lib/schedulers/types";

export interface MlfqConfig {
  /** Queue levels from highest (0) to lowest (n-1). */
  readonly quanta: readonly number[];
  /** Ticks of CPU time after which all processes boost to the top queue. */
  readonly boostInterval: number;
  /**
   * I/O rule: a process that blocks for I/O returns to the top queue
   * (classic interactive boost). Set false to return to the same queue.
   */
  readonly ioBoostsToTop: boolean;
}

export const DEFAULT_MLFQ_CONFIG: MlfqConfig = {
  quanta: [2, 4, 8],
  boostInterval: 40,
  ioBoostsToTop: true,
};

/**
 * Multilevel Feedback Queue (documented conventional variant).
 *
 * - 3 queues by default; higher queues use shorter quanta.
 * - New processes enter the top queue.
 * - A process that consumes its full quantum without blocking is
 *   demoted one level (capped at the lowest queue).
 * - A process that blocks for I/O returns to the top queue
 *   (`ioBoostsToTop`), rewarding interactive behaviour.
 * - Periodic priority boost: every `boostInterval` ticks of global CPU
 *   time, every process returns to the top queue (limits starvation).
 * - Lower queues run only when higher-priority queues are non-empty.
 *
 * Preemption: a running process is preempted when another process
 * becomes READY at a strictly higher queue level.
 */
export class MlfqScheduler implements Scheduler {
  readonly algorithm: AlgorithmId = "MLFQ";
  private readonly levels: number;
  private readonly queueOf = new Map<string, number>();
  private readonly lastLevelOf = new Map<string, number>();
  private globalCpuTime = 0;
  private lastBoostTime = 0;

  constructor(private readonly cfg: MlfqConfig = DEFAULT_MLFQ_CONFIG) {
    if (cfg.quanta.length === 0) {
      throw new Error("MLFQ must have at least one queue level");
    }
    for (const q of cfg.quanta) {
      if (!Number.isInteger(q) || q < 1) {
        throw new Error(`MLFQ quanta must be positive integers, got ${q}`);
      }
    }
    this.levels = cfg.quanta.length;
  }

  init(processes: readonly Pick<ProcessDefinition, "id" | "arrivalTime">[]): void {
    for (const p of processes) {
      this.queueOf.set(p.id, 0);
      this.lastLevelOf.set(p.id, 0);
    }
  }

  onArrival(time: number, processId: string): void {
    this.applyBoostIfNeeded(time);
    this.queueOf.set(processId, 0);
    this.lastLevelOf.set(processId, 0);
  }

  onDispatch(time: number, processId: string): void {
    this.applyBoostIfNeeded(time);
    this.lastLevelOf.set(processId, this.level(processId));
  }

  onCpuExecuted(_time: number, _processId: string, executed: number): void {
    this.globalCpuTime += executed;
  }

  onBurstComplete(time: number, processId: string, _burstLength: number, enteredIO: boolean): void {
    this.applyBoostIfNeeded(time);
    if (enteredIO && this.cfg.ioBoostsToTop) {
      this.queueOf.set(processId, 0);
    }
    // A burst completion that is NOT followed by IO means the process
    // finished its CPU work for the phase chain or continues with
    // another CPU phase; no demotion here — demotion happens on full
    // quantum expiry (onQuantumExpired). Termination is handled by
    // onProcessEnd.
  }

  onIOComplete(time: number, processId: string): void {
    this.applyBoostIfNeeded(time);
    if (this.cfg.ioBoostsToTop) {
      this.queueOf.set(processId, 0);
    }
  }

  onQuantumExpired(time: number, processId: string): void {
    this.applyBoostIfNeeded(time);
    // Demote: consumed full quantum without blocking (if it had blocked,
    // onBurstComplete/onIOComplete already boosted it to top and it
    // would not reach quantum expiry while running).
    const current = this.level(processId);
    const demoted = Math.min(current + 1, this.levels - 1);
    this.queueOf.set(processId, demoted);
  }

  onProcessEnd(_time: number, processId: string): void {
    this.queueOf.delete(processId);
    this.lastLevelOf.delete(processId);
  }

  selectProcess(time: number, ready: readonly ReadyProcessView[]): Selection {
    this.applyBoostIfNeeded(time);
    if (ready.length === 0) {
      return { processId: null, quantum: 0, reason: "ready queue empty" };
    }
    // Choose the ready process at the highest queue (lowest level index).
    // Ties broken by engine FIFO insertion order (scan in order).
    let best = ready[0];
    let bestLevel = this.level(best.id);
    for (let i = 1; i < ready.length; i++) {
      const level = this.level(ready[i].id);
      if (level < bestLevel) {
        best = ready[i];
        bestLevel = level;
      }
    }
    const quantum = this.cfg.quanta[bestLevel];
    return {
      processId: best.id,
      quantum,
      reason: `selected: highest MLFQ queue (level ${bestLevel}, quantum ${quantum}) among ${ready.length} READY process(es)`,
    };
  }

  shouldPreempt(
    time: number,
    currentProcessId: string,
    ready: readonly ReadyProcessView[],
  ): PreemptionDecision {
    this.applyBoostIfNeeded(time);
    const currentLevel = this.level(currentProcessId);
    for (const r of ready) {
      const level = this.level(r.id);
      if (level < currentLevel) {
        return {
          preempt: true,
          reason: `preempt: ${r.id} entered READY at higher MLFQ level ${level} (current ${currentProcessId} at ${currentLevel})`,
        };
      }
    }
    return { preempt: false, reason: "no READY process at a higher MLFQ level" };
  }

  getProcessDisplay(processId: string): ProcessDisplayMeta | undefined {
    const level = this.queueOf.get(processId);
    if (level === undefined) return undefined;
    return { queueLevel: level };
  }

  private level(processId: string): number {
    return this.queueOf.get(processId) ?? 0;
  }

  private applyBoostIfNeeded(time: number): void {
    if (this.globalCpuTime - this.lastBoostTime >= this.cfg.boostInterval) {
      for (const [pid, level] of this.queueOf) {
        if (level !== 0) this.queueOf.set(pid, 0);
      }
      this.lastBoostTime = this.globalCpuTime;
      void time; // boost is driven by CPU time; time kept for logging hooks
    }
  }
}
