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

### 2026-10-15 — Single-page refactor (professor demo)

- Consolidated to one focused experiment page at `/`. Old
  `/simulation`, `/compare`, `/methodology` routes now redirect.
- Four curated demo workloads: Mixed, CPU-Heavy, I/O-Heavy, Changing
  (CPU→I/O transition; primary adaptation demo).
- `runDemoComparison`: runs RR, MLFQ, ABCS on the same immutable
  workload (deep-cloned per run); shared duration + process-id union.
- `extractDecisionPoints`: one point per unique DISPATCH time across
  all three algorithms; per-algorithm kind (dispatch/continuing/idle),
  plain-language reason, ABCS nearby policy events + outcome interval.
- `buildComparisonSentence`: honest %-change sentence from actual
  metrics (response/waiting/turnaround vs RR; trade-off note; MLFQ
  response note; completed-count note when incomplete). Never
  hard-codes a win.
- UI: compact header; workload select + Run Comparison; three result
  cards (avg response/waiting/turnaround, completed; subtle best-of ★);
  comparison sentence; three aligned SVG Gantt lanes (same scale,
  shared process colours, idle hatch, quantum-expiry dashed markers,
  ABCS transition/policy purple markers, click-to-select interval);
  decision panel (Prev/Next/Play + “First ABCS transition” jump) with
  RR/MLFQ/ABCS explanations; expandable behaviour scores, event log,
  per-process tables, methodology brief.
- Removed old multi-page components (CompareWorkbench,
  ComparisonCharts, MetricsTable, SimulationWorkbench, WorkloadEditor,
  SimulationControls, CpuGanttChart, MetricsSummary). Kept
  BehaviourPanel, ProcessTable, EventLog for progressive disclosure.
- API routes and simulation library untouched (modularity preserved).
- Tests: added `demo.test.ts` + `demoWorkloads.test.ts` (21 tests).
  Gates: typecheck clean; 133 tests passing (12 files); lint clean;
  production build succeeds.

### 2026-10-15 — New ABCS formulas + decision trace + UI

- Rewrote ABCS core per updated spec:
  - Scores: `C = clamp(EMA(CPU burst)/8, 0, 1)`, `I = clamp(EMA(I/O
    blocks per 10 CPU ticks), 0, 1)`, `R = 0.6(1−C) + 0.4I` (α = 0.3).
  - Priority = `70·R + 10·(READY wait / 4)`; highest wins, FIFO tie-break.
  - Quantum bands: R ≥ 0.65 → 2 · R ≥ 0.35 → 4 · else → 6 (middle on
    transition reset).
- `AbcsConfigInput` updated: removed old cap/boost/aging fields; added
  cpuDemandDivisor, ioRateWindowCpuTicks, responsiveness weights,
  priority weights, fairness divisor, quantum band thresholds/levels.
- `ProcessObservationModel` rewritten for new C/I/R formulas; burst
  EMA + per-burst I/O-blocks-per-10-CPU-ticks EMA.
- Full decision recording: `AbcsDecisionRecord` + per-process
  `AbcsProcessContribution` (C/I/R, readyWait, behaviour 70·R, fairness
  10·wait/4, total). Recorded at every `selectProcess` from actual
  internal values. Exposed via `getDecisionRecords()` on the scheduler
  and attached to `SimulationResult.decisionRecords` (empty for RR/MLFQ).
- `DecisionPanel` redesigned: six-step flow (Observe → Estimate →
  Calculate → Select → Execute → Update) with priority bar comparison
  (behaviour blue vs fairness green, selected highlighted), formula
  breakdown, quantum band label, transition/policy notes.
- `compare.ts` `buildAbcsDetail` now pulls the recorded decision by
  time (never reconstructed from guesses).
- Tests updated for new formulas; added decision-record coverage.
  Gates: typecheck clean; 136 tests passing (12 files); lint clean;
  production build succeeds.
- README updated with new ABCS rules, single-page usage, and
  experimental-parameter limitations.

### 2026-10-15 — Interactive React Flow UI + config panel

- Installed `@xyflow/react` (React Flow) for the interactive decision
  pipeline visualization.
- **DecisionFlow component**: 6 custom nodes (Observe → Estimate
  Behaviour → Calculate Priority → Select Process → Execute → Update)
  connected by animated edges. Nodes render real data from
  `AbcsDecisionRecord` (C/I/R mini-bars, priority ranking bars with
  winner highlight, quantum band reason, policy notes). Clickable
  focus stage; horizontal on ≥900px, vertical below; SSR-safe layout.
- **AbcsTimeline**: full-width single-lane ABCS Gantt (44px lane,
  idle hatch, quantum-expiry dashes, transition/policy markers,
  playhead, active-interval label).
- **BaselinePanel**: compact RR and MLFQ panels in a two-column grid
  below ABCS — each with mini timeline, FIFO/queue explanation, and a
  short comparison sentence vs ABCS at the same simulated time.
- **BehaviourChart**: Recharts step-line time-series of C/I/R scores
  with selected-decision ReferenceLine and transition markers.
- **ConfigPanel**: collapsible (closed by default) editor for 17
  numeric ABCS parameters. Labels/units/hints from the typed config;
  validation (R-weight sum, quantum thresholds); Reset / Run defaults /
  Run with config / Cancel. Modified-vs-default diff badges. Last
  custom-run diff shown for default-vs-custom comparison. `configUsed`
  badge on the header when a custom run is active.
- **runDemoComparison** extended with optional `abcsConfig` override;
  RR/MLFQ always use unchanged baselines. Added
  `runConfigComparison` (default vs custom on same workload, shared
  baselines) and `diffAbcsConfig` helpers.
- **DemoApp layout reworked** for 1366×768: compact header with
  workload select + Run + playback toolbar (Prev/Play/Next/Reset/
  Jump-to-transition) + decision counter; decision summary bar
  (t, selected process, priority, quantum, transition status, policy
  changes); ABCS primary section (summary → AbcsTimeline →
  DecisionFlow → BehaviourChart); RR/MLFQ two-column below; result
  cards + comparison sentence; expandable ABCS event log.
- Removed unused `AlignedGantts.tsx` and `DecisionPanel.tsx` (replaced
  by AbcsTimeline / DecisionFlow / BaselinePanel).
- Shared `PROCESS_COLORS` / `colorFor` extracted to
  `src/lib/demo/colors.ts`.
- Layout widened to `max-w-[1440px]` for the full-width ABCS section.
- Tests: +5 (config override determinism, baselines unaffected by ABCS
  config, runConfigComparison changed-params report, diffAbcsConfig).
  Gates: typecheck clean; 141 tests passing (12 files); lint clean;
  production build succeeds.

## Round — RR/MLFQ queue visualisations + ABCS Settings drawer (2026-01-15)

- **Installed `@radix-ui/react-dialog`** for the accessible slide-over
  drawer (focus trap, Escape, overlay, ARIA).
- **`src/lib/demo/queueReplay.ts`**: pure event-replay reconstruction
  of scheduler queue state at any simulated time.
  - `reconstructRrQueue` — rebuilds the engine FIFO ready-queue order
    and running process by replaying DISPATCH / QUANTUM_EXPIRED /
    PREEMPTION / PROCESS_ARRIVAL / IO_COMPLETE / CPU_BURST_COMPLETE /
    PROCESS_TERMINATED events. No fabricated transitions.
  - `reconstructMlfqQueues` — same plus per-level queue bucketing.
    Tracks demotion on full-quantum expiry, I/O boost to top
    (`ioBoostsToTop`), and periodic boost (every `boostInterval` global
    CPU ticks, computed from gantt busy time). Records movement history
    (demotion / io-boost / periodic-boost / arrival).
  - `nearestDispatchAt` — finds the DISPATCH nearest to a target time
    (latest at-or-before, fallback first-after) so all three algorithm
    panels stay synced by **simulated time**, not event index.
- **`MiniTimeline`** component: shared single-lane Gantt SVG (idle
  hatch, playhead, clickable axis scrub, active-interval caption) used
  by both baseline panels.
- **`SettingsDrawer`** (replaces inline `ConfigPanel`): right-side
  slide-over via Radix Dialog. Sticky header (title + close) and
  sticky footer (Apply & Run / Reset to Defaults / Discard Changes).
  Scrollable body groups 17 numeric params by concern (Behaviour
  estimation, Responsiveness & priority, Quantum bands, Transition
  detection, Stability controls). Each row has a range slider + numeric
  input with bounds; modified params show amber "was N" badge and
  highlighted border. Unsaved-changes banner and validation (R-weight
  sum ≤ 1, quantum thresholds ordered, per-param bounds). Draft resets
  from applied config on open; Discard reverts and closes; only
  Apply & Run commits.
- **`RrPanel`** (replaces `BaselinePanel` for RR): MiniTimeline +
  running-process token (colour + quantum badge) + FIFO ready-queue
  token row `[P2]→[P3]→[P1]` with head label, reconstructed from the
  event stream. Decision explanation with last-dispatch reason and
  last-trigger event. Expandable step-by-step queue history
  (DISPATCH / QUANTUM EXPIRED / IO COMPLETE / ARRIVAL / PREEMPTED).
- **`MlfqPanel`** (replaces `BaselinePanel` for MLFQ): MiniTimeline +
  running-process token with level + quantum + 3 queue lanes
  (Q0 top / Q1 middle / Q2 bottom) with colour-coded tokens in FIFO
  order, reconstructed from the event stream. Decision explanation
  with last-dispatch reason and most recent queue movement. Expandable
  movements list (demotion / io-boost / periodic-boost / arrival).
- **DemoApp reworked**: gear button in the toolbar (amber dot when a
  custom config is active) opens `SettingsDrawer`; embedded
  `ConfigPanel` removed; `BaselinePanel` replaced by `RrPanel` +
  `MlfqPanel` side by side. Time sync across the three panels via the
  shared `selectedTime` playhead and `nearestDispatchAt`.
- Removed `ConfigPanel.tsx` and `BaselinePanel.tsx`.
- Tests: +16 in `src/tests/integration/queueReplay.test.ts` (RR FIFO
  invariants, MLFQ level bucketing, determinism, nearestDispatchAt
  behaviour). Gates: typecheck clean; **157 tests passing (13 files)**;
  lint clean; production build succeeds.

## Round — UI/UX, visualization & correctness overhaul (2026-01-15)

Full audit-driven pass fixing simulation/state inconsistencies and
improving hierarchy, decision experience, timelines, RR/MLFQ education,
time-sync, behaviour chart, performance reporting, settings drawer,
playback, clutter/accessibility, and correctness. No rebuild — working
functionality preserved.

### Correctness fixes (critical)

- **C4 engine — spurious QUANTUM_EXPIRED on consecutive CPU phases**
  (`engine.ts`): `handleBurstComplete` now saves `savedQuantum =
  cpu.quantumRemaining` before zeroing; the consecutive-CPU branch
  requeues only if `savedQuantum <= 0`, else restores `cpu.processId` /
  `cpu.quantumRemaining` / `intervalStart`. Previously every non-IO
  burst completion emitted a spurious QUANTUM_EXPIRED and requeued the
  process.
- **C1 BehaviourChart fabricated merged series**: rewritten — per-process
  C/I/R series with a process selector (toggle buttons, `aria-pressed`),
  dedupes samples per time, transition markers. New props
  `processIds`, `selectedProcess`, `onSelectProcess`.
- **C3 DecisionFlow wrong empty state**: `buildAbcsDetail` now falls
  back to the latest `decisionRecords` entry at-or-before the selected
  time (not just exact dispatch match). Empty state message rewritten
  to say "No ABCS decision at this point" instead of the misleading
  "Run a comparison…".
- **H7 ABCS preemption asymmetric priority**: `abcs.ts shouldPreempt`
  now scores the incumbent with the identical formula (behaviour +
  fairness where running readyWait = 0) vs challengers; same margin
  logic retained.
- **H6 hardcoded formula constants in reason string**: `abcs.ts`
  selectProcess reason now uses `cfg.priorityBehaviorWeight` /
  `priorityFairnessWeight` / `fairnessWaitDivisor` instead of hardcoded
  70/10/4.
- **H9 queueReplay ignores IO_START (consecutive IO)**: both RR and
  MLFQ reconstruction loops now handle `IO_START` by removing the pid
  from the ready queue.
- **M3 quantum badges show granted not remaining**: `queueReplay.ts`
  now computes remaining quantum = `granted − (time − runningSince)`
  clamped to ≥ 0 for both RR and MLFQ. UI labels updated to
  `q=N left`.

### Time-sync & timelines (high)

- **New `src/lib/demo/timelineUtils.ts`**: shared `idleIntervals`,
  `niceStep`, `clampPlayhead`.
- **H2 AbcsTimeline different time scale**: now accepts
  `sharedDuration` (max span across ABCS/RR/MLFQ) so all three
  timelines align on the same axis. Playhead clamped into the lane.
  Transition markers (◆ purple) now visually distinct from
  policy-adjustment markers (▲ amber).
- **H3 MiniTimeline click-scrub math**: fixed CSS-pixel → user-unit
  conversion (`userPerCss = svgW / rect.width`) so clicks map to the
  correct simulated time. Playhead clamped. Scrub strip is a button
  with descriptive aria-label (was an inaccessible role="slider").

### State & interaction (critical/high)

- **C2 stale results on workload change**: DemoApp now auto-re-runs
  when the workload dropdown changes (guarded by a prev-ref so the
  initial mount is not double-run), preserving the active config.
- **H1 SettingsDrawer dirty-state vs applied config**: diffs now
  compare the draft against the **applied** config (not defaults), so
  reopening a custom config with no edits is not dirty, and changing a
  value back to default is dirty (committable). "was N" badge shows the
  applied value. Apply & Run is enabled whenever the draft is valid
  (empty draft = revert to defaults is a valid action). Reset to
  Defaults is enabled unless the draft already equals defaults.
- **H4 summary-bar transition global not per-decision**: added
  `decisionTransition` memo — shows the transition/policy-adjustment
  event within ±2 ticks of the selected time, with type, process, and
  time. The global `hasTransition` still gates the ↯ jump button.
- **M7 playback/pipeline sync**: playback and prev/next/reset now reset
  `focusedStage` to 3 (Select Process) for each new decision so the
  React Flow highlight stays in sync with the decision being shown.

### Accessibility & polish (medium)

- **Reduced motion**: `app/globals.css` now honours
  `prefers-reduced-motion: reduce` (disables non-essential
  animations/transitions globally).
- **Focus-visible ring**: `:focus-visible` outline (WCAG 2.4.7).
- **BehaviourChart process selector**: simplified from
  role="radio"/role="radiogroup" (without arrow-key handling, an a11y
  anti-pattern) to plain `aria-pressed` toggle buttons in a
  role="group".
- **MetricDelta / comparison sentence**: `MetricDelta` values are now
  `number | null` (no `?? 0` coercion); `buildComparisonSentence`
  rewritten with proper conjunctions, trade-off note, completed-count
  and MLFQ notes.
- **AbcsTimeline interval tooltips**: CPU intervals and idle gaps now
  have `<title>` tooltips (duration, quantum expiry, burst complete).
  Interval rects are width-clipped to the lane so long intervals never
  overflow.

### Files

- `src/lib/simulation/engine.ts` (C4)
- `src/lib/schedulers/abcs.ts` (H6, H7)
- `src/lib/demo/compare.ts` (C3, M8)
- `src/lib/demo/queueReplay.ts` (H9, M3)
- `src/lib/demo/timelineUtils.ts` (new)
- `src/components/demo/BehaviourChart.tsx` (C1 rewrite)
- `src/components/demo/AbcsTimeline.tsx` (H2)
- `src/components/demo/MiniTimeline.tsx` (H3, a11y)
- `src/components/demo/SettingsDrawer.tsx` (H1)
- `src/components/demo/DecisionFlow.tsx` (C3 empty state)
- `src/components/demo/RrPanel.tsx` (M3 label)
- `src/components/demo/MlfqPanel.tsx` (M3 label)
- `src/components/demo/DemoApp.tsx` (C2, H2, H4, M7, BehaviourChart props)
- `app/globals.css` (reduced-motion, focus-visible)

### Gates

- typecheck clean; lint clean; **157 tests passing (13 files)** (C4
  engine change did not break any existing RR/MLFQ/ABCS integration
  tests); production build succeeds.

## Round — Task-completion visibility + custom workload builder (2026-01-15)

### Task completion visibility

Clear "this task is done" indicators across the timelines and baseline
panels, derived from the engine's recorded `processFinalStates`
(completionTime / completed) — never fabricated.

- **`src/lib/demo/timelineUtils.ts`**: new `completionMarks(result)`
  (terminated processes + completion tick, sorted) and
  `completedBy(result, time)` (those finished at/before a scrub time).
- **`AbcsTimeline`**: green ✓ strip above the CPU lane at each process's
  termination tick (two-row stagger so nearby completions never
  overlap), thin connector down to the lane, colour swatch + process id,
  tooltip "T# completed all work at t=N". `PAD_TOP` raised to make room.
- **`MiniTimeline`** (RR/MLFQ): compact ✓T# markers above the lane at
  each completion tick (`PAD_TOP` raised).
- **`RrPanel` / `MlfqPanel`**: new **Completed** strip below the ready
  queue / queue lanes — green ✓ chips (colour swatch + id + `@t`)
  listing every process finished by the selected time, with a
  `n/total finished by t=…` count and a "none yet" empty state.

### Custom workload builder

- **`src/components/demo/CustomWorkloadBuilder.tsx`** (new): a form to
  define any number of tasks. Each task row has an arrival-time input
  and an ordered list of CPU/I/O phase chips (click the CPU/I/O badge to
  toggle type, inline duration input, per-phase remove). Per-task
  **+ CPU** / **+ I/O** add buttons; **+ Add task** / per-task **×**
  remove. `buildWorkload(tasks, name)` validates (arrival ≥ 0, ≥ 1 phase,
  durations ≥ 1) and converts drafts to a `Workload` with auto ids
  T1…Tn; returns `null` when invalid, with an inline warning.
- **`DemoApp`**: workload dropdown gains a **Custom…** option. When
  selected, the builder is rendered below the controls; **Run
  Comparison** runs the built custom workload (through the same
  `runDemoComparison` path as the built-ins). Editing tasks does not
  auto-run — the user presses Run. `run` now resolves the workload via
  `isCustom ? customWorkload : getDemoWorkload(id)` and reports a clear
  error if the custom draft is incomplete.

### Gates

- typecheck clean; lint clean; production build succeeds. (Vitest
  temporarily blocked by the npm `@rolldown/binding` optional-dependency
  bug on this machine — clean `node_modules` reinstall resolves it.)
