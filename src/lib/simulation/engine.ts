import type {
  AlgorithmId,
  GanttInterval,
  ProcessDefinition,
  ProcessFinalState,
  ProcessState,
  ReadyProcessView,
  SimulationConfigInput,
  SimulationEvent,
  SimulationEventType,
  SimulationResult,
  Workload,
} from "@/lib/model/types";
import { transitionState } from "@/lib/simulation/processState";
import { EventQueue } from "@/lib/simulation/eventQueue";
import { buildProcessMetricsRows, computeMetrics } from "@/lib/simulation/metrics";
import type { Scheduler } from "@/lib/schedulers/types";
import { createScheduler } from "@/lib/schedulers";

/** Hard safety limits so invalid inputs cannot hang the engine. */
export const ENGINE_LIMITS = {
  maxEvents: 500_000,
  maxTime: 1_000_000,
} as const;

interface ProcessRuntime {
  def: ProcessDefinition;
  state: ProcessState;
  phaseIndex: number;
  phaseRemaining: number;
  firstStartTime: number | null;
  completionTime: number | null;
  cpuService: number;
  readyWaitTime: number;
  ioBlockedTime: number;
  readySince: number | null;
  blockedSince: number | null;
  /** Total CPU demand across all CPU phases (static). */
  totalCpuDemand: number;
}

interface CpuState {
  processId: string | null;
  quantumRemaining: number;
  burstRemaining: number;
  /** Interval start for the current occupancy (for Gantt). */
  intervalStart: number;
}

function deterministicRunId(
  algorithm: AlgorithmId,
  workloadName: string,
  config: SimulationConfigInput,
): string {
  const cfg = JSON.stringify({
    rrQuantum: config.rrQuantum ?? null,
    abcs: config.abcs ?? null,
  });
  return `${algorithm}:${workloadName}:${cfg}`;
}

/**
 * Discrete-event CPU scheduler simulator.
 *
 * Simultaneous-event ordering at time t (applies to every algorithm):
 *  1. Complete CPU/I/O phases ending at t.
 *  2. Process IO completions (by processId) then arrivals (by workload order).
 *  3. Update observations due at t (scheduler notifications).
 *  4. Add newly READY processes to the ready queue.
 *  5. Apply quantum-expiry requeue and preemption checks.
 *  6. Dispatch if the CPU is idle.
 */
export function runSimulation(
  workload: Workload,
  config: SimulationConfigInput,
): SimulationResult {
  const algorithm = config.algorithm;
  const scheduler = createScheduler(config);
  const events: SimulationEvent[] = [];
  const gantt: GanttInterval[] = [];
  const eventQueue = new EventQueue();

  const procs = new Map<string, ProcessRuntime>();
  const readyQueue: string[] = []; // FIFO insertion order (engine-owned)
  let eventCount = 0;

  const emit = (
    time: number,
    type: SimulationEventType,
    reason: string,
    processId?: string,
    metadata?: Record<string, string | number | boolean>,
  ): void => {
    eventCount++;
    if (eventCount > ENGINE_LIMITS.maxEvents) {
      throw new Error(
        `Simulation aborted: exceeded maximum event count (${ENGINE_LIMITS.maxEvents}). Check for zero-duration or pathological workloads.`,
      );
    }
    const event: SimulationEvent = {
      time,
      type,
      algorithm,
      reason,
      ...(processId !== undefined ? { processId } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
    events.push(event);
  };

  // ---- init processes (deep-copy defs; never mutate input workload) ----
  const workloadOrder = new Map<string, number>();
  workload.processes.forEach((def, index) => {
    workloadOrder.set(def.id, index);
    const totalCpuDemand = def.phases
      .filter((p) => p.type === "CPU")
      .reduce((a, p) => a + p.duration, 0);
    procs.set(def.id, {
      def,
      state: "NEW",
      phaseIndex: 0,
      phaseRemaining: def.phases[0].duration,
      firstStartTime: null,
      completionTime: null,
      cpuService: 0,
      readyWaitTime: 0,
      ioBlockedTime: 0,
      readySince: null,
      blockedSince: null,
      totalCpuDemand,
    });
    eventQueue.push({
      time: def.arrivalTime,
      type: "PROCESS_ARRIVAL",
      processId: def.id,
    });
  });

  scheduler.init(
    workload.processes.map((p) => ({ id: p.id, arrivalTime: p.arrivalTime })),
  );

  const cpu: CpuState = {
    processId: null,
    quantumRemaining: 0,
    burstRemaining: 0,
    intervalStart: 0,
  };

  /** Emit events queued by adaptive schedulers (transition/policy logs). */
  function drainSchedulerEvents(): void {
    const maybe = scheduler as Scheduler & { drainPendingEvents?: () => SimulationEvent[] };
    if (typeof maybe.drainPendingEvents === "function") {
      for (const e of maybe.drainPendingEvents()) {
        eventCount++;
        if (eventCount > ENGINE_LIMITS.maxEvents) {
          throw new Error(`Simulation aborted: exceeded maximum event count (${ENGINE_LIMITS.maxEvents}).`);
        }
        events.push(e);
      }
    }
  }

  let time = 0;
  const allTerminated = () => {
    for (const p of procs.values()) if (p.state !== "TERMINATED") return false;
    return true;
  };

  const readyViews = (): ReadyProcessView[] =>
    readyQueue
      .map((id) => procs.get(id)!)
      .filter((p) => p.state === "READY")
      .map((p) => ({
        id: p.def.id,
        currentReadyWait:
          p.readySince !== null ? time - p.readySince : p.readyWaitTime,
        totalReadyWait: p.readyWaitTime,
        cpuService: p.cpuService,
        completedBursts: countCompletedBursts(p),
      }));

  function countCompletedBursts(p: ProcessRuntime): number {
    let n = 0;
    for (let i = 0; i < p.phaseIndex; i++) if (p.def.phases[i].type === "CPU") n++;
    return n;
  }

  function closeGanttInterval(endTime: number, endedByQuantum: boolean, endedByBurst: boolean): void {
    if (cpu.processId !== null && endTime > cpu.intervalStart) {
      gantt.push({
        start: cpu.intervalStart,
        end: endTime,
        processId: cpu.processId,
        endedByQuantumExpiry: endedByQuantum,
        endedByBurstComplete: endedByBurst,
      });
    }
  }

  function removeFromReady(pid: string): void {
    const idx = readyQueue.indexOf(pid);
    if (idx >= 0) readyQueue.splice(idx, 1);
  }

  function enterReady(pid: string, at: number): void {
    const p = procs.get(pid)!;
    transitionState(p.state, "READY");
    p.state = "READY";
    p.readySince = at;
    readyQueue.push(pid);
  }

  function leaveReady(pid: string, at: number): void {
    const p = procs.get(pid)!;
    if (p.readySince !== null) {
      p.readyWaitTime += at - p.readySince;
      p.readySince = null;
    }
    removeFromReady(pid);
  }

  function dispatch(time: number): void {
    const selection = scheduler.selectProcess(time, readyViews());
    if (selection.processId === null) {
      throw new Error(`Scheduler returned no process at t=${time} with non-empty ready queue`);
    }
    const pid = selection.processId;
    const p = procs.get(pid);
    if (!p || p.state !== "READY") {
      throw new Error(`Scheduler selected non-READY process ${pid} at t=${time} (state=${p?.state})`);
    }
    leaveReady(pid, time);
    transitionState(p.state, "RUNNING");
    p.state = "RUNNING";
    if (p.firstStartTime === null) {
      p.firstStartTime = time;
    }
    cpu.processId = pid;
    cpu.quantumRemaining = selection.quantum;
    cpu.burstRemaining = p.phaseRemaining;
    cpu.intervalStart = time;
    scheduler.onDispatch(time, pid, selection.quantum);
    emit(time, "DISPATCH", selection.reason, pid, { quantum: selection.quantum });
    drainSchedulerEvents();
  }

  function handleBurstComplete(time: number): void {
    const pid = cpu.processId!;
    const p = procs.get(pid)!;
    const burstLength = p.def.phases[p.phaseIndex].duration;
    closeGanttInterval(time, false, true);
    // Advance phase pointer past the completed CPU phase.
    p.phaseIndex++;
    const hasNext = p.phaseIndex < p.def.phases.length;
    const nextPhase = hasNext ? p.def.phases[p.phaseIndex] : null;
    const enteredIO = nextPhase !== null && nextPhase.type === "IO";

    scheduler.onBurstComplete(time, pid, burstLength, enteredIO);
    emit(
      time,
      "CPU_BURST_COMPLETE",
      enteredIO
        ? `CPU burst of ${burstLength} completed; blocking for IO (${nextPhase!.duration} ticks)`
        : `CPU burst of ${burstLength} completed`,
      pid,
      { burstLength, enteredIO },
    );
    drainSchedulerEvents();

    cpu.processId = null;
    cpu.quantumRemaining = 0;
    cpu.burstRemaining = 0;

    if (!hasNext) {
      transitionState(p.state, "TERMINATED");
      p.state = "TERMINATED";
      p.completionTime = time;
      scheduler.onProcessEnd(time, pid);
      emit(time, "PROCESS_TERMINATED", "all phases completed", pid);
      return;
    }

    if (enteredIO) {
      transitionState(p.state, "BLOCKED");
      p.state = "BLOCKED";
      p.phaseRemaining = nextPhase!.duration;
      p.blockedSince = time;
      eventQueue.push({ time: time + nextPhase!.duration, type: "IO_COMPLETE", processId: pid });
      emit(
        time,
        "IO_START",
        `blocked for IO (${nextPhase!.duration} ticks)`,
        pid,
        { ioDuration: nextPhase!.duration },
      );
      return;
    }

    // Consecutive CPU phase: process stays RUNNING with the new burst.
    p.phaseRemaining = nextPhase!.duration;
    cpu.burstRemaining = nextPhase!.duration;
    // If the quantum is also exhausted, requeue right away (handled at
    // the decision-point ordering: quantum check runs after burst check
    // in the same instant when both are zero).
    if (cpu.quantumRemaining <= 0) {
      requeueAfterQuantum(time, pid);
    } else {
      cpu.intervalStart = time;
    }
  }

  function requeueAfterQuantum(time: number, pid: string): void {
    closeGanttInterval(time, true, false);
    cpu.processId = null;
    cpu.quantumRemaining = 0;
    scheduler.onQuantumExpired(time, pid);
    enterReady(pid, time);
    emit(
      time,
      "QUANTUM_EXPIRED",
      "quantum expired: returned to ready queue",
      pid,
    );
    drainSchedulerEvents();
  }

  function handleIOComplete(time: number, pid: string): void {
    const p = procs.get(pid)!;
    if (p.state !== "BLOCKED") {
      throw new Error(`IO_COMPLETE for ${pid} in state ${p.state} at t=${time}`);
    }
    const ioWait = p.blockedSince !== null ? time - p.blockedSince : 0;
    p.ioBlockedTime += ioWait;
    p.blockedSince = null;
    // The blocked phase is the IO phase at phaseIndex; advance past it.
    p.phaseIndex++;
    scheduler.onIOComplete(time, pid, ioWait);
    emit(time, "IO_COMPLETE", `IO completed after ${ioWait} ticks; process READY`, pid, {
      ioWait,
    });
    drainSchedulerEvents();

    const next = p.phaseIndex < p.def.phases.length ? p.def.phases[p.phaseIndex] : null;
    if (next === null) {
      // Workload ends with an IO phase: nothing left to execute.
      transitionState(p.state, "TERMINATED");
      p.state = "TERMINATED";
      p.completionTime = time;
      scheduler.onProcessEnd(time, pid);
      emit(time, "PROCESS_TERMINATED", "all phases completed (ended with IO)", pid);
      return;
    }
    if (next.type === "IO") {
      // Consecutive IO phases: remain BLOCKED and schedule the next one.
      p.phaseRemaining = next.duration;
      p.blockedSince = time;
      eventQueue.push({ time: time + next.duration, type: "IO_COMPLETE", processId: pid });
      emit(time, "IO_START", `blocked again for IO (${next.duration} ticks)`, pid, {
        ioDuration: next.duration,
      });
      return;
    }
    transitionState(p.state, "READY");
    p.state = "READY";
    p.readySince = time;
    p.phaseRemaining = next.duration;
    readyQueue.push(pid);
  }

  function handleArrival(time: number, pid: string): void {
    const p = procs.get(pid)!;
    if (p.state !== "NEW") {
      throw new Error(`PROCESS_ARRIVAL for ${pid} in state ${p.state} at t=${time}`);
    }
    transitionState(p.state, "READY");
    p.state = "READY";
    p.readySince = time;
    readyQueue.push(pid);
    scheduler.onArrival(time, pid);
    emit(time, "PROCESS_ARRIVAL", "arrived; entered ready queue", pid);
  }

  function handlePreemption(time: number, reason: string): void {
    const pid = cpu.processId!;
    closeGanttInterval(time, false, false);
    cpu.processId = null;
    cpu.quantumRemaining = 0;
    enterReady(pid, time);
    emit(time, "PREEMPTION", reason, pid);
  }

  function idleJump(nextTime: number): void {
    emit(
      time,
      "IDLE_INTERVAL",
      `CPU idle from t=${time} to t=${nextTime} (no ready processes)`,
      undefined,
      { duration: nextTime - time },
    );
    time = nextTime;
  }

  // ---- main loop ----
  while (!allTerminated()) {
    if (time > ENGINE_LIMITS.maxTime) {
      throw new Error(`Simulation aborted: exceeded maximum time (${ENGINE_LIMITS.maxTime}).`);
    }

    if (cpu.processId === null) {
      // Process ALL exogenous events at the current time first.
      const pending = eventQueue.drainAtTime(time);
      // IO completions before arrivals: heap order guarantees that.
      // Within each type, processId order is guaranteed.
      // Arrival order across different processes: heap uses processId;
      // for workload-order determinism at identical arrival times we
      // re-sort arrivals by original workload index.
      const ioEvents = pending.filter((e) => e.type === "IO_COMPLETE");
      const arrivalEvents = pending
        .filter((e) => e.type === "PROCESS_ARRIVAL")
        .sort(
          (a, b) =>
            (workloadOrder.get(a.processId) ?? 0) - (workloadOrder.get(b.processId) ?? 0),
        );
      for (const e of ioEvents) handleIOComplete(e.time, e.processId);
      for (const e of arrivalEvents) handleArrival(e.time, e.processId);

      if (readyQueue.length > 0) {
        dispatch(time);
        continue;
      }

      const nextEventTime = eventQueue.nextTime();
      if (nextEventTime === Infinity) {
        // No ready processes, no pending events, CPU idle. If every
        // process is terminated we are done; otherwise the workload is
        // unschedulable (should not happen with validated inputs).
        if (allTerminated()) break;
        const unfinished = [...procs.values()].filter((p) => p.state !== "TERMINATED");
        throw new Error(
          `Simulation stalled at t=${time}: unfinished processes ${unfinished
            .map((p) => `${p.def.id}(${p.state})`)
            .join(", ")} with empty ready queue and no pending events`,
        );
      }
      idleJump(nextEventTime);
      continue;
    }

    // CPU is running: advance to the next decision point.
    const pid = cpu.processId;
    const p = procs.get(pid)!;

    // Ensure burstRemaining is synced (it is maintained on phase change).
    if (cpu.burstRemaining !== p.phaseRemaining) {
      // Keep them in sync defensively.
      cpu.burstRemaining = p.phaseRemaining;
    }

    const nextEventTime = eventQueue.nextTime();
    const dtQuantum = cpu.quantumRemaining;
    const dtBurst = cpu.burstRemaining;
    const dtEvent = nextEventTime - time;
    const dt = Math.min(dtQuantum, dtBurst, dtEvent);

    if (dt <= 0) {
      // Zero-length step: handle instant transitions without advancing.
      // Order: burst completion → exogenous events → quantum expiry → preemption.
      if (dtBurst === 0) {
        p.phaseRemaining = 0;
        handleBurstComplete(time);
        if (cpu.processId !== null) continue; // consecutive-CPU continuation
        // fall through to idle/dispatch handling below via loop top
        continue;
      }
      if (dtEvent === 0) {
        const pending = eventQueue.drainAtTime(time);
        const ioEvents = pending.filter((e) => e.type === "IO_COMPLETE");
        const arrivalEvents = pending
          .filter((e) => e.type === "PROCESS_ARRIVAL")
          .sort(
            (a, b) =>
              (workloadOrder.get(a.processId) ?? 0) - (workloadOrder.get(b.processId) ?? 0),
          );
        for (const e of ioEvents) handleIOComplete(e.time, e.processId);
        for (const e of arrivalEvents) handleArrival(e.time, e.processId);
        if (cpu.processId === null) continue;
      }
      if (dtQuantum === 0 && cpu.processId !== null) {
        // Quantum expired and burst not done: mandatory requeue.
        requeueAfterQuantum(time, pid);
        continue;
      }
      // Should not reach here with dt<=0 and a running CPU.
      throw new Error(`Simulation made no progress at t=${time} for process ${pid}`);
    }

    // Advance time by dt, accruing CPU service and phase/quantum remainders.
    time += dt;
    p.phaseRemaining -= dt;
    cpu.burstRemaining -= dt;
    cpu.quantumRemaining -= dt;
    p.cpuService += dt;
    scheduler.onCpuExecuted(time, pid, dt);

    const burstDone = p.phaseRemaining === 0;
    const eventDue = eventQueue.nextTime() === time;

    // Spec order at time t: (1) phase completions, (2) IO/arrivals,
    // (3) observations, (4) ready updates, (5) quantum/preemption,
    // (6) dispatch.
    if (burstDone) {
      handleBurstComplete(time);
      // If process continues on a consecutive CPU phase, also check quantum.
      if (cpu.processId !== null && cpu.quantumRemaining === 0) {
        requeueAfterQuantum(time, cpu.processId);
      }
    }

    // Exogenous events at t.
    if (eventDue) {
      const pending = eventQueue.drainAtTime(time);
      const ioEvents = pending.filter((e) => e.type === "IO_COMPLETE");
      const arrivalEvents = pending
        .filter((e) => e.type === "PROCESS_ARRIVAL")
        .sort(
          (a, b) =>
            (workloadOrder.get(a.processId) ?? 0) - (workloadOrder.get(b.processId) ?? 0),
        );
      for (const e of ioEvents) handleIOComplete(e.time, e.processId);
      for (const e of arrivalEvents) handleArrival(e.time, e.processId);

      // Preemption check: only if the process is still running (not
      // already requeued due to quantum expiry / burst completion).
      if (cpu.processId !== null && readyQueue.length > 0) {
        const decision = scheduler.shouldPreempt(time, cpu.processId, readyViews());
        if (decision.preempt) {
          handlePreemption(time, decision.reason);
        }
      }
    }

    // Quantum expiry for a still-running process.
    if (cpu.processId !== null && cpu.quantumRemaining === 0) {
      if (p.phaseRemaining > 0) {
        requeueAfterQuantum(time, pid);
      }
      // If phaseRemaining === 0, burstDone handled it above.
    }

    // Close the current Gantt interval if occupancy changed.
    if (cpu.processId !== null && cpu.intervalStart !== time && burstDone) {
      // handleBurstComplete already closed; consecutive CPU restarts interval.
    }
  }

  // Close any trailing idle as part of measurement via last events.

  const processFinalStates: ProcessFinalState[] = workload.processes.map((def) => {
    const p = procs.get(def.id)!;
    return {
      id: p.def.id,
      state: p.state,
      arrivalTime: p.def.arrivalTime,
      firstStartTime: p.firstStartTime,
      completionTime: p.completionTime,
      cpuService: p.cpuService,
      totalCpuDemand: p.totalCpuDemand,
      readyWaitTime: p.readyWaitTime,
      ioBlockedTime: p.ioBlockedTime,
      completed: p.state === "TERMINATED",
    };
  });

  const metrics = computeMetrics(processFinalStates, events, {
    transitionTimes: workload.evaluationOnlyTransitionTimes,
  });

  const behaviourHistory =
    typeof scheduler.getBehaviourHistory === "function"
      ? scheduler.getBehaviourHistory()
      : [];

  const decisionRecords =
    typeof scheduler.getDecisionRecords === "function"
      ? scheduler.getDecisionRecords()
      : [];

  return {
    runId: deterministicRunId(algorithm, workload.name, config),
    algorithm,
    workloadName: workload.name,
    events,
    gantt,
    processFinalStates,
    processMetrics: buildProcessMetricsRows(processFinalStates),
    metrics,
    behaviourHistory,
    decisionRecords,
    completed: true,
  };
}
