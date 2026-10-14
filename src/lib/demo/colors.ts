export const PROCESS_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#b91c1c",
] as const;

export function colorFor(processId: string | null, ids: readonly string[]): string {
  if (processId === null) return "#d4d4d8";
  const idx = ids.indexOf(processId);
  return PROCESS_COLORS[(idx >= 0 ? idx : 0) % PROCESS_COLORS.length];
}
