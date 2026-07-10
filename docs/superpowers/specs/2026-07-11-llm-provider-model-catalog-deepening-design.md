# LLM 공급사·모델 카탈로그 심화 설계

**작성일:** 2026-07-11

**상태:** 검토 요청

**범위:** 메모 AI 정리, 이메일 답장, 사주 리딩의 공급사·모델 카탈로그 공통 코어

## 1. 배경

메모 AI 정리, 이메일 답장, 사주 리딩은 모두 Claude/Codex/Gemini 공급사와 프록시의 실제 모델 ID를 한 쌍으로 선택한다. 세 도메인은 같은 프록시의 `/v1/models`를 사용하지만 다음 구현이 평행하게 존재한다.

- 공급사 키와 표시 메타
- 모델 ID 형식 및 공급사 일치 검증
- 프록시 모델 목록 조회와 timeout
- 공급사별 모델 분류·중복 제거·정렬
- 추천/기타 모델 분할
- 선택 모델의 사용 가능 여부 판정

반면 기본 모델 해석, 모델 제외 규칙, 선택 상태 저장 방식은 도메인마다 실제로 다르다.

- 메모: 환경 설정 기반 기본 모델, DB 저장, 프리셋 상속
- 답장: Gemini/Codex/최신 Opus 기본값, Haiku 제외, 설정 폼 지연 로딩
- 사주: 최신 Opus 기본값, URL 상태, 선택 모델을 모든 리딩 요청과 캐시 키에 전달

공통 구현과 도메인 정책이 섞여 있어 모델 목록 동작을 변경할 때 여러 모듈을 함께 수정해야 한다. 목표는 공통 동작을 작은 인터페이스 뒤에 숨기고 도메인 변이는 adapter에 유지하는 것이다.

## 2. 목표

1. 공급사·모델 카탈로그 공통 동작의 locality를 `shared/lib/llm`에 집중한다.
2. 메모·답장·사주의 세 adapter가 같은 인터페이스에서 leverage를 얻도록 한다.
3. 프록시 장애와 실제 모델 부재를 구분한다.
4. 기존 DB, 환경 변수, URL, 화면, 사용자 저장값을 보존한다.
5. 새 모듈의 인터페이스를 테스트 표면으로 삼는다.

## 3. 비목표

- 공통 모델 선택 UI를 만들지 않는다.
- 도메인별 기본 모델 해석을 통합하지 않는다.
- 프리셋 상속, 이메일 설정 저장, 사주 URL 상태를 공통 모듈로 옮기지 않는다.
- DB 스키마나 환경 변수 이름을 변경하지 않는다.
- 추천 규칙과 사용자 문구를 도메인 중립 정책으로 만들지 않는다.

## 4. 검토한 접근법

### 4.1 작은 헬퍼 모음

정규화, 분류, 추천 분할, 원격 조회를 각각 export하는 방식이다. 구현은 단순하지만 호출자가 순서·폴백·가용성 규칙을 계속 알아야 한다. 삭제하면 복잡도가 여러 호출자에 그대로 재출현하므로 현재의 shallow 구조를 충분히 개선하지 못한다.

### 4.2 도메인별 factory

큰 정책 객체로 메모·답장·사주 전용 인스턴스를 생성하는 방식이다. 확장성은 높지만 기본 모델, 제외 규칙, 추천 규칙, 저장 방식까지 설정 표면이 넓어질 수 있다. 세 도메인 규모에는 과한 추상화이며 인터페이스가 구현만큼 복잡해질 위험이 있다.

### 4.3 카탈로그 로딩 + 선택 파생의 2-entry 구조

원격 조회와 순수 선택 계산을 분리한다. 각 인터페이스는 내부 실행 순서를 숨기고 도메인 adapter는 실제 변이만 제공한다. 작은 인터페이스로 가장 높은 depth를 얻으므로 이 방식을 채택한다.

## 5. 모듈 구조

### 5.1 Client-safe 공통 모듈

`apps/dashboard/src/shared/lib/llm/provider-model-catalog.ts`

다음을 소유한다.

- `LlmProviderKey`
- `ProviderModelSelection`
- `ProviderModelCatalog`
- `ProviderModelCatalogSnapshot`
- 모델 ID 정규화와 공급사 일치 검증
- 공급사별 추천/기타 분할
- 선택 모델 가용성 파생

주요 타입은 다음과 같다.

```ts
export const LLM_PROVIDER_KEYS = ["claude", "codex", "gemini"] as const;
export type LlmProviderKey = (typeof LLM_PROVIDER_KEYS)[number];

export interface ProviderModelSelection {
  provider: LlmProviderKey;
  modelId: string;
}

export type ProviderModelCatalog = Record<LlmProviderKey, string[]>;

export interface ProviderModelCatalogSnapshot {
  catalog: ProviderModelCatalog;
  source: "live" | "fallback";
}

export type ModelAvailability = "available" | "unavailable" | "unknown";

export interface LlmRecommendationRule {
  matches: (lowerId: string) => boolean;
  reason: string;
}

export interface ModelOptions {
  recommended: Array<{ modelId: string; reason: string }>;
  other: string[];
  availability: ModelAvailability;
}
```

선택 파생 인터페이스는 다음 형태다.

```ts
deriveModelOptions({
  snapshot,
  selection,
  recommendationRules,
}): ModelOptions;
```

`recommendationRules`는 공급사별 `LlmRecommendationRule[]`이며 규칙 순서가 추천 우선순위다. 같은 모델이 여러 규칙에 일치하면 먼저 일치한 규칙만 적용한다.

### 5.2 Server-only 카탈로그 로더

`apps/dashboard/src/shared/lib/llm/provider-model-catalog-server.ts`

다음을 소유한다.

- 프록시 `/v1/models` 조회
- 3초 timeout
- 응답 파싱
- 공급사별 분류
- 중복 제거와 정렬
- 기본 모델 포함 정책
- 도메인 allow 규칙
- 운영 장애 시 fallback snapshot

정책과 주요 인터페이스는 다음 형태다.

```ts
export interface ProviderModelCatalogPolicy {
  defaults: Record<LlmProviderKey, string>;
  defaultMode: "always" | "source-failure-only";
  allow?: Partial<Record<LlmProviderKey, (modelId: string) => boolean>>;
}

loadProviderModelCatalog(
  policy: ProviderModelCatalogPolicy,
): Promise<ProviderModelCatalogSnapshot>;
```

### 5.3 내부 source seam

프록시는 직접 운영하는 원격 의존성이다. 카탈로그 로더 구현 안에 모델 ID 목록을 제공하는 seam을 둔다.

- 운영 adapter: HTTP 요청
- 테스트 adapter: in-memory 모델 ID 또는 오류

이 seam은 도메인 호출자의 인터페이스에 노출하지 않는다. 프로덕션 호출자는 `loadProviderModelCatalog(policy)`만 사용한다.

## 6. 정책 불변식

1. 모든 공급사에는 비어 있지 않은 기본 모델 ID가 있어야 한다.
2. 기본 모델 ID는 문법과 공급사 일치 검증을 통과해야 한다.
3. `always`는 live/fallback 모두 기본 모델을 카탈로그에 포함한다.
4. `source-failure-only`는 live 응답에 실제로 존재하는 모델만 노출하고, 원격 조회 실패 때 기본 모델로 폴백한다.
5. `allow` 규칙은 원격 모델과 기본 모델 모두에 적용된다. `always` 정책의 기본 모델이 제외되면 정책 구성 오류다.
6. `live` snapshot에서 선택 모델이 목록에 있으면 `available`, 없으면 `unavailable`이다.
7. `fallback` snapshot에서는 원격 상태를 확인할 수 없으므로 항상 `unknown`이다.
8. `unknown`은 호출을 차단하지 않는다.

## 7. 도메인 adapter 책임

공통 `LlmProviderKey`의 선언 순서는 화면 표시 순서를 뜻하지 않는다. 메모·답장·사주 adapter는 기존 UI 순서를 계속 소유하고, 공통 카탈로그 결과를 그 순서에 맞춰 투영한다. 또한 `ProviderModelSelection.provider`는 공통 계층 내부 표현일 뿐이다. 기존 DB의 `model` 컬럼과 URL의 `model` 파라미터, 도메인별 `modelId` 필드는 변경하지 않고 adapter 경계에서 명시적으로 변환한다.

### 7.1 메모

- 환경 설정에서 기본 모델을 해석한다.
- `defaultMode: "source-failure-only"`를 사용한다.
- 프리셋 상속과 DB 저장을 유지한다.
- 미리보기에서 `unknown`이면 모델 호출을 시도한다.
- `MemoModelKey`는 필요하면 `LlmProviderKey`의 별칭으로 축소하되 메모 표시 메타와 추천 규칙은 유지한다.

### 7.2 이메일 답장

- Gemini/Codex/최신 Opus 기본값을 해석한다.
- `defaultMode: "always"`를 사용한다.
- Claude Haiku를 제외하는 `allow` 규칙을 제공한다.
- 카탈로그 지연 로딩과 이메일 설정 저장을 유지한다.
- 스레드 답장 생성에는 선택된 모델 ID만 전달한다.

### 7.3 사주

- 최신 Opus 및 Codex/Gemini 기본값을 해석한다.
- `defaultMode: "always"`를 사용한다.
- URL의 공급사·모델 ID를 공통 검증 모듈로 정규화한다.
- URL 상태와 사주 추천 규칙을 유지한다.
- 선택 모델 ID를 모든 리딩 요청과 캐시 키에 명시 전달한다.

## 8. 데이터 흐름

```text
도메인 adapter가 기본 모델·필터 정책 결정
  → loadProviderModelCatalog(policy)
  → HTTP adapter가 프록시 모델 목록 조회
  → 공통 모듈이 분류·필터·정렬·폴백 적용
  → ProviderModelCatalogSnapshot 반환
  → deriveModelOptions()가 추천/기타/가용성 파생
  → 도메인 UI가 표현하고 도메인 저장 방식으로 반영
```

공통 모듈은 DB, URL, 프리셋 상속을 모른다. 도메인 adapter는 HTTP 응답 파싱, 공급사 분류, 정렬 구현을 모른다.

## 9. 오류 계약

### 9.1 운영 중 원격 장애

다음 상황은 throw하지 않고 `source: "fallback"`으로 반환한다.

- timeout
- 연결 실패
- HTTP 비정상 응답
- JSON 파싱 실패
- 유효한 모델 ID가 하나도 없는 응답

구조화 로그에는 상태와 오류 종류만 남긴다. URL, 인증 헤더, 원문 응답은 기록하지 않는다.

### 9.2 잘못된 정책 구성

다음은 개발 단계 오류이므로 fallback으로 숨기지 않고 throw한다.

- 기본 모델 누락
- 빈 값 또는 잘못된 모델 ID 문법
- 공급사와 기본 모델 불일치
- 지원하지 않는 `defaultMode`
- `allow` 규칙의 예외
- `always` 기본 모델을 `allow`가 제외함

기본 모델과 `defaultMode`, 기본 모델에 대한 `allow` 검증은 source 호출 전에 끝낸다. 원격 모델에 `allow`를 적용하는 중 발생한 예외는 source 응답 이후라도 정책 오류로 전파하며 원격 장애 fallback으로 바꾸지 않는다.

### 9.3 사용자 입력 오류

URL·폼·DB에서 읽은 값은 throw하지 않는다.

- 잘못된 공급사: 도메인 기본 공급사
- 잘못된 모델 ID 문법: 해당 공급사의 기본 모델
- 다른 공급사 모델 ID: 해당 공급사의 기본 모델
- live 목록에서 사라진 모델: `unavailable`
- 원격 장애로 확인할 수 없는 모델: `unknown`

새 사용자 오류 문구나 Server Action 결과 유니온은 추가하지 않는다.

## 10. 테스트 전략

새 모듈의 인터페이스를 테스트 표면으로 삼는다.

### 10.1 `loadProviderModelCatalog`

- live 모델 분류·중복 제거·정렬
- `always`와 `source-failure-only` 차이
- 도메인 `allow` 규칙
- timeout·비정상 응답·깨진 JSON·빈 목록의 fallback
- 정적 정책 오류가 source 호출 전에 실패함
- 원격 모델에 대한 `allow` 예외가 fallback으로 숨겨지지 않음
- 비밀값과 원문 응답이 오류 결과에 포함되지 않음

### 10.2 `deriveModelOptions`

- 추천 규칙 순서 보존
- 중복 추천 방지
- 나머지 모델의 `other` 배치
- live 목록에서 사라진 선택의 `unavailable`
- fallback snapshot의 `unknown`

### 10.3 도메인 회귀 테스트

- 메모: 프리셋 상속, DB 기본 모델, 조회 실패 시 호출 시도
- 답장: Haiku 제외, 인증 없는 지연 로딩, 기본 모델 보존
- 사주: 잘못된 URL 값 폴백, 선택 모델이 네 종류 리딩 요청에 전달됨
- UI: 기존 라벨, 추천 그룹, 사용 불가 표현 유지

공통 알고리즘을 중복 검증하던 옛 테스트는 새 인터페이스 테스트로 대체한다. 도메인 추천 규칙과 저장 정책 테스트는 유지한다.

## 11. 단계적 마이그레이션

1. 공통 타입·검증·선택 파생 모듈을 추가한다.
2. HTTP/in-memory adapter를 가진 카탈로그 로더를 추가한다.
3. 메모 adapter를 이동하고 기존 동작을 비교한다.
4. 답장 adapter를 이동한다.
5. 사주 adapter를 이동한다.
6. 중복된 메모 공급사 타입·카탈로그 조회·추천 구현을 삭제한다.
7. dead export와 오래된 주석을 정리한다.
8. `pnpm typecheck`, `pnpm lint`, 관련 테스트, 전체 테스트, `pnpm build` 순서로 검증한다.

각 도메인 이동을 독립 커밋으로 구성해 회귀 시 해당 이동만 되돌릴 수 있게 한다.

## 12. 수락 기준

- 메모·답장·사주가 공통 공급사 타입과 카탈로그 로더를 사용한다.
- 프록시 조회·분류·정렬 구현은 한 모듈에만 존재한다.
- 추천/기타/가용성 파생 구현은 한 모듈에만 존재한다.
- 메모의 `live`/`fallback` 의미가 보존된다.
- 답장 Haiku 제외와 사주 최신 Opus 정책이 보존된다.
- DB, 환경 변수, URL, 화면과 기존 저장값에 호환성 변화가 없다.
- 관련 테스트, 전체 테스트, typecheck, lint, production build가 통과한다.

## 13. 위험과 완화

### FSD server/client 누수

Client-safe 타입과 순수 계산은 `provider-model-catalog.ts`, 환경 설정·HTTP 접근은 `provider-model-catalog-server.ts`에 둔다. client 모듈은 server-only 진입점을 import하지 않는다. production build로 검증한다.

### 도메인 정책의 과도한 중앙화

기본 모델 해석, 추천 규칙, Haiku 제외, 상속, 저장, URL 갱신은 adapter에 유지한다. 공통 모듈에 도메인 이름이나 조건 분기를 넣지 않는다.

### 폴백 동작 회귀

`source`를 snapshot에 명시하고 `defaultMode`별 특성 테스트를 먼저 작성한다. 메모 이동을 첫 adapter로 삼아 현재의 `boolean | null` 의미를 `ModelAvailability`로 보존한다.
