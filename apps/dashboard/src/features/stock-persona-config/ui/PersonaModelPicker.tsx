"use client";

import { useState, useTransition } from "react";
import {
  PERSONA_DISPLAY,
  DEFAULT_PERSONA_MODELS,
  type ModelName,
  type PersonaOrConsensus,
} from "@/entities/stock-analysis/client";
import { setPersonaModel, resetPersonaModels } from "../api/updateOverrides";

interface Props {
  initialOverrides: Partial<Record<PersonaOrConsensus, ModelName>>;
}

const PERSONA_ORDER: PersonaOrConsensus[] = [
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
  "consensus",
];

const PERSONA_LABEL: Record<PersonaOrConsensus, string> = {
  ...PERSONA_DISPLAY,
  consensus: "합의 요약자",
};

const MODEL_OPTIONS: { value: ModelName; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

export function PersonaModelPicker({ initialOverrides }: Props) {
  const [overrides, setOverrides] =
    useState<Partial<Record<PersonaOrConsensus, ModelName>>>(initialOverrides);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentModel = (p: PersonaOrConsensus): ModelName =>
    overrides[p] ?? DEFAULT_PERSONA_MODELS[p];

  const onChange = (persona: PersonaOrConsensus, model: ModelName) => {
    setOverrides((prev) => ({ ...prev, [persona]: model }));
    setError(null);
    startTransition(async () => {
      const res = await setPersonaModel({ persona, model });
      if (!res.success) {
        setError(res.error ?? "저장 실패");
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[persona];
          return next;
        });
      }
    });
  };

  const onReset = () => {
    if (!confirm("페르소나 모델 설정을 기본값으로 되돌릴까요?")) return;
    setError(null);
    startTransition(async () => {
      const res = await resetPersonaModels();
      if (!res.success) {
        setError(res.error ?? "리셋 실패");
        return;
      }
      setOverrides({});
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-text-muted)]">
        페르소나마다 분석에 사용할 LLM 모델을 선택하세요. 기본값: Claude×3 (월스트/한국/합의), Codex×2 (가치/기술), Gemini×1 (성장).
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-3 py-2">페르소나</th>
            <th className="px-3 py-2">모델</th>
          </tr>
        </thead>
        <tbody>
          {PERSONA_ORDER.map((p) => (
            <tr key={p} className="border-b border-[var(--color-hairline)]">
              <td className="px-3 py-3 font-semibold">{PERSONA_LABEL[p]}</td>
              <td className="px-3 py-3">
                <div
                  className="flex gap-2"
                  role="radiogroup"
                  aria-label={`${PERSONA_LABEL[p]} 모델 선택`}
                >
                  {MODEL_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-1 text-xs ${
                        currentModel(p) === opt.value
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                          : "border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`persona-${p}`}
                        value={opt.value}
                        checked={currentModel(p) === opt.value}
                        onChange={() => onChange(p, opt.value)}
                        disabled={pending}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          disabled={pending}
          className="rounded-lg border border-[var(--color-hairline)] px-4 py-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          기본값으로 리셋
        </button>
      </div>
    </div>
  );
}
