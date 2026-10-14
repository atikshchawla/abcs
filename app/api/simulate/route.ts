import { NextResponse } from "next/server";
import { z } from "zod";
import { runSimulation, ENGINE_LIMITS } from "@/lib/simulation/engine";
import { workloadSchema, MAX_PROCESSES, MAX_PHASE_DURATION } from "@/lib/model/validation";
import { resolveAbcsConfig } from "@/lib/schedulers/abcs";
import { DEFAULT_RR_QUANTUM } from "@/lib/schedulers/roundRobin";

const abcsPartialSchema = z
  .object({
    emaAlpha: z.number().min(0.01).max(1).optional(),
    burstNormCap: z.number().min(1).max(1000).optional(),
    ioNormCap: z.number().min(1).max(1000).optional(),
    latencyBlockingBoost: z.number().min(0).max(5).optional(),
    quantumLevels: z.array(z.number().int().min(1).max(64)).min(1).max(6).optional(),
    cpuDemandQuantumThreshold: z.number().min(0).max(1).optional(),
    latencyQuantumThreshold: z.number().min(0).max(1).optional(),
    agingWeight: z.number().min(0).max(1).optional(),
    agingCap: z.number().min(0).max(5).optional(),
    latencyPriorityWeight: z.number().min(0).max(10).optional(),
    transitionThreshold: z.number().min(0).max(2).optional(),
    transitionPersistence: z.number().int().min(1).max(50).optional(),
    transitionCooldown: z.number().int().min(0).max(10_000).optional(),
    transitionBaselineAlpha: z.number().min(0.001).max(1).optional(),
    stabilitySettlePeriod: z.number().int().min(0).max(10_000).optional(),
    enableTransitionDetection: z.boolean().optional(),
    enableStabilityControls: z.boolean().optional(),
  })
  .strict();

const simulateRequestSchema = z
  .object({
    workload: workloadSchema,
    algorithm: z.enum(["RR", "MLFQ", "ABCS"]),
    rrQuantum: z.number().int().min(1).max(64).optional(),
    abcs: abcsPartialSchema.optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = simulateRequestSchema.safeParse(body);
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

  const { workload, algorithm, rrQuantum, abcs } = parsed.data;

  // Extra safety limits beyond schema (schema already enforces most).
  const totalCpu = workload.processes.reduce(
    (a, p) => a + p.phases.filter((ph) => ph.type === "CPU").reduce((s, ph) => s + ph.duration, 0),
    0,
  );
  if (totalCpu > ENGINE_LIMITS.maxTime) {
    return NextResponse.json(
      {
        error: `Total CPU demand ${totalCpu} exceeds engine limit ${ENGINE_LIMITS.maxTime}. Reduce process count or durations (max ${MAX_PROCESSES} processes, ${MAX_PHASE_DURATION} per phase).`,
      },
      { status: 400 },
    );
  }

  try {
    const config =
      algorithm === "RR"
        ? { algorithm, rrQuantum: rrQuantum ?? DEFAULT_RR_QUANTUM }
        : algorithm === "ABCS"
          ? { algorithm, abcs: resolveAbcsConfig(abcs ?? undefined) }
          : { algorithm };

    const result = runSimulation(workload, config);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Simulation failed" },
      { status: 500 },
    );
  }
}
