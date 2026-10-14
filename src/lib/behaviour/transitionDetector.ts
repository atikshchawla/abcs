import type { AbcsConfigInput } from "@/lib/model/types";
import { Ema, normalizeByCap } from "@/lib/behaviour/ema";

export interface TransitionDetection {
  readonly time: number;
  readonly metric: "cpuDemand" | "ioActivity";
  readonly recent: number;
  readonly baseline: number;
  readonly deviation: number;
}

/**
 * Global workload-level transition detector.
 *
 * Maintains a fast EMA ("recent") and a slow EMA ("baseline") of
 * normalized aggregate signals:
 * - CPU demand: normalized CPU burst length at each burst completion.
 * - IO activity: 0/1 indicator of entering IO after a burst.
 *
 * A transition is declared when |recent − baseline| exceeds
 * `transitionThreshold` for `transitionPersistence` consecutive
 * observation points. After a detection, a cooldown of
 * `transitionCooldown` ticks suppresses further detections (hysteresis
 * against noise). Uses only observations that have already occurred.
 */
export class TransitionDetector {
  private readonly recentBurst: Ema;
  private readonly baselineBurst: Ema;
  private readonly recentBlock: Ema;
  private readonly baselineBlock: Ema;
  private burstStreak = 0;
  private blockStreak = 0;
  private lastDetectionTime = -Infinity;

  constructor(private readonly cfg: AbcsConfigInput) {
    this.recentBurst = new Ema(cfg.emaAlpha);
    this.baselineBurst = new Ema(cfg.transitionBaselineAlpha);
    this.recentBlock = new Ema(cfg.emaAlpha);
    this.baselineBlock = new Ema(cfg.transitionBaselineAlpha);
  }

  /**
   * Feed one observation. Returns a detection when conditions are met,
   * otherwise null. `time` is the observation timestamp.
   */
  observe(
    time: number,
    burstLength: number | null,
    enteredIO: boolean | null,
  ): TransitionDetection | null {
    let detection: TransitionDetection | null = null;

    if (burstLength !== null) {
      const x = normalizeByCap(burstLength, this.cfg.burstNormCap);
      const recent = this.recentBurst.update(x);
      const baseline = this.baselineBurst.update(x);
      const dev = Math.abs(recent - baseline);
      if (dev > this.cfg.transitionThreshold) {
        this.burstStreak++;
      } else {
        this.burstStreak = 0;
      }
      if (
        this.burstStreak >= this.cfg.transitionPersistence &&
        time - this.lastDetectionTime >= this.cfg.transitionCooldown
      ) {
        detection = {
          time,
          metric: "cpuDemand",
          recent,
          baseline,
          deviation: dev,
        };
      }
    }

    if (enteredIO !== null) {
      const x = enteredIO ? 1 : 0;
      const recent = this.recentBlock.update(x);
      const baseline = this.baselineBlock.update(x);
      const dev = Math.abs(recent - baseline);
      if (dev > this.cfg.transitionThreshold) {
        this.blockStreak++;
      } else {
        this.blockStreak = 0;
      }
      if (
        !detection &&
        this.blockStreak >= this.cfg.transitionPersistence &&
        time - this.lastDetectionTime >= this.cfg.transitionCooldown
      ) {
        detection = {
          time,
          metric: "ioActivity",
          recent,
          baseline,
          deviation: dev,
        };
      }
    }

    if (detection) {
      this.lastDetectionTime = time;
      this.burstStreak = 0;
      this.blockStreak = 0;
    }
    return detection;
  }
}
