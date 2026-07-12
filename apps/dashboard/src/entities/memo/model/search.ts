// 메모 검색 쿼리 파싱 — 순수 함수 (server repo와 client 하이라이트가 공유).

export const SEARCH_QUERY_MAX_LEN = 100;
export const SEARCH_MAX_TOKENS = 8;
// 검색 결과 상한 — 도달 시 UI가 "최근 N개만 표시"를 명시한다 (침묵 절단 금지).
// repo(server)와 카운트 라인(client)이 공유하므로 순수 모듈에 둔다.
export const SEARCH_MEMOS_LIMIT = 50;

/**
 * 공백 분리 AND 토큰. 중복 제거, 최대 SEARCH_MAX_TOKENS개.
 * 100자 초과분은 잘라 폭주 쿼리를 막는다.
 */
export function tokenizeSearchQuery(query: string): string[] {
  const tokens = query
    .slice(0, SEARCH_QUERY_MAX_LEN)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...new Set(tokens)].slice(0, SEARCH_MAX_TOKENS);
}

/** PG LIKE/ILIKE 메타문자 이스케이프 (기본 ESCAPE '\'). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
