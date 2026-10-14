import { describe, expect, it } from "vitest";
import {
  buildProcessMetricsRows,
  computeMetrics,
  countContextSwitches,
  jainFairnessIndex,
  mean,
  median,
  percentile,
} from "@/lib/simulation/metrics";
import type { ProcessFinalState, SimulationEvent } from "@/lib/model/types";

function final(
  over: Partial<ProcessFinalState> & { id: string },
): ProcessFinalState {
  return {
    state: "TERMINATED",
    arrivalTime: 0,
    firstStartTime: 0,
    completionTime: 10,
    cpuService: 10,
    totalCpuDemand: 10,
    readyWaitTime: 0,
    ioBlockedTime: 0,
    completed: true,
    ...over,
  };
}

function ev(time: number, type: SimulationEvent["type"]): SimulationEvent {
  return { time, type, algorithm: "RR", reason: "test" };
}

describe("statistical helpers", () => {
  it("mean of empty is null", () => {
    expect(mean([])).toBeNull();
  });
  it("mean averages values", () => {
    expect(mean([1, 2, 3])).toBe(2);
  });
  it("median of odd/even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("percentile p95 interpolates", () => {
    const sorted = [1, 2, 3, 4, 5];
    expect(percentile(sorted, 95)).toBeCloseTo(4.8);
    expect(percentile([], 95)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("jainFairnessIndex", () => {
  it("is 1 when all shares are equal", () => {
    expect(jainFairnessIndex([1, 1, 1])).toBeCloseTo(1);
    expect(jainFairnessIndex([0.5, 0.5])).toBeCloseTo(1);
  });
  it("is lower when shares are unequal", () => {
    const idx = jainFairnessIndex([1, 0]);
    expect(idx).toBeCloseTo(0.5);
  });
  it("is null for empty input or all zeros", () => {
    expect(jainFairnessIndex([])).toBeNull();
    expect(jainFairnessIndex([0, 0])).toBeNull();
  });
});

describe("computeMetrics", () => {
  it("computes response/turnaround/waiting per definitions", () => {
    // P1: arrival 0, starts 2, completes 12 → response 2, turnaround 12, wait 2
    // P2: arrival 0, starts 0, completes 5 → response 0, turnaround 5, wait 0
    const finals = [
      final({
        id: "P1",
        arrivalTime: 0,
        firstStartTime: 2,
        completionTime: 12,
        cpuService: 10,
        readyWaitTime: 2,
      }),
      final({
        id: "P2",
        arrivalTime: 0,
        firstStartTime: 0,
        completionTime: 5,
        cpuService: 5,
        readyWaitTime: 0,
      }),
    ];
    const m = computeMetrics(finals, [ev(12, "PROCESS_TERMINATED")]);
    expect(m.processCount).toBe(2);
    expect(m.completedCount).toBe(2);
    expect(m.avgResponseTime).toBeCloseTo(1);
    expect(m.avgTurnaroundTime).toBeCloseTo(8.5);
    expect(m.avgWaitingTime).toBeCloseTo(1);
    expect(m.maxReadyWait).toBe(2);
    expect(m.busyTime).toBe(15);
    expect(m.incompleteCount).toBe(0);
  });

  it("handles processes that never started (response null, not silently omitted)", () => {
    const finals = [
      final({ id: "P1", firstStartTime: null, completionTime: null, completed: false, state: "READY", cpuService: 0 }),
    ];
    const m = computeMetrics(finals, []);
    expect(m.processCount).toBe(1);
    expect(m.completedCount).toBe(0);
    expect(m.incompleteCount).toBe(1);
    expect(m.avgResponseTime).toBeNull();
    const rows = buildProcessMetricsRows(finals);
    expect(rows[0].responseTime).toBeNull();
    expect(rows[0].turnaroundTime).toBeNull();
    expect(rows[0].completed).toBe(false);
  });

  it("cpu utilization = busy / elapsed", () => {
    const finals = [
      final({ id: "P1", arrivalTime: 0, firstStartTime: 0, completionTime: 10, cpuService: 10 }),
    ];
    // last event at t=10 → elapsed 10, busy 10 → util 1
    const m = computeMetrics(finals, [ev(10, "PROCESS_TERMINATED")]);
    expect(m.cpuUtilization).toBeCloseTo(1);
    expect(m.idleTime).toBe(0);
  });

  it("counts idle tail in the measurement interval", () => {
    const finals = [
      final({ id: "P1", arrivalTime: 0, firstStartTime: 0, completionTime: 5, cpuService: 5 }),
    ];
    // IDLE_INTERVAL event at t=8 extends measurement end → elapsed 8
    const m = computeMetrics(finals, [ev(5, "PROCESS_TERMINATED"), ev(8, "IDLE_INTERVAL")]);
    expect(m.measurementEnd).toBe(8);
    expect(m.busyTime).toBe(5);
    expect(m.idleTime).toBe(3);
    expect(m.cpuUtilization).toBeCloseTo(5 / 8);
  });

  it("throughput = completed / elapsed", () => {
    const finals = [
      final({ id: "P1", completionTime: 10 }),
      final({ id: "P2", completionTime: 10 }),
    ];
    const m = computeMetrics(finals, [ev(10, "PROCESS_TERMINATED")]);
    expect(m.throughput).toBeCloseTo(2 / 10);
  });

  it("fairness uses normalized CPU service shares", () => {
    // Both fully served their demand → Jain = 1
    const finals = [
      final({ id: "P1", cpuService: 10, totalCpuDemand: 10 }),
      final({ id: "P2", cpuService: 5, totalCpuDemand: 5 }),
    ];
    const m = computeMetrics(finals, [ev(10, "PROCESS_TERMINATED")]);
    expect(m.fairnessJainIndex).toBeCloseTo(1);
  });

  it("records policy-change count", () => {
    const finals = [final({ id: "P1" })];
    const m = computeMetrics(finals, [
      ev(1, "POLICY_ADJUSTMENT"),
      ev(2, "POLICY_ADJUSTMENT"),
      ev(3, "DISPATCH"),
    ]);
    expect(m.policyChangeCount).toBe(2);
  });
});

describe("countContextSwitches", () => {
  it("counts DISPATCH events (documented occupant-change rule)", () => {
    const events = [
      ev(0, "DISPATCH"),
      ev(4, "QUANTUM_EXPIRED"),
      ev(4, "DISPATCH"),
      ev(7, "CPU_BURST_COMPLETE"),
      ev(7, "IDLE_INTERVAL"),
      ev(9, "PROCESS_ARRIVAL"),
      ev(9, "DISPATCH"),
    ];
    expect(countContextSwitches(events)).toBe(3);
  });
});
