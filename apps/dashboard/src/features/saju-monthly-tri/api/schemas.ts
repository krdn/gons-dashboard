// v0.3.1 — monthly LLM 출력 zod 스키마.
//
// yearly/api/schemas.ts 미러링. 차이:
//  - narrativeText min 800 (yearly 1200)
//  - sections.* min 150 (yearly 200)
//  - keyTerms 3~6개 (yearly 3~8)
//  - eventTimings 3~5개 (yearly 3~6)
//  - palaceMap 3~6개 (yearly 5~8)
//
// SchoolSpecificKo/Ziping/Mangpai/Jp 는 lifetime 과 동일 union 재사용.
import { z } from "zod";
import type { NarrativeSchool } from "./prompts";
import type {
  MonthlyNarrativeSections,
  SchoolSpecific,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
} from "@/shared/lib/db/schema";

// Hotfix #5: LLM (특히 Gemini) 이 array-of-string 자리에 object/array-of-object 응답 흡수.
// (yearly/lifetime schemas.ts 와 동일 — DRY 검토 후보지만 현재는 의도적 복제 유지.)
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

// Hotfix #2 (v0.3.1.1): yearly 와 같은 방향으로 약화 — LLM variance 흡수.
// Hotfix #5 (v0.3.2.1): Gemini 가 keyTerms/cautions 빠뜨리는 경우 optional() 약화.
const sectionsSchema = z.object({
  personality: z.string().min(30),
  career: z.string().min(30),
  relationship: z.string().min(30),
  health: z.string().min(30),
  daeunSummary: z.string().min(30),
  keyTerms: z
    .array(
      z.object({
        term: z.string().min(1),
        gloss: z.string().min(1),
      }),
    )
    .max(6)
    .optional()
    .default([]),
  cautions: z.array(z.string().min(1)).max(3).optional().default([]),
}) satisfies z.ZodType<MonthlyNarrativeSections, z.ZodTypeDef, unknown>;

const baseOutputSchema = z.object({
  narrativeText: z.string().min(200).max(1500),
  sections: sectionsSchema,
  citations: z.array(z.string().min(1)).min(1),
});

// Hotfix #4 (v0.3.1.2): LLM 이 array 대신 string 으로 응답하는 경우 자동 wrap.
// preprocess input 이 unknown 이므로 satisfies generic 도 unknown.
const koSpecificSchema = z.object({
  joohuFocus: z.string().min(20),
  shinsalNotes: z.preprocess(normalizeStringArray, z.array(z.string().min(1)).min(1)),
}) satisfies z.ZodType<SchoolSpecificKo, z.ZodTypeDef, unknown>;

const zipingSpecificSchema = z.object({
  gyeokgukRationale: z.string().min(30),
  yongshinAnalysis: z.string().min(30),
}) satisfies z.ZodType<SchoolSpecificZiping>;

const mangpaiSpecificSchema = z.object({
  eventTimings: z
    .array(
      z.object({
        period: z.string().min(1),
        event: z.string().min(1),
      }),
    )
    .min(3)
    .max(5),
}) satisfies z.ZodType<SchoolSpecificMangpai>;

const jpSpecificSchema = z.object({
  palaceMap: z
    .array(
      z.object({
        palace: z.string().min(1),
        note: z.string().min(1),
      }),
    )
    .min(3)
    .max(6),
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

export type NarrativeOutput = {
  narrativeText: string;
  sections: MonthlyNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
};
