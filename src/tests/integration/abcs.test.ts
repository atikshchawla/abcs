import { describe, expect, it } from "vitest";
import { ProcessObservationModel } from "@/lib/behaviour/observations";
import { TransitionDetector } from "@/lib/behaviour/transitionDetector";
import { AbcsScheduler, DEFAULT_ABCS_CONFIG, resolveAbcsConfig } from "@/lib/schedulers/abcs";
import { runSimulation } from "@/lib/simulation/engine";
import type { Workload } from "@/lib/model/types";
import { assertValidWorkload } from "@/lib/model/validation";

function wl(processes: Workload["processes"], name = "abcs-test"): Workload {
  return assertValidWorkload({ name, processes });
}

describe("ProcessObservationModel", () => {
  it("scores start at 0 before any observation", () => {
    const m = new ProcessObservationModel(DEFAULT_ABCS_CONFIG);
    // C=0, I=0 with no data → R = 0.6*(1-0) + 0.4*0 = 0.6
    expect(m.scores).toEqual({
      cpuDemandScore: 0,
      ioActivityScore: 0,
      latencySensitivityScore: 0.6,
    });
  });

  it("long CPU bursts raise cpuDemand and lower latencySensitivity", () => {
    const m = new ProcessObservationModel(DEFAULT_ABCS_CONFIG);
    m.recordBurst(10, false); // C = 10/8 → clamped to 1
    expect(m.scores.cpuDemandScore).toBeCloseTo(1);
    expect(m.scores.ioActivityScore).toBeCloseTo(0);
    // R = 0.6*(1-1) + 0.4*0 = 0
    expect(m.scores.latencySensitivityScore).toBeCloseTo(0);
  });

  it("short bursts ending in IO raise latencySensitivity and ioActivity", () => {
    const m = new ProcessObservationModel(DEFAULT_ABCS_CONFIG);
    m.recordBurst(2, true); // C = 2/8 = 0.25; I = 10/2 = 5 → clamped to 1; R = 0.6*0.75 + 0.4*1 = 0.85
    expect(m.scores.cpuDemandScore).toBeCloseTo(0.25);
    expect(m.scores.ioActivityScore).toBeCloseTo(1);
    expect(m.scores.latencySensitivityScore).toBeCloseTo(0.85);
  });

  it("scores stay within [0,1] with mixed observations", () => {
    const m = new ProcessObservationModel(DEFAULT_ABCS_CONFIG);
    for (const [len, io] of [
      [1, true],
      [9, false],
      [3, true],
      [15, false],
    ] as const) {
      m.recordBurst(len, io);
    }
    m.recordIOWait(50);
    const s = m.scores;
    for (const v of [s.cpuDemandScore, s.ioActivityScore, s.latencySensitivityScore]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic", () => {
    const a = new ProcessObservationModel(DEFAULT_ABCS_CONFIG);
    const b = new ProcessObservationModel(DEFAULT_ABCS_CONFIG);
    a.recordBurst(3, true);
    b.recordBurst(3, true);
    a.recordBurst(7, false);
    b.recordBurst(7, false);
    expect(a.scores).toEqual(b.scores);
  });
});

describe("TransitionDetector", () => {
  const cfg = resolveAbcsConfig({
    emaAlpha: 0.5,
    transitionThreshold: 0.3,
    transitionPersistence: 2,
    transitionCooldown: 10,
    transitionBaselineAlpha: 0.1,
    cpuDemandDivisor: 10,
  });

  it("does not fire on a stable signal", () => {
    const d = new TransitionDetector(cfg);
    let fired = 0;
    for (let i = 0; i < 30; i++) {
      if (d.observe(i, 5, false)) fired++;
    }
    expect(fired).toBe(0);
  });

  it("fires after a sustained shift crosses the threshold and persistence", () => {
    const d = new TransitionDetector(cfg);
    // Warm up baseline on short bursts.
    for (let i = 0; i < 20; i++) d.observe(i, 1, false);
    // Sustained long bursts → deviation.
    const detections: number[] = [];
    for (let i = 20; i < 40; i++) {
      const det = d.observe(i, 10, false);
      if (det) detections.push(i);
    }
    expect(detections.length).toBeGreaterThanOrEqual(1);
    expect(detections[0]).toBeGreaterThanOrEqual(20 + cfg.transitionPersistence - 1);
  });

  it("cooldown suppresses immediate re-detection", () => {
    const d = new TransitionDetector(cfg);
    for (let i = 0; i < 20; i++) d.observe(i, 1, false);
    const times: number[] = [];
    for (let i = 20; i < 60; i++) {
      // Alternate signals to repeatedly cross the threshold after cooldown.
      const det = d.observe(i, i % 2 === 0 ? 10 : 1, false);
      if (det) times.push(i);
    }
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(cfg.transitionCooldown);
    }
  });

  it("ignores noise below the threshold", () => {
    const d = new TransitionDetector(cfg);
    for (let i = 0; i < 40; i++) {
      // Small oscillation around 5: norm 0.5 ± 0.1 — deviation stays low.
      const det = d.observe(i, i % 2 === 0 ? 4 : 6, false);
      expect(det).toBeNull();
    }
  });

  it("respects persistence: a single spike does not fire", () => {
    const d = new TransitionDetector(cfg);
    for (let i = 0; i < 20; i++) d.observe(i, 2, false);
    // One spike then back.
    expect(d.observe(20, 10, null)).toBeNull();
    for (let i = 21; i < 35; i++) {
      expect(d.observe(i, 2, false)).toBeNull();
    }
  });
});

describe("AbcsScheduler", () => {
  it("selects a process and returns a bounded quantum", () => {
    const s = new AbcsScheduler();
    s.init([{ id: "A", arrivalTime: 0 }]);
    const sel = s.selectProcess(0, [
      { id: "A", currentReadyWait: 0, totalReadyWait: 0, cpuService: 0, completedBursts: 0 },
    ]);
    expect(sel.processId).toBe("A");
    const levels = [
      DEFAULT_ABCS_CONFIG.quantumHigh,
      DEFAULT_ABCS_CONFIG.quantumMid,
      DEFAULT_ABCS_CONFIG.quantumLow,
    ];
    expect(levels).toContain(sel.quantum);
  });

  it("quantum is always within configured levels", () => {
    const s = new AbcsScheduler();
    s.init([{ id: "A", arrivalTime: 0 }]);
    // Feed batch-like observations (long bursts, no IO).
    for (let i = 0; i < 10; i++) {
      s.onBurstComplete(i * 10, "A", 10, false);
    }
    const sel = s.selectProcess(100, [
      { id: "A", currentReadyWait: 0, totalReadyWait: 0, cpuService: 100, completedBursts: 10 },
    ]);
    const levels = [
      DEFAULT_ABCS_CONFIG.quantumHigh,
      DEFAULT_ABCS_CONFIG.quantumMid,
      DEFAULT_ABCS_CONFIG.quantumLow,
    ];
    expect(levels).toContain(sel.quantum);
  });

  it("fairness term raises priority for long-waiting processes", () => {
    const s = new AbcsScheduler();
    s.init([
      { id: "A", arrivalTime: 0 },
      { id: "B", arrivalTime: 0 },
    ]);
    // Make A latency-sensitive (short IO bursts), B batch-like.
    s.onBurstComplete(1, "A", 1, true);
    s.onBurstComplete(2, "B", 9, false);
    // A has higher latency score, but B has waited much longer.
    const sel = s.selectProcess(500, [
      { id: "A", currentReadyWait: 0, totalReadyWait: 0, cpuService: 1, completedBursts: 1 },
      { id: "B", currentReadyWait: 500, totalReadyWait: 500, cpuService: 9, completedBursts: 1 },
    ]);
    // Priority = 70·R + 10·(wait/4). B's huge wait dominates → B wins.
    // Reason text includes fairness contribution breakdown.
    expect(sel.processId).toBe("B");
    expect(sel.reason).toContain("fairness");
    expect(sel.reason).toContain("behaviour");
  });

  it("records full decision records on each dispatch", () => {
    const s = new AbcsScheduler();
    s.init([{ id: "A", arrivalTime: 0 }, { id: "B", arrivalTime: 0 }]);
    s.onBurstComplete(1, "A", 1, true);
    s.onBurstComplete(2, "B", 9, false);
    s.selectProcess(10, [
      { id: "A", currentReadyWait: 2, totalReadyWait: 2, cpuService: 1, completedBursts: 1 },
      { id: "B", currentReadyWait: 3, totalReadyWait: 3, cpuService: 9, completedBursts: 1 },
    ]);
    const records = s.getDecisionRecords();
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.time).toBe(10);
    expect(rec.contributions).toHaveLength(2);
    // Contributions sorted by totalPriority desc.
    expect(rec.contributions[0].totalPriority).toBeGreaterThanOrEqual(
      rec.contributions[1].totalPriority,
    );
    // Each contribution has the full breakdown.
    for (const c of rec.contributions) {
      expect(c.behaviorContribution).toBeCloseTo(70 * c.responsivenessScore);
      expect(c.fairnessContribution).toBeCloseTo(10 * c.readyWait / 4);
      expect(c.totalPriority).toBeCloseTo(c.behaviorContribution + c.fairnessContribution);
    }
  });

  it("records behaviour history entries", () => {
    const s = new AbcsScheduler();
    s.init([{ id: "A", arrivalTime: 0 }]);
    s.onArrival(0, "A");
    s.onDispatch(0, "A", 4);
    s.onBurstComplete(2, "A", 2, true);
    s.onIOComplete(4, "A", 2);
    const history = s.getBehaviourHistory();
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.every((h) => h.processId === "A")).toBe(true);
    const burstSample = history.find((h) => h.rawBurstLength !== undefined);
    expect(burstSample?.rawBurstLength).toBe(2);
  });

  it("ablation flag disables transition detection", () => {
    const s = new AbcsScheduler({ enableTransitionDetection: false });
    s.init([{ id: "A", arrivalTime: 0 }]);
    for (let i = 0; i < 30; i++) {
      s.onBurstComplete(i, "A", i < 15 ? 1 : 10, false);
    }
    const pending = s.drainPendingEvents();
    expect(pending.filter((e) => e.type === "TRANSITION_DETECTED")).toHaveLength(0);
  });
});

describe("ABCS engine integration", () => {
  it("completes the same workload as RR (valid trace)", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 5 }, { type: "IO", duration: 3 }, { type: "CPU", duration: 4 }] },
      { id: "P2", arrivalTime: 0, phases: [{ type: "CPU", duration: 6 }] },
    ]);
    const abcs = runSimulation(workload, { algorithm: "ABCS" });
    const rr = runSimulation(workload, { algorithm: "RR", rrQuantum: 4 });
    expect(abcs.completed).toBe(true);
    expect(rr.completed).toBe(true);
    // Same total CPU service across algorithms (same workload).
    const service = (r: typeof abcs) =>
      r.processFinalStates.reduce((a, f) => a + f.cpuService, 0);
    expect(service(abcs)).toBe(service(rr));
  });

  it("produces behaviour history for ABCS results", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 4 }, { type: "IO", duration: 2 }, { type: "CPU", duration: 4 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "ABCS" });
    expect(result.behaviourHistory.length).toBeGreaterThan(0);
    const sample = result.behaviourHistory.find((h) => h.scores);
    expect(sample).toBeDefined();
    expect(sample!.scores.cpuDemandScore).toBeGreaterThanOrEqual(0);
    expect(sample!.scores.cpuDemandScore).toBeLessThanOrEqual(1);
  });

  it("records decision records for every ABCS dispatch", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 4 }, { type: "IO", duration: 2 }, { type: "CPU", duration: 4 }] },
      { id: "P2", arrivalTime: 0, phases: [{ type: "CPU", duration: 6 }] },
    ]);
    const result = runSimulation(workload, { algorithm: "ABCS" });
    expect(result.decisionRecords.length).toBeGreaterThan(0);
    const rec = result.decisionRecords[0];
    expect(rec.time).toBeGreaterThanOrEqual(0);
    expect(rec.contributions.length).toBeGreaterThanOrEqual(1);
    expect(typeof rec.quantumReason).toBe("string");
    // Every record's contributions sum consistently.
    for (const c of rec.contributions) {
      expect(c.totalPriority).toBeCloseTo(c.behaviorContribution + c.fairnessContribution);
    }
  });

  it("RR and MLFQ have empty decision records", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 4 }] },
    ]);
    expect(runSimulation(workload, { algorithm: "RR", rrQuantum: 2 }).decisionRecords).toEqual([]);
    expect(runSimulation(workload, { algorithm: "MLFQ" }).decisionRecords).toEqual([]);
  });

  it("emits only observation-derived transition events (no hidden labels)", () => {
    // Transition scenario: first half short IO bursts, second half long CPU.
    const phases = [
      ...Array.from({ length: 8 }, () => ({ type: "CPU" as const, duration: 1 })),
      ...Array.from({ length: 8 }, () => ({ type: "IO" as const, duration: 1 })),
      { type: "CPU" as const, duration: 20 },
    ];
    const workload = wl([{ id: "P1", arrivalTime: 0, phases }]);
    const result = runSimulation(workload, { algorithm: "ABCS" });
    const tdEvents = result.events.filter((e) => e.type === "TRANSITION_DETECTED");
    for (const e of tdEvents) {
      // Reasons must reference observed metrics, not scenario names.
      expect(e.reason).toMatch(/recent=|baseline=|deviation=/);
      expect(e.reason.toLowerCase()).not.toContain("scenario");
    }
  });

  it("deterministic for identical inputs", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 6 }, { type: "IO", duration: 3 }, { type: "CPU", duration: 5 }] },
      { id: "P2", arrivalTime: 2, phases: [{ type: "CPU", duration: 4 }] },
    ]);
    const a = runSimulation(workload, { algorithm: "ABCS" });
    const b = runSimulation(workload, { algorithm: "ABCS" });
    expect(a).toEqual(b);
  });

  it("ablation modes all produce valid completed traces", () => {
    const workload = wl([
      { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 10 }] },
      { id: "P2", arrivalTime: 0, phases: [{ type: "CPU", duration: 3 }, { type: "IO", duration: 2 }, { type: "CPU", duration: 3 }] },
    ]);
    const modes = [
      { enableTransitionDetection: false, enableStabilityControls: true },
      { enableTransitionDetection: true, enableStabilityControls: false },
      { enableTransitionDetection: true, enableStabilityControls: true },
    ] as const;
    for (const abcs of modes) {
      const result = runSimulation(workload, { algorithm: "ABCS", abcs });
      expect(result.completed).toBe(true);
      expect(result.metrics.completedCount).toBe(2);
    }
  });
});
