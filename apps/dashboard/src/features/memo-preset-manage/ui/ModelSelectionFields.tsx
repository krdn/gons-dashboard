"use client";
import {
  MEMO_MODEL_KEYS,
  MEMO_MODEL_META,
  MEMO_MODEL_RECOMMENDATION_RULES,
  type MemoModelCatalogSnapshot,
  type MemoModelKey,
  type MemoModelSelection,
} from "@/entities/memo/client";
import { deriveModelOptions } from "@/shared/lib/llm/provider-model-catalog";

interface ModelSelectionFieldsProps {
  idPrefix: string;
  value: MemoModelSelection | null;
  snapshot: MemoModelCatalogSnapshot;
  inheritFrom?: MemoModelSelection;
  disabled?: boolean;
  onChange: (value: MemoModelSelection | null) => void;
}

/** 공급사와 프록시의 실제 모델 ID를 한 쌍으로 선택한다. */
export function ModelSelectionFields({
  idPrefix,
  value,
  snapshot,
  inheritFrom,
  disabled = false,
  onChange,
}: ModelSelectionFieldsProps) {
  const catalog = snapshot.catalog;
  const providerValue = value?.model ?? "inherit";
  const effectiveSelection = value ?? inheritFrom;
  const options = effectiveSelection
    ? deriveModelOptions({
        snapshot,
        selection: {
          provider: effectiveSelection.model,
          modelId: effectiveSelection.modelId,
        },
        recommendationRules: MEMO_MODEL_RECOMMENDATION_RULES,
      })
    : null;
  const recommendations = value ? (options?.recommended ?? []) : [];
  const otherIds = value ? (options?.other ?? []) : [];
  const unavailable = options?.availability === "unavailable";

  function changeProvider(raw: string) {
    if (raw === "inherit") {
      onChange(null);
      return;
    }
    const model = raw as MemoModelKey;
    onChange({ model, modelId: catalog[model][0] });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-600">
          AI 공급사
        </span>
        <select
          id={`${idPrefix}-provider`}
          aria-label="AI 공급사"
          value={providerValue}
          disabled={disabled}
          onChange={(e) => changeProvider(e.target.value)}
          className="w-full rounded border border-neutral-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
        >
          {inheritFrom && (
            <option value="inherit">
              전체 설정 따름 ({MEMO_MODEL_META[inheritFrom.model].shortLabel})
            </option>
          )}
          {MEMO_MODEL_KEYS.map((model) => (
            <option
              key={model}
              value={model}
              disabled={catalog[model].length === 0 && value?.model !== model}
            >
              {MEMO_MODEL_META[model].label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-600">
          상세 모델
        </span>
        <select
          id={`${idPrefix}-model-id`}
          aria-label="상세 모델"
          value={value?.modelId ?? inheritFrom?.modelId ?? ""}
          disabled={disabled || value === null}
          onChange={(e) => {
            if (value) onChange({ ...value, modelId: e.target.value });
          }}
          className="w-full rounded border border-neutral-200 bg-white px-3 py-2 font-mono text-xs disabled:bg-neutral-100 disabled:text-neutral-500"
        >
          {value === null ? (
            inheritFrom && (
              <option value={inheritFrom.modelId}>{inheritFrom.modelId}</option>
            )
          ) : (
            <>
              {unavailable && (
                <option value={value.modelId} disabled>
                  {value.modelId} (현재 사용 불가)
                </option>
              )}
              {recommendations.length > 0 ? (
                <>
                  <optgroup label="추천 모델">
                    {recommendations.map((rec) => (
                      <option key={rec.modelId} value={rec.modelId}>
                        {rec.modelId} · {rec.reason}
                      </option>
                    ))}
                  </optgroup>
                  {otherIds.length > 0 && (
                    <optgroup label="기타 모델">
                      {otherIds.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              ) : (
                catalog[value.model].map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {modelId}
                  </option>
                ))
              )}
            </>
          )}
        </select>
      </label>
      {unavailable && (
        <p role="alert" className="text-xs text-red-600 sm:col-span-2">
          이 모델은 현재 프록시의 사용 가능 목록에 없습니다. 다른 모델을 선택해
          주세요.
        </p>
      )}
    </div>
  );
}
