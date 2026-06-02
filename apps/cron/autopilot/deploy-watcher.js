// apps/cron/autopilot/deploy-watcher.js
// cron 컨테이너 안에서 도는 무인 배포 컨트롤러.
// ghcr :latest digest 감지 → 그 digest 를 @sha256: 핀으로 직접 배포 → health 게이트 → 실패 시 롤백.
//
// 왜 cron 인가: app 을 재배포하면 self-kill. orchestrator 는 그 바깥(cron)에 있어야 한다.
// 왜 digest 인가: GHA(클라우드)는 사설 LAN 에 못 닿아 신호 파일을 채울 수 없다 →
//   온프렘이 ghcr 를 직접 pull(polling). running 의 RepoDigests 는 항상 존재하므로
//   sha 정규식의 부트스트랩 갭(첫 배포 앵커 null)이 사라진다.
//   배포·롤백은 digest 직접 핀 (compose 의 image: ${APP_IMAGE_REF} 에 @sha256: 주입) —
//   sha 태그 역조회가 불필요하고 롤백이 결정적이다.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import {
  parseHealthBody,
  shouldDeploy,
  buildDeployArgs,
  parseRunningDigest,
  buildImageRef,
  upsertEnvKey,
  envKeysPreserved,
} from "./lib.js";

const execFileAsync = promisify(execFile);

const COMPOSE_PATH =
  process.env.AUTOPILOT_COMPOSE_PATH ?? "/home/gon/projects/gon/gons-dashboard/docker-compose.yml";
const ENV_PATH = process.env.AUTOPILOT_ENV_PATH ?? "/home/gon/projects/gon/gons-dashboard/.env";
const APP_URL = process.env.APP_URL ?? "http://app:3020";
const DOCKER_CONTEXT = process.env.AUTOPILOT_DOCKER_CONTEXT ?? "default";
const ROLLEDBACK_FILE = process.env.AUTOPILOT_ROLLEDBACK_FILE ?? "/signal/.autopilot-rolledback";
// ghcr 이미지 레포 (digest 폴링 대상). app 컨테이너 이미지와 동일해야 한다.
const IMAGE_REPO = process.env.AUTOPILOT_IMAGE_REPO ?? "ghcr.io/krdn/gons-dashboard";
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

/**
 * 현재 떠있는 app 컨테이너의 이미지 digest. running 이 :latest 든 :sha- 든 항상 존재.
 * 2단계: 컨테이너의 .Image(이미지 ID) → 그 이미지의 RepoDigests(manifest digest).
 * RepoDigests 는 컨테이너 객체엔 없고 이미지 객체에만 있으므로 image inspect 가 필요하다.
 */
async function getRunningDigest() {
  // 컨테이너 미존재(첫 배포)면 null, docker 자체 장애면 throw 해서 배포 중단.
  let imageId;
  try {
    imageId = await docker(["inspect", "--format", "{{.Image}}", "gons-dashboard-app"]);
  } catch (e) {
    const msg = String(e?.stderr ?? e?.message ?? "");
    if (/No such object|no such container/i.test(msg)) return null; // 컨테이너 미존재 = 첫 배포
    throw new Error(`docker inspect 실패 (배포 중단): ${msg}`); // docker 장애 — 배포하면 안 됨
  }
  let repoDigest;
  try {
    repoDigest = await docker([
      "image",
      "inspect",
      "--format",
      "{{index .RepoDigests 0}}",
      imageId,
    ]);
  } catch {
    return null; // RepoDigests 비어있음(로컬 빌드 등) — 배포 판단 보류 (감지 불가)
  }
  return parseRunningDigest(repoDigest);
}

/** ghcr 토큰 발급 (public package — 익명 pull-scope 토큰). */
async function getGhcrToken() {
  const repoPath = IMAGE_REPO.replace(/^ghcr\.io\//, "");
  const res = await fetch(`https://ghcr.io/token?scope=repository:${repoPath}:pull`);
  if (!res.ok) throw new Error(`ghcr 토큰 발급 실패: ${res.status}`);
  const json = await res.json();
  return json.token;
}

/** 한 태그의 manifest digest 를 HEAD 로 조회 (Docker-Content-Digest 헤더). */
async function getTagDigest(token, tag) {
  const repoPath = IMAGE_REPO.replace(/^ghcr\.io\//, "");
  const res = await fetch(`https://ghcr.io/v2/${repoPath}/manifests/${tag}`, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:
        "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json",
    },
  });
  if (!res.ok) return null;
  return res.headers.get("docker-content-digest");
}

/**
 * ghcr :latest 의 manifest digest 를 조회한다.
 * digest 직접 배포라 sha 태그 역조회가 불필요 — 이 digest 를 그대로 @sha256: 핀으로 배포한다.
 * @returns {Promise<string|null>} 예: "sha256:892d..." / 실패 시 null
 */
async function getLatestDigest() {
  try {
    const token = await getGhcrToken();
    return await getTagDigest(token, "latest");
  } catch (e) {
    console.error("[autopilot] ghcr 최신 digest 조회 실패", e);
    return null;
  }
}

/** 롤백 처리한 digest 의 단일 소스 — cron 재시작에도 살아남아 재배포 루프를 막는다. */
async function getRolledBackDigest() {
  try {
    const v = (await readFile(ROLLEDBACK_FILE, "utf8")).trim();
    return v || null;
  } catch {
    return null;
  }
}

async function setRolledBackDigest(digest) {
  try {
    await writeFile(ROLLEDBACK_FILE, digest ?? "", "utf8");
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

/** digest 를 @sha256: 핀으로 배포 (compose 의 image: ${APP_IMAGE_REF} 에 주입). */
async function deployDigest(digest) {
  const cmdArgs = buildDeployArgs(COMPOSE_PATH, ENV_PATH);
  await execFileAsync("docker", ["--context", DOCKER_CONTEXT, ...cmdArgs], {
    timeout: 180_000,
    env: { ...process.env, APP_IMAGE_REF: buildImageRef(IMAGE_REPO, digest) },
  });
}

/**
 * 배포 영속화: .env 의 APP_IMAGE_REF 를 in-place 갱신.
 * 이래야 재부팅·수동 compose up 등 watcher 밖 경로에서도 app 이 같은 digest 로 뜬다
 * (모든 compose up 이 .env 를 자동으로 읽으므로). 단일 키만 read-modify-write — 다른 줄 보존.
 */
async function persistImageRef(digest) {
  let content;
  try {
    content = await readFile(ENV_PATH, "utf8");
  } catch (e) {
    console.error("[autopilot] .env 읽기 실패 — 영속화 건너뜀", e);
    await notify("autopilot 영속화 경고", `${digest} 배포는 됐으나 .env 읽기 실패 — 재부팅 시 latest 복귀 위험.`);
    return;
  }
  const next = upsertEnvKey(content, "APP_IMAGE_REF", buildImageRef(IMAGE_REPO, digest));
  try {
    // writeFile 은 비원자적(truncate+재작성) — 쓰기 도중 죽으면 .env 손상 → 다음 compose up Zod 실패.
    // 표준 temp+rename 은 :ro 디렉토리 + 단일파일 bind-mount inode 때문에 불가.
    // 대안: read-back-validate-restore. 손상 탐지 시 in-memory 원본으로 자가복구.
    await writeFile(ENV_PATH, next, "utf8");
    const back = await readFile(ENV_PATH, "utf8");
    if (!envKeysPreserved(content, back)) {
      await writeFile(ENV_PATH, content, "utf8"); // 원본 복구
      console.error("[autopilot] .env 쓰기 손상 감지 — 원본 복구함");
      await notify("autopilot 영속화 손상→복구", `${digest} .env 쓰기 손상 감지, 원본 복구. 재부팅 시 latest 복귀 위험.`);
    }
  } catch (e) {
    // 쓰기/검증 자체가 throw — 원본 복구 시도 (배포 컨테이너는 이미 새 digest 로 떠있음).
    console.error("[autopilot] .env 영속화 실패 — 원본 복구 시도", e);
    try {
      await writeFile(ENV_PATH, content, "utf8");
    } catch (re) {
      console.error("[autopilot] .env 원본 복구도 실패 — 수동 개입 필요", re);
    }
    await notify("autopilot 영속화 경고", `${digest} 배포는 됐으나 .env 갱신 실패 — 재부팅 시 latest 복귀 위험.`);
  }
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
    // 감지: running digest vs latest digest (digest 라 부트스트랩 갭 없음).
    let runningDigest;
    try {
      runningDigest = await getRunningDigest();
    } catch (e) {
      console.error("[autopilot] docker 상태 확인 실패 — 이번 사이클 배포 건너뜀", e);
      return;
    }
    const latestDigest = await getLatestDigest();
    const rolledBackDigest = await getRolledBackDigest();

    // shouldDeploy 는 비교 함수 — digest 문자열로 그대로 동작 (running 이 latest 와 다르고 롤백한 것 아니면 배포).
    if (!shouldDeploy(latestDigest, runningDigest, rolledBackDigest)) {
      console.log(
        `[autopilot] 배포 불필요 (latest=${latestDigest} running=${runningDigest} rolledBack=${rolledBackDigest})`,
      );
      return;
    }

    console.log(`[autopilot] 새 이미지 감지 (digest=${latestDigest}) — 배포 시작 (현재 ${runningDigest})`);
    const goodDigest = runningDigest; // 롤백 대상 = 직전 정상 digest (digest 라 항상 결정적)

    try {
      await deployDigest(latestDigest);
      const healthy = await checkHealth();
      if (healthy) {
        await persistImageRef(latestDigest); // 재부팅/수동 up 에도 이 digest 유지
        await setRolledBackDigest(null);
        console.log(`[autopilot] 배포 성공 ${latestDigest}`);
        await notify("autopilot 배포 성공", `${latestDigest} 배포 완료 (health OK)`);
        return;
      }
      throw new Error("health gate failed");
    } catch (err) {
      console.error(`[autopilot] 배포 실패 — 롤백 시도`, err);
      await setRolledBackDigest(latestDigest); // 이 digest 는 다음 폴링에서 재배포 차단
      // 롤백: 직전 running digest 를 그대로 @sha256: 핀으로 재배포 (결정적 — 역조회 불필요).
      if (goodDigest) {
        try {
          await deployDigest(goodDigest);
          const ok = await checkHealth();
          if (ok) await persistImageRef(goodDigest); // 롤백 성공 시 .env 도 이전 digest 로 되돌림
          await notify(
            "autopilot 배포 실패 → 롤백",
            `${latestDigest} health 실패. ${goodDigest} 로 롤백 ${ok ? "성공" : "했으나 health 미확인"}.`,
          );
        } catch (rbErr) {
          await notify("autopilot 롤백 실패", `${latestDigest} 실패 후 ${goodDigest} 롤백도 실패. 수동 개입 필요.`);
          console.error("[autopilot] 롤백 실패", rbErr);
        }
      } else {
        await notify(
          "autopilot 배포 실패",
          `${latestDigest} health 실패. 이전 digest 미상(첫 배포) — 롤백 불가, 수동 개입 필요.`,
        );
      }
    }
  } finally {
    inFlight = false;
  }
}
