"use client";
import type { Flow, GraphNode as GraphNodeData, Layer } from "../model/types";
import { GraphNode } from "./GraphNode";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "app", label: "app" },
  { key: "widgets", label: "widgets" },
  { key: "features", label: "features" },
  { key: "entities", label: "entities" },
  { key: "shared", label: "shared" },
];

export function WorkflowGraph({
  flow,
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  flow: Flow;
  nodes: GraphNodeData[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}) {
  // 흐름이 지나는 핵심 경로 노드만, 흐름의 nodeIds 순서를 보존해 레이어별로 묶는다.
  const flowNodes = flow.nodeIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is GraphNodeData => Boolean(n));
  const byLayer = (layer: Layer) => flowNodes.filter((n) => n.layer === layer);
  return (
    <div className="overflow-x-auto">
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        {flow.summary}
        {flow.idempotencyKey ? ` · 🔑 ${flow.idempotencyKey}` : ""}
        {flow.llm ? ` · 🤖 ${flow.llm.model} (${flow.llm.touchpoint})` : ""}
      </p>
      <div className="grid min-w-[720px] grid-cols-5 gap-2">
        {LAYERS.map((l) => (
          <div key={l.key} className="space-y-2">
            <p className="text-center text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              {l.label}
            </p>
            {byLayer(l.key).map((n) => (
              <GraphNode
                key={n.id}
                node={n}
                selected={n.id === selectedNodeId}
                onSelect={onSelectNode}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
