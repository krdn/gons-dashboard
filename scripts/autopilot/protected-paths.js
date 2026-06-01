// scripts/autopilot/protected-paths.js
// 자율 머지가 건드리면 안 되는 경로 — 건드리면 needs-human 라벨 + 머지 보류.
// minimatch 없이 동작하도록 단순 prefix/suffix/contains 규칙으로 표현.

/** @type {{ kind: "prefix" | "suffix" | "contains" | "basename", value: string }[]} */
export const PROTECTED_PATHS = [
  { kind: "prefix", value: ".github/workflows/" },
  { kind: "prefix", value: "apps/cron/" },
  { kind: "prefix", value: "scripts/autopilot/" },
  { kind: "prefix", value: "drizzle/" },
  { kind: "contains", value: "/secrets/" },
  { kind: "contains", value: "autopilot" }, // specs/docs 의 autopilot 문서
  { kind: "basename", value: "docker-compose.yml" },
  { kind: "prefix", value: "apps/dashboard/src/app/api/health/" },
  { kind: "suffix", value: "/schema.ts" }, // DB 스키마 (prod 오염 위험)
  { kind: "suffix", value: ".env" },
  { kind: "contains", value: ".env." }, // .env.local 등
];

/**
 * @param {string} path 레포 상대 경로
 * @param {{ kind: string, value: string }} rule
 * @returns {boolean}
 */
function ruleMatches(path, rule) {
  switch (rule.kind) {
    case "prefix":
      return path.startsWith(rule.value);
    case "suffix":
      return path.endsWith(rule.value);
    case "contains":
      return path.includes(rule.value);
    case "basename":
      return path.split("/").pop() === rule.value;
    default:
      return false;
  }
}

/**
 * 변경된 파일 목록 중 하나라도 보호 경로면 true.
 * @param {string[]} files
 * @returns {boolean}
 */
export function matchesProtectedPath(files) {
  return files.some((f) => PROTECTED_PATHS.some((rule) => ruleMatches(f, rule)));
}
