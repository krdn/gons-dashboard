"use client";
import { useState, useSyncExternalStore } from "react";
import { useSpeechRecognition } from "../lib/useSpeechRecognition";
import { saveDraft, clearDraft } from "../lib/memoDraftStorage";
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

  const activeTab: Tab = tab ?? (voiceSupported ? "voice" : "text");

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
      saveDraft({ rawContent: raw, cleanedContent: "", title: "", savedAt: Date.now() });
      cleanupTranscriptAction(raw).then(
        (result) => {
          const text = result.kind === "ok" ? result.cleaned : raw;
          if (result.kind !== "ok") setNotice("AI 정리 실패 — 원문 그대로 저장하거나 취소 후 다시 녹음하세요.");
          setCleaned(text);
          saveDraft({ rawContent: raw, cleanedContent: text, title: "", savedAt: Date.now() });
          setMode("preview");
        },
        () => {
          setCleaned(raw);
          setNotice("AI 정리 실패 — 원문 그대로 저장하거나 취소 후 다시 녹음하세요.");
          setMode("preview");
        },
      );
    });
  }

  // 음성 승인 저장
  function handleApprove() {
    const raw = speech.rawTranscript.trim();
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
    setCleaned("");
    setTitle("");
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

      {!voiceSupported && activeTab === "voice" && (
        <p className="text-sm text-amber-600">이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트 메모를 이용하세요.</p>
      )}

      {activeTab === "voice" && voiceSupported && (
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
                className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleApprove} disabled={saving} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
                  {saving ? "저장 중…" : "승인 · 저장"}
                </button>
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
