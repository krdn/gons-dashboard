import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpCredentials } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { encryptToken, decryptToken } from "@/shared/lib/db/pgcrypto";
import { PlayMCPNotConfiguredError, PlayMCPAuthError, PlayMCPNetworkError } from "./errors";

const ACCESS_REFRESH_THRESHOLD_MS = 5 * 60_000;

interface RefreshTokenResponse {
  accessToken: { tokenValue: string; expiresAt: string };
  refreshToken: { tokenValue: string; expiresAt: string };
}

export async function ensureAccessToken(): Promise<string> {
  const rows = await db.select().from(playmcpCredentials).limit(1);
  const cred = rows[0];
  if (!cred) {
    throw new PlayMCPNotConfiguredError();
  }
  const now = Date.now();
  if (cred.accessExpiresAt.getTime() - now > ACCESS_REFRESH_THRESHOLD_MS) {
    return decryptToken(cred.accessTokenEnc, env.PG_ENCRYPTION_KEY);
  }
  return refreshAccessToken(cred.id, decryptToken(cred.refreshTokenEnc, env.PG_ENCRYPTION_KEY));
}

async function refreshAccessToken(credId: string, refreshToken: string): Promise<string> {
  // PlayMCP 게이트웨이 토큰 refresh — endpoint 형식은 mcp-connection-guide.md
  // 의 OTT exchange 와 동일 구조 가정. 구현 단계에서 mcporter SDK 분석으로
  // 정확한 경로 확정 필요.
  const url = new URL("/api/v1/auths/tokens:refresh", env.PLAYMCP_GATEWAY_URL).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new PlayMCPNetworkError("refresh fetch failed", err);
  }
  if (!response.ok) {
    throw new PlayMCPAuthError(
      `refresh token 거부: ${response.status} ${response.statusText}`,
      { recoverable: false },
    );
  }
  const body = (await response.json()) as RefreshTokenResponse;
  const newAccessExpiresAt = new Date(body.accessToken.expiresAt);
  const newRefreshExpiresAt = new Date(body.refreshToken.expiresAt);
  await db
    .update(playmcpCredentials)
    .set({
      accessTokenEnc: encryptToken(body.accessToken.tokenValue, env.PG_ENCRYPTION_KEY),
      refreshTokenEnc: encryptToken(body.refreshToken.tokenValue, env.PG_ENCRYPTION_KEY),
      accessExpiresAt: newAccessExpiresAt,
      refreshExpiresAt: newRefreshExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(playmcpCredentials.id, credId));
  return body.accessToken.tokenValue;
}

export interface SaveCredentialsInput {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export async function saveCredentials(input: SaveCredentialsInput): Promise<void> {
  const existing = await db.select({ id: playmcpCredentials.id }).from(playmcpCredentials).limit(1);
  const values = {
    accessTokenEnc: encryptToken(input.accessToken, env.PG_ENCRYPTION_KEY),
    refreshTokenEnc: encryptToken(input.refreshToken, env.PG_ENCRYPTION_KEY),
    accessExpiresAt: input.accessExpiresAt,
    refreshExpiresAt: input.refreshExpiresAt,
    clientId: env.PLAYMCP_CLIENT_ID,
    updatedAt: new Date(),
  };
  if (existing[0]) {
    await db.update(playmcpCredentials).set(values).where(eq(playmcpCredentials.id, existing[0].id));
  } else {
    await db.insert(playmcpCredentials).values(values);
  }
}

export async function getCredentialsSummary(): Promise<{
  configured: boolean;
  accessExpiresAt?: Date;
  refreshExpiresAt?: Date;
  updatedAt?: Date;
}> {
  const rows = await db
    .select({
      accessExpiresAt: playmcpCredentials.accessExpiresAt,
      refreshExpiresAt: playmcpCredentials.refreshExpiresAt,
      updatedAt: playmcpCredentials.updatedAt,
    })
    .from(playmcpCredentials)
    .limit(1);
  if (!rows[0]) return { configured: false };
  return { configured: true, ...rows[0] };
}
