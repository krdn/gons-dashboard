// 테스트 격리: vitest는 파일을 병렬 실행하므로, hosts 테이블을 다른 테스트
// 파일(project-api 등)과 공유한다. 충돌 회피를 위해 per-run sentinel 프리픽스를
// 사용하고, beforeEach 삭제·assert filter 모두 프리픽스로 스코프한다.
import { describe, it, expect, beforeEach } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { getHosts } from "@/entities/host/api/getHosts";
import { getHostByName } from "@/entities/host/api/getHostByName";

const PREFIX = `host-api-${Date.now()}-`;

describe("host api", () => {
  beforeEach(async () => {
    await db.delete(hosts).where(like(hosts.name, `${PREFIX}%`));
  });

  it("getHosts: isActive만 반환, 이름 오름차순", async () => {
    await db.insert(hosts).values([
      { name: `${PREFIX}z-host`, dockerContext: "z", isActive: true },
      { name: `${PREFIX}a-host`, dockerContext: "a", isActive: true },
      { name: `${PREFIX}inactive`, dockerContext: "i", isActive: false },
    ]);
    const all = await getHosts();
    const names = all
      .map((h) => h.name)
      .filter((n) => n.startsWith(PREFIX));
    expect(names).toEqual([`${PREFIX}a-host`, `${PREFIX}z-host`]);
  });

  it("getHostByName: 일치하는 호스트 반환", async () => {
    const name = `${PREFIX}home-server`;
    await db.insert(hosts).values({
      name,
      dockerContext: "home-server",
      description: "192.168.0.5",
    });
    const h = await getHostByName(name);
    expect(h).not.toBeNull();
    expect(h!.dockerContext).toBe("home-server");
  });

  it("getHostByName: 없으면 null", async () => {
    const h = await getHostByName(`${PREFIX}nope`);
    expect(h).toBeNull();
  });
});
