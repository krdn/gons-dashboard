// apps/cron/autopilot/deploy-watcher.js
// cron 컨테이너 안에서 도는 무인 배포 컨트롤러.
// ghcr 의 새 :sha- 태그 감지 → APP_IMAGE_TAG 핀 배포 → health 게이트 → 실패 시 이전 sha 롤백.
//
// 왜 cron 인가: app 을 재배포하면 self-kill. orchestrator 는 그 바깥(cron)에 있어야 한다.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { parseHealthBody, shouldDeploy, buildDeployArgs } from "./lib.js";

const execFileAsync = promisify(execFile);

const COMPOSE_PATH =
  process.env.AUTOPILOT_COMPOSE_PATH ?? "/home/gon/projects/gon/gons-dashboard/docker-compose.yml";
const ENV_PATH = process.env.AUTOPILOT_ENV_PATH ?? "/home/gon/projects/gon/gons-dashboard/.env";
const APP_URL = process.env.APP_URL ?? "http://app:3020";
const DOCKER_CONTEXT = process.env.AUTOPILOT_DOCKER_CONTEXT ?? "default";
const TARGET_FILE = process.env.AUTOPILOT_TARGET_FILE ?? "/signal/.autopilot-target";
const ROLLEDBACK_FILE = process.env.AUTOPILOT_ROLLEDBACK_FILE ?? "/signal/.autopilot-rolledback";
const HEALTH_TIMEOUT_MS = 90_000;
const HEALTH_POLL_MS = 5_000;

// 동시 실행 락 (단일 node 프로세스 — 5분 폴링이 최악 9분 경로와 겹치는 것 방지).
let inFlight = false;

async function docker(dockerArgs) {
  const { stdout } = await execFileAsync("docker", ["--context", DOCKER_CONTEXT, ...dockerArgs], {
    timeout: 120_000,
  });
  return stdout.trim();
}

/** 현재 떠있는 app 컨테이너가 어떤 sha 태그로 떴는지. */
async function getRunningSha() {
  // 컨테이너 미존재(첫 배포)면 null, docker 자체 장애면 throw 해서 배포 중단.
  let ref;
  try {
    ref = await docker(["inspect", "--format", "{{.Config.Image}}", "gons-dashboard-app"]);
  } catch (e) {
    const msg = String(e?.stderr ?? e?.message ?? "");
    if (/No such object|no such container/i.test(msg)) return null; // 컨테이너 미존재 = 첫 배포
    throw new Error(`docker inspect 실패 (배포 중단): ${msg}`); // docker 장애 — 배포하면 안 됨
  }
  const m = ref.match(/:(sha-[0-9a-f]+)/);
  return m ? m[1] : null;
}

/** GHA 가 머지 시 기록한 최신 sha 신호 파일을 읽는다 (registry 인증·digest 매핑 회피). */
async function getLatestSha() {
  try {
    const target = (await readFile(TARGET_FILE, "utf8")).trim();
    return target || null;
  } catch {
    return null;
  }
}

/** 롤백 처리한 sha 의 단일 소스 — cron 재시작에도 살아남아 재배포 루프를 막는다. */
async function getRolledBackSha() {
  try {
    const v = (await readFile(ROLLEDBACK_FILE, "utf8")).trim();
    return v || null;
  } catch {
    return null;
  }
}

async function setRolledBackSha(sha) {
  try {
    await writeFile(ROLLEDBACK_FILE, sha ?? "", "utf8");
  } catch (e) {
    console.error("[autopilot] rolledBack 기록 실패", e);
  }
}

async function checkHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      const body = await res.text();
      if (res.ok && parseHealthBody(body)) {
        // 핵심 라우트 smoke
        const login = await fetch(`${APP_URL}/login`);
        const cronRoute = await fetch(`${APP_URL}/api/cron/poll-gmail`, { method: "POST" });
        if (login.status === 200 && cronRoute.status === 401) return true;
      }
    } catch {
      // 아직 안 떴음 — 재시도
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

async function deployTag(sha) {
  const cmdArgs = buildDeployArgs(COMPOSE_PATH, ENV_PATH);
  await execFileAsync("docker", ["--context", DOCKER_CONTEXT, ...cmdArgs], {
    timeout: 180_000,
    env: { ...process.env, APP_IMAGE_TAG: sha },
  });
}

async function notify(title, message) {
  try {
    await fetch(`${APP_URL}/api/cron/autopilot-notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, message }),
    });
  } catch (e) {
    console.error("[autopilot] notify 실패", e);
  }
}

export async function runDeployCycle() {
  if (inFlight) {
    console.log("[autopilot] 이전 배포 사이클 진행 중 — 스킵");
    return;
  }
  inFlight = true;
  try {
    let runningSha;
    try {
      runningSha = await getRunningSha();
    } catch (e) {
      console.error("[autopilot] docker 상태 확인 실패 — 이번 사이클 배포 건너뜀", e);
      return;
    }
    const latestSha = await getLatestSha();
    const rolledBackSha = await getRolledBackSha();

    if (!shouldDeploy(latestSha, runningSha, rolledBackSha)) {
      console.log(
        `[autopilot] 배포 불필요 (latest=${latestSha} running=${runningSha} rolledBack=${rolledBackSha})`,
      );
      return;
    }

    console.log(`[autopilot] 새 이미지 ${latestSha} 감지 — 배포 시작 (현재 ${runningSha})`);
    const goodSha = runningSha; // 롤백 대상 = 직전 정상 sha

    try {
      await deployTag(latestSha);
      const healthy = await checkHealth();
      if (healthy) {
        await setRolledBackSha(null);
        console.log(`[autopilot] 배포 성공 ${latestSha}`);
        await notify("autopilot 배포 성공", `${latestSha} 배포 완료 (health OK)`);
        return;
      }
      throw new Error("health gate failed");
    } catch (err) {
      console.error(`[autopilot] 배포 실패 — 롤백 시도`, err);
      await setRolledBackSha(latestSha); // 이 sha 는 다음 폴링에서 재배포 차단
      if (goodSha) {
        try {
          await deployTag(goodSha);
          const ok = await checkHealth();
          await notify(
            "autopilot 배포 실패 → 롤백",
            `${latestSha} health 실패. ${goodSha} 로 롤백 ${ok ? "성공" : "했으나 health 미확인"}.`,
          );
        } catch (rbErr) {
          await notify("autopilot 롤백 실패", `${latestSha} 실패 후 ${goodSha} 롤백도 실패. 수동 개입 필요.`);
          console.error("[autopilot] 롤백 실패", rbErr);
        }
      } else {
        await notify("autopilot 배포 실패", `${latestSha} health 실패. 이전 sha 미상 — 수동 개입 필요.`);
      }
    }
  } finally {
    inFlight = false;
  }
}
