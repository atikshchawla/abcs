import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/simulation/engine";
import { MlfqScheduler, DEFAULT_MLFQ_CONFIG } from "@/lib/schedulers/mlfq";
import type { Workload } from "@/lib/model/types";
import { assertValidWorkload } from "@/lib/model/validation";

function wl(processes: Workload["processes"], name = "mlfq-test"): Workload {
  return assertValidWorkload({ name, processes });
}

describe("MlfqScheduler unit behaviour", () => {
  it("starts new processes at the top queue", () => {
    const s = new MlfqScheduler();
    s.init([{ id: "A", arrivalTime: 0 }]);
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(0);
  });

  it("demotes a process that consumes a full quantum without blocking", () => {
    const s = new MlfqScheduler();
    s.init([{ id: "A", arrivalTime: 0 }]);
    s.onQuantumExpired(2, "A");
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(1);
    s.onQuantumExpired(6, "A");
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(2);
    s.onQuantumExpired(14, "A");
    // Capped at the lowest level.
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(2);
  });

  it("boosts to top on IO block (ioBoostsToTop)", () => {
    const s = new MlfqScheduler();
    s.init([{ id: "A", arrivalTime: 0 }]);
    s.onQuantumExpired(2, "A");
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(1);
    s.onBurstComplete(4, "A", 2, true);
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(0);
  });

  it("selects from the highest non-empty queue; FIFO within level", () => {
    const s = new MlfqScheduler();
    s.init([
      { id: "A", arrivalTime: 0 },
      { id: "B", arrivalTime: 0 },
    ]);
    // Demote A so B (level 0) wins despite arriving alongside.
    s.onQuantumExpired(2, "A");
    const sel = s.selectProcess(3, [
      { id: "A", currentReadyWait: 1, totalReadyWait: 1, cpuService: 2, completedBursts: 0 },
      { id: "B", currentReadyWait: 3, totalReadyWait: 3, cpuService: 0, completedBursts: 0 },
    ]);
    expect(sel.processId).toBe("B");
    expect(sel.quantum).toBe(DEFAULT_MLFQ_CONFIG.quanta[0]);
  });

  it("preempts when a higher-level process becomes READY", () => {
    const s = new MlfqScheduler();
    s.init([
      { id: "LOW", arrivalTime: 0 },
      { id: "HIGH", arrivalTime: 1 },
    ]);
    s.onQuantumExpired(2, "LOW"); // LOW at level 1
    const decision = s.shouldPreempt(3, "LOW", [
      { id: "HIGH", currentReadyWait: 1, totalReadyWait: 1, cpuService: 0, completedBursts: 0 },
    ]);
    expect(decision.preempt).toBe(true);
  });

  it("does not preempt when no higher-level READY process exists", () => {
    const s = new MlfqScheduler();
    s.init([{ id: "A", arrivalTime: 0 }]);
    const decision = s.shouldPreempt(1, "A", [
      { id: "B", currentReadyWait: 1, totalReadyWait: 1, cpuService: 0, completedBursts: 0 },
    ]);
    expect(decision.preempt).toBe(false);
  });

  it("periodic boost returns all processes to the top queue", () => {
    const s = new MlfqScheduler({ ...DEFAULT_MLFQ_CONFIG, boostInterval: 10 });
    s.init([{ id: "A", arrivalTime: 0 }]);
    s.onQuantumExpired(2, "A");
    s.onCpuExecuted(3, "A", 2);
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(1);
    // Accumulate CPU time past the boost interval.
    for (let i = 0; i < 10; i++) s.onCpuExecuted(4 + i, "A", 1);
    s.selectProcess(20, [
      { id: "A", currentReadyWait: 5, totalReadyWait: 5, cpuService: 12, completedBursts: 2 },
    ]);
    expect(s.getProcessDisplay("A")?.queueLevel).toBe(0);
  });
});

describe("MLFQ engine integration", () => {
  it("completes a CPU-only workload and respects higher-queue priority", () => {
    const workload = wl([
      { id: "LONG", arrivalTime: 0, phases: [{ type: "CPU", duration: 10 }] },
      { id: "SHORT", arrivalTime: 1, phases: [{ type: "CPU", duration: 2 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "MLFQ" });
    expect(result.completed).toBe(true);
    // SHORT arrives at level 0 and should finish quickly, preempting LONG.
    const shortFinal = result.processFinalStates.find((f) => f.id === "SHORT")!;
    expect(shortFinal.completionTime).toBeLessThanOrEqual(5);
    // All CPU service accounted.
    const longFinal = result.processFinalStates.find((f) => f.id === "LONG")!;
    expect(longFinal.cpuService).toBe(10);
    expect(shortFinal.cpuService).toBe(2);
  });

  it("IO-heavy process stays competitive via top-queue boost", () => {
    const workload = wl([
      {
        id: "IO",
        arrivalTime: 0,
        phases: [
          { type: "CPU", duration: 1 },
          { type: "IO", duration: 2 },
          { type: "CPU", duration: 1 },
          { type: "IO", duration: 2 },
          { type: "CPU", duration: 1 },
        ],
      },
      { id: "BATCH", arrivalTime: 0, phases: [{ type: "CPU", duration: 8 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "MLFQ" });
    expect(result.completed).toBe(true);
    const io = result.processFinalStates.find((f) => f.id === "IO")!;
    // IO process total demand 3; should finish soon after its last IO at ~ t=6-7.
    expect(io.completionTime).toBeLessThanOrEqual(12);
  });

  it("is deterministic for the same workload", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 6 }, { type: "IO", duration: 2 }, { type: "CPU", duration: 4 }] },
      { id: "P2", arrivalTime: 0, phases: [{ type: "CPU", duration: 5 }] },
      { id: "P3", arrivalTime: 3, phases: [{ type: "CPU", duration: 3 }] },
    ]);
    const a = runSimulation(workload, { algorithm: "MLFQ" });
    const b = runSimulation(workload, { algorithm: "MLFQ" });
    expect(a).toEqual(b);
  });
});
