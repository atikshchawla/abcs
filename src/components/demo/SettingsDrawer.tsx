"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AbcsConfigInput } from "@/lib/model/types";
import { DEFAULT_ABCS_CONFIG } from "@/lib/schedulers/abcs";
import { configParamLabel } from "@/lib/demo/compare";

interface EditableParam {
  readonly key: keyof AbcsConfigInput;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly hint: string;
  readonly group: string;
}

const EDITABLE: readonly EditableParam[] = [
  // Behaviour estimation
  { key: "emaAlpha", min: 0.05, max: 1, step: 0.05, hint: "Smoothing for behaviour EMAs. Higher = more reactive, lower = smoother.", group: "Behaviour estimation" },
  { key: "cpuDemandDivisor", min: 1, max: 32, step: 1, unit: "ticks", hint: "Burst length that scores C = 1.0.", group: "Behaviour estimation" },
  { key: "ioRateWindowCpuTicks", min: 1, max: 50, step: 1, unit: "ticks", hint: "Window for I/O-blocks-per-N-CPU-ticks rate.", group: "Behaviour estimation" },
  // Responsiveness & priority
  { key: "responsivenessCpuWeight", min: 0, max: 1, step: 0.05, hint: "Weight of (1−C) in R. Must pair with I/O weight ≤ 1.", group: "Responsiveness & priority" },
  { key: "responsivenessIoWeight", min: 0, max: 1, step: 0.05, hint: "Weight of I in R.", group: "Responsiveness & priority" },
  { key: "priorityBehaviorWeight", min: 0, max: 200, step: 5, hint: "Multiplier on R in the priority formula.", group: "Responsiveness & priority" },
  { key: "priorityFairnessWeight", min: 0, max: 100, step: 5, hint: "Multiplier on the waiting-time fairness term.", group: "Responsiveness & priority" },
  { key: "fairnessWaitDivisor", min: 1, max: 50, step: 1, unit: "ticks", hint: "READY wait that yields the full fairness contribution.", group: "Responsiveness & priority" },
  // Quantum bands
  { key: "quantumHighThreshold", min: 0.1, max: 1, step: 0.05, hint: "R ≥ this → high-responsiveness quantum.", group: "Quantum bands" },
  { key: "quantumMidThreshold", min: 0.05, max: 0.95, step: 0.05, hint: "R ≥ this → middle quantum band.", group: "Quantum bands" },
  { key: "quantumHigh", min: 1, max: 16, step: 1, unit: "ticks", hint: "Quantum for the high-responsiveness band.", group: "Quantum bands" },
  { key: "quantumMid", min: 1, max: 16, step: 1, unit: "ticks", hint: "Quantum for the middle band.", group: "Quantum bands" },
  { key: "quantumLow", min: 1, max: 32, step: 1, unit: "ticks", hint: "Quantum for the batch band.", group: "Quantum bands" },
  // Transition detection
  { key: "transitionThreshold", min: 0.05, max: 0.9, step: 0.05, hint: "EMA divergence that triggers transition candidacy.", group: "Transition detection" },
  { key: "transitionPersistence", min: 1, max: 10, step: 1, unit: "obs", hint: "Consecutive observations required to confirm.", group: "Transition detection" },
  { key: "transitionCooldown", min: 1, max: 100, step: 1, unit: "ticks", hint: "Hysteresis after a confirmed transition.", group: "Transition detection" },
  { key: "transitionBaselineAlpha", min: 0.01, max: 0.5, step: 0.01, hint: "Baseline EMA alpha used by the transition detector.", group: "Transition detection" },
  // Stability
  { key: "stabilitySettlePeriod", min: 0, max: 50, step: 1, unit: "ticks", hint: "Freeze quantum changes after an adjustment.", group: "Stability controls" },
];

type Draft = Partial<Record<keyof AbcsConfigInput, number | boolean>>;

/**
 * Right-side slide-over drawer for editing ABCS experimental parameters.
 *
 * - Draft starts from current applied config (or defaults).
 * - Sticky header with title + close; sticky footer with action buttons.
 * - Scrollable body with grouped numeric inputs (bounds + step).
 * - Validation rejects invalid combinations (not silently clamped).
 * - "Apply & Run" is the only action that commits; "Discard Changes"
 *   reverts the draft and closes; "Reset to Defaults" reloads defaults
 *   into the draft without applying.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
  appliedConfig,
  running,
  onApplyAndRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently applied config (null = defaults). */
  appliedConfig: Partial<AbcsConfigInput> | null;
  running: boolean;
  onApplyAndRun: (config: Partial<AbcsConfigInput>) => void;
}) {
  const [draft, setDraft] = useState<Draft>({});

  // Reset draft whenever the drawer opens so it starts from applied config.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setDraft(appliedConfig ? { ...appliedConfig } : {});
    }, 0);
    return () => clearTimeout(t);
  }, [open, appliedConfig]);

  // Diff draft against the APPLIED config (not defaults) so that:
  // - reopening with a custom config and changing nothing is NOT dirty.
  // - changing a value back to the default IS dirty (committable).
  const appliedKey = useMemo(
    () => JSON.stringify(appliedConfig ?? {}),
    [appliedConfig],
  );
  const activeDiff = useMemo(() => {
    const applied = appliedConfig ?? {};
    const out: { key: keyof AbcsConfigInput; label: string; from: number; to: number }[] = [];
    for (const p of EDITABLE) {
      const appliedVal = (applied[p.key] as number | undefined) ?? (DEFAULT_ABCS_CONFIG[p.key] as number);
      const draftVal = (draft[p.key] as number | undefined) ?? appliedVal;
      if (draftVal !== appliedVal) {
        out.push({ key: p.key, label: configParamLabel(p.key), from: appliedVal, to: draftVal });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, appliedKey]);
  const isDirty = activeDiff.length > 0;

  const setNum = (key: keyof AbcsConfigInput, v: number) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const validate = useCallback((): string | null => {
    // Weight sum check.
    const c = Number(
      draft.responsivenessCpuWeight ?? DEFAULT_ABCS_CONFIG.responsivenessCpuWeight,
    );
    const i = Number(
      draft.responsivenessIoWeight ?? DEFAULT_ABCS_CONFIG.responsivenessIoWeight,
    );
    if (c + i > 1.0001) {
      return `R weights must sum to ≤ 1 (currently ${c.toFixed(2)} + ${i.toFixed(2)} = ${(c + i).toFixed(2)}).`;
    }
    // Quantum threshold ordering.
    const hi = Number(
      draft.quantumHighThreshold ?? DEFAULT_ABCS_CONFIG.quantumHighThreshold,
    );
    const mid = Number(
      draft.quantumMidThreshold ?? DEFAULT_ABCS_CONFIG.quantumMidThreshold,
    );
    if (hi <= mid) {
      return "High-responsiveness threshold must be strictly greater than the low threshold.";
    }
    // Bounds check for every numeric draft key.
    for (const p of EDITABLE) {
      const v = draft[p.key];
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < p.min || n > p.max) {
        return `${configParamLabel(p.key)} must be between ${p.min} and ${p.max} (got ${n}).`;
      }
    }
    return null;
  }, [draft]);

  const validationError = validate();

  const groups = useMemo(() => {
    const map = new Map<string, EditableParam[]>();
    for (const p of EDITABLE) {
      const arr = map.get(p.group) ?? [];
      arr.push(p);
      map.set(p.group, arr);
    }
    return [...map.entries()];
  }, []);

  const handleApply = () => {
    if (validationError) return;
    // Even an empty draft is valid: it means "revert to defaults".
    onApplyAndRun(draft as Partial<AbcsConfigInput>);
    onOpenChange(false);
  };

  const handleDiscard = () => {
    setDraft(appliedConfig ? { ...appliedConfig } : {});
    onOpenChange(false);
  };

  const handleReset = () => {
    // Load defaults into the draft. Apply stays enabled so the user
    // can commit the revert (empty draft = defaults).
    setDraft({});
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[380px] flex-col border-l border-zinc-200 bg-white shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-950 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
          aria-describedby={undefined}
        >
          {/* Sticky header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div>
              <Dialog.Title className="text-sm font-semibold">
                ABCS Settings
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[10px] text-zinc-500">
                Editable experimental parameters. Invalid values are rejected.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                aria-label="Close settings"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {isDirty && (
              <div className="mb-3 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <span className="font-medium">Unsaved changes.</span>
                <span>
                  {activeDiff.length} parameter{activeDiff.length === 1 ? "" : "s"} differ from the last applied config.
                </span>
              </div>
            )}

            {validationError && (
              <div role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {validationError}
              </div>
            )}

            <div className="space-y-4">
              {groups.map(([groupName, params]) => (
                <fieldset key={groupName} className="space-y-2">
                  <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    {groupName}
                  </legend>
                  {params.map((p) => {
                    const appliedVal =
                      ((appliedConfig?.[p.key] as number | undefined) ??
                        (DEFAULT_ABCS_CONFIG[p.key] as number));
                    const cur = (draft[p.key] as number | undefined) ?? appliedVal;
                    const changed = cur !== appliedVal;
                    return (
                      <label key={p.key} className="block">
                        <span className="flex items-baseline justify-between text-[10px]">
                          <span className="font-medium text-zinc-600 dark:text-zinc-400">
                            {configParamLabel(p.key)}
                            {p.unit && (
                              <span className="ml-0.5 text-zinc-400">({p.unit})</span>
                            )}
                          </span>
                          {changed && (
                            <span className="text-[9px] text-amber-600 dark:text-amber-400">
                              was {appliedVal}
                            </span>
                          )}
                        </span>
                        <div className="mt-0.5 flex items-center gap-2">
                          <input
                            type="range"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={cur}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v)) setNum(p.key, v);
                            }}
                            className="h-1 flex-1 cursor-pointer accent-zinc-900 dark:accent-zinc-100"
                            aria-label={configParamLabel(p.key)}
                          />
                          <input
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={cur}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v)) setNum(p.key, v);
                            }}
                            title={p.hint}
                            className={`h-7 w-16 rounded border px-1.5 text-right text-xs tabular-nums dark:bg-zinc-900 ${
                              changed
                                ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                                : "border-zinc-300 dark:border-zinc-700"
                            }`}
                          />
                        </div>
                        <span className="mt-0.5 block text-[9px] leading-tight text-zinc-400">
                          {p.hint}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          </div>

          {/* Sticky footer */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
            <button
              type="button"
              onClick={handleApply}
              disabled={running || !!validationError}
              className="h-8 rounded-md bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {running ? "Running…" : "Apply & Run"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={EDITABLE.every((p) => (draft[p.key] as number | undefined) === undefined || draft[p.key] === DEFAULT_ABCS_CONFIG[p.key])}
              className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Reset to Defaults
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="h-8 rounded-md px-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Discard Changes
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
