import type { AbcsConfigInput, BehaviourScores } from "@/lib/model/types";
import { Ema, normalizeByCap } from "@/lib/behaviour/ema";

/**
 * Per-process runtime observation model for ABCS.
 *
 * Signals (all normalized to [0, 1] before smoothing):
 * - CPU burst length → cpuDemandScore (EMA of normalized burst length).
 * - IO-block-after-burst frequency → ioActivityScore (EMA of 0/1 indicator).
 * - Latency sensitivity → EMA of (1 - normalizedBurst) × boost(blocked).
 *   Short bursts that end in IO score high; long non-blocking bursts
 *   score low. The blocking boost weight is configured in AbcsConfig.
 *
 * Scores live in [0, 1] and need not sum to 1. They are estimates from
 * past observations only — never from future phase durations.
 */
export class ProcessObservationModel {
  private readonly burstEma: Ema;
  private readonly blockEma: Ema;
  private readonly latencyEma: Ema;
  private readonly ioWaitEma: Ema;
  private lastBurstLength: number | null = null;
  private lastEmaBurst: number | null = null;
  private completedBursts = 0;

  constructor(private readonly cfg: AbcsConfigInput) {
    this.burstEma = new Ema(cfg.emaAlpha);
    this.blockEma = new Ema(cfg.emaAlpha);
    this.latencyEma = new Ema(cfg.emaAlpha);
    this.ioWaitEma = new Ema(cfg.emaAlpha);
  }

  /** Record a completed CPU burst (with whether it entered IO after). */
  recordBurst(burstLength: number, enteredIO: boolean): void {
    const normBurst = normalizeByCap(burstLength, this.cfg.burstNormCap);
    this.lastBurstLength = burstLength;
    this.lastEmaBurst = this.burstEma.update(normBurst);
    this.blockEma.update(enteredIO ? 1 : 0);
    const boost = enteredIO ? this.cfg.latencyBlockingBoost : 1;
    const latencyObs = (1 - normBurst) * boost;
    this.latencyEma.update(Math.min(1, Math.max(0, latencyObs)));
    this.completedBursts++;
  }

  /** Record an IO wait duration (normalized). */
  recordIOWait(ioWaitDuration: number): void {
    this.ioWaitEma.update(normalizeByCap(ioWaitDuration, this.cfg.ioNormCap));
  }

  get scores(): BehaviourScores {
    return {
      cpuDemandScore: clamp01(this.burstEma.current ?? 0),
      ioActivityScore: clamp01(this.blockEma.current ?? 0),
      latencySensitivityScore: clamp01(this.latencyEma.current ?? 0),
    };
  }

  get rawBurstLength(): number | null {
    return this.lastBurstLength;
  }

  get emaBurstLength(): number | null {
    return this.lastEmaBurst;
  }

  get burstObservationCount(): number {
    return this.completedBursts;
  }

  get ioWaitScore(): number {
    return clamp01(this.ioWaitEma.current ?? 0);
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
