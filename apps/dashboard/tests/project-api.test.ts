// 테스트 격리: vitest 파일 병렬 실행 시 hosts/projects 테이블이 host-api 등과
// 공유된다. per-run sentinel 호스트 1개 + 그 hostId scope로만 데이터 정리한다.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts, projects } from "@/shared/lib/db/schema";
import { getProjects } from "@/entities/project/api/getProjects";
import { upsertProjectFromContainer } from "@/entities/project/api/upsertProjectFromContainer";

const PREFIX = `project-api-${Date.now()}-`;
const HOST_NAME = `${PREFIX}home-server`;
let hostId: string;

beforeEach(async () => {
  // 먼저 이 테스트가 만든 host의 자식 projects 정리, 그 뒤 host 삭제·재생성.
  // (다른 테스트의 host/projects는 건드리지 않는다.)
  if (hostId) {
    await db.delete(projects).where(eq(projects.hostId, hostId));
    await db.delete(hosts).where(eq(hosts.id, hostId));
  }
  const [h] = await db
    .insert(hosts)
    .values({ name: HOST_NAME, dockerContext: "home-server" })
    .returning({ id: hosts.id });
  hostId = h.id;
});

afterAll(async () => {
  if (hostId) {
    await db.delete(projects).where(eq(projects.hostId, hostId));
    await db.delete(hosts).where(eq(hosts.id, hostId));
  }
});

describe("project api", () => {
  it("getProjects: hidden 제외, pinned 우선, 알파벳 정렬", async () => {
    await db.insert(projects).values([
      { hostId, composeProject: "z-app", displayName: "Z App" },
      { hostId, composeProject: "a-app", displayName: "A App" },
      { hostId, composeProject: "pinned", displayName: "Pinned", isPinned: true },
      { hostId, composeProject: "hidden", displayName: "Hidden", isHidden: true },
    ]);
    const list = await getProjects(hostId);
    expect(list.map((p) => p.composeProject)).toEqual(["pinned", "a-app", "z-app"]);
  });

  it("upsertProjectFromContainer: 처음 보는 compose → 신규 자동 등록", async () => {
    const p = await upsertProjectFromContainer({
      hostId,
      hostName: "home-server",
      composeProject: "gons-dashboard",
    });
    expect(p).not.toBeNull();
    expect(p?.displayName).toBe("gons-dashboard");
    expect(p?.hostId).toBe(hostId);
  });

  it("upsertProjectFromContainer: hint 외 compose (옛 화이트리스트 밖) 도 자동 등록된다", async () => {
    const p = await upsertProjectFromContainer({
      hostId,
      hostName: "home-server",
      composeProject: "brand-new-stack",
    });
    expect(p).not.toBeNull();
    expect(p?.composeProject).toBe("brand-new-stack");
    expect(p?.displayName).toBe("brand-new-stack");
  });

  it("upsertProjectFromContainer: 기존은 updatedAt만 갱신, displayName 보존", async () => {
    await db.insert(projects).values({
      hostId,
      composeProject: "gons-dashboard",
      displayName: "고스 대시보드 (운영)",
    });
    const p = await upsertProjectFromContainer({
      hostId,
      hostName: "home-server",
      composeProject: "gons-dashboard",
    });
    expect(p).not.toBeNull();
    expect(p?.displayName).toBe("고스 대시보드 (운영)");
  });
});
