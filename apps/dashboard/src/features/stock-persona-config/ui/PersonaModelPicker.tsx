"use client";

// 페르소나별 모델 선택 — AI 공급사 + 상세 모델 페어 (EmailSettingsForm/SajuModelPicker 미러).
// 카탈로그는 탭이 열릴 때(=이 컴포넌트 마운트 시) lazy 로드 — 홈 렌더 블로킹 방지.
import { useEffect, useState, useTransition } from "react";
import {
  PERSONA_DISPLAY,
  DEFAULT_PERSONA_MODELS,
  STOCK_MODEL_RECOMMENDATION_RULES,
  type ModelName,
  type PersonaOrConsensus,
  type PersonaModelOverride,
  type PersonaModelCatalogData,
} from "@/entities/stock-analysis/client";
import {
  LLM_PROVIDER_META,
  deriveModelOptions,
} from "@/shared/lib/llm/provider-model-catalog";
import { setPersonaModel, resetPersonaModels } from "../api/updateOverrides";
import { personaModelCatalogAction } from "../api/personaModelCatalogAction";

interface Props {
  initialOverrides: Partial<Record<PersonaOrConsensus, PersonaModelOverride>>;
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

const selectCls =
  "w-full rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50";

export function PersonaModelPicker({ initialOverrides }: Props) {
  const [overrides, setOverrides] =
    useState<Partial<Record<PersonaOrConsensus, PersonaModelOverride>>>(
      initialOverrides,
    );
  const [catalogData, setCatalogData] =
    useState<PersonaModelCatalogData | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    personaModelCatalogAction()
      .then((data) => {
        if (alive && data) setCatalogData(data);
      })
      .catch(() => {
        // 카탈로그 로드 실패 — 저장된 값만으로 동작 (선택지 갱신만 불가).
      });
    return () => {
      alive = false;
    };
  }, []);

  const currentProvider = (p: PersonaOrConsensus): ModelName =>
    overrides[p]?.model ?? DEFAULT_PERSONA_MODELS[p];

  // 표시용 유효 모델 ID. 저장값 없으면 서버 기본값(defaults), 카탈로그 미로드면 "" (자동).
  const effectiveModelId = (p: PersonaOrConsensus): string =>
    overrides[p]?.modelId ?? catalogData?.defaults[currentProvider(p)] ?? "";

  const save = (persona: PersonaOrConsensus, next: PersonaModelOverride) => {
    const prev = overrides[persona];
    setOverrides((cur) => ({ ...cur, [persona]: next }));
    setError(null);
    startTransition(async () => {
      const res = await setPersonaModel({ persona, ...next });
      if (!res.success) {
        setError(res.error ?? "저장 실패");
        setOverrides((cur) => {
          const rolled = { ...cur };
          if (prev === undefined) delete rolled[persona];
          else rolled[persona] = prev;
          return rolled;
        });
      }
    });
  };

  const onChangeProvider = (persona: PersonaOrConsensus, model: ModelName) => {
    if (model === currentProvider(persona)) return;
    // 공급사 전환 시 그 공급사의 서버 기본값(목록에 있으면) 또는 첫 모델로.
    // 카탈로그 미로드면 modelId 생략 — 서버가 tier 최신을 자동 해석.
    let modelId: string | undefined;
    if (catalogData) {
      const catalog = catalogData.snapshot.catalog;
      const fallback = catalogData.defaults[model];
      modelId = catalog[model].includes(fallback)
        ? fallback
        : catalog[model][0];
    }
    save(persona, modelId ? { model, modelId } : { model });
  };

  const onChangeModelId = (persona: PersonaOrConsensus, modelId: string) => {
    if (modelId === effectiveModelId(persona)) return;
    save(persona, { model: currentProvider(persona), modelId });
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

  const renderModelIdSelect = (p: PersonaOrConsensus) => {
    const provider = currentProvider(p);
    const value = effectiveModelId(p);

    if (catalogData === null) {
      return (
        <select
          aria-label={`${PERSONA_LABEL[p]} 상세 모델`}
          value={value}
          disabled
          className={`${selectCls} font-mono`}
        >
          <option value={value}>
            {value === "" ? "기본 모델 (자동)" : value}
          </option>
        </select>
      );
    }

    const options = deriveModelOptions({
      snapshot: catalogData.snapshot,
      selection: { provider, modelId: value },
      recommendationRules: STOCK_MODEL_RECOMMENDATION_RULES,
    });
    const recommendations = options.recommended;
    const otherModelIds = options.other;
    const unavailable = value !== "" && options.availability === "unavailable";

    return (
      <select
        aria-label={`${PERSONA_LABEL[p]} 상세 모델`}
        value={value}
        onChange={(e) => onChangeModelId(p, e.target.value)}
        disabled={pending}
        className={`${selectCls} font-mono`}
      >
        {unavailable && (
          <option value={value} disabled>
            {value} (현재 사용 불가)
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
            {otherModelIds.length > 0 && (
              <optgroup label="기타 모델">
                {otherModelIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </optgroup>
            )}
          </>
        ) : (
          catalogData.snapshot.catalog[provider].map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))
        )}
      </select>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-text-muted)]">
        페르소나마다 분석에 사용할 AI 공급사와 상세 모델을 선택하세요. 기본값:
        Claude×3 (월스트/한국/합의), Codex×2 (가치/기술), Gemini×1 (성장).
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-3 py-2">페르소나</th>
            <th className="px-3 py-2">AI 공급사</th>
            <th className="px-3 py-2">상세 모델</th>
          </tr>
        </thead>
        <tbody>
          {PERSONA_ORDER.map((p) => (
            <tr key={p} className="border-b border-[var(--color-hairline)]">
              <td className="whitespace-nowrap px-3 py-3 font-semibold">
                {PERSONA_LABEL[p]}
              </td>
              <td className="w-[180px] px-3 py-3">
                <select
                  aria-label={`${PERSONA_LABEL[p]} AI 공급사`}
                  value={currentProvider(p)}
                  onChange={(e) =>
                    onChangeProvider(p, e.target.value as ModelName)
                  }
                  disabled={pending}
                  className={selectCls}
                >
                  {(Object.keys(LLM_PROVIDER_META) as ModelName[]).map((k) => (
                    <option key={k} value={k}>
                      {LLM_PROVIDER_META[k].label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-3">{renderModelIdSelect(p)}</td>
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
