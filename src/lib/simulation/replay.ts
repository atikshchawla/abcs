import type {
  ProcessState,
  SimulationEvent,
  SimulationResult,
} from "@/lib/model/types";

/**
 * Replay timeline: reconstructs per-process state at any simulated time
 * from a recorded SimulationResult (events + gantt + finals). The UI
 * scrubber steps through precomputed snapshots so timer-driven state
 * never drifts from the trace.
 */

export interface ProcessReplayState {
  readonly id: string;
  readonly state: ProcessState;
  readonly arrivalTime: number;
  readonly firstStartTime: number | null;
  readonly completionTime: number | null;
  /** CPU service accrued up to and including `time`. */
  readonly cpuService: number;
  readonly readyWaitTime: number;
  readonly ioBlockedTime: number;
  /** Continuous READY wait at `time` (0 unless currently READY). */
  readonly currentReadyWait: number;
  readonly totalCpuDemand: number;
  readonly completedBursts: number;
}

export interface ReplaySnapshot {
  readonly time: number;
  readonly eventIndex: number;
  readonly cpuProcessId: string | null;
  readonly cpuQuantumRemaining: number | null;
  readonly processes: Readonly<Record<string, ProcessReplayState>>;
  readonly idle: boolean;
}

interface MutableProc {
  state: ProcessState;
  firstStartTime: number | null;
  completionTime: number | null;
  cpuService: number;
  readyWaitTime: number;
  ioBlockedTime: number;
  readySince: number | null;
  blockedSince: number | null;
  cpuSince: number | null;
  quantumRemaining: number | null;
  completedBursts: number;
  totalCpuDemand: number;
  arrivalTime: number;
  phaseIndex: number;
}

export class ReplayTimeline {
  readonly times: readonly number[];
  readonly snapshots: readonly ReplaySnapshot[];
  readonly transitions: readonly number[];

  constructor(private readonly result: SimulationResult) {
    const demands = new Map<string, number>();
    for (const f of result.processFinalStates) {
      demands.set(f.id, f.totalCpuDemand);
    }

    const procs = new Map<string, MutableProc>();
    for (const f of result.processFinalStates) {
      procs.set(f.id, {
        state: "NEW",
        firstStartTime: null,
        completionTime: null,
        cpuService: 0,
        readyWaitTime: 0,
        ioBlockedTime: 0,
        readySince: null,
        blockedSince: null,
        cpuSince: null,
        quantumRemaining: null,
        completedBursts: 0,
        totalCpuDemand: f.totalCpuDemand,
        arrivalTime: f.arrivalTime,
        phaseIndex: 0,
      });
    }

    const snapshots: ReplaySnapshot[] = [];
    const times: number[] = [];
    const transitions: number[] = [];
    let cpuPid: string | null = null;
    let lastEventIndex = -1;

    const accrueUpTo = (time: number): void => {
      for (const p of procs.values()) {
        if (p.cpuSince !== null && cpuPid !== null) {
          const cur = procs.get(cpuPid);
          if (cur === p) {
            p.cpuService += time - p.cpuSince;
            p.cpuSince = time;
          }
        }
        if (p.readySince !== null) {
          p.readyWaitTime += time - p.readySince;
          p.readySince = time;
        }
        if (p.blockedSince !== null) {
          p.ioBlockedTime += time - p.blockedSince;
          p.blockedSince = time;
        }
      }
    };

    const snapshotAt = (time: number, eventIndex: number): ReplaySnapshot => {
      const processes: Record<string, ProcessReplayState> = {};
      for (const [id, p] of procs) {
        processes[id] = {
          id,
          state: p.state,
          arrivalTime: p.arrivalTime,
          firstStartTime: p.firstStartTime,
          completionTime: p.completionTime,
          cpuService: p.cpuService,
          readyWaitTime: p.readyWaitTime,
          ioBlockedTime: p.ioBlockedTime,
          currentReadyWait: p.readySince !== null ? time - p.readySince : 0,
          totalCpuDemand: p.totalCpuDemand,
          completedBursts: p.completedBursts,
        };
      }
      return {
        time,
        eventIndex,
        cpuProcessId: cpuPid,
        cpuQuantumRemaining: cpuPid !== null ? procs.get(cpuPid)?.quantumRemaining ?? null : null,
        processes,
        idle: cpuPid === null,
      };
    };

    const events = result.events;
    let prevTime = 0;
    snapshots.push(snapshotAt(0, -1));
    times.push(0);

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.time > prevTime) {
        accrueUpTo(e.time);
        prevTime = e.time;
      }
      applyEvent(e, procs, {
        set cpuPid(v) {
          cpuPid = v;
        },
        get cpuPid() {
          return cpuPid;
        },
        onTransition: (t) => transitions.push(t),
      });
      lastEventIndex = i;
      // One snapshot per distinct event time (after all same-time events).
      const next = events[i + 1];
      if (!next || next.time !== e.time) {
        snapshots.push(snapshotAt(e.time, lastEventIndex));
        times.push(e.time);
      }
    }

    // Final snapshot: accrue to the last event time (already done).
    this.snapshots = snapshots;
    this.times = times;
    this.transitions = transitions;
    void demands;
  }

  get duration(): number {
    return this.times[this.times.length - 1] ?? 0;
  }

  get eventCount(): number {
    return this.result.events.length;
  }

  /** Snapshot at the greatest recorded time <= `time`. */
  stateAt(time: number): ReplaySnapshot {
    if (time <= this.times[0]) return this.snapshots[0];
    // Binary search.
    let lo = 0;
    let hi = this.times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.times[mid] <= time) lo = mid;
      else hi = mid - 1;
    }
    return this.snapshots[lo];
  }

  /** Snapshot at event boundary `index` (0..eventCount-1). */
  stateAtEvent(eventIndex: number): ReplaySnapshot {
    // Find the snapshot whose eventIndex >= eventIndex, preferring the
    // snapshot recorded at exactly that event's time.
    const e = this.result.events[Math.max(0, Math.min(eventIndex, this.result.events.length - 1))];
    return this.stateAt(e.time);
  }

  /** Next transition time strictly after `time`, or null. */
  nextTransitionAfter(time: number): number | null {
    for (const t of this.transitions) if (t > time) return t;
    return null;
  }

  get events(): readonly SimulationEvent[] {
    return this.result.events;
  }

  get gantt(): SimulationResult["gantt"] {
    return this.result.gantt;
  }
}

interface Applier {
  set cpuPid(v: string | null);
  get cpuPid(): string | null;
  onTransition(time: number): void;
}

function applyEvent(
  e: SimulationEvent,
  procs: Map<string, MutableProc>,
  ap: Applier,
): void {
  if (e.type === "TRANSITION_DETECTED" || e.type === "POLICY_ADJUSTMENT") {
    ap.onTransition(e.time);
  }
  const pid = e.processId;
  if (!pid) return;
  const p = procs.get(pid);
  if (!p) return;

  switch (e.type) {
    case "PROCESS_ARRIVAL":
      p.state = "READY";
      p.readySince = e.time;
      break;
    case "DISPATCH": {
      // Leaving READY (if it was READY).
      if (p.readySince !== null) {
        p.readyWaitTime += e.time - p.readySince;
        p.readySince = null;
      }
      p.state = "RUNNING";
      if (p.firstStartTime === null) p.firstStartTime = e.time;
      p.cpuSince = e.time;
      const quantum = typeof e.metadata?.quantum === "number" ? e.metadata.quantum : null;
      p.quantumRemaining = quantum;
      ap.cpuPid = pid;
      break;
    }
    case "QUANTUM_EXPIRED":
      if (p.cpuSince !== null) {
        p.cpuService += e.time - p.cpuSince;
        p.cpuSince = null;
      }
      p.quantumRemaining = null;
      p.state = "READY";
      p.readySince = e.time;
      if (ap.cpuPid === pid) ap.cpuPid = null;
      break;
    case "PREEMPTION":
      if (p.cpuSince !== null) {
        p.cpuService += e.time - p.cpuSince;
        p.cpuSince = null;
      }
      p.quantumRemaining = null;
      p.state = "READY";
      p.readySince = e.time;
      if (ap.cpuPid === pid) ap.cpuPid = null;
      break;
    case "CPU_BURST_COMPLETE": {
      if (p.cpuSince !== null) {
        p.cpuService += e.time - p.cpuSince;
        p.cpuSince = null;
      }
      p.completedBursts += 1;
      p.quantumRemaining = null;
      const enteredIO = e.metadata?.enteredIO === true;
      if (enteredIO) {
        p.state = "BLOCKED";
        p.blockedSince = e.time;
        if (ap.cpuPid === pid) ap.cpuPid = null;
      }
      // Termination is signaled by PROCESS_TERMINATED; consecutive CPU
      // keeps RUNNING with a fresh quantum on the next DISPATCH or same.
      break;
    }
    case "IO_START":
      // Already BLOCKED via burst-complete; nothing extra.
      break;
    case "IO_COMPLETE":
      if (p.blockedSince !== null) {
        p.ioBlockedTime += e.time - p.blockedSince;
        p.blockedSince = null;
      }
      p.state = "READY";
      p.readySince = e.time;
      break;
    case "PROCESS_TERMINATED":
      if (p.cpuSince !== null) {
        p.cpuService += e.time - p.cpuSince;
        p.cpuSince = null;
      }
      if (p.blockedSince !== null) {
        p.ioBlockedTime += e.time - p.blockedSince;
        p.blockedSince = null;
      }
      if (p.readySince !== null) {
        p.readyWaitTime += e.time - p.readySince;
        p.readySince = null;
      }
      p.state = "TERMINATED";
      p.completionTime = e.time;
      p.quantumRemaining = null;
      if (ap.cpuPid === pid) ap.cpuPid = null;
      break;
    default:
      break;
  }
}
