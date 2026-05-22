// 1회용: DART corpCode.xml 다운로드 → KRX 6자리 코드 매핑 JSON 생성.
// 운영 weekly cron 으로 교체하기 전 bootstrap.
// 실행: DART_OPENAPI_AUTH_KEY=xxx tsx packages/stock-analysis/scripts/build-dart-corp-codes.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";

const DART_BASE = "https://opendart.fss.or.kr/api";

async function main() {
  const authKey = process.env.DART_OPENAPI_AUTH_KEY;
  if (!authKey) {
    console.error("DART_OPENAPI_AUTH_KEY 환경변수 필수");
    process.exit(1);
  }

  const url = `${DART_BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(authKey)}`;
  console.log(`[1/4] DART corpCode.xml 다운로드: ${url.replace(authKey, "<key>")}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(`[2/4] ZIP 수신: ${buffer.length} bytes`);

  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("CORPCODE.xml");
  if (!entry) {
    console.error("CORPCODE.xml 항목이 ZIP 에 없음");
    process.exit(1);
  }
  const xml = entry.getData().toString("utf-8");
  console.log(`[3/4] XML 추출: ${xml.length} chars`);

  // 정규식 파싱 — 외부 XML 라이브러리 회피. <list> 블록 안에 corp_code + stock_code.
  const mapping: Record<string, string> = {};
  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match: RegExpExecArray | null;
  let total = 0;
  let listed = 0;
  while ((match = listRegex.exec(xml)) !== null) {
    total += 1;
    const block = match[1];
    const corpMatch = block.match(/<corp_code>(\d{8})<\/corp_code>/);
    const stockMatch = block.match(/<stock_code>\s*([\dA-Z]{6})\s*<\/stock_code>/);
    if (!corpMatch || !stockMatch) continue;
    mapping[stockMatch[1]] = corpMatch[1];
    listed += 1;
  }
  console.log(`[4/4] 매핑 ${listed} / ${total} (KRX 상장 + corp_code 보유 회사만)`);

  const outPath = join(
    process.cwd(),
    "packages/stock-analysis/src/adapters/dart-corp-codes.json",
  );
  writeFileSync(outPath, JSON.stringify(mapping, null, 0));
  console.log(`✓ 저장: ${outPath} (${(JSON.stringify(mapping).length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
