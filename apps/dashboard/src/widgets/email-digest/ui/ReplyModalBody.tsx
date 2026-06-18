"use client";

// 모달 내용 — 톤 3개 탭(편집 독립 보존) + 필드 + 저장/발송.
// 상태: loading → editing → saved | sent | error.
// refusal 탭은 저장·발송 차단 (CLI 정체성 거절 안전망).
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  generateReplyDraft,
  saveReplyDraft,
  sendReply,
} from "@/features/email-reply/client";
import type {
  GenerateReplyResult,
  ReplyTone,
  ReplyLength,
} from "@/features/email-reply/client";
import { SendConfirmDialog } from "./SendConfirmDialog";

type OkResult = Extract<GenerateReplyResult, { kind: "ok" }>;
type Meta = OkResult["meta"];

const LENGTH_LABEL: Record<ReplyLength, string> = {
  short: "짧게",
  medium: "보통",
  long: "길게",
};

type Status =
  | { phase: "loading" }
  | { phase: "editing"; meta: Meta }
  | { phase: "error"; message: string }
  | { phase: "saved" }
  | { phase: "sent" };

const TONE_LABEL: Record<ReplyTone, string> = {
  polite: "정중",
  concise: "간결",
  friendly: "친근",
};

interface ReplyModalBodyProps {
  threadId: string;
  onClose: () => void;
  onSent: () => void;
  // confirmOpen 은 부모(ReplyModal)가 소유 — ESC 라우팅·focus trap 양보 때문.
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  // 부모의 ESC·배경클릭이 호출할 "닫기 시도" 핸들러 등록 — dirty면 게이트.
  registerRequestClose: (fn: () => void) => void;
}

export function ReplyModalBody({
  threadId,
  onClose,
  onSent,
  confirmOpen,
  onConfirmOpenChange,
  registerRequestClose,
}: ReplyModalBodyProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  // 톤별 본문 (탭 독립 편집 보존)
  const [bodies, setBodies] = useState<Record<ReplyTone, string>>({
    polite: "",
    concise: "",
    friendly: "",
  });
  const [refusals, setRefusals] = useState<Record<ReplyTone, boolean>>({
    polite: false,
    concise: false,
    friendly: false,
  });
  const [activeTone, setActiveTone] = useState<ReplyTone>("polite");
  const [availableTones, setAvailableTones] = useState<ReplyTone[]>([]);
  // 길이 selector — 변경 시 전체 재생성. ref로 최신값 읽어 stale closure 회피.
  const [length, setLength] = useState<ReplyLength>("medium");
  const lengthRef = useRef<ReplyLength>("medium");
  const [toEmail, setToEmail] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalBody, setOriginalBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const tablistId = useId();
  const requestIdRef = useRef(0);
  // 사용자가 본문/필드를 손댔는지 — 닫기 시 변경사항 소실 confirm 게이트용.
  // AI 초안은 생성 직후 항상 non-empty 라 "non-empty=dirty"는 틀림. 명시 플래그.
  const [edited, setEdited] = useState(false);

  const setConfirmOpen = onConfirmOpenChange;

  // 닫기 시도 — dirty면 폐기 confirm 게이트. 취소 버튼·부모(ESC·배경클릭) 공유.
  function requestClose() {
    if (edited && !window.confirm("작성 중인 답장이 사라집니다. 닫을까요?")) return;
    onClose();
  }
  // 부모 ref 에 최신 closure(edited 최신값 캡처) 등록 — 렌더 중 ref 갱신은 허용 패턴.
  registerRequestClose(requestClose);

  function runGenerate() {
    const id = ++requestIdRef.current;
    generateReplyDraft(threadId, lengthRef.current).then(
      (result) => {
        if (id !== requestIdRef.current) return;
        if (result.kind === "ok") {
          const nextBodies = { polite: "", concise: "", friendly: "" };
          const nextRefusals = { polite: false, concise: false, friendly: false };
          for (const d of result.drafts) {
            nextBodies[d.tone] = d.body;
            nextRefusals[d.tone] = d.refusal;
          }
          setBodies(nextBodies);
          setRefusals(nextRefusals);
          const tones = result.drafts.map((d) => d.tone);
          setAvailableTones(tones);
          setActiveTone(tones[0] ?? "polite");
          setToEmail(result.meta.toEmail);
          setSubject(result.meta.subject);
          setOriginalBody(result.meta.originalBody);
          setStatus({ phase: "editing", meta: result.meta });
        } else if (result.kind === "scope-required") {
          setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
        } else {
          setStatus({ phase: "error", message: "초안 생성에 실패했습니다. 다시 시도하세요." });
        }
      },
      () => {
        if (id !== requestIdRef.current) return;
        setStatus({ phase: "error", message: "초안 생성 중 오류가 발생했습니다." });
      },
    );
  }

  useEffect(() => {
    runGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function handleRegenerate() {
    setStatus({ phase: "loading" });
    runGenerate();
  }

  // 길이 변경 — ref 즉시 갱신 후 전체 재생성 (3개 톤 모두 새 길이로).
  function handleLengthChange(next: ReplyLength) {
    lengthRef.current = next;
    setLength(next);
    setStatus({ phase: "loading" });
    runGenerate();
  }

  // 톤 탭 좌우 화살표 roving — WAI-ARIA tabs 키보드 패턴.
  function handleToneKeyDown(
    e: ReactKeyboardEvent<HTMLButtonElement>,
    current: ReplyTone,
  ) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = availableTones.indexOf(current);
    if (idx === -1) return;
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next =
      availableTones[(idx + delta + availableTones.length) % availableTones.length];
    setActiveTone(next);
    document.getElementById(`${tablistId}-tab-${next}`)?.focus();
  }

  // 필드 setter 를 감싸 편집 시 dirty 플래그를 세움.
  function editField(setter: (v: string) => void) {
    return (v: string) => {
      setEdited(true);
      setter(v);
    };
  }

  function metaWithFields(meta: Meta) {
    // To/제목/CC/BCC 는 사용자 편집값 반영. 빈 문자열은 undefined 로 → 빈 헤더 생략.
    return { ...meta, toEmail, subject, cc: cc || undefined, bcc: bcc || undefined };
  }

  function handleSave(meta: Meta) {
    const body = bodies[activeTone];
    startTransition(() =>
      saveReplyDraft(threadId, body, metaWithFields(meta)).then(
        (result) => {
          if (result.kind === "ok") {
            setEdited(false);
            setStatus({ phase: "saved" });
          }
          else if (result.kind === "scope-required")
            setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
          else setStatus({ phase: "error", message: "초안 저장에 실패했습니다." });
        },
        () => setStatus({ phase: "error", message: "저장 중 오류가 발생했습니다." }),
      ),
    );
  }

  function handleSend(meta: Meta) {
    const body = bodies[activeTone];
    startTransition(() =>
      sendReply(threadId, body, metaWithFields(meta)).then(
        (result) => {
          setConfirmOpen(false);
          if (result.kind === "ok") {
            setEdited(false);
            setStatus({ phase: "sent" });
            onSent();
          } else if (result.kind === "scope-required")
            setStatus({ phase: "error", message: "Gmail 쓰기 권한이 없습니다. 재로그인 해주세요." });
          else setStatus({ phase: "error", message: "발송에 실패했습니다. 다시 시도하세요." });
        },
        () => {
          setConfirmOpen(false);
          setStatus({ phase: "error", message: "발송 중 오류가 발생했습니다." });
        },
      ),
    );
  }

  if (status.phase === "loading")
    return <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">✦ AI 초안 생성 중…</p>;

  if (status.phase === "saved")
    return (
      <div className="py-6 text-center text-sm text-[var(--color-text-muted)]">
        ✓ Gmail 초안함에 저장됐습니다.
        <button type="button" onClick={onClose} className="ml-3 underline">닫기</button>
      </div>
    );

  if (status.phase === "sent")
    return (
      <div className="py-6 text-center text-sm text-[var(--color-text-muted)]">
        ✓ 답장을 발송했습니다.
        <button type="button" onClick={onClose} className="ml-3 underline">닫기</button>
      </div>
    );

  if (status.phase === "error")
    return (
      <div className="py-6 text-center">
        <p role="status" className="text-sm text-[var(--color-severity-high)]">{status.message}</p>
        <button
          type="button"
          onClick={handleRegenerate}
          className="mt-3 rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium"
        >
          다시 시도
        </button>
      </div>
    );

  const { meta } = status;
  const currentRefusal = refusals[activeTone];
  const blocked = isPending || currentRefusal || bodies[activeTone].trim() === "";

  return (
    <div className="text-sm">
      {/* 필드 — 편집 시 dirty 플래그 세움(닫기 confirm 게이트용). */}
      <div className="mb-3 space-y-2">
        <Field label="받는사람" value={toEmail} onChange={editField(setToEmail)} />
        <Field label="참조 (CC)" value={cc} onChange={editField(setCc)} placeholder="선택" />
        <Field label="숨은참조 (BCC)" value={bcc} onChange={editField(setBcc)} placeholder="선택" />
        <Field label="제목" value={subject} onChange={editField(setSubject)} />
      </div>

      {/* 원본 본문 토글 */}
      <button
        type="button"
        onClick={() => setShowOriginal((v) => !v)}
        className="mb-2 text-xs text-[var(--color-text-muted)] underline"
      >
        원본 메일 {showOriginal ? "숨기기" : "보기"}
      </button>
      {showOriginal && (
        <div className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          {originalBody || "(본문 없음)"}
        </div>
      )}

      {/* 길이 selector — 변경 시 전체 재생성 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-muted)]">길이</span>
        <div className="flex gap-1">
          {(["short", "medium", "long"] as ReplyLength[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => handleLengthChange(l)}
              disabled={isPending}
              aria-pressed={length === l}
              className={[
                "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                length === l
                  ? "bg-[var(--color-accent)] text-[var(--color-surface)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              ].join(" ")}
            >
              {LENGTH_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      {/* 톤 탭 — WAI-ARIA tabs 패턴(roving tabindex + 화살표 키). */}
      <div role="tablist" aria-label="답장 톤" className="mb-2 flex gap-1">
        {availableTones.map((t) => (
          <button
            key={t}
            id={`${tablistId}-tab-${t}`}
            role="tab"
            aria-selected={activeTone === t}
            aria-controls={`${tablistId}-panel`}
            tabIndex={activeTone === t ? 0 : -1}
            type="button"
            onClick={() => setActiveTone(t)}
            onKeyDown={(e) => handleToneKeyDown(e, t)}
            className={[
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              activeTone === t
                ? "bg-[var(--color-text)] text-[var(--color-surface)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              refusals[t] ? "line-through opacity-60" : "",
            ].join(" ")}
          >
            {TONE_LABEL[t]}
          </button>
        ))}
      </div>

      <textarea
        id={`${tablistId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tablistId}-tab-${activeTone}`}
        value={bodies[activeTone]}
        onChange={(e) => {
          setEdited(true);
          setBodies((b) => ({ ...b, [activeTone]: e.target.value }));
        }}
        rows={8}
        className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />

      {currentRefusal && (
        <p role="status" className="mt-1 text-xs text-[var(--color-severity-high)]">
          ⚠️ 이 초안은 비정상입니다(AI 거절 응답). 다시 생성하거나 다른 톤을 선택하세요.
        </p>
      )}

      {/* 버튼 */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={blocked}
          className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] hover:opacity-80 disabled:opacity-40"
        >
          발송
        </button>
        <button
          type="button"
          onClick={() => handleSave(meta)}
          disabled={blocked}
          className="rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          Gmail 초안 저장
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isPending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          다시 생성
        </button>
        <button
          type="button"
          onClick={requestClose}
          disabled={isPending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          취소
        </button>
      </div>

      {confirmOpen && (
        <SendConfirmDialog
          toEmail={toEmail}
          subject={subject}
          body={bodies[activeTone]}
          cc={cc}
          bcc={bcc}
          isSending={isPending}
          onConfirm={() => handleSend(meta)}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-[var(--color-text-muted)]">{label}</span>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      />
    </label>
  );
}
