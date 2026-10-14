import { z } from "zod";
import type { Workload } from "@/lib/model/types";

export const MAX_PROCESSES = 200;
export const MAX_PHASES_PER_PROCESS = 40;
export const MAX_PHASE_DURATION = 10_000;
export const MAX_ARRIVAL_TIME = 100_000;

export const phaseSchema = z.object({
  type: z.enum(["CPU", "IO"]),
  duration: z
    .number()
    .int("Phase duration must be an integer number of ticks")
    .min(1, "Phase duration must be at least 1 tick")
    .max(MAX_PHASE_DURATION, `Phase duration must be at most ${MAX_PHASE_DURATION} ticks`),
});

export const processDefinitionSchema = z.object({
  id: z
    .string()
    .min(1, "Process id must be non-empty")
    .max(64, "Process id must be at most 64 characters"),
  arrivalTime: z
    .number()
    .int("Arrival time must be an integer number of ticks")
    .min(0, "Arrival time must be >= 0")
    .max(MAX_ARRIVAL_TIME, `Arrival time must be at most ${MAX_ARRIVAL_TIME}`),
  phases: z
    .array(phaseSchema)
    .min(1, "Process must have at least one phase")
    .max(MAX_PHASES_PER_PROCESS, `Process must have at most ${MAX_PHASES_PER_PROCESS} phases`),
});

export const workloadSchema = z
  .object({
    name: z.string().min(1, "Workload name must be non-empty").max(120),
    description: z.string().max(1000).optional(),
    processes: z
      .array(processDefinitionSchema)
      .min(1, "Workload must contain at least one process")
      .max(MAX_PROCESSES, `Workload must contain at most ${MAX_PROCESSES} processes`),
    evaluationOnlyTransitionTimes: z.array(z.number().int().min(0)).optional(),
  })
  .superRefine((workload, ctx) => {
    const seen = new Set<string>();
    for (const [index, proc] of workload.processes.entries()) {
      if (seen.has(proc.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate process id "${proc.id}" at index ${index}`,
          path: ["processes", index, "id"],
        });
      }
      seen.add(proc.id);
    }
  });

export interface WorkloadValidationResult {
  ok: boolean;
  workload?: Workload;
  errors: string[];
}

/** Validate untrusted workload JSON. Returns friendly error strings. */
export function validateWorkload(input: unknown): WorkloadValidationResult {
  const parsed = workloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join(".") + ": " : ""}${issue.message}`,
      ),
    };
  }
  return { ok: true, workload: parsed.data as Workload, errors: [] };
}

export function assertValidWorkload(input: unknown): Workload {
  const result = validateWorkload(input);
  if (!result.ok || !result.workload) {
    throw new Error(`Invalid workload: ${result.errors.join("; ")}`);
  }
  return result.workload;
}
