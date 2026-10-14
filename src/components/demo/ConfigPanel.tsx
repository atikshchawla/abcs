"use client";

import { useState } from "react";
import type { AbcsConfigInput } from "@/lib/model/types";
import { DEFAULT_ABCS_CONFIG } from "@/lib/schedulers/abcs";
import { configParamLabel, diffAbcsConfig } from "@/lib/demo/compare";

interface EditableParam {
  readonly key: keyof AbcsConfigInput;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly hint: string;
}

/** Only numeric, tunable parameters are exposed for editing. */
const EDITABLE: readonly EditableParam[] = [
  { key: "emaAlpha", min: 0.05, max: 1, step: 0.05, hint: "Smoothing factor for behaviour EMAs. Higher = more reactive, lower = smoother." },
  { key: "cpuDemandDivisor", min: 1, max: 32, step: 1, unit: "ticks", hint: "Burst length that scores C = 1.0." },
  { key: "ioRateWindowCpuTicks", min: 1, max: 50, step: 1, unit: "ticks", hint: "Window for I/O-blocks-per-N-CPU-ticks rate." },
  { key: "responsivenessCpuWeight", min: 0, max: 1, step: 0.05, hint: "Weight of (1−C) in R. Must pair with I/O weight ≤ 1." },
  { key: "responsivenessIoWeight", min: 0, max: 1, step: 0.05, hint: "Weight of I in R." },
  { key: "priorityBehaviorWeight", min: 0, max: 200, step: 5, hint: "Multiplier on R in the priority formula." },
  { key: "priorityFairnessWeight", min: 0, max: 100, step: 5, hint: "Multiplier on the waiting-time fairness term." },
  { key: "fairnessWaitDivisor", min: 1, max: 50, step: 1, unit: "ticks", hint: "READY wait that yields the full fairness contribution." },
  { key: "quantumHighThreshold", min: 0.1, max: 1, step: 0.05, hint: "R ≥ this → high-responsiveness quantum." },
  { key: "quantumMidThreshold", min: 0.05, max: 0.95, step: 0.05, hint: "R ≥ this → middle quantum band." },
  { key: "quantumHigh", min: 1, max: 16, step: 1, unit: "ticks", hint: "Quantum for the high-responsiveness band." },
  { key: "quantumMid", min: 1, max: 16, step: 1, unit: "ticks", hint: "Quantum for the middle band." },
  { key: "quantumLow", min: 1, max: 32, step: 1, unit: "ticks", hint: "Quantum for the batch band." },
  { key: "transitionThreshold", min: 0.05, max: 0.9, step: 0.05, hint: "EMA divergence that triggers transition candidacy." },
  { key: "transitionPersistence", min: 1, max: 10, step: 1, unit: "obs", hint: "Consecutive observations required to confirm." },
  { key: "transitionCooldown", min: 1, max: 100, step: 1, unit: "ticks", hint: "Hysteresis after a confirmed transition." },
  { key: "stabilitySettlePeriod", min: 0, max: 50, step: 1, unit: "ticks", hint: "Freeze quantum changes after an adjustment." },
];

type Draft = Partial<Record<keyof AbcsConfigInput, number | boolean>>;

export function ConfigPanel({
  onRunWithConfig,
  onRunDefault,
  running,
  lastCustomDiff,
}: {
  onRunWithConfig: (draft: Partial<AbcsConfigInput>) => void;
  onRunDefault: () => void;
  running: boolean;
  lastCustomDiff: { key: keyof AbcsConfigInput; label: string; from: number; to: number }[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [showCompare, setShowCompare] = useState(false);

  const activeDiff = diffAbcsConfig(draft as Partial<AbcsConfigInput>);
  const isDirty = activeDiff.length > 0;

  const setNum = (key: keyof AbcsConfigInput, v: number) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const reset = () => setDraft({});

  const validate = (): string | null => {
    if (draft.responsivenessCpuWeight !== undefined || draft.responsivenessIoWeight !== undefined) {
      const c = Number(draft.responsivenessCpuWeight ?? DEFAULT_ABCS_CONFIG.responsivenessCpuWeight);
      const i = Number(draft.responsivenessIoWeight ?? DEFAULT_ABCS_CONFIG.responsivenessIoWeight);
      if (c + i > 1.0001) {
        return `R weights must sum to ≤ 1 (currently ${c.toFixed(2)} + ${i.toFixed(2)} = ${(c + i).toFixed(2)}).`;
      }
    }
    if (draft.quantumHighThreshold !== undefined && draft.quantumMidThreshold !== undefined) {
      const hi = Number(draft.quantumHighThreshold);
      const mid = Number(draft.quantumMidThreshold);
      if (hi <= mid) {
        return "High-responsiveness threshold must be strictly greater than the low threshold.";
      }
    }
    return null;
  };

  const validationError = validate();

  return (
    <section
      aria-label="ABCS configuration"
      className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        aria-expanded={open}
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        ABCS Configuration
        {isDirty && (
          <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            modified
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <p className="mb-2 text-[10px] text-zinc-500">
            Editable experimental parameters. Defaults are the values shipped in{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">DEFAULT_ABCS_CONFIG</code>.
            Invalid values are rejected, not silently clamped.
          </p>

          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {EDITABLE.map((p) => {
              const def = DEFAULT_ABCS_CONFIG[p.key] as number;
              const cur = (draft[p.key] as number | undefined) ?? def;
              const changed = draft[p.key] !== undefined && cur !== def;
              return (
                <label key={p.key} className="flex flex-col gap-0.5">
                  <span className="flex items-baseline justify-between text-[10px]">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">
                      {configParamLabel(p.key)}
                      {p.unit && <span className="ml-0.5 text-zinc-400">({p.unit})</span>}
                    </span>
                    {changed && (
                      <span className="text-[9px] text-amber-600 dark:text-amber-400">
                        was {def}
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={cur}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setNum(p.key, v);
                    }}
                    title={p.hint}
                    className={`h-7 rounded border px-1.5 text-xs tabular-nums dark:bg-zinc-950 ${
                      changed
                        ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                        : "border-zinc-300 dark:border-zinc-700"
                    }`}
                  />
                  <span className="text-[9px] leading-tight text-zinc-400">{p.hint}</span>
                </label>
              );
            })}
          </div>

          {validationError && (
            <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {validationError}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRunWithConfig(draft as Partial<AbcsConfigInput>)}
              disabled={running || !isDirty || !!validationError}
              className="h-7 rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {running ? "Running…" : "Run with config"}
            </button>
            <button
              type="button"
              onClick={onRunDefault}
              disabled={running}
              className="h-7 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Run defaults
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={!isDirty}
              className="h-7 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({});
                setOpen(false);
              }}
              className="h-7 rounded-md px-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Cancel
            </button>
            {lastCustomDiff && lastCustomDiff.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCompare((s) => !s)}
                className="ml-auto h-7 rounded-md border border-violet-300 px-3 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"
              >
                {showCompare ? "Hide" : "Show"} default vs custom
              </button>
            )}
          </div>

          {showCompare && lastCustomDiff && lastCustomDiff.length > 0 && (
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Last run — parameters that differed from default
              </p>
              <ul className="space-y-0.5">
                {lastCustomDiff.map((d) => (
                  <li key={d.key} className="text-[10px] text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium">{d.label}</span>: {d.from} → {d.to}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-zinc-500">
                Results in the main view are from that custom run. Press{" "}
                <strong>Run defaults</strong> to restore the baseline configuration.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
