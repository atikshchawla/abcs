/**
 * Exponential moving average.
 *
 * EMA_t = alpha * x_t + (1 - alpha) * EMA_{t-1},  alpha ∈ (0, 1]
 *
 * The first observation initializes EMA to x_1 (no prior value to blend
 * with). Alpha = 1 disables smoothing (EMA tracks the latest sample).
 */
export class Ema {
  private value: number | null = null;
  private count = 0;

  constructor(private readonly alpha: number) {
    if (!(alpha > 0 && alpha <= 1)) {
      throw new Error(`EMA alpha must be in (0, 1], got ${alpha}`);
    }
  }

  get current(): number | null {
    return this.value;
  }

  get observations(): number {
    return this.count;
  }

  update(x: number): number {
    if (this.value === null) {
      this.value = x;
    } else {
      this.value = this.alpha * x + (1 - this.alpha) * this.value;
    }
    this.count++;
    return this.value;
  }

  reset(): void {
    this.value = null;
    this.count = 0;
  }
}

/**
 * Clamp x into [0, 1] after scaling by `cap`. Zero or negative caps are
 * treated as "everything normalizes to 1" for positive x, avoiding
 * divide-by-zero; x <= 0 always yields 0.
 */
export function normalizeByCap(x: number, cap: number): number {
  if (x <= 0) return 0;
  if (cap <= 0) return 1;
  return Math.min(1, x / cap);
}
