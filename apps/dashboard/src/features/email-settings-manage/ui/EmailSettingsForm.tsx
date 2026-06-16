"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EMAIL_SETTINGS_DEFAULTS,
  type EmailSettings,
} from "@/entities/email-settings/client";
import { updateEmailSettings } from "../api/updateEmailSettings";
import { syncNowAction } from "../api/syncNowAction";
import { reclassifyAction } from "../api/reclassifyAction";

const CATEGORY_LABEL: Record<string, string> = {
  money: "금전",
  security: "보안",
  schedule: "일정",
  notice: "공지",
};
const SYNC_OPTIONS = [
  { value: 15, label: "15분" },
  { value: 30, label: "30분" },
  { value: 60, label: "1시간" },
  { value: 180, label: "3시간" },
  { value: 360, label: "6시간" },
];

const labelCls = "text-xs font-medium text-[var(--color-text-muted)]";
const inputCls =
  "mt-1 w-full rounded border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]";
const sectionCls =
  "border-t border-[var(--color-hairline)] pt-3 first:border-t-0 first:pt-0";

interface Props {
  initial?: EmailSettings;
  onDone: () => void;
}

export function EmailSettingsForm({ initial, onDone }: Props) {
  const s = initial ?? EMAIL_SETTINGS_DEFAULTS;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [actionPending, startActionTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateEmailSettings(formData);
        if (!result.ok) {
          setError(result.message ?? result.code);
          return;
        }
        router.refresh();
        onDone();
      } catch {
        setError("네트워크 오류 — 다시 시도해주세요");
      }
    });
  }

  function onSyncNow() {
    setActionMsg("동기화 중…");
    startActionTransition(async () => {
      try {
        const r = await syncNowAction();
        if (!r.ok) {
          setActionMsg(
            r.code === "REAUTH_REQUIRED"
              ? "재로그인이 필요합니다"
              : (r.message ?? "동기화 실패"),
          );
          return;
        }
        setActionMsg(`동기화 완료 — ${r.classified}건 분류`);
        router.refresh();
      } catch {
        setActionMsg("네트워크 오류 — 다시 시도해주세요");
      }
    });
  }

  function onReclassify() {
    setActionMsg("재분류 중…");
    startActionTransition(async () => {
      try {
        const r = await reclassifyAction();
        if (!r.ok) {
          setActionMsg(r.message ?? "재분류 실패");
          return;
        }
        setActionMsg(`재분류 완료 — ${r.classified}건 분류`);
        router.refresh();
      } catch {
        setActionMsg("네트워크 오류 — 다시 시도해주세요");
      }
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      {/* 표시 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          표시
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className={labelCls}>조회 기간(일)</span>
            <input
              type="number"
              name="windowDays"
              min={1}
              max={90}
              defaultValue={s.windowDays}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>답장 필요 개수</span>
            <input
              type="number"
              name="replyNeededLimit"
              min={1}
              max={50}
              defaultValue={s.replyNeededLimit}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>중요 메일 개수</span>
            <input
              type="number"
              name="importantLimit"
              min={1}
              max={50}
              defaultValue={s.importantLimit}
              className={inputCls}
            />
          </label>
        </div>
      </div>

      {/* 알림 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          알림
        </p>
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="digestEnabled"
            defaultChecked={s.digestEnabled}
            value="on"
          />
          아침 다이제스트 켜기
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>발송 시각(KST, 0-23)</span>
            <input
              type="number"
              name="digestHourKst"
              min={0}
              max={23}
              defaultValue={s.digestHourKst}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>답장 알림 민감도</span>
            <select
              name="replySeverityThreshold"
              defaultValue={s.replySeverityThreshold}
              className={inputCls}
            >
              <option value="high">높음만</option>
              <option value="med">보통 이상</option>
              <option value="low">전체</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <label className="block">
            <span className={labelCls}>답장 언어</span>
            <select
              name="replyLanguage"
              defaultValue={s.replyLanguage}
              className={inputCls}
            >
              <option value="auto">자동 (원문 언어)</option>
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
            </select>
          </label>
        </div>
      </div>

      {/* 중요 필터 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          중요 메일 필터
        </p>
        <div className="mb-2 flex flex-wrap gap-3 text-sm">
          {(["money", "security", "schedule", "notice"] as const).map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="categories"
                value={c}
                defaultChecked={s.categories.includes(c)}
              />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
        <label className="block">
          <span className={labelCls}>중요도</span>
          <select
            name="importantThreshold"
            defaultValue={s.importantThreshold}
            className={inputCls}
          >
            <option value="med">보통 이상</option>
            <option value="high">높음만</option>
          </select>
        </label>
      </div>

      {/* 분류 엔진 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          분류 엔진
        </p>
        <label className="mb-1.5 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="llmReplyEnabled"
            defaultChecked={s.llmReplyEnabled}
            value="on"
          />
          답장 LLM 분류
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="llmImportantEnabled"
            defaultChecked={s.llmImportantEnabled}
            value="on"
          />
          중요 메일 LLM 분류
        </label>
      </div>

      {/* 동기화 */}
      <div className={sectionCls}>
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          동기화
        </p>
        <label className="block">
          <span className={labelCls}>동기화 주기</span>
          <select
            name="syncIntervalMinutes"
            defaultValue={s.syncIntervalMinutes}
            className={inputCls}
          >
            {SYNC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSyncNow}
            disabled={actionPending}
            className="rounded border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            지금 동기화
          </button>
          <button
            type="button"
            onClick={onReclassify}
            disabled={actionPending}
            className="rounded border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            재분류
          </button>
          {actionMsg && (
            <span
              role="status"
              className="text-xs text-[var(--color-text-muted)]"
            >
              {actionMsg}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          저장 실패: {error}
        </p>
      )}

      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
