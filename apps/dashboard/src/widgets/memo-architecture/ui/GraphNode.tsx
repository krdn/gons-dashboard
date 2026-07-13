"use client";
import type { GraphNode as GraphNodeData } from "../model/types";

export function GraphNode({
  node,
  selected,
  onSelect,
}: {
  node: GraphNodeData;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      className={[
        "w-full rounded-md border px-2 py-1 text-left text-xs transition",
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
          : "border-[var(--color-hairline)] bg-[var(--color-surface)]",
      ].join(" ")}
    >
      <span className="font-medium text-[var(--color-text)]">{node.label}</span>
      {node.warning && (
        <span aria-hidden className="ml-1">
          ⚠️
        </span>
      )}
    </button>
  );
}
