import { describe, it, expect } from "vitest";
import {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "@/entities/project/config/knownComposeProjects";
import { isKnownComposeProject } from "@/entities/project";

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

  it("krdn-lenovo의 라이브 compose project 3개가 모두 포함된다", () => {
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

describe("isKnownComposeProject", () => {
  it("화이트리스트에 있는 (host, compose) → true", () => {
    expect(isKnownComposeProject("home-server", "gons-dashboard")).toBe(true);
    expect(isKnownComposeProject("home-server", "docker-n8n")).toBe(true);
    expect(isKnownComposeProject("krdn-lenovo", "ai-afterschool")).toBe(true);
    expect(isKnownComposeProject("krdn-lenovo", "ai-news-analyzer")).toBe(true);
  });

  it("화이트리스트 외 compose → false", () => {
    expect(isKnownComposeProject("home-server", "n8n")).toBe(false);
    expect(isKnownComposeProject("home-server", "web")).toBe(false);
    expect(isKnownComposeProject("home-server", "ais-prod")).toBe(false);
    // krdn-lenovo에 등록되지 않은 compose (다른 host의 키도 cross-host로 인정되지 않음)
    expect(isKnownComposeProject("krdn-lenovo", "gons-dashboard")).toBe(false);
    expect(isKnownComposeProject("krdn-lenovo", "ai-health")).toBe(false);
    expect(isKnownComposeProject("krdn-lenovo", "web")).toBe(false);
  });

  it("등록되지 않은 host → false (보수적)", () => {
    expect(isKnownComposeProject("unknown-host", "gons-dashboard")).toBe(false);
  });
});
