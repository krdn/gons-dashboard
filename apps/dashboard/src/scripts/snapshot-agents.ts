// ~/.claude/agents/ 의 flat <name>.md 서브에이전트를 스캔해 카탈로그를 생성.
// 출력 2개:
//   1) src/entities/agent/agent-catalog.json — 경량 메타데이터 배열 (리스트용)
//   2) public/agent-catalog/<name>.json — 에이전트당 본문 1파일 (선택 시 lazy-fetch)
// 실행: `pnpm agents:snapshot` (수동). 에이전트가 바뀌면 돌려서 갱신 후 커밋.
//
// skill 과 달리 dir/SKILL.md 가 아니라 평평한 .md 파일들이라 순회 게이트가 다르다.
// translations/categories/necessity overlay 없음 (단순화 — 18개 규모).
import "dotenv/config";

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toMeta, extractBody, sanitizeName } from "@/entities/agent/lib/parseAgent";
import { type AgentMeta, type AgentModel, type AgentSource } from "@/entities/agent/model/types";

const AGENTS_DIR = join(homedir(), ".claude", "agents");

// 이 스크립트 파일 기준으로 출력 경로 해석 (src/scripts/ → ../entities, ../../public).
const here = fileURLToPath(new URL(".", import.meta.url));
const CATALOG_OUT = join(here, "..", "entities", "agent", "agent-catalog.json");
const BODY_DIR = join(here, "..", "..", "public", "agent-catalog");

function tildePath(abs: string): string {
  const home = homedir();
  return abs.startsWith(home) ? abs.replace(home, "~") : abs;
}

function main() {
  if (!existsSync(AGENTS_DIR)) {
    console.warn(`[snapshot-agents] ${AGENTS_DIR} 없음 — 빈 카탈로그 생성`);
    mkdirSync(dirname(CATALOG_OUT), { recursive: true });
    writeFileSync(CATALOG_OUT, JSON.stringify({ agents: [] }, null, 2) + "\n");
    return;
  }

  // body 디렉토리 초기화 (제거된 에이전트의 stale body 제거).
  if (existsSync(BODY_DIR)) rmSync(BODY_DIR, { recursive: true });
  mkdirSync(BODY_DIR, { recursive: true });

  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  const metas: AgentMeta[] = [];
  const usedFileNames = new Set<string>(); // sanitizeName 충돌 감지
  let skipped = 0;

  for (const entry of entries) {
    const name = entry.name;
    if (!name.endsWith(".md")) {
      skipped++;
      continue;
    }

    // ⚠️ symlink 는 Dirent.isFile()===false. isFile||isSymlink 둘 다 허용해야
    // frameworks/krdn-claude 미러(code-reviewer/monitor/orchestrator)가 누락되지 않는다.
    const isSymlink = entry.isSymbolicLink();
    if (!entry.isFile() && !isSymlink) {
      skipped++;
      continue;
    }

    const entryPath = join(AGENTS_DIR, name);
    let rawContent: string;
    try {
      rawContent = readFileSync(entryPath, "utf8"); // symlink 자동 추적
    } catch {
      console.warn(`[snapshot-agents] skip (broken symlink/읽기 실패): ${name}`);
      skipped++;
      continue;
    }

    try {
      const meta = toMeta({
        fileBase: name.replace(/\.md$/, ""),
        rawContent,
        isSymlink,
        filePath: tildePath(entryPath),
      });
      const fileName = `${sanitizeName(meta.name)}.json`;
      if (usedFileNames.has(fileName)) {
        console.warn(
          `[snapshot-agents] ⚠️ 파일명 충돌: "${meta.name}" → ${fileName} (이미 존재). skip.`,
        );
        skipped++;
        continue;
      }
      usedFileNames.add(fileName);

      metas.push(meta);
      writeFileSync(join(BODY_DIR, fileName), JSON.stringify({ body: extractBody(rawContent) }));
    } catch (err) {
      console.warn(`[snapshot-agents] skip (파싱 실패): ${name} — ${String(err)}`);
      skipped++;
    }
  }

  metas.sort((a, b) => a.name.localeCompare(b.name));

  writeFileSync(CATALOG_OUT, JSON.stringify({ agents: metas }, null, 2) + "\n");

  // model / source 분포 — 새 에이전트가 조용히 누락되거나 정비 필요분을 즉시 가시화.
  const modelDist: Record<string, number> = {};
  for (const m of metas) modelDist[m.model] = (modelDist[m.model] ?? 0) + 1;
  const modelLine = (["opus", "sonnet", "haiku", "inherit"] as AgentModel[])
    .map((m) => `${m}=${modelDist[m] ?? 0}`)
    .join(" ");
  const sourceDist: Record<string, number> = {};
  for (const m of metas) sourceDist[m.source] = (sourceDist[m.source] ?? 0) + 1;
  const sourceLine = (["personal", "framework"] as AgentSource[])
    .map((s) => `${s}=${sourceDist[s] ?? 0}`)
    .join(" ");

  console.log(`[snapshot-agents] ✅ 생성 ${metas.length}개 / skip ${skipped}개`);
  console.log(`  catalog: ${tildePath(CATALOG_OUT)}`);
  console.log(`  bodies:  ${tildePath(BODY_DIR)}/`);
  console.log(`  model 분포: ${modelLine}`);
  console.log(`  source 분포: ${sourceLine}`);
}

main();
