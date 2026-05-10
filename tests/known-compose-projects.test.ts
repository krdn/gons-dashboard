import { describe, it, expect } from "vitest";
import {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "@/entities/project/config/knownComposeProjects";

describe("KNOWN_COMPOSE_PROJECTS_BY_HOST", () => {
  it("home-server의 라이브 compose project 8개가 모두 포함된다", () => {
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

  it("KNOWN_HOSTS는 BY_HOST 객체의 키 집합과 동일하다", () => {
    expect(Array.from(KNOWN_HOSTS).sort()).toEqual(
      Object.keys(KNOWN_COMPOSE_PROJECTS_BY_HOST).sort(),
    );
  });
});
