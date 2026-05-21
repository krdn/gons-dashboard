import { z } from "zod";
import { PersonaKeySchema, VerdictSchema, ModelNameSchema } from "./persona";

export const ConsensusSchema = z.object({
  verdict: VerdictSchema,
  score: z.string().regex(/^[0-5]\/5$/),
  oneLineConsensus: z.string().min(30).max(300),
  agreements: z.array(z.string().min(5).max(200)).min(0).max(5),
  disagreements: z.array(z.string().min(5).max(200)).min(0).max(5),
  riskRanking: z.array(z.string().min(5).max(200)).min(1).max(5),
  modelUsed: ModelNameSchema,
  successfulPersonas: z.array(PersonaKeySchema).min(3).max(5),
  failedPersonas: z.array(PersonaKeySchema).min(0).max(2),
});

export type Consensus = z.infer<typeof ConsensusSchema>;

export const MarketSnapshotSchema = z.object({
  price: z.number(),
  changePct: z.number(),
  currency: z.string(),
  marketCap: z.number().optional(),
  per: z.number().optional(),
  pbr: z.number().optional(),
  dividendYield: z.number().optional(),
  debtRatio: z.number().optional(),
  rsi14: z.number().optional(),
  ma20: z.number().optional(),
  ma60: z.number().optional(),
  asOf: z.string(),
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
