// catalog-refresh feature 의 공용 타입.
// dev 전용 카탈로그 재생성 버튼이 소비하는 kind·결과 형태.

/** 재생성 대상 카탈로그 종류. 각 페이지 라우트 세그먼트와 일치. */
export type CatalogKind = "skills" | "plugins" | "agents";

/**
 * 재생성 결과 — 성공/실패 discriminated union.
 * - 성공(ok:true): count(파싱 실패 시 undefined) + warning(항상 존재, 덮어쓰기 안내).
 * - 실패(ok:false): error 만.
 */
export type RefreshResult =
  | { ok: true; count?: number; warning: string }
  | { ok: false; error: string };
