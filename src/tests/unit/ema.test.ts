import { describe, expect, it } from "vitest";
import { Ema, normalizeByCap } from "@/lib/behaviour/ema";

describe("Ema", () => {
  it("initializes to the first observation", () => {
    const ema = new Ema(0.5);
    expect(ema.current).toBeNull();
    expect(ema.update(10)).toBe(10);
    expect(ema.observations).toBe(1);
  });

  it("applies EMA_t = alpha*x_t + (1-alpha)*EMA_{t-1}", () => {
    const ema = new Ema(0.5);
    ema.update(10);
    // 0.5*20 + 0.5*10 = 15
    expect(ema.update(20)).toBeCloseTo(15);
    // 0.5*0 + 0.5*15 = 7.5
    expect(ema.update(0)).toBeCloseTo(7.5);
    expect(ema.observations).toBe(3);
  });

  it("alpha = 1 tracks the latest sample exactly", () => {
    const ema = new Ema(1);
    ema.update(5);
    expect(ema.update(99)).toBe(99);
    expect(ema.update(1)).toBe(1);
  });

  it("rejects alpha outside (0, 1]", () => {
    expect(() => new Ema(0)).toThrow();
    expect(() => new Ema(1.1)).toThrow();
    expect(() => new Ema(-0.1)).toThrow();
    expect(() => new Ema(0.001)).not.toThrow();
    expect(() => new Ema(1)).not.toThrow();
  });

  it("reset clears value and count", () => {
    const ema = new Ema(0.3);
    ema.update(4);
    ema.reset();
    expect(ema.current).toBeNull();
    expect(ema.observations).toBe(0);
    expect(ema.update(7)).toBe(7);
  });
});

describe("normalizeByCap", () => {
  it("maps x<=0 to 0", () => {
    expect(normalizeByCap(0, 10)).toBe(0);
    expect(normalizeByCap(-5, 10)).toBe(0);
  });

  it("scales linearly below the cap", () => {
    expect(normalizeByCap(5, 10)).toBeCloseTo(0.5);
    expect(normalizeByCap(10, 10)).toBeCloseTo(1);
  });

  it("clamps above the cap", () => {
    expect(normalizeByCap(100, 10)).toBe(1);
  });

  it("handles zero-range (cap <= 0) without divide-by-zero", () => {
    expect(normalizeByCap(5, 0)).toBe(1);
    expect(normalizeByCap(0, 0)).toBe(0);
    expect(normalizeByCap(-1, 0)).toBe(0);
  });
});
