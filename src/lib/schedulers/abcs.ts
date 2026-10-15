import type {
  AbcsConfigInput,
  AbcsDecisionRecord,
  AbcsProcessContribution,
  AlgorithmId,
  BehaviourHistorySample,
  ProcessDefinition,
  SimulationEvent,
} from "@/lib/model/types";
import type {
  PreemptionDecision,
  ProcessDisplayMeta,
  ReadyProcessView,
  Scheduler,
  Selection,
} from "@/lib/schedulers/types";
import { ProcessObservationModel } from "@/lib/behaviour/observations";
import { TransitionDetector } from "@/lib/behaviour/transitionDetector";

/**
 * Default ABCS configuration.
 *
 * All weights/thresholds are tunable experimental parameters, not
 * proven-optimal values. Formulas (see AbcsConfigInput docs):
 *
 *   C = clamp(EMA(CPU burst) / 8, 0, 1)
 *   I = clamp(EMA(I/O blocks per 10 CPU ticks), 0, 1)
 *   R = 0.6·(1−C) + 0.4·I
 *
 *   Priority = 70·R + 10·(READY wait / 4)
 *
 *   Quantum: R ≥ 0.65 → 2 · R ≥ 0.35 → 4 · else → 6
 */
export const DEFAULT_ABCS_CONFIG: AbcsConfigInput = {
  emaAlpha: 0.3,
  cpuDemandDivisor: 8,
  ioRateWindowCpuTicks: 10,
  responsivenessCpuWeight: 0.6,
  responsivenessIoWeight: 0.4,
  priorityBehaviorWeight: 70,
  priorityFairnessWeight: 10,
  fairnessWaitDivisor: 4,
  quantumHighThreshold: 0.65,
  quantumMidThreshold: 0.35,
  quantumHigh: 2,
  quantumMid: 4,
  quantumLow: 6,
  transitionThreshold: 0.25,
  transitionPersistence: 3,
  transitionCooldown: 20,
  transitionBaselineAlpha: 0.05,
  stabilitySettlePeriod: 10,
  enableTransitionDetection: true,
  enableStabilityControls: true,
};

export function resolveAbcsConfig(partial?: Partial<AbcsConfigInput>): AbcsConfigInput {
  if (!partial) return DEFAULT_ABCS_CONFIG;
  return { ...DEFAULT_ABCS_CONFIG, ...partial };
}

/**
 * ABCS — Adaptive Behaviour-Aware CPU Scheduler.
 *
 * One transparent, rule-based policy. Every dispatch records the full
 * internal decision (scores, per-process contributions, quantum reason)
 * so the UI can explain the actual decision without guessing.
 *
 * Selection: highest Priority = 70·R + 10·(wait/4); ties by FIFO order.
 * Adaptive quantum from R bands. Transition detection resets quantum to
 * the middle level; stability controls freeze further quantum changes
 * briefly after an adjustment.
 */
export class AbcsScheduler implements Scheduler {
  readonly algorithm: AlgorithmId = "ABCS";
  private readonly cfg: AbcsConfigInput;
  private readonly models = new Map<string, ProcessObservationModel>();
  private readonly detector: TransitionDetector;
  private readonly history: BehaviourHistorySample[] = [];
  private readonly pendingEvents: SimulationEvent[] = [];
  private readonly decisionRecords: AbcsDecisionRecord[] = [];
  private currentQuantumLevel: 0 | 1 | 2 = 1; // middle by default
  private quantumLockedUntil = -Infinity;
  private lastTransitionTime = -Infinity;
  private lastPolicyNotes: string[] = [];

  constructor(cfg?: Partial<AbcsConfigInput>) {
    this.cfg = resolveAbcsConfig(cfg);
    this.detector = new TransitionDetector(this.cfg);
  }

  init(processes: readonly Pick<ProcessDefinition, "id" | "arrivalTime">[]): void {
    for (const p of processes) {
      this.models.set(p.id, new ProcessObservationModel(this.cfg));
    }
  }

  onArrival(time: number, processId: string): void {
    if (!this.models.has(processId)) {
      this.models.set(processId, new ProcessObservationModel(this.cfg));
    }
    this.pushHistory(time, processId, "process arrived");
  }

  onDispatch(time: number, processId: string, quantum: number): void {
    void quantum;
    this.pushHistory(time, processId, `dispatched (quantum level ${this.currentQuantumLevel})`);
  }

  onCpuExecuted(): void {
    // Service accrual is handled by the engine; behaviour observations
    // are event-driven (burst completions / IO completions).
  }

  onBurstComplete(
    time: number,
    processId: string,
    burstLength: number,
    enteredIO: boolean,
  ): void {
    const model = this.model(processId);
    model.recordBurst(burstLength, enteredIO);
    this.pushHistory(time, processId, undefined, burstLength, model.emaBurstLength);

    if (this.cfg.enableTransitionDetection) {
      const detection = this.detector.observe(time, burstLength, enteredIO);
      if (detection) {
        this.lastTransitionTime = time;
        this.pendingEvents.push({
          time,
          type: "TRANSITION_DETECTED",
          algorithm: "ABCS",
          processId,
          reason: `sustained deviation in ${detection.metric}: recent=${detection.recent.toFixed(3)} baseline=${detection.baseline.toFixed(3)} dev=${detection.deviation.toFixed(3)}`,
          metadata: {
            metric: detection.metric,
            recent: detection.recent,
            baseline: detection.baseline,
            deviation: detection.deviation,
          },
        });
        this.lastPolicyNotes.push(
          `t=${time} transition detected (${detection.metric}): recent=${detection.recent.toFixed(2)} vs baseline=${detection.baseline.toFixed(2)}`,
        );
        // Transition-aware response: reset to the middle quantum level.
        const settle = this.cfg.enableStabilityControls
          ? this.cfg.stabilitySettlePeriod
          : 0;
        if (time >= this.quantumLockedUntil) {
          if (this.currentQuantumLevel !== 1) {
            this.currentQuantumLevel = 1;
            this.pendingEvents.push({
              time,
              type: "POLICY_ADJUSTMENT",
              algorithm: "ABCS",
              reason: `transition detected: adaptive quantum reset to middle level (${this.cfg.quantumMid} ticks)`,
            });
            this.lastPolicyNotes.push(
              `t=${time} policy adjustment: quantum reset to ${this.cfg.quantumMid} ticks`,
            );
          }
          if (settle > 0) {
            this.quantumLockedUntil = time + settle;
          }
        }
      }
    }
  }

  onIOComplete(time: number, processId: string, ioWaitDuration: number): void {
    this.model(processId).recordIOWait(ioWaitDuration);
    this.pushHistory(time, processId, `IO completed (waited ${ioWaitDuration})`);
  }

  onQuantumExpired(time: number, processId: string): void {
    this.pushHistory(time, processId, "quantum expired; requeued");
  }

  onProcessEnd(time: number, processId: string): void {
    this.pushHistory(time, processId, "terminated");
    this.models.delete(processId);
  }

  selectProcess(time: number, ready: readonly ReadyProcessView[]): Selection {
    if (ready.length === 0) {
      return { processId: null, quantum: 0, reason: "ready queue empty" };
    }

    // Compute priority for every READY process and record the breakdown.
    const contributions: AbcsProcessContribution[] = ready.map((view) => {
      const scores = this.model(view.id).scores;
      const readyWait =
        view.currentReadyWait > 0 ? view.currentReadyWait : view.totalReadyWait;
      const behaviorContribution = this.cfg.priorityBehaviorWeight * scores.latencySensitivityScore;
      const fairnessContribution =
        (this.cfg.priorityFairnessWeight * readyWait) / this.cfg.fairnessWaitDivisor;
      return {
        processId: view.id,
        cpuDemandScore: scores.cpuDemandScore,
        ioActivityScore: scores.ioActivityScore,
        responsivenessScore: scores.latencySensitivityScore,
        readyWait,
        behaviorContribution,
        fairnessContribution,
        totalPriority: behaviorContribution + fairnessContribution,
      };
    });

    // Highest priority wins; ties broken by FIFO order (stable sort).
    let bestIdx = 0;
    for (let i = 1; i < contributions.length; i++) {
      if (contributions[i].totalPriority > contributions[bestIdx].totalPriority) {
        bestIdx = i;
      }
    }
    const best = contributions[bestIdx];
    const sorted = [...contributions].sort((a, b) => b.totalPriority - a.totalPriority);

    const { quantum, quantumReason } = this.quantumFor(best.processId, time);
    const scores = this.model(best.processId).scores;

    const reason =
      `selected: highest priority ${best.totalPriority.toFixed(1)} ` +
      `(behaviour ${best.behaviorContribution.toFixed(1)} = ${this.cfg.priorityBehaviorWeight}×R(${scores.latencySensitivityScore.toFixed(2)}), ` +
      `fairness ${best.fairnessContribution.toFixed(1)} = ${this.cfg.priorityFairnessWeight}×wait(${best.readyWait})/${this.cfg.fairnessWaitDivisor}) ` +
      `among ${ready.length} READY process(es); quantum ${quantum} (${quantumReason})`;

    const transitionDetected = time - this.lastTransitionTime < 5;
    const record: AbcsDecisionRecord = {
      time,
      selectedProcessId: best.processId,
      quantum,
      quantumReason,
      reason,
      contributions: sorted,
      transitionDetected,
      policyNotes: [...this.lastPolicyNotes],
    };
    this.decisionRecords.push(record);
    this.lastPolicyNotes = [];

    return { processId: best.processId, quantum, reason };
  }

  shouldPreempt(
    time: number,
    currentProcessId: string,
    ready: readonly ReadyProcessView[],
  ): PreemptionDecision {
    if (ready.length === 0) {
      return { preempt: false, reason: "no READY processes" };
    }
    // Score the incumbent with the SAME formula as challengers. A running
    // process has currentReadyWait = 0 (it is not READY), so its fairness
    // term is 0 — but the formula is identical, avoiding the asymmetric
    // comparison where challengers got a free fairness advantage.
    const currentScores = this.model(currentProcessId).scores;
    const currentPriority =
      this.cfg.priorityBehaviorWeight * currentScores.latencySensitivityScore +
      0; // running process: currentReadyWait = 0
    let bestPriority = -Infinity;
    let bestId = "";
    for (const view of ready) {
      const scores = this.model(view.id).scores;
      const readyWait =
        view.currentReadyWait > 0 ? view.currentReadyWait : view.totalReadyWait;
      const p =
        this.cfg.priorityBehaviorWeight * scores.latencySensitivityScore +
        (this.cfg.priorityFairnessWeight * readyWait) / this.cfg.fairnessWaitDivisor;
      if (p > bestPriority) {
        bestPriority = p;
        bestId = view.id;
      }
    }
    // Preempt only when the newcomer is clearly better (margin avoids
    // ping-pong from tiny fairness differences).
    const margin = this.cfg.priorityFairnessWeight * (this.cfg.fairnessWaitDivisor / 2);
    if (bestPriority > currentPriority + margin) {
      return {
        preempt: true,
        reason: `preempt: ${bestId} priority ${bestPriority.toFixed(1)} exceeds current ${currentPriority.toFixed(1)} + margin ${margin.toFixed(1)}`,
      };
    }
    return {
      preempt: false,
      reason: `no READY process exceeds current priority ${currentPriority.toFixed(1)} + margin ${margin.toFixed(1)}`,
    };
  }

  getProcessDisplay(processId: string): ProcessDisplayMeta | undefined {
    const model = this.models.get(processId);
    if (!model) return undefined;
    return {
      scores: model.scores,
      adaptiveQuantum: this.currentQuantum(),
    };
  }

  getBehaviourHistory(): BehaviourHistorySample[] {
    return this.history;
  }

  getDecisionRecords(): AbcsDecisionRecord[] {
    return this.decisionRecords;
  }

  /** Drain engine-agnostic pending events (transition/policy logs). */
  drainPendingEvents(): SimulationEvent[] {
    const out = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    return out;
  }

  get lastTransition(): number {
    return this.lastTransitionTime;
  }

  private model(processId: string): ProcessObservationModel {
    let m = this.models.get(processId);
    if (!m) {
      m = new ProcessObservationModel(this.cfg);
      this.models.set(processId, m);
    }
    return m;
  }

  private currentQuantum(): number {
    if (this.currentQuantumLevel === 0) return this.cfg.quantumHigh;
    if (this.currentQuantumLevel === 1) return this.cfg.quantumMid;
    return this.cfg.quantumLow;
  }

  private quantumFor(processId: string, time: number): { quantum: number; quantumReason: string } {
    const locked = time < this.quantumLockedUntil;
    if (locked) {
      return {
        quantum: this.currentQuantum(),
        quantumReason: `stability lock (level ${this.currentQuantumLevel}, ${this.currentQuantum()} ticks) until t=${this.quantumLockedUntil}`,
      };
    }

    const scores = this.model(processId).scores;
    const R = scores.latencySensitivityScore;
    let level: 0 | 1 | 2;
    let band: string;
    if (R >= this.cfg.quantumHighThreshold) {
      level = 0;
      band = `R=${R.toFixed(2)} ≥ ${this.cfg.quantumHighThreshold} → high-responsiveness band`;
    } else if (R >= this.cfg.quantumMidThreshold) {
      level = 1;
      band = `R=${R.toFixed(2)} in [${this.cfg.quantumMidThreshold}, ${this.cfg.quantumHighThreshold}) → middle band`;
    } else {
      level = 2;
      band = `R=${R.toFixed(2)} < ${this.cfg.quantumMidThreshold} → batch band`;
    }

    if (level !== this.currentQuantumLevel) {
      this.currentQuantumLevel = level;
      if (this.cfg.enableStabilityControls) {
        this.quantumLockedUntil = time + this.cfg.stabilitySettlePeriod;
      }
      this.pendingEvents.push({
        time,
        type: "POLICY_ADJUSTMENT",
        algorithm: "ABCS",
        reason: `adaptive quantum → level ${level} (${this.currentQuantum()} ticks): ${band}`,
        metadata: { level, quantum: this.currentQuantum() },
      });
      this.lastPolicyNotes.push(
        `t=${time} quantum adjusted to ${this.currentQuantum()} ticks: ${band}`,
      );
    }
    return { quantum: this.currentQuantum(), quantumReason: band };
  }

  private pushHistory(
    time: number,
    processId: string,
    note?: string,
    rawBurst?: number,
    emaBurst?: number | null,
  ): void {
    const model = this.models.get(processId);
    if (!model) return;
    this.history.push({
      time,
      processId,
      scores: model.scores,
      ...(rawBurst !== undefined ? { rawBurstLength: rawBurst } : {}),
      ...(emaBurst !== null && emaBurst !== undefined
        ? { emaBurstLength: emaBurst }
        : {}),
      ...(note !== undefined ? { note } : {}),
    });
  }
}
