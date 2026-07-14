// catalog-refresh feature — server-only entrypoint.
// 기존 pnpm <kind>:snapshot 을 child_process 로 실행한다.
// 스냅샷 스크립트를 직접 import 하지 않는 이유:
//   1) snapshot-*.ts 는 import.meta.url 기준으로 출력 경로를 잡는다 —
//      번들로 끌어오면 경로가 깨진다.
//   2) --conditions=react-server + server-only 엔티티를 끌어와, Server Action
//      모듈 그래프에 직접 넣으면 Gotcha #7 번들 경계 사고가 난다.
// subprocess 격리가 둘 다 원천 차단하고 이미 작동하는 호출을 재사용한다.
import "server-only";

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CatalogKind, RefreshResult } from "./model/types";
import { parseSnapshotCount } from "./lib/parseSnapshotCount";

export type { CatalogKind, RefreshResult } from "./model/types";

/** kind → package.json script 명. */
const SNAPSHOT_SCRIPTS: Record<CatalogKind, string> = {
  skills: "skills:snapshot",
  plugins: "plugins:snapshot",
  agents: "agents:snapshot",
};

/** kind → public/ body 디렉토리 (경고 문구용). */
const BODY_DIRS: Record<CatalogKind, string> = {
  skills: "public/skill-catalog/",
  plugins: "public/plugin-catalog/",
  agents: "public/agent-catalog/",
};

/** 이 파일 기준으로 apps/dashboard 디렉토리 절대경로를 계산. */
function dashboardDir(): string {
  // .../apps/dashboard/src/features/catalog-refresh/index.ts
  const here = dirname(fileURLToPath(import.meta.url));
  // catalog-refresh → features → src → dashboard
  return join(here, "..", "..", "..");
}

/**
 * 기존 pnpm <kind>:snapshot 을 실행해 카탈로그를 재생성한다.
 * dev 전용 — 운영에서는 소스 ~/.claude 가 없어 거부한다.
 */
export function spawnSnapshot(kind: CatalogKind): Promise<RefreshResult> {
  if (process.env.NODE_ENV === "production") {
    return Promise.resolve({
      ok: false,
      error: "운영 환경에서는 카탈로그 재생성이 지원되지 않습니다.",
    });
  }

  const script = SNAPSHOT_SCRIPTS[kind];
  const cwd = dashboardDir();

  return new Promise<RefreshResult>((resolve) => {
    const child = spawn("pnpm", [script], { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: `스냅샷 실행 실패: ${err.message}` });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `스냅샷이 실패했습니다 (exit ${code}). ${stderr.trim().slice(0, 500)}`,
        });
        return;
      }
      const count = parseSnapshotCount(stdout);
      resolve({
        ok: true,
        count,
        warning: `이 카탈로그는 현재 머신의 ~/.claude 기준으로 재생성됐습니다. catalog.json 과 ${BODY_DIRS[kind]} body 파일을 덮어썼습니다. 커밋 전 git diff 로 확인하세요.`,
      });
    });
  });
}
