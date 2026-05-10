import { describe, it, expect, vi, beforeEach } from "vitest";
import { promisify } from "node:util";

// execFile mock — 인자 캡처 + util.promisify.custom로 실제 Node 동작 모사.
// (실제 cp.execFile은 [util.promisify.custom]을 노출하여 promisify 시 {stdout, stderr}로 resolve된다.
//  이 심볼이 없으면 promisify는 콜백의 단일 값(stdout 문자열)으로만 resolve하므로 destructure가 undefined가 된다.)
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => {
  const execFile = Object.assign(
    (
      file: string,
      args: string[],
      opts: object,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      mockExecFile(file, args, opts);
      cb(null, "ok\n", "");
    },
    {
      [promisify.custom]: (file: string, args: string[], opts: object) => {
        mockExecFile(file, args, opts);
        return Promise.resolve({ stdout: "ok\n", stderr: "" });
      },
    },
  );
  return { execFile };
});

// 동적 import로 mock 적용 후 모듈 로드
let runDocker: typeof import("../src/shared/lib/docker/runDocker").runDocker;

beforeEach(async () => {
  mockExecFile.mockClear();
  ({ runDocker } = await import("../src/shared/lib/docker/runDocker"));
});

describe("runDocker", () => {
  it("docker CLI을 정확한 context와 args로 호출한다", async () => {
    const out = await runDocker("home-server", ["container", "ls"]);
    expect(out).toBe("ok\n");
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      ["--context", "home-server", "container", "ls"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("기본 timeout은 10초 (env 미설정 시)", async () => {
    delete process.env.DOCKER_CMD_TIMEOUT_MS;
    await runDocker("home-server", ["version"]);
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it("opts.timeoutMs가 우선한다", async () => {
    await runDocker("home-server", ["version"], { timeoutMs: 3_000 });
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.objectContaining({ timeout: 3_000 }),
    );
  });
});
