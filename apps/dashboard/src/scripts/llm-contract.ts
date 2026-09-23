// 운영 데이터/DB를 읽지 않고 합성 프롬프트만 보낸다. 통지는 호출한 운영 스크립트의 책임.
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkLlmContract } from "../shared/lib/llm/consumer-contract";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const { resolveLatestModel } =
    await import("../shared/lib/llm/resolve-latest-model");
  const { gatewayDefaults, HAIKU_MODEL } =
    await import("../shared/lib/llm/anthropic");
  let dir = dirname(require.resolve("@krdn/llm-gateway/gateway"));
  let version = "unknown";
  while (dirname(dir) !== dir) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === "@krdn/llm-gateway") {
        version = pkg.version;
        break;
      }
    } catch {
      /* 패키지 루트까지 올라간다 */
    }
    dir = dirname(dir);
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const source = {
    revision: git("rev-parse", "HEAD"),
    dirty: Boolean(git("status", "--porcelain")),
    gateway: version,
  };
  const checks = await checkLlmContract(
    resolveLatestModel,
    gatewayDefaults,
    HAIKU_MODEL,
  );
  console.log(JSON.stringify({ source, checks }));
}

main().catch(() => {
  // env 검증 실패에도 값이나 원본 오류를 로그에 남기지 않는다.
  console.error("소비자 계약 실행 실패 — 앱 환경설정·의존성 확인 필요");
  process.exitCode = 1;
});
