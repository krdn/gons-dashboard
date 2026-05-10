// 주요 프로젝트의 description/category/url을 idempotent하게 upsert.
// 키는 "운영 docker compose의 실제 project 라벨" 기준 (docker ps의
// `com.docker.compose.project` label과 동일해야 매칭됨).
//
// 재실행 시 displayName(사용자 편집 가능 필드)은 덮어쓰지 않고
// description/category/url만 갱신. 처음 INSERT일 때만 displayName 적용.
//
// 실행: `pnpm db:seed:projects`
// 전제: `pnpm db:seed:hosts`로 home-server, krdn-lenovo 호스트가 먼저 등록돼 있어야 함.
import "dotenv/config";

import { KNOWN_COMPOSE_PROJECTS_BY_HOST } from "@/entities/project";
import { db } from "@/shared/lib/db/client";
import { hosts, projects } from "@/shared/lib/db/schema";
import { eq, sql } from "drizzle-orm";

type SeedProject = {
  composeProject: string;
  displayName: string;
  description: string;
  category: "news" | "ai" | "infra" | "experiment";
  url: string | null;
};

const HOME_IP = "192.168.0.5";

// 운영 서버의 실제 compose project 라벨에 맞춤.
// `docker --context home-server ps --format '{{.Label "com.docker.compose.project"}}'` 결과 기준.
const HOME_PROJECTS: SeedProject[] = [
  {
    composeProject: "ai-afterschool-ex",
    displayName: "AI 방과후 레거시 DB",
    description: "AI 방과후 레거시 Postgres (포트 5436, localhost)",
    category: "ai",
    url: null,
  },
  {
    composeProject: "ai-afterschool-fsd",
    displayName: "AI 방과후 FSD 웹",
    description: "AI 방과후 FSD 프론트엔드 (포트 3001, localhost)",
    category: "ai",
    url: null,
  },
  {
    composeProject: "cli-proxy-api",
    displayName: "CLI Proxy API",
    description: "Claude/CLI LLM 프록시 (포트 8317, 54545)",
    category: "infra",
    url: `http://${HOME_IP}:8317`,
  },
  {
    composeProject: "docker",
    displayName: "AI 방과후 (운영)",
    description: "AI 방과후 web/worker + collector + whisper. 포트 3300, 3401, 5438, 6385",
    category: "ai",
    url: `http://${HOME_IP}:3300`,
  },
  {
    composeProject: "docker-n8n",
    displayName: "n8n + Code Server",
    description: "n8n 자동화 (5678) + worker/postgres/redis + vscode (8080)",
    category: "infra",
    url: null,
  },
  {
    composeProject: "gons-dashboard",
    displayName: "Gon's Dashboard",
    description: "이 대시보드 자체 (app/cron/postgres/redis). 포트 3020, 5440, 6390",
    category: "infra",
    url: `http://${HOME_IP}:3020`,
  },
  {
    composeProject: "news-sentiment-analyzer2",
    displayName: "뉴스 서비스 (운영) — App",
    description: "뉴스 서비스 운영 app/postgres/redis. 포트 3010, 5433, 6380",
    category: "news",
    url: `http://${HOME_IP}:3010`,
  },
  {
    composeProject: "news-sentiment-prod",
    displayName: "뉴스 서비스 (운영) — API/Worker/Beat",
    description: "뉴스 운영 백엔드 worker/beat/api. 포트 8000",
    category: "news",
    url: `http://${HOME_IP}:8000`,
  },
];

// standalone (compose 라벨 없는) 컨테이너는 projects row가 만들어지지 않음.
// 화면엔 "standalone" 그룹으로만 묶임. (open-webui, krdn-timescaledb 등)

// 개발 서버는 컨테이너 운영이 적음 — 필요 시 추가
const DEV_PROJECTS: SeedProject[] = [];

function assertSeedMatchesWhitelist(): void {
  const seedKeys = new Set(HOME_PROJECTS.map((p) => p.composeProject));
  const whitelistKeys = KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"];
  if (!whitelistKeys) {
    throw new Error(
      `seed-projects: KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"] 정의 없음`,
    );
  }
  const missingInSeed = [...whitelistKeys].filter((k) => !seedKeys.has(k));
  const missingInWhitelist = [...seedKeys].filter((k) => !whitelistKeys.has(k));
  if (missingInSeed.length > 0 || missingInWhitelist.length > 0) {
    throw new Error(
      `seed-projects ↔ KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"] 불일치.\n` +
        `  seed에 없음: ${missingInSeed.join(", ") || "(없음)"}\n` +
        `  whitelist에 없음: ${missingInWhitelist.join(", ") || "(없음)"}\n` +
        `둘 중 하나에만 추가됐을 가능성 — 양쪽 동시 갱신 필요.`,
    );
  }
}

async function getHostId(name: string): Promise<string> {
  const [h] = await db
    .select({ id: hosts.id })
    .from(hosts)
    .where(eq(hosts.name, name))
    .limit(1);
  if (!h) {
    throw new Error(
      `host "${name}" 미등록. \`pnpm db:seed:hosts\`를 먼저 실행하세요.`,
    );
  }
  return h.id;
}

async function upsertOne(hostId: string, p: SeedProject): Promise<void> {
  await db
    .insert(projects)
    .values({
      hostId,
      composeProject: p.composeProject,
      displayName: p.displayName,
      description: p.description,
      category: p.category,
      url: p.url,
    })
    .onConflictDoUpdate({
      target: [projects.hostId, projects.composeProject],
      // displayName은 사용자가 UI/DB에서 편집할 수 있는 값으로 간주 → seed 재실행 시
      // 덮어쓰지 않음. 메타(설명/카테고리/url)만 갱신.
      set: {
        description: sql`excluded.description`,
        category: sql`excluded.category`,
        url: sql`excluded.url`,
        updatedAt: sql`now()`,
      },
    });
  console.log(`✅ ${p.composeProject} (${p.category})`);
}

async function main() {
  assertSeedMatchesWhitelist();
  const homeId = await getHostId("home-server");
  for (const p of HOME_PROJECTS) await upsertOne(homeId, p);

  if (DEV_PROJECTS.length > 0) {
    const devId = await getHostId("krdn-lenovo");
    for (const p of DEV_PROJECTS) await upsertOne(devId, p);
  }

  console.log(
    `\n${HOME_PROJECTS.length + DEV_PROJECTS.length}개 프로젝트 메타 동기화 완료`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed failed:", err);
  process.exit(1);
});
