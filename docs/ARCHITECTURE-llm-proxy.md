# LLM Proxy (cli-proxy-api) — 아키텍처

대시보드의 모든 LLM 추론이 지나가는 경로. CLAUDE.md 는 요약만 두고 상세는 여기 둔다.

## LLM Proxy 란

운영 서버에서 도는 **`cli-proxy-api`** 컨테이너 (`192.168.0.5:8317`, image `eceasy/cli-proxy-api`).
Claude / Codex / Gemini 셋을 **단일 OpenAI/Anthropic 호환 endpoint** 로 묶어 제공한다.

- **인증 방식**: 각 모델의 CLI tool (Claude Code CLI, Codex CLI, Gemini CLI) 이 사전에 OAuth 로
  로그인해 발급한 **auth file** (`/home/gon/projects/cli-proxy-api/auths/{claude,gemini,codex}-*.json`)
  을 proxy 가 읽어 토큰을 자동 갱신한다.
- **결과**: dashboard 는 **API key 발급 없이** Claude/Gemini/Codex 를 모두 쓴다. 토큰 비용은
  CLI 의 사용 한도 (예: Claude Code 의 Pro/Max plan) 안에서 처리된다.
- **dashboard `.env`** 의 `ANTHROPIC_BASE_URL=http://192.168.0.5:8317` + `ANTHROPIC_API_KEY` 만
  설정하면 `@krdn/llm-gateway` 가 이 값으로 proxy 를 호출한다.

```typescript
// shared/lib/llm/anthropic.ts — 실제 호출은 @krdn/llm-gateway 경유
import { type AIGatewayOptions } from "@krdn/llm-gateway/gateway";
export const gatewayDefaults: Pick<AIGatewayOptions, "provider" | "baseUrl" | "apiKey"> = {
  provider: "claude-cli", // ⚠️ "anthropic" 이면 /v1 경로 누락 → 404
  baseUrl: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
};
```

## 모델 라우팅 — proxy 가 `model` 문자열로 분기

- `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-*` → Claude Code CLI auth
- `gpt-5.5` → Codex CLI auth
- `gemini-pro-latest` (alias) → Gemini CLI auth

모델 ID 는 프록시 사정으로 소멸할 수 있다 (2026-07-05 `gpt-5.3-codex` 소멸 사고). 정상 경로는
`resolveLatestModel(tier)` 가 프록시 `/v1/models` 에서 관리 별칭을 선택하고
(tier 별 6h 캐시), `*_LLM_MODEL_*` env 는 그 조회가 실패했을 때의 폴백이다.

도메인별 모델 선택 지점:

| 도메인 | 선택 주체 |
|---|---|
| saju | `shared/lib/llm/saju-model-registry.ts` + `features/saju-model-picker` |
| stock-analysis | `entities/stock-analysis/api/persona-router.ts` (페르소나별 override) |

## ⚠️ NextAuth Google OAuth 와는 완전히 별개

두 흐름은 목적도 인증 주체도 다르다. 자주 헷갈리는 지점이라 표로 둔다.

| 항목 | NextAuth Google OAuth | LLM Proxy (cli-proxy-api) |
|---|---|---|
| 환경변수 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` |
| 목적 | 사용자 웹 **로그인** + Gmail/Calendar API scope | LLM **추론** API 호출 (Claude/Gemini/Codex) |
| 인증 주체 | 사용자 본인 브라우저 | 운영 컨테이너 (server-to-server) |
| OAuth Client | Google Cloud Console 에 별도 발급 | proxy 내부에서 Gemini CLI 가 자체 발급한 Client 와 token |
| 만료/갱신 | refresh token 으로 `events.signIn` 시 자동 갱신 | proxy 가 auth file watch + 15분 주기 자동 갱신 |
| Down 시 영향 | 사용자 로그인 불가 | LLM 호출 불가 (페르소나 분석·사주 narrative 모두 fail) |

**한 쪽을 다른 쪽으로 대체할 수 없다.** LLM Proxy 의 auth file 에 들어있는 `client_id` /
`client_secret` 은 Gemini CLI 가 자체 발급한 OAuth Client 의 자격이라 redirect URI 가 NextAuth 와
다르고, scope 도 (`cloud-platform`, `userinfo.email`) NextAuth Google provider 의
(`openid email profile`) 와 다르다. 재사용하려면 redirect URI 추가가 필요한데 그 Client 자체가
Gemini CLI 가 관리하는 자동 생성 프로젝트라 수정이 위험하다.

자주 헷갈리는 시나리오: LLM 추론은 정상인데 NextAuth 로그인이 안 된다 (`changeme-*` placeholder)
→ 둘은 별개 흐름이므로 로그인이 안 돼도 LLM 호출은 정상이다.


## 소비자 계약 검사

`pnpm --filter @gons/dashboard test:llm-contract`는 앱의 `.env.local`/`.env`, 실제 resolver와
설치된 llm-gateway를 사용한다. Opus/GPT/Gemini 텍스트와 Haiku 구조화 출력의 대표 4경로만
합성 입력으로 검사한다. DB나 업무 데이터는 사용하지 않는다. 별칭이 없으면 실제 resolver와
같이 환경설정 모델로 폴백하며 카탈로그 숫자 최댓값을 고르지 않는다.

JSON 결과의 `source`에는 checkout SHA, dirty 여부, 설치된 gateway 버전이 있다.
이는 배포 이미지와의 일치 증명이 아니며 운영 프로세스의 기존 캐시도 검사하지 않는다.
429·일시 장애는 UNKNOWN이다. 출력 전체를 보관하되 원본 SDK 오류/키/환경값은 기록하지 않는다.
프록시 운영 저장소는 이 명령의 결과를 수집하고 상태 변화 통지만 담당한다.
