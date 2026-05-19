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

const sectionsSchema = z.object({
  personality: z.string().min(200),
  career: z.string().min(200),
  relationship: z.string().min(200),
  health: z.string().min(200),
  daeunSummary: z.string().min(200),
  keyTerms: z
    .array(
      z.object({
        term: z.string().min(1),
        gloss: z.string().min(1),
      }),
    )
    .min(3)
    .max(8),
  cautions: z.array(z.string().min(1)).max(5),
}) satisfies z.ZodType<YearlyNarrativeSections>;

const baseOutputSchema = z.object({
  narrativeText: z.string().min(1200).max(2000),
  sections: sectionsSchema,
  citations: z.array(z.string().min(1)).min(2),
});

// lifetime 의 SchoolSpecificKo/Ziping/Mangpai/Jp 그대로 재사용.
// 의미만 yearly 도메인으로 narrow (lifetime: 평생 / yearly: 올해).
const koSpecificSchema = z.object({
  joohuFocus: z.string().min(70),
  shinsalNotes: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<SchoolSpecificKo>;

const zipingSpecificSchema = z.object({
  gyeokgukRationale: z.string().min(100),
  yongshinAnalysis: z.string().min(100),
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
    .max(6),
}) satisfies z.ZodType<SchoolSpecificMangpai>;

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
