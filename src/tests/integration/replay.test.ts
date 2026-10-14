import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/simulation/engine";
import { getScenarioWorkload } from "@/lib/workloads/builtIn";
import { ReplayTimeline } from "@/lib/simulation/replay";

function runMixed(algorithm: "RR" | "MLFQ" | "ABCS") {
  const workload = getScenarioWorkload("mixed");
  if (!workload) throw new Error("missing mixed scenario");
  return runSimulation(workload, { algorithm });
}

describe("ReplayTimeline", () => {
  it("produces monotonic times and a final duration", () => {
    const result = runMixed("RR");
    const tl = new ReplayTimeline(result);
    expect(tl.times.length).toBeGreaterThan(1);
    for (let i = 1; i < tl.times.length; i++) {
      expect(tl.times[i]).toBeGreaterThanOrEqual(tl.times[i - 1]);
    }
    expect(tl.duration).toBe(result.events[result.events.length - 1].time);
  });

  it("snapshots match process states at known event boundaries", () => {
    const result = runMixed("RR");
    const tl = new ReplayTimeline(result);
    for (const e of result.events) {
      const snap = tl.stateAt(e.time);
      expect(snap.time).toBe(e.time);
      if (e.processId) {
        expect(snap.processes[e.processId]).toBeDefined();
      }
    }
  });

  it("terminates all processes at the end of the timeline", () => {
    const result = runMixed("ABCS");
    const tl = new ReplayTimeline(result);
    const final = tl.stateAt(tl.duration);
    for (const p of Object.values(final.processes)) {
      expect(p.state).toBe("TERMINATED");
      expect(p.cpuService).toBe(p.totalCpuDemand);
    }
  });

  it("stateAt with a mid-time returns the nearest earlier snapshot", () => {
    const result = runMixed("MLFQ");
    const tl = new ReplayTimeline(result);
    const mid = Math.floor(tl.duration / 2);
    const snap = tl.stateAt(mid);
    expect(snap.time).toBeLessThanOrEqual(mid);
  });

  it("nextTransitionAfter finds later transition times only", () => {
    const result = runMixed("ABCS");
    const tl = new ReplayTimeline(result);
    if (tl.transitions.length > 0) {
      const first = tl.transitions[0];
      expect(tl.nextTransitionAfter(first - 1)).toBe(first);
      expect(tl.nextTransitionAfter(tl.duration)).toBeNull();
    }
  });
});
