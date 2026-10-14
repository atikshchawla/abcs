import type {
  AlgorithmId,
  SimulationConfigInput,
  SimulationResult,
  Workload,
} from "@/lib/model/types";
import { runSimulation } from "@/lib/simulation/engine";
import { generateWorkload, type GeneratorConfig } from "@/lib/workloads/generator";

/**
 * Benchmark runner.
 *
 * Same-workload rule: for every (scenario, seed) pair the workload is
 * materialized ONCE and every selected algorithm receives that exact
 * object (engine does not mutate it — covered by tests).
 *
 * Ablation variants of ABCS are expressed as distinct AlgorithmRunSpecs
 * so they appear as separate named rows in comparisons.
 */

export type BenchmarkVariantId =
  | "RR"
  | "MLFQ"
  | "ABCS-noTD"
  | "ABCS-TD-noStability"
  | "ABCS-full";

export interface BenchmarkVariant {
  readonly id: BenchmarkVariantId;
  readonly label: string;
  readonly config: SimulationConfigInput;
}

export const DEFAULT_VARIANTS: readonly BenchmarkVariant[] = [
  { id: "RR", label: "RR (q=4)", config: { algorithm: "RR", rrQuantum: 4 } },
  { id: "MLFQ", label: "MLFQ (3 queues)", config: { algorithm: "MLFQ" } },
  {
    id: "ABCS-noTD",
    label: "ABCS w/o transition detection",
    config: {
      algorithm: "ABCS",
      abcs: { enableTransitionDetection: false, enableStabilityControls: true },
    },
  },
  {
    id: "ABCS-TD-noStability",
    label: "ABCS w/ TD, no stability",
    config: {
      algorithm: "ABCS",
      abcs: { enableTransitionDetection: true, enableStabilityControls: false },
    },
  },
  {
    id: "ABCS-full",
    label: "ABCS (full)",
    config: {
      algorithm: "ABCS",
      abcs: { enableTransitionDetection: true, enableStabilityControls: true },
    },
  },
];

/** Quick 3-algorithm set for the demo/compare UI. */
export const QUICK_VARIANTS: readonly BenchmarkVariant[] = [
  { id: "RR", label: "RR (q=4)", config: { algorithm: "RR", rrQuantum: 4 } },
  { id: "MLFQ", label: "MLFQ (3 queues)", config: { algorithm: "MLFQ" } },
  {
    id: "ABCS-full",
    label: "ABCS (full)",
    config: {
      algorithm: "ABCS",
      abcs: { enableTransitionDetection: true, enableStabilityControls: true },
    },
  },
];

export type BenchmarkSource =
  | { kind: "workload"; workload: Workload }
  | { kind: "scenario"; scenarioId: string }
  | { kind: "generator"; generator: GeneratorConfig };

export interface BenchmarkRunSpec {
  readonly source: BenchmarkSource;
  readonly variants: readonly BenchmarkVariant[];
}

export interface SingleRunRecord {
  readonly variantId: BenchmarkVariantId;
  readonly algorithm: AlgorithmId;
  readonly workloadName: string;
  readonly seed: number | null;
  readonly result: SimulationResult;
  readonly error?: string;
}

export interface BenchmarkOutcome {
  readonly runs: readonly SingleRunRecord[];
  readonly errors: readonly { variantId: string; workloadName: string; error: string }[];
  readonly completedAll: boolean;
}

function materializeWorkload(
  source: BenchmarkSource,
  seed: number | null,
): Workload {
  switch (source.kind) {
    case "workload":
      return source.workload;
    case "scenario":
      throw new Error("scenario source must be resolved via resolveScenarioWorkload");
    case "generator":
      return generateWorkload({
        ...source.generator,
        seed: seed ?? source.generator.seed,
      });
  }
}

/** Resolve scenario-based sources into concrete workloads per seed. */
export function resolveWorkloadForSeed(
  source: BenchmarkSource,
  seed: number | null,
  getScenarioWorkload: (id: string) => Workload | undefined,
): Workload {
  if (source.kind === "scenario") {
    const w = getScenarioWorkload(source.scenarioId);
    if (!w) throw new Error(`Unknown scenario: ${source.scenarioId}`);
    return w;
  }
  return materializeWorkload(source, seed);
}

export interface RunBenchmarkOptions {
  /** Seeds to sweep. Single deterministic workloads pass [null]. */
  readonly seeds: readonly (number | null)[];
  readonly getScenarioWorkload: (id: string) => Workload | undefined;
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Run every variant on every seed's identical workload.
 * A thrown engine error for one run is recorded, not fatal to the rest.
 */
export function runBenchmark(spec: BenchmarkRunSpec, options: RunBenchmarkOptions): BenchmarkOutcome {
  const runs: SingleRunRecord[] = [];
  const errors: { variantId: string; workloadName: string; error: string }[] = [];
  const total = options.seeds.length * spec.variants.length;
  let done = 0;

  for (const seed of options.seeds) {
    // Materialize the workload ONCE per seed; share across variants.
    let workload: Workload;
    try {
      workload = resolveWorkloadForSeed(spec.source, seed, options.getScenarioWorkload);
    } catch (err) {
      errors.push({
        variantId: "*",
        workloadName: String(spec.source.kind),
        error: err instanceof Error ? err.message : String(err),
      });
      done += spec.variants.length;
      options.onProgress?.(done, total);
      continue;
    }

    for (const variant of spec.variants) {
      try {
        const result = runSimulation(workload, variant.config);
        runs.push({
          variantId: variant.id,
          algorithm: result.algorithm,
          workloadName: workload.name,
          seed,
          result,
        });
      } catch (err) {
        errors.push({
          variantId: variant.id,
          workloadName: workload.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      done++;
      options.onProgress?.(done, total);
    }
  }

  return { runs, errors, completedAll: errors.length === 0 };
}
