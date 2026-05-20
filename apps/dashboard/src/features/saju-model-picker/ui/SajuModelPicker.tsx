"use client";

// 사주 narrative 분석 모델 선택 탭 (v0.3.2).
//
// URL search param ?model=<key> 갱신으로 페이지 전역 모델 선택을 표현.
// router.replace 사용 — 브라우저 히스토리 무한 추가 방지 + scroll 보존.
//
// FSD: features/saju-model-picker — 학파 탭과 위계적·시각적으로 분리.
//   학파 탭 (카드 내부): primary navigation (분석 관점)
//   모델 탭 (페이지 헤더): secondary preference (분석 엔진)
import { useRouter, useSearchParams } from "next/navigation";
import {
  SAJU_MODEL_KEYS,
  SAJU_MODEL_META,
  type SajuModelKey,
} from "@/shared/lib/llm/saju-model-registry-meta";

interface Props {
  selected: SajuModelKey;
}

export function SajuModelPicker({ selected }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSelect = (key: SajuModelKey) => {
    if (key === selected) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("model", key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div
      role="tablist"
      aria-label="분석 모델 선택"
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 text-xs"
    >
      {SAJU_MODEL_KEYS.map((key) => {
        const meta = SAJU_MODEL_META[key];
        const isActive = key === selected;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={meta.description}
            onClick={() => handleSelect(key)}
            className={
              isActive
                ? "rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-medium text-white"
                : "rounded-md px-3 py-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            }
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
