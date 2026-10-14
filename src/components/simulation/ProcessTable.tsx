"use client";

import type { ProcessReplayState } from "@/lib/simulation/replay";
import type { AlgorithmId } from "@/lib/model/types";

const STATE_STYLES: Record<string, string> = {
  NEW: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  READY: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  RUNNING: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  BLOCKED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  TERMINATED: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function ProcessTable(props: {
  processes: Readonly<Record<string, ProcessReplayState>>;
  selectedProcess: string | null;
  onSelectProcess: (id: string | null) => void;
  algorithm: AlgorithmId;
}) {
  const rows = Object.values(props.processes).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

  return (
    <section
      aria-label="Process table"
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Processes (state at replay time)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700">
              <th className="py-1 pr-2 font-medium">ID</th>
              <th className="py-1 pr-2 font-medium">State</th>
              <th className="py-1 pr-2 font-medium">Arr</th>
              <th className="py-1 pr-2 font-medium">CPU</th>
              <th className="py-1 pr-2 font-medium">Wait</th>
              <th className="py-1 pr-2 font-medium">CurWait</th>
              <th className="py-1 pr-2 font-medium">IO</th>
              <th className="py-1 pr-2 font-medium">Resp</th>
              <th className="py-1 pr-2 font-medium">Done</th>
              <th className="py-1 font-medium">TAT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const selected = props.selectedProcess === p.id;
              return (
                <tr
                  key={p.id}
                  onClick={() => props.onSelectProcess(selected ? null : p.id)}
                  className={`cursor-pointer border-b border-zinc-100 dark:border-zinc-800 ${
                    selected ? "bg-zinc-100 dark:bg-zinc-800" : ""
                  }`}
                  aria-selected={selected}
                >
                  <td className="py-1 pr-2 font-mono font-medium">{p.id}</td>
                  <td className="py-1 pr-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${STATE_STYLES[p.state] ?? ""}`}
                    >
                      {/* Shape indicator so state is not color-only. */}
                      <span aria-hidden="true">{stateGlyph(p.state)}</span>
                      {p.state}
                    </span>
                  </td>
                  <td className="py-1 pr-2 tabular-nums">{p.arrivalTime}</td>
                  <td className="py-1 pr-2 tabular-nums">
                    {p.cpuService}/{p.totalCpuDemand}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">{p.readyWaitTime}</td>
                  <td className="py-1 pr-2 tabular-nums">{p.currentReadyWait}</td>
                  <td className="py-1 pr-2 tabular-nums">{p.ioBlockedTime}</td>
                  <td className="py-1 pr-2 tabular-nums">
                    {p.firstStartTime !== null ? p.firstStartTime - p.arrivalTime : "—"}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">
                    {p.completionTime !== null ? p.completionTime : "—"}
                  </td>
                  <td className="py-1 tabular-nums">
                    {p.completionTime !== null
                      ? p.completionTime - p.arrivalTime
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Click a row to highlight its timeline. CPU = served/demand · Wait = total READY
        time · CurWait = current READY episode · Resp = first start − arrival · TAT =
        completion − arrival.
      </p>
    </section>
  );
}

function stateGlyph(state: string): string {
  switch (state) {
    case "RUNNING":
      return "▶";
    case "READY":
      return "●";
    case "BLOCKED":
      return "⏸";
    case "TERMINATED":
      return "✓";
    default:
      return "○";
  }
}
