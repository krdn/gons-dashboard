// OAuth scope/token in-place 갱신.
//
// 배경:
//   @auth/drizzle-adapter 의 linkAccount 는 PK(provider, providerAccountId)
//   충돌 시 silent fail (INSERT-only). 따라서 사용자가 새 scope 로 재로그인해도
//   기존 accounts row 의 scope/access_token/refresh_token/expires_at 이
//   그대로 남아 새 권한이 반영되지 않는다.
//
//   사고 사례 (2026-05-12): Calendar MCP 파일럿 머지 후 NextAuth scope 에
//   calendar.readonly 를 추가했으나 사용자 재로그인해도 DB 의 scope 가
//   gmail-only 그대로 → Calendar API 가 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT.
//   임시 조치는 accounts row DELETE 후 재로그인 (fix-oauth-scope.ts).
//
// 이 모듈은 events.signIn 에서 호출되어, adapter 가 못 갱신한 필드를 명시
// UPDATE 한다. provider + providerAccountId 로 정확한 row 를 타겟. token
// 필드 중 account 에 정의된 값만 set 하여, OAuth 응답이 일부만 채워준
// 경우(rotation 미수반 refresh 등)에도 안전.
//
// pure 함수 + DI: db client 를 인자로 받아 통합 테스트가 실제 DB 없이도
// 가능하게 한다.
import "server-only";
import { and, eq } from "drizzle-orm";
import { accounts } from "@/shared/lib/db/schema";

// account 객체 중 우리가 신경 쓰는 필드만. NextAuth Account 의 부분 집합.
export interface AccountTokenFields {
  provider: string;
  providerAccountId: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  scope?: string | null;
  token_type?: string | null;
  id_token?: string | null;
}

// db.update().set().where() 체인 형태만 요구 — 실제 Drizzle client 또는 mock.
export interface AccountUpdater {
  update: (
    table: typeof accounts,
  ) => {
    set: (values: Partial<typeof accounts.$inferInsert>) => {
      where: (predicate: ReturnType<typeof and>) => Promise<unknown>;
    };
  };
}

export interface RefreshAccountTokensResult {
  changedFields: Array<keyof typeof accounts.$inferInsert>;
  skipped: boolean;
}

/**
 * adapter 가 못 갱신한 token/scope 필드를 명시 UPDATE.
 *
 * @returns 변경된 필드 목록. account 가 google provider 가 아니거나
 *          갱신할 필드가 없으면 skipped=true.
 */
export async function refreshAccountTokens(
  db: AccountUpdater,
  account: AccountTokenFields | null | undefined,
): Promise<RefreshAccountTokensResult> {
  if (!account || account.provider !== "google") {
    return { changedFields: [], skipped: true };
  }

  // account 에 명시적으로 정의된 필드만 set. undefined 는 건너뜀.
  // null 도 의도적 clear 로 해석해 그대로 set (rare; 보통 OAuth 응답에는
  // 안 나타남).
  const patch: Partial<typeof accounts.$inferInsert> = {};
  const considered: Array<
    [keyof AccountTokenFields, keyof typeof accounts.$inferInsert]
  > = [
    ["access_token", "access_token"],
    ["refresh_token", "refresh_token"],
    ["expires_at", "expires_at"],
    ["scope", "scope"],
    ["token_type", "token_type"],
    ["id_token", "id_token"],
  ];

  for (const [accountKey, dbKey] of considered) {
    const value = account[accountKey];
    if (value !== undefined) {
      // drizzle 의 $inferInsert 는 string|null 등 정확한 타입. 단순 캐스트
      // (account 가 OAuth response 라 타입이 호환되지만 TS 가 추적 못함).
      (patch as Record<string, unknown>)[dbKey] = value;
    }
  }

  const changedFields = Object.keys(patch) as Array<
    keyof typeof accounts.$inferInsert
  >;
  if (changedFields.length === 0) {
    return { changedFields: [], skipped: true };
  }

  await db
    .update(accounts)
    .set(patch)
    .where(
      and(
        eq(accounts.provider, "google"),
        eq(accounts.providerAccountId, account.providerAccountId),
      )!,
    );

  return { changedFields, skipped: false };
}
