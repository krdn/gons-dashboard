// 등록된 host별로 운영 중인 docker compose project 화이트리스트.
// seed-projects.ts와 upsertProjectFromContainer가 이 단일 소스를 공유한다.
//
// 새 compose project를 추가하려면:
//   1) 이 파일 KNOWN_COMPOSE_PROJECTS_BY_HOST에 키 추가
//   2) seed-projects.ts의 HOME_PROJECTS에 displayName/description/url/category 추가
//   3) `pnpm db:seed:projects` 재실행
export const KNOWN_COMPOSE_PROJECTS_BY_HOST: Record<
  string,
  ReadonlySet<string>
> = {
  "home-server": new Set([
    "ai-afterschool-ex",
    "ai-afterschool-fsd",
    "cli-proxy-api",
    "docker",
    "docker-n8n",
    "gons-dashboard",
    "news-sentiment-analyzer2",
    "news-sentiment-prod",
  ]),
};

export const KNOWN_HOSTS: ReadonlySet<string> = new Set(
  Object.keys(KNOWN_COMPOSE_PROJECTS_BY_HOST),
);
