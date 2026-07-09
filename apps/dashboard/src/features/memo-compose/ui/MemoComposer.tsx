"use client";
import { useState, useSyncExternalStore } from "react";
import { useSpeechRecognition } from "../lib/useSpeechRecognition";
import { saveDraft, clearDraft, getDraftSnapshot, subscribeDraft } from "../lib/memoDraftStorage";
import { cleanupTranscriptAction, createMemoAction } from "../client";

type Mode = "idle" | "cleaning" | "preview";
type Tab = "voice" | "text";

// 음성 지원 여부는 브라우저 런타임에서만 알 수 있는 값이라 useSyncExternalStore로 읽는다.
// 서버 스냅샷(getServerSnapshot)은 항상 false라 SSR과 hydration 첫 렌더가 일치 —
// useEffect+setState 방식과 달리 순수성 위반(react-hooks/set-state-in-effect) 없이 hydration-safe.
const subscribeNoop = () => () => {}; // 런타임 중 값이 바뀌지 않는 정적 능력이라 구독 불필요.

export function MemoComposer() {
  const speech = useSpeechRecognition();
  const voiceSupported = useSyncExternalStore(
    subscribeNoop,
    () => speech.isSupported,
    () => false,
  );
  // tab=null이면 "사용자가 아직 탭을 선택하지 않음" — voiceSupported 확정 후 렌더 중 파생.
  const [tab, setTab] = useState<Tab | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [cleaned, setCleaned] = useState("");
  const [title, setTitle] = useState("");
  const [textInput, setTextInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 승인 저장에 쓸 원문 — 녹음 종료 시 또는 초안 복원 시 확정 (복원 후엔 speech state가 비어있다).
  const [pendingRaw, setPendingRaw] = useState("");
  // 직전 AI 정리가 실패해 원문 폴백 상태인지 — 미리보기의 [다시 정리] affordance 노출 조건.
  const [cleanupFailed, setCleanupFailed] = useState(false);
  // 승인 전 초안 (localStorage) — 새로고침/이탈 후에도 복원 배너로 노출 (Codex P2).
  // getServerSnapshot=null 이라 SSR/hydration 첫 렌더 일치, 이후 클라이언트에서만 나타남.
  const draft = useSyncExternalStore(subscribeDraft, getDraftSnapshot, () => null);

  const activeTab: Tab = tab ?? (voiceSupported ? "voice" : "text");

  function restoreDraft() {
    const d = getDraftSnapshot();
    if (!d) return;
    setTab("voice");
    setPendingRaw(d.rawContent);
    setCleaned(d.cleanedContent || d.rawContent);
    setTitle(d.title);
    setNotice(null);
    // 정리 전(또는 실패) 초안이면 복원 후에도 [다시 정리]로 재시도 가능해야 한다.
    setCleanupFailed(!d.cleanedContent);
    setMode("preview");
  }

  // AI 정리 실행 — 녹음 종료 직후와 미리보기의 [다시 정리] 재시도가 공유.
  function runCleanup(raw: string) {
    setMode("cleaning");
    setNotice(null);
    cleanupTranscriptAction(raw).then(
      (result) => {
        const ok = result.kind === "ok";
        const text = ok ? result.cleaned : raw;
        if (!ok) setNotice("AI 정리 실패 — 다시 정리하거나 원문 그대로 저장하세요.");
        setCleanupFailed(!ok);
        setCleaned(text);
        // 실패 시 cleanedContent는 비워 저장 — 복원 시 "정리 안 된 초안"으로 식별돼 재시도 affordance가 살아난다.
        saveDraft({ rawContent: raw, cleanedContent: ok ? text : "", title, savedAt: Date.now() });
        setMode("preview");
      },
      () => {
        setCleaned(raw);
        setCleanupFailed(true);
        setNotice("AI 정리 실패 — 다시 정리하거나 원문 그대로 저장하세요.");
        setMode("preview");
      },
    );
  }

  // 음성: 녹음 종료(최종 final 대기) → 클린업 → 미리보기
  function handleStopAndClean() {
    setMode("cleaning");
    // stop()은 마지막 발화의 final 결과(onend)까지 기다린 최종 원문을 resolve한다 —
    // 즉시 state를 읽으면 끝 문장이 유실된다 (Codex P2).
    speech.stop().then((finalRaw) => {
      const raw = finalRaw.trim();
      if (!raw) {
        setNotice("녹음된 내용이 없습니다.");
        setMode("idle");
        return;
      }
      setPendingRaw(raw);
      saveDraft({ rawContent: raw, cleanedContent: "", title: "", savedAt: Date.now() });
      runCleanup(raw);
    });
  }

  // 음성 승인 저장 — 원문은 pendingRaw (초안 복원 경로에선 speech state가 비어있다).
  function handleApprove() {
    const raw = pendingRaw.trim();
    setSaving(true);
    createMemoAction({ source: "voice", rawContent: raw, cleanedContent: cleaned.trim(), title }).then(
      (r) => {
        setSaving(false);
        if (r.kind === "ok") {
          clearDraft();
          resetVoice();
          setNotice("저장되었습니다.");
        } else {
          setNotice(r.kind === "invalid" ? "내용이 비어 있습니다." : "저장에 실패했습니다.");
        }
      },
      () => {
        setSaving(false);
        setNotice("저장에 실패했습니다.");
      },
    );
  }

  function resetVoice() {
    speech.reset();
    setPendingRaw("");
    setCleaned("");
    setTitle("");
    setCleanupFailed(false);
    setMode("idle");
  }

  // 텍스트 바로 저장
  function handleSaveText() {
    const text = textInput.trim();
    if (!text) {
      setNotice("내용을 입력하세요.");
      return;
    }
    setSaving(true);
    createMemoAction({ source: "text", rawContent: text, cleanedContent: text, title }).then(
      (r) => {
        setSaving(false);
        if (r.kind === "ok") {
          setTextInput("");
          setTitle("");
          setNotice("저장되었습니다.");
        } else {
          setNotice("저장에 실패했습니다.");
        }
      },
      () => {
        setSaving(false);
        setNotice("저장에 실패했습니다.");
      },
    );
  }

  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      {draft && mode === "idle" && !speech.isRecording && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="text-amber-800">저장하지 않은 메모 초안이 있습니다.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={restoreDraft} className="rounded bg-neutral-900 px-3 py-1 text-xs text-white">
              복원
            </button>
            <button type="button" onClick={clearDraft} className="rounded border px-3 py-1 text-xs">
              버리기
            </button>
          </div>
        </div>
      )}
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("voice")}
          disabled={!voiceSupported}
          className={activeTab === "voice" ? "font-semibold" : "text-neutral-400"}
        >
          🎙 음성
        </button>
        <button type="button" onClick={() => setTab("text")} className={activeTab === "text" ? "font-semibold" : "text-neutral-400"}>
          ✍ 텍스트
        </button>
      </div>

      {!voiceSupported && activeTab === "voice" && mode === "idle" && (
        <p className="text-sm text-amber-600">이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트 메모를 이용하세요.</p>
      )}

      {/* preview는 음성 미지원 브라우저에서도 렌더 — 초안 복원 경로 (녹음 없이 승인만). */}
      {activeTab === "voice" && (voiceSupported || mode === "preview") && (
        <div className="space-y-3">
          {mode === "idle" && (
            <>
              {!speech.isRecording ? (
                <button type="button" onClick={speech.start} className="rounded bg-neutral-900 px-4 py-2 text-white">
                  녹음 시작
                </button>
              ) : (
                <button type="button" onClick={handleStopAndClean} className="rounded bg-red-600 px-4 py-2 text-white">
                  녹음 종료 · AI 정리
                </button>
              )}
              {speech.isRecording && (
                <p className="text-sm text-neutral-500">
                  {speech.rawTranscript}
                  <span className="text-neutral-400">{speech.interim}</span>
                </p>
              )}
              {speech.error === "not-allowed" && (
                <p className="text-sm text-red-600">마이크 권한이 거부되었습니다. 텍스트 메모를 이용하세요.</p>
              )}
            </>
          )}
          {mode === "cleaning" && <p className="text-sm text-neutral-500">AI가 정리하는 중…</p>}
          {mode === "preview" && (
            <>
              <p className="text-xs text-neutral-400">AI 정리는 텍스트를 서버로 전송합니다. 검토 후 승인하세요.</p>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="제목 (선택 — 비우면 자동)"
                className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <textarea
                value={cleaned}
                onChange={(e) => setCleaned(e.target.value)}
                rows={6}
                maxLength={20_000}
                className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleApprove} disabled={saving} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
                  {saving ? "저장 중…" : "승인 · 저장"}
                </button>
                {cleanupFailed && (
                  <button
                    type="button"
                    onClick={() => runCleanup(pendingRaw)}
                    disabled={saving}
                    className="rounded border px-4 py-2"
                  >
                    다시 정리
                  </button>
                )}
                <button type="button" onClick={resetVoice} disabled={saving} className="rounded border px-4 py-2">
                  취소
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "text" && (
        <div className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 (선택)"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            rows={5}
            maxLength={20_000}
            placeholder="메모 입력…"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <button type="button" onClick={handleSaveText} disabled={saving} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {notice && <p className="mt-2 text-sm text-neutral-500">{notice}</p>}
    </section>
  );
}
