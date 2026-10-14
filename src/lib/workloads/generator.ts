import type { Phase, ProcessDefinition, Workload } from "@/lib/model/types";
import { assertValidWorkload } from "@/lib/model/validation";

/**
 * Seeded random workload generator.
 *
 * Same seed + same config → byte-identical workload. Uses a small,
 * portable mulberry32 PRNG so results are reproducible across
 * platforms without depending on Math.random.
 */

export interface GeneratorConfig {
  readonly seed: number;
  readonly processCount: number;
  /** Mean gap between arrivals (Poisson-ish via exponential approx). */
  readonly meanArrivalGap: number;
  /** "short" | "long" | "mixed" | "interactive" | "cpuHeavy" */
  readonly profile: GeneratorProfile;
  readonly maxPhases: number;
}

export type GeneratorProfile = "short" | "long" | "mixed" | "interactive" | "cpuHeavy";

export const DEFAULT_GENERATOR_CONFIG: Omit<GeneratorConfig, "seed"> = {
  processCount: 8,
  meanArrivalGap: 3,
  profile: "mixed",
  maxPhases: 6,
};

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function phasesForProfile(rng: () => number, profile: GeneratorProfile, maxPhases: number): Phase[] {
  const phases: Phase[] = [];
  switch (profile) {
    case "short":
      phases.push({ type: "CPU", duration: randInt(rng, 1, 4) });
      break;
    case "long":
      phases.push({ type: "CPU", duration: randInt(rng, 20, 50) });
      break;
    case "interactive": {
      const bursts = randInt(rng, 3, maxPhases);
      for (let i = 0; i < bursts; i++) {
        phases.push({ type: "CPU", duration: randInt(rng, 1, 3) });
        if (i < bursts - 1) phases.push({ type: "IO", duration: randInt(rng, 2, 8) });
      }
      break;
    }
    case "cpuHeavy": {
      const bursts = randInt(rng, 1, 3);
      for (let i = 0; i < bursts; i++) {
        phases.push({ type: "CPU", duration: randInt(rng, 15, 40) });
        if (i < bursts - 1) phases.push({ type: "IO", duration: randInt(rng, 1, 3) });
      }
      break;
    }
    case "mixed":
    default: {
      const bursts = randInt(rng, 1, maxPhases);
      for (let i = 0; i < bursts; i++) {
        phases.push({ type: "CPU", duration: randInt(rng, 2, 12) });
        if (i < bursts - 1 && rng() < 0.6) {
          phases.push({ type: "IO", duration: randInt(rng, 2, 10) });
        }
      }
      break;
    }
  }
  return phases;
}

export function generateWorkload(config: GeneratorConfig): Workload {
  const rng = mulberry32(config.seed);
  const processes: ProcessDefinition[] = [];
  let arrival = 0;
  for (let i = 0; i < config.processCount; i++) {
    // Exponential-ish inter-arrival: -mean * ln(U), clamped to >= 0.
    const u = Math.max(rng(), 1e-9);
    const gap = Math.max(0, Math.round(-config.meanArrivalGap * Math.log(u)));
    arrival += i === 0 ? randInt(rng, 0, 1) : gap;
    processes.push({
      id: `R${i + 1}`,
      arrivalTime: arrival,
      phases: phasesForProfile(rng, config.profile, config.maxPhases),
    });
  }
  return assertValidWorkload({
    name: `Random(seed=${config.seed}, profile=${config.profile}, n=${config.processCount})`,
    description: `Seeded random workload. Reproducible from seed ${config.seed}.`,
    processes,
  });
}

/**
 * Development seeds for tuning vs held-out seeds for final evaluation.
 * Final reported results MUST use holdout seeds only.
 */
export const DEV_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const HOLDOUT_SEEDS: readonly number[] = [
  1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013,
  1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1023, 1024, 1025, 1026,
  1027, 1028, 1029, 1030,
];
