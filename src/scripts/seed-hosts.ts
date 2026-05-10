// home-server 호스트를 idempotent하게 upsert.
// 운영 배포 시 한 번만 돌리면 됨. 재실행해도 안전.
//
// 실행: `pnpm db:seed:hosts`
//   package.json의 `tsx --conditions=react-server`는 db/client.ts와 env.ts의
//   `import "server-only"` 가드를 우회하기 위함 (Next.js 외부에서 호출).
//
// 주의: ESM에서는 import가 hoist되므로 `dotenv.config()`를 함수 안에서 호출하면
// db/client → env.ts가 먼저 평가돼 환경 변수 검증이 실패한다.
// `dotenv/config` 부수효과 import를 최상단에 두어 다른 import보다 먼저 실행시킨다.
import "dotenv/config";

import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db
    .insert(hosts)
    .values({
      name: "home-server",
      dockerContext: "home-server",
      description: "192.168.0.5 운영 서버 (Ubuntu 24.04, Docker Engine v27.5.1)",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: hosts.name,
      set: {
        dockerContext: sql`excluded.docker_context`,
        description: sql`excluded.description`,
        isActive: sql`excluded.is_active`,
      },
    })
    .returning({ id: hosts.id, name: hosts.name });

  console.log("✅ seeded host:", result[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed failed:", err);
  process.exit(1);
});
