"use client";
import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

export function CopyableCommand({ command }: { command: string }) {
  const [state, setState] = useState<CopyState>("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      // 비-secure context·권한 거부 등 — 크래시 대신 실패 표시.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  }
  return (
    <div className="flex items-start gap-2 rounded-md bg-[var(--color-surface-2)] p-2">
      <code className="flex-1 whitespace-pre-wrap break-all text-xs text-[var(--color-text)]">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="복사"
        className="shrink-0 rounded border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        {state === "copied" ? "복사됨" : state === "failed" ? "복사 실패" : "복사"}
      </button>
    </div>
  );
}
