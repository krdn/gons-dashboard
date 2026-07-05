# provider별 최신 모델 자동 선택 (resolveLatestModel)

**날짜**: 2026-07-05
**상태**: 설계 승인 대기
**관련 진단**: 포트폴리오 분석 "Analysis returned failed status" — codex(`gpt-5.3-codex`) 소멸 + claude(`resolveClaudeModel` 정규식 dated 오독) 이중 결함

## 배경 / 문제

포트폴리오 분석(stock-analysis)이 5개 페르소나 LLM 호출 중 3명 미만 성공(`MINIMUM_SUCCESS=3`)이라 실패했다. 근본 원인은 **모델 ID 2개가 프록시 백엔드와 drift**:

1. **codex** (`SAJU_LLM_MODEL_CODEX=gpt-5.3-codex`) — 프록시에서 소멸(502 unknown provider). 정적 env 값이라 자동 갱신 안 됨. value·technical 페르소나 실패.
2. **claude** (`resolveClaudeModel`) — 정규식 `^claude-opus-(\d+)-(\d+)$`이 2-segment dated 모델(`claude-opus-4-20250514`)을 매칭하고 날짜 `20250514`를 minor 버전으로 오독 → `claude-opus-4-8`(minor=8)을 압도 → 죽은 dated 모델 선택(503 auth_unavailable). 6시간 캐시로 고정. wallStreet·krExpert 페르소나 실패.

결과: gemini 1명만 성공 → 1/5 < 3 → failed.

**핵심 요구사항**: 분석에 쓰는 모델을 **항상 프록시가 제공하는 최신 tier 모델**로 자동 선택. 정적 drift와 정규식 버그를 함께 제거.

## 조사로 확정된 사실 (2026-07-05 프록시 `/v1/models` 실측)

- 프록시 `-latest` alias는 **한 세대 뒤처짐**: `claude-opus-latest`→`claude-opus-4-7`(목록엔 4-8 있음), `gemini-pro-latest`→`gemini-2.5-pro`(목록엔 3.1-pro-preview 있음). **alias로는 "항상 최신" 불가** → 목록 직접 파싱 필요.
- `created` 타임스탬프 단순 최댓값도 부적합: anthropic 최댓값은 `claude-sonnet-5`/`claude-fable-5`(opus 아님), openai 최댓값은 `codex-auto-review`(분석 부적합). **tier(등급)를 무시하면 잘못된 모델 선택**.
- `gpt-5.5` 실호출 200 확인 → codex를 `gpt-5.5`로 살릴 수 있음(quorum 해소: claude 2 + gemini 1 + codex 2 = 5명 가능).
- `resolveClaudeModel`은 stock뿐 아니라 **saju도 소비**(`saju-reading/lib/llm-client.ts`) → claude는 반드시 **opus tier 유지**. 통합 수정 시 saju의 동일 latent 버그도 함께 해소됨.

## 설계

### 통합 함수 `resolveLatestModel`

기존 `resolveClaudeModel`(claude 전용, 버그 있음)을 폐기하고 provider별 tier 파싱 통합 함수로 대체.

```
resolveLatestModel(tier: "opus" | "gpt" | "gemini-pro"): Promise<string>
```

**동작**:
1. 6시간 메모리 캐시(tier별) 히트 → 즉시 반환
2. 미스 → `GET ${ANTHROPIC_BASE_URL}/v1/models` (타임아웃 3초, cache: no-store) — 기존 코드 재사용
3. tier별 정규식 필터 + (major, minor) 최댓값 선택:

| tier | 정규식 | 매칭 예 | dated/부적합 배제 |
|------|--------|---------|------------------|
| opus | `^claude-opus-(\d+)-(\d+)$` | `claude-opus-4-8` | 끝 세그먼트가 8자리 숫자(YYYYMMDD)면 dated로 보고 배제 → `claude-opus-4-20250514` 탈락 |
| gpt | `^gpt-(\d+)\.(\d+)$` | `gpt-5.5` | `$` 앵커가 `-mini`/`codex-auto-review`/`gpt-image-2` 자동 제외 |
| gemini-pro | `^gemini-(\d+)\.(\d+)-pro$` | `gemini-2.5-pro` | `$` 앵커가 `-preview`/`-flash` 자동 제외 |

4. 성공: tier별 캐시 저장 + 반환
5. 실패(네트워크/타임아웃/0건): env 폴백값 반환, **캐시 안 함**(다음 호출 재시도)

**dated 배제 규칙**: 안정 버전은 `claude-opus-4-8`처럼 짧은 minor를 쓰고, dated 변종은 `claude-opus-4-20250514`처럼 끝 세그먼트가 8자리 YYYYMMDD다. 정규식 매칭 후 **끝 세그먼트가 정확히 8자리 숫자면 dated로 간주해 배제**한다(단순 `minor < N` 임계값보다 의미가 명확하고 미래 minor 증가에 안전). 이것이 이번 정규식 버그의 근본 수정.

**gemini 의도적 결정**: 현재 프록시에 안정 `-pro`는 `gemini-2.5-pro`뿐이고 3.1은 `gemini-3.1-pro-preview`(preview)만 존재. **preview는 배제**(사용자 안정 우선 방침)하므로 gemini는 `gemini-2.5-pro` 선택. 안정 3.1-pro가 프록시에 나오면 자동으로 승격됨.

### env 폴백값 갱신

조회 실패 시 폴백값을 **현재 프록시에 실존하는 값**으로 갱신(`shared/config/env.ts`):
- `SAJU_LLM_MODEL_CLAUDE`: `claude-opus-4-8` (현행 유지)
- `SAJU_LLM_MODEL_CODEX`: `gpt-5.3-codex` → **`gpt-5.5`** (죽은 값 교체)
- `SAJU_LLM_MODEL_GEMINI`: `gemini-2.5-pro` (현행 유지)

### 소비 지점 변경

| 파일 | 현재 | 변경 |
|------|------|------|
| `persona-router.ts` | `resolveClaudeModel()` (claude만) + codex/gemini 정적 env | 3개 모두 `resolveLatestModel(tier)` 호출 |
| `saju-reading/lib/llm-client.ts` | `resolveClaudeModel()` | `resolveLatestModel("opus")` |
| `resolve-claude-model.ts` | 폐기 | `resolveLatestModel`으로 대체(또는 파일 rename) |

## 안전장치 / 검증 범위 (정직한 한계)

- **목록 실존 확인만**: 선택 결과가 `/v1/models` 목록에 있는지 확인. **HTTP 프로빙 없음**(추가 LLM 비용 0).
- **한계 명시**: 목록에 있어도 호출 시 죽을 수 있음(`claude-opus-4-20250514`은 목록에 있었으나 503이었음). 목록 검증은 이번 재발을 **완전히 막지 못함**. 실제 재발 방어의 최종 방어선은 **per-persona 실패 격리 + 3/5 quorum**(기존 `Promise.allSettled`)이다. 이 spec은 목록 검증을 "재발 완전 차단"으로 과장하지 않는다.

## 테스트

- **회귀 잠금(먼저 작성, RED)**: `resolve-*.test.ts`에 `claude-opus-4-20250514` 포함 목록 → `claude-opus-4-8` 선택되는지(dated 오독 회귀 방지). 현재 버그 코드에선 실패해야 함.
- tier별 파싱 단위 테스트: opus/gpt/gemini-pro 각각 최신 선택 + dated/mini/preview 배제.
- 조회 실패 → env 폴백 + 캐시 안 함.
- 빈 목록 → 폴백.

## 범위 밖 (YAGNI)

- codex/gemini의 tier가 미래에 완전히 새 네이밍으로 바뀌는 경우(예: `gpt-6-o1` 같은 형식) — 현재 네이밍 규칙 기준으로만 파싱. 규칙이 깨지면 폴백값 사용 + 로그 경고로 감지.
- 사용자별 페르소나 override(`stock_persona_preferences`)는 기존대로 유지 — override는 tier가 아닌 ModelName("claude"/"codex"/"gemini")이라 이 변경과 직교.

## 배포 주의

- 운영 이미지 재배포 필요(현재 6-28 이미지). dev 서버는 **재시작만으로 캐시 해제**되어 즉시 정상화.
- 운영 compose `environment`에 `SAJU_LLM_MODEL_*` 미주입 상태(코드 기본값 사용 중) — 폴백값 갱신이 env 파일이 아닌 **코드 기본값**에 반영되므로 compose 수정 불필요. (참고: `compose-missing-saju-env-uses-code-default`)
