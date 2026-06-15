// Zod로 검증된 환경 변수.
// 누락·오타·잘못된 값을 부팅 시점에 큰 소리로 알린다.
// (server-only — 클라이언트 번들에 포함되지 않음.)
import "server-only";
import { z } from "zod";

const schema = z.object({
  // Node
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database (Postgres on 192.168.0.5:5440)
  DATABASE_URL: z.string().url(),

  // Redis (192.168.0.5:6390)
  REDIS_URL: z.string().url(),

  // Auth.js v5
  NEXTAUTH_SECRET: z.string().min(32, "openssl rand -base64 32 로 생성"),
  NEXTAUTH_URL: z.string().url(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Anthropic SDK 호환 환경변수 — 사용자의 Claude Code CLI Proxy를 향함.
  // CLAUDE.md 정책: baseURL=http://192.168.0.5:8317.
  // SDK가 `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`를 자동 인식하므로 이름을 그대로 사용.
  ANTHROPIC_BASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),

  // 사주 상세 읽기 — features/saju-reading (spec §7, 2026-06-14)
  // resolveClaudeModel() 로 런타임 선택, 실패 시 이 env 값으로 폴백.
  // (claude-opus-latest 는 프록시 정적 핀이므로 stale — concrete version 유지)
  SAJU_LLM_MODEL: z.string().default("claude-opus-4-8"),
  // 사주 narrative 모델 선택 (v0.3.2, 2026-06-14) — 3종 백엔드별 모델 ID
  // 프록시(ANTHROPIC_BASE_URL=:8317)가 model 문자열을 보고 Claude/Codex/Gemini로 라우팅.
  // claude: resolveClaudeModel() 로 /v1/models 에서 최신 안정 opus 자동 선택.
  // 조회 실패 시 이 env 값으로 폴백 (캐시하지 않음 → 다음 호출 재시도).
  SAJU_LLM_MODEL_CLAUDE: z.string().default("claude-opus-4-8"),
  // Codex: 프록시 model list 에 정확한 ID 는 "gpt-5.3-codex" (운영 검증 2026-05-20).
  // "gpt-5-codex" 는 502 "unknown provider" — spec §8 가설이 깨진 case.
  SAJU_LLM_MODEL_CODEX: z.string().default("gpt-5.3-codex"),
  SAJU_LLM_MODEL_GEMINI: z.string().default("gemini-2.5-pro"),
  SAJU_LLM_DAILY_BUDGET_KRW: z.coerce.number().int().positive().default(1000),
  SAJU_LLM_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.3),

  // Cron
  CRON_BEARER_TOKEN: z.string().min(32, "openssl rand -hex 32 로 생성"),

  // KRX OpenAPI (한국거래소) — 종목기본정보 시드용
  // openapi.krx.co.kr 마이페이지 → API 인증키 발급 + 개별 API (sto/stk_isu_base_info,
  // sto/ksq_isu_base_info) 사용 신청 + 승인 필요.
  KRX_OPENAPI_AUTH_KEY: z
    .string()
    .min(1, "KRX OpenAPI AUTH_KEY. https://openapi.krx.co.kr/ 에서 발급 + API 사용 신청."),

  // DART OpenAPI (재무제표) — KR 종목 PBR/배당/EPS/BPS overlay (PR 2)
  // 발급: opendart.fss.or.kr 회원가입 → 인증키 발급 (T+1).
  // optional — 키 없거나 STOCK_FUNDAMENTALS_SOURCES=off 면 orchestrator 가 DART 호출 skip.
  DART_OPENAPI_AUTH_KEY: z
    .string()
    .min(1, "DART OpenAPI key. https://opendart.fss.or.kr/ 에서 발급.")
    .optional(),

  // 펀더멘털 소스 토글 (롤백 스위치, PR 2)
  // - "yahoo+dart" (기본): yahoo-finance2 + DART overlay
  // - "off": DART 비활성, yahoo-finance2 만 (PR #120 직후 동작 복귀)
  STOCK_FUNDAMENTALS_SOURCES: z
    .enum(["yahoo+dart", "off"])
    .default("yahoo+dart"),

  // 사용자 1명당 등록 가능한 관심종목(watchlist) 최대 개수. 보유종목은 별도. 기본 10.
  STOCK_WATCHLIST_MAX_PER_USER: z.coerce.number().int().min(0).default(10),

  // Web Push (VAPID)
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().startsWith("mailto:").optional(),

  // 운영 알림 (OAuth 만료 등)
  OPS_NOTIFY_EMAIL: z.string().email().optional(),

  // Postgres at-rest 암호화 키 (refresh token)
  PG_ENCRYPTION_KEY: z
    .string()
    .min(32, "openssl rand -hex 32 로 생성. PlayMCP 토큰 + (가능 시) Google refresh 토큰 암호화."),

  // ─── PlayMCP 1FATE (호 상담 영역) ────────────────────────
  // PlayMCP 게이트웨이 OAuth 흐름 — spec §11 / plan 2026-05-15.
  PLAYMCP_GATEWAY_URL: z
    .string()
    .url()
    .default("https://playmcp.kakao.com/mcp"),
  PLAYMCP_CLIENT_ID: z
    .string()
    .min(1, "PlayMCP gateway client_id 필수 — 가이드 고정값"),
  PLAYMCP_BOOTSTRAP_OTT: z
    .string()
    .optional(),

  // 본인 1명 allowlist (콤마 구분)
  ALLOWLIST_EMAILS: z.string().min(1),

  // ─── 서버 인프라 모니터 v0.1 ────────────────────────────
  // Docker context 이름 (사용자 입력 신뢰 안 함 — DB hosts.dockerContext만 사용,
  // 본 변수는 시작 시 health check 용도)
  // 컨테이너 안에서 /var/run/docker.sock 마운트 → context=default가 호스트 docker daemon.
  DOCKER_DEFAULT_CONTEXT: z.string().min(1).default("default"),
  // Docker CLI 호출 타임아웃 (ms)
  DOCKER_CMD_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // restart/start/stop 액션 admin allowlist (콤마 구분 이메일)
  ADMIN_EMAILS: z.string().min(1),

  // MCP mediator bearer — packages/mcp-* → /api/mcp/credentials/* 호출 인증.
  // v1은 정적 bearer. v2에서 HMAC short-lived로 전환 (TODOS #1 / spec §8).
  MCP_DASHBOARD_TOKEN: z.string().min(32, "openssl rand -hex 32 로 생성"),

  // 타임존 (cron + DB 쿼리에 결정적)
  TZ: z.literal("Asia/Seoul").default("Asia/Seoul"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ 환경 변수 검증 실패:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("환경 변수 설정 오류 — .env 파일을 확인하세요.");
}

export const env = parsed.data;
export type Env = typeof env;
