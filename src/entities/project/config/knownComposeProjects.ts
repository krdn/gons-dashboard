// 등록된 host별 compose project "메타 hint" 목록.
//
// ⚠️ 이 목록은 더 이상 화이트리스트가 아니다.
//   - 운영에 새 compose project가 뜨면 upsertProjectFromContainer가
//     이 목록과 무관하게 즉시 DB에 등록한다.
//   - 이 파일의 역할은 두 가지로 좁혀졌다:
//     1) seed-projects.ts 가 한글 displayName/description/url/category 같은
//        풍부한 메타를 채울 대상 키를 알려주는 단일 소스
//     2) cleanup-projects.ts 가 "수동으로 핀(고정)했으니 live 가 아니어도
//        DB 에서 지우지 말 것" 으로 보호하는 keep-set
//
// 이 파일에 키를 추가하지 않아도 컨테이너 표시는 자동으로 됩니다.
// 한글 이름이나 분류, 외부 URL 을 부여하고 싶을 때만 갱신하세요.
export const KNOWN_COMPOSE_PROJECTS_BY_HOST: Readonly<
  Record<string, ReadonlySet<string>>
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
  "krdn-lenovo": new Set([
    "ai-afterschool",
    "ai-model-setup",
    "ai-news-analyzer",
  ]),
};

export const KNOWN_HOSTS: ReadonlySet<string> = new Set(
  Object.keys(KNOWN_COMPOSE_PROJECTS_BY_HOST),
);
