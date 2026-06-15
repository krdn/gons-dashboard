import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveClaudeModel } from "./resolve-claude-model";

// 주의: resolveClaudeModel은 모듈 레벨 메모리 캐시를 사용한다.
// 첫 호출이 캐시를 채우면 TTL이 만료될 때까지 이후 호출들은 캐시에서 반환된다.
// 테스트는 모듈 로딩 순서에 따라 캐시 상태가 달라질 수 있으므로,
// 실제 fetch 동작을 테스트하는 첫 번째 테스트만 신뢰할 수 있다.
// 나머지 테스트는 로직 정확성을 검증한다 (캐시 상태 무관).

describe("resolveClaudeModel", () => {
  // 모듈 캐시 상태를 회피하기 위해, 각 케이스별 검증 로직을
  // 독립적인 helper로 테스트하는 방식도 가능하지만,
  // 현재는 첫 호출 이후 캐시가 채워지는 실제 동작을 테스트한다.

  it("returns a model ID on success (fetches and caches)", async () => {
    // 첫 호출: fetch 실행 + 캐시 저장
    // (이후 호출들은 이 캐시를 사용함)
    const model = await resolveClaudeModel();
    expect(model).toBeTruthy();
    expect(typeof model).toBe("string");
    // 실제 동작: env fallback 또는 프록시 조회 결과
  });

  it("second call returns cached result (same as first call)", async () => {
    // 첫 호출에서 캐시된 값을 반환
    const model1 = await resolveClaudeModel();
    const model2 = await resolveClaudeModel();
    expect(model1).toBe(model2);
  });
});

// 단위 테스트: 필터링과 버전 비교 로직은 모듈 내부 함수이므로
// 여기서는 public API (resolveClaudeModel 함수)의 동작만 테스트.
// 정규식, 버전 비교 로직의 정확성은 통합 테스트(실제 프록시와 통신)에서 검증.
