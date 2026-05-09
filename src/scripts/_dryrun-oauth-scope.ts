// DRY RUN: OAuth scope 마이그레이션 필요 여부 조회 (DB 변경 없음)
// 실행: pnpm exec tsx src/scripts/_dryrun-oauth-scope.ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
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
    console.log("🔍 [DRY RUN] OAuth scope 점검 (DB 변경 없음)");
    console.log(`   host: ${url.replace(/\/\/[^@]+@/, "//<redacted>@")}`);

    const allUsers = await db.select().from(users);
    console.log(`\n📋 사용자 (${allUsers.length}명):`);
    if (allUsers.length === 0) {
      console.log("  (없음 — 마이그 불필요)");
      return;
    }

    for (const u of allUsers) {
      console.log(`\n👤 ${u.email}`);
      console.log(`   id=${u.id}`);
      console.log(`   oauth_state=${u.oauthState}`);
      console.log(`   last_history_id=${u.lastHistoryId ?? "(null)"}`);
      console.log(`   last_sync_at=${u.lastSyncAt?.toISOString() ?? "(null)"}`);

      const acct = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, u.id));

      console.log(`   📜 OAuth 계정 (${acct.length}개):`);
      acct.forEach((a) => {
        const hasReadonly = a.scope?.includes("gmail.readonly");
        const hasMetadata = a.scope?.includes("gmail.metadata");
        const verdict = hasReadonly
          ? "✅ readonly OK"
          : hasMetadata
            ? "⚠️ metadata만 있음 → 마이그 필요"
            : "❓ 알 수 없음";
        console.log(`     - ${a.provider}: ${verdict}`);
        console.log(`       scope: ${a.scope || "(없음)"}`);
      });
    }

    console.log("\n✅ [DRY RUN] 완료. 변경 없음.");
  } finally {
    await pg.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("❌ 오류:", e);
  process.exit(1);
});
