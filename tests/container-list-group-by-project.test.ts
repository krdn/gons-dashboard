import { describe, it, expect } from "vitest";
import { groupByProject } from "@/features/container-list/lib/groupByProject";
import type { ContainerSummary } from "@/entities/container";
import type { Project } from "@/entities/project";

const HOST_ID = "h1";
const NOW = new Date("2026-05-10T00:00:00Z");

function c(overrides: Partial<ContainerSummary>): ContainerSummary {
  return {
    id: "id",
    name: "name",
    hostId: HOST_ID,
    composeProject: null,
    composeService: null,
    state: "running",
    statusText: "Up 1 day",
    uptimeSeconds: 86_400,
    image: "img",
    ports: [],
    createdAt: "",
    ...overrides,
  };
}

function p(overrides: Partial<Project>): Project {
  return {
    id: "p",
    hostId: HOST_ID,
    composeProject: "x",
    displayName: "x",
    description: null,
    category: null,
    isPinned: false,
    isHidden: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("groupByProject", () => {
  it("compose 라벨로 그룹화 + project 메타 join", () => {
    const containers = [
      c({ id: "1", name: "news-api", composeProject: "news-prod" }),
      c({ id: "2", name: "news-app", composeProject: "news-prod" }),
      c({ id: "3", name: "voice-api", composeProject: "voice", state: "exited" }),
    ];
    const projects = [
      p({ id: "p1", composeProject: "news-prod", displayName: "뉴스" }),
      p({ id: "p2", composeProject: "voice", displayName: "음성" }),
    ];
    const groups = groupByProject(containers, projects);
    expect(groups).toHaveLength(2);
    const news = groups.find((g) => g.composeProject === "news-prod")!;
    expect(news.displayName).toBe("뉴스");
    expect(news.containers).toHaveLength(2);
    expect(news.runningCount).toBe(2);
    expect(news.warningCount).toBe(0);

    const voice = groups.find((g) => g.composeProject === "voice")!;
    expect(voice.warningCount).toBe(1);
  });

  it("라벨 없는 컨테이너는 standalone 가상 그룹", () => {
    const groups = groupByProject(
      [c({ id: "1", name: "open-webui", composeProject: null })],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].composeProject).toBe("standalone");
    expect(groups[0].isStandalone).toBe(true);
  });

  it("hidden project는 그룹 누락", () => {
    const containers = [
      c({ id: "1", composeProject: "noisy" }),
      c({ id: "2", composeProject: "news-prod" }),
    ];
    const projects = [
      p({ composeProject: "noisy", isHidden: true }),
      p({ composeProject: "news-prod" }),
    ];
    const groups = groupByProject(containers, projects);
    expect(groups.map((g) => g.composeProject)).toEqual(["news-prod"]);
  });

  it("pinned 우선, 그 다음 알파벳 순, standalone은 마지막", () => {
    const containers = [
      c({ id: "1", composeProject: "z-proj" }),
      c({ id: "2", composeProject: "a-proj" }),
      c({ id: "3", composeProject: "pinned" }),
      c({ id: "4", composeProject: null }),
    ];
    const projects = [
      p({ composeProject: "z-proj" }),
      p({ composeProject: "a-proj" }),
      p({ composeProject: "pinned", isPinned: true }),
    ];
    const groups = groupByProject(containers, projects);
    expect(groups.map((g) => g.composeProject)).toEqual([
      "pinned",
      "a-proj",
      "z-proj",
      "standalone",
    ]);
  });
});
