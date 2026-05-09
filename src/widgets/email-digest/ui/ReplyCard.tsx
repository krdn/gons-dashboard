// 답장 필요 카드 — 메인 reply-needed 항목 1개.
// 와이어프레임의 article.reply 시각 결정 그대로.
//
// severity high/med 는 좌측 3px 보더 + WCAG 위반 회피용 텍스트 뱃지 (ReplyBadges).
// "답장함" 클릭 → markAsReplied Server Action → 카드 collapse + 토스트 + undo.
//   v0.1: 토스트와 undo는 Sprint 3에 web-push와 함께 구현 (지금은 간단한 form 액션).
"use client";

import { useTransition } from "react";
import {
  markAsReplied,
  dismissThread,
} from "@/features/email-analysis";
import type { ReplyNeededItem } from "@/entities/email";
import { SenderAvatar } from "./SenderAvatar";
import { ReplyBadges } from "./ReplyBadges";
import {
  formatRelativeKst,
  senderInitials,
  senderDomain,
} from "@/shared/lib/email-format";

interface ReplyCardProps {
  item: ReplyNeededItem;
}

export function ReplyCard({ item }: ReplyCardProps) {
  const [isPending, startTransition] = useTransition();

  const handleReplied = () => {
    startTransition(async () => {
      await markAsReplied(item.threadId);
    });
  };

  const handleDismiss = () => {
    startTransition(async () => {
      await dismissThread(item.threadId);
    });
  };

  const ariaLabel = `${item.fromName ?? item.fromEmail ?? "발신자"}님의 메일: ${item.subject ?? "(제목 없음)"}, 우선순위: ${item.severity === "high" ? "지금 답해야" : item.severity === "med" ? "오늘 안" : "낮음"}`;

  return (
    <article
      tabIndex={0}
      aria-label={ariaLabel}
      data-severity={item.severity}
      className={[
        "grid items-start gap-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-4 transition-shadow duration-200 ease-out hover:shadow-[var(--shadow-elev)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
        "grid-cols-[auto_minmax(0,1fr)_auto] max-md:grid-cols-[auto_1fr]",
        item.severity === "high"
          ? "border-l-[3px] border-l-[var(--color-severity-high)] pl-[calc(theme(spacing.5)-2px)]"
          : item.severity === "med"
            ? "border-l-[3px] border-l-[var(--color-severity-med)] pl-[calc(theme(spacing.5)-2px)]"
            : "",
        isPending ? "pointer-events-none opacity-60" : "",
      ].join(" ")}
    >
      <SenderAvatar initials={senderInitials(item.fromName, item.fromEmail)} />

      <div className="min-w-0">
        <p className="mb-0.5 text-xs text-[var(--color-text-muted)]">
          <b className="font-semibold text-[var(--color-text)]">
            {item.fromName ?? item.fromEmail ?? "발신자"}
          </b>
          {item.fromEmail && (
            <>
              {" · "}
              {senderDomain(item.fromEmail)}
            </>
          )}
          {item.receivedAt && (
            <>
              {" · "}
              {formatRelativeKst(item.receivedAt)}
            </>
          )}
        </p>
        <p className="mb-3 truncate text-sm font-medium text-[var(--color-text)]">
          {item.subject ?? "(제목 없음)"}
        </p>
        <ReplyBadges severity={item.severity} reason={item.reason} />
      </div>

      <div className="flex gap-2 self-center max-md:col-span-2 max-md:mt-2 max-md:justify-end max-md:border-t max-md:border-[var(--color-hairline)] max-md:pt-2">
        <button
          type="button"
          onClick={handleReplied}
          disabled={isPending}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:bg-[oklch(15%_0.01_264)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          답장함
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isPending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          무시
        </button>
      </div>
    </article>
  );
}
