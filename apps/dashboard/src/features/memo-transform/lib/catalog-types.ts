// features/memo-transform — client-safe 카탈로그 타입. "server-only" 금지 (client 위젯에서 import).
export interface PresetCatalogEntry {
  slug: string;
  label: string;
  instruction: string;
  /** 빌트인이면 코드 기본 지시(복구 비교·"기본 프롬프트 보기"용), 커스텀은 null */
  defaultInstruction: string | null;
  fidelityGuard: boolean;
  minInputLen: number;
  isBuiltin: boolean;
  isOverridden: boolean;
}

/** TransformDialog용 슬림 옵션 — 프롬프트 비노출 */
export interface TransformPresetOption {
  slug: string;
  label: string;
  minInputLen: number;
}
