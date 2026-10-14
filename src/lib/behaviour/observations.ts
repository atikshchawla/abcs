import type { AbcsConfigInput, BehaviourScores } from "@/lib/model/types";
import { Ema } from "@/lib/behaviour/ema";

/**
 * Per-process runtime observation model for ABCS.
 *
 * Formulas (configurable via AbcsConfigInput):
 *
 *   C = clamp(EMA(CPU burst length) / cpuDemandDivisor, 0, 1)
 *   I = clamp(EMA(I/O blocks per ioRateWindowCpuTicks CPU ticks), 0, 1)
 *   R = responsivenessCpuWeight·(1−C) + responsivenessIoWeight·I
 *
 * EMA smoothing uses α = emaAlpha (first observation initializes the EMA).
 * Scores are estimates from past observations only — never from future
 * phase durations.
 */
export class ProcessObservationModel {
  private readonly burstEma: Ema;
  private readonly ioRateEma: Ema;
  private lastBurstLength: number | null = null;
  private completedBursts = 0;
  private totalCpuTicks = 0;
  private totalIoBlocks = 0;

  constructor(private readonly cfg: AbcsConfigInput) {
    this.burstEma = new Ema(cfg.emaAlpha);
    this.ioRateEma = new Ema(cfg.emaAlpha);
  }

  /**
   * Record a completed CPU burst (with whether it entered IO after).
   * Updates the raw burst-length EMA and the I/O-blocks-per-10-CPU-ticks EMA.
   */
  recordBurst(burstLength: number, enteredIO: boolean): void {
    this.lastBurstLength = burstLength;
    this.burstEma.update(burstLength);
    this.totalCpuTicks += burstLength;
    if (enteredIO) this.totalIoBlocks++;

    // Instantaneous rate for this burst window: blocks per ioRateWindow ticks.
    // If the burst ended in IO, that is 1 block over `burstLength` CPU ticks.
    // Scale to the configured window so I is interpretable as [0,1] after clamp.
    const window = this.cfg.ioRateWindowCpuTicks;
    const rateObs = enteredIO ? window / Math.max(1, burstLength) : 0;
    this.ioRateEma.update(rateObs);

    this.completedBursts++;
  }

  /** Record an IO wait duration (kept for history; not used in C/I/R). */
  recordIOWait(ioWaitDuration: number): void {
    void ioWaitDuration; // IO wait does not feed C/I/R; block indicator handles I.
  }

  get scores(): BehaviourScores {
    const emaBurst = this.burstEma.current ?? 0;
    const C = clamp01(emaBurst / this.cfg.cpuDemandDivisor);
    const I = clamp01(this.ioRateEma.current ?? 0);
    const R = clamp01(
      this.cfg.responsivenessCpuWeight * (1 - C) +
        this.cfg.responsivenessIoWeight * I,
    );
    return {
      cpuDemandScore: C,
      ioActivityScore: I,
      latencySensitivityScore: R,
    };
  }

  get rawBurstLength(): number | null {
    return this.lastBurstLength;
  }

  get emaBurstLength(): number | null {
    return this.burstEma.current;
  }

  get burstObservationCount(): number {
    return this.completedBursts;
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
