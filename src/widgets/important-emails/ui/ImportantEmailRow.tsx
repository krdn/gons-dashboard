// 중요 메일 행 — 클라이언트 컴포넌트, "읽음"·"보관" 액션 포함.
//
// summary는 React 기본 children으로 렌더 (XSS 방지, raw HTML 주입 미사용).
// Gmail 링크는 새 탭에서 열림.
"use client";
import { useState, useTransition } from "react";
import { markAsRead, archiveThread } from "@/features/email-analysis";
import {
  senderInitials,
  senderDomain,
  formatRelativeKst,
} from "@/widgets/email-digest/lib/format";
import { CategoryBadge } from "./CategoryBadge";
import type { ImportantEmailItem } from "@/entities/email";

export function ImportantEmailRow({ item }: { item: ImportantEmailItem }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onRead = () => {
    setError(null);
    startTransition(async () => {
      const result = await markAsRead(item.threadId);
      if (!result.ok) setError(result.reason);
    });
  };

  const onArchive = () => {
    setError(null);
    startTransition(async () => {
      const result = await archiveThread(item.threadId);
      if (!result.ok) setError(result.reason);
    });
  };

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${item.gmailThreadId}`;

  return (
    <article
      role="listitem"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
    >
      <header className="flex items-baseline justify-between gap-3 text-xs text-[var(--color-text-muted)]">
        <CategoryBadge category={item.category} importance={item.importance} />
        <time dateTime={item.receivedAt?.toISOString() ?? ""}>
          {formatRelativeKst(item.receivedAt ?? undefined)}
        </time>
      </header>

      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">
        <span className="text-[var(--color-text-muted)]">
          {item.fromName ?? senderInitials(item.fromName, item.fromEmail)}
          {" · "}
          {senderDomain(item.fromEmail)}
        </span>
      </p>
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {item.subject ?? "(제목 없음)"}
      </h3>
      <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-[var(--color-text-muted)]">
        {item.summary}
      </p>

      <footer className="mt-3 flex items-center gap-2 text-xs">
        <a
          href={gmailUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surface-muted)]"
        >
          Gmail
        </a>
        <button
          type="button"
          onClick={onRead}
          disabled={isPending}
          className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
        >
          읽음
        </button>
        <button
          type="button"
          onClick={onArchive}
          disabled={isPending}
          className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
        >
          보관
        </button>
        {error && (
          <span role="status" className="ml-auto text-rose-700">
            오류: {error}
          </span>
        )}
      </footer>
    </article>
  );
}
