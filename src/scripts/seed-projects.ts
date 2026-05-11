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
const DEV_IP = "192.168.0.8";

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

// 개발 환경 (krdn-lenovo, 192.168.0.8) — Supabase dev stack + AI 모델/뉴스 분석 실험.
// `DOCKER_HOST=unix:///var/run/docker.sock docker ps --format '{{.Label "com.docker.compose.project"}}'`
// 결과 기준.
const DEV_PROJECTS: SeedProject[] = [
  {
    composeProject: "ai-afterschool",
    displayName: "AI 방과후 (개발)",
    description: "Supabase 로컬 dev stack (studio 54323, kong 54321, db 54322) + ai-afterschool-postgres 5436",
    category: "ai",
    url: `http://${DEV_IP}:54323`,
  },
  {
    composeProject: "ai-model-setup",
    displayName: "AI 모델 setup DB",
    description: "AI 모델 실험용 dev Postgres (포트 5432)",
    category: "ai",
    url: null,
  },
  {
    composeProject: "ai-news-analyzer",
    displayName: "AI 뉴스 분석기 (실험)",
    description: "뉴스 분석 실험용 Postgres (5437) + Redis (6382)",
    category: "experiment",
    url: null,
  },
];

const SEED_PROJECTS_BY_HOST: Readonly<Record<string, SeedProject[]>> = {
  "home-server": HOME_PROJECTS,
  "krdn-lenovo": DEV_PROJECTS,
};

function assertSeedMatchesWhitelist(): void {
  const errors: string[] = [];
  for (const hostName of Object.keys(KNOWN_COMPOSE_PROJECTS_BY_HOST)) {
    const whitelistKeys = KNOWN_COMPOSE_PROJECTS_BY_HOST[hostName]!;
    const seed = SEED_PROJECTS_BY_HOST[hostName];
    if (!seed) {
      errors.push(
        `seed-projects: SEED_PROJECTS_BY_HOST["${hostName}"] 정의 없음 (whitelist엔 있음)`,
      );
      continue;
    }
    const seedKeys = new Set(seed.map((p) => p.composeProject));
    const missingInSeed = [...whitelistKeys].filter((k) => !seedKeys.has(k));
    const missingInWhitelist = [...seedKeys].filter((k) => !whitelistKeys.has(k));
    if (missingInSeed.length > 0 || missingInWhitelist.length > 0) {
      errors.push(
        `[${hostName}] seed ↔ whitelist 불일치\n` +
          `  seed에 없음: ${missingInSeed.join(", ") || "(없음)"}\n` +
          `  whitelist에 없음: ${missingInWhitelist.join(", ") || "(없음)"}`,
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `seed-projects ↔ KNOWN_COMPOSE_PROJECTS_BY_HOST 정합성 실패. 양쪽 동시 갱신 필요.\n` +
        errors.join("\n"),
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
  let total = 0;
  for (const [hostName, seed] of Object.entries(SEED_PROJECTS_BY_HOST)) {
    if (seed.length === 0) continue;
    const hostId = await getHostId(hostName);
    for (const p of seed) await upsertOne(hostId, p);
    total += seed.length;
  }
  console.log(`\n${total}개 프로젝트 메타 동기화 완료`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed failed:", err);
  process.exit(1);
});
