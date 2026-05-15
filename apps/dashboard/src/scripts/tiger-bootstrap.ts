// 운영자 1회 setup: PlayMCP OTT → access/refresh 토큰 교환 → DB INSERT.
//
// 사용:
//   pnpm tiger:bootstrap --ott <OTT_VALUE> --i-know-this-is-prod
//   또는 .env 의 PLAYMCP_BOOTSTRAP_OTT 사용:
//   I_KNOW_THIS_IS_PROD=1 pnpm tiger:bootstrap

import "dotenv/config";
import { env } from "@/shared/config/env";
import { saveCredentials } from "@/features/tiger-consult/lib/playmcp-credentials";
import { assertProdDbAck } from "./_lib/prodGuard";

function parseArgs(): { ott?: string } {
  const args = process.argv.slice(2);
  const out: { ott?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ott") {
      if (!args[i + 1]) {
        console.error("[ERROR] --ott 플래그에 값 누락");
        process.exit(1);
      }
      out.ott = args[++i];
    }
  }
  return out;
}

async function exchangeOtt(ott: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}> {
  const url = new URL("/api/v1/auths/otts:exchange", env.PLAYMCP_GATEWAY_URL).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "*/*", "Content-Type": "application/json" },
    body: JSON.stringify({ tokenValue: ott }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OTT exchange 실패: ${response.status} ${response.statusText} — ${body}`);
  }
  const data = (await response.json()) as {
    accessToken: { tokenValue: string; expiresAt: string };
    refreshToken: { tokenValue: string; expiresAt: string };
  };
  return {
    accessToken: data.accessToken.tokenValue,
    refreshToken: data.refreshToken.tokenValue,
    accessExpiresAt: new Date(data.accessToken.expiresAt),
    refreshExpiresAt: new Date(data.refreshToken.expiresAt),
  };
}

async function main(): Promise<void> {
  const { ott: cliOtt } = parseArgs();
  const ott = cliOtt ?? env.PLAYMCP_BOOTSTRAP_OTT;
  if (!ott) {
    console.error("[ERROR] OTT 미제공 — --ott <VALUE> 또는 .env PLAYMCP_BOOTSTRAP_OTT 설정");
    process.exit(1);
  }
  assertProdDbAck("tiger-bootstrap");

  console.log("[1/3] PlayMCP OTT exchange...");
  const tokens = await exchangeOtt(ott);
  console.log(`  access_expires_at: ${tokens.accessExpiresAt.toISOString()}`);
  console.log(`  refresh_expires_at: ${tokens.refreshExpiresAt.toISOString()}`);

  console.log("[2/3] DB INSERT...");
  await saveCredentials(tokens);

  console.log("[3/3] 완료. /tiger/admin/diagnostics 에서 검증하세요.");
  console.log("");
  console.log("⚠️  .env 의 PLAYMCP_BOOTSTRAP_OTT 값을 즉시 제거하세요 (1회용).");
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
