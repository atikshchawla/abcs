# Implementation Status

Living checklist tracking progress against
`ABCS_coding_agent_full_build_spec.md`. Update after each milestone.

## M1 — Inspect and prepare

- [x] Inspected repository (fresh Next.js 16.4.0 App Router, TS strict,
      Tailwind v4, npm package manager).
- [x] Preserved existing config (next.config.ts, eslint, tsconfig).
- [x] Verified production build works (`npm run build`).
- [x] Added README.md and this status file.
- [x] Installed Vitest + Zod + Recharts; added `test`/`typecheck` scripts.

**Gate:** dev server and production build work. ✔

## M2 — Types and simulator

- [x] Workload/process/event types + Zod validation.
- [x] Process state machine with enforced transitions.
- [x] Deterministic event queue and simultaneous-event ordering.
- [x] Simulation engine.
- [x] Round Robin scheduler.
- [x] Metrics module.
- [x] Unit tests: state machine, RR ordering, metrics formulas,
      same-time ordering, hand-calculated traces.

**Gate:** simulator tests pass before building the full dashboard. ✔

## M3 — Baselines and ABCS

- [x] MLFQ scheduler (3 queues, demotion, I/O rule, boosts).
- [x] Behaviour observations + EMA.
- [x] Continuous behaviour scores (cpuDemand, ioActivity,
      latencySensitivity).
- [x] Transition detector (threshold, persistence, cooldown).
- [x] Stability controls + fairness aging.
- [x] Adaptive quantum selection.
- [x] Decision explanations.
- [x] Ablation flags (no-transition, no-stability, full).
- [x] Tests for scores, quantum bounds, persistence, cooldown, aging.

**Gate:** all algorithms produce valid traces for the same workloads. ✔

## M4 — Scenarios and benchmarks

- [x] 12 built-in deterministic scenarios.
- [x] Seeded random workload generator (deterministic).
- [x] Benchmark runner (demo + multi-seed modes).
- [x] Aggregation (mean, std, median, percentiles).
- [x] Raw per-run export.
- [x] Ablation comparison runner.
- [x] Smoke benchmark integration test.

**Gate:** smoke benchmark succeeds and report is generated from
actual outputs. ✔

## M5 — Dashboard simulation page

- [x] Layout/navigation shell.
- [x] Workload selector + editor.
- [x] Algorithm selector.
- [x] Run/pause/step/restart/speed/scrubber controls.
- [x] CPU Gantt chart from real events.
- [x] Process state table at selected replay time.
- [x] Event/decision log.
- [x] Metrics summary.
- [x] API route `/api/simulate` with validation limits.

**Gate:** changing algorithm/workload visibly changes the actual trace
and metrics. ✔

## M6 — Behaviour and comparison

- [x] Behaviour score panel with detections/policy markers.
- [x] Compare page (table + charts, same workload, % deltas).
- [x] Methodology page.
- [x] `/api/compare` route.
- [x] CSV/JSON export.

**Gate:** users can inspect the same workload under RR, MLFQ and ABCS. ✔

## M7 — Tune and evaluate

- [ ] Development/held-out scenario and seed split documented.
- [ ] Parameter sweep on development workloads.
- [ ] Freeze parameters.
- [ ] Ablation runs (RR, MLFQ, ABCS-noTD, ABCS-TD-noStability,
      full ABCS).
- [ ] Held-out multi-seed final run.
- [ ] Evidence-based report with wins and regressions.

**Gate:** report contains actual output, sample counts, regressions
and wins.

## M8 — Hardening

- [ ] Invalid input handling + helpful errors.
- [ ] Large workload limits (process count, durations, events).
- [ ] Error/empty/loading states in UI.
- [ ] Replay control edge cases.
- [ ] Responsive layout check.
- [ ] Type check, tests, lint, production build all pass.
- [ ] README and this checklist complete.
- [ ] No fake metrics/controls/TODOs in required flows.

**Gate:** a clean checkout runs with documented commands and no fake
required flows.

---

## Log

### 2026-10-14 — M1

- Inspected fresh create-next-app (Next.js 16.4.0, React 19.3, TS 5,
  Tailwind 4, App Router, npm).
- Kept all scaffold config; upgraded `@types/node` to ^22 for Vitest 5
  peer compatibility (runtime is Node 22).
- Added: `vitest.config.mts`, scripts (`test`, `test:watch`,
  `typecheck`), deps: vitest, @vitejs/plugin-react, jsdom,
  @testing-library/react, @testing-library/dom, vite-tsconfig-paths,
  zod, recharts.
- `npm run build` succeeded before and after dep install.

### 2026-10-14 — M2–M4 (core + baselines + scenarios)

- Built simulator core: types, Zod validation, process state machine,
  min-heap event queue (IO completions before arrivals at same tick),
  discrete-event engine, metrics (incl. Jain fairness, percentiles).
- Implemented RR, MLFQ (3 queues + boosts), ABCS (behaviour scores,
  adaptive quantum, transition detection, stability controls,
  aging).
- 12 built-in scenarios + seeded generator (mulberry32); benchmark
  runner with same-workload materialization across variants; aggregation
  with mean/std/median/percentiles and % deltas vs baseline.
- Tests grew to ~107 passing (unit + integration incl. benchmark smoke).
- Engine bug fixed: IO phase re-ran as CPU after IO completion;
  stall check now uses allTerminated() break.

### 2026-10-14 — M5–M6 (dashboard + comparison)

- `ReplayTimeline`: precomputed snapshots per event time for UI
  scrubbing; state reconstruction from events (DISPATCH, QUANTUM_EXPIRED,
  PREEMPTION, CPU_BURST_COMPLETE, IO_*, TERMINATED).
- Simulation page: workbench with workload editor (built-in scenarios
  or pasted JSON), algorithm + RR quantum selectors, play/pause/step/
  scrub/jump-to-transition controls, SVG CPU Gantt (zoom, tooltips,
  process selection), process table, ABCS behaviour panel (EMA score
  lines + transition markers), decision/event log, metrics summary
  with JSON/CSV export.
- Compare page: scenario or multi-seed generator source, variant
  checkboxes (RR/MLFQ/ABCS + ablations), same-workload runner, metrics
  table (mean ± std, n runs, % deltas with green/red direction),
  Recharts bar comparison per metric, JSON + raw-run CSV export.
- Methodology page: simulation model, algorithm descriptions with exact
  constants, full metric definitions, dev/holdout protocol, ablation
  list, limitations.
- API routes: `/api/simulate` (POST, Zod-validated), `/api/compare`
  (POST/GET, exactly-one-source validation).
- Gates: `npm run typecheck` clean; `npm test` 112 passing (10 files);
  `npm run lint` clean; `npm run build` succeeds (/, /compare,
  /methodology, /simulation, /api/simulate, /api/compare).
