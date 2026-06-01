// apps/cron/autopilot/lib.js
// 순수/얇은 함수 — 배포 판단·명령 인자 조립·health 파싱. docker 실행은 deploy-watcher.js 가 담당.

/**
 * /api/health 응답 본문이 healthy 인지.
 * @param {string} body
 * @returns {boolean}
 */
export function parseHealthBody(body) {
  try {
    const json = JSON.parse(body);
    return json.status === "ok";
  } catch {
    return false;
  }
}

/**
 * 새 이미지 태그를 배포해야 하는가.
 * @param {string|null} latestSha   ghcr 의 최신 sha 태그 (예: "sha-abc123")
 * @param {string|null} runningSha 현재 떠있는 app 의 sha 태그
 * @param {string|null} rolledBackSha 직전에 롤백 처리한 sha (재배포 차단용)
 * @returns {boolean}
 */
export function shouldDeploy(latestSha, runningSha, rolledBackSha) {
  if (!latestSha) return false;
  if (latestSha === runningSha) return false;
  if (latestSha === rolledBackSha) return false;
  return true;
}

/**
 * compose up 인자 (Gotcha #8: 절대경로 명시 / --no-deps: postgres recreate 방지).
 * 배포할 태그는 호출자가 APP_IMAGE_TAG 환경변수로 주입한다.
 * @param {string} composePath
 * @param {string} envPath
 * @returns {string[]}
 */
export function buildDeployArgs(composePath, envPath) {
  return ["compose", "-f", composePath, "--env-file", envPath, "up", "-d", "--no-deps", "app"];
}
