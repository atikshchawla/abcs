"use client";

import { useMemo } from "react";
import type { SimulationResult } from "@/lib/model/types";
import { colorFor } from "@/lib/demo/colors";
import { idleIntervals, niceStep, clampPlayhead, completionMarks } from "@/lib/demo/timelineUtils";

const LANE_H = 44;
const AXIS_H = 18;
const PAD_LEFT = 48;
const PAD_RIGHT = 8;
const PAD_TOP = 16;

export function AbcsTimeline({
  result,
  processIds,
  sharedDuration,
  selectedTime,
  onSelectTime,
}: {
  result: SimulationResult;
  processIds: readonly string[];
  /** Shared time-scale duration (max over all three algorithms). */
  sharedDuration: number;
  selectedTime: number;
  onSelectTime: (time: number) => void;
}) {
  // Use the shared duration so ABCS / RR / MLFQ timelines align on the
  // same time scale. Fall back to the ABCS-only span if smaller.
  const duration = useMemo(() => {
    let max = result.metrics.measurementEnd;
    for (const g of result.gantt) if (g.end > max) max = g.end;
    return Math.max(max, sharedDuration, 1);
  }, [result, sharedDuration]);

  const svgW = 1100;
  const innerW = svgW - PAD_LEFT - PAD_RIGHT;
  const scale = innerW / duration;
  const svgH = PAD_TOP + LANE_H + AXIS_H;

  const tickStep = niceStep(duration);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickStep) ticks.push(t);

  const y0 = PAD_TOP;

  // Highlighted interval containing selectedTime
  const active = result.gantt.find((g) => g.start <= selectedTime && selectedTime < g.end);

  const playheadX = clampPlayhead(PAD_LEFT + selectedTime * scale, PAD_LEFT, innerW);

  const completions = useMemo(() => completionMarks(result), [result]);

  return (
    <section
      aria-label="ABCS CPU timeline"
      className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          ABCS CPU timeline
        </h2>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-zinc-500">
          {processIds.map((id) => (
            <span key={id} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colorFor(id, processIds) }} />
              {id}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm border border-zinc-300"
              style={{
                background:
                  "repeating-linear-gradient(45deg,#f4f4f5,#f4f4f5 1.5px,#d4d4d8 1.5px,#d4d4d8 3px)",
              }}
            />
            idle
          </span>
          <span>◆ transition · ▲ policy change · ┆ quantum expiry</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="h-auto w-full min-w-[700px]"
          role="img"
          aria-label="ABCS CPU Gantt chart"
        >
          <defs>
            <pattern id="abcs-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="#fafafa" />
              <line x1="0" y1="0" x2="0" y2="5" stroke="#d4d4d8" strokeWidth="1.5" />
            </pattern>
          </defs>

          {/* Lane label */}
          <text x={0} y={y0 + LANE_H / 2 + 3} fontSize={10} fontWeight={600} fill="#52525b">
            ABCS
          </text>
          {/* Completion strip — green ✓ above the lane at each process's
              termination tick. Marks are stacked in rows when they land
              close together so labels never overlap. */}
          {completions.map((c, i) => {
            const x = PAD_LEFT + c.time * scale;
            // Two-row stagger: even index on the upper row, odd below.
            const row = i % 2;
            const y = 6 + row * 8;
            const clippedX = Math.min(x, PAD_LEFT + innerW - 2);
            return (
              <g key={`done-${c.processId}`} transform={`translate(${clippedX},0)`}>
                <line y1={y + 2} y2={y0} stroke="#16a34a" strokeWidth={1} opacity={0.5} />
                <text y={y + 2} fontSize={9} textAnchor="middle" fill="#16a34a" fontWeight={700}>
                  ✓
                </text>
                <text y={y + 2} x={7} fontSize={8} fill="#16a34a" fontWeight={600}>
                  {c.processId}
                </text>
                <title>
                  {c.processId} completed all work at t={c.time}
                </title>
              </g>
            );
          })}
          {/* Lane background */}
          <rect x={PAD_LEFT} y={y0} width={innerW} height={LANE_H} fill="#fafafa" stroke="#e4e4e7" strokeWidth={0.5} rx={2} />
          {/* Idle gaps */}
          {idleIntervals(result.gantt, duration).map((idle, i) => (
            <rect
              key={`i-${i}`}
              x={PAD_LEFT + idle.start * scale}
              y={y0 + 1}
              width={Math.max(0.5, (idle.end - idle.start) * scale)}
              height={LANE_H - 2}
              fill="url(#abcs-hatch)"
              opacity={0.7}
            >
              <title>CPU idle [{idle.start}, {idle.end})</title>
            </rect>
          ))}
          {/* CPU intervals */}
          {result.gantt.map((g, i) => {
            const selected = g.start <= selectedTime && selectedTime < g.end;
            const x = PAD_LEFT + g.start * scale;
            const w = Math.max(1, (g.end - g.start) * scale);
            const clippedW = Math.min(w, PAD_LEFT + innerW - x);
            return (
              <g key={`g-${i}`}>
                <rect
                  x={x}
                  y={y0 + 1}
                  width={clippedW}
                  height={LANE_H - 2}
                  fill={colorFor(g.processId, processIds)}
                  opacity={selected ? 1 : 0.88}
                  stroke={selected ? "#18181b" : "transparent"}
                  strokeWidth={selected ? 1.5 : 0}
                  className="cursor-pointer"
                  onClick={() => onSelectTime(g.start)}
                  role="button"
                  aria-label={`${g.processId} running ${g.start} to ${g.end}`}
                >
                  <title>
                    {g.processId} [{g.start}, {g.end}) · {g.end - g.start} ticks
                    {g.endedByQuantumExpiry ? " · quantum expired" : ""}
                    {g.endedByBurstComplete ? " · burst complete" : ""}
                  </title>
                </rect>
                {clippedW >= 24 && (
                  <text
                    x={x + clippedW / 2}
                    y={y0 + LANE_H / 2 + 3}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={500}
                    fill="#ffffff"
                    pointerEvents="none"
                  >
                    {g.processId}
                  </text>
                )}
                {g.endedByQuantumExpiry && (
                  <line
                    x1={x + clippedW}
                    y1={y0 + 1}
                    x2={x + clippedW}
                    y2={y0 + LANE_H - 1}
                    stroke="#71717a"
                    strokeWidth={1}
                    strokeDasharray="2,2"
                  />
                )}
              </g>
            );
          })}
          {/* Transition markers (◆ diamond) vs policy-adjustment markers (▲ triangle) */}
          {result.events.map((e, i) => {
            if (e.type !== "TRANSITION_DETECTED" && e.type !== "POLICY_ADJUSTMENT") return null;
            const x = PAD_LEFT + e.time * scale;
            const isTransition = e.type === "TRANSITION_DETECTED";
            return (
              <g key={`m-${i}`} transform={`translate(${x},0)`}>
                <line
                  y1={y0}
                  y2={y0 + LANE_H}
                  stroke={isTransition ? "#9333ea" : "#d97706"}
                  strokeWidth={1.5}
                  opacity={0.85}
                />
                {isTransition ? (
                  <polygon points={`-3,${y0} 3,${y0} 0,${y0 + 5}`} fill="#9333ea">
                    <title>Transition detected at t={e.time}</title>
                  </polygon>
                ) : (
                  <polygon points={`0,${y0} -3,${y0 + 5} 3,${y0 + 5}`} fill="#d97706">
                    <title>Policy adjustment at t={e.time}</title>
                  </polygon>
                )}
              </g>
            );
          })}
          {/* Playhead (clamped into the visible lane) */}
          <line
            x1={playheadX}
            y1={y0 - 1}
            x2={playheadX}
            y2={y0 + LANE_H + 1}
            stroke="#18181b"
            strokeWidth={1.5}
          />
          {/* Active interval label */}
          {active && (
            <text
              x={Math.min(PAD_LEFT + active.start * scale + 4, svgW - 120)}
              y={y0 + LANE_H - 4}
              fontSize={9}
              fill="#18181b"
              fontWeight={600}
              pointerEvents="none"
            >
              [{active.start},{active.end}) {active.processId}
            </text>
          )}

          {/* Time axis */}
          {(() => {
            const y = y0 + LANE_H + 4;
            return (
              <g>
                <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT + innerW} y2={y} stroke="#a1a1aa" />
                {ticks.map((t) => (
                  <g key={t} transform={`translate(${PAD_LEFT + t * scale},0)`}>
                    <line y1={y} y2={y + 4} stroke="#a1a1aa" />
                    <text y={y + 13} textAnchor="middle" fontSize={9} fill="#71717a">
                      {t}
                    </text>
                  </g>
                ))}
              </g>
            );
          })()}
        </svg>
      </div>
    </section>
  );
}
