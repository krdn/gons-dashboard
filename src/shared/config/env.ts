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

  // Cron
  CRON_BEARER_TOKEN: z.string().min(32, "openssl rand -hex 32 로 생성"),

  // Web Push (VAPID)
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().startsWith("mailto:").optional(),

  // 운영 알림 (OAuth 만료 등)
  OPS_NOTIFY_EMAIL: z.string().email().optional(),

  // Postgres at-rest 암호화 키 (refresh token)
  PG_ENCRYPTION_KEY: z.string().min(32, "openssl rand -hex 32 로 생성").optional(),

  // 본인 1명 allowlist (콤마 구분)
  ALLOWLIST_EMAILS: z.string().min(1),

  // ─── 서버 인프라 모니터 v0.1 ────────────────────────────
  // Docker context 이름 (사용자 입력 신뢰 안 함 — DB hosts.dockerContext만 사용,
  // 본 변수는 시작 시 health check 용도)
  DOCKER_DEFAULT_CONTEXT: z.string().min(1).default("home-server"),
  // Docker CLI 호출 타임아웃 (ms)
  DOCKER_CMD_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // restart/start/stop 액션 admin allowlist (콤마 구분 이메일)
  ADMIN_EMAILS: z.string().min(1),

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
