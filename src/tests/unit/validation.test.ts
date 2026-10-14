import { describe, expect, it } from "vitest";
import { validateWorkload, assertValidWorkload } from "@/lib/model/validation";

describe("workload validation", () => {
  it("accepts a valid workload", () => {
    const result = validateWorkload({
      name: "demo",
      processes: [
        {
          id: "P1",
          arrivalTime: 0,
          phases: [
            { type: "CPU", duration: 5 },
            { type: "IO", duration: 3 },
            { type: "CPU", duration: 2 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.workload?.processes).toHaveLength(1);
  });

  it("rejects duplicate process ids with a helpful message", () => {
    const result = validateWorkload({
      name: "dup",
      processes: [
        { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 1 }] },
        { id: "P1", arrivalTime: 1, phases: [{ type: "CPU", duration: 1 }] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain('Duplicate process id "P1"');
  });

  it("rejects empty process list", () => {
    const result = validateWorkload({ name: "empty", processes: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("at least one process");
  });

  it("rejects non-integer durations", () => {
    const result = validateWorkload({
      name: "frac",
      processes: [
        { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 1.5 }] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects zero/negative durations", () => {
    const result = validateWorkload({
      name: "zero",
      processes: [
        { id: "P1", arrivalTime: 0, phases: [{ type: "CPU", duration: 0 }] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects negative arrival times", () => {
    const result = validateWorkload({
      name: "neg",
      processes: [
        { id: "P1", arrivalTime: -1, phases: [{ type: "CPU", duration: 1 }] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing phases", () => {
    const result = validateWorkload({
      name: "nophase",
      processes: [{ id: "P1", arrivalTime: 0, phases: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects bad phase type", () => {
    const result = validateWorkload({
      name: "badtype",
      processes: [
        { id: "P1", arrivalTime: 0, phases: [{ type: "GPU", duration: 3 }] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("assertValidWorkload throws on invalid input", () => {
    expect(() => assertValidWorkload({ name: "x", processes: [] })).toThrow(
      /Invalid workload/,
    );
  });

  it("assertValidWorkload returns the typed workload on success", () => {
    const w = assertValidWorkload({
      name: "ok",
      processes: [{ id: "A", arrivalTime: 0, phases: [{ type: "CPU", duration: 2 }] }],
    });
    expect(w.name).toBe("ok");
  });
});
