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

- **`/`** — Overview, links, and a "Run Demo" action.
- **`/simulation`** — Pick a workload and algorithm (RR, MLFQ, ABCS),
  run the discrete-event simulation, and replay it with a Gantt chart,
  process table, behaviour panel, event log, and metrics.
- **`/compare`** — Run RR, MLFQ, and ABCS against the exact same
  workload and inspect metric tables and charts.
- **`/methodology`** — What is simulated, algorithm rules, behaviour
  model formulas, metric definitions, and limitations.

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
- **ABCS:** behaviour-aware adaptive policy. Tracks per-process
  behaviour scores (CPU demand, I/O activity, latency sensitivity)
  via exponential moving averages of observed signals. Selects a
  bounded adaptive quantum, combines latency-sensitivity evidence with
  READY-wait aging for effective priority, detects sustained workload
  transitions, and applies stability cooldowns and fairness safeguards.
  See `/methodology` for exact formulas and defaults.

## Metrics (summary)

Response time, turnaround time, waiting time (READY only), CPU
service, I/O blocked time, throughput, CPU utilization, context
switches, maximum READY wait, fairness (Jain's index on normalized
CPU service), adaptation delay, and policy-change frequency. Full
definitions live in `src/lib/simulation/metrics.ts` and on the
Methodology page.

## Scenarios and seeds

Twelve deterministic built-in scenarios (short jobs, CPU-heavy,
I/O-heavy, mixed, transitions, bursty, noisy, starvation stress,
overload, idle gaps, …) plus a seeded random workload generator. The
same seed + config always generates the same workload. Final benchmark
results use held-out seeds that are never used for tuning.

## Tests

```bash
npm test
```

Unit tests cover EMA, state transitions, scheduler ordering, metrics
formulas, transition detection, and seeded generation. Integration
tests cover complete algorithm runs, invariants, determinism, and the
compare pipeline.

## Limitations

- Single simulated CPU; no multicore, cache, or memory hierarchy.
- Abstract time units; not calibrated to real wall-clock milliseconds.
- ABCS behaviour scores are estimates from observed signals only —
  they are not ground truth and do not sum to 1.
- Scheduler decisions use only past/current observations; future phase
  durations are known to the simulator engine only.
- Results depend on workload design; ABCS is not claimed to be
  universally better than RR or MLFQ.

## License

Private project. See repository history for details.
