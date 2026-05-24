// v0.3.1 — yearly LLM 출력 zod 스키마.
//
// lifetime/api/schemas.ts 패턴 그대로 yearly 용으로 미러링.
// 공통 sections (5필드 + keyTerms + cautions) 위에 학파별 schoolSpecific 을 union.
// narrative-server.ts 가 school 에 따라 SCHOOL_SCHEMAS[school].parse() 호출.
//
// 분량 정책 차이 (vs lifetime):
//  - narrativeText min 1200 (lifetime 1500)
//  - sections.* min 200 (lifetime 과 동일)
//  - keyTerms 4~6개 권장 (스키마 min 3 그대로, max 8 로 약화)
import { z } from "zod";
import type { NarrativeSchool } from "./prompts";
import type {
  YearlyNarrativeSections,
  SchoolSpecific,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
} from "@/shared/lib/db/schema";

// Hotfix #5: LLM (특히 Gemini) 이 array-of-string 자리에 object 나
// array-of-object 를 응답하는 경우를 흡수.
// - string                              → [string]
// - object {k: v, ...}                  → ["k: v", ...]
// - array of (string | object)          → 각 원소를 string 으로 정규화
// - 그 외 (null/undefined/number 등)    → 그대로 (Zod array 검증에서 실패)
function normalizeStringArray(v: unknown): unknown {
  const toStr = (item: unknown): string => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.entries(item)
        .map(([k, val]) => `${k}: ${typeof val === "string" ? val : JSON.stringify(val)}`)
        .join(" / ");
    }
    return String(item);
  };
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(toStr);
  if (v && typeof v === "object") {
    return Object.entries(v).map(
      ([k, val]) => `${k}: ${typeof val === "string" ? val : JSON.stringify(val)}`,
    );
  }
  return v;
}

// Hotfix #2 (v0.3.1.1): LLM 출력 variance 흡수. v=2 가 운영에서 한 번도 zod
// 통과 못한 이슈 (sections min(200) 미달 + schoolSpecific 필드 undefined) 대응.
// 모든 min 을 약 25% 수준으로 약화. 운영 안정화 후 점진적으로 복원 검토.
// Hotfix #5 (v0.3.2.1): Gemini 가 keyTerms/cautions 를 빠뜨리는 경우 — optional() 로 약화.
//   Claude 는 여전히 채워서 응답하므로 호환 유지.
const sectionsSchema = z.object({
  personality: z.string().min(50),
  career: z.string().min(50),
  relationship: z.string().min(50),
  health: z.string().min(50),
  daeunSummary: z.string().min(50),
  keyTerms: z
    .array(
      z.object({
        term: z.string().min(1),
        gloss: z.string().min(1),
      }),
    )
    .max(8)
    .optional()
    .default([]),
  cautions: z.array(z.string().min(1)).max(5).optional().default([]),
}) satisfies z.ZodType<YearlyNarrativeSections, z.ZodTypeDef, unknown>;

// Hotfix #2: narrativeText min 1000 → 300 으로 약화.
const baseOutputSchema = z.object({
  narrativeText: z.string().min(300).max(2000),
  sections: sectionsSchema,
  citations: z.array(z.string().min(1)).min(1),
});

// Hotfix #2: schoolSpecific 필드 min 도 약화. 단, 필드 존재 자체는 강제 (LLM 이 빠뜨릴 가능성).
// Hotfix #4 (v0.3.1.2): LLM 이 array 대신 string 으로 응답하는 경우 자동 wrap.
// Hotfix #5 (v0.3.2.1): Gemini 가 object / array-of-object 로 응답하는 경우도 수용.
//   - object {"괴강살": "...", "도화살": "..."} → ["괴강살: ...", "도화살: ..."]
//   - array of object [{ "괴강살": "..." }, ...] → ["괴강살: ..."]
// preprocess input 이 unknown 이므로 satisfies generic 도 unknown.
const koSpecificSchema = z.object({
  joohuFocus: z.string().min(20),
  shinsalNotes: z.preprocess(normalizeStringArray, z.array(z.string().min(1)).min(1)),
}) satisfies z.ZodType<SchoolSpecificKo, z.ZodTypeDef, unknown>;

const zipingSpecificSchema = z.object({
  gyeokgukRationale: z.string().min(30),
  yongshinAnalysis: z.string().min(30),
}) satisfies z.ZodType<SchoolSpecificZiping>;

const normalizeEventTiming = (v: unknown): unknown => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const obj = v as Record<string, unknown>;
  if (!obj.period && (obj.time || obj.timing || obj.timeSlot)) {
    return { ...obj, period: obj.time ?? obj.timing ?? obj.timeSlot };
  }
  return v;
};

const mangpaiSpecificSchema = z.object({
  eventTimings: z
    .array(
      z.preprocess(
        normalizeEventTiming,
        z.object({
          period: z.string().min(1),
          event: z.string().min(1),
        }),
      ),
    )
    .min(3)
    .max(6),
}) satisfies z.ZodType<SchoolSpecificMangpai, z.ZodTypeDef, unknown>;

const jpSpecificSchema = z.object({
  palaceMap: z
    .array(
      z.object({
        palace: z.string().min(1),
        note: z.string().min(1),
      }),
    )
    .min(5)
    .max(8),
}) satisfies z.ZodType<SchoolSpecificJp>;

const koSchema = baseOutputSchema.extend({ schoolSpecific: koSpecificSchema });
const zipingSchema = baseOutputSchema.extend({
  schoolSpecific: zipingSpecificSchema,
});
const mangpaiSchema = baseOutputSchema.extend({
  schoolSpecific: mangpaiSpecificSchema,
});
const jpSchema = baseOutputSchema.extend({ schoolSpecific: jpSpecificSchema });

export const SCHOOL_SCHEMAS = {
  ko: koSchema,
  "cn-ziping": zipingSchema,
  "cn-mangpai": mangpaiSchema,
  jp: jpSchema,
} satisfies Record<NarrativeSchool, z.ZodType>;

// narrative-server.ts 가 사용할 union output 타입.
export type NarrativeOutput = {
  narrativeText: string;
  sections: YearlyNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
};
