"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
  type Memo,
  type TransformPresetId,
} from "@/entities/memo/client";
import { TRANSFORM_PRESETS } from "../lib/preset-meta";
import { transformMemoAction, saveTransformationAction } from "../client";

type Phase = "pick" | "loading" | "preview";

interface TransformDialogProps {
  memo: Memo;
  /** 이미 저장된 프리셋 — 재생성 시 교체 경고 표시용. */
  existingPresets: TransformPresetId[];
  onClose: () => void;
}

// createPortal로 body 탈출 — inert 조상 아래 렌더되면 클릭 불가 (과거 사고 재발 방지).
export function TransformDialog({ memo, existingPresets, onClose }: TransformDialogProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [preset, setPreset] = useState<TransformPresetId | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const inputLen = memo.cleanedContent.trim().length;
  const busy = phase === "loading" || saving;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function run(p: TransformPresetId) {
    setPreset(p);
    setPhase("loading");
    setNotice(null);
    transformMemoAction(memo.id, p).then(
      (r) => {
        if (r.kind === "ok") {
          setContent(r.content);
          setPhase("preview");
        } else {
          setNotice(
            r.kind === "too-short"
              ? "내용이 너무 짧아 이 스타일로 정리할 수 없습니다."
              : r.kind === "not-found"
                ? "메모를 찾을 수 없습니다."
                : "AI 정리에 실패했습니다. 다시 시도해 주세요.",
          );
          setPhase("pick");
        }
      },
      () => {
        setNotice("AI 정리에 실패했습니다. 다시 시도해 주세요.");
        setPhase("pick");
      },
    );
  }

  function save() {
    if (!preset) return;
    setSaving(true);
    saveTransformationAction(memo.id, preset, content).then(
      (r) => {
        setSaving(false);
        if (r.kind === "ok") {
          onClose();
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI 정리"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 font-medium text-neutral-900">AI 정리 — {memo.title}</h2>

        {phase === "pick" && (
          <>
            <p className="mb-3 text-xs text-neutral-400">
              스타일을 선택하면 현재 정리본을 기준으로 변환합니다. 텍스트는 서버로 전송됩니다.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TRANSFORM_PRESET_IDS.map((id) => {
                const tooShort = inputLen < TRANSFORM_PRESETS[id].minInputLen;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={tooShort}
                    onClick={() => run(id)}
                    className="rounded border border-neutral-200 px-3 py-2 text-left text-sm hover:border-neutral-400 disabled:opacity-40"
                  >
                    <span className="font-medium">{TRANSFORM_PRESET_LABELS[id]}</span>
                    {existingPresets.includes(id) && (
                      <span className="block text-xs text-amber-600">저장됨 — 재생성 시 교체</span>
                    )}
                    {tooShort && <span className="block text-xs text-neutral-400">내용이 너무 짧음</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {phase === "loading" && <p className="py-6 text-center text-sm text-neutral-500">AI가 정리하는 중…</p>}

        {phase === "preview" && preset && (
          <>
            {existingPresets.includes(preset) && (
              <p className="mb-2 text-xs text-amber-600">기존 {TRANSFORM_PRESET_LABELS[preset]} 정리본을 교체합니다.</p>
            )}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {saving ? "저장 중…" : "저장"}
              </button>
              <button type="button" onClick={() => run(preset)} disabled={saving} className="rounded border px-4 py-2 text-sm">
                다시 생성
              </button>
              <button type="button" onClick={onClose} disabled={saving} className="rounded border px-4 py-2 text-sm">
                취소
              </button>
            </div>
          </>
        )}

        {notice && <p className="mt-3 text-sm text-neutral-500">{notice}</p>}
      </div>
    </div>,
    document.body,
  );
}
