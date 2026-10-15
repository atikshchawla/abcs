"use client";

import { useMemo } from "react";
import type { Phase, Workload } from "@/lib/model/types";

// ---------------------------------------------------------------------------
// Builder state types (mutable drafts, converted to a Workload on run)
// ---------------------------------------------------------------------------

export interface CustomPhaseDraft {
  readonly type: "CPU" | "IO";
  readonly duration: number;
}

export interface CustomTaskDraft {
  readonly key: string;
  readonly arrivalTime: number;
  readonly phases: readonly CustomPhaseDraft[];
}

export const DEFAULT_CUSTOM_TASKS: readonly CustomTaskDraft[] = [
  { key: "k1", arrivalTime: 0, phases: [{ type: "CPU", duration: 4 }, { type: "IO", duration: 2 }, { type: "CPU", duration: 3 }] },
  { key: "k2", arrivalTime: 1, phases: [{ type: "CPU", duration: 3 }, { type: "IO", duration: 4 }, { type: "CPU", duration: 2 }] },
  { key: "k3", arrivalTime: 2, phases: [{ type: "CPU", duration: 5 }] },
];

let nextKey = 100;
function makeKey(): string {
  nextKey += 1;
  return `k${nextKey}`;
}

/** Validate drafts and build a Workload. Returns null when invalid. */
export function buildWorkload(
  tasks: readonly CustomTaskDraft[],
  name: string,
): Workload | null {
  if (tasks.length === 0) return null;
  const processes = tasks.map((t, i) => {
    if (!Number.isFinite(t.arrivalTime) || t.arrivalTime < 0) return null;
    if (t.phases.length === 0) return null;
    const phases: Phase[] = [];
    for (const p of t.phases) {
      if (!Number.isFinite(p.duration) || p.duration < 1) return null;
      phases.push({ type: p.type, duration: Math.round(p.duration) });
    }
    return {
      id: `T${i + 1}`,
      arrivalTime: Math.round(t.arrivalTime),
      phases,
    };
  });
  if (processes.some((p) => p === null)) return null;
  return {
    name,
    description: "User-defined custom workload.",
    processes: processes as Workload["processes"],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CustomWorkloadBuilder({
  tasks,
  onTasksChange,
}: {
  tasks: readonly CustomTaskDraft[];
  onTasksChange: (tasks: CustomTaskDraft[]) => void;
}) {
  const valid = useMemo(() => buildWorkload(tasks, "Custom") !== null, [tasks]);

  const update = (idx: number, patch: Partial<CustomTaskDraft>) => {
    onTasksChange(tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const updatePhase = (taskIdx: number, phaseIdx: number, patch: Partial<CustomPhaseDraft>) => {
    onTasksChange(
      tasks.map((t, i) =>
        i === taskIdx
          ? {
              ...t,
              phases: t.phases.map((p, j) => (j === phaseIdx ? { ...p, ...patch } : p)),
            }
          : t,
      ),
    );
  };

  const addPhase = (taskIdx: number, type: "CPU" | "IO") => {
    onTasksChange(
      tasks.map((t, i) =>
        i === taskIdx ? { ...t, phases: [...t.phases, { type, duration: 2 }] } : t,
      ),
    );
  };

  const removePhase = (taskIdx: number, phaseIdx: number) => {
    onTasksChange(
      tasks.map((t, i) =>
        i === taskIdx
          ? { ...t, phases: t.phases.filter((_, j) => j !== phaseIdx) }
          : t,
      ),
    );
  };

  const addTask = () => {
    onTasksChange([
      ...tasks,
      { key: makeKey(), arrivalTime: 0, phases: [{ type: "CPU", duration: 3 }] },
    ]);
  };

  const removeTask = (idx: number) => {
    onTasksChange(tasks.filter((_, i) => i !== idx));
  };

  const numInput =
    "h-6 w-14 rounded border border-zinc-300 bg-white px-1 text-right text-[11px] tabular-nums dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold">Custom workload</h3>
        <button
          type="button"
          onClick={addTask}
          className="h-6 rounded border border-zinc-300 px-2 text-[10px] font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          + Add task
        </button>
      </div>

      <p className="mb-2 text-[10px] leading-snug text-zinc-500">
        Define any number of tasks. Each task arrives at its start tick and runs an
        ordered list of CPU and I/O phases. Press <strong>Run Comparison</strong> to
        simulate.
      </p>

      <div className="space-y-2">
        {tasks.map((t, ti) => (
          <div
            key={t.key}
            className="rounded-md border border-zinc-100 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-5 items-center rounded bg-zinc-900 px-1.5 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                T{ti + 1}
              </span>
              <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                arrives at t=
                <input
                  type="number"
                  min={0}
                  value={t.arrivalTime}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0) update(ti, { arrivalTime: v });
                  }}
                  className={numInput}
                  aria-label={`T${ti + 1} arrival time`}
                />
              </label>
              <span className="text-[9px] text-zinc-400">
                {t.phases.length} phase{t.phases.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => removeTask(ti)}
                className="ml-auto h-5 rounded border border-zinc-200 px-1.5 text-[10px] text-zinc-500 hover:border-red-300 hover:text-red-600 dark:border-zinc-700"
                aria-label={`Remove task T${ti + 1}`}
                title={`Remove T${ti + 1}`}
              >
                ×
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {t.phases.map((p, pi) => (
                <span
                  key={pi}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <button
                    type="button"
                    onClick={() =>
                      updatePhase(ti, pi, { type: p.type === "CPU" ? "IO" : "CPU" })
                    }
                    className={`rounded px-1 text-[9px] font-bold ${
                      p.type === "CPU"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                    title="Click to toggle CPU / I/O"
                  >
                    {p.type}
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={p.duration}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 1) updatePhase(ti, pi, { duration: v });
                    }}
                    className="h-5 w-11 rounded border border-zinc-200 bg-white px-1 text-right text-[10px] tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                    aria-label={`T${ti + 1} phase ${pi + 1} duration`}
                  />
                  <button
                    type="button"
                    onClick={() => removePhase(ti, pi)}
                    className="h-5 w-4 rounded text-[10px] text-zinc-400 hover:text-red-600"
                    aria-label={`Remove phase ${pi + 1} of T${ti + 1}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => addPhase(ti, "CPU")}
                className="h-6 rounded border border-dashed border-zinc-300 px-1.5 text-[10px] font-medium text-zinc-500 hover:border-blue-400 hover:text-blue-600 dark:border-zinc-700"
              >
                + CPU
              </button>
              <button
                type="button"
                onClick={() => addPhase(ti, "IO")}
                className="h-6 rounded border border-dashed border-zinc-300 px-1.5 text-[10px] font-medium text-zinc-500 hover:border-amber-400 hover:text-amber-600 dark:border-zinc-700"
              >
                + I/O
              </button>
            </div>
          </div>
        ))}
      </div>

      {tasks.length === 0 && (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-4 text-center text-[10px] text-zinc-400 dark:border-zinc-700">
          No tasks yet — press <strong>+ Add task</strong> to begin.
        </p>
      )}

      {!valid && tasks.length > 0 && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Each task needs an arrival time ≥ 0 and at least one phase with duration ≥ 1.
        </p>
      )}
    </div>
  );
}
