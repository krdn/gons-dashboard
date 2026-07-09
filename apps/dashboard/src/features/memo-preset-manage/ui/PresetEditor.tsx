"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PresetCatalogEntry } from "@/features/memo-transform/client";
import {
  savePresetAction,
  createPresetAction,
  resetPresetAction,
  deletePresetAction,
  previewPresetAction,
} from "../client";

const SAMPLE_TEXT = "음… 내일 오전에 김대리랑 회의 있고, 끝나면 보고서 초안 써야 함.";

interface PresetEditorProps {
  /** null = 새 커스텀 프리셋 */
  entry: PresetCatalogEntry | null;
  onDone: () => void;
  /** dirty 상태 변화를 부모(PresetSettings)에 보고 — 항목 전환 시 confirm 판단용. */
  onDirtyChange?: (dirty: boolean) => void;
}

// 주의: entry가 바뀌면 부모가 key={entry?.slug ?? "new"}로 이 컴포넌트를 리마운트해
// 필드를 리셋한다 (useEffect 안 동기 setState 금지 — React 19 purity 규칙).

interface EditorFields {
  label: string;
  instruction: string;
  fidelityGuard: boolean;
}

function fieldsFromEntry(entry: PresetCatalogEntry | null): EditorFields {
  if (!entry) return { label: "", instruction: "", fidelityGuard: true };
  return { label: entry.label, instruction: entry.instruction, fidelityGuard: entry.fidelityGuard };
}

function fieldsEqual(a: EditorFields, b: EditorFields): boolean {
  return a.label === b.label && a.instruction === b.instruction && a.fidelityGuard === b.fidelityGuard;
}

function isFieldsValid(fields: EditorFields): boolean {
  return fields.label.trim().length > 0 && fields.instruction.trim().length > 0;
}

export function usePresetEditorDirty(entry: PresetCatalogEntry | null, fields: EditorFields): boolean {
  const original = fieldsFromEntry(entry);
  if (!entry) return isFieldsValid(fields);
  return !fieldsEqual(original, fields);
}

type SaveFailure = "invalid" | "limit-exceeded" | "failed";

const SAVE_FAILURE_MESSAGE: Record<SaveFailure, string> = {
  invalid: "입력을 확인해 주세요.",
  "limit-exceeded": "커스텀 프리셋은 최대 20개입니다.",
  failed: "저장에 실패했습니다.",
};

export function PresetEditor({ entry, onDone, onDirtyChange }: PresetEditorProps) {
  const router = useRouter();
  const [fields, setFields] = useState<EditorFields>(() => fieldsFromEntry(entry));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState(SAMPLE_TEXT);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRunning, setPreviewRunning] = useState(false);

  const dirty = usePresetEditorDirty(entry, fields);
  const valid = isFieldsValid(fields);

  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  const isBuiltin = entry?.isBuiltin ?? false;
  const isCustom = entry !== null && !isBuiltin;
  const isNew = entry === null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const result = await createPresetAction({
          label: fields.label,
          instruction: fields.instruction,
          fidelityGuard: fields.fidelityGuard,
        });
        if (result.kind !== "ok") {
          setError(SAVE_FAILURE_MESSAGE[result.kind]);
          return;
        }
      } else {
        const result = await savePresetAction(entry.slug, {
          label: fields.label,
          instruction: fields.instruction,
          fidelityGuard: fields.fidelityGuard,
        });
        if (result.kind !== "ok") {
          setError(SAVE_FAILURE_MESSAGE[result.kind]);
          return;
        }
      }
      router.refresh();
      onDone();
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!entry) return;
    if (!window.confirm("기본값으로 복구할까요?")) return;
    const result = await resetPresetAction(entry.slug);
    if (result.kind === "ok") {
      router.refresh();
      onDone();
    } else {
      setError("저장에 실패했습니다.");
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!window.confirm("삭제할까요? 기존 변환본은 보존됩니다.")) return;
    const result = await deletePresetAction(entry.slug);
    if (result.kind === "ok") {
      router.refresh();
      onDone();
    } else {
      setError("저장에 실패했습니다.");
    }
  }

  async function handlePreview() {
    setPreviewRunning(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const result = await previewPresetAction({
        instruction: fields.instruction,
        fidelityGuard: fields.fidelityGuard,
        sampleText,
      });
      if (result.kind === "ok") {
        setPreviewResult(result.content);
      } else {
        setPreviewError("테스트 실행에 실패했습니다.");
      }
    } finally {
      setPreviewRunning(false);
    }
  }

  return (
    <section aria-label="프리셋 편집" className="space-y-5">
      <div>
        <label htmlFor="preset-label" className="mb-1 block text-sm font-medium text-neutral-700">
          라벨
        </label>
        <input
          id="preset-label"
          type="text"
          value={fields.label}
          maxLength={20}
          readOnly={isBuiltin}
          onChange={(e) => setFields({ ...fields, label: e.target.value })}
          className="w-full rounded border border-neutral-200 px-3 py-2 text-sm read-only:bg-neutral-50 read-only:text-neutral-500"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="preset-instruction" className="block text-sm font-medium text-neutral-700">
            지시문
          </label>
          <span className="text-xs text-neutral-400">{fields.instruction.length} / 2000</span>
        </div>
        <textarea
          id="preset-instruction"
          value={fields.instruction}
          maxLength={2000}
          rows={8}
          onChange={(e) => setFields({ ...fields, instruction: e.target.value })}
          className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={fields.fidelityGuard}
            onChange={(e) => setFields({ ...fields, fidelityGuard: e.target.checked })}
          />
          충실 가드
        </label>
        <p className="mt-1 text-xs text-neutral-400">고유명사·내용 보존, 조언 금지</p>
      </div>

      {isBuiltin && entry?.isOverridden && entry.defaultInstruction && (
        <details className="text-sm text-neutral-600">
          <summary className="cursor-pointer select-none">기본 프롬프트 보기</summary>
          <p className="mt-2 whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">
            {entry.defaultInstruction}
          </p>
        </details>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || !valid || saving}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {isBuiltin && entry?.isOverridden && (
          <button type="button" onClick={handleReset} className="rounded border border-neutral-200 px-4 py-2 text-sm">
            기본값 복구
          </button>
        )}
        {isCustom && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded border border-neutral-200 px-4 py-2 text-sm text-red-600 hover:border-red-300"
          >
            삭제
          </button>
        )}
      </div>

      <div className="border-t border-neutral-200 pt-4">
        <h3 className="mb-2 text-sm font-medium text-neutral-700">테스트 실행</h3>
        <textarea
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          rows={3}
          className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewRunning || fields.instruction.trim().length === 0}
          className="mt-2 rounded border border-neutral-200 px-4 py-2 text-sm disabled:opacity-40"
        >
          {previewRunning ? "실행 중…" : "▶ 테스트 실행"}
        </button>
        {previewResult && (
          <pre className="mt-3 whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
            {previewResult}
          </pre>
        )}
        {previewError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {previewError}
          </p>
        )}
      </div>
    </section>
  );
}
