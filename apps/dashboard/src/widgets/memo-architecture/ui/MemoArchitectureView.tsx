"use client";
import { useState, type ReactNode } from "react";
import type { ArchitectureGraph } from "../model/types";
import { FlowChips } from "./FlowChips";
import { WorkflowGraph } from "./WorkflowGraph";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { MaintenanceIndex } from "./MaintenanceIndex";

type Tab = "graph" | "maintenance";

export function MemoArchitectureView({ graph }: { graph: ArchitectureGraph }) {
  const [tab, setTab] = useState<Tab>("graph");
  const [flowId, setFlowId] = useState(graph.flows[0]?.id ?? "");
  const [nodeId, setNodeId] = useState<string | null>(null);
  const flow = graph.flows.find((f) => f.id === flowId) ?? graph.flows[0];
  const node = graph.nodes.find((n) => n.id === nodeId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-[var(--color-hairline)]">
        <TabButton active={tab === "graph"} onClick={() => setTab("graph")}>
          워크플로우 그래프
        </TabButton>
        <TabButton active={tab === "maintenance"} onClick={() => setTab("maintenance")}>
          유지보수 색인
        </TabButton>
      </div>
      {tab === "graph" ? (
        <div className="space-y-4">
          <FlowChips flows={graph.flows} selectedId={flowId} onSelect={setFlowId} />
          {flow && (
            <WorkflowGraph
              flow={flow}
              nodes={graph.nodes}
              selectedNodeId={nodeId}
              onSelectNode={setNodeId}
            />
          )}
          <div className="rounded-md border border-[var(--color-hairline)] p-3">
            <NodeDetailPanel node={node} />
          </div>
        </div>
      ) : (
        <MaintenanceIndex entries={graph.maintenance} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "px-3 py-2 text-sm",
        active
          ? "border-b-2 border-[var(--color-accent)] font-medium text-[var(--color-text)]"
          : "text-[var(--color-text-muted)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
