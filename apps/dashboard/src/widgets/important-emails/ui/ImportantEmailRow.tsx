// 중요 메일 행 — 클라이언트 컴포넌트, "읽음"·"보관" 액션 포함.
//
// summary는 React 기본 children으로 렌더 (XSS 방지, raw HTML 주입 미사용).
// Gmail 링크는 새 탭에서 열림.
//
// Sender 폴백: fromName ?? fromEmail ?? "발신자" 순. ReplyCard 와 동일 패턴 —
// fromName 만 null check 하면 fromEmail 정보까지 잃고 senderInitials (두 글자) 만 노출돼
// 발신자 식별이 약해진다.
//
// Optimistic UI: 읽음/보관 액션 시 즉시 isHidden 으로 카드 제거. 실패 시 복원 + 에러 표시.
// ReplyCard 의 동일 패턴 — 액션 결과를 기다리지 않고 즉각 피드백.
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAsRead, archiveThread } from "@/features/email-analysis";
import {
  senderDomain,
  formatRelativeKst,
} from "@/shared/lib/email-format";
import { CategoryBadge } from "./CategoryBadge";
import type { ImportantEmailItem } from "@/entities/email/model/types";

// 서버 액션의 reason 코드 → 사용자 메시지. 미매핑 reason 은 코드 그대로 노출.
const REASON_LABELS: Record<string, string> = {
  unauthorized: "로그인이 만료되었습니다",
  "not-found": "메일을 찾을 수 없습니다",
  "reauth-required": "Gmail 재로그인이 필요합니다",
  "auth-error": "인증 오류 — 잠시 후 다시 시도해주세요",
  "rate-limited": "Gmail API 호출 한도 초과 — 잠시 후 다시 시도해주세요",
  forbidden: "Gmail 권한이 부족합니다",
  "gmail-error": "Gmail 처리 중 오류 — 잠시 후 다시 시도해주세요",
};

export function ImportantEmailRow({ item }: { item: ImportantEmailItem }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isHidden, setIsHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = (
    action: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  ) => {
    startTransition(async () => {
      setError(null);
      setIsHidden(true);
      const result = await action();
      if (!result.ok) {
        setIsHidden(false);
        setError(result.reason);
      } else {
        router.refresh();
      }
    });
  };

  const onRead = () => runAction(() => markAsRead(item.threadId));
  const onArchive = () => runAction(() => archiveThread(item.threadId));

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${item.gmailThreadId}`;
  const senderLabel = item.fromName ?? item.fromEmail ?? "발신자";

  if (isHidden) return null;

  return (
    <article
      role="listitem"
      className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 shadow-sm"
    >
      <header className="flex items-baseline justify-between gap-3 text-xs text-[var(--color-text-muted)]">
        <CategoryBadge category={item.category} importance={item.importance} />
        <time dateTime={item.receivedAt?.toISOString() ?? ""}>
          {formatRelativeKst(item.receivedAt ?? undefined)}
        </time>
      </header>

      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">
        <span className="text-[var(--color-text-muted)]">
          {senderLabel}
          {item.fromEmail && (
            <>
              {" · "}
              {senderDomain(item.fromEmail)}
            </>
          )}
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
          className="rounded border border-[var(--color-hairline)] px-2 py-1 hover:bg-[var(--color-surface-2)]"
        >
          Gmail
        </a>
        <button
          type="button"
          onClick={onRead}
          disabled={isPending}
          className="rounded border border-[var(--color-hairline)] px-2 py-1 hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          읽음
        </button>
        <button
          type="button"
          onClick={onArchive}
          disabled={isPending}
          className="rounded border border-[var(--color-hairline)] px-2 py-1 hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          보관
        </button>
        {error && (
          <span role="status" className="ml-auto text-[var(--color-severity-high)]">
            {REASON_LABELS[error] ?? `오류: ${error}`}
          </span>
        )}
      </footer>
    </article>
  );
}
