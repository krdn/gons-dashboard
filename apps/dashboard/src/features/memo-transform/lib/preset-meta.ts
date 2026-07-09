// features/memo-transform — client-safe 프리셋 메타.
// 프롬프트 instruction은 server-only ./prompts.ts (client 번들 격리).
// 라벨은 entities/memo의 TRANSFORM_PRESET_LABELS (MemoCard 칩이 써야 해서 entity에 위치).
import { TRANSFORM_PRESET_IDS, type TransformPresetId } from "@/entities/memo/client";

export interface TransformPresetMeta {
  id: TransformPresetId;
  /** cleaned_content(trim) 길이가 이 값 미만이면 프리셋 비활성. 서버도 재검증. */
  minInputLen: number;
  /** true(tidy)만 60% 축약 감지 적용 — 요약 계열은 축약이 정상. */
  strictPreserve: boolean;
}

export const TRANSFORM_PRESETS: Record<TransformPresetId, TransformPresetMeta> = {
  tidy: { id: "tidy", minInputLen: 1, strictPreserve: true },
  polish: { id: "polish", minInputLen: 20, strictPreserve: false },
  summary: { id: "summary", minInputLen: 80, strictPreserve: false },
  structured: { id: "structured", minInputLen: 80, strictPreserve: false },
  todos: { id: "todos", minInputLen: 20, strictPreserve: false },
  journal: { id: "journal", minInputLen: 20, strictPreserve: false },
  email: { id: "email", minInputLen: 20, strictPreserve: false },
};

export function isTransformPresetId(v: string): v is TransformPresetId {
  return (TRANSFORM_PRESET_IDS as readonly string[]).includes(v);
}
