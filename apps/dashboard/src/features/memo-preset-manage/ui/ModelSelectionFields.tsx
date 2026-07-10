"use client";
import {
  MEMO_MODEL_KEYS,
  MEMO_MODEL_META,
  recommendMemoModels,
  type MemoModelCatalog,
  type MemoModelKey,
  type MemoModelSelection,
} from "@/entities/memo/client";

interface ModelSelectionFieldsProps {
  idPrefix: string;
  value: MemoModelSelection | null;
  catalog: MemoModelCatalog;
  inheritFrom?: MemoModelSelection;
  disabled?: boolean;
  onChange: (value: MemoModelSelection | null) => void;
}

/** 공급사와 프록시의 실제 모델 ID를 한 쌍으로 선택한다. */
export function ModelSelectionFields({
  idPrefix,
  value,
  catalog,
  inheritFrom,
  disabled = false,
  onChange,
}: ModelSelectionFieldsProps) {
  const providerValue = value?.model ?? "inherit";
  const unavailable = value
    ? !catalog[value.model].includes(value.modelId)
    : inheritFrom
      ? !catalog[inheritFrom.model].includes(inheritFrom.modelId)
      : false;
  const recommendations = value ? recommendMemoModels(catalog, value.model) : [];
  const recommendedIds = new Set(recommendations.map((rec) => rec.modelId));
  const otherIds = value
    ? catalog[value.model].filter((id) => !recommendedIds.has(id))
    : [];

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
              {!catalog[value.model].includes(value.modelId) && (
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
