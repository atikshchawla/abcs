import { DemoApp } from "@/components/demo/DemoApp";

export const metadata = {
  title: "ABCS — Scheduler Comparison",
};

export default function HomePage() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold tracking-tight">
          Adaptive Behaviour-Aware CPU Scheduler
        </h1>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">
          Give Round Robin, MLFQ, and ABCS the same workload — compare their actual
          results, and inspect why each scheduler chose its process. Deterministic
          discrete-event simulator; not a real OS scheduler.
        </p>
      </div>
      <DemoApp />
    </div>
  );
}
