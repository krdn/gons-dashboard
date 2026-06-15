// 답장 필요 카드 — 메인 reply-needed 항목 1개.
// 와이어프레임의 article.reply 시각 결정 그대로.
//
// 액션 3종:
//   - "답장하기": 인라인 ReplyComposer 토글 (primary, LLM 초안 생성 + Gmail 전송).
//   - "답장 완료": markAsReplied Server Action → 위젯에서 제거 (이미 답장한 메일 표시).
//   - "무시": dismissThread Server Action → 24시간 숨김.
//
// severity high/med 는 좌측 3px 보더 + WCAG 위반 회피용 텍스트 뱃지 (ReplyBadges).
"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  markAsReplied,
  dismissThread,
} from "@/features/email-analysis";
import type { ReplyNeededItem } from "@/entities/email/api/getReplyNeeded";
import { SenderAvatar } from "./SenderAvatar";
import { ReplyBadges } from "./ReplyBadges";
import { ReplyComposer } from "./ReplyComposer";
import {
  formatRelativeKst,
  senderInitials,
  senderDomain,
} from "@/shared/lib/email-format";

interface ReplyCardProps {
  item: ReplyNeededItem;
}

export function ReplyCard({ item }: ReplyCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isHidden, setIsHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 인라인 답장 초안 편집기 토글 상태
  const [isComposing, setIsComposing] = useState(false);
  // aria-controls 연결용 고유 id (카드마다 고유)
  const composerId = useId();

  const runAction = (action: () => Promise<void>) => {
    startTransition(async () => {
      setError(null);
      setIsHidden(true);
      try {
        await action();
        router.refresh();
      } catch {
        setIsHidden(false);
        setError("처리에 실패했습니다. 잠시 후 다시 시도하세요.");
      }
    });
  };

  const handleReplied = () => {
    runAction(() => markAsReplied(item.threadId));
  };

  const handleDismiss = () => {
    runAction(() => dismissThread(item.threadId));
  };

  const ariaLabel = `${item.fromName ?? item.fromEmail ?? "발신자"}님의 메일: ${item.subject ?? "(제목 없음)"}, 우선순위: ${item.severity === "high" ? "지금 답해야" : item.severity === "med" ? "오늘 안" : "낮음"}`;

  if (isHidden) return null;

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
        {error ? (
          <p className="mt-2 text-xs font-medium text-[var(--color-severity-high)]" role="status">
            {error}
          </p>
        ) : null}
        {/* 인라인 답장 초안 편집기 — "답장하기" 토글 시 펼침 */}
        {isComposing ? (
          <div id={composerId}>
            <ReplyComposer threadId={item.threadId} onClose={() => setIsComposing(false)} />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 self-center max-md:col-span-2 max-md:mt-2 max-md:justify-end max-md:border-t max-md:border-[var(--color-hairline)] max-md:pt-2">
        <button
          type="button"
          onClick={() => setIsComposing((v) => !v)}
          aria-expanded={isComposing}
          aria-controls={composerId}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:bg-[oklch(15%_0.01_264)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          답장하기 {isComposing ? "▴" : "▾"}
        </button>
        <button
          type="button"
          onClick={handleReplied}
          disabled={isPending}
          title="이미 답장을 보낸 메일을 위젯에서 숨깁니다"
          className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          답장 완료
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isPending}
          title="24시간 동안 위젯에서 숨깁니다"
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          무시
        </button>
      </div>
    </article>
  );
}
