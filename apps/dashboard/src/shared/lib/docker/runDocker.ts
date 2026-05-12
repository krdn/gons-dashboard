// docker CLI을 execFile로 호출 (shell 보간 절대 금지).
// SSH 트랜스포트와 인증은 docker CLI의 --context가 처리.
import "server-only";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@/shared/config/env";

const runExecFile = promisify(execFileCb);

export type RunDockerOpts = {
  timeoutMs?: number;
};

export async function runDocker(
  context: string,
  args: string[],
  opts: RunDockerOpts = {},
): Promise<string> {
  const timeout = opts.timeoutMs ?? env.DOCKER_CMD_TIMEOUT_MS;
  const { stdout } = await runExecFile(
    "docker",
    ["--context", context, ...args],
    {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return stdout;
}
