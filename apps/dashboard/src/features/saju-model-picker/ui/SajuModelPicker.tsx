"use client";

// 사주 narrative 분석 모델 선택 (v0.3.3) — AI 공급사 + 상세 모델 페어.
// memo ModelSelectionFields 패턴 미러: 공급사 셀렉트 + 추천/기타 optgroup 상세 셀렉트.
//
// URL search param ?model=<key>&modelId=<id> 갱신으로 페이지 전역 모델 선택을 표현.
// router.replace 사용 — 브라우저 히스토리 무한 추가 방지 + scroll 보존.
//
// 같은 선택을 쿠키에도 기록한다 — param 없는 /fortune/<id> 링크로 재진입해도
// 선택이 유지되도록 (해석 우선순위는 lib/sajuModelCookie.ts 참조).
//
// FSD: features/saju-model-picker — 학파 탭과 위계적·시각적으로 분리.
//   학파 탭 (카드 내부): primary navigation (분석 관점)
//   모델 선택 (페이지 헤더): secondary preference (분석 엔진)
import { useRouter, useSearchParams } from "next/navigation";
import {
  SAJU_MODEL_KEYS,
  SAJU_MODEL_RECOMMENDATION_RULES,
  type SajuModelKey,
} from "@/shared/lib/llm/saju-model-registry-meta";
import {
  LLM_PROVIDER_META,
  deriveModelOptions,
  type ProviderModelCatalogSnapshot,
} from "@/shared/lib/llm/provider-model-catalog";
import { writeSajuModelCookie } from "../lib/sajuModelCookie";

interface Props {
  selected: SajuModelKey;
  /** 현재 유효 모델 ID (URL modelId 또는 registry 기본값) — 페이지(RSC)가 해석해 전달. */
  selectedModelId: string;
  snapshot: ProviderModelCatalogSnapshot;
}

const selectCls =
  "rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]";

export function SajuModelPicker({ selected, selectedModelId, snapshot }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const options = deriveModelOptions({
    snapshot,
    selection: { provider: selected, modelId: selectedModelId },
    recommendationRules: SAJU_MODEL_RECOMMENDATION_RULES,
  });
  const catalog = snapshot.catalog;
  const recommendations = options.recommended;
  const otherModelIds = options.other;
  // 선택값이 옵션 목록에 없으면 브라우저가 첫 옵션을 대신 표시해 UI 와 실제 호출
  // 모델이 갈린다 (프록시 조회 실패로 카탈로그가 기본 모델 1개로 줄 때 재현).
  const listedModelIds =
    recommendations.length > 0
      ? [...recommendations.map((rec) => rec.modelId), ...otherModelIds]
      : catalog[selected];
  const selectedMissing = !listedModelIds.includes(selectedModelId);

  const replaceParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    mutate(params);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const handleProvider = (key: SajuModelKey) => {
    if (key === selected) return;
    writeSajuModelCookie({ modelKey: key, modelId: null });
    replaceParams((params) => {
      params.set("model", key);
      params.delete("modelId"); // 공급사 전환 → registry 기본 모델로 리셋
    });
  };

  const handleModelId = (id: string) => {
    if (id === selectedModelId) return;
    writeSajuModelCookie({ modelKey: selected, modelId: id });
    replaceParams((params) => {
      params.set("model", selected);
      params.set("modelId", id);
    });
  };

  return (
    <div
      aria-label="분석 모델 선택"
      className="flex flex-wrap items-end justify-end gap-2"
    >
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-muted)]">
          AI 공급사
        </span>
        <select
          aria-label="AI 공급사"
          value={selected}
          onChange={(e) => handleProvider(e.target.value as SajuModelKey)}
          className={selectCls}
        >
          {SAJU_MODEL_KEYS.map((key) => (
            <option key={key} value={key}>
              {LLM_PROVIDER_META[key].label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-[var(--color-text-muted)]">
          상세 모델
        </span>
        <select
          aria-label="상세 모델"
          value={selectedModelId}
          onChange={(e) => handleModelId(e.target.value)}
          className={`${selectCls} max-w-[260px] font-mono`}
        >
          {selectedMissing && (
            <option value={selectedModelId} disabled>
              {selectedModelId}{" "}
              {options.availability === "unavailable"
                ? "(현재 사용 불가)"
                : "(목록 확인 불가)"}
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
            catalog[selected].map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))
          )}
        </select>
      </label>
    </div>
  );
}
