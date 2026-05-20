// 학파별 LLM 출력 zod 스키마.
//
// 공통 sections (5필드 + keyTerms + cautions) 위에 학파별 schoolSpecific 을 union.
// narrative-server.ts 가 school 에 따라 SCHOOL_SCHEMAS[school].parse() 호출.
import { z } from "zod";
import type { NarrativeSchool } from "./prompts";
import type {
  LifetimeNarrativeSections,
  SchoolSpecific,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
} from "@/shared/lib/db/schema";

// Hotfix #2 (v0.3.1.1): LLM 출력 variance 흡수 — yearly/monthly 와 같은 방향.
// v=2 가 운영에서 한 번도 zod 통과 못함 (sections min 200 미달 + schoolSpecific 필드 누락).
const sectionsSchema = z.object({
  personality: z.string().min(80),
  career: z.string().min(80),
  relationship: z.string().min(80),
  health: z.string().min(80),
  daeunSummary: z.string().min(80),
  keyTerms: z
    .array(
      z.object({
        term: z.string().min(1),
        gloss: z.string().min(1),
      }),
    )
    .min(1)
    .max(10),
  cautions: z.array(z.string().min(1)).max(5),
}) satisfies z.ZodType<LifetimeNarrativeSections>;

const baseOutputSchema = z.object({
  narrativeText: z.string().min(500).max(2500),
  sections: sectionsSchema,
  citations: z.array(z.string().min(1)).min(1),
});

// Hotfix #4 (v0.3.1.2): LLM 이 array 대신 string 으로 응답하는 경우 자동 wrap.
// 운영에서 `shinsalNotes: "괴강, 도화..."` (string) 응답 관측 — 이걸 [string] 으로
// normalize 해 schema 통과시킴. preprocess 의 input 이 unknown 이므로 satisfies 의
// input generic 을 unknown 으로 풀어 호환. parse 결과 output 은 SchoolSpecificKo.
const koSpecificSchema = z.object({
  joohuFocus: z.string().min(30),
  shinsalNotes: z.preprocess(
    (v) => (typeof v === "string" ? [v] : v),
    z.array(z.string().min(1)).min(1),
  ),
}) satisfies z.ZodType<SchoolSpecificKo, z.ZodTypeDef, unknown>;

const zipingSpecificSchema = z.object({
  gyeokgukRationale: z.string().min(40),
  yongshinAnalysis: z.string().min(40),
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
    .max(8),
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
    .max(12),
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
  sections: LifetimeNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
};
