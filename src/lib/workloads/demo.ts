import type { Workload } from "@/lib/model/types";
import { getScenarioWorkload } from "@/lib/workloads/builtIn";

/**
 * Four curated demo workloads for the single-page comparison view.
 * Each maps to a deterministic built-in scenario so repeated runs are
 * identical. The "changing" workload is the primary ABCS adaptation
 * demonstration.
 */
export interface DemoWorkloadMeta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Underlying built-in scenario id. */
  readonly scenarioId: string;
}

export const DEMO_WORKLOADS: readonly DemoWorkloadMeta[] = [
  {
    id: "mixed",
    name: "Mixed Workload",
    description:
      "CPU-heavy, interactive, and I/O-bound processes together — a balanced comparison.",
    scenarioId: "mixed",
  },
  {
    id: "cpu-heavy",
    name: "CPU-Heavy",
    description:
      "A few long CPU-bound processes with minimal I/O — favours large quanta / batch service.",
    scenarioId: "cpu-heavy",
  },
  {
    id: "io-heavy",
    name: "I/O-Heavy",
    description:
      "Processes alternate short CPU bursts with long I/O waits — favours responsiveness.",
    scenarioId: "io-heavy",
  },
  {
    id: "changing",
    name: "Changing Workload",
    description:
      "Starts CPU-bound, then shifts to I/O-heavy mid-run — makes ABCS adaptation visible.",
    scenarioId: "cpu-to-io-transition",
  },
];

export function listDemoWorkloads(): DemoWorkloadMeta[] {
  return DEMO_WORKLOADS.map((w) => ({ ...w }));
}

export function getDemoWorkloadMeta(id: string): DemoWorkloadMeta | undefined {
  return DEMO_WORKLOADS.find((w) => w.id === id);
}

/** Isolated deep copy for one algorithm run. */
export function getDemoWorkload(id: string): Workload | undefined {
  const meta = getDemoWorkloadMeta(id);
  if (!meta) return undefined;
  return getScenarioWorkload(meta.scenarioId);
}
