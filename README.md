# ABCS — Adaptive Behaviour-Aware CPU Scheduler

A discrete-event simulator that studies whether runtime behaviour
estimates, workload-transition detection, stability controls, and
fairness safeguards can improve responsiveness on mixed and changing
CPU workloads. ABCS is compared against Round Robin (RR) and Multilevel
Feedback Queue (MLFQ) baselines on identical workloads.

> **Scope:** This is a *simulator*, not a real OS kernel scheduler. It
> never changes the host machine's actual process scheduling. All time
> is integer simulated time units ("ticks").

## Prerequisites

- Node.js 22+ (developed on v22.16)
- npm 11+

## Installation

```bash
npm install
```

## Commands

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start the development server                 |
| `npm run build`     | Production build                             |
| `npm run start`     | Serve the production build                   |
| `npm run lint`      | ESLint                                       |
| `npm run typecheck` | TypeScript type checking (no emit)           |
| `npm test`          | Run all Vitest tests once                    |
| `npm run test:watch`| Run tests in watch mode                      |

## Using the app

The app is a **single-page interactive demo** at `/` (root), optimized
for a 1366×768 laptop viewport. It runs RR, MLFQ, and ABCS on the same
workload and provides:

- **ABCS primary section (full width):** decision summary bar; large
  CPU timeline with idle hatch, quantum-expiry dashes, and
  transition/policy markers; an **interactive React Flow pipeline**
  (Observe → Estimate Behaviour → Calculate Priority → Select Process →
  Execute → Update) that renders real per-decision values from the
  simulation trace — behaviour score bars, priority ranking chart with
  winner highlight, quantum band rationale, and policy notes; a compact
  C/I/R behaviour-history chart with selected-decision and transition
  markers.
- **RR and MLFQ panels (two columns below):** mini timelines on the
  same time scale, FIFO/queue explanations, and a short comparison with
  ABCS at the same simulated time.
- **Results summary:** avg response / waiting / turnaround, completed
  count, subtle best-of highlight, and an auto-generated honest
  comparison sentence.
- **ABCS Configuration panel (collapsed by default):** edit 17 numeric
  parameters (EMA alpha, burst divisor, R weights, priority/fairness
  multipliers, quantum bands, transition thresholds, …) with
  validation, Reset to Defaults, and Run with config. RR/MLFQ
  baselines are never affected by ABCS config changes. A "default vs
  custom" diff is shown after a custom run.
- **Decision playback:** Prev / Play / Next / Reset / Jump-to-first-
  transition, synchronized across the ABCS timeline, React Flow stage,
  behaviour chart, and both baseline panels.

The previous `/simulation`, `/compare`, and `/methodology` routes
redirect to `/`.

Long or repeated benchmark work can also be driven through:

- `POST /api/simulate` — one workload + one algorithm → trace + metrics.
- `POST /api/compare` — one workload + many algorithms → comparable results.

## Algorithms (summary)

- **Round Robin (RR):** FIFO ready queue, fixed configurable quantum.
  A process that exhausts its quantum and remains READY returns to the
  queue tail.
- **Multilevel Feedback Queue (MLFQ):** 3 queues; higher queues use
  shorter quanta. New processes enter the top queue. A process that
  consumes a full quantum without blocking is demoted. Processes that
  block for I/O return to the top queue. Periodic priority boosts
  prevent starvation.
- **ABCS:** behaviour-aware adaptive policy. Per-process scores from
  exponential moving averages (α = 0.3) of observed signals:
  - **C** (CPU demand) = clamp(EMA(CPU burst length) / 8, 0, 1)
  - **I** (I/O activity) = clamp(EMA(I/O blocks per 10 CPU ticks), 0, 1)
  - **R** (responsiveness) = 0.6·(1 − C) + 0.4·I

  Priority = **70·R + 10·(READY wait / 4)**; ties broken FIFO. Adaptive
  quantum from R bands: R ≥ 0.65 → 2 ticks · R ≥ 0.35 → 4 ticks · else
  6 ticks. Transition detection (fast/slow EMA divergence, persistence,
  cooldown) resets quantum to the middle band; stability controls
  freeze further quantum changes briefly after an adjustment. Every
  dispatch records the full internal decision (per-process C/I/R,
  behaviour/fairness contributions, quantum rationale) for the UI.

## Metrics (summary)

Response time, turnaround time, waiting time (READY only), CPU
service, I/O blocked time, throughput, CPU utilization, context
switches, maximum READY wait, fairness (Jain's index on normalized
CPU service), adaptation delay, and policy-change frequency. Full
definitions live in `src/lib/simulation/metrics.ts`.

## Scenarios and seeds

Twelve deterministic built-in scenarios (short jobs, CPU-heavy,
I/O-heavy, mixed, transitions, bursty, noisy, starvation stress,
overload, idle gaps, …) plus a seeded random workload generator. The
same seed + config always generates the same workload. Final benchmark
results use held-out seeds that are never used for tuning. The demo
page also includes four compact demo workloads (mixed, CPU-heavy,
I/O-heavy, and a CPU→I/O transition case).

## Tests

```bash
npm test
```

Unit tests cover EMA, state transitions, scheduler ordering, metrics
formulas, transition detection, and seeded generation. Integration
tests cover complete algorithm runs, invariants, determinism, decision
recording, and the compare pipeline.

## Limitations

- Single simulated CPU; no multicore, cache, or memory hierarchy.
- Abstract time units; not calibrated to real wall-clock milliseconds.
- ABCS behaviour scores are estimates from observed signals only —
  they are not ground truth and do not sum to 1.
- All weights (70, 10), divisors (8, 10, 4), EMA α (0.3), quantum
  bands (2/4/6), and transition thresholds are tunable experimental
  parameters, not proven-optimal values.
- Scheduler decisions use only past/current observations; future phase
  durations are known to the simulator engine only.
- Results depend on workload design; ABCS is not claimed to be
  universally better than RR or MLFQ.

## License

Private project. See repository history for details.
