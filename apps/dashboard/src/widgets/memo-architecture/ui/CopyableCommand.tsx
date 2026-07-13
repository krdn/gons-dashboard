"use client";
import { useState } from "react";

export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}
