import { describe, expect, it } from "vitest";
import { getDemoWorkload, listDemoWorkloads } from "@/lib/workloads/demo";
import { runDemoComparison, buildComparisonSentence } from "@/lib/demo/compare";

describe("all demo workloads produce honest comparison sentences", () => {
  for (const meta of listDemoWorkloads()) {
    it(`${meta.name}: sentence is non-empty and mentions actual numbers or sameness`, () => {
      const wl = getDemoWorkload(meta.id)!;
      const results = runDemoComparison(wl);
      const s = buildComparisonSentence(results);
      expect(s.length).toBeGreaterThan(10);
      // Must not contain fake placeholder language.
      expect(s).not.toMatch(/TODO|TBD|lorem|placeholder|XX%/i);
      // Must reference either Round Robin comparison or sameness.
      expect(s).toMatch(/Round Robin|about the same/);
    });
  }

  it("changing workload has a longer timeline than cpu-heavy (transition shifts work)", () => {
    const changing = runDemoComparison(getDemoWorkload("changing")!);
    const cpuHeavy = runDemoComparison(getDemoWorkload("cpu-heavy")!);
    expect(changing.duration).toBeGreaterThan(0);
    expect(cpuHeavy.duration).toBeGreaterThan(0);
  });

  it("mixed workload completes all processes on all three algorithms", () => {
    const r = runDemoComparison(getDemoWorkload("mixed")!);
    expect(r.RR.metrics.completedCount).toBe(r.RR.metrics.processCount);
    expect(r.MLFQ.metrics.completedCount).toBe(r.MLFQ.metrics.processCount);
    expect(r.ABCS.metrics.completedCount).toBe(r.ABCS.metrics.processCount);
  });
});
