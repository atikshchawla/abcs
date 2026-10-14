import type { SimulationConfigInput } from "@/lib/model/types";
import type { Scheduler } from "@/lib/schedulers/types";
import { RoundRobinScheduler, DEFAULT_RR_QUANTUM } from "@/lib/schedulers/roundRobin";
import { MlfqScheduler, DEFAULT_MLFQ_CONFIG } from "@/lib/schedulers/mlfq";
import { AbcsScheduler } from "@/lib/schedulers/abcs";

export { RoundRobinScheduler, DEFAULT_RR_QUANTUM } from "@/lib/schedulers/roundRobin";
export { MlfqScheduler, DEFAULT_MLFQ_CONFIG } from "@/lib/schedulers/mlfq";
export {
  AbcsScheduler,
  DEFAULT_ABCS_CONFIG,
  resolveAbcsConfig,
} from "@/lib/schedulers/abcs";

export function createScheduler(config: SimulationConfigInput): Scheduler {
  switch (config.algorithm) {
    case "RR":
      return new RoundRobinScheduler(config.rrQuantum ?? DEFAULT_RR_QUANTUM);
    case "MLFQ":
      return new MlfqScheduler(DEFAULT_MLFQ_CONFIG);
    case "ABCS":
      return new AbcsScheduler(config.abcs ?? undefined);
    default: {
      const never: never = config.algorithm;
      throw new Error(`Unknown algorithm: ${String(never)}`);
    }
  }
}
