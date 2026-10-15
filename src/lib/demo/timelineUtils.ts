import type { GanttInterval, SimulationResult } from "@/lib/model/types";

/** Compute idle gaps in a gantt trace up to `duration`. */
export function idleIntervals(
  gantt: readonly GanttInterval[],
  duration: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  const sorted = [...gantt].sort((a, b) => a.start - b.start);
  for (const g of sorted) {
    if (g.start > cursor) out.push({ start: cursor, end: g.start });
    cursor = Math.max(cursor, g.end);
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out;
}

/** Nice axis tick step for a given duration. */
export function niceStep(duration: number): number {
  const raw = duration / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/** Clamp a playhead x-coordinate into the visible lane. */
export function clampPlayhead(x: number, padLeft: number, innerW: number): number {
  return Math.max(padLeft, Math.min(padLeft + innerW, x));
}

/** One completed (terminated) process with its completion time. */
export interface CompletionMark {
  readonly processId: string;
  readonly time: number;
}

/**
 * Processes that finished (all phases done) in this run, with the tick
 * they terminated at. Sorted by completion time. Derived from the
 * engine's recorded final states — never fabricated.
 */
export function completionMarks(result: SimulationResult): CompletionMark[] {
  return result.processFinalStates
    .filter((p) => p.completed && p.completionTime !== null)
    .map((p) => ({ processId: p.id, time: p.completionTime as number }))
    .sort((a, b) => a.time - b.time);
}

/** Processes terminated at or before `time` (for panel "Completed" rows). */
export function completedBy(
  result: SimulationResult,
  time: number,
): CompletionMark[] {
  return completionMarks(result).filter((c) => c.time <= time);
}
