import type { SimulationEvent, SimulationResult } from "@/lib/model/types";
import { DEFAULT_MLFQ_CONFIG, type MlfqConfig } from "@/lib/schedulers/mlfq";

/**
 * Queue-state reconstruction from recorded simulation events.
 *
 * Replays the event stream (DISPATCH, QUANTUM_EXPIRED, PREEMPTION,
 * PROCESS_ARRIVAL, IO_COMPLETE, CPU_BURST_COMPLETE, PROCESS_TERMINATED)
 * to rebuild the RR FIFO ready-queue order and MLFQ per-level queues at
 * any simulated time. Uses only facts present in the event stream — no
 * guessed or fabricated transitions.
 */

export interface RrQueueSnapshot {
  readonly time: number;
  /** Process currently on the CPU, or null when idle. */
  readonly running: string | null;
  /** Quantum granted to the running process at its last dispatch. */
  readonly runningQuantum: number | null;
  /** When the running process was dispatched. */
  readonly runningSince: number | null;
  /** FIFO ready-queue order (head first). Running process excluded. */
  readonly ready: readonly string[];
  /** Last dispatch event at or before `time`. */
  readonly lastDispatch: SimulationEvent | null;
  /**
   * State-changing event immediately before `time` that explains why the
   * queue is in its current shape (QUANTUM_EXPIRED, IO_COMPLETE, etc.).
   */
  readonly lastTrigger: SimulationEvent | null;
}

export interface MlfqQueueSnapshot {
  readonly time: number;
  readonly running: string | null;
  readonly runningQuantum: number | null;
  readonly runningSince: number | null;
  /** Level of the running process, or null when idle. */
  readonly runningLevel: number | null;
  /** queues[0] is highest priority; FIFO order within each level. */
  readonly queues: readonly (readonly string[])[];
  readonly lastDispatch: SimulationEvent | null;
  readonly lastTrigger: SimulationEvent | null;
  /** Queue-level movements that happened at `time`, if any. */
  readonly movements: readonly MlfqMovement[];
}

export interface MlfqMovement {
  readonly processId: string;
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly reason: "demotion" | "io-boost" | "periodic-boost" | "arrival";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Cumulative CPU busy time (globalCpuTime) up to `time`, from the gantt. */
function cpuBusyUpTo(gantt: SimulationResult["gantt"], time: number): number {
  let sum = 0;
  for (const g of gantt) {
    if (g.start >= time) break;
    sum += Math.min(g.end, time) - g.start;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// RR FIFO reconstruction
// ---------------------------------------------------------------------------

/**
 * Rebuild the RR FIFO ready-queue order and running process at `time`
 * by replaying events in order. Mirrors the engine's readyQueue push/pop
 * semantics: arrivals and IO completions append to the tail; quantum
 * expiry and preemption re-append the running process to the tail;
 * dispatch removes the selected process.
 */
export function reconstructRrQueue(
  result: SimulationResult,
  time: number,
): RrQueueSnapshot {
  const ready: string[] = [];
  let running: string | null = null;
  let runningQuantum: number | null = null;
  let runningSince: number | null = null;
  let lastDispatch: SimulationEvent | null = null;
  let lastTrigger: SimulationEvent | null = null;

  for (const e of result.events) {
    if (e.time > time) break;
    const pid = e.processId;
    if (!pid) continue;

    switch (e.type) {
      case "PROCESS_ARRIVAL":
        ready.push(pid);
        lastTrigger = e;
        break;
      case "IO_COMPLETE":
        ready.push(pid);
        lastTrigger = e;
        break;
      case "IO_START":
        // Consecutive IO: the process re-blocked immediately after
        // IO_COMPLETE. Remove it from the ready queue (it is BLOCKED).
        {
          const idx = ready.indexOf(pid);
          if (idx >= 0) ready.splice(idx, 1);
        }
        lastTrigger = e;
        break;
      case "DISPATCH": {
        const idx = ready.indexOf(pid);
        if (idx >= 0) ready.splice(idx, 1);
        running = pid;
        runningQuantum =
          typeof e.metadata?.quantum === "number" ? e.metadata.quantum : null;
        runningSince = e.time;
        lastDispatch = e;
        lastTrigger = e;
        break;
      }
      case "QUANTUM_EXPIRED":
        if (running === pid) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        ready.push(pid);
        lastTrigger = e;
        break;
      case "PREEMPTION":
        if (running === pid) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        ready.push(pid);
        lastTrigger = e;
        break;
      case "CPU_BURST_COMPLETE": {
        const enteredIO = e.metadata?.enteredIO === true;
        if (running === pid && enteredIO) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        // Non-IO burst completion keeps the process running (consecutive
        // CPU). The engine restores the saved remaining quantum, so the
        // runningSince (original dispatch time) stays authoritative for
        // the remaining-quantum countdown.
        lastTrigger = e;
        break;
      }
      case "PROCESS_TERMINATED":
        if (running === pid) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        // Terminated processes never sit in the ready queue.
        {
          const idx = ready.indexOf(pid);
          if (idx >= 0) ready.splice(idx, 1);
        }
        lastTrigger = e;
        break;
      default:
        break;
    }
  }

  // Remaining quantum = granted − elapsed ticks since the last CPU grant.
  // Clamped to ≥ 0 so it never goes negative.
  if (running !== null && runningQuantum !== null && runningSince !== null) {
    runningQuantum = Math.max(0, runningQuantum - (time - runningSince));
  }

  return {
    time,
    running,
    runningQuantum,
    runningSince,
    ready,
    lastDispatch,
    lastTrigger,
  };
}

// ---------------------------------------------------------------------------
// MLFQ 3-queue reconstruction
// ---------------------------------------------------------------------------

/**
 * Rebuild MLFQ per-level queues at `time`. Tracks queue levels through
 * the same rules the MlfqScheduler applies:
 *
 * - Arrival → level 0.
 * - Full-quantum expiry → demote one level (capped at lowest).
 * - I/O block / I/O completion → boost to level 0 (ioBoostsToTop).
 * - Periodic boost: every boostInterval global CPU ticks, all processes
 *   return to level 0. Applied at the next scheduler callback after the
 *   threshold is crossed, matching MlfqScheduler.applyBoostIfNeeded.
 *
 * FIFO order within each level follows the engine readyQueue order
 * (arrivals/IO completions append; requeues append; dispatch removes).
 */
export function reconstructMlfqQueues(
  result: SimulationResult,
  time: number,
  cfg: MlfqConfig = DEFAULT_MLFQ_CONFIG,
): MlfqQueueSnapshot {
  const levels = cfg.quanta.length;
  const queueOf = new Map<string, number>();
  const ready: string[] = [];
  let running: string | null = null;
  let runningQuantum: number | null = null;
  let runningSince: number | null = null;
  let lastDispatch: SimulationEvent | null = null;
  let lastTrigger: SimulationEvent | null = null;
  let lastBoostTime = 0;
  const movements: MlfqMovement[] = [];

  const levelOf = (pid: string): number => queueOf.get(pid) ?? 0;

  const applyBoostIfNeeded = (eventTime: number): void => {
    const globalCpu = cpuBusyUpTo(result.gantt, eventTime);
    if (globalCpu - lastBoostTime >= cfg.boostInterval) {
      for (const [pid, lvl] of queueOf) {
        if (lvl !== 0) {
          queueOf.set(pid, 0);
          movements.push({
            processId: pid,
            fromLevel: lvl,
            toLevel: 0,
            reason: "periodic-boost",
          });
        }
      }
      lastBoostTime = globalCpu;
    }
  };

  for (const e of result.events) {
    if (e.time > time) break;
    const pid = e.processId;
    if (!pid) continue;

    switch (e.type) {
      case "PROCESS_ARRIVAL": {
        applyBoostIfNeeded(e.time);
        queueOf.set(pid, 0);
        ready.push(pid);
        movements.push({
          processId: pid,
          fromLevel: 0,
          toLevel: 0,
          reason: "arrival",
        });
        lastTrigger = e;
        break;
      }
      case "IO_COMPLETE": {
        applyBoostIfNeeded(e.time);
        if (cfg.ioBoostsToTop) {
          const prev = levelOf(pid);
          queueOf.set(pid, 0);
          if (prev !== 0) {
            movements.push({
              processId: pid,
              fromLevel: prev,
              toLevel: 0,
              reason: "io-boost",
            });
          }
        }
        ready.push(pid);
        lastTrigger = e;
        break;
      }
      case "IO_START": {
        // Consecutive IO: the process re-blocked immediately after
        // IO_COMPLETE. Remove it from the ready queue (it is BLOCKED).
        const idx = ready.indexOf(pid);
        if (idx >= 0) ready.splice(idx, 1);
        lastTrigger = e;
        break;
      }
      case "DISPATCH": {
        applyBoostIfNeeded(e.time);
        const idx = ready.indexOf(pid);
        if (idx >= 0) ready.splice(idx, 1);
        running = pid;
        runningQuantum =
          typeof e.metadata?.quantum === "number" ? e.metadata.quantum : null;
        runningSince = e.time;
        lastDispatch = e;
        lastTrigger = e;
        break;
      }
      case "QUANTUM_EXPIRED": {
        applyBoostIfNeeded(e.time);
        if (running === pid) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        const current = levelOf(pid);
        const demoted = Math.min(current + 1, levels - 1);
        queueOf.set(pid, demoted);
        movements.push({
          processId: pid,
          fromLevel: current,
          toLevel: demoted,
          reason: "demotion",
        });
        ready.push(pid);
        lastTrigger = e;
        break;
      }
      case "PREEMPTION": {
        applyBoostIfNeeded(e.time);
        if (running === pid) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        ready.push(pid);
        lastTrigger = e;
        break;
      }
      case "CPU_BURST_COMPLETE": {
        applyBoostIfNeeded(e.time);
        const enteredIO = e.metadata?.enteredIO === true;
        if (enteredIO && cfg.ioBoostsToTop) {
          const prev = levelOf(pid);
          queueOf.set(pid, 0);
          if (prev !== 0) {
            movements.push({
              processId: pid,
              fromLevel: prev,
              toLevel: 0,
              reason: "io-boost",
            });
          }
        }
        if (running === pid && enteredIO) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        // Non-IO burst completion keeps the process running; the engine
        // restores the saved remaining quantum, so runningSince stays
        // authoritative for the countdown.
        lastTrigger = e;
        break;
      }
      case "PROCESS_TERMINATED": {
        if (running === pid) {
          running = null;
          runningQuantum = null;
          runningSince = null;
        }
        queueOf.delete(pid);
        {
          const idx = ready.indexOf(pid);
          if (idx >= 0) ready.splice(idx, 1);
        }
        lastTrigger = e;
        break;
      }
      default:
        break;
    }
  }

  // Remaining quantum = granted − elapsed ticks since the last CPU grant.
  if (running !== null && runningQuantum !== null && runningSince !== null) {
    runningQuantum = Math.max(0, runningQuantum - (time - runningSince));
  }

  // Bucket ready processes by level, preserving FIFO order within each.
  const queues: string[][] = Array.from({ length: levels }, () => []);
  for (const pid of ready) {
    const lvl = levelOf(pid);
    if (lvl >= 0 && lvl < levels) queues[lvl].push(pid);
  }

  return {
    time,
    running,
    runningQuantum,
    runningSince,
    runningLevel: running !== null ? levelOf(running) : null,
    queues,
    lastDispatch,
    lastTrigger,
    movements,
  };
}

// ---------------------------------------------------------------------------
// Nearest dispatch by simulated time (time-sync across algorithms)
// ---------------------------------------------------------------------------

/**
 * For algorithm `result`, find the DISPATCH event whose time is nearest
 * to `targetTime` (preferring the latest DISPATCH at or before the
 * target, falling back to the first DISPATCH after it). This keeps the
 * three algorithm panels in sync by *simulated time*, not event index.
 */
export function nearestDispatchAt(
  result: SimulationResult,
  targetTime: number,
): SimulationEvent | null {
  let best: SimulationEvent | null = null;
  let firstAfter: SimulationEvent | null = null;
  for (const e of result.events) {
    if (e.type !== "DISPATCH") continue;
    if (e.time <= targetTime) {
      best = e;
    } else if (!firstAfter) {
      firstAfter = e;
    }
  }
  return best ?? firstAfter;
}
