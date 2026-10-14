import type { ProcessState } from "@/lib/model/types";

/**
 * Process lifecycle state machine.
 *
 * Valid transitions:
 *   NEW        → READY        (arrival)
 *   READY      → RUNNING      (dispatch)
 *   RUNNING    → READY        (quantum expiry or preemption)
 *   RUNNING    → BLOCKED      (CPU burst complete, next phase is IO)
 *   RUNNING    → TERMINATED   (CPU burst complete, no phases remain)
 *   BLOCKED    → READY        (IO complete, CPU phase follows)
 *   BLOCKED    → TERMINATED   (IO complete, no phases remain — workload ends with IO)
 *
 * All other transitions are invalid and throw.
 */
const VALID_TRANSITIONS: Readonly<Record<ProcessState, readonly ProcessState[]>> = {
  NEW: ["READY"],
  READY: ["RUNNING"],
  RUNNING: ["READY", "BLOCKED", "TERMINATED"],
  BLOCKED: ["READY", "TERMINATED"],
  TERMINATED: [],
};

export function isValidTransition(from: ProcessState, to: ProcessState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ProcessState, to: ProcessState): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid process state transition: ${from} → ${to}`);
  }
}

export function transitionState(from: ProcessState, to: ProcessState): ProcessState {
  assertTransition(from, to);
  return to;
}
