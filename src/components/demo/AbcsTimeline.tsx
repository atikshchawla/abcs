"use client";

import { useMemo } from "react";
import type { GanttInterval, SimulationResult } from "@/lib/model/types";
import { colorFor } from "@/lib/demo/colors";

const LANE_H = 44;
const AXIS_H = 18;
const PAD_LEFT = 48;
const PAD_RIGHT = 8;
const PAD_TOP = 4;

export function AbcsTimeline({
  result,
  processIds,
  selectedTime,
  onSelectTime,
}: {
  result: SimulationResult;
  processIds: readonly string[];
  selectedTime: number;
  onSelectTime: (time: number) => void;
}) {
  const duration = useMemo(() => {
    let max = result.metrics.measurementEnd;
    for (const g of result.gantt) if (g.end > max) max = g.end;
    return Math.max(max, 1);
  }, [result]);

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

  return (
    <section
      aria-label="ABCS CPU timeline"
      className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          ABCS CPU timeline — full width, shared time axis
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
          <span>▲ purple = transition · ┆ dashed = quantum expiry</span>
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
            />
          ))}
          {/* CPU intervals */}
          {result.gantt.map((g, i) => {
            const selected = g.start <= selectedTime && selectedTime < g.end;
            const x = PAD_LEFT + g.start * scale;
            const w = Math.max(1, (g.end - g.start) * scale);
            return (
              <g key={`g-${i}`}>
                <rect
                  x={x}
                  y={y0 + 1}
                  width={w}
                  height={LANE_H - 2}
                  fill={colorFor(g.processId, processIds)}
                  opacity={selected ? 1 : 0.88}
                  stroke={selected ? "#18181b" : "transparent"}
                  strokeWidth={selected ? 1.5 : 0}
                  className="cursor-pointer"
                  onClick={() => onSelectTime(g.start)}
                >
                  <title>
                    {g.processId} [{g.start}, {g.end})
                    {g.endedByQuantumExpiry ? " · quantum expired" : ""}
                    {g.endedByBurstComplete ? " · burst complete" : ""}
                  </title>
                </rect>
                {w >= 24 && (
                  <text
                    x={x + w / 2}
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
                    x1={x + w}
                    y1={y0 + 1}
                    x2={x + w}
                    y2={y0 + LANE_H - 1}
                    stroke="#71717a"
                    strokeWidth={1}
                    strokeDasharray="2,2"
                  />
                )}
              </g>
            );
          })}
          {/* Transition / policy markers */}
          {result.events
            .filter((e) => e.type === "TRANSITION_DETECTED" || e.type === "POLICY_ADJUSTMENT")
            .map((e, i) => {
              const x = PAD_LEFT + e.time * scale;
              return (
                <g key={`m-${i}`} transform={`translate(${x},0)`}>
                  <line y1={y0} y2={y0 + LANE_H} stroke="#9333ea" strokeWidth={1.5} opacity={0.85} />
                  <polygon points={`-3,${y0} 3,${y0} 0,${y0 + 5}`} fill="#9333ea" />
                </g>
              );
            })}
          {/* Playhead */}
          <line
            x1={PAD_LEFT + selectedTime * scale}
            y1={y0 - 1}
            x2={PAD_LEFT + selectedTime * scale}
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

function idleIntervals(gantt: readonly GanttInterval[], duration: number): { start: number; end: number }[] {
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

function niceStep(duration: number): number {
  const raw = duration / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}
