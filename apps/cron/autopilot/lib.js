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
 * 배포할 이미지 ref(digest 핀)는 호출자가 APP_IMAGE_REF 환경변수로 주입한다.
 * @param {string} composePath
 * @param {string} envPath
 * @returns {string[]}
 */
export function buildDeployArgs(composePath, envPath) {
  return ["compose", "-f", composePath, "--env-file", envPath, "up", "-d", "--no-deps", "app"];
}

/**
 * docker inspect 의 RepoDigest 문자열에서 sha256 digest 추출.
 * 감지는 digest 로 한다 — running 이 :latest 든 :sha- 든 RepoDigests 는 항상 존재하므로
 * sha 태그 정규식의 부트스트랩 갭(첫 배포 앵커 null)이 사라진다.
 * @param {string} repoDigest 예: "ghcr.io/krdn/gons-dashboard@sha256:891e..."
 * @returns {string|null} 예: "sha256:891e..." / 없으면 null
 */
export function parseRunningDigest(repoDigest) {
  if (!repoDigest) return null;
  const m = repoDigest.match(/@(sha256:[0-9a-f]+)/);
  return m ? m[1] : null;
}

/**
 * digest 로 배포할 이미지 ref 를 만든다. compose 의 image: ${APP_IMAGE_REF} 에 주입.
 * digest 직접 배포라 sha 태그 역조회가 불필요 — 감지·배포·롤백 모두 digest 로 결정적.
 * @param {string} imageRepo 예: "ghcr.io/krdn/gons-dashboard"
 * @param {string} digest 예: "sha256:892d..."
 * @returns {string} 예: "ghcr.io/krdn/gons-dashboard@sha256:892d..."
 */
export function buildImageRef(imageRepo, digest) {
  return `${imageRepo}@${digest}`;
}
