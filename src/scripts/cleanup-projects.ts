// 운영 DB의 좀비 project row를 식별·삭제하는 idempotent 스크립트.
// 기본 dry-run. --apply로 실제 삭제.
//
// 기준: live container의 compose 라벨 set ∪ KNOWN_COMPOSE_PROJECTS_BY_HOST 의 합집합.
// 합집합 외의 row가 좀비.
//
// 실행: `pnpm db:cleanup-projects [--apply]`
import "dotenv/config";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { getHosts } from "@/entities/host";
import { listContainers } from "@/entities/container";
import { KNOWN_COMPOSE_PROJECTS_BY_HOST } from "@/entities/project";
import { computeZombieIds } from "./cleanup-projects.lib";

async function main() {
  const apply = process.argv.includes("--apply");
  const hosts = await getHosts();

  let totalZombies = 0;

  for (const host of hosts) {
    const liveSet = new Set<string>();
    try {
      const containers = await listContainers({
        hostId: host.id,
        dockerContext: host.dockerContext,
      });
      // running 상태만 "live"로 인정. stopped/exited 컨테이너의 라벨은 과거 잔재
      // (사용자가 compose down 후 prune 안 한 경우)일 가능성이 높아 좀비 정리를 막아선 안 된다.
      for (const c of containers) {
        if (c.composeProject != null && c.state === "running") {
          liveSet.add(c.composeProject);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[${host.name}] docker 통신 실패 (${msg}) — whitelist만으로 비교 (보수적)`,
      );
    }

    const whitelist =
      KNOWN_COMPOSE_PROJECTS_BY_HOST[host.name] ?? new Set<string>();
    const dbRows = await db
      .select({ id: projects.id, composeProject: projects.composeProject })
      .from(projects)
      .where(eq(projects.hostId, host.id));

    const zombieIds = computeZombieIds(dbRows, liveSet, whitelist);

    if (zombieIds.length === 0) {
      console.log(`[${host.name}] 좀비 없음 (DB ${dbRows.length} rows)`);
      continue;
    }

    const zombieRows = dbRows.filter((r) => zombieIds.includes(r.id));
    console.log(
      `[${host.name}] 좀비 후보 ${zombieIds.length}개 (전체 ${dbRows.length} rows):`,
    );
    for (const r of zombieRows) {
      console.log(`  - ${r.composeProject}`);
    }
    totalZombies += zombieIds.length;

    if (apply) {
      await db.delete(projects).where(inArray(projects.id, zombieIds));
      console.log(`[${host.name}] ✅ 삭제 완료`);
    } else {
      console.log(
        `[${host.name}] dry-run. 실제 삭제: \`pnpm db:cleanup-projects --apply\``,
      );
    }
  }

  console.log(
    `\n총 ${totalZombies}개 ${apply ? "삭제됨" : "삭제 후보"}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ cleanup failed:", err);
  process.exit(1);
});
