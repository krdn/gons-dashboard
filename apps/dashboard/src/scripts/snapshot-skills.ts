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
import { toMeta, extractBody, sanitizeName } from "@/entities/skill/lib/parseSkill";
import {
  UNCATEGORIZED,
  type SkillMeta,
  type SkillTier,
  type SkillTranslations,
  type SkillCategoryDefs,
  type SkillCategoryMetaMap,
} from "@/entities/skill/model/types";

const SKILLS_DIR = join(homedir(), ".claude", "skills");

// 이 스크립트 파일 기준으로 출력 경로 해석 (src/scripts/ → ../entities, ../../public).
const here = fileURLToPath(new URL(".", import.meta.url));
const CATALOG_OUT = join(here, "..", "entities", "skill", "catalog.json");
const BODY_DIR = join(here, "..", "..", "public", "skill-catalog");
// 한글 번역 overlay — 원본 SKILL.md(영어, 불가침) 대신 committed source.
// snapshot 재생성 시 catalog/body 로 merge 되므로 번역이 소실되지 않는다.
const TRANSLATIONS_PATH = join(here, "..", "entities", "skill", "translations.ko.json");
// 카테고리 분류 overlay (committed source — 사람이 편집). slug → {label, order, skills[]}.
// snapshot 이 skills[] 를 역인덱싱해 각 meta.category 를 주입한다.
const CATEGORIES_PATH = join(here, "..", "entities", "skill", "categories.json");
// 필요도 평가 overlay (committed source). name → {tier, reason}.
// snapshot 이 각 meta.necessity / necessityReason 으로 주입한다.
const NECESSITY_PATH = join(here, "..", "entities", "skill", "necessity.json");

type NecessityEntry = { tier: SkillTier; reason: string };
type NecessityMap = Record<string, NecessityEntry>;

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

/** categories.json 로드. 없거나 깨졌으면 빈 맵(전부 UNCATEGORIZED fallback). */
function loadCategories(): SkillCategoryDefs {
  if (!existsSync(CATEGORIES_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CATEGORIES_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as SkillCategoryDefs) : {};
  } catch (err) {
    console.warn(`[snapshot-skills] ⚠️ categories.json 파싱 실패 — 미분류 fallback: ${String(err)}`);
    return {};
  }
}

/** categories.json → 역인덱스 (skill name → slug). 한 스킬이 두 카테고리에 있으면 첫 등장 우선 + warn. */
function buildCategoryIndex(defs: SkillCategoryDefs): Record<string, string> {
  const index: Record<string, string> = {};
  for (const [slug, def] of Object.entries(defs)) {
    for (const name of def.skills) {
      if (index[name]) {
        console.warn(
          `[snapshot-skills] ⚠️ "${name}" 가 두 카테고리에 중복: ${index[name]} / ${slug}. 첫 등장 유지.`,
        );
        continue;
      }
      index[name] = slug;
    }
  }
  return index;
}

/** categories.json → UI 용 경량 메타 맵 (label/order 만, skills 제외). */
function buildCategoryMeta(defs: SkillCategoryDefs): SkillCategoryMetaMap {
  const meta: SkillCategoryMetaMap = {};
  for (const [slug, def] of Object.entries(defs)) {
    meta[slug] = { label: def.label, order: def.order };
  }
  return meta;
}

/** necessity.json 로드. 없거나 깨졌으면 빈 맵(전부 unrated fallback). */
function loadNecessity(): NecessityMap {
  if (!existsSync(NECESSITY_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(NECESSITY_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as NecessityMap) : {};
  } catch (err) {
    console.warn(`[snapshot-skills] ⚠️ necessity.json 파싱 실패 — 미평가 fallback: ${String(err)}`);
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
    writeFileSync(CATALOG_OUT, JSON.stringify({ skills: [], categories: {} }, null, 2) + "\n");
    return;
  }

  // body 디렉토리 초기화 (제거된 스킬의 stale body 제거).
  if (existsSync(BODY_DIR)) rmSync(BODY_DIR, { recursive: true });
  mkdirSync(BODY_DIR, { recursive: true });

  const translations = loadTranslations();
  const categoryDefs = loadCategories();
  const categoryIndex = buildCategoryIndex(categoryDefs); // name → slug
  const uncategorized: string[] = []; // categories.json 에 누락된 스킬 (완전성 warn 용)
  const necessityMap = loadNecessity(); // name → {tier, reason}
  const unrated: string[] = []; // necessity.json 에 누락된 스킬 (완전성 warn 용)
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

      // 카테고리 주입 — categories.json 역인덱스. 미매핑이면 UNCATEGORIZED + 추적.
      const slug = categoryIndex[meta.name];
      meta.category = slug ?? UNCATEGORIZED;
      if (!slug) uncategorized.push(meta.name);

      // 필요도 주입 — necessity.json. 미매핑이면 unrated + 추적.
      const nec = necessityMap[meta.name];
      meta.necessity = nec?.tier ?? "unrated";
      meta.necessityReason = nec?.reason ?? "";
      if (!nec) unrated.push(meta.name);

      metas.push(meta);
      // 본문은 원문 그대로(영어 보존). 한글 요약은 별도 필드로 분리 저장 —
      // SkillDetail 이 전용 박스로 렌더하므로 본문의 native blockquote 와 충돌하지 않는다.
      const body = extractBody(rawContent);
      const summaryKo = tr?.summary?.trim();
      writeFileSync(
        join(BODY_DIR, fileName),
        JSON.stringify(summaryKo ? { body, summaryKo } : { body }),
      );
    } catch (err) {
      console.warn(`[snapshot-skills] skip (파싱 실패): ${entry.name} — ${String(err)}`);
      skipped++;
    }
  }

  metas.sort((a, b) => a.name.localeCompare(b.name));

  // catalog.json envelope — { skills, categories }. categories 는 UI 섹션 헤더·순서용 경량 메타.
  const categoryMeta = buildCategoryMeta(categoryDefs);
  writeFileSync(
    CATALOG_OUT,
    JSON.stringify({ skills: metas, categories: categoryMeta }, null, 2) + "\n",
  );

  // 카테고리 분포 — 새 스킬 silent drop 즉시 가시화.
  const distribution: Record<string, number> = {};
  for (const m of metas) distribution[m.category] = (distribution[m.category] ?? 0) + 1;
  const distLine = Object.entries(categoryMeta)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([slug]) => `${slug}=${distribution[slug] ?? 0}`)
    .join(" ");

  console.log(`[snapshot-skills] ✅ 생성 ${metas.length}개 / skip ${skipped}개 / 한글 overlay ${translatedCount}개`);
  console.log(`  catalog: ${tildePath(CATALOG_OUT)}`);
  console.log(`  bodies:  ${tildePath(BODY_DIR)}/`);
  console.log(`  카테고리 분포: ${distLine}`);
  if (uncategorized.length > 0) {
    console.warn(
      `[snapshot-skills] ⚠️ 미분류 ${uncategorized.length}개 (categories.json 에 추가 필요): ${uncategorized.join(", ")}`,
    );
  }

  // 필요도 분포 — 새 스킬이 평가 안 된 채 추가되면 즉시 가시화.
  const tierDist: Record<string, number> = {};
  for (const m of metas) tierDist[m.necessity] = (tierDist[m.necessity] ?? 0) + 1;
  const tierLine = (["high", "medium", "low", "remove", "unrated"] as const)
    .map((t) => `${t}=${tierDist[t] ?? 0}`)
    .join(" ");
  console.log(`  필요도 분포: ${tierLine}`);
  if (unrated.length > 0) {
    console.warn(
      `[snapshot-skills] ⚠️ 미평가 ${unrated.length}개 (necessity.json 에 추가 필요): ${unrated.join(", ")}`,
    );
  }
}

main();
