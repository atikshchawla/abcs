"use client";

import type { GanttInterval, SimulationResult } from "@/lib/model/types";
import { colorFor } from "@/lib/demo/colors";

const LANE_H = 22;
const AXIS_H = 14;
const PAD_LEFT = 40;
const PAD_RIGHT = 6;
const PAD_TOP = 2;

/**
 * Compact single-lane Gantt timeline shared by the RR and MLFQ panels.
 * Renders intervals, idle hatch, playhead, and a clickable axis. Purely
 * presentational — all data comes from the recorded simulation result.
 */
export function MiniTimeline({
  result,
  processIds,
  duration,
  selectedTime,
  onSelectTime,
  label,
}: {
  result: SimulationResult;
  processIds: readonly string[];
  duration: number;
  selectedTime: number;
  onSelectTime: (time: number) => void;
  label: string;
}) {
  const svgW = 520;
  const innerW = svgW - PAD_LEFT - PAD_RIGHT;
  const scale = innerW / Math.max(duration, 1);
  const svgH = PAD_TOP + LANE_H + AXIS_H;

  const tickStep = niceStep(duration);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickStep) ticks.push(t);

  const active =
    result.gantt.find((g) => g.start <= selectedTime && selectedTime < g.end) ?? null;

  const handleAxisClick = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left - PAD_LEFT;
    const t = Math.max(0, Math.min(duration, Math.round(relX / scale)));
    onSelectTime(t);
  };

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="h-auto w-full min-w-[280px]"
        role="img"
        aria-label={`${label} CPU timeline`}
      >
        <defs>
          <pattern
            id={`mini-hatch-${label}`}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="4" height="4" fill="#fafafa" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="#d4d4d8" strokeWidth="1" />
          </pattern>
        </defs>
        <text x={0} y={PAD_TOP + LANE_H / 2 + 3} fontSize={9} fontWeight={600} fill="#52525b">
          {label}
        </text>
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={innerW}
          height={LANE_H}
          fill="#fafafa"
          stroke="#e4e4e7"
          strokeWidth={0.5}
          rx={2}
        />
        {idleIntervals(result.gantt, duration).map((idle, i) => (
          <rect
            key={`i-${i}`}
            x={PAD_LEFT + idle.start * scale}
            y={PAD_TOP + 1}
            width={Math.max(0.5, (idle.end - idle.start) * scale)}
            height={LANE_H - 2}
            fill={`url(#mini-hatch-${label})`}
            opacity={0.6}
          />
        ))}
        {result.gantt.map((g, i) => {
          const selected = g.start <= selectedTime && selectedTime < g.end;
          const x = PAD_LEFT + g.start * scale;
          const w = Math.max(1, (g.end - g.start) * scale);
          return (
            <g key={`g-${i}`}>
              <rect
                x={x}
                y={PAD_TOP + 1}
                width={w}
                height={LANE_H - 2}
                fill={colorFor(g.processId, processIds)}
                opacity={selected ? 1 : 0.8}
                stroke={selected ? "#18181b" : "transparent"}
                strokeWidth={selected ? 1.2 : 0}
                className="cursor-pointer"
                onClick={() => onSelectTime(g.start)}
              >
                <title>
                  {g.processId} [{g.start}, {g.end})
                </title>
              </rect>
              {w >= 18 && (
                <text
                  x={x + w / 2}
                  y={PAD_TOP + LANE_H / 2 + 3}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={500}
                  fill="#fff"
                  pointerEvents="none"
                >
                  {g.processId}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={PAD_LEFT + selectedTime * scale}
          y1={PAD_TOP - 1}
          x2={PAD_LEFT + selectedTime * scale}
          y2={PAD_TOP + LANE_H + 1}
          stroke="#18181b"
          strokeWidth={1.2}
        />
        {/* Clickable axis strip for scrubbing */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP + LANE_H + AXIS_H - 4}
          width={innerW}
          height={6}
          fill="transparent"
          className="cursor-pointer"
          onClick={handleAxisClick}
        />
        {(() => {
          const y = PAD_TOP + LANE_H + 3;
          return (
            <g>
              <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT + innerW} y2={y} stroke="#a1a1aa" />
              {ticks.map((t) => (
                <g key={t} transform={`translate(${PAD_LEFT + t * scale},0)`}>
                  <line y1={y} y2={y + 3} stroke="#a1a1aa" />
                  <text y={y + 11} textAnchor="middle" fontSize={8} fill="#71717a">
                    {t}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}
      </svg>
      {active && (
        <p className="mt-0.5 text-[9px] text-zinc-500">
          {active.processId ?? "idle"} running [{active.start}, {active.end})
        </p>
      )}
    </div>
  );
}

function idleIntervals(
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

function niceStep(duration: number): number {
  const raw = duration / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}
