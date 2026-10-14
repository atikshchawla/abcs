import type { Phase, Workload } from "@/lib/model/types";
import { assertValidWorkload } from "@/lib/model/validation";

/**
 * Built-in deterministic scenarios.
 *
 * Each workload is frozen at module load (deep-cloned on retrieval) so
 * callers can never mutate the shared definitions. Transition scenarios
 * record `evaluationOnlyTransitionTimes` for adaptation-delay scoring —
 * these are never visible to schedulers.
 */

function cpu(duration: number): Phase {
  return { type: "CPU", duration };
}
function io(duration: number): Phase {
  return { type: "IO", duration };
}

interface ScenarioMeta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly workload: Workload;
}

function scenario(
  id: string,
  name: string,
  description: string,
  processes: Workload["processes"],
  evaluationOnlyTransitionTimes?: number[],
): ScenarioMeta {
  return {
    id,
    name,
    description,
    workload: assertValidWorkload({
      name,
      description,
      processes,
      ...(evaluationOnlyTransitionTimes
        ? { evaluationOnlyTransitionTimes }
        : {}),
    }),
  };
}

export const BUILTIN_SCENARIOS: readonly ScenarioMeta[] = [
  scenario(
    "short-jobs",
    "Short Jobs",
    "Many short CPU-only jobs arriving close together. Favours small quanta / low latency.",
    Array.from({ length: 8 }, (_, i) => ({
      id: `S${i + 1}`,
      arrivalTime: i * 2,
      phases: [cpu(2 + (i % 3))],
    })),
  ),

  scenario(
    "cpu-heavy",
    "CPU Heavy",
    "A few long CPU-bound processes with minimal IO. Favours large quanta / batch service.",
    [
      { id: "C1", arrivalTime: 0, phases: [cpu(40)] },
      { id: "C2", arrivalTime: 0, phases: [cpu(30)] },
      { id: "C3", arrivalTime: 4, phases: [cpu(25)] },
    ],
  ),

  scenario(
    "io-heavy",
    "I/O Heavy",
    "Processes alternate short CPU bursts with long IO waits.",
    [1, 2, 3, 4].map((i) => ({
      id: `I${i}`,
      arrivalTime: (i - 1) * 3,
      phases: Array.from({ length: 6 }, () => [cpu(2), io(6)]).flat() as Phase[],
    })),
  ),

  scenario(
    "mixed",
    "Mixed Workload",
    "Interactive-like, balanced, and batch-like processes together.",
    [
      {
        id: "M1",
        arrivalTime: 0,
        phases: [cpu(3), io(4), cpu(3), io(4), cpu(3), io(4), cpu(3)],
      },
      { id: "M2", arrivalTime: 0, phases: [cpu(12), io(3), cpu(8)] },
      { id: "M3", arrivalTime: 2, phases: [cpu(35)] },
      { id: "M4", arrivalTime: 5, phases: [cpu(2), io(2), cpu(2), io(2), cpu(4)] },
      { id: "M5", arrivalTime: 8, phases: [cpu(10)] },
    ],
  ),

  scenario(
    "cpu-to-io-transition",
    "CPU → I/O Transition",
    "Workload starts CPU-bound, then shifts to IO-heavy behaviour mid-run. Transition time is recorded for evaluation only.",
    [
      {
        id: "T1",
        arrivalTime: 0,
        phases: [
          cpu(20),
          ...Array.from({ length: 8 }, () => [io(4), cpu(2)]).flat() as Phase[],
        ],
      },
      {
        id: "T2",
        arrivalTime: 0,
        phases: [
          cpu(20),
          ...Array.from({ length: 8 }, () => [io(5), cpu(2)]).flat() as Phase[],
        ],
      },
    ],
    [20],
  ),

  scenario(
    "io-to-cpu-transition",
    "I/O → CPU Transition",
    "Workload starts IO-heavy, then shifts to sustained CPU work. Transition time is recorded for evaluation only.",
    [
      {
        id: "U1",
        arrivalTime: 0,
        phases: [
          ...Array.from({ length: 8 }, () => [cpu(2), io(4)]).flat() as Phase[],
          cpu(30),
        ],
      },
      {
        id: "U2",
        arrivalTime: 0,
        phases: [
          ...Array.from({ length: 8 }, () => [cpu(2), io(3)]).flat() as Phase[],
          cpu(24),
        ],
      },
    ],
    [24],
  ),

  scenario(
    "bursty-arrivals",
    "Bursty Arrivals",
    "Clusters of simultaneous arrivals with quiet gaps between bursts.",
    [
      { id: "B1", arrivalTime: 0, phases: [cpu(4)] },
      { id: "B2", arrivalTime: 0, phases: [cpu(5)] },
      { id: "B3", arrivalTime: 0, phases: [cpu(3)] },
      { id: "B4", arrivalTime: 1, phases: [cpu(4)] },
      { id: "B5", arrivalTime: 12, phases: [cpu(6)] },
      { id: "B6", arrivalTime: 12, phases: [cpu(3)] },
      { id: "B7", arrivalTime: 13, phases: [cpu(5)] },
      { id: "B8", arrivalTime: 13, phases: [cpu(4)] },
      { id: "B9", arrivalTime: 26, phases: [cpu(4)] },
      { id: "B10", arrivalTime: 26, phases: [cpu(5)] },
    ],
  ),

  scenario(
    "noisy-no-transition",
    "Noisy Observations, No True Transition",
    "Burst lengths oscillate noisily around a stable mean. A good transition detector should stay quiet (low policy-change frequency).",
    (() => {
      // Deterministic pseudo-noise from a fixed pattern (no RNG needed).
      const pattern = [3, 7, 4, 6, 2, 8, 5, 3, 7, 4, 6, 2, 5, 8, 3, 6];
      return Array.from({ length: 6 }, (_, i) => ({
        id: `N${i + 1}`,
        arrivalTime: i,
        phases: pattern.map((len) => cpu(len)),
      }));
    })(),
  ),

  scenario(
    "long-job-contention",
    "Long Job Under Contention",
    "One long batch job competes with a stream of short interactive jobs.",
    [
      { id: "LONG", arrivalTime: 0, phases: [cpu(50)] },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `SH${i + 1}`,
        arrivalTime: 2 + i * 3,
        phases: [cpu(3)],
      })),
    ],
  ),

  scenario(
    "starvation-stress",
    "Starvation Stress",
    "A continuously-fed stream of medium jobs against one long job — stresses aging/fairness safeguards.",
    [
      { id: "VICTIM", arrivalTime: 0, phases: [cpu(60)] },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `F${i + 1}`,
        arrivalTime: i * 2,
        phases: [cpu(4)],
      })),
    ],
  ),

  scenario(
    "overloaded-arrivals",
    "Overloaded Arrivals",
    "Arrival rate far exceeds service capacity for a period; stresses queueing behaviour and max wait.",
    Array.from({ length: 24 }, (_, i) => ({
      id: `O${i + 1}`,
      arrivalTime: Math.floor(i / 3), // 3 arrivals per tick for 8 ticks
      phases: [cpu(6 + (i % 4) * 2)],
    })),
  ),

  scenario(
    "idle-gaps",
    "Idle Gaps",
    "Long CPU-only processes separated by idle periods where no process is runnable.",
    [
      { id: "G1", arrivalTime: 0, phases: [cpu(6)] },
      { id: "G2", arrivalTime: 15, phases: [cpu(6)] },
      { id: "G3", arrivalTime: 30, phases: [cpu(8)] },
      { id: "G4", arrivalTime: 48, phases: [cpu(5)] },
    ],
  ),
];

export function getScenario(id: string): ScenarioMeta | undefined {
  return BUILTIN_SCENARIOS.find((s) => s.id === id);
}

/** Return an isolated deep copy so callers cannot mutate shared state. */
export function getScenarioWorkload(id: string): Workload | undefined {
  const meta = getScenario(id);
  if (!meta) return undefined;
  return structuredClone(meta.workload);
}

export function listScenarios(): { id: string; name: string; description: string }[] {
  return BUILTIN_SCENARIOS.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
}
