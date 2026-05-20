// 사주 narrative 카드 제목줄 우측에 표시되는 "생성 모델" 배지 (v0.3.2).
//
// modelId 는 DB 캐시 row 의 model_id 컬럼 값 (예: "claude-opus-4-7", "gpt-5-codex").
// getModelDisplayLabel 로 vendor 라벨 추론 + tooltip 에 원문 ID 노출.
import { getModelDisplayLabel } from "@/shared/lib/llm/saju-model-registry-meta";

interface Props {
  modelId: string;
}

export function ModelBadge({ modelId }: Props) {
  const label = getModelDisplayLabel(modelId);
  return (
    <span
      title={`생성 모델: ${modelId}`}
      className="inline-flex items-center rounded border border-[var(--color-hairline)] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-text-muted)]"
    >
      {label}
    </span>
  );
}
