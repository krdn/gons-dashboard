// /api/mcp/credentials/google — MCP 패키지 mediator.
//
// 정책:
//   - Bearer 인증 (env.MCP_DASHBOARD_TOKEN). v1은 정적, v2에 HMAC TTL로 전환.
//   - userEmail 미지정 시 ADMIN_EMAILS[0] 사용 (단일 사용자 환경).
//   - 응답에 Cache-Control: no-store 강제.
//   - InvalidGrantError → 410 Gone (호출자가 사용자 재로그인 트리거).
//   - 기타 에러 → 503 (호출자가 backoff 재시도).
import "server-only";
import { eq } from "drizzle-orm";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { getValidAccessToken } from "@/shared/api/gmail/auth";
import { InvalidGrantError } from "@/shared/api/gmail/errors";

export const dynamic = "force-dynamic";

function unauthorized() {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/);
  if (!match || match[1] !== env.MCP_DASHBOARD_TOKEN) {
    return unauthorized();
  }

  // v1 — 단일 사용자. ADMIN_EMAILS의 첫 이메일을 그대로 사용.
  const adminEmail = env.ADMIN_EMAILS.split(",")[0]?.trim().toLowerCase();
  if (!adminEmail) {
    return new Response("ADMIN_EMAILS 미설정", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  if (row.length === 0) {
    return new Response("User not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const { accessToken, expiresAt } = await getValidAccessToken(row[0].id);
    return Response.json(
      {
        accessToken,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      return new Response("OAuth refresh expired", {
        status: 410,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new Response("Transient error", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
