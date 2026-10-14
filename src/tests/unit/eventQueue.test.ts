import { describe, expect, it } from "vitest";
import { EventQueue } from "@/lib/simulation/eventQueue";

describe("EventQueue", () => {
  it("pops events in time order", () => {
    const q = new EventQueue();
    q.push({ time: 5, type: "PROCESS_ARRIVAL", processId: "B" });
    q.push({ time: 2, type: "PROCESS_ARRIVAL", processId: "A" });
    q.push({ time: 9, type: "IO_COMPLETE", processId: "C" });
    expect(q.pop()?.time).toBe(2);
    expect(q.pop()?.time).toBe(5);
    expect(q.pop()?.time).toBe(9);
    expect(q.pop()).toBeUndefined();
  });

  it("orders IO_COMPLETE before PROCESS_ARRIVAL at the same time", () => {
    const q = new EventQueue();
    q.push({ time: 3, type: "PROCESS_ARRIVAL", processId: "A" });
    q.push({ time: 3, type: "IO_COMPLETE", processId: "B" });
    expect(q.pop()?.type).toBe("IO_COMPLETE");
    expect(q.pop()?.type).toBe("PROCESS_ARRIVAL");
  });

  it("breaks same-type same-time ties by processId", () => {
    const q = new EventQueue();
    q.push({ time: 1, type: "IO_COMPLETE", processId: "P9" });
    q.push({ time: 1, type: "IO_COMPLETE", processId: "P2" });
    expect(q.pop()?.processId).toBe("P2");
    expect(q.pop()?.processId).toBe("P9");
  });

  it("drainAtTime removes exactly the events at that time", () => {
    const q = new EventQueue();
    q.push({ time: 1, type: "PROCESS_ARRIVAL", processId: "A" });
    q.push({ time: 1, type: "PROCESS_ARRIVAL", processId: "B" });
    q.push({ time: 2, type: "PROCESS_ARRIVAL", processId: "C" });
    const at1 = q.drainAtTime(1);
    expect(at1.map((e) => e.processId)).toEqual(["A", "B"]);
    expect(q.size).toBe(1);
    expect(q.nextTime()).toBe(2);
  });

  it("nextTime returns Infinity when empty", () => {
    expect(new EventQueue().nextTime()).toBe(Infinity);
  });

  it("handles interleaved push/pop deterministically", () => {
    const q = new EventQueue();
    const pushes: [number, string][] = [
      [10, "A"],
      [3, "B"],
      [3, "C"],
      [7, "D"],
      [1, "E"],
    ];
    for (const [t, id] of pushes) {
      q.push({ time: t, type: "PROCESS_ARRIVAL", processId: id });
    }
    const order: string[] = [];
    while (q.size > 0) order.push(q.pop()!.processId);
    expect(order).toEqual(["E", "B", "C", "D", "A"]);
  });
});
