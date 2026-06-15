"use client";

// 답장 인라인 편집기.
// 마운트 → generateReplyDraft → textarea 편집 → Gmail 초안 저장 / 다시 생성 / 취소.
// 상태 머신: loading → editing(meta) | error(message) | saved.

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  generateReplyDraft,
  saveReplyDraft,
} from "@/features/email-reply/client";
import type { SaveDraftMeta } from "@/features/email-reply/client";

// ── 상태 타입 ─────────────────────────────────────────────────────────────────

type Status =
  | { phase: "loading" }
  | { phase: "editing"; meta: SaveDraftMeta }
  | { phase: "error"; message: string }
  | { phase: "saved" };

// ── Props ─────────────────────────────────────────────────────────────────────

interface ReplyComposerProps {
  threadId: string;
  onClose: () => void;
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export function ReplyComposer({ threadId, onClose }: ReplyComposerProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  // 여러 composer 동시 펼침 시 DOM id 충돌 방지 (aria-labelledby 연결용).
  const labelId = useId();

  // stale 응답 무시용 request token (증가 카운터).
  // 재생성·재마운트로 새 요청이 시작되면 이전 응답은 id 불일치로 버려진다.
  const requestIdRef = useRef(0);

  // 초안 생성 공통 함수 (마운트 + 다시 생성 공유).
  // ※ 동기 setState 없음 — .then 콜백에서만 상태 갱신 (set-state-in-effect 룰 준수).
  function runGenerate() {
    const id = ++requestIdRef.current;
    generateReplyDraft(threadId).then(
      (result) => {
        if (id !== requestIdRef.current) return; // stale 응답 무시
        if (result.kind === "ok") {
          setBody(result.body);
          setStatus({ phase: "editing", meta: result.meta });
        } else if (result.kind === "scope-required") {
          setStatus({
            phase: "error",
            message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요.",
          });
        } else {
          // result.kind === "llm-unavailable"
          setStatus({
            phase: "error",
            message: "초안 생성에 실패했습니다. 다시 시도하세요.",
          });
        }
      },
      () => {
        if (id !== requestIdRef.current) return; // stale 응답 무시
        setStatus({
          phase: "error",
          message: "초안 생성 중 오류가 발생했습니다.",
        });
      },
    );
  }

  // 마운트 시 초안 생성.
  // ※ cleanup 불필요 — token 불일치로 stale 응답 무시, unmount 후 setState는 no-op.
  useEffect(() => {
    runGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // 다시 생성 버튼 — 이벤트 핸들러에서만 loading 동기 set (룰 허용).
  function handleRegenerate() {
    setStatus({ phase: "loading" });
    runGenerate();
  }

  // Gmail 초안 저장 — promise 반환으로 isPending 트래킹 정상 동작.
  function handleSave(meta: SaveDraftMeta) {
    startTransition(() =>
      saveReplyDraft(threadId, body, meta).then(
        (result) => {
          if (result.kind === "ok") {
            setStatus({ phase: "saved" });
          } else if (result.kind === "scope-required") {
            setStatus({
              phase: "error",
              message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요.",
            });
          } else {
            // result.kind === "save-failed"
            setStatus({
              phase: "error",
              message: "초안 저장에 실패했습니다.",
            });
          }
        },
        () => {
          setStatus({
            phase: "error",
            message: "저장 중 오류가 발생했습니다.",
          });
        },
      ),
    );
  }

  // ── 컨테이너 베이스 클래스 ─────────────────────────────────────────────────
  const containerCls =
    "mt-3 border-t border-dashed border-[var(--color-hairline)] pt-3 text-xs text-[var(--color-text-muted)]";

  // ── 렌더 (phase별 early return) ────────────────────────────────────────────

  if (status.phase === "loading") {
    return (
      <div className={containerCls}>
        ✦ AI 초안 생성 중…
      </div>
    );
  }

  if (status.phase === "saved") {
    return (
      <div className={containerCls}>
        ✓ Gmail 초안함에 저장됐습니다.{" "}
        <a
          href="https://mail.google.com/mail/u/0/#drafts"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] underline"
        >
          초안함 열기
        </a>
        <button
          type="button"
          onClick={onClose}
          className="ml-3 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          닫기
        </button>
      </div>
    );
  }

  if (status.phase === "error") {
    return (
      <div className={containerCls}>
        <p role="status" className="text-[var(--color-severity-high)]">
          {status.message}
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          className="mt-2 rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)]"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // status.phase === "editing"
  const { meta } = status;

  return (
    <div className={containerCls}>
      {/* 라벨 — textarea와 aria-labelledby로 연결 (WCAG 1.3.1) */}
      <p
        id={labelId}
        className="mb-2 font-medium text-[var(--color-text-muted)]"
      >
        ✦ AI 초안 · 수정 가능
      </p>

      {/* 편집 영역 */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        aria-labelledby={labelId}
        className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />

      {/* 버튼 3개 */}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => handleSave(meta)}
          disabled={isPending || body.trim() === ""}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:opacity-80 disabled:pointer-events-none disabled:opacity-40"
        >
          Gmail 초안 저장
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isPending}
          className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] disabled:pointer-events-none disabled:opacity-40"
        >
          다시 생성
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-40"
        >
          취소
        </button>
      </div>
    </div>
  );
}
