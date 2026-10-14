import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/simulation/engine";
import type { SimulationResult, Workload } from "@/lib/model/types";
import { assertValidWorkload } from "@/lib/model/validation";

function wl(processes: Workload["processes"], name = "test"): Workload {
  return assertValidWorkload({ name, processes });
}

function invariants(result: SimulationResult, workload: Workload): void {
  const totalDemand = new Map(
    workload.processes.map((p) => [
      p.id,
      p.phases.filter((ph) => ph.type === "CPU").reduce((a, ph) => a + ph.duration, 0),
    ]),
  );
  let lastTime = -1;
  for (const e of result.events) {
    expect(e.time).toBeGreaterThanOrEqual(lastTime);
    lastTime = e.time;
  }
  // At most one process per dispatch instant (engine serializes).
  for (const f of result.processFinalStates) {
    expect(f.cpuService).toBeLessThanOrEqual(totalDemand.get(f.id)!);
    if (f.completed) {
      expect(f.state).toBe("TERMINATED");
      expect(f.firstStartTime).not.toBeNull();
      expect(f.completionTime).not.toBeNull();
      expect(f.cpuService).toBe(totalDemand.get(f.id)!);
    }
  }
  // Gantt intervals: non-overlapping, within [0, makespan], processId null only for idle (we don't emit idle gantt intervals).
  let prevEnd = 0;
  for (const g of result.gantt) {
    expect(g.start).toBeGreaterThanOrEqual(prevEnd === 0 ? 0 : g.start);
    expect(g.end).toBeGreaterThan(g.start);
    expect(g.processId).not.toBeNull();
    prevEnd = g.end;
  }
  // Busy time equals sum of gantt durations equals sum of CPU service.
  const ganttBusy = result.gantt.reduce((a, g) => a + (g.end - g.start), 0);
  const serviceSum = result.processFinalStates.reduce((a, f) => a + f.cpuService, 0);
  expect(ganttBusy).toBe(serviceSum);
  expect(result.metrics.busyTime).toBe(serviceSum);
  // At most one process RUNNING at any instant (checked via gantt overlap).
  const sorted = [...result.gantt].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
  }
}

describe("RR engine integration", () => {
  it("runs a single-process workload to completion (hand-calculated)", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 5 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 2 });

    expect(result.completed).toBe(true);
    // P1 runs [0,2), quantum expires → requeue → [2,4) → requeue → [4,5).
    expect(result.gantt).toEqual([
      { start: 0, end: 2, processId: "P1", endedByQuantumExpiry: true, endedByBurstComplete: false },
      { start: 2, end: 4, processId: "P1", endedByQuantumExpiry: true, endedByBurstComplete: false },
      { start: 4, end: 5, processId: "P1", endedByQuantumExpiry: false, endedByBurstComplete: true },
    ]);
    const p1 = result.processFinalStates[0];
    expect(p1.firstStartTime).toBe(0);
    expect(p1.completionTime).toBe(5);
    expect(p1.cpuService).toBe(5);
    // Requeues at t=2 and t=4 dispatch immediately at the same tick → 0 ready wait.
    expect(p1.readyWaitTime).toBe(0);
    expect(result.metrics.avgResponseTime).toBe(0);
    expect(result.metrics.avgTurnaroundTime).toBe(5);
    expect(result.metrics.contextSwitches).toBe(3);
    invariants(result, workload);
  });

  it("two processes: FIFO with quantum interleaving (hand-calculated)", () => {
    // P1: 4 CPU @0, P2: 4 CPU @0, quantum 2.
    // t=0: dispatch P1 [0,2). t=2: QE, P1 requeue → ready=[P2,P1], dispatch P2 [2,4).
    // t=4: QE, P2 requeue → ready=[P1,P2], dispatch P1 [4,6). t=6: burst done (4 total).
    // t=6: dispatch P2 [6,8). t=8: burst done.
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 4 }] },
      { id: "P2", arrivalTime: 0, phases: [{ type: "CPU", duration: 4 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 2 });
    expect(result.gantt).toEqual([
      { start: 0, end: 2, processId: "P1", endedByQuantumExpiry: true, endedByBurstComplete: false },
      { start: 2, end: 4, processId: "P2", endedByQuantumExpiry: true, endedByBurstComplete: false },
      { start: 4, end: 6, processId: "P1", endedByQuantumExpiry: false, endedByBurstComplete: true },
      { start: 6, end: 8, processId: "P2", endedByQuantumExpiry: false, endedByBurstComplete: true },
    ]);
    const p1 = result.processFinalStates.find((f) => f.id === "P1")!;
    const p2 = result.processFinalStates.find((f) => f.id === "P2")!;
    const m1 = result.processMetrics.find((m) => m.id === "P1")!;
    const m2 = result.processMetrics.find((m) => m.id === "P2")!;
    // P1: ready [0,2) wait=0 (dispatched at 0), wait after QE at 2 until 4 = 2.
    expect(p1.readyWaitTime).toBe(2);
    expect(m1.responseTime).toBe(0);
    // P2 arrives 0, dispatched at 2 → response 2, wait 2.
    expect(p2.firstStartTime).toBe(2);
    expect(m2.responseTime).toBe(2);
    invariants(result, workload);
  });

  it("IO blocking: process blocks and resumes after IO (RR does not preempt on IO completion)", () => {
    // P1: CPU 2, IO 3, CPU 2; P2: CPU 4 @0; quantum 2.
    // t=0: dispatch P1 [0,2) burst done → BLOCKED until t=5. dispatch P2 [2,4) QE → requeue.
    // t=4: P1 still blocked → dispatch P2 [4,6) burst done (4/4).
    //      At t=5 P1's IO completes and it becomes READY, but RR never
    //      preempts on IO completion — P2 keeps the CPU until t=6.
    // t=6: dispatch P1 [6,8) burst done. P1 completes at 8.
    const workload = wl([
      {
        id: "P1",
        arrivalTime: 0,
        phases: [
          { type: "CPU", duration: 2 },
          { type: "IO", duration: 3 },
          { type: "CPU", duration: 2 },
        ],
      },
      { id: "P2", arrivalTime: 0, phases: [{ type: "CPU", duration: 4 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 2 });
    expect(result.completed).toBe(true);
    const p1 = result.processFinalStates.find((f) => f.id === "P1")!;
    expect(p1.ioBlockedTime).toBe(3);
    expect(p1.cpuService).toBe(4);
    expect(p1.completionTime).toBe(8);
    const p2 = result.processFinalStates.find((f) => f.id === "P2")!;
    expect(p2.completionTime).toBe(6);
    // The CPU is never idle in this trace: P1[0,2) P2[2,4) P2[4,6) P1[6,8).
    const idle = result.events.filter((e) => e.type === "IDLE_INTERVAL");
    expect(idle.length).toBe(0);
    invariants(result, workload);
  });

  it("deterministic same-time ordering: arrivals at t=0 use workload order", () => {
    const workload = wl([
      { id: "B", arrivalTime: 0, phases: [{ type: "CPU", duration: 1 }] },
      { id: "A", arrivalTime: 0, phases: [{ type: "CPU", duration: 1 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 1 });
    // B is first in the workload, so it runs first despite id ordering.
    expect(result.gantt[0].processId).toBe("B");
    expect(result.gantt[1].processId).toBe("A");
  });

  it("does not mutate the input workload", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 3 }] },
    ]);
    const snapshot = JSON.parse(JSON.stringify(workload));
    runSimulation(workload, { algorithm: "RR", rrQuantum: 1 });
    expect(JSON.parse(JSON.stringify(workload))).toEqual(snapshot);
  });

  it("same inputs produce identical output (determinism)", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 5 }, { type: "IO", duration: 2 }, { type: "CPU", duration: 3 }] },
      { id: "P2", arrivalTime: 1, phases: [{ type: "CPU", duration: 4 }] },
      { id: "P3", arrivalTime: 2, phases: [{ type: "CPU", duration: 2 }] },
    ]);
    const a = runSimulation(workload, { algorithm: "RR", rrQuantum: 2 });
    const b = runSimulation(workload, { algorithm: "RR", rrQuantum: 2 });
    expect(a).toEqual(b);
  });

  it("empty ready queue → IDLE_INTERVAL then arrival resumes", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 5, phases: [{ type: "CPU", duration: 3 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 4 });
    const idle = result.events.find((e) => e.type === "IDLE_INTERVAL");
    expect(idle).toBeDefined();
    expect(idle!.time).toBe(0);
    expect(result.gantt[0]).toMatchObject({ start: 5, end: 8, processId: "P1" });
    // Measurement interval starts at the first arrival (t=5): busy 3 / elapsed 3.
    expect(result.metrics.measurementStart).toBe(5);
    expect(result.metrics.cpuUtilization).toBeCloseTo(1);
    // The pre-arrival idle is still recorded as an event.
    expect(idle!.metadata?.duration).toBe(5);
  });

  it("mid-workload idle gap reduces CPU utilization", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 2 }] },
      { id: "P2", arrivalTime: 10, phases: [{ type: "CPU", duration: 2 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 4 });
    // Busy 4, measurement [0, 12), util = 4/12.
    expect(result.metrics.busyTime).toBe(4);
    expect(result.metrics.measurementEnd).toBe(12);
    expect(result.metrics.cpuUtilization).toBeCloseTo(4 / 12);
    const idle = result.events.find((e) => e.type === "IDLE_INTERVAL");
    expect(idle).toBeDefined();
  });

  it("BLOCKED and TERMINATED processes never run (via event log)", () => {
    const workload = wl([
      {
        id: "P1",
        arrivalTime: 0,
        phases: [
          { type: "CPU", duration: 1 },
          { type: "IO", duration: 4 },
          { type: "CPU", duration: 1 },
        ],
      },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 1 });
    let state = "NEW";
    for (const e of result.events) {
      if (e.type === "PROCESS_ARRIVAL") state = "READY";
      if (e.type === "DISPATCH") {
        expect(state).not.toBe("BLOCKED");
        expect(state).not.toBe("TERMINATED");
        state = "RUNNING";
      }
      if (e.type === "CPU_BURST_COMPLETE") state = "BLOCKED"; // this workload blocks after first burst
      if (e.type === "IO_COMPLETE") state = "READY";
      if (e.type === "PROCESS_TERMINATED") state = "TERMINATED";
    }
    expect(state).toBe("TERMINATED");
  });

  it("burst longer than quantum yields multiple quanta slices", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 7 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "RR", rrQuantum: 3 });
    // [0,3) [3,6) [6,7)
    expect(result.gantt.map((g) => [g.start, g.end])).toEqual([
      [0, 3],
      [3, 6],
      [6, 7],
    ]);
    expect(result.gantt[2].endedByBurstComplete).toBe(true);
  });
});
