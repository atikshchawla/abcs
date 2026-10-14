import type {
  AbcsConfigInput,
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
 * All weights/thresholds live here — they are tunable engineering
 * choices, not universal truths. Development-scenario tuning may adjust
 * them; held-out evaluation must not.
 */
export const DEFAULT_ABCS_CONFIG: AbcsConfigInput = {
  emaAlpha: 0.3,
  burstNormCap: 10,
  ioNormCap: 20,
  latencyBlockingBoost: 1.0,
  quantumLevels: [2, 4, 8],
  cpuDemandQuantumThreshold: 0.6,
  latencyQuantumThreshold: 0.5,
  agingWeight: 0.02,
  agingCap: 0.5,
  latencyPriorityWeight: 1.0,
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
 * ABCS — Adaptive Behaviour-Aware CPU Scheduler (first conservative
 * policy).
 *
 * Effective priority for selection:
 *   priority = latencyPriorityWeight × latencySensitivityScore
 *            + min(agingCap, agingWeight × currentReadyWait)
 * Highest priority wins; ties broken by engine FIFO insertion order.
 * Aging is the fairness safeguard: long-waiting READY processes gain
 * bounded priority so they make progress.
 *
 * Adaptive quantum (past observations only):
 * - cpuDemandScore ≥ cpuDemandQuantumThreshold → longest level (batch).
 * - latencySensitivityScore ≥ latencyQuantumThreshold → shortest level.
 * - otherwise → middle level.
 * - On a detected transition, quantum resets to the middle level
 *   (transition-aware response).
 *
 * Stability controls:
 * - After any quantum-changing adjustment, further quantum changes are
 *   frozen for `stabilitySettlePeriod` ticks.
 * - Transition detections are suppressed during the cooldown window.
 * Both transition detection and stability controls are independently
 * switchable for ablation studies.
 */
export class AbcsScheduler implements Scheduler {
  readonly algorithm: AlgorithmId = "ABCS";
  private readonly cfg: AbcsConfigInput;
  private readonly models = new Map<string, ProcessObservationModel>();
  private readonly detector: TransitionDetector;
  private readonly history: BehaviourHistorySample[] = [];
  private readonly pendingEvents: SimulationEvent[] = [];
  private quantumLockedUntil = -Infinity;
  private currentQuantumLevel = 1; // middle by default
  private lastTransitionTime = -Infinity;

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
              reason: `transition detected: adaptive quantum reset to middle level (${this.cfg.quantumLevels[1] ?? this.cfg.quantumLevels[0]} ticks)`,
            });
          }
          if (settle > 0) {
            this.quantumLockedUntil = time + settle;
          }
        }
      }
    }
    // When transition detection is disabled (ablation), observations are
    // still recorded above for scores, but the detector is never fed.
  }

  onIOComplete(time: number, processId: string, ioWaitDuration: number): void {
    this.model(processId).recordIOWait(ioWaitDuration);
    if (this.cfg.enableTransitionDetection) {
      // IO completions do not carry a burst observation; feed only the
      // block indicator through burst-null path? Detector expects burst
      // or block observations; skip here (burst path already covers
      // block-after-burst frequency).
    }
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

    let best = ready[0];
    let bestPriority = this.priorityOf(time, best);
    for (let i = 1; i < ready.length; i++) {
      const priority = this.priorityOf(time, ready[i]);
      if (priority > bestPriority) {
        best = ready[i];
        bestPriority = priority;
      }
    }

    const quantum = this.quantumFor(best.id, time);
    const scores = this.model(best.id).scores;
    return {
      processId: best.id,
      quantum,
      reason:
        `selected: highest effective priority ${bestPriority.toFixed(3)} ` +
        `(latency=${scores.latencySensitivityScore.toFixed(2)}, aging=${this.agingOf(time, best).toFixed(3)}) ` +
        `among ${ready.length} READY process(es); quantum ${quantum}`,
    };
  }

  shouldPreempt(
    time: number,
    currentProcessId: string,
    ready: readonly ReadyProcessView[],
  ): PreemptionDecision {
    if (ready.length === 0) {
      return { preempt: false, reason: "no READY processes" };
    }
    const currentPriority = this.priorityOf(time, {
      id: currentProcessId,
      currentReadyWait: 0,
      totalReadyWait: 0,
      cpuService: 0,
      completedBursts: 0,
    });
    let best = ready[0];
    let bestPriority = this.priorityOf(time, best);
    for (let i = 1; i < ready.length; i++) {
      const p = this.priorityOf(time, ready[i]);
      if (p > bestPriority) {
        best = ready[i];
        bestPriority = p;
      }
    }
    // Only preempt when the newcomer is clearly better (strict margin
    // avoids ping-pong preemption from tiny aging differences).
    const margin = this.cfg.agingCap * 0.5;
    if (bestPriority > currentPriority + margin) {
      return {
        preempt: true,
        reason: `preempt: ${best.id} effective priority ${bestPriority.toFixed(3)} exceeds current ${currentPriority.toFixed(3)} + margin ${margin.toFixed(3)}`,
      };
    }
    return {
      preempt: false,
      reason: `no READY process exceeds current priority ${currentPriority.toFixed(3)} + margin`,
    };
  }

  getProcessDisplay(processId: string): ProcessDisplayMeta | undefined {
    const model = this.models.get(processId);
    if (!model) return undefined;
    return {
      scores: model.scores,
      effectivePriority: undefined,
      adaptiveQuantum: this.cfg.quantumLevels[this.currentQuantumLevel],
    };
  }

  getBehaviourHistory(): BehaviourHistorySample[] {
    return this.history;
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

  private agingOf(time: number, view: ReadyProcessView): number {
    const wait =
      view.currentReadyWait > 0 ? view.currentReadyWait : view.totalReadyWait;
    return Math.min(this.cfg.agingCap, this.cfg.agingWeight * wait);
  }

  private priorityOf(time: number, view: ReadyProcessView): number {
    const model = this.models.get(view.id);
    const latency = model?.scores.latencySensitivityScore ?? 0;
    return this.cfg.latencyPriorityWeight * latency + this.agingOf(time, view);
  }

  private quantumFor(processId: string, time: number): number {
    const levels = this.cfg.quantumLevels;
    if (levels.length === 0) return 1;
    const locked = time < this.quantumLockedUntil;
    if (!locked) {
      const scores = this.model(processId).scores;
      let level: number;
      if (scores.latencySensitivityScore >= this.cfg.latencyQuantumThreshold) {
        level = 0;
      } else if (scores.cpuDemandScore >= this.cfg.cpuDemandQuantumThreshold) {
        level = levels.length - 1;
      } else {
        level = Math.min(1, levels.length - 1);
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
          reason: `adaptive quantum → level ${level} (${levels[level]} ticks) based on observed behaviour scores`,
          metadata: { level, quantum: levels[level] },
        });
      }
    }
    return levels[this.currentQuantumLevel] ?? levels[0];
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
