import { describe, it, expect } from "vitest";
import {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "@/entities/project/config/knownComposeProjects";

// KNOWN_COMPOSE_PROJECTS_BY_HOST 는 화이트리스트 게이트가 아니라
// 메타 시드 / cleanup keep-set 용 "pinned hint" 다. (knownComposeProjects.ts 헤더 참조)
describe("KNOWN_COMPOSE_PROJECTS_BY_HOST (pinned hint)", () => {
  it("home-server의 핀된 compose project 8개가 모두 포함된다", () => {
    const set = KNOWN_COMPOSE_PROJECTS_BY_HOST["home-server"];
    expect(set).toBeDefined();
    expect(Array.from(set!).sort()).toEqual([
      "ai-afterschool-ex",
      "ai-afterschool-fsd",
      "cli-proxy-api",
      "docker",
      "docker-n8n",
      "gons-dashboard",
      "news-sentiment-analyzer2",
      "news-sentiment-prod",
    ]);
  });

  it("krdn-lenovo의 핀된 compose project 3개가 모두 포함된다", () => {
    const set = KNOWN_COMPOSE_PROJECTS_BY_HOST["krdn-lenovo"];
    expect(set).toBeDefined();
    expect(Array.from(set!).sort()).toEqual([
      "ai-afterschool",
      "ai-model-setup",
      "ai-news-analyzer",
    ]);
  });

  it("KNOWN_HOSTS는 BY_HOST 객체의 키 집합과 동일하다", () => {
    expect(Array.from(KNOWN_HOSTS).sort()).toEqual(
      Object.keys(KNOWN_COMPOSE_PROJECTS_BY_HOST).sort(),
    );
  });
});
