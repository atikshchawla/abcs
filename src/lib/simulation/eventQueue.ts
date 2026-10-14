/**
 * Deterministic priority event queue for the discrete-event simulator.
 *
 * Ordering key: (time, typePriority, processId). Lower values first.
 * Ties are broken by processId (lexicographic) so same-time events are
 * always processed in the same order.
 */

export type QueuedEventType = "IO_COMPLETE" | "PROCESS_ARRIVAL";

const TYPE_PRIORITY: Readonly<Record<QueuedEventType, number>> = {
  // IO completions are processed before arrivals at the same tick.
  IO_COMPLETE: 0,
  PROCESS_ARRIVAL: 1,
};

export interface QueuedEvent {
  readonly time: number;
  readonly type: QueuedEventType;
  readonly processId: string;
}

function compare(a: QueuedEvent, b: QueuedEvent): number {
  if (a.time !== b.time) return a.time - b.time;
  const pa = TYPE_PRIORITY[a.type];
  const pb = TYPE_PRIORITY[b.type];
  if (pa !== pb) return pa - pb;
  return a.processId < b.processId ? -1 : a.processId > b.processId ? 1 : 0;
}

/** Binary min-heap of queued events. */
export class EventQueue {
  private heap: QueuedEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(event: QueuedEvent): void {
    this.heap.push(event);
    this.bubbleUp(this.heap.length - 1);
  }

  peek(): QueuedEvent | undefined {
    return this.heap[0];
  }

  /** Time of the next event, or Infinity when empty. */
  nextTime(): number {
    return this.heap.length > 0 ? this.heap[0].time : Infinity;
  }

  pop(): QueuedEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  /** Remove and return every event at exactly `time` (in queue order). */
  drainAtTime(time: number): QueuedEvent[] {
    const out: QueuedEvent[] = [];
    while (this.heap.length > 0 && this.heap[0].time === time) {
      out.push(this.pop()!);
    }
    return out;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compare(this.heap[index], this.heap[parent]) < 0) {
        [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
        index = parent;
      } else break;
    }
  }

  private bubbleDown(index: number): void {
    const n = this.heap.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;
      if (left < n && compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < n && compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}
