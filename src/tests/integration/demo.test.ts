import { describe, expect, it } from "vitest";
import {
  runDemoComparison,
  extractDecisionPoints,
  buildComparisonSentence,
  computeMetricDeltas,
  pctChange,
  bestAlgorithmForMetric,
  runConfigComparison,
  diffAbcsConfig,
} from "@/lib/demo/compare";
import { getDemoWorkload, listDemoWorkloads } from "@/lib/workloads/demo";

describe("demo workloads", () => {
  it("lists exactly four demo workloads", () => {
    const list = listDemoWorkloads();
    expect(list).toHaveLength(4);
    expect(list.map((w) => w.id).sort()).toEqual([
      "changing",
      "cpu-heavy",
      "io-heavy",
      "mixed",
    ]);
  });

  it("returns isolated deep copies", () => {
    const a = getDemoWorkload("mixed");
    const b = getDemoWorkload("mixed");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    expect(a?.processes).not.toBe(b?.processes);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("runDemoComparison", () => {
  const workload = getDemoWorkload("changing");
  if (!workload) throw new Error("missing changing workload");
  const results = runDemoComparison(workload);

  it("runs all three algorithms on the same process set", () => {
    expect(results.RR.algorithm).toBe("RR");
    expect(results.MLFQ.algorithm).toBe("MLFQ");
    expect(results.ABCS.algorithm).toBe("ABCS");
    expect(results.processIds.length).toBeGreaterThan(0);
    for (const id of results.processIds) {
      expect(results.RR.processFinalStates.some((p) => p.id === id)).toBe(true);
      expect(results.MLFQ.processFinalStates.some((p) => p.id === id)).toBe(true);
      expect(results.ABCS.processFinalStates.some((p) => p.id === id)).toBe(true);
    }
  });

  it("computes a positive shared duration", () => {
    expect(results.duration).toBeGreaterThan(0);
  });

  it("is deterministic — same workload gives identical metrics", () => {
    const again = runDemoComparison(getDemoWorkload("changing")!);
    expect(again.RR.metrics.avgResponseTime).toBe(results.RR.metrics.avgResponseTime);
    expect(again.MLFQ.metrics.avgWaitingTime).toBe(results.MLFQ.metrics.avgWaitingTime);
    expect(again.ABCS.metrics.avgTurnaroundTime).toBe(results.ABCS.metrics.avgTurnaroundTime);
  });

  it("completes every process on the changing workload", () => {
    for (const r of [results.RR, results.MLFQ, results.ABCS]) {
      expect(r.metrics.completedCount).toBe(r.metrics.processCount);
    }
  });
});

describe("extractDecisionPoints", () => {
  const workload = getDemoWorkload("mixed")!;
  const results = runDemoComparison(workload);
  const points = extractDecisionPoints(results);

  it("produces at least one decision point", () => {
    expect(points.length).toBeGreaterThan(0);
  });

  it("indexes are sequential and times strictly increasing", () => {
    for (let i = 0; i < points.length; i++) {
      expect(points[i].index).toBe(i);
      if (i > 0) expect(points[i].time).toBeGreaterThan(points[i - 1].time);
    }
  });

  it("each decision point has a decision for every algorithm", () => {
    for (const p of points) {
      for (const alg of ["RR", "MLFQ", "ABCS"] as const) {
        expect(["dispatch", "continuing", "idle"]).toContain(p[alg].kind);
        expect(p[alg].reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("at least one RR decision is a fresh dispatch with a reason mentioning FIFO", () => {
    const dispatches = points.filter((p) => p.RR.kind === "dispatch");
    expect(dispatches.length).toBeGreaterThan(0);
    expect(dispatches[0].RR.reason).toMatch(/FIFO|ready queue/i);
  });

  it("ABCS detail is present for ABCS dispatch points", () => {
    const abcsDispatches = points.filter((p) => p.ABCS.kind === "dispatch");
    expect(abcsDispatches.length).toBeGreaterThan(0);
    expect(abcsDispatches[0].abcsDetail).not.toBeNull();
  });
});

describe("comparison sentence & deltas", () => {
  const workload = getDemoWorkload("mixed")!;
  const results = runDemoComparison(workload);

  it("builds a non-empty honest sentence from actual numbers", () => {
    const s = buildComparisonSentence(results);
    expect(s.length).toBeGreaterThan(0);
    expect(s).toMatch(/Round Robin|about the same|reduced|increased/);
  });

  it("pctChange handles edge cases", () => {
    expect(pctChange(10, 8)).toBeCloseTo(-20);
    expect(pctChange(10, 12)).toBeCloseTo(20);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(0, 5)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
    expect(pctChange(5, null)).toBeNull();
  });

  it("computeMetricDeltas returns three latency metrics", () => {
    const d = computeMetricDeltas(results);
    expect(d).toHaveLength(3);
    expect(d.map((x) => x.metric)).toEqual([
      "avgResponseTime",
      "avgWaitingTime",
      "avgTurnaroundTime",
    ]);
  });

  it("bestAlgorithmForMetric returns an algorithm or null (no hard-coded winner)", () => {
    const best = bestAlgorithmForMetric(results, "avgResponseTime");
    expect(best === null || ["RR", "MLFQ", "ABCS"].includes(best)).toBe(true);
  });
});

describe("runDemoComparison with config override", () => {
  const workload = getDemoWorkload("changing");
  if (!workload) throw new Error("missing changing workload");

  it("accepts a partial ABCS config and still completes all three algorithms", () => {
    const r = runDemoComparison(workload, { emaAlpha: 0.5, quantumMid: 6 });
    expect(r.RR.completed).toBe(true);
    expect(r.MLFQ.completed).toBe(true);
    expect(r.ABCS.completed).toBe(true);
    expect(r.ABCS.decisionRecords.length).toBeGreaterThan(0);
  });

  it("custom config does not affect RR/MLFQ baselines", () => {
    const def = runDemoComparison(getDemoWorkload("changing")!);
    const custom = runDemoComparison(getDemoWorkload("changing")!, { emaAlpha: 0.9 });
    expect(custom.RR.metrics.avgResponseTime).toBe(def.RR.metrics.avgResponseTime);
    expect(custom.MLFQ.metrics.avgWaitingTime).toBe(def.MLFQ.metrics.avgWaitingTime);
    // ABCS may differ (different EMA smoothing) — determinism for same config:
    const again = runDemoComparison(getDemoWorkload("changing")!, { emaAlpha: 0.9 });
    expect(again.ABCS.metrics.avgResponseTime).toBe(custom.ABCS.metrics.avgResponseTime);
  });
});

describe("runConfigComparison", () => {
  const workload = getDemoWorkload("changing");
  if (!workload) throw new Error("missing changing workload");

  it("runs default and custom ABCS and reports changed params", () => {
    const cmp = runConfigComparison(workload, { emaAlpha: 0.5, priorityBehaviorWeight: 50 });
    expect(cmp.defaultResults.ABCS.completed).toBe(true);
    expect(cmp.customResults.ABCS.completed).toBe(true);
    expect(cmp.changedParams.length).toBe(2);
    expect(cmp.changedParams.map((c) => c.key).sort()).toEqual([
      "emaAlpha",
      "priorityBehaviorWeight",
    ]);
    // RR/MLFQ baselines identical between default and custom.
    expect(cmp.customResults.RR.metrics.avgResponseTime).toBe(
      cmp.defaultResults.RR.metrics.avgResponseTime,
    );
    expect(cmp.customResults.MLFQ.metrics.avgTurnaroundTime).toBe(
      cmp.defaultResults.MLFQ.metrics.avgTurnaroundTime,
    );
  });
});

describe("diffAbcsConfig", () => {
  it("returns empty for empty or identical-to-default input", () => {
    expect(diffAbcsConfig({})).toEqual([]);
    expect(diffAbcsConfig({ emaAlpha: 0.3 })).toEqual([]);
  });

  it("reports only differing numeric keys", () => {
    const d = diffAbcsConfig({ emaAlpha: 0.5, quantumMid: 6 });
    expect(d).toHaveLength(2);
    expect(d.find((x) => x.key === "emaAlpha")?.from).toBe(0.3);
    expect(d.find((x) => x.key === "emaAlpha")?.to).toBe(0.5);
    expect(d.find((x) => x.key === "quantumMid")?.from).toBe(4);
    expect(d.find((x) => x.key === "quantumMid")?.to).toBe(6);
  });
});
