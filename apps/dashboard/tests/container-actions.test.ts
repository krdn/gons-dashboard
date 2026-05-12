// Task 14 통합 테스트 — Server Actions (restart/start/stop)
// 보안 boundary 5종 검증:
//   1) Authentication (auth() → null → UNAUTHORIZED)
//   2) Authorization (ADMIN_EMAILS 미포함 → FORBIDDEN)
//   3) Input validation (containerId 정규식 위반 → INVALID_INPUT, path traversal 방어)
//   4) Host validation (hostId DB 미존재 → HOST_NOT_FOUND)
//   5) Audit log (success/failed 양 경로 기록)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { hosts, auditLogs } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";

const mockAuth = vi.fn();
vi.mock("@/shared/lib/auth", () => ({
  auth: () => mockAuth(),
}));

const mockRunDocker = vi.fn();
vi.mock("@/shared/lib/docker", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/docker")>(
    "@/shared/lib/docker",
  );
  return { ...actual, runDocker: (...a: unknown[]) => mockRunDocker(...a) };
});

// CI/.env에 placeholder ADMIN_EMAILS가 들어있어도 테스트는 krdn.net@gmail.com을
// admin으로 기대한다. env 모듈은 부팅 시 freeze이므로 직접 mock.
vi.mock("@/shared/config/env", async () => {
  const actual =
    await vi.importActual<typeof import("@/shared/config/env")>(
      "@/shared/config/env",
    );
  return { ...actual, env: { ...actual.env, ADMIN_EMAILS: "krdn.net@gmail.com" } };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const VALID_ID = "a".repeat(64);

let hostId: string;
const HOST_PREFIX = `t14-${Date.now()}`; // test isolation prefix
const HOST_NAME = `${HOST_PREFIX}-home-server`;

beforeEach(async () => {
  // 격리(cross-file race 방지):
  //  - 모든 정리는 HOST_NAME 스코프로만 수행 (다른 테스트 host 보호).
  //  - audit_logs.host_id FK는 ON DELETE no action → host 삭제 전에 child row 정리 필요.
  //  - HOST_NAME은 module load 시점에 한 번 결정되어 within-file 6개 테스트가 공유 → prior host 정리 필수.
  const [prior] = await db
    .select({ id: hosts.id })
    .from(hosts)
    .where(eq(hosts.name, HOST_NAME))
    .limit(1);
  if (prior) {
    await db.delete(auditLogs).where(eq(auditLogs.hostId, prior.id));
    await db.delete(hosts).where(eq(hosts.id, prior.id));
  }

  const [h] = await db
    .insert(hosts)
    .values({ name: HOST_NAME, dockerContext: "home-server" })
    .returning({ id: hosts.id });
  hostId = h.id;
  mockAuth.mockReset();
  mockRunDocker.mockReset();
  // ADMIN_EMAILS는 .env에서 부팅 시점에 env 모듈로 freeze (process.env 직접 변경은 무의미).
  // .env에 krdn.net@gmail.com이 admin으로 설정되어 있는 가정 위에서 테스트.
});

async function loadAction(name: "restart" | "start" | "stop") {
  const mod = await import(
    `@/features/container-actions/api/${name}Container`
  );
  return (mod as Record<string, (i: unknown) => Promise<unknown>>)[
    `${name}Container`
  ];
}

describe("container-actions", () => {
  it("admin이 restart 호출 → docker CLI 호출 + audit success 기록", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    mockRunDocker.mockResolvedValue("");
    const restart = await loadAction("restart");

    const result = await restart({
      hostId,
      containerId: VALID_ID,
      containerName: "news-api",
    });

    expect(result).toMatchObject({ ok: true });
    expect(mockRunDocker).toHaveBeenCalledWith("home-server", [
      "restart",
      VALID_ID,
    ]);
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.hostId, hostId));
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("restart");
    expect(logs[0].status).toBe("success");
  });

  it("비admin은 거부 + audit 기록 없음", async () => {
    mockAuth.mockResolvedValue({ user: { email: "intruder@example.com" } });
    const restart = await loadAction("restart");

    const result = await restart({
      hostId,
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(mockRunDocker).not.toHaveBeenCalled();
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.hostId, hostId));
    expect(logs).toHaveLength(0);
  });

  it("docker 실패 시 status=failed 기록 + ok:false", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    mockRunDocker.mockRejectedValue(new Error("docker daemon down"));
    const stop = await loadAction("stop");
    const result = await stop({
      hostId,
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "DOCKER_ERROR" });
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.hostId, hostId));
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("failed");
    expect(logs[0].errorMessage).toContain("docker daemon down");
  });

  it("invalid containerId (non-hex) → ok:false, docker 호출 없음", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    const restart = await loadAction("restart");
    const result = await restart({
      hostId,
      containerId: "../../../etc/passwd",
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(mockRunDocker).not.toHaveBeenCalled();
  });

  it("unknown hostId → ok:false", async () => {
    mockAuth.mockResolvedValue({ user: { email: "krdn.net@gmail.com" } });
    const start = await loadAction("start");
    const result = await start({
      hostId: "00000000-0000-0000-0000-000000000000",
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "HOST_NOT_FOUND" });
  });

  it("세션 없으면 ok:false UNAUTHORIZED", async () => {
    mockAuth.mockResolvedValue(null);
    const restart = await loadAction("restart");
    const result = await restart({
      hostId,
      containerId: VALID_ID,
      containerName: "x",
    });
    expect(result).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});
