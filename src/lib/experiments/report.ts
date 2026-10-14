import type { ComparisonTable, MetricKey } from "@/lib/experiments/aggregation";
import { LOWER_IS_BETTER, HIGHER_IS_BETTER } from "@/lib/experiments/aggregation";
import type { BenchmarkOutcome } from "@/lib/experiments/benchmarkRunner";

/**
 * Evidence-based report generation from actual benchmark outputs.
 * Never invents numbers — only formats what aggregation produced.
 */

export interface ReportInput {
  readonly title: string;
  readonly table: ComparisonTable;
  readonly outcome: BenchmarkOutcome;
  readonly scenarioIds: readonly string[];
  readonly seeds: readonly (number | null)[];
  readonly configNotes: readonly string[];
  readonly generatedAt: string;
}

function fmt(n: number | null, digits = 3): string {
  if (n === null) return "n/a";
  return n.toFixed(digits);
}

function directionLabel(key: MetricKey, deltaPct: number | null): string {
  if (deltaPct === null || deltaPct === 0) return "—";
  const better =
    LOWER_IS_BETTER.includes(key) ? deltaPct < 0 : HIGHER_IS_BETTER.includes(key) ? deltaPct > 0 : null;
  if (better === null) return deltaPct > 0 ? "▲" : "▼";
  return better ? "▲ better" : "▼ worse";
}

export function generateReport(input: ReportInput): string {
  const { table, outcome } = input;
  const lines: string[] = [];
  const baseline = table.baselineVariantId;

  lines.push(`# ${input.title}`);
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push("");
  lines.push("## 1. Summary");
  lines.push("");
  lines.push(
    `Compared ${table.variants.length} variants across ${input.scenarioIds.length} scenario(s) and ${input.seeds.length} seed(s)/run(s). Baseline for deltas: **${baseline}**.`,
  );
  lines.push(
    `Completed runs: ${outcome.runs.length}; failed runs: ${outcome.errors.length}.`,
  );
  lines.push("");
  lines.push("## 2. Configuration");
  lines.push("");
  lines.push(`- Scenarios: ${input.scenarioIds.join(", ")}`);
  lines.push(
    `- Seeds: ${input.seeds.map((s) => (s === null ? "deterministic" : s)).join(", ")}`,
  );
  for (const note of input.configNotes) lines.push(`- ${note}`);
  lines.push("");

  lines.push("## 3. Absolute metrics (mean ± std, n)");
  lines.push("");
  for (const v of table.variants) {
    lines.push(`### ${v.label} (${v.variantId})`);
    lines.push("");
    lines.push("| Metric | Mean | Std | Median | P95 | n |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const key of Object.keys(v.metrics) as MetricKey[]) {
      const a = v.metrics[key];
      lines.push(
        `| ${key} | ${fmt(a.mean)} | ${fmt(a.std)} | ${fmt(a.median)} | ${fmt(a.p95)} | ${a.n} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 4. Percentage change vs baseline");
  lines.push("");
  lines.push(`Baseline: ${baseline}. Negative % on lower-is-better metrics is an improvement.`);
  lines.push("");
  const metricKeys = Object.keys(table.variants[0]?.metrics ?? {}) as MetricKey[];
  lines.push(`| Metric | ${table.variants.map((v) => v.variantId).join(" | ")} |`);
  lines.push(`| --- | ${table.variants.map(() => "---").join(" | ")} |`);
  for (const key of metricKeys) {
    const cells = table.variants.map((v) => {
      const d = table.deltas[v.variantId]?.[key] ?? null;
      if (v.variantId === baseline) return "baseline";
      return `${fmt(d, 1)}% ${directionLabel(key, d)}`;
    });
    lines.push(`| ${key} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## 5. Wins and regressions (vs baseline)");
  lines.push("");
  let anyWin = false;
  let anyRegression = false;
  for (const v of table.variants) {
    if (v.variantId === baseline) continue;
    for (const key of metricKeys) {
      const d = table.deltas[v.variantId]?.[key] ?? null;
      if (d === null || Math.abs(d) < 0.5) continue;
      const better = LOWER_IS_BETTER.includes(key)
        ? d < 0
        : HIGHER_IS_BETTER.includes(key)
          ? d > 0
          : null;
      if (better === true) {
        lines.push(`- **Win** ${v.variantId} ${key}: ${fmt(d, 1)}% (lower/higher is better).`);
        anyWin = true;
      } else if (better === false) {
        lines.push(`- **Regression** ${v.variantId} ${key}: ${fmt(d, 1)}%.`);
        anyRegression = true;
      }
    }
  }
  if (!anyWin) lines.push("- No clear wins (>0.5%) recorded.");
  if (!anyRegression) lines.push("- No clear regressions (>0.5%) recorded.");
  lines.push("");

  if (outcome.errors.length > 0) {
    lines.push("## 6. Failed / excluded runs");
    lines.push("");
    for (const e of outcome.errors) {
      lines.push(`- ${e.variantId} @ ${e.workloadName}: ${e.error}`);
    }
    lines.push("");
  }

  lines.push("## 7. Reproduction");
  lines.push("");
  lines.push("1. `npm install`");
  lines.push("2. `npm test` — unit + integration + smoke benchmark");
  lines.push(
    "3. Re-run the same scenario/seed set via `POST /api/compare` or the Compare page with identical inputs.",
  );
  lines.push("");

  lines.push("## 8. Simulator limitations");
  lines.push("");
  lines.push(
    "- Single-CPU discrete-event simulation with abstract integer time; not a real OS kernel.",
  );
  lines.push(
    "- ABCS scores are observational estimates; transition detection is heuristic, not learned.",
  );
  lines.push(
    "- Results are workload-dependent; no claim of universal superiority is made.",
  );
  lines.push("");

  lines.push("## 9. Conclusion (evidence-based)");
  lines.push("");
  const abcsFull = table.variants.find((v) => v.variantId === "ABCS-full");
  if (abcsFull) {
    const respDelta = table.deltas["ABCS-full"]?.avgResponseTime ?? null;
    const p95Delta = table.deltas["ABCS-full"]?.p95ResponseTime ?? null;
    const fairDelta = table.deltas["ABCS-full"]?.fairnessJainIndex ?? null;
    const maxWaitDelta = table.deltas["ABCS-full"]?.maxReadyWait ?? null;
    lines.push(
      `ABCS-full vs ${baseline}: avgResponseTime ${fmt(respDelta, 1)}%, p95ResponseTime ${fmt(p95Delta, 1)}%, fairness ${fmt(fairDelta, 1)}%, maxReadyWait ${fmt(maxWaitDelta, 1)}%.`,
    );
    lines.push(
      "Interpretation depends on the sign and magnitude of these deltas together with per-scenario results; see sections 3–5. Regressions are reported as-is.",
    );
  } else {
    lines.push("ABCS-full was not part of this comparison.");
  }
  lines.push("");

  return lines.join("\n");
}

export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  }
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) lines.push(cols.map((c) => esc(row[c])).join(","));
  return lines.join("\n");
}
