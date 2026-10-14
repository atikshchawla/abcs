import { describe, expect, it } from "vitest";
import {
  assertTransition,
  isValidTransition,
  transitionState,
} from "@/lib/simulation/processState";

describe("process state machine", () => {
  it("allows NEW → READY", () => {
    expect(isValidTransition("NEW", "READY")).toBe(true);
    expect(transitionState("NEW", "READY")).toBe("READY");
  });

  it("allows READY → RUNNING", () => {
    expect(isValidTransition("READY", "RUNNING")).toBe(true);
  });

  it("allows RUNNING → READY (quantum expiry / preemption)", () => {
    expect(isValidTransition("RUNNING", "READY")).toBe(true);
  });

  it("allows RUNNING → BLOCKED (IO start)", () => {
    expect(isValidTransition("RUNNING", "BLOCKED")).toBe(true);
  });

  it("allows RUNNING → TERMINATED", () => {
    expect(isValidTransition("RUNNING", "TERMINATED")).toBe(true);
  });

  it("allows BLOCKED → READY (IO complete, CPU follows)", () => {
    expect(isValidTransition("BLOCKED", "READY")).toBe(true);
  });

  it("allows BLOCKED → TERMINATED (workload ends with IO)", () => {
    expect(isValidTransition("BLOCKED", "TERMINATED")).toBe(true);
  });

  it("rejects all invalid transitions", () => {
    expect(isValidTransition("NEW", "RUNNING")).toBe(false);
    expect(isValidTransition("NEW", "BLOCKED")).toBe(false);
    expect(isValidTransition("NEW", "TERMINATED")).toBe(false);
    expect(isValidTransition("READY", "BLOCKED")).toBe(false);
    expect(isValidTransition("READY", "TERMINATED")).toBe(false);
    expect(isValidTransition("BLOCKED", "RUNNING")).toBe(false);
    expect(isValidTransition("TERMINATED", "READY")).toBe(false);
    expect(isValidTransition("TERMINATED", "RUNNING")).toBe(false);
  });

  it("TERMINATED is a sink state", () => {
    for (const s of ["NEW", "READY", "RUNNING", "BLOCKED", "TERMINATED"] as const) {
      expect(isValidTransition("TERMINATED", s)).toBe(false);
    }
  });

  it("assertTransition throws with a descriptive message", () => {
    expect(() => assertTransition("NEW", "RUNNING")).toThrow(
      "Invalid process state transition: NEW → RUNNING",
    );
  });
});
