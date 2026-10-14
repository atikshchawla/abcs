import { NextResponse } from "next/server";
import { z } from "zod";
import { workloadSchema } from "@/lib/model/validation";
import {
  runBenchmark,
  QUICK_VARIANTS,
  DEFAULT_VARIANTS,
  type BenchmarkVariant,
  type BenchmarkVariantId,
} from "@/lib/experiments/benchmarkRunner";
import { aggregateOutcome, toRawRows } from "@/lib/experiments/aggregation";
import { getScenarioWorkload, listScenarios } from "@/lib/workloads/builtIn";
import { DEFAULT_GENERATOR_CONFIG } from "@/lib/workloads/generator";

const variantIdSchema = z.enum([
  "RR",
  "MLFQ",
  "ABCS-noTD",
  "ABCS-TD-noStability",
  "ABCS-full",
]);

const compareRequestSchema = z
  .object({
    workload: workloadSchema.optional(),
    scenarioId: z.string().optional(),
    generator: z
      .object({
        seed: z.number().int().min(0).max(2 ** 31 - 1),
        processCount: z.number().int().min(1).max(200).optional(),
        meanArrivalGap: z.number().min(0).max(1000).optional(),
        profile: z.enum(["short", "long", "mixed", "interactive", "cpuHeavy"]).optional(),
        maxPhases: z.number().int().min(1).max(40).optional(),
      })
      .optional(),
    variants: z.array(variantIdSchema).min(1).max(5).optional(),
    seeds: z.array(z.number().int().min(0).max(2 ** 31 - 1)).min(1).max(50).optional(),
    baseline: variantIdSchema.optional(),
    includeRawRuns: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const sources = [v.workload, v.scenarioId, v.generator].filter(Boolean).length;
    if (sources !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of: workload, scenarioId, generator",
      });
    }
  });

export const VARIANT_LABELS: Record<BenchmarkVariantId, string> = {
  RR: "RR (q=4)",
  MLFQ: "MLFQ (3 queues)",
  "ABCS-noTD": "ABCS w/o transition detection",
  "ABCS-TD-noStability": "ABCS w/ TD, no stability",
  "ABCS-full": "ABCS (full)",
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = compareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: parsed.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
        ),
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const variantIds = data.variants ?? QUICK_VARIANTS.map((v) => v.id);
  const selected: BenchmarkVariant[] = DEFAULT_VARIANTS.filter((v) =>
    variantIds.includes(v.id),
  );

  let source: Parameters<typeof runBenchmark>[0]["source"];
  let seeds: (number | null)[];
  let scenarioIds: string[];

  if (data.workload) {
    source = { kind: "workload", workload: data.workload };
    seeds = [null];
    scenarioIds = [data.workload.name];
  } else if (data.scenarioId) {
    if (!listScenarios().some((s) => s.id === data.scenarioId)) {
      return NextResponse.json(
        {
          error: `Unknown scenario "${data.scenarioId}". Available: ${listScenarios().map((s) => s.id).join(", ")}`,
        },
        { status: 400 },
      );
    }
    source = { kind: "scenario", scenarioId: data.scenarioId };
    seeds = [null];
    scenarioIds = [data.scenarioId];
  } else {
    const g = data.generator!;
    source = {
      kind: "generator",
      generator: { ...DEFAULT_GENERATOR_CONFIG, ...g, seed: g.seed },
    };
    seeds = data.seeds ?? [g.seed];
    scenarioIds = [`generator(seed=${g.seed}, profile=${g.profile ?? "mixed"})`];
  }

  try {
    const outcome = runBenchmark(
      { source, variants: selected },
      { seeds, getScenarioWorkload },
    );
    const table = aggregateOutcome(outcome, VARIANT_LABELS, data.baseline ?? "RR");
    return NextResponse.json({
      table,
      scenarioIds,
      seeds,
      labels: VARIANT_LABELS,
      errors: outcome.errors,
      completedAll: outcome.completedAll,
      runCount: outcome.runs.length,
      ...(data.includeRawRuns ? { rawRows: toRawRows(outcome) } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Comparison failed" },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<Response> {
  return NextResponse.json({
    scenarios: listScenarios(),
    variants: DEFAULT_VARIANTS.map((v) => ({ id: v.id, label: v.label })),
  });
}
