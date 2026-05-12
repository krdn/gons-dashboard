// Gmail OAuth — refresh token으로 access token 재발급.
//
// Auth.js의 accounts 테이블에서 (refresh_token, access_token, expires_at)을 읽고,
// 만료 임박 시 Google token endpoint로 갱신하여 DB에 다시 저장.
//
// invalid_grant 에러 시:
//  - users.oauth_state = 'reauth_required'
//  - users.token_expired_at = now()
// 호출자는 이 상태를 보고 polling 중단 + 사용자 알림.
import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { accounts, users } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { classifyTokenError, InvalidGrantError } from "./errors";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// access_token이 만료까지 60초 이내면 갱신 (clock skew 마진).
const REFRESH_MARGIN_SEC = 60;

export interface GmailAccessToken {
  accessToken: string;
  expiresAt: number; // unix seconds
}

/**
 * 사용자의 유효한 access token 반환. 만료되었으면 자동 갱신.
 *
 * @throws InvalidGrantError refresh token 자체가 무효 (사용자 재로그인 필요).
 *   호출자는 이 에러를 받으면 oauth_state 전환 + 사용자 알림 트리거.
 */
export async function getValidAccessToken(
  userId: string,
): Promise<GmailAccessToken> {
  const row = await db
    .select({
      refresh: accounts.refresh_token,
      access: accounts.access_token,
      expires: accounts.expires_at,
      provider: accounts.provider,
      providerAccountId: accounts.providerAccountId,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);

  if (row.length === 0) {
    throw new InvalidGrantError("Google account 미연결");
  }

  const account = row[0];
  if (!account.refresh) {
    throw new InvalidGrantError("refresh_token 없음 — 재로그인 필요");
  }

  const now = Math.floor(Date.now() / 1000);
  const expires = account.expires ?? 0;

  // 아직 유효하면 그대로 반환.
  if (account.access && expires > now + REFRESH_MARGIN_SEC) {
    return { accessToken: account.access, expiresAt: expires };
  }

  // 갱신 필요.
  return refreshAccessToken(userId, account.refresh, account.providerAccountId);
}

async function refreshAccessToken(
  userId: string,
  refreshToken: string,
  providerAccountId: string,
): Promise<GmailAccessToken> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const err = classifyTokenError(body, response.status);
    if (err instanceof InvalidGrantError) {
      // refresh token 만료 → DB 상태 전환.
      await db
        .update(users)
        .set({
          oauthState: "reauth_required",
          tokenExpiredAt: new Date(),
        })
        .where(eq(users.id, userId));
    }
    throw err;
  }

  const parsed = body as {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
    // Google이 refresh_token도 함께 보내는 경우는 드물지만 가능.
    refresh_token?: string;
  };

  const newExpiresAt = Math.floor(Date.now() / 1000) + parsed.expires_in;

  // accounts 테이블 업데이트.
  await db
    .update(accounts)
    .set({
      access_token: parsed.access_token,
      expires_at: newExpiresAt,
      ...(parsed.refresh_token ? { refresh_token: parsed.refresh_token } : {}),
    })
    .where(
      and(
        eq(accounts.provider, "google"),
        eq(accounts.providerAccountId, providerAccountId),
      ),
    );

  return { accessToken: parsed.access_token, expiresAt: newExpiresAt };
}
