"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AbcsDecisionRecord, AbcsProcessContribution } from "@/lib/model/types";

// ---------------------------------------------------------------------------
// Stage data derived from one AbcsDecisionRecord
// ---------------------------------------------------------------------------

export type FlowStage = 0 | 1 | 2 | 3 | 4 | 5;

export interface StageData {
  readonly stage: FlowStage;
  readonly title: string;
  readonly record: AbcsDecisionRecord;
  readonly selectedContrib: AbcsProcessContribution | null;
  readonly maxPriority: number;
}

function stageData(record: AbcsDecisionRecord, stage: FlowStage): StageData {
  const selectedContrib =
    record.contributions.find((c) => c.processId === record.selectedProcessId) ?? null;
  const maxPriority = Math.max(0, ...record.contributions.map((c) => c.totalPriority));
  return { stage, title: STAGE_TITLES[stage], record, selectedContrib, maxPriority };
}

const STAGE_TITLES = [
  "Observe",
  "Estimate Behaviour",
  "Calculate Priority",
  "Select Process",
  "Execute",
  "Update",
] as const;

// ---------------------------------------------------------------------------
// Custom node components
// ---------------------------------------------------------------------------

function NodeShell({
  data,
  selected,
  stage,
  active,
  onClick,
}: {
  data: StageData;
  selected: boolean;
  stage: FlowStage;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={`w-[190px] cursor-pointer rounded-lg border p-2.5 text-[10px] leading-snug shadow-sm transition-colors ${
        active
          ? "border-violet-500 bg-violet-50 ring-2 ring-violet-300 dark:bg-violet-950/60 dark:ring-violet-800"
          : selected
            ? "border-zinc-400 bg-white dark:border-zinc-500 dark:bg-zinc-900"
            : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
      }`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${
            active
              ? "bg-violet-600 text-white"
              : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {stage + 1}
        </span>
        <span className="font-semibold text-zinc-800 dark:text-zinc-100">
          {STAGE_TITLES[stage]}
        </span>
      </div>
      <StageBody data={data} />
    </div>
  );
}

function StageBody({ data }: { data: StageData }) {
  const { record, stage, selectedContrib, maxPriority } = data;
  const R = selectedContrib?.responsivenessScore ?? 0;
  const C = selectedContrib?.cpuDemandScore ?? 0;
  const I = selectedContrib?.ioActivityScore ?? 0;
  const wait = selectedContrib?.readyWait ?? 0;
  const behavior = selectedContrib?.behaviorContribution ?? 0;
  const fairness = selectedContrib?.fairnessContribution ?? 0;
  const total = selectedContrib?.totalPriority ?? 0;

  switch (stage) {
    case 0: // Observe
      return (
        <div className="space-y-0.5 text-zinc-600 dark:text-zinc-400">
          <p>
            Selected:{" "}
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {record.selectedProcessId ?? "—"}
            </span>
          </p>
          <p>READY processes: {record.contributions.length}</p>
          {record.transitionDetected && (
            <p className="text-amber-600 dark:text-amber-400">Transition confirmed nearby</p>
          )}
          {record.policyNotes.length > 0 && (
            <p className="text-violet-600 dark:text-violet-400">
              {record.policyNotes.length} policy note(s)
            </p>
          )}
        </div>
      );
    case 1: // Estimate
      return (
        <div className="space-y-0.5">
          <MiniBar label="C" value={C} />
          <MiniBar label="I" value={I} />
          <MiniBar label="R" value={R} highlight />
          <p className="mt-0.5 text-[9px] text-zinc-400">
            R = 0.6(1−C) + 0.4I = {R.toFixed(2)}
          </p>
        </div>
      );
    case 2: // Calculate
      return (
        <div className="space-y-0.5">
          {record.contributions.slice(0, 4).map((c) => (
            <div key={c.processId} className="flex items-center gap-1">
              <span
                className={`w-8 shrink-0 tabular-nums ${
                  c.processId === record.selectedProcessId
                    ? "font-semibold text-violet-700 dark:text-violet-400"
                    : "text-zinc-500"
                }`}
              >
                {c.processId}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full bg-blue-500"
                  style={{
                    width: `${maxPriority > 0 ? (c.totalPriority / maxPriority) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                {c.totalPriority.toFixed(0)}
              </span>
            </div>
          ))}
          <p className="text-[9px] text-zinc-400">
            70·R + 10·wait/4 · winner {record.selectedProcessId}
          </p>
        </div>
      );
    case 3: // Select
      return (
        <div className="space-y-0.5 text-zinc-600 dark:text-zinc-400">
          <p>
            Winner:{" "}
            <span className="font-semibold text-violet-700 dark:text-violet-400">
              {record.selectedProcessId ?? "—"}
            </span>
          </p>
          <p>Priority {total.toFixed(1)}</p>
          <p className="text-[9px] text-zinc-400">
            beh {behavior.toFixed(0)} + fair {fairness.toFixed(0)} · wait {wait}
          </p>
        </div>
      );
    case 4: // Execute
      return (
        <div className="space-y-0.5 text-zinc-600 dark:text-zinc-400">
          <p>
            Quantum:{" "}
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {record.quantum ?? "—"} ticks
            </span>
          </p>
          <p className="text-[9px] text-zinc-500">{record.quantumReason}</p>
        </div>
      );
    case 5: // Update
      return (
        <div className="space-y-0.5 text-zinc-600 dark:text-zinc-400">
          {record.policyNotes.length > 0 ? (
            record.policyNotes.slice(0, 2).map((n, i) => (
              <p key={i} className="text-[9px] text-violet-600 dark:text-violet-400">
                {n}
              </p>
            ))
          ) : (
            <p>No policy adjustment at this decision.</p>
          )}
          {record.transitionDetected && (
            <p className="text-amber-600 dark:text-amber-400">Transition confirmed</p>
          )}
        </div>
      );
  }
}

function MiniBar({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-3 shrink-0 font-medium text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded ${highlight ? "bg-violet-500" : "bg-blue-500"}`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

// Handle components for left/right connection points
function TargetHandle() {
  return <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-zinc-400" />;
}
function SourceHandle() {
  return <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-zinc-400" />;
}

// Wrap each stage into a React Flow node type
function makeNode(stage: FlowStage) {
  function StageNode({ data, selected }: NodeProps) {
    const sd = data as unknown as StageData;
    const active = (data as unknown as { __active?: boolean }).__active === true;
    const onClick = (data as unknown as { __onClick?: () => void }).__onClick ?? (() => {});
    return (
      <>
        {stage > 0 && <TargetHandle />}
        <NodeShell data={sd} selected={selected} stage={stage} active={active} onClick={onClick} />
        {stage < 5 && <SourceHandle />}
      </>
    );
  }
  StageNode.displayName = `Stage${stage}`;
  return StageNode;
}

const nodeTypes = {
  stage0: makeNode(0),
  stage1: makeNode(1),
  stage2: makeNode(2),
  stage3: makeNode(3),
  stage4: makeNode(4),
  stage5: makeNode(5),
};

// ---------------------------------------------------------------------------
// Main DecisionFlow component
// ---------------------------------------------------------------------------

const H_GAP = 30;
const V_GAP = 24;
const NODE_W = 190;
const NODE_H = 130;

export function DecisionFlow({
  record,
  focusedStage,
  onFocusStage,
}: {
  record: AbcsDecisionRecord | null;
  focusedStage: FlowStage;
  onFocusStage: (s: FlowStage) => void;
}) {
  // SSR-safe: default to horizontal; switch to vertical after mount if narrow.
  const [vertical, setVertical] = useState(false);
  useEffect(() => {
    const check = () => setVertical(window.innerWidth < 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!record) {
      return { nodes: [], edges: [] };
    }

    const ns: Node[] = [];
    const es: Edge[] = [];
    for (let i = 0; i < 6; i++) {
      const sd = stageData(record, i as FlowStage);
      const pos = vertical
        ? { x: 20, y: i * (NODE_H + V_GAP) }
        : { x: i * (NODE_W + H_GAP), y: 10 };
      ns.push({
        id: `s${i}`,
        type: `stage${i}`,
        position: pos,
        data: {
          ...sd,
          __active: i === focusedStage,
          __onClick: () => onFocusStage(i as FlowStage),
        } as unknown as Record<string, unknown>,
      });
      if (i > 0) {
        es.push({
          id: `e${i - 1}-${i}`,
          source: `s${i - 1}`,
          target: `s${i}`,
          animated: i - 1 === focusedStage || i === focusedStage,
          style: {
            stroke: i - 1 === focusedStage || i === focusedStage ? "#8b5cf6" : "#a1a1aa",
            strokeWidth: i - 1 === focusedStage || i === focusedStage ? 2 : 1.2,
          },
        });
      }
    }
    return { nodes: ns, edges: es };
  }, [record, focusedStage, onFocusStage, vertical]);

  const onInit = useCallback(() => {}, []);

  if (!record) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
        Run a comparison, then step through ABCS decisions to see the live pipeline.
      </div>
    );
  }

  return (
    <div
      className={`w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 [&_.react-flow__controls-button]:border-zinc-200 [&_.react-flow__controls-button]:bg-white [&_.react-flow__controls-button]:fill-zinc-600 dark:[&_.react-flow__controls-button]:border-zinc-700 dark:[&_.react-flow__controls-button]:bg-zinc-900 dark:[&_.react-flow__controls-button]:fill-zinc-400 ${
        vertical ? "h-[860px]" : "h-[280px]"
      }`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        zoomOnScroll={false}
        panOnDrag
        minZoom={0.3}
        maxZoom={1.5}
        className="h-full w-full bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d4d4d8" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
