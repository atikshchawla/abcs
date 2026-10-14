import { describe, expect, it } from "vitest";
import { BUILTIN_SCENARIOS, getScenario, getScenarioWorkload, listScenarios } from "@/lib/workloads/builtIn";
import {
  DEV_SEEDS,
  HOLDOUT_SEEDS,
  generateWorkload,
  mulberry32,
} from "@/lib/workloads/generator";
import { runBenchmark, QUICK_VARIANTS, DEFAULT_VARIANTS } from "@/lib/experiments/benchmarkRunner";
import { aggregateOutcome, toRawRows, ALL_METRIC_KEYS } from "@/lib/experiments/aggregation";
import { generateReport, toCsv } from "@/lib/experiments/report";
import { runSimulation } from "@/lib/simulation/engine";
import { validateWorkload } from "@/lib/model/validation";

describe("built-in scenarios", () => {
  it("contains all 12 required scenarios", () => {
    expect(BUILTIN_SCENARIOS.length).toBe(12);
    const ids = BUILTIN_SCENARIOS.map((s) => s.id);
    expect(ids).toEqual([
      "short-jobs",
      "cpu-heavy",
      "io-heavy",
      "mixed",
      "cpu-to-io-transition",
      "io-to-cpu-transition",
      "bursty-arrivals",
      "noisy-no-transition",
      "long-job-contention",
      "starvation-stress",
      "overloaded-arrivals",
      "idle-gaps",
    ]);
  });

  it("every scenario validates and is uniquely named", () => {
    const names = new Set<string>();
    for (const s of BUILTIN_SCENARIOS) {
      const result = validateWorkload(s.workload);
      expect(result.ok, `${s.id}: ${result.errors.join("; ")}`).toBe(true);
      expect(names.has(s.name)).toBe(false);
      names.add(s.name);
      expect(s.description.length).toBeGreaterThan(10);
    }
  });

  it("transition scenarios record evaluation-only transition times", () => {
    const cpuToIo = getScenario("cpu-to-io-transition")!;
    expect(cpuToIo.workload.evaluationOnlyTransitionTimes).toEqual([20]);
    const ioToCpu = getScenario("io-to-cpu-transition")!;
    expect(ioToCpu.workload.evaluationOnlyTransitionTimes).toEqual([24]);
  });

  it("returns isolated copies (mutation-safe)", () => {
    const a = getScenarioWorkload("mixed")!;
    (a.processes[0].phases[0] as { duration: number }).duration = 9999;
    const b = getScenarioWorkload("mixed")!;
    expect(b.processes[0].phases[0].duration).not.toBe(9999);
  });

  it("every scenario completes under all three algorithms (smoke)", () => {
    for (const s of BUILTIN_SCENARIOS) {
      const w = getScenarioWorkload(s.id)!;
      for (const algorithm of ["RR", "MLFQ", "ABCS"] as const) {
        const result = runSimulation(w, { algorithm });
        expect(result.completed, `${s.id}/${algorithm}`).toBe(true);
        expect(result.metrics.completedCount, `${s.id}/${algorithm}`).toBe(
          w.processes.length,
        );
        // Total CPU service equals total demand.
        const demand = w.processes
          .flatMap((p) => p.phases)
          .filter((ph) => ph.type === "CPU")
          .reduce((a, ph) => a + ph.duration, 0);
        const service = result.processFinalStates.reduce((a, f) => a + f.cpuService, 0);
        expect(service, `${s.id}/${algorithm} service`).toBe(demand);
      }
    }
  });

  it("listScenarios exposes id/name/description", () => {
    const list = listScenarios();
    expect(list).toHaveLength(12);
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).toHaveProperty("description");
  });
});

describe("seeded generator", () => {
  it("mulberry32 is deterministic and in [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("same seed + same config → identical workload", () => {
    const cfg = { seed: 7, processCount: 10, meanArrivalGap: 2, profile: "mixed" as const, maxPhases: 5 };
    expect(generateWorkload(cfg)).toEqual(generateWorkload(cfg));
  });

  it("different seeds → different workloads (with overwhelming probability)", () => {
    const base = { processCount: 10, meanArrivalGap: 2, profile: "mixed" as const, maxPhases: 5 };
    const w1 = generateWorkload({ ...base, seed: 1 });
    const w2 = generateWorkload({ ...base, seed: 2 });
    expect(JSON.stringify(w1)).not.toBe(JSON.stringify(w2));
  });

  it("profiles produce the expected phase shapes", () => {
    const interactive = generateWorkload({ seed: 5, processCount: 4, meanArrivalGap: 1, profile: "interactive", maxPhases: 6 });
    for (const p of interactive.processes) {
      expect(p.phases.length).toBeGreaterThanOrEqual(3);
      expect(p.phases.some((ph) => ph.type === "IO")).toBe(true);
    }
    const long = generateWorkload({ seed: 5, processCount: 3, meanArrivalGap: 1, profile: "long", maxPhases: 6 });
    for (const p of long.processes) {
      expect(p.phases[0].duration).toBeGreaterThanOrEqual(20);
    }
  });

  it("dev and holdout seed sets are disjoint", () => {
    const dev = new Set(DEV_SEEDS);
    for (const s of HOLDOUT_SEEDS) expect(dev.has(s)).toBe(false);
    expect(HOLDOUT_SEEDS.length).toBeGreaterThanOrEqual(30);
  });
});

describe("benchmark runner + aggregation + report", () => {
  it("smoke: all quick variants on 3 scenarios complete and aggregate", () => {
    const scenarioIds = ["short-jobs", "mixed", "cpu-to-io-transition"];
    const outcome = runBenchmark(
      { source: { kind: "scenario", scenarioId: scenarioIds[0] }, variants: QUICK_VARIANTS },
      { seeds: [null], getScenarioWorkload },
    );
    // Run for each scenario separately and merge.
    const merged = { runs: [...outcome.runs], errors: [...outcome.errors] };
    for (const id of scenarioIds.slice(1)) {
      const o = runBenchmark(
        { source: { kind: "scenario", scenarioId: id }, variants: QUICK_VARIANTS },
        { seeds: [null], getScenarioWorkload },
      );
      merged.runs.push(...o.runs);
      merged.errors.push(...o.errors);
    }
    expect(merged.errors).toHaveLength(0);
    expect(merged.runs).toHaveLength(scenarioIds.length * QUICK_VARIANTS.length);

    const labels = Object.fromEntries(QUICK_VARIANTS.map((v) => [v.id, v.label]));
    const table = aggregateOutcome(
      { ...merged, completedAll: true },
      labels,
      "RR",
    );
    expect(table.variants).toHaveLength(3);
    for (const key of ALL_METRIC_KEYS) {
      const agg = table.variants[0].metrics[key];
      expect(agg.n).toBe(scenarioIds.length);
      expect(agg.mean).not.toBeNull();
    }
    // RR deltas vs itself are 0.
    for (const key of ALL_METRIC_KEYS) {
      expect(table.deltas["RR"]?.[key]).toBeCloseTo(0);
    }
  });

  it("generator-based multi-seed benchmark is deterministic", () => {
    const spec = {
      source: {
        kind: "generator" as const,
        generator: { seed: 0, processCount: 6, meanArrivalGap: 2, profile: "mixed" as const, maxPhases: 4 },
      },
      variants: QUICK_VARIANTS,
    };
    const opts = { seeds: [1, 2, 3], getScenarioWorkload };
    const a = runBenchmark(spec, opts);
    const b = runBenchmark(spec, opts);
    expect(a.runs.map((r) => r.result.metrics)).toEqual(b.runs.map((r) => r.result.metrics));
  });

  it("same-workload rule: variants on one seed share identical workload name and service totals", () => {
    const outcome = runBenchmark(
      {
        source: { kind: "generator", generator: { seed: 9, processCount: 5, meanArrivalGap: 2, profile: "mixed" as const, maxPhases: 4 } },
        variants: DEFAULT_VARIANTS,
      },
      { seeds: [9], getScenarioWorkload },
    );
    expect(outcome.errors).toHaveLength(0);
    const names = new Set(outcome.runs.map((r) => r.workloadName));
    expect(names.size).toBe(1);
    const services = outcome.runs.map((r) =>
      r.result.processFinalStates.reduce((s, f) => s + f.cpuService, 0),
    );
    expect(new Set(services).size).toBe(1);
  });

  it("generates a report containing real means, sample counts, and no fabricated winner", () => {
    const outcome = runBenchmark(
      { source: { kind: "scenario", scenarioId: "mixed" }, variants: QUICK_VARIANTS },
      { seeds: [null], getScenarioWorkload },
    );
    const labels = Object.fromEntries(QUICK_VARIANTS.map((v) => [v.id, v.label]));
    const table = aggregateOutcome(outcome, labels, "RR");
    const report = generateReport({
      title: "Smoke report",
      table,
      outcome,
      scenarioIds: ["mixed"],
      seeds: [null],
      configNotes: ["RR quantum=4", "MLFQ default", "ABCS defaults"],
      generatedAt: "2026-10-14T00:00:00Z",
    });
    expect(report).toContain("# Smoke report");
    expect(report).toContain("Completed runs: 3");
    expect(report).toContain("avgResponseTime");
    expect(report).toContain("Baseline for deltas: **RR**");
    // Must not hard-code a winner.
    expect(report).not.toMatch(/ABCS is (universally )?better/i);
  });

  it("CSV export escapes commas and quotes", () => {
    const csv = toCsv([
      { a: 1, b: "x,y" },
      { a: 2, b: 'say "hi"' },
    ]);
    expect(csv.split("\n")[0]).toBe("a,b");
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"say ""hi"""');
  });

  it("toRawRows produces one row per run", () => {
    const outcome = runBenchmark(
      { source: { kind: "scenario", scenarioId: "short-jobs" }, variants: QUICK_VARIANTS },
      { seeds: [null], getScenarioWorkload },
    );
    const rows = toRawRows(outcome);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveProperty("metrics.avgResponseTime");
  });
});
