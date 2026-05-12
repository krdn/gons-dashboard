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
import { assertProdDbAck } from "./_lib/prodGuard";

async function main() {
  assertProdDbAck("seed-hosts");
  // app 컨테이너는 호스트 /var/run/docker.sock을 마운트하므로 `default` context = 호스트 docker daemon.
  // 별도 `home-server` SSH context는 운영 호스트에 정의되어 있지 않고 불필요.
  const result = await db
    .insert(hosts)
    .values({
      name: "home-server",
      dockerContext: "default",
      description: "192.168.0.5 운영 서버 (Ubuntu 24.04) — mounted /var/run/docker.sock",
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

  // krdn-lenovo는 원격(192.168.0.8) 머신으로 컨테이너 안에서 SSH context 없이는 접근 불가.
  // 현재는 비활성화 — SSH 자격증명 마운트 설계가 끝나면 재활성화.
  const deactivated = await db
    .update(hosts)
    .set({ isActive: false })
    .where(sql`${hosts.name} = 'krdn-lenovo'`)
    .returning({ id: hosts.id, name: hosts.name, isActive: hosts.isActive });

  console.log("✅ seeded host:", result[0]);
  if (deactivated.length > 0) {
    console.log("⏸️  deactivated host:", deactivated[0]);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed failed:", err);
  process.exit(1);
});
