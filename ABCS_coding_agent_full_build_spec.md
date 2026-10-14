# ABCS --- Complete Coding-Agent Build Specification

> Build a complete, runnable Adaptive Behaviour-Aware CPU Scheduler
> project in this repository. It must simulate real scheduling
> decisions, visualize the resulting trace, compare ABCS against
> baselines on identical workloads, and produce a reproducible report.
> Do not stop at scaffolding or a pretty static dashboard.

## 0. Decisions and non-negotiable rules

**Product:** Adaptive Behaviour-Aware CPU Scheduler (ABCS).

**Initial architecture:** Use **Next.js + TypeScript for the whole
initial application**, including the discrete-event simulation engine,
scheduling algorithms, benchmark runner, and visualization. This avoids
a separate C++/Node integration boundary and makes the first version
easier to run and debug. This is a simulator, not a real OS kernel
scheduler; never claim it changes the host machine's actual process
scheduling.

**Stack:** Next.js App Router, React, strict TypeScript, Tailwind CSS,
Recharts for charts, custom SVG/HTML for the CPU Gantt chart, Vitest for
tests, and a small validation library such as Zod if useful. No
database, external API, authentication, paid service, Docker, or
machine-learning service is required.

Rules: 1. The simulator and metrics must be real. Never hard-code
results or make charts that only look plausible. 2. Every algorithm must
receive the exact same workload definition in a comparison. 3. The
adaptive policy must be inspectable; record its inputs, decision, and
explanation. 4. Do not claim ABCS is better unless benchmark results
support that precise claim. 5. Build small modules, not one giant React
page containing simulation logic. 6. After each milestone, run tests,
type checking, lint, and production build as applicable. 7. No fake
buttons, fake data presented as real, unfinished TODOs in required
flows, or dead-end controls. 8. Inspect the initialized repository first
and preserve working configuration. Use its existing package manager. 9.
Work autonomously on minor choices, document decisions, and continue
rather than repeatedly asking the user. 10. The app should run locally
on a typical Windows machine with Node.js.

## 1. Objective and research question

ABCS investigates whether runtime behaviour estimates,
workload-transition detection, stability controls, and fairness
safeguards can improve responsiveness across mixed/changing CPU
workloads.

Research question:

> Can behaviour-aware scheduling with workload-transition detection and
> stability controls improve responsiveness on mixed and changing
> workloads without unacceptable regressions in fairness, throughput, or
> scheduling stability?

This is a hypothesis, not a promised result. A meaningful outcome may
include trade-offs or a finding that the current policy does not improve
performance.

Out of scope initially: real OS processes, kernel changes, Linux
`sched_ext`, distributed simulation, reinforcement learning,
machine-learning APIs, accounts, and database persistence.

## 2. Required user experience

Create a polished, practical technical dashboard. Prioritize legibility,
responsive layout, useful explanations, and correct interactions over
decorative effects.

### Routes

**`/` --- Overview** - Project name and short explanation. - Links to
Simulation, Compare, and Methodology. - A Run Demo action. - Latest
benchmark summary only if it comes from a real completed run; otherwise
show "Not run yet."

**`/simulation` --- Simulator** - Workload selector and editable
workload configuration. - Algorithm selector: RR, MLFQ, ABCS. - Run,
Pause, Step, Restart, playback-speed and time/event scrubber controls. -
Current simulated time and status. - CPU Gantt chart, process-state
table, behaviour-score panel for ABCS, decision/event log, final
metrics. - Playback can replay a completed trace; true wall-clock
execution is not required.

**`/compare` --- Algorithm comparison** - Run RR, MLFQ, and ABCS against
the exact same workload. - Select predefined or custom workloads. -
Metric table and charts for response time, waiting time, turnaround
time, throughput, fairness, context switches, CPU utilization, and
adaptation delay where applicable. - Show absolute values, percentage
differences where meaningful, direction of improvement, sample count,
configuration, and variability. - Never display mock numbers as real
results.

**`/methodology` --- Explanations** - What is simulated and what is
not. - RR, MLFQ, and ABCS rules. - Behaviour signals, EMA, transition
detection and stability. - Metric definitions, benchmark methodology,
limitations, and interpretation guidance.

A benchmark-history route is optional and must not delay required
functionality.

## 3. Suggested project structure

Adapt to the repository's existing structure rather than blindly
replacing it.

``` text
src/
  app/
    page.tsx
    layout.tsx
    simulation/page.tsx
    compare/page.tsx
    methodology/page.tsx
    api/simulate/route.ts
    api/compare/route.ts
  components/
    layout/
    simulation/
      SimulationControls.tsx
      WorkloadEditor.tsx
      CpuGanttChart.tsx
      ProcessTable.tsx
      BehaviourPanel.tsx
      EventLog.tsx
      MetricsSummary.tsx
    comparison/
      MetricsTable.tsx
      ComparisonCharts.tsx
  lib/
    model/types.ts
    model/validation.ts
    simulation/engine.ts
    simulation/eventQueue.ts
    simulation/processState.ts
    simulation/metrics.ts
    simulation/trace.ts
    schedulers/types.ts
    schedulers/roundRobin.ts
    schedulers/mlfq.ts
    schedulers/abcs.ts
    behaviour/ema.ts
    behaviour/observations.ts
    behaviour/behaviourModel.ts
    behaviour/transitionDetector.ts
    workloads/builtIn.ts
    workloads/generator.ts
    experiments/benchmarkRunner.ts
    experiments/aggregation.ts
    experiments/report.ts
  tests/
    unit/
    integration/
public/examples/
README.md
IMPLEMENTATION_STATUS.md
```

Do not create dozens of empty files up front. Build a tested vertical
slice first, then split modules as responsibilities become clear.

## 4. Simulation model

Use a deterministic **discrete-event simulator** with integer simulated
time (choose milliseconds or abstract time units and use consistently).

### Process definition

Each process has a stable ID, name, arrival time, ordered CPU/I/O
phases, current phase and remaining duration, state, CPU service, READY
waiting time, first start time, completion time, state history, runtime
observations, behaviour-score history, and scheduler metadata.

Example workload:

``` json
{
  "name": "Mixed demo",
  "processes": [
    {
      "id": "P1",
      "arrivalTime": 0,
      "phases": [
        { "type": "CPU", "duration": 12 },
        { "type": "IO", "duration": 18 },
        { "type": "CPU", "duration": 5 }
      ]
    },
    {
      "id": "P2",
      "arrivalTime": 2,
      "phases": [
        { "type": "CPU", "duration": 4 },
        { "type": "IO", "duration": 8 },
        { "type": "CPU", "duration": 7 }
      ]
    }
  ]
}
```

The schema can be improved but must be typed, documented, and validated.
Show helpful errors for invalid input.

### States

-   `NEW`: not yet arrived
-   `READY`: eligible and waiting for CPU
-   `RUNNING`: currently executing
-   `BLOCKED`: waiting for I/O completion
-   `TERMINATED`: all phases completed

A process must be in exactly one state. Enforce valid transitions.

### Events

At minimum: `PROCESS_ARRIVAL`, `DISPATCH`, `QUANTUM_EXPIRED`,
`CPU_BURST_COMPLETE`, `IO_START`, `IO_COMPLETE`, `PREEMPTION`,
`PROCESS_TERMINATED`, `BEHAVIOUR_UPDATE`, `TRANSITION_DETECTED`,
`POLICY_ADJUSTMENT`, and `IDLE_INTERVAL`.

Each event needs timestamp, type, affected process ID when relevant, and
useful metadata. Record algorithm and decision reason where relevant.

### Simultaneous event ordering

Define deterministic ordering. Suggested convention at time `t`: 1.
Complete CPU/I/O phases ending at `t`. 2. Process I/O completions and
arrivals. 3. Update observations due at `t`. 4. Add newly ready
processes to queues. 5. Apply transition logic and fairness aging. 6.
Dispatch if the CPU is idle.

Use one convention for all algorithms and test it.

### Correctness invariants

-   Simulated time never moves backwards.
-   At most one process runs on the CPU.
-   BLOCKED and TERMINATED processes never run.
-   CPU service never exceeds a process's total CPU demand.
-   Completed processes have first-start and completion timestamps.
-   Busy time plus idle time equals elapsed measured time.
-   Valid workloads do not cause infinite loops.
-   Invalid workloads fail clearly.
-   Same-time events are handled deterministically.

## 5. Common scheduler interface and information boundaries

Use a common typed interface so the simulation engine is
algorithm-agnostic. It should support initialization, selecting the next
READY process, choosing a dispatch quantum/budget, receiving
dispatch/execution/preemption/burst-completion/I/O notifications, and
providing decision explanations and display metadata.

**Critical information boundary:** The scheduler may use current state
and past/current observations only. The simulator knows future phase
durations to advance time, but that information must not leak into
scheduler decisions. Do not let any policy inspect future CPU or I/O
phase durations, benchmark scenario names, hidden process labels, or
expected results.

## 6. Required baseline algorithms

### Round Robin (RR)

-   Configurable fixed quantum.
-   FIFO ready queue.
-   A process that exhausts its quantum and remains READY goes to the
    back of the queue.
-   CPU burst completion advances to I/O or termination.
-   I/O completion returns the process to READY.
-   Define arrival/completion ordering consistently.
-   Define and test context-switch counting, including idle-to-process
    transitions.

### Multilevel Feedback Queue (MLFQ)

Implement a conventional documented variant: - Default 3 queues. -
Higher queues have shorter quanta. - New processes enter the top
queue. - A process that consumes its full quantum without blocking is
demoted. - Document treatment of processes that block for I/O. - Lower
queues run only when higher-priority queues are empty. - Use periodic
priority boosts or aging to limit starvation. - Parameters remain fixed
across repeated runs unless a documented tuning experiment changes them.

Do not claim MLFQ is universally optimal.

## 7. ABCS behaviour model

ABCS must be transparent, testable, and small enough to explain. Do not
begin with ML.

### Observed signals

-   Completed CPU burst durations.
-   How frequently a process blocks for I/O after running.
-   Observed I/O waiting duration.
-   Recent CPU service over a defined observation window.
-   Changes in those signals over time.

Track READY waiting time separately for fairness/aging; it is not direct
proof that a process is interactive.

### EMA

Use:

\[ EMA_t = `\alpha `{=tex}x_t + (1-`\alpha`{=tex})EMA\_{t-1} \]

where `x_t` is a normalized observation, `EMA_t` is the smoothed
estimate, and `alpha` is in `(0, 1]`. Explicitly handle the first
observation and normalization ranges. Expose defaults in a typed
configuration object and document that they are tunable, not universal
truths.

### Continuous behaviour scores

Maintain scores in `[0, 1]`, at minimum: - `cpuDemandScore` -
`ioActivityScore` - `latencySensitivityScore`

Scores need not sum to 1. These are estimates, not ground truth.
Document exact formulas in code and on the Methodology page. Avoid
unexplained magic numbers; keep weights and thresholds in one
configuration object.

Do not infer a semantic `backgroundScore` from CPU/I/O behaviour alone.
Evaluation labels may describe test scenarios, but the scheduler must
not receive hidden labels as input.

## 8. Transition detection and stability controls

Candidate research component; do not claim novelty without a prior-art
review.

Initial mechanism: 1. Maintain smoothed recent behaviour and a
longer-term baseline. 2. Compare them for a meaningful change. 3.
Require the change to cross a configurable threshold and persist for
multiple observations. 4. Use hysteresis or a cooldown so noise does not
cause constant mode switching. 5. Log detections and policy adjustments
with timestamps and reasons.

Transition detection and stability controls must be independently
switchable for ablation studies: - behaviour-aware policy without
transition detection; - transition detection without stability
controls; - full transition detection with stability controls.

The detector must infer transitions from observations. It may not use a
hidden transition marker or scenario name to make decisions. Known
transition timestamps are permitted only for evaluation of
detection/adaptation delay.

## 9. First ABCS policy

Implement one conservative, inspectable adaptive policy: 1. An effective
priority combining observed latency-sensitivity evidence with **bounded
READY-wait aging**. 2. An adaptive quantum selected from a small bounded
set based on observed behaviour; use past observations only. 3. A
transition-aware response when a sustained change is detected. 4.
Stability control that limits oscillation and allows the policy to
settle. 5. Fairness safeguards so long-waiting processes make progress.

The exact score and quantum rules must be explicit and unit-tested. Do
not add a dozen unvalidated heuristics. It is better to have one
defensible mechanism than many unexplained rules.

Put EMA alpha, observation interval, transition threshold, persistence
count, cooldown, min/max quantum, aging parameters, and any weights in
one typed configuration object.

Use development scenarios for tuning and held-out scenarios/seeds for
final evaluation. Do not tune against the same held-out results later
reported as unbiased evidence.

## 10. Metrics and definitions

Use one metrics module for every algorithm and unit-test it.

For process `p`, let arrival be `A_p`, first CPU start `S_p`, completion
`C_p`, and total CPU demand `B_p`.

-   **Response time:** `S_p - A_p`.
-   **Turnaround time:** `C_p - A_p`.
-   **Waiting time:** total time in READY (not time blocked for I/O).
-   **CPU service:** time actually executed.
-   **I/O blocked time:** total time in BLOCKED.
-   **Average/median response time**
-   **95th-percentile response time**
-   **Average waiting time**
-   **Average turnaround time**
-   **Throughput:** completed processes divided by a clearly defined
    elapsed measurement interval.
-   **CPU utilization:** CPU busy time / total measured time.
-   **Context switches:** use a documented rule, identical for every
    algorithm.
-   **Maximum READY waiting time**
-   **Fairness:** Jain's index may be used only with a clearly defined
    comparable per-process quantity, such as normalized CPU service
    share; explain limitations and do not apply it blindly to arbitrary
    metrics.
-   **Adaptation delay:** for a transition workload, time from known
    transition time to a predefined measurable adapted condition.
-   **Policy-change frequency:** material adaptive policy changes per
    unit simulated time.

Handle processes that do not start or finish explicitly; do not silently
omit them. Explain whether lower or higher is better for each metric.
CPU utilization alone does not prove a scheduler is better.

## 11. Required built-in scenarios

Each scenario must be deterministic, named, selectable, described, and
genuinely simulated: 1. Short Jobs. 2. CPU Heavy. 3. I/O Heavy. 4. Mixed
Workload. 5. CPU → I/O Transition. 6. I/O → CPU Transition. 7. Bursty
Arrivals. 8. Noisy Observations, No True Transition. 9. Long Job Under
Contention. 10. Starvation Stress. 11. Overloaded Arrivals. 12. Idle
Gaps.

For transition scenarios, store the transition timestamp for evaluation
only. Also implement seeded random workload generation. Same seed + same
config must generate the same workload.

Do not make every workload artificially favour ABCS. Include cases where
RR or MLFQ performs equally well or better.

## 12. Benchmark runner and evidence

### Same-workload rule

Create one immutable workload and run every selected algorithm on that
exact workload. Keep arrivals, phases, stop rules, metric definitions,
and measurement intervals identical.

### Repeated runs

-   Support a quick demo mode.
-   Support a final benchmark mode with at least 30 deterministic random
    seeds by default.
-   Report sample count, mean, standard deviation, median/percentiles as
    useful.
-   Export raw per-run results.
-   Use held-out seeds for final reported results.

### Ablation studies

Compare: 1. RR. 2. MLFQ. 3. ABCS without transition detection. 4. ABCS
with transition detection but without stability controls. 5. Full ABCS.

### Tuning

Provide a documented parameter sweep on development workloads only. Keep
a separate held-out set for final evaluation. Record parameters,
scenarios, seeds, repetitions, and failed/excluded runs.

### Meaningful improvement

Do not define success as winning every metric. The evaluation target
is: - better response time or tail response time in specified
mixed/transition cases; - no unacceptable fairness or maximum-wait
regression; - throughput and turnaround trade-offs reported; - noisy
scenarios do not cause excessive policy changes; - results persist
across held-out seeds, not only one hand-picked case.

Choose numerical tolerances after inspecting baseline scale but
**before** final holdout runs. If ABCS fails, report it honestly and
revise based on evidence. Never fabricate results or hard-code a winner.

### Comparison presentation

Show absolute values, percentage changes where meaningful, sample count,
variability, workload/configuration, and direction of improvement.
Report both wins and regressions. Avoid one composite "winner score"
unless its weights are explicit and justified.

## 13. Visualization requirements

### CPU Gantt chart

The primary visualization must show: - horizontal simulated-time axis; -
CPU execution intervals labeled with process IDs; - idle intervals; -
quantum-expiry/preemption boundaries; - CPU burst completion and I/O
blocking markers; - transition/policy-adjustment markers; - hover/click
details: start, end, duration, process, event; - scrolling or zoom for
long traces.

Generate it from actual simulation events. Do not create an unrelated
decorative timeline.

### Process table

Show process ID, state at selected replay time, arrival, CPU service,
READY waiting, I/O blocked time, response time when known,
completion/turnaround when known, and queue/effective priority when
relevant. Selecting a process should highlight its timeline and history.

### Behaviour panel

For ABCS, plot CPU-demand, I/O-activity, and latency-sensitivity scores.
Optionally show raw and EMA-smoothed observations. Mark detections and
policy changes. Clearly distinguish raw observations, smoothed signals,
scores, and scheduler decisions. Do not imply RR/MLFQ use ABCS scores.

### Decision log

Each row shows time, event, process, and a truthful reason,
e.g. "selected: highest effective priority among READY processes" or
"quantum expired: returned to queue." Text must correspond to real
engine decisions.

### Playback controls

Implement play/pause, step to next event, restart, speed selector,
time/event scrubber, and jump to next transition. Replay should use a
recorded trace and consistent state reconstruction; do not allow
timer-driven UI state to drift from the trace.

### UX quality

Responsive laptop layout, useful labels/tooltips, keyboard-focusable
controls, readable units, state indicators not dependent on color alone,
and complete loading/empty/error states.

## 14. Data flow and API

Prefer typed internal modules first. API routes may be used for long
simulations. If expensive work would block the browser, use a server
route or Web Worker and document the choice.

Suggested routes: - `POST /api/simulate`: workload + algorithm + config
→ trace and metrics. - `POST /api/compare`: workload + algorithms + run
config → comparable results.

Validate inputs and limit process count, phase duration, event count,
and benchmark repetitions to prevent hangs.

Example response shape (define exact types centrally):

``` json
{
  "runId": "generated-id",
  "algorithm": "ABCS",
  "workloadName": "Mixed demo",
  "configuration": {},
  "summary": {},
  "processMetrics": [],
  "events": [],
  "behaviourHistory": [],
  "completed": true
}
```

A simple completed-trace replay is enough for v1. No database is needed.
Add progress/cancellation feedback for long benchmarks.

## 15. Required tests

Use Vitest and make the test command work.

### Unit tests

-   EMA initialization/update.
-   Normalization boundaries and zero-range input.
-   Valid process state transitions.
-   Arrival and I/O completion.
-   RR FIFO order and quantum expiry.
-   MLFQ demotion, boosts/aging, and I/O rules.
-   ABCS score calculation and quantum bounds.
-   Transition persistence, cooldown/hysteresis, and noisy-signal
    handling.
-   Fairness aging.
-   Every metric formula.
-   Seeded workload determinism.
-   Same-time event ordering.

### Integration tests

-   Each algorithm completes small known workloads.
-   Metrics match hand-calculated expected values.
-   BLOCKED/TERMINATED processes never run.
-   CPU service never exceeds demand.
-   Algorithms do not mutate the shared input workload.
-   Same seed/config returns same output.
-   All algorithms produce valid traces.
-   Compare endpoint reports every requested algorithm.
-   Invalid workloads produce useful errors.
-   Transition detection occurs only when its defined conditions are
    satisfied.

Add a quick smoke benchmark that runs all three algorithms on at least
three scenarios.

At each milestone run type checking, tests, lint, and production build.
Fix failures before proceeding.

## 16. Implementation order --- mandatory milestone gates

Do not build everything in one giant untested pass.

### M1 --- Inspect and prepare

Inspect repo; preserve existing config; confirm Next.js, TypeScript,
Tailwind and App Router; add README and `IMPLEMENTATION_STATUS.md`.
**Gate:** dev server and production build work.

### M2 --- Types and simulator

Implement workload/process/event types, state machine, event ordering,
RR, metrics, and hand-calculated tests. **Gate:** simulator tests pass
before building the full dashboard.

### M3 --- Baselines and ABCS

Implement MLFQ, observations/EMA, scores, adaptive policy, transition
detection, stability and fairness controls, decision explanations, and
ablation flags. **Gate:** all algorithms produce valid traces for the
same workloads.

### M4 --- Scenarios and benchmarks

Implement built-in workloads, seeded generator, benchmark runner,
aggregation, raw export, and ablations. **Gate:** smoke benchmark
succeeds and report is generated from actual outputs.

### M5 --- Dashboard simulation page

Build layout/navigation, workload/algorithm selection,
run/restart/playback, Gantt chart, process table, and event log.
**Gate:** changing algorithm/workload visibly changes the actual trace
and metrics.

### M6 --- Behaviour and comparison

Add behaviour charts, transition/policy markers, compare page,
methodology page, and CSV/JSON export. **Gate:** users can inspect the
same workload under RR, MLFQ and ABCS.

### M7 --- Tune and evaluate

Use development scenarios for tuning, run ablations, freeze parameters,
run held-out seeds, and generate the evidence-based report. **Gate:**
report contains actual output, sample counts, regressions and wins.

### M8 --- Hardening

Test invalid input, large workload handling, error states, replay
controls and responsive layout. Run type check, tests, lint, production
build; complete README and status checklist. **Gate:** a clean checkout
runs with documented commands and no fake required flows.

## 17. README and generated report

The README must include: - project purpose and scope; - prerequisites,
installation, exact commands; - how to run a simulation and compare
algorithms; - algorithm rules and default parameters; - metric
definitions; - scenario and seed methodology; - how to reproduce the
final report; - tests; - limitations and trade-offs.

Generate a report from actual benchmark output with: 1. Summary and
sample count. 2. Parameters, seeds, and scenarios. 3. Absolute metrics
and percentage changes. 4. Per-scenario wins/regressions. 5. Ablation
results. 6. Fairness and tail latency. 7. Transition detections and
policy-change frequency on noisy workloads. 8. Reproduction
instructions. 9. Simulator limitations. 10. Evidence-based conclusion.

Never make up data to fill missing results.

## 18. Definition of done

### Engine

-   [ ] RR, MLFQ and ABCS work and are tested.
-   [ ] CPU/I/O phases, arrivals, blocking, preemption and termination
    work.
-   [ ] State machine invariants are enforced.
-   [ ] Metrics are calculated, not hard-coded.
-   [ ] Decision explanations are recorded.
-   [ ] Same workload is usable across all algorithms.
-   [ ] Fixed seed/config produces deterministic output.

### Adaptive mechanism

-   [ ] Behaviour estimates use past/current observations only.
-   [ ] Score formulas and EMA are documented.
-   [ ] Future phase durations and hidden workload labels do not leak
    into policy.
-   [ ] Transition detector and stability controls are implemented.
-   [ ] Fairness safeguard is implemented and tested.
-   [ ] Ablation modes isolate the contribution of components.

### Dashboard

-   [ ] Overview, Simulation, Compare and Methodology work.
-   [ ] Gantt chart uses actual events.
-   [ ] Replay controls work.
-   [ ] Process state table follows the selected replay time.
-   [ ] Behaviour history and decision log match the engine.
-   [ ] Comparisons use identical workload inputs.
-   [ ] Metrics, raw data export, errors and invalid inputs work.

### Evidence and quality

-   [ ] Required deterministic scenarios and seeded generator exist.
-   [ ] Repeated benchmark and ablation runs work.
-   [ ] Development and holdout evaluation are separate.
-   [ ] Final report uses real data and states sample counts.
-   [ ] Both improvements and regressions are reported.
-   [ ] Tests, type check, lint and production build pass.
-   [ ] README and `IMPLEMENTATION_STATUS.md` are complete.
-   [ ] No fake metrics, fake controls, or unfinished TODOs remain in
    required flows.

## 19. Instructions to the coding agent

Work autonomously, but follow the milestone gates: 1. Inspect the
current repository before editing. 2. Create/update
`IMPLEMENTATION_STATUS.md`. 3. Complete M1 and run checks, then continue
sequentially. 4. Prefer small, complete, tested vertical slices. 5.
After each milestone, record files changed, commands run, observed
test/build results, and remaining checklist items. 6. Never claim a
command passed unless it was actually run and succeeded. 7. Debug broken
functionality; do not replace it with a mock. 8. Keep dependencies
minimal and preserve working code. 9. Continue until acceptance criteria
are met or a genuine blocker is documented with the exact reason and
remaining work.

**First task:** inspect the repository and complete M1. Then implement
the simulator and tests before building the full UI. The goal is a
demonstrably working project whose performance claims are backed by
experiments---not just an attractive frontend.
