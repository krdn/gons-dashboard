// ~/.claude/skills/ 의 top-level 스킬을 스캔해 카탈로그를 생성.
// 출력 2개:
//   1) src/entities/skill/catalog.json — 경량 메타데이터 배열 (리스트용)
//   2) public/skill-catalog/<name>.json — 스킬당 본문 1파일 (선택 시 lazy-fetch)
// 실행: `pnpm skills:snapshot` (수동). 스킬이 바뀌면 돌려서 갱신 후 커밋.
//
// tsx --conditions=react-server 로 실행 — entities/skill/lib 가 server-only 가드를
// 건드리지 않지만 다른 스크립트와 일관성 유지. fs 직접 사용(DB 미접근).
import "dotenv/config";

import { readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toMeta, extractBody, sanitizeName, prependSummary } from "@/entities/skill/lib/parseSkill";
import type { SkillMeta, SkillTranslations } from "@/entities/skill/model/types";

const SKILLS_DIR = join(homedir(), ".claude", "skills");

// 이 스크립트 파일 기준으로 출력 경로 해석 (src/scripts/ → ../entities, ../../public).
const here = fileURLToPath(new URL(".", import.meta.url));
const CATALOG_OUT = join(here, "..", "entities", "skill", "catalog.json");
const BODY_DIR = join(here, "..", "..", "public", "skill-catalog");
// 한글 번역 overlay — 원본 SKILL.md(영어, 불가침) 대신 committed source.
// snapshot 재생성 시 catalog/body 로 merge 되므로 번역이 소실되지 않는다.
const TRANSLATIONS_PATH = join(here, "..", "entities", "skill", "translations.ko.json");

/** translations.ko.json 로드. 없거나 깨졌으면 빈 overlay(영어 그대로 fallback). */
function loadTranslations(): SkillTranslations {
  if (!existsSync(TRANSLATIONS_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(TRANSLATIONS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as SkillTranslations) : {};
  } catch (err) {
    console.warn(`[snapshot-skills] ⚠️ translations.ko.json 파싱 실패 — 영어 fallback: ${String(err)}`);
    return {};
  }
}

function tildePath(abs: string): string {
  const home = homedir();
  return abs.startsWith(home) ? abs.replace(home, "~") : abs;
}

function main() {
  if (!existsSync(SKILLS_DIR)) {
    console.warn(`[snapshot-skills] ${SKILLS_DIR} 없음 — 빈 카탈로그 생성`);
    mkdirSync(dirname(CATALOG_OUT), { recursive: true });
    writeFileSync(CATALOG_OUT, "[]\n");
    return;
  }

  // body 디렉토리 초기화 (제거된 스킬의 stale body 제거).
  if (existsSync(BODY_DIR)) rmSync(BODY_DIR, { recursive: true });
  mkdirSync(BODY_DIR, { recursive: true });

  const translations = loadTranslations();
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  const metas: SkillMeta[] = [];
  const usedFileNames = new Set<string>(); // sanitizeName 충돌 감지
  let skipped = 0;
  let translatedCount = 0;

  for (const entry of entries) {
    const entryPath = join(SKILLS_DIR, entry.name);

    // symlink 여부만 판정 (source 분류용). lstatSync 는 링크를 따라가지 않음.
    // 디렉토리/loose 파일 구분은 SKILL.md 존재 여부로 일원화 — broken symlink 도
    // existsSync 가 false 라 자연히 skip 된다.
    let isSymlink = false;
    try {
      isSymlink = lstatSync(entryPath).isSymbolicLink();
    } catch {
      console.warn(`[snapshot-skills] skip (stat 실패): ${entry.name}`);
      skipped++;
      continue;
    }

    const skillMd = join(entryPath, "SKILL.md");
    if (!existsSync(skillMd)) {
      // loose 파일(upgrade-domain.md) 또는 SKILL.md 없는 디렉토리(learned, vault-workspace).
      skipped++;
      continue;
    }

    let rawContent: string;
    try {
      rawContent = readFileSync(skillMd, "utf8");
    } catch {
      console.warn(`[snapshot-skills] skip (읽기 실패): ${entry.name}`);
      skipped++;
      continue;
    }

    try {
      const meta = toMeta({
        dirName: entry.name,
        rawContent,
        isSymlink,
        filePath: tildePath(skillMd),
      });
      const fileName = `${sanitizeName(meta.name)}.json`;
      if (usedFileNames.has(fileName)) {
        // 두 스킬이 같은 파일명으로 sanitize → 한쪽 body 가 덮어써져 잘못된 내용 표시.
        console.warn(
          `[snapshot-skills] ⚠️ 파일명 충돌: "${meta.name}" → ${fileName} (이미 존재). skip.`,
        );
        skipped++;
        continue;
      }
      usedFileNames.add(fileName);

      // 한글 overlay merge — description override + body summary prepend.
      const tr = translations[meta.name];
      if (tr?.description) {
        meta.description = tr.description;
      }
      if (tr?.description || tr?.summary) translatedCount++;

      metas.push(meta);
      const body = prependSummary(extractBody(rawContent), tr?.summary);
      writeFileSync(join(BODY_DIR, fileName), JSON.stringify({ body }));
    } catch (err) {
      console.warn(`[snapshot-skills] skip (파싱 실패): ${entry.name} — ${String(err)}`);
      skipped++;
    }
  }

  metas.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(CATALOG_OUT, JSON.stringify(metas, null, 2) + "\n");

  console.log(`[snapshot-skills] ✅ 생성 ${metas.length}개 / skip ${skipped}개 / 한글 overlay ${translatedCount}개`);
  console.log(`  catalog: ${tildePath(CATALOG_OUT)}`);
  console.log(`  bodies:  ${tildePath(BODY_DIR)}/`);
}

main();
