// scripts/ 진입점의 prod DB 가드.
//
// 배경: tests/setup.ts 는 prod 호스트를 *차단*하지만, scripts/seed-* 와
// cleanup-projects 는 의도적으로 prod 를 향한다. 그래도 실수로 dev DB 가 prod 를
// 가리키는 .env 를 그대로 쓰거나, 동료가 모르고 실행하는 사고를 막을 가벼운 가드가 필요.
//
// 정책:
//   - DATABASE_URL hostname 이 PROD_HOSTNAMES 에 매칭되면 ack flag 필수.
//   - ack: `--i-know-this-is-prod` CLI 플래그 또는 `I_KNOW_THIS_IS_PROD=1` env var.
//   - safe (localhost / 127.0.0.1 / staging 등) 면 즉시 통과.
//   - 비대화형 (cron / CI) 친화 — stdin prompt 없음.

const PROD_HOSTNAMES = new Set(["192.168.0.5", "gons.krdn.kr"]);
const ACK_FLAG = "--i-know-this-is-prod";
const ACK_ENV = "I_KNOW_THIS_IS_PROD";

/** DATABASE_URL hostname 추출 (URL 파싱 실패 시 null). */
function extractHostname(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 호스트가 prod 인지 판정. 외부에서 메시지 출력 분기에 사용.
 */
export function isProdHost(databaseUrl: string): boolean {
  const hostname = extractHostname(databaseUrl);
  return hostname != null && PROD_HOSTNAMES.has(hostname);
}

/**
 * 운영 DB 를 향할 때 ack 가 있는지 확인. 없으면 throw.
 * scriptName 은 에러 메시지에 표시 (어느 script 가 막혔는지 식별).
 */
export function assertProdDbAck(scriptName: string): void {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!isProdHost(dbUrl)) return;

  const hasFlag = process.argv.includes(ACK_FLAG);
  const hasEnv = process.env[ACK_ENV] === "1";
  if (hasFlag || hasEnv) return;

  const hostname = extractHostname(dbUrl);
  throw new Error(
    `[${scriptName}] DATABASE_URL 이 운영 DB 를 가리킵니다 (hostname=${hostname}).\n` +
      `의도적으로 운영에 실행하는 경우 다음 중 하나로 ack 하세요:\n` +
      `  - CLI 플래그:  pnpm db:seed:* ${ACK_FLAG}\n` +
      `  - 환경 변수:    ${ACK_ENV}=1 pnpm db:seed:*\n` +
      `로컬 dev DB 에 실행하려는 의도였다면 .env 의 DATABASE_URL 을 확인하세요.`,
  );
}
