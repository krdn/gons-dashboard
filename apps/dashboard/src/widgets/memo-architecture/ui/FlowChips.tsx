"use client";
import type { Flow, Trigger } from "../model/types";

const TRIGGER_ICON: Record<Trigger, string> = { user: "👆", cron: "⏰", after: "📨" };

export function FlowChips({
  flows,
  selectedId,
  onSelect,
}: {
  flows: Flow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {flows.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onSelect(f.id)}
          aria-pressed={f.id === selectedId}
          className={[
            "rounded-full border px-3 py-1 text-xs transition",
            f.id === selectedId
              ? "border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-muted)]",
          ].join(" ")}
        >
          <span>{f.label}</span>
          <span aria-hidden className="ml-1">
            {f.triggers.map((t) => TRIGGER_ICON[t]).join("")}
            {f.llm ? " 🤖" : ""}
            {f.async ? " ⚡" : ""}
            {f.idempotencyKey ? " 🔑" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
