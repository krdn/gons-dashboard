// OAuth 스코프 강제 재인증 스크립트.
//
// ⚠️ 파괴적 작업: Google OAuth 계정 레코드를 DELETE하고 oauth_state를
// 'reauth_required'로 설정합니다. 다음 로그인 시 새 scope로 재인증을 강제할 때 사용.
//
// 사용 시점 예:
//  - Gmail scope를 metadata → readonly 등으로 마이그할 때
//  - 손상된 token을 비울 때
//
// 실행 전 반드시 dry-run으로 현재 상태 확인:
//   pnpm exec tsx src/scripts/_dryrun-oauth-scope.ts
//
// 실행:
//   pnpm exec tsx src/scripts/fix-oauth-scope.ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { users, accounts } from "@/shared/lib/db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL 미설정");
    process.exit(1);
  }
  const pg = postgres(url, { max: 1 });
  const db = drizzle(pg, { schema: { users, accounts } });

  try {
    console.log("🔍 사용자 조회...");
    console.log(`   host: ${url.replace(/\/\/[^@]+@/, "//<redacted>@")}`);

    const allUsers = await db.select().from(users);
    console.log(`\n📋 전체 사용자 (${allUsers.length}명):`);
    allUsers.forEach((u) => {
      console.log(`  - ${u.email} (id: ${u.id})`);
      console.log(`    oauth_state: ${u.oauthState}`);
    });

    if (allUsers.length === 0) {
      console.log("  (사용자 없음)");
      return;
    }

    const user = allUsers[0];
    console.log(`\n🔐 선택된 사용자: ${user.email}`);

    const acct = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id));

    console.log("\n📜 현재 OAuth 계정:");
    acct.forEach((a) => {
      console.log(`  - provider: ${a.provider}`);
      console.log(`    scope: ${a.scope || "(없음)"}`);
      console.log(`    expires_at: ${a.expires_at}`);
    });

    // Google OAuth 계정 삭제 (재인증 강제)
    await db
      .delete(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.provider, "google")));

    console.log(`\n✓ Google OAuth 계정 삭제됨`);

    // oauth_state 업데이트
    await db
      .update(users)
      .set({ oauthState: "reauth_required" })
      .where(eq(users.id, user.id));

    console.log(`✓ oauth_state 업데이트됨: "reauth_required"`);

    console.log("\n✅ 완료!");
    console.log("다음 로그인 시 새 스코프로 재인증됩니다.");
    console.log("→ http://localhost:3020 에서 로그인 진행");
  } finally {
    await pg.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("❌ 오류:", e);
  process.exit(1);
});
