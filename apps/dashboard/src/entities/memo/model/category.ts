// 메모 자동 분류 카테고리 — 주제(topic)가 아니라 글의 종류(content-type) 기준.
// 고정 enum이 아니라 DB memo_categories 행이 진실의 원천 (스펙 2026-07-13-memo-dynamic-categories).
// 아래 시드/타입은 DB 시드 소스 + DB 조회 실패 시 fallback 용도.

// 카테고리는 이제 임의 slug 문자열 — DB memo_categories(id)가 유효 집합.
export type MemoCategory = string;

// slug 형식 — DB CHECK(memo_categories_slug_format)와 동치.
// kebab-case 영문, 첫 글자는 영문자, 1~40자.
export const CATEGORY_SLUG_RE = /^[a-z][a-z0-9-]{0,39}$/;

export function isValidCategorySlug(value: unknown): value is string {
  return typeof value === "string" && CATEGORY_SLUG_RE.test(value);
}

// 최초 시드 6종 — 마이그레이션 0042의 INSERT와 동기 유지.
export const SEED_MEMO_CATEGORIES: readonly { id: string; labelKo: string }[] = [
  { id: "idea", labelKo: "아이디어" },
  { id: "todo", labelKo: "할 일" },
  { id: "journal", labelKo: "일기" },
  { id: "reference", labelKo: "참고" },
  { id: "draft", labelKo: "초안" },
  { id: "etc", labelKo: "기타" },
];

// slug→라벨 fallback 맵. DB 조회 실패 시 최소 6종 라벨 보장.
export const SEED_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  SEED_MEMO_CATEGORIES.map((c) => [c.id, c.labelKo]),
);
