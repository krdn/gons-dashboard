"use client";
import { useEffect, useState } from "react";
import {
  SOURCE_LABEL,
  MODEL_LABEL,
  type AgentMeta,
  type AgentBody,
} from "@/entities/agent/client";
import { MarkdownBody } from "@/shared/ui/MarkdownBody";

export function AgentDetail({ meta }: { meta: AgentMeta | null }) {
  const [body, setBody] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      setBody(null);
      try {
        const r = await fetch(meta.bodyPath);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as AgentBody;
        if (cancelled) return;
        setBody(data.body);
        setStatus("idle");
      } catch {
        if (cancelled) return;
        setStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [meta]);

  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--color-hairline)] p-10 text-sm text-[var(--color-text-muted)]">
        왼쪽에서 에이전트를 선택하세요.
      </div>
    );
  }

  return (
    <article className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <header className="mb-4 border-b border-[var(--color-hairline)] pb-4">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
          {meta.name}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {meta.description}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <span className="inline-flex rounded-md border border-[var(--color-accent)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[var(--color-text)]">
            {MODEL_LABEL[meta.model]}
          </span>
          <span className="inline-flex rounded-md border border-[var(--color-hairline)] px-1.5 py-0.5 font-mono">
            {SOURCE_LABEL[meta.source]}
          </span>
          {meta.tools.length > 0 && (
            <span className="font-mono">tools: {meta.tools.join(", ")}</span>
          )}
        </div>
        <p className="mt-2 font-mono text-xs text-[var(--color-text-subtle)]">
          {meta.filePath}
        </p>
      </header>

      {status === "loading" && (
        <p role="status" className="text-sm text-[var(--color-text-muted)]">
          본문 불러오는 중…
        </p>
      )}
      {status === "error" && (
        <p role="status" className="text-sm text-[var(--color-severity-high)]">
          본문을 불러오지 못했습니다. 새로고침으로 재시도하세요.
        </p>
      )}
      {body != null && <MarkdownBody>{body}</MarkdownBody>}
    </article>
  );
}
