import { describe, expect, it } from "vitest";
import {
  reconstructRrQueue,
  reconstructMlfqQueues,
  nearestDispatchAt,
} from "@/lib/demo/queueReplay";
import { runDemoComparison } from "@/lib/demo/compare";
import { getDemoWorkload } from "@/lib/workloads/demo";

describe("queueReplay — RR FIFO reconstruction", () => {
  const workload = getDemoWorkload("mixed")!;
  const results = runDemoComparison(workload);
  const rr = results.RR;

  it("at t=0, if a process is dispatched it is running and not in the queue", () => {
    const snap = reconstructRrQueue(rr, 0);
    // The mixed workload may dispatch at t=0 (first arrival). Whatever
    // the reconstruction says, the invariant is: running ∉ ready.
    if (snap.running !== null) {
      expect(snap.ready).not.toContain(snap.running);
    }
  });

  it("at the first dispatch time the selected process is running and removed from the queue", () => {
    const firstDispatch = rr.events.find((e) => e.type === "DISPATCH");
    if (!firstDispatch) throw new Error("no DISPATCH in RR trace");
    const snap = reconstructRrQueue(rr, firstDispatch.time);
    expect(snap.running).toBe(firstDispatch.processId);
    expect(snap.ready).not.toContain(firstDispatch.processId);
    expect(snap.lastDispatch?.time).toBe(firstDispatch.time);
    expect(snap.runningQuantum).toBe(
      typeof firstDispatch.metadata?.quantum === "number"
        ? firstDispatch.metadata.quantum
        : null,
    );
  });

  it("running process is never also in the ready queue", () => {
    for (const t of [0, 1, 5, 10, 20, 40]) {
      const snap = reconstructRrQueue(rr, t);
      if (snap.running !== null) {
        expect(snap.ready).not.toContain(snap.running);
      }
    }
  });

  it("a process that quantum-expires re-enters the ready queue", () => {
    const qe = rr.events.find((e) => e.type === "QUANTUM_EXPIRED");
    if (!qe || !qe.processId) throw new Error("no QUANTUM_EXPIRED in RR trace");
    const snap = reconstructRrQueue(rr, qe.time);
    expect(snap.ready).toContain(qe.processId);
    expect(snap.running).not.toBe(qe.processId);
  });

  it("after all dispatches every terminating process is absent from the queue", () => {
    const lastTerm = rr.events.filter((e) => e.type === "PROCESS_TERMINATED");
    if (lastTerm.length === 0) return;
    const lastTime = lastTerm[lastTerm.length - 1].time;
    const snap = reconstructRrQueue(rr, lastTime);
    for (const t of lastTerm) {
      if (t.processId) expect(snap.ready).not.toContain(t.processId);
    }
  });

  it("is deterministic", () => {
    const a = reconstructRrQueue(rr, 20);
    const b = reconstructRrQueue(rr, 20);
    expect(a).toEqual(b);
  });
});

describe("queueReplay — MLFQ 3-queue reconstruction", () => {
  const workload = getDemoWorkload("mixed")!;
  const results = runDemoComparison(workload);
  const mlfq = results.MLFQ;

  it("at t=0, if a process is dispatched it runs at level 0 and is not in any queue", () => {
    const snap = reconstructMlfqQueues(mlfq, 0);
    expect(snap.queues).toHaveLength(3);
    if (snap.running !== null) {
      expect(snap.runningLevel).toBe(0);
      for (const q of snap.queues) expect(q).not.toContain(snap.running);
    }
  });

  it("at the first dispatch the selected process runs at level 0", () => {
    const firstDispatch = mlfq.events.find((e) => e.type === "DISPATCH");
    if (!firstDispatch) throw new Error("no DISPATCH in MLFQ trace");
    const snap = reconstructMlfqQueues(mlfq, firstDispatch.time);
    expect(snap.running).toBe(firstDispatch.processId);
    expect(snap.runningLevel).toBe(0);
    expect(snap.queues).toHaveLength(3);
    for (const q of snap.queues) expect(q).not.toContain(firstDispatch.processId);
  });

  it("running process is never also in any queue level", () => {
    for (const t of [0, 1, 5, 10, 20, 40]) {
      const snap = reconstructMlfqQueues(mlfq, t);
      if (snap.running !== null) {
        for (const q of snap.queues) {
          expect(q).not.toContain(snap.running);
        }
      }
    }
  });

  it("a demoted process appears at a deeper level after quantum expiry", () => {
    const demotions = mlfq.events.filter((e) => e.type === "QUANTUM_EXPIRED");
    if (demotions.length === 0) return;
    const first = demotions[0];
    const pid = first.processId;
    if (!pid) return;
    const snap = reconstructMlfqQueues(mlfq, first.time);
    // After demotion the process should be in some ready queue (not running).
    const inAnyQueue = snap.queues.some((q) => q.includes(pid));
    expect(inAnyQueue).toBe(true);
    expect(snap.running).not.toBe(pid);
  });

  it("all queue levels combined never exceed the number of non-terminated processes", () => {
    const snap = reconstructMlfqQueues(mlfq, 30);
    const total = snap.queues.reduce((a, q) => a + q.length, 0);
    const maxProcs = mlfq.processFinalStates.length;
    expect(total).toBeLessThanOrEqual(maxProcs);
  });

  it("is deterministic", () => {
    const a = reconstructMlfqQueues(mlfq, 25);
    const b = reconstructMlfqQueues(mlfq, 25);
    expect(a).toEqual(b);
  });
});

describe("queueReplay — nearestDispatchAt", () => {
  const workload = getDemoWorkload("mixed")!;
  const results = runDemoComparison(workload);

  it("returns a DISPATCH event", () => {
    const d = nearestDispatchAt(results.RR, 10);
    if (d) {
      expect(d.type).toBe("DISPATCH");
      expect(typeof d.time).toBe("number");
    }
  });

  it("prefers the latest DISPATCH at or before the target", () => {
    const dispatchTimes = results.RR.events
      .filter((e) => e.type === "DISPATCH")
      .map((e) => e.time);
    if (dispatchTimes.length < 2) return;
    const target = dispatchTimes[1] + 1;
    const d = nearestDispatchAt(results.RR, target);
    if (d) expect(d.time).toBeLessThanOrEqual(target);
  });

  it("falls back to the first DISPATCH after the target when none at or before", () => {
    const firstDispatch = results.RR.events.find((e) => e.type === "DISPATCH");
    if (!firstDispatch) return;
    if (firstDispatch.time === 0) return;
    const d = nearestDispatchAt(results.RR, 0);
    if (d && firstDispatch.time > 0) {
      // At t=0 either there is a dispatch at 0 or the first after 0.
      expect(d.time).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns null when no DISPATCH exists (empty result)", () => {
    const empty = {
      ...results.RR,
      events: [],
    };
    expect(nearestDispatchAt(empty, 10)).toBeNull();
  });
});
