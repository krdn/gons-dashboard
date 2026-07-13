"use client";
import type { GraphNode } from "../model/types";
import { CopyableCommand } from "./CopyableCommand";

export function NodeDetailPanel({ node }: { node: GraphNode | null }) {
  if (!node) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        노드를 클릭하면 상세가 표시됩니다.
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm text-[var(--color-text)]">
      <p className="font-mono text-xs text-[var(--color-text-muted)]">
        {node.path}
        {node.symbol ? `:${node.symbol}` : ""}
      </p>
      <p>{node.role}</p>
      {node.keyExports?.length ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          주요 export: <span className="font-mono">{node.keyExports.join(", ")}</span>
        </p>
      ) : null}
      {node.dependsOn?.length ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          의존: {node.dependsOn.join(", ")}
        </p>
      ) : null}
      {node.warning && (
        <p className="rounded bg-[var(--color-surface-2)] p-2 text-xs">⚠️ {node.warning}</p>
      )}
      {node.maintenance?.map((m, i) => (
        <div
          key={i}
          className="space-y-1 border-t border-[var(--color-hairline)] pt-2"
        >
          <p className="font-medium">{m.task}</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {m.where} — {m.how}
          </p>
          {m.warning && <p className="text-xs">⚠️ {m.warning}</p>}
          {m.command && <CopyableCommand command={m.command} />}
        </div>
      ))}
    </div>
  );
}
