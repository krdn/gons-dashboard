import { describe, it, expect } from "vitest";
import { computeZombieIds } from "@/scripts/cleanup-projects.lib";

describe("computeZombieIds", () => {
  const dbRows = [
    { id: "1", composeProject: "gons-dashboard" },
    { id: "2", composeProject: "docker" },
    { id: "3", composeProject: "ghost" },
    { id: "4", composeProject: "another-zombie" },
    { id: "5", composeProject: "ais-prod" },
  ];

  it("live + whitelist 합집합 외의 row id를 반환", () => {
    const live = new Set(["gons-dashboard", "docker"]);
    const whitelist = new Set(["gons-dashboard", "docker", "cli-proxy-api"]);
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies.sort()).toEqual(["3", "4", "5"]);
  });

  it("live만 있고 whitelist 비어있으면 live 외 전부 좀비", () => {
    const live = new Set(["gons-dashboard"]);
    const whitelist = new Set<string>();
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies.sort()).toEqual(["2", "3", "4", "5"]);
  });

  it("whitelist만 있고 live 비어있어도 whitelist는 보존", () => {
    const live = new Set<string>();
    const whitelist = new Set(["gons-dashboard", "docker"]);
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies.sort()).toEqual(["3", "4", "5"]);
  });

  it("좀비 없으면 빈 배열", () => {
    const live = new Set([
      "gons-dashboard",
      "docker",
      "ghost",
      "another-zombie",
      "ais-prod",
    ]);
    const whitelist = new Set<string>();
    const zombies = computeZombieIds(dbRows, live, whitelist);
    expect(zombies).toEqual([]);
  });
});
