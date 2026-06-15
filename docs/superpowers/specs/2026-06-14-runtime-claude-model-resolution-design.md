# 런타임 Claude 모델 자동 선택 (resolveClaudeModel)

- **날짜**: 2026-06-14
- **상태**: 설계 승인 (구현 대기)
- **관련 도메인**: Saju narrative, Saju reading, Stock analysis (LLM 호출 전반)

## 배경 / 문제

대시보드의 Claude 모델 ID 는 `env.SAJU_LLM_MODEL_CLAUDE` / `env.SAJU_LLM_MODEL` 의 정적 default
(`claude-opus-4-7`) 에 박혀 있었다. 사용자는 "최신 Opus 를 자동으로 따라가게" 하기를 원했다.

조사 결과 (2026-06-14):

- LLM 프록시 `cli-proxy-api` (`192.168.0.5:8317`) 의 `claude-opus-latest` alias 는 **자동 추종이
  아니라 `config.yaml` 의 `oauth-model-alias` 에 운영자가 손으로 박은 정적 핀**이며, 현재
  `claude-opus-4-7` 을 가리킨다 (실측: 서빙 `model` 필드 = `claude-opus-4-7`, `created` 일치).
  5/13 설정 이후 stale — 최신 dated 릴리스 `claude-opus-4-8` (created 1779984000) 보다 뒤처짐.
- 따라서 `claude-opus-latest` 를 그대로 쓰면 사용자가 원한 4.8 을 받지 못한다.
- 프록시 config 수정(B 안) 또는 코드 핀(A 안) 둘 다 다음 버전이 나오면 수동 수정이 필요하다.
- **유일한 진짜 자동화는 대시보드가 런타임에 `/v1/models` 를 조회해 최신 안정 opus 를 고르는 것** (C 안, 채택).

## 목표

`env.SAJU_LLM_MODEL_CLAUDE` 의 정적 값을 "런타임에 프록시에서 고른 최신 **안정** opus" 로 대체한다.
조회 실패 시 env 고정값으로 안전 폴백한다. codex/gemini 모델은 변경하지 않는다 (정적 env 유지).

## 비목표 (YAGNI)

- codex/gemini 자동 선택 — opus(claude)만 대상.
- Redis/공유 캐시 — 대시보드는 단일 인스턴스. 프로세스 메모리 캐시로 충분.
- preview/dated 모델 채택 — 명시적으로 제외 (검증 안 된 모델 회피).
- 프록시 `config.yaml` 수정 — 대시보드 레포 밖, 외부 영향. 이번 범위 아님.

## 핵심 결정 (사용자 확정)

| 항목 | 결정 |
|---|---|
| 선택 기준 | 안정 `claude-opus-<major>-<minor>` 패턴만 필터 → 버전 최대값. dated(`-YYYYMMDD`)·preview·alias 제외 |
| 캐싱 | 프로세스 메모리 + TTL (6시간) |
| Fallback | 조회 실패·타임아웃·0건 매칭 시 `env.SAJU_LLM_MODEL_CLAUDE` 반환 (캐시 안 함 → 다음 호출 재시도) |
| registry | 정적 객체 → async 함수형 전환 승인 |
| 소비 지점 | claude 모델 사용 4경로 await 화 |

## 아키텍처

### 신규 모듈: `shared/lib/llm/resolve-claude-model.ts` (server-only)

```ts
export async function resolveClaudeModel(): Promise<string>
```

동작:

1. 메모리 캐시 `{ model: string; expiresAt: number }` 확인 → `now < expiresAt` 이면 즉시 반환.
2. 만료/미초기화 시 `GET ${ANTHROPIC_BASE_URL}/v1/models` (타임아웃 3초, `AbortController`).
   - 인증 헤더: `x-api-key: ${ANTHROPIC_API_KEY}` (프록시가 수용 — 실측 확인).
   - `fetch` 옵션 `cache: "no-store"` (yahoo-finance2 류 Next fetch 캐시 회피).
3. 응답 `data[].id` 중 정규식 `^claude-opus-(\d+)-(\d+)$` 매칭만 추림
   (dated `claude-opus-4-5-20251101`, alias `claude-opus-latest`, `claude-opus-4-20250514` 제외).
4. 매칭 결과를 `(major, minor)` 숫자 튜플 비교로 최대값 선택 → 그 `id` 채택.
5. 성공: 캐시에 `{ model, expiresAt: now + TTL }` 저장 후 반환.
6. 실패(네트워크/타임아웃/JSON 파싱/0건 매칭): `env.SAJU_LLM_MODEL_CLAUDE` 반환. **캐시하지 않음**
   (다음 호출에서 재시도). 실패는 `console.warn` 으로 로깅.

주의 — `now` 는 `Date.now()` 사용. 이 모듈은 server-only 런타임 코드라 React purity 제약
([[react-19-purity-set-state-in-effect]]) 대상 아님.

### registry 함수형 전환: `shared/lib/llm/saju-model-registry.ts`

```ts
// before: export const SAJU_MODEL_REGISTRY: Record<SajuModelKey, SajuModelInfo> = { ... }
export async function getSajuModelRegistry(): Promise<Record<SajuModelKey, SajuModelInfo>> {
  return {
    claude: { ...SAJU_MODEL_META.claude, id: await resolveClaudeModel() },
    codex:  { ...SAJU_MODEL_META.codex,  id: env.SAJU_LLM_MODEL_CODEX },
    gemini: { ...SAJU_MODEL_META.gemini, id: env.SAJU_LLM_MODEL_GEMINI },
  };
}
```

### 소비 지점 await 화 (4경로)

| 위치 | 현재 | 변경 |
|---|---|---|
| `shared/lib/saju/createNarrativeHandler.ts:90` | `SAJU_MODEL_REGISTRY[modelKey].id` | `(await getSajuModelRegistry())[modelKey].id` |
| `entities/stock-analysis/api/persona-router.ts:24` | 정적 `MODEL_ID_BY_NAME.claude = env.SAJU_LLM_MODEL_CLAUDE` | `resolvePersonaModels` 안에서 claude 만 `await resolveClaudeModel()`, codex/gemini 는 env 정적. 매핑 객체를 async 빌드 |
| `features/saju-reading/lib/llm-client.ts:29` | `const model = env.SAJU_LLM_MODEL` | `const model = await resolveClaudeModel()` |
| `scripts/verify-final.mjs:9` | env fallback (`?? "claude-opus-latest"`) | **변경 없음** — 독립 스모크 스크립트, resolver import 불가(빌드 산출물 의존). env 값 그대로 |

네 경로 모두 이미 `async` 함수 본문이라 `await` 추가 가능.

### PRICING 키 prefix 매칭: `features/saju-reading/lib/llm-client.ts`

model ID 가 동적(`claude-opus-4-8` → 다음 `claude-opus-4-9`)이라 하드코딩 키 매칭이 다시 빗나간다.
opus 계열은 버전 무관 동일 단가(input 15 / output 75)이므로 폴백을 prefix 기반으로 변경:

```ts
function pricingFor(model: string) {
  if (PRICING_USD_PER_M[model]) return PRICING_USD_PER_M[model];
  if (model.startsWith("claude-opus-")) return OPUS_PRICING;   // { input: 15, output: 75 }
  return OPUS_PRICING; // 최종 폴백도 opus (기본 모델이 opus)
}
```

`PRICING_USD_PER_M` 의 `claude-opus-latest` 명시 키는 prefix 폴백으로 흡수되므로 제거 가능
(opus 단가 상수 `OPUS_PRICING` 추출).

## 데이터 흐름

```
LLM 호출 (narrative / reading / stock)
  └─ resolveClaudeModel()
       ├─ 캐시 히트 → model ID 반환
       └─ 미스 → GET /v1/models → opus 안정 패턴 필터 → 버전 최대 → 캐시+반환
                    └─ 실패 → env.SAJU_LLM_MODEL_CLAUDE 폴백
  └─ analyzeStructured/analyzeText({ model, ...gatewayDefaults })
```

## 에러 처리

- **프록시 다운 / 타임아웃 / 0건**: env 고정값 폴백. 전 도메인 LLM 호출 중단 없음.
- **잘못된 JSON**: catch → env 폴백.
- 폴백 경로는 캐시하지 않아 프록시 회복 시 다음 호출에서 자동 재시도.

## 캐시 무효화 / 운영 영향

- `cachedReading.ts` 의 narrative DB 캐시는 `model` + `promptVersion` 키. resolver 가 4-7 → 4-8 로
  바뀌면 기존 4-7 캐시 row 는 미스 → 4-8 로 재생성 (첫 조회 시 LLM 비용 1회 재발생). 정상 동작.
- env default 자체는 폴백 안전망으로 `claude-opus-4-8` 로 갱신 (현 4-7 은 stale). 운영 `.env` 에
  override 없음 → 배포 시 default 상속.

## 테스트 (`resolve-claude-model.test.ts`, fetch mock)

1. 정상 목록(4-8/4-7/4-6/dated/alias 혼재) → `claude-opus-4-8` 선택.
2. preview/dated/alias 제외 확인 (`claude-opus-4-5-20251101`, `claude-opus-latest` 무시).
3. 가짜 `claude-opus-4-9` 추가 → `claude-opus-4-9` 선택 (버전 비교 정확성).
4. `claude-opus-5-0` vs `claude-opus-4-9` → `5-0` 선택 (major 우선).
5. fetch reject → `env.SAJU_LLM_MODEL_CLAUDE` 폴백.
6. opus 매칭 0건 → env 폴백.
7. TTL 내 2회 호출 → fetch 1회만 (캐시 히트).

기존 fixture 테스트(`generateReading.test.ts` 등)는 `SAJU_LLM_MODEL` 을 자체 stub 하므로 영향 없음.

## 검증

- `pnpm typecheck && pnpm lint`
- `pnpm exec vitest run resolve-claude-model` + 영향 테스트 4종
- `cd apps/dashboard && pnpm build` (Gotcha #7 — server/client seam 회귀 방지 1회 필수)
