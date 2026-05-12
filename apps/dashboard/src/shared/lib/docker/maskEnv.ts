// env 변수 키 이름이 민감 정보를 시사하면 true.
// 화이트리스트 키는 평문 노출 (NODE_ENV, PORT 등 운영자가 봐도 안전한 것).
const SENSITIVE_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PASSWD/i,
  /DSN/i,
  /URL$/i, // DATABASE_URL, REDIS_URL 등
  /CREDENTIAL/i,
  /PRIVATE/i,
];

const PLAINTEXT_WHITELIST = new Set([
  "NODE_ENV",
  "PORT",
  "TZ",
  "LANG",
  "PATH",
  "HOME",
  "PWD",
  "USER",
  "HOSTNAME",
]);

export function maskEnv(key: string): boolean {
  if (PLAINTEXT_WHITELIST.has(key.toUpperCase())) return false;
  return SENSITIVE_PATTERNS.some((re) => re.test(key));
}
